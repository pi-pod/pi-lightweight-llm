"""Optional Linux/macOS PTY smoke test: python3 test/cli-smoke.py (no model calls)."""
import fcntl
import hashlib
import json
import os
import pty
import re
import select
import struct
import subprocess
import tempfile
import termios
import time
from pathlib import Path

with tempfile.TemporaryDirectory() as directory:
    master, slave = pty.openpty()
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 35, 110, 0, 0))
    env = dict(os.environ, PI_CODING_AGENT_DIR=directory, PI_OFFLINE="1", TERM="xterm-256color")
    entry = str(Path(__file__).resolve().parents[1] / "src/index.ts")
    encode = lambda value: json.dumps(value, separators=(",", ":"))
    tool_input = encode({"tool": "bash", "arguments": encode({"command": "echo raw-output"}),
                         "isError": False, "output": "raw-output"})
    key = hashlib.sha256(("call-a\0" + tool_input).encode()).hexdigest()
    usage = dict(input=0, output=0, cacheRead=0, cacheWrite=0, totalTokens=0,
                 cost=dict(input=0, output=0, cacheRead=0, cacheWrite=0, total=0))
    records = [
        {"type": "session", "version": 3, "id": "smoke", "timestamp": "2026-01-01T00:00:00Z", "cwd": os.getcwd()},
        {"type": "message", "id": "a", "parentId": None, "message": {"role": "user", "content": "Run echo", "timestamp": 0}},
        {"type": "message", "id": "b", "parentId": "a", "message": {"role": "assistant", "content": [
            {"type": "toolCall", "id": "call-a", "name": "bash", "arguments": {"command": "echo raw-output"}}],
            "api": "openai-completions", "provider": "test", "model": "test", "usage": usage, "stopReason": "toolUse", "timestamp": 0}},
        {"type": "message", "id": "c", "parentId": "b", "message": {"role": "toolResult", "toolCallId": "call-a",
            "toolName": "bash", "content": [{"type": "text", "text": "raw-output"}], "isError": False, "timestamp": 0}},
        {"type": "custom", "id": "d", "parentId": "c", "customType": "lightweight-tasks.tool-summary.v1",
            "data": {"key": key, "text": "Cached summary smoke marker"}},
    ]
    for record in records:
        record.setdefault("timestamp", "2026-01-01T00:00:00Z")
    session = Path(directory) / "fixtures" / "session.jsonl"
    session.parent.mkdir()
    session.write_text("\n".join(encode(record) for record in records) + "\n")
    (Path(directory) / "settings.json").write_text(encode({"lightweightLlm": {
        "provider": "test", "model": "test", "thinkingLevel": "off"}}))
    process = subprocess.Popen(["pi", "--offline", "--session", str(session), "-e", entry],
                               stdin=slave, stdout=slave, stderr=slave, env=env)
    os.close(slave)
    output = bytearray()

    def drain(seconds):
        until = time.time() + seconds
        while time.time() < until:
            if select.select([master], [], [], .1)[0]:
                try:
                    output.extend(os.read(master, 65536))
                except OSError:
                    break

    try:
        drain(5)
        for _ in range(3):
            os.write(master, b"\x0f")
            drain(.8)
        os.write(master, b"/reload\r")
        drain(3)
        os.write(master, b"\x0f")
        drain(.8)
        os.write(master, b"\x03")
        drain(.2)
        os.write(master, b"\x03")
        drain(1)
    finally:
        if process.poll() is None:
            process.terminate()
        process.wait(timeout=5)
        os.close(master)

    text = re.sub(r"\x1b\[[0-?]*[ -/]*[@-~]", "", output.decode(errors="replace"))
    modes = re.findall(r"transcript: (compact|verbose|summary)", text)
    changes = [mode for i, mode in enumerate(modes) if i == 0 or modes[i - 1] != mode]
    errors = [line for line in text.splitlines() if any(error in line for error in
              ["Failed to load", "TypeError", "ReferenceError", "Unsupported pi", "conflicts with built-in", "already installed"])]
    if (errors or changes[:4] != ["compact", "verbose", "summary", "compact"]
            or changes[-1:] != ["verbose"] or "Cached summary smoke marker" not in text):
        print(text[-20000:])
        raise AssertionError((changes, errors))
    print("CLI cycle and reload passed:", " -> ".join(changes))
