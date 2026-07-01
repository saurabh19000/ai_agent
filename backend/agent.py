import os
import logging
import asyncio
import time
from typing import Optional
from dotenv import load_dotenv
from livekit import agents, rtc
from livekit.agents import AgentServer, AgentSession, Agent, room_io
from livekit.plugins import noise_cancellation, silero, google, openai, deepgram
from livekit.plugins.turn_detector.multilingual import MultilingualModel
from tools import (
    search_project_docs,
    generate_feedback,
    create_fetch_resume_tool,
    create_save_summary_tool,
    flush_pending_summary,
)
from prompts import build_system_prompt, build_greeting_instruction

load_dotenv(".env")

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)

logger = logging.getLogger(__name__)

active_sessions = 0
MAX_CONCURRENT_SESSIONS = 5
sessions_lock = asyncio.Lock()

IDLE_TIMEOUT = 900
ACTIVITY_CHECK_INTERVAL = 60
EMPTY_ROOM_GRACE_PERIOD = 3


def parse_room_metadata(room_name: str) -> dict:
    parts = room_name.split("-")
    meta = {"department": "general", "application_id": None}
    if len(parts) < 3:
        return meta
    middle = parts[1:-1]
    if len(middle) > 1 and len(middle[-1]) == 24:
        meta["application_id"] = middle[-1]
        meta["department"] = "-".join(middle[:-1])
    else:
        meta["department"] = "-".join(middle)
    return meta


class Assistant(Agent):
    def __init__(self, instructions: str, tools: list) -> None:
        super().__init__(
            instructions=instructions,
            tools=tools,
        )


server = AgentServer()


async def increment_session_count() -> bool:
    global active_sessions
    async with sessions_lock:
        if active_sessions >= MAX_CONCURRENT_SESSIONS:
            logger.warning(
                f"Session limit reached: {active_sessions}/{MAX_CONCURRENT_SESSIONS}"
            )
            return False
        active_sessions += 1
        logger.info(
            f"Session started. Active sessions: {active_sessions}/{MAX_CONCURRENT_SESSIONS}"
        )
        return True


async def decrement_session_count():
    global active_sessions
    async with sessions_lock:
        active_sessions = max(0, active_sessions - 1)
        logger.info(
            f"Session ended. Active sessions: {active_sessions}/{MAX_CONCURRENT_SESSIONS}"
        )


async def monitor_room_activity(
    room: rtc.Room,
    session: AgentSession,
    last_activity_time: list[float]
):
    try:
        while True:
            await asyncio.sleep(ACTIVITY_CHECK_INTERVAL)

            has_real_participants = False
            for participant in room.remote_participants.values():
                if not (participant.kind == rtc.ParticipantKind.PARTICIPANT_KIND_AGENT):
                    has_real_participants = True
                    break

            if not has_real_participants:
                await asyncio.sleep(EMPTY_ROOM_GRACE_PERIOD)

                has_real_participants = False
                for participant in room.remote_participants.values():
                    if not (participant.kind == rtc.ParticipantKind.PARTICIPANT_KIND_AGENT):
                        has_real_participants = True
                        break

                if not has_real_participants:
                    logger.info(f"Room {room.name} empty - cleaning up session")
                    break

            time_since_activity = time.time() - last_activity_time[0]
            if time_since_activity > IDLE_TIMEOUT:
                logger.info(f"Session idle timeout in room {room.name}")
                break

    except asyncio.CancelledError:
        raise
    except Exception as e:
        logger.error(f"Error in activity monitor for room {room.name}: {e}", exc_info=True)


