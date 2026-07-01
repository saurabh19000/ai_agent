import os
import asyncio
import aiohttp
from typing import Dict, Any, Optional

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from livekit import api

load_dotenv(".env")

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("CORS_ORIGINS", "*").split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

MAX_CONCURRENT_SESSIONS = 5


async def get_active_rooms() -> list[Dict[str, Any]]:
    livekit_url = os.getenv("LIVEKIT_URL")
    api_key = os.getenv("LIVEKIT_API_KEY")
    api_secret = os.getenv("LIVEKIT_API_SECRET")

    if not all([livekit_url, api_key, api_secret]):
        return []

    try:
        import re
        host = livekit_url.replace("ws://", "http://").replace("wss://", "https://")

        token = api.AccessToken(api_key, api_secret).with_grants(api.VideoGrants()).to_jwt()

        async with aiohttp.ClientSession() as session:
            async with session.get(
                f"{host}/twirp/livekit.RoomService/ListRooms",
                headers={"Authorization": f"Bearer {token}"},
                json={}
            ) as response:
                if response.status == 200:
                    data = await response.json()
                    rooms = data.get("rooms", [])

                    interview_rooms = [
                        room for room in rooms
                        if room.get("name", "").startswith("interview-") and room.get("numParticipants", 0) > 0
                    ]

                    return interview_rooms
                else:
                    print(f"Error listing rooms: HTTP {response.status}")
                    return []
    except Exception as e:
        print(f"Error getting active rooms: {e}")
        return []


@app.get("/livekit-url")
async def get_livekit_url():
    livekit_url = os.getenv("LIVEKIT_URL")
    if not livekit_url:
        return {"error": "LIVEKIT_URL not configured"}
    return {"url": livekit_url}


@app.get("/capacity-check")
async def check_capacity():
    try:
        active_rooms = await get_active_rooms()
        active_count = len(active_rooms)
        has_capacity = active_count < MAX_CONCURRENT_SESSIONS

        return {
            "has_capacity": has_capacity,
            "active_sessions": active_count,
            "max_sessions": MAX_CONCURRENT_SESSIONS,
            "message": "Capacity available" if has_capacity else "Maximum concurrent interviews reached. Please try again later."
        }
    except Exception as e:
        print(f"Error checking capacity: {e}")
        return {
            "has_capacity": True,
            "active_sessions": 0,
            "max_sessions": MAX_CONCURRENT_SESSIONS,
            "message": "Capacity check unavailable, proceeding",
            "error": str(e)
        }


@app.get("/token")
async def get_token(
    room: str = Query(..., description="Room name"),
    username: str = Query(..., description="Username for the participant"),
    department: Optional[str] = Query(None, description="Department for the interview"),
    application_id: Optional[str] = Query(None, alias="application_id", description="Application ID from the recruitment system"),
    candidate_email: Optional[str] = Query(None, alias="candidate_email", description="Candidate email from verified token"),
    resume: Optional[str] = Query(None, description="Resume file ID from the recruitment system")
):
    """
    Generate a LiveKit access token for the given room and username.
    Checks capacity before issuing token for interview rooms.
    """
    api_key = os.getenv("LIVEKIT_API_KEY")
    api_secret = os.getenv("LIVEKIT_API_SECRET")

    if not api_key or not api_secret:
        raise HTTPException(status_code=500, detail="LiveKit credentials not configured")

    if room.startswith("interview-"):
        capacity_check = await check_capacity()
        if not capacity_check.get("has_capacity", True):
            raise HTTPException(
                status_code=429,
                detail=capacity_check.get("message", "Too many active sessions")
            )

    token = (
        api.AccessToken(api_key, api_secret)
        .with_identity(username)
        .with_name(username)
        .with_grants(
            api.VideoGrants(
                room_join=True,
                room=room,
            )
        )
    )

    meta = {}
    if department:
        meta["department"] = department
    if application_id:
        meta["application_id"] = application_id
    if candidate_email:
        meta["candidate_email"] = candidate_email
    if resume:
        meta["resume"] = resume
    if meta:
        import json
        token.metadata = json.dumps(meta)

    print(f"Generated token for room: {room}, user: {username}, department: {department or 'not specified'}, application_id: {application_id or 'not provided'}")
    return {"token": token.to_jwt()}


if __name__ == "__main__":
    import uvicorn

    print("Token Server Started!\n")

    port = int(os.getenv("PORT", "8000"))
    host = os.getenv("HOST", "0.0.0.0")
    uvicorn.run(app, host=host, port=port)
