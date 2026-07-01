import subprocess
import sys
import os
import signal

proc1 = None
proc2 = None


def cleanup():
    for p in (proc1, proc2):
        if p and p.poll() is None:
            p.terminate()
            try:
                p.wait(timeout=5)
            except subprocess.TimeoutExpired:
                p.kill()


if __name__ == "__main__":
    os.chdir(os.path.dirname(os.path.abspath(__file__)))

    host = os.getenv("HOST", "0.0.0.0")
    port = os.getenv("PORT", "8001")

    try:
        proc1 = subprocess.Popen(
            [sys.executable, "-m", "uvicorn", "token_server:app", "--host", host, "--port", port]
        )
        proc2 = subprocess.Popen([sys.executable, "agent.py", "dev"])

        proc1.wait()
        proc2.wait()
    except KeyboardInterrupt:
        cleanup()
    except Exception:
        cleanup()
        raise
