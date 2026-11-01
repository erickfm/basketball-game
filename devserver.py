#!/usr/bin/env python3
"""Local dev server: serves the game and collects shot logs.

    python3 devserver.py [port]      # default 8000

Open http://localhost:<port>/ and play. Every shot is appended as one JSON line
to logs/shots.jsonl. Summarize with `python3 tools/shotlog.py`.
"""
import http.server
import json
import os
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
LOG_DIR = os.path.join(ROOT, "logs")
LOG_FILE = os.path.join(LOG_DIR, "shots.jsonl")


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")  # always load the latest code
        super().end_headers()

    def do_POST(self):
        if self.path.rstrip("/") not in ("/log",):
            self.send_error(404)
            return
        n = int(self.headers.get("Content-Length", 0))
        if n <= 0 or n > 5_000_000:
            self.send_error(400)
            return
        try:
            rec = json.loads(self.rfile.read(n))
        except ValueError:
            self.send_error(400)
            return
        os.makedirs(LOG_DIR, exist_ok=True)
        with open(LOG_FILE, "a") as f:
            f.write(json.dumps(rec, separators=(",", ":")) + "\n")
        self.send_response(204)
        self.end_headers()

    def log_message(self, fmt, *args):
        if self.command == "POST":
            return  # keep the terminal quiet while playing
        super().log_message(fmt, *args)


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"Basketball Game on http://localhost:{port}/  (shot logs -> {LOG_FILE})", flush=True)
    srv.serve_forever()
