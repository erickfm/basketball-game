#!/usr/bin/env python3
"""Summarize shot logs written by devserver.py.

    python3 tools/shotlog.py                 # all shots in logs/shots.jsonl
    python3 tools/shotlog.py --last 10       # most recent 10
    python3 tools/shotlog.py --shot 7        # one shot in detail (flight, screen path, events)
    python3 tools/shotlog.py path/to/file.jsonl

Screen coordinates are NDC: x,y in [-1, 1], (0,0) is the crosshair, y=+1 is the top edge.
"""
import argparse
import json
import math
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def load(path):
    shots, notes = [], []
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            r = json.loads(line)
            (shots if r.get("type") == "shot" else notes).append(r)
    return shots, notes


def flight(s):
    # Screen metrics only cover the shot itself: release until it reaches the rim
    # plane or first touches something.
    end = next((e["ms"] for e in s["events"] if e["type"] in ("cross", "score", "hit")), None)
    p = [r for r in s["path"] if end is None or r[0] <= end]
    if not p:
        return {}
    apex = max(p, key=lambda r: r[2])
    on = [r for r in p if r[6]]
    off = [r for r in p if not r[6]]
    first_off = off[0][0] if off else None
    back_on = next((r[0] for r in p if r[6] and first_off is not None and r[0] > first_off), None)
    top = max(p, key=lambda r: r[5])
    pitch0 = p[0][8]
    return {
        "apex_h": apex[2], "apex_ms": apex[0],
        "top_ndc_y": top[5], "top_ms": top[0],
        "on_frac": len(on) / len(p),
        "off_ms": (back_on or p[-1][0]) - first_off if first_off is not None else 0,
        "max_abs_x": max(abs(r[4]) for r in p),
        "pitch_change": max(abs(r[8] - pitch0) for r in p),
        "frames": len(p),
    }


def summary(s):
    f = flight(s)
    ev = s["events"]
    contacts = [e["kind"] for e in ev if e["type"] == "hit"]
    first = []
    for c in contacts:
        if c not in first:
            first.append(c)
    entry = next((e["entryDeg"] for e in ev if e["type"] == "cross"), None)
    rim_ms = next((e["ms"] for e in ev if e["type"] in ("cross", "score")), None)
    pl, rel, view, aim = s["player"], s["release"], s["view"], s["aim"]
    hspeed = math.hypot(pl["v"][0], pl["v"][2])
    mouse = s["before"]["mouse"]
    late = [m for m in mouse if m[0] > -100]
    mouse_px = sum(math.hypot(m[1], m[2]) for m in late)
    fm = s["before"].get("frameMs") or {}
    eye = [pl["p"][0], pl["p"][1] + 1.75, pl["p"][2]]
    lines = [
        f"#{s['id']:<3} {s.get('result') or '?':8} {aim['distToRim']:5.2f} m  aim={aim['kind']:<9} "
        f"off-rim=({aim['fromRim'][0]:+.2f},{aim['fromRim'][1]:+.2f},{aim['fromRim'][2]:+.2f})",
        f"     view pitch {view['pitchDeg']:+.1f}°  fov {view['fov']:.0f}{' zoom' if view['zoom'] > 0.5 else ''}  "
        f"{'ground' if pl['onGround'] else 'AIR'}  moving {hspeed:.1f} m/s  mouse in last 100ms {mouse_px:.0f}px",
        f"     launch {rel['speed']:.2f} m/s @ {rel['elevDeg']:.1f}°  from {rel['p'][1] - eye[1]:+.2f} m vs eye  "
        f"apex {f.get('apex_h', 0):.2f} m @ {f.get('apex_ms', 0)} ms  rim-plane @ {rim_ms} ms  entry {entry}°",
        f"     screen: top y={f.get('top_ndc_y', 0):+.2f} @ {f.get('top_ms', 0)} ms  on-screen {100 * f.get('on_frac', 0):.0f}%  "
        f"off-screen {f.get('off_ms', 0)} ms  max |x| {f.get('max_abs_x', 0):.2f}  cam pitch moved {f.get('pitch_change', 0):.1f}°",
        f"     contacts: {' > '.join(first) or 'none'}   frames {fm.get('mean', 0):.1f} ms avg / {fm.get('max', 0):.1f} max",
    ]
    return "\n".join(lines)


def detail(s):
    print(summary(s))
    print("\n  events:")
    for e in s["events"]:
        extra = {k: v for k, v in e.items() if k not in ("ms", "type", "p", "v")}
        print(f"    {e['ms']:5d} ms  {e['type']:<6} {extra}  p={e['p']}  v={e['v']}")
    print("\n  mouse before click (ms, dx, dy):", s["before"]["mouse"][-20:])
    print("\n  flight (every ~50 ms):  ms     x      y      z    ndcX   ndcY  on  pitch")
    last = -999
    for r in s["path"]:
        if r[0] - last >= 50:
            last = r[0]
            print(f"    {r[0]:5d} {r[1]:6.2f} {r[2]:6.2f} {r[3]:6.2f}  {r[4]:+.2f}  {r[5]:+.2f}  {r[6]}  {r[8]:+.1f}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("file", nargs="?", default=os.path.join(ROOT, "logs", "shots.jsonl"))
    ap.add_argument("--last", type=int)
    ap.add_argument("--shot", type=int, help="shot id (within the latest session that has it)")
    a = ap.parse_args()
    if not os.path.exists(a.file):
        sys.exit(f"no log at {a.file} - run devserver.py and take some shots")
    shots, notes = load(a.file)
    if a.shot is not None:
        match = [s for s in shots if s["id"] == a.shot]
        if not match:
            sys.exit(f"no shot #{a.shot}")
        detail(match[-1])
        return
    if notes:
        raw = [n.get("rawMouse") for n in notes if "rawMouse" in n]
        if raw:
            print(f"raw mouse input: {raw[-1]}")
    sel = shots[-a.last:] if a.last else shots
    for s in sel:
        print(summary(s))
    if sel:
        res = [s.get("result") for s in sel]
        made = sum(r in ("make", "swish", "bank") for r in res)
        print(f"\n{len(sel)} shots, {made} made, {sum(r == 'swish' for r in res)} swish, "
              f"{sum(r == 'airball' for r in res)} airball")


if __name__ == "__main__":
    main()