@server.rtc_session()
async def my_agent(ctx: agents.JobContext):
    session_id = f"{ctx.room.name}-{time.time()}"
    logger.info(f"Session starting: {session_id}")

    if not await increment_session_count():
        logger.warning(f"Rejecting session {session_id}: capacity limit reached")
        return

    meta = parse_room_metadata(ctx.room.name)
    department = meta["department"]
    application_id = meta.get("application_id")

    logger.info(f"Department: {department}, Application ID: {application_id or 'not provided'}")

    session: Optional[AgentSession] = None
    monitor_task: Optional[asyncio.Task] = None

    try:
        last_activity_time = [time.time()]

        def on_track_subscribed(track: rtc.Track, publication: rtc.TrackPublication, participant: rtc.RemoteParticipant):
            if track.kind == rtc.TrackKind.KIND_AUDIO:
                if participant.kind != rtc.ParticipantKind.PARTICIPANT_KIND_AGENT:
                    last_activity_time[0] = time.time()

        ctx.room.on("track_subscribed", on_track_subscribed)

        try:
            llm_provider = os.getenv("LLM_PROVIDER", "google")
            if llm_provider == "openai":
                llm = openai.LLM(
                    model=os.getenv("LLM_MODEL", "llama-3.3-70b-versatile"),
                    base_url=os.getenv("LLM_BASE_URL", "https://api.groq.com/openai/v1"),
                    api_key=os.getenv("LLM_API_KEY"),
                )
                logger.info(f"Using OpenAI-compatible LLM: {os.getenv('LLM_MODEL')} @ {os.getenv('LLM_BASE_URL')}")
            else:
                preferred_models = [
                    m.strip()
                    for m in os.getenv("GEMINI_MODELS", "gemini-2.0-flash,gemini-2.0-flash-lite").split(",")
                    if m.strip()
                ]
                gemini_model = preferred_models[0]
                try:
                    from google import genai as _genai
                    _client = _genai.Client(api_key=os.getenv("GOOGLE_API_KEY"))
                    available = {m.name.removeprefix("models/") for m in _client.models.list()}
                    for candidate in preferred_models:
                        if candidate in available:
                            gemini_model = candidate
                            break
                    logger.info(f"Gemini models available: {available & set(preferred_models)}")
                except Exception as e:
                    logger.warning(f"Could not query Gemini models: {e}")
                logger.info(f"Using Gemini model: {gemini_model}")
                llm = google.LLM(model=gemini_model)
            session = AgentSession(
                stt=deepgram.STT(),
                llm=llm,
                tts=os.getenv("TTS_VOICE_ID", "cartesia/sonic-3:9626c31c-bec5-4cca-baa8-f8ba9e84c8bc"),
                vad=silero.VAD.load(),
                turn_detection=MultilingualModel(),
                use_tts_aligned_transcript=True,
            )
        except Exception as e:
            logger.error(f"Failed to initialize session {session_id}: {e}", exc_info=True)
            raise

        tools = [search_project_docs, generate_feedback]
        if application_id:
            tools.append(create_fetch_resume_tool(application_id))
            tools.append(create_save_summary_tool(application_id, department))
            logger.info(f"Added resume fetch + save summary tools for application: {application_id}")

        system_prompt = build_system_prompt(department, application_id)
        greeting_instruction = build_greeting_instruction(department)

        try:
            await session.start(
                room=ctx.room,
                agent=Assistant(instructions=system_prompt, tools=tools),
                room_options=room_io.RoomOptions(
                    audio_input=room_io.AudioInputOptions(
                        noise_cancellation=lambda params: noise_cancellation.BVCTelephony()
                        if params.participant.kind == rtc.ParticipantKind.PARTICIPANT_KIND_SIP
                        else noise_cancellation.BVC(),
                    ),
                ),
            )
        except Exception as e:
            logger.error(f"Failed to start session {session_id}: {e}", exc_info=True)
            raise

        try:
            await session.generate_reply(instructions=greeting_instruction)
            logger.info(f"Session {session_id} ready")
        except Exception as e:
            logger.error(f"Failed to generate greeting for {session_id}: {e}", exc_info=True)

        monitor_task = asyncio.create_task(
            monitor_room_activity(ctx.room, session, last_activity_time)
        )

        await monitor_task

    except asyncio.CancelledError:
        logger.info(f"Session {session_id} cancelled")
        raise
    except Exception as e:
        logger.error(f"Error in session {session_id}: {e}", exc_info=True)
    finally:
        if monitor_task and not monitor_task.done():
            monitor_task.cancel()
            try:
                await monitor_task
            except asyncio.CancelledError:
                pass

        if application_id:
            await flush_pending_summary(application_id)

        await decrement_session_count()

        logger.info(f"Session {session_id} ended")


if __name__ == "__main__":
    livekit_url = os.getenv("LIVEKIT_URL", "Not configured")
    print("\n" + "="*60)
    print("Agent Server Starting...")
    print("="*60)
    print(f"LiveKit URL: {livekit_url}")
    print(f"Token Server: {os.getenv('TOKEN_SERVER_PUBLIC_URL', 'http://localhost:8000')}/token?room=<room>&username=<user>")
    print(f"Connect at: {os.getenv('LIVEKIT_MEET_URL', 'https://meet.livekit.io')}")
    print("="*60 + "\n")
    agents.cli.run_app(server)
