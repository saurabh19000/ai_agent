import os
import asyncio
import threading
import uvicorn

# pyrefly: ignore [missing-import]
from token_server import app


def start_agent():
    # pyrefly: ignore [missing-import]
    from agent import server
    asyncio.run(server.run())


if __name__ == "__main__":
    agent_thread = threading.Thread(target=start_agent, daemon=True)
    agent_thread.start()

    port = int(os.getenv("PORT", 8001))
    host = os.getenv("HOST", "0.0.0.0")
    uvicorn.run("token_server:app", host=host, port=port, reload=False)
