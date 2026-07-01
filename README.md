# AI Interview Agent

A **real-time voice-based AI interviewer** that conducts interviews with candidates. Supports department-specific questions, resume-based personalized follow-ups, and integrates with an HRMS system for interview lifecycle management.

Built on [LiveKit Agents](https://docs.livekit.io) with a React frontend, FastAPI token server, and a Python AI agent.

---

## Architecture

```
┌─────────────────┐      ┌──────────────────┐      ┌────────────────────┐
│  React Frontend │◄────►│  Token Server    │      │  LiveKit Cloud     │
│   (TypeScript)  │      │    (FastAPI)     │      │                    │
└────────┬────────┘      └──────────────────┘      └────────────────────┘
         │                         │                         │
         │                         │                         │
         ▼                         ▼                         ▼
┌─────────────────┐      ┌──────────────────┐      ┌────────────────────┐
│  HRMS Backend   │      │  AI Agent (Python)│      │  Resume Parser     │
│  (FastAPI/Mongo)│      │  VAD→STT→LLM→TTS │      │  PDF/DOCX parsing  │
│                 │      │  RAG + Tools      │      │                    │
└─────────────────┘      └──────────────────┘      └────────────────────┘
```

1. **Frontend** — React + TypeScript (Vite). LiveKit WebRTC client with OTP verification, department selection, and interview end screen.
2. **Token Server** — FastAPI on port 8001. Issues LiveKit JWT tokens and checks capacity (max 5 concurrent sessions).
3. **AI Agent** — Python agent using LiveKit Agents SDK. Pipeline: Silero VAD → Deepgram STT → Gemini/OpenAI LLM → Cartesia TTS. Registers tools for RAG search, resume fetching, feedback generation, and summary saving.
4. **HRMS Backend** — External recruitment system. Provides interview token verification, OTP flow, resume file storage, and interview status management.
5. **Resume Parser** — Downloads and parses PDF/DOCX resumes from HRMS for personalized questioning.

---

## Project Structure

```
interview-agent/
├── backend/
│   ├── agent.py               # AI agent: session lifecycle, room monitoring, cleanup
│   ├── token_server.py         # FastAPI token server, capacity management
│   ├── tools.py                # Function tools (RAG, feedback, resume, summary)
│   ├── resume_parser.py        # Resume download + PDF/DOCX parsing + HRMS save
│   ├── rag.py                  # RAG pipeline: loading, chunking, ChromaDB, dedup
│   ├── ingest.py               # CLI script to ingest PDFs into ChromaDB
│   ├── prompts.py              # System prompts with department + resume sections
│   ├── questions.py            # Department-specific interview questions
│   ├── pyproject.toml          # Backend dependencies
│   ├── .env                    # API keys + HRMS config (git-ignored)
│   └── data/
│       ├── project_doc_long.pdf    # Sample project documentation
│       └── chroma_db/              # Persisted vector store
│
├── frontend/
│   ├── src/
│   │   ├── App.tsx             # Main app: verification, OTP, call, end screen
│   │   ├── App.css             # App styles (gradients, layout, transcript)
│   │   ├── index.css           # Global dark theme
│   │   ├── main.tsx            # Entry point
│   │   ├── types.ts            # Shared types (AgentState, TranscriptSegment, etc.)
│   │   ├── .env.example        # Environment variable template
│   │   └── components/
│   │       ├── CallInterface.tsx     # Post-connection UI (video, timer, end button)
│   │       ├── Transcript.tsx        # Live transcription with interim/final handling
│   │       ├── AudioVisualizer.tsx    # Animated bars reflecting agent state
│   │       └── VideoRenderer.tsx      # Video track with placeholder fallback
│   ├── package.json
│   ├── vite.config.ts
│   └── README.md
│
├── DESIGN.md                   # Comprehensive design document
├── pyproject.toml               # Workspace root with "backend" member
└── uv.lock                      # Python dependency lockfile
```

---

## Features

### Interview Flow
- **Interview Link Verification** — Validates interview tokens from HRMS before allowing access
- **OTP Identity Verification** — Optional email OTP flow for identity verification
- **Department-Specific Questions** — 10+ departments with tailored interview questions
- **Resume-Based Personalization** — Fetches candidate's resume mid-interview for personalized follow-up questions
- **Structured Feedback** — AI generates rating (1-10), strengths, and areas for improvement
- **Summary Persistence** — Interview summary saved to HRMS after the session ends
- **Interview Status Tracking** — Automatically marks interviews as "Completed" in HRMS on session end
- **End Interview Screen** — Shows "Interview Complete" message when interview ends

### Voice Pipeline
- **Voice Activity Detection** — Silero VAD with ~500ms silence detection
- **Speech-to-Text** — Deepgram STT for real-time transcription
- **LLM** — Google Gemini or OpenAI-compatible models (configurable)
- **Text-to-Speech** — Cartesia Sonic 3 for natural voice synthesis
- **Turn Detection** — Multilingual model for end-of-turn detection

### RAG System
- **On-Demand Retrieval** — RAG triggered via LLM function calling only when needed
- **ChromaDB Vector Store** — Local, persisted vector database
- **Gemini Embeddings** — Semantic search with text-embedding-004
- **Deduplication** — Content fingerprinting to remove overlap duplicates

---

## Quick Start

### Prerequisites

- Python >= 3.9 and [uv](https://docs.astral.sh/uv)
- Node.js >= 18 and npm
- A [LiveKit](https://livekit.io) cloud project
- API keys for: Deepgram, Cartesia, Google Gemini (or OpenAI)

### Backend Setup

```bash
# Install Python dependencies
uv sync

# Configure API keys — edit backend/.env with your keys
# Required: LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_URL,
#           DEEPGRAM_API_KEY, CARTESIA_API_KEY, GOOGLE_API_KEY (or OPENAI_API_KEY)
# Optional: HRMS_BACKEND_URL (for HRMS integration)

# Start the token server
cd backend && uv run python token_server.py

# Start the AI agent (in a separate terminal)
cd backend && uv run python agent.py

# (Optional) Ingest a new project PDF into ChromaDB
cd backend && uv run python ingest.py
```

### Frontend Setup

```bash
cd frontend
npm install
cp .env.example .env    # Configure backend URLs
npm run dev              # Dev server at http://localhost:5173
```

### Environment Variables

#### Frontend (`frontend/.env`)

| Variable | Default | Description |
|---|---|---|
| `VITE_BACKEND_URL` | `http://localhost:8001` | Token server URL |
| `VITE_HRMS_BACKEND_URL` | `http://localhost:8000` | HRMS backend URL |

#### Backend (`backend/.env`)

| Variable | Default | Description |
|---|---|---|
| `LIVEKIT_API_KEY` | — | LiveKit project API key |
| `LIVEKIT_API_SECRET` | — | LiveKit project API secret |
| `LIVEKIT_URL` | — | LiveKit WebSocket URL |
| `DEEPGRAM_API_KEY` | — | Deepgram API key |
| `CARTESIA_API_KEY` | — | Cartesia API key |
| `GOOGLE_API_KEY` | — | Google AI (Gemini + Embeddings) API key |
| `LLM_PROVIDER` | `google` | LLM provider (`google` or `openai`) |
| `LLM_MODEL` | `gemini-2.0-flash` | Model name (for OpenAI-compatible APIs) |
| `LLM_BASE_URL` | — | Base URL (for OpenAI-compatible APIs like Groq) |
| `LLM_API_KEY` | — | API key (for OpenAI-compatible APIs) |
| `HRMS_BACKEND_URL` | `http://localhost:8000` | HRMS backend URL for resume + summary |

---

## How It Works

### Interview Lifecycle

1. **Link Verification** — Candidate opens an interview link. Frontend verifies the token with HRMS.
2. **OTP Verification** — If required, candidate verifies identity via email OTP.
3. **Room Connection** — Frontend fetches a LiveKit token and connects to the room.
4. **AI Conversation** — Agent greets the candidate and conducts the interview:
   - Asks 2 department-specific predefined questions
   - Calls `fetch_resume()` (if application ID provided) for personalized follow-ups
   - Asks 3-4 resume-based questions
   - Calls `generate_feedback()` to produce structured evaluation
   - Calls `save_interview_summary()` to store data locally
5. **Session End** — Room disconnects. Agent's cleanup flushes the summary to HRMS and marks interview as "Completed".
6. **End Screen** — Frontend shows "Interview Complete — You may close this window."

### Tools

| Tool | Trigger | Purpose |
|---|---|---|
| `search_project_docs(query)` | LLM needs project context | Retrieves relevant chunks via RAG |
| `fetch_resume()` | After predefined questions | Downloads + parses candidate resume |
| `generate_feedback(strengths, areas, rating)` | Interview conclusion | Produces structured feedback |
| `save_interview_summary(rating, strengths, areas)` | After feedback | Stores summary locally (flushed on session end) |

---

## Configuration

### LLM Provider

The agent supports both Google Gemini and OpenAI-compatible providers:

```env
# Google Gemini (default)
LLM_PROVIDER=google
GOOGLE_API_KEY=your-key

# OpenAI-compatible (e.g., Groq)
LLM_PROVIDER=openai
LLM_MODEL=llama-3.3-70b-versatile
LLM_BASE_URL=https://api.groq.com/openai/v1
LLM_API_KEY=your-key
```

### Gemini Model Selection

The agent auto-detects available Gemini models and uses the first available from:
`gemini-2.0-flash, gemini-2.0-flash-lite`

### HRMS Integration

The interview agent integrates with an external HRMS for:

| Feature | HRMS Endpoint | Purpose |
|---|---|---|
| Token Verification | `GET /api/interviews/verify-token` | Validates interview link |
| OTP Send | `POST /api/interviews/send-otp` | Sends verification code |
| OTP Verify | `POST /api/interviews/verify-otp` | Verifies identity |
| Resume File ID | `GET /api/applications/{id}/resume-file-id` | Gets resume file reference |
| Resume Download | `GET /api/applications/resume/{fileId}` | Downloads resume file |
| Save Summary | `POST /api/applications/{id}/ai-interview-summary` | Persists interview results |

---

## Scripts

### Backend

| Command | Description |
|---|---|
| `uv run python token_server.py` | Start FastAPI token server on port 8001 |
| `uv run python agent.py` | Start AI agent (connects to LiveKit) |
| `uv run python ingest.py` | Ingest a PDF into ChromaDB |
| `uv run pytest` | Run Python tests |

### Frontend

| Command | Description |
|---|---|
| `npm run dev` | Start Vite dev server (HMR) at `:5173` |
| `npm run build` | Type-check + production build to `dist/` |
| `npm run preview` | Preview the production build |
| `npm run lint` | Run ESLint on `.ts/.tsx` files |

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Runtime** | Python >= 3.9 + uv |
| **Voice Agent SDK** | LiveKit Agents ~1.3 |
| **Speech-to-Text** | Deepgram |
| **Text-to-Speech** | Cartesia Sonic 3 |
| **Voice Activity Detection** | Silero VAD |
| **LLM** | Google Gemini / OpenAI-compatible |
| **Embeddings** | Google Generative AI (text-embedding-004) |
| **Vector Store** | ChromaDB (local, persisted) |
| **RAG Framework** | LangChain + LangChain Chroma |
| **PDF Parsing** | PyPDF / python-docx |
| **Backend Server** | FastAPI + Uvicorn |
| **Frontend** | React 19 + TypeScript + Vite |
| **WebRTC** | LiveKit Client SDK |
| **Linting** | Ruff (Python) + ESLint (TypeScript) |
| **Testing** | pytest + pytest-asyncio |

---

## Design Document

See [DESIGN.md](./DESIGN.md) for detailed architecture, system flow diagrams, RAG integration details, performance characteristics, security considerations, and deployment recommendations.
