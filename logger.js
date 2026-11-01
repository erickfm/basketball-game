// Shot logger: for every shot, records how it was aimed and launched, what the
// player was doing just before, and the ball's actual flight (world position and
// where it was on screen, every frame). Records go to the dev server's /log
// endpoint (see devserver.py) as JSON lines. If no server is listening (e.g. on
// GitHub Pages) they're kept in memory and `save()` downloads them as a file.

const r3 = v => Math.round(v * 1000) / 1000;
const vec = p => [r3(p.x), r3(p.y), r3(p.z)];

export class ShotLogger {
  constructor(endpoint = 'log') {
    this.endpoint = endpoint;
    this.session = new Date().toISOString().replace(/[:.]/g, '-');
    this.mode = 'probing';
    this.buffer = [];        // everything recorded this session (also used for download)
    this.mouse = [];         // [t, dx, dy] for the last second
    this.frames = [];        // [t, dt] for the last two seconds
    this.open = new Set();   // shot records still collecting flight data
    this.count = 0;
    this.send({ type: 'session', session: this.session, ua: navigator.userAgent,
      screen: [innerWidth, innerHeight], dpr: devicePixelRatio }, true);
  }

  send(rec, probe = false) {
    this.buffer.push(rec);
    if (this.mode === 'local') return;
    fetch(this.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(rec), keepalive: true })
      .then(r => { if (probe) this.mode = r.ok ? 'server' : 'local'; })
      .catch(() => { this.mode = 'local'; });
  }

  note(rec) { this.send({ type: 'note', session: this.session, t: Date.now(), ...rec }); }

  onMouse(dx, dy) {
    const now = performance.now();
    this.mouse.push([now, dx, dy]);
    while (this.mouse.length && now - this.mouse[0][0] > 1000) this.mouse.shift();
  }

  onFrame(dt) {
    const now = performance.now();
    this.frames.push([now, dt]);
    while (this.frames.length && now - this.frames[0][0] > 2000) this.frames.shift();
  }

  // Call right after a shot is launched. `ctx` holds plain numbers/vectors.
  startShot(ball, ctx) {
    const now = performance.now();
    const dts = this.frames.map(f => f[1] * 1000);
    const rec = {
      type: 'shot', session: this.session, id: ++this.count, t: Date.now(),
      player: { p: vec(ctx.player.p), v: vec(ctx.player.v), onGround: ctx.player.onGround },
      view: { yawDeg: r3(ctx.yaw * 180 / Math.PI), pitchDeg: r3(ctx.pitch * 180 / Math.PI), fov: r3(ctx.fov), zoom: r3(ctx.zoom) },
      aim: { kind: ctx.target.kind, target: vec(ctx.target), fromRim: vec({ x: ctx.target.x - ctx.rim.x, y: ctx.target.y - ctx.rim.y, z: ctx.target.z - ctx.rim.z }), distToRim: r3(ctx.dist) },
      release: { p: vec(ctx.p0), v: vec(ctx.v), speed: r3(ctx.speed), elevDeg: r3(ctx.elevDeg), spin: vec(ctx.w) },
      before: {
        // mouse deltas (ms before the click, dx, dy) for the last 600 ms
        mouse: this.mouse.filter(m => now - m[0] < 600).map(m => [Math.round(m[0] - now), m[1], m[2]]),
        frameMs: dts.length ? { mean: r3(dts.reduce((a, b) => a + b, 0) / dts.length), max: r3(Math.max(...dts)), n: dts.length } : null,
      },
      // per frame: [ms since release, x, y, z, ndcX, ndcY, onScreen, camYawDeg, camPitchDeg]
      path: [],
      events: [],
      result: null,
    };
    rec._t0 = now; rec._ball = ball;
    ball.log = rec;
    this.open.add(rec);
    return rec;
  }

  event(ball, ev) {
    const rec = ball.log; if (!rec || !this.open.has(rec)) return;
    rec.events.push({ ms: Math.round(performance.now() - rec._t0), ...ev, p: vec(ball.p), v: vec(ball.v) });
  }

  result(ball, res) { if (ball.log) ball.log.result = res; }

  // Once per rendered frame, after the camera is positioned.
  sample(camera, tmp, yaw, pitch) {
    const now = performance.now();
    for (const rec of this.open) {
      const b = rec._ball, ms = now - rec._t0;
      tmp.set(b.p.x, b.p.y, b.p.z).project(camera);
      const on = tmp.z < 1 && Math.abs(tmp.x) <= 1 && Math.abs(tmp.y) <= 1;
      rec.path.push([Math.round(ms), r3(b.p.x), r3(b.p.y), r3(b.p.z), r3(tmp.x), r3(tmp.y), on ? 1 : 0,
        r3(yaw * 180 / Math.PI), r3(pitch * 180 / Math.PI)]);
      if (ms > 4000 || b.removed) this.finish(rec);
    }
  }

  finish(rec) {
    this.open.delete(rec);
    delete rec._ball; delete rec._t0;
    this.send(rec);
  }

  save() {
    const blob = new Blob([this.buffer.map(r => JSON.stringify(r)).join('\n') + '\n'], { type: 'application/x-ndjson' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `shots-${this.session}.jsonl`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
}
