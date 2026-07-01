import os
import asyncio
import threading
import uvicorn

from agent import server


def start_agent():
    asyncio.run(server.run())


if __name__ == "__main__":
    agent_thread = threading.Thread(target=start_agent, daemon=True)
    agent_thread.start()

    port = int(os.getenv("PORT", 8001))
    host = os.getenv("HOST", "0.0.0.0")
    uvicorn.run("token_server:app", host=host, port=port, reload=False)
