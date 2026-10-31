// Ball physics for Basketball Game. No rendering dependencies, so it can be
// tested headless in Node. Units are SI: meters, seconds, rad/s.
//
// Model:
//  - Gravity, quadratic air drag, and Magnus lift from spin.
//  - The ball is a hollow-ish sphere (I = 2/3 m r^2). Every contact is an
//    impulse with restitution plus Coulomb friction acting at the contact
//    point, so spin and linear velocity trade off on every bounce: backspin
//    kills speed off the rim/board, topspin skids forward on the floor.
//  - The rim is a true torus, the backboard/bracket/arm are boxes, the pole
//    is a cylinder.
//  - The net is a verlet cloth that the ball pushes and that drags the ball.

export const G = 9.81;
export const BALL_R = 0.12;
const K_I = 2 / 3;                       // inertia factor: I = K_I m r^2
const MASS = 0.62, RHO = 1.2, CD = 0.5, AREA = Math.PI * BALL_R * BALL_R;
const DRAG = 0.5 * RHO * CD * AREA / MASS;           // a = -DRAG |v| v
const MAGNUS = 0.5 * RHO * AREA * BALL_R / MASS;     // a = MAGNUS (w x v)
const SPIN_DECAY = 0.08;                              // 1/s, in air

// Regulation-ish dimensions. Rim center sits over the floor origin; the
// shooter faces -z.
export const RIM = { x: 0, y: 3.05, z: 0, R: 0.237, tube: 0.009 };
export const BOARD = { min: { x: -0.915, y: 2.90, z: -0.43 }, max: { x: 0.915, y: 3.97, z: -0.38 } };
export const BRACKET = { min: { x: -0.09, y: 2.98, z: -0.38 }, max: { x: 0.09, y: 3.04, z: -0.25 } };
export const ARM = { min: { x: -0.08, y: 3.28, z: -1.9 }, max: { x: 0.08, y: 3.42, z: -0.43 } };
export const POLE = { x: 0, z: -1.9, r: 0.14, h: 3.42 };
export const GYM = { xmin: -11, xmax: 11, zmin: -5, zmax: 17, ceil: 10 };
export const THREE_PT = 6.75, CORNER_X = 6.6, CORNER_Z = Math.sqrt(6.75 ** 2 - 6.6 ** 2);

const MAT = {
  floor: { e: 0.86, mu: 0.6 },
  rim:   { e: 0.6,  mu: 0.3 },
  board: { e: 0.72, mu: 0.35 },
  steel: { e: 0.5,  mu: 0.3 },
  wall:  { e: 0.6,  mu: 0.4 },
};

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export function makeBall(p, v, w) {
  return {
    p: { ...p }, v: { ...v }, w: { ...w },
    prevY: p.y, onFloor: false,
    passedTop: false, wasAbove: false, invalid: false, scored: false,
    age: 0, shot: null,
  };
}

function airAccel(v, w, out) {
  const s = Math.hypot(v.x, v.y, v.z);
  out.x = -DRAG * s * v.x + MAGNUS * (w.y * v.z - w.z * v.y);
  out.y = -DRAG * s * v.y + MAGNUS * (w.z * v.x - w.x * v.z) - G;
  out.z = -DRAG * s * v.z + MAGNUS * (w.x * v.y - w.y * v.x);
  return out;
}

// Flight-only integration (no collisions), used for the trajectory trainer.
export function simulateFlight(p0, v0, w0, maxT = 3, dt = 1 / 120) {
  const p = { ...p0 }, v = { ...v0 }, w = { ...w0 }, a = {}, pts = [];
  for (let t = 0; t < maxT && p.y > BALL_R; t += dt) {
    airAccel(v, w, a);
    v.x += a.x * dt; v.y += a.y * dt; v.z += a.z * dt;
    p.x += v.x * dt; p.y += v.y * dt; p.z += v.z * dt;
    const k = Math.exp(-SPIN_DECAY * dt); w.x *= k; w.y *= k; w.z *= k;
    pts.push({ ...p });
  }
  return pts;
}

// ---------- net (verlet cloth) ----------
const NET_COLS = 12, NET_ROWS = 6, NET_DEPTH = 0.45, NET_BOTTOM_R = 0.15;

function makeNet() {
  const pts = [], links = [];
  const step = (Math.PI * 2) / NET_COLS;
  for (let r = 0; r < NET_ROWS; r++) {
    const f = r / (NET_ROWS - 1);
    const rad = RIM.R + (NET_BOTTOM_R - RIM.R) * f;
    const y = RIM.y - NET_DEPTH * f;
    for (let c = 0; c < NET_COLS; c++) {
      const a = (c + 0.5 * (r % 2)) * step;
      const p = { x: RIM.x + Math.cos(a) * rad, y, z: RIM.z + Math.sin(a) * rad };
      pts.push({ p, q: { ...p }, pinned: r === 0 });
    }
  }
  const idx = (r, c) => r * NET_COLS + ((c + NET_COLS) % NET_COLS);
  const link = (i, j) => {
    const a = pts[i].p, b = pts[j].p;
    links.push([i, j, Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)]);
  };
  for (let r = 0; r < NET_ROWS - 1; r++) {
    for (let c = 0; c < NET_COLS; c++) {
      link(idx(r, c), idx(r + 1, c));
      link(idx(r, c), idx(r + 1, r % 2 ? c + 1 : c - 1));
    }
  }
  // Bottom ring keeps the opening from collapsing completely.
  for (let c = 0; c < NET_COLS; c++) link(idx(NET_ROWS - 1, c), idx(NET_ROWS - 1, c + 1));
  return { pts, links };
}

function stepNet(net, balls, h) {
  const g = G * h * h;
  for (const n of net.pts) {
    if (n.pinned) continue;
    const vx = (n.p.x - n.q.x) * 0.985, vy = (n.p.y - n.q.y) * 0.985, vz = (n.p.z - n.q.z) * 0.985;
    n.q.x = n.p.x; n.q.y = n.p.y; n.q.z = n.p.z;
    n.p.x += vx; n.p.y += vy - g; n.p.z += vz;
  }
  // Ball <-> net: push net threads out of the ball, drag the ball.
  const touchR = BALL_R + 0.012;
  for (const b of balls) {
    if (Math.abs(b.p.y - (RIM.y - NET_DEPTH / 2)) > 0.6) continue;
    if (Math.hypot(b.p.x - RIM.x, b.p.z - RIM.z) > RIM.R + 0.3) continue;
    let touching = 0;
    for (const n of net.pts) {
      if (n.pinned) continue;
      const dx = n.p.x - b.p.x, dy = n.p.y - b.p.y, dz = n.p.z - b.p.z;
      const d = Math.hypot(dx, dy, dz);
      if (d >= touchR || d < 1e-9) continue;
      const pvx = (n.p.x - n.q.x) / h, pvy = (n.p.y - n.q.y) / h, pvz = (n.p.z - n.q.z) / h;
      const s = touchR / d;
      n.p.x = b.p.x + dx * s; n.p.y = b.p.y + dy * s; n.p.z = b.p.z + dz * s;
      const k = 0.35 * h;
      b.v.x -= (b.v.x - pvx) * k; b.v.y -= (b.v.y - pvy) * k; b.v.z -= (b.v.z - pvz) * k;
      touching++;
    }
    if (touching) b.netTouch = (b.netTouch || 0) + touching;
  }
  for (let it = 0; it < 6; it++) {
    for (const [i, j, rest] of net.links) {
      const A = net.pts[i], B = net.pts[j];
      const dx = B.p.x - A.p.x, dy = B.p.y - A.p.y, dz = B.p.z - A.p.z;
      const d = Math.hypot(dx, dy, dz) || 1e-9;
      if (d <= rest) continue;                     // threads go slack, never push
      const diff = (d - rest) / d;
      const wa = A.pinned ? 0 : B.pinned ? 1 : 0.5, wb = 1 - wa - (A.pinned && B.pinned ? 1 : 0);
      A.p.x += dx * diff * wa; A.p.y += dy * diff * wa; A.p.z += dz * diff * wa;
      B.p.x -= dx * diff * wb; B.p.y -= dy * diff * wb; B.p.z -= dz * diff * wb;
    }
  }
}

// ---------- world ----------
export class World {
  constructor() {
    this.balls = [];
    this.net = makeNet();
    this.handlers = [];
    this._a = {};
  }
  on(fn) { this.handlers.push(fn); }
  emit(type, ball, data) { for (const fn of this.handlers) fn(type, ball, data); }

  // Impulse contact with restitution and friction at the contact point.
  contact(b, nx, ny, nz, pen, mat, kind) {
    b.p.x += nx * pen; b.p.y += ny * pen; b.p.z += nz * pen;
    if (kind === 'floor') b.onFloor = true;
    const rcx = -BALL_R * nx, rcy = -BALL_R * ny, rcz = -BALL_R * nz;
    const vcx = b.v.x + (b.w.y * rcz - b.w.z * rcy);
    const vcy = b.v.y + (b.w.z * rcx - b.w.x * rcz);
    const vcz = b.v.z + (b.w.x * rcy - b.w.y * rcx);
    const vn = vcx * nx + vcy * ny + vcz * nz;
    if (vn >= 0) return;
    const e = -vn < 0.3 ? 0 : mat.e;                // resting contact doesn't jitter
    const jn = -(1 + e) * vn;                       // impulse per unit mass
    b.v.x += nx * jn; b.v.y += ny * jn; b.v.z += nz * jn;
    const vtx = vcx - nx * vn, vty = vcy - ny * vn, vtz = vcz - nz * vn;
    const vtl = Math.hypot(vtx, vty, vtz);
    if (vtl > 1e-7) {
      // Enough friction to stop slipping, capped by Coulomb limit.
      const jt = Math.min(mat.mu * jn, vtl * K_I / (1 + K_I));
      const tx = -vtx / vtl * jt, ty = -vty / vtl * jt, tz = -vtz / vtl * jt;
      b.v.x += tx; b.v.y += ty; b.v.z += tz;
      const inv = 1 / (K_I * BALL_R * BALL_R);
      b.w.x += (rcy * tz - rcz * ty) * inv;
      b.w.y += (rcz * tx - rcx * tz) * inv;
      b.w.z += (rcx * ty - rcy * tx) * inv;
    }
    if (-vn > 0.25) this.emit('hit', b, { kind, speed: -vn });
  }

  plane(b, nx, ny, nz, d, mat, kind) {
    const dist = b.p.x * nx + b.p.y * ny + b.p.z * nz - d;
    if (dist < BALL_R) this.contact(b, nx, ny, nz, BALL_R - dist, mat, kind);
  }

  box(b, bx, mat, kind) {
    const cx = clamp(b.p.x, bx.min.x, bx.max.x);
    const cy = clamp(b.p.y, bx.min.y, bx.max.y);
    const cz = clamp(b.p.z, bx.min.z, bx.max.z);
    let dx = b.p.x - cx, dy = b.p.y - cy, dz = b.p.z - cz;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 >= BALL_R * BALL_R) return;
    if (d2 < 1e-12) {
      // Center is inside the box: push out through the nearest face.
      const faces = [
        [b.p.x - bx.min.x, -1, 0, 0], [bx.max.x - b.p.x, 1, 0, 0],
        [b.p.y - bx.min.y, 0, -1, 0], [bx.max.y - b.p.y, 0, 1, 0],
        [b.p.z - bx.min.z, 0, 0, -1], [bx.max.z - b.p.z, 0, 0, 1],
      ].sort((a, c) => a[0] - c[0]);
      const [f, x, y, z] = faces[0];
      this.contact(b, x, y, z, f + BALL_R, mat, kind);
      return;
    }
    const d = Math.sqrt(d2);
    this.contact(b, dx / d, dy / d, dz / d, BALL_R - d, mat, kind);
  }

  rim(b) {
    const reach = BALL_R + RIM.tube;
    if (Math.abs(b.p.y - RIM.y) > reach) return;
    const dx = b.p.x - RIM.x, dz = b.p.z - RIM.z;
    const hd = Math.hypot(dx, dz);
    if (Math.abs(hd - RIM.R) > reach) return;
    const qx = hd > 1e-9 ? RIM.x + dx / hd * RIM.R : RIM.x + RIM.R;
    const qz = hd > 1e-9 ? RIM.z + dz / hd * RIM.R : RIM.z;
    const nx = b.p.x - qx, ny = b.p.y - RIM.y, nz = b.p.z - qz;
    const d = Math.hypot(nx, ny, nz);
    if (d < reach && d > 1e-9) this.contact(b, nx / d, ny / d, nz / d, reach - d, MAT.rim, 'rim');
  }

  pole(b) {
    if (b.p.y > POLE.h) return;
    const dx = b.p.x - POLE.x, dz = b.p.z - POLE.z, d = Math.hypot(dx, dz);
    const reach = POLE.r + BALL_R;
    if (d < reach && d > 1e-9) this.contact(b, dx / d, 0, dz / d, reach - d, MAT.steel, 'pole');
  }

  step(h) {
    const a = this._a;
    for (const b of this.balls) {
      b.age += h;
      b.onFloor = false;
      airAccel(b.v, b.w, a);
      b.v.x += a.x * h; b.v.y += a.y * h; b.v.z += a.z * h;
      b.p.x += b.v.x * h; b.p.y += b.v.y * h; b.p.z += b.v.z * h;
      const k = Math.exp(-SPIN_DECAY * h); b.w.x *= k; b.w.y *= k; b.w.z *= k;

      this.rim(b);
      this.box(b, BOARD, MAT.board, 'board');
      this.box(b, BRACKET, MAT.steel, 'bracket');
      this.box(b, ARM, MAT.steel, 'pole');
      this.pole(b);
      this.plane(b, 0, 1, 0, 0, MAT.floor, 'floor');
      this.plane(b, 0, -1, 0, -GYM.ceil, MAT.wall, 'wall');
      this.plane(b, 1, 0, 0, GYM.xmin, MAT.wall, 'wall');
      this.plane(b, -1, 0, 0, -GYM.xmax, MAT.wall, 'wall');
      this.plane(b, 0, 0, 1, GYM.zmin, MAT.wall, 'wall');
      this.plane(b, 0, 0, -1, -GYM.zmax, MAT.wall, 'wall');

      if (b.onFloor) {                            // rolling resistance
        const r = 1 - 0.3 * h;
        b.v.x *= r; b.v.z *= r; b.w.x *= r; b.w.y *= r; b.w.z *= r;
      }
    }

    // Ball <-> ball
    for (let i = 0; i < this.balls.length; i++) {
      for (let j = i + 1; j < this.balls.length; j++) {
        const A = this.balls[i], B = this.balls[j];
        const dx = A.p.x - B.p.x, dy = A.p.y - B.p.y, dz = A.p.z - B.p.z;
        const d = Math.hypot(dx, dy, dz);
        if (d >= 2 * BALL_R || d < 1e-9) continue;
        const nx = dx / d, ny = dy / d, nz = dz / d, pen = (2 * BALL_R - d) / 2;
        A.p.x += nx * pen; A.p.y += ny * pen; A.p.z += nz * pen;
        B.p.x -= nx * pen; B.p.y -= ny * pen; B.p.z -= nz * pen;
        const vn = (A.v.x - B.v.x) * nx + (A.v.y - B.v.y) * ny + (A.v.z - B.v.z) * nz;
        if (vn >= 0) continue;
        const j2 = -(1 + 0.85) * vn / 2;
        A.v.x += nx * j2; A.v.y += ny * j2; A.v.z += nz * j2;
        B.v.x -= nx * j2; B.v.y -= ny * j2; B.v.z -= nz * j2;
        if (-vn > 0.4) this.emit('hit', A, { kind: 'ball', speed: -vn });
      }
    }

    stepNet(this.net, this.balls, h);

    // Scoring: center must drop through the ring from above, then clear it.
    for (const b of this.balls) {
      const hd = Math.hypot(b.p.x - RIM.x, b.p.z - RIM.z);
      if (b.p.y > RIM.y + 0.2) b.wasAbove = true;
      if (b.prevY >= RIM.y && b.p.y < RIM.y) {
        if (hd < RIM.R - RIM.tube) b.passedTop = true;
        if (hd < 1.0) this.emit('cross', b, { entry: Math.atan2(-b.v.y, Math.hypot(b.v.x, b.v.z)) });
      } else if (b.prevY < RIM.y && b.p.y >= RIM.y && hd < RIM.R) {
        b.passedTop = false;
        if (!b.wasAbove) b.invalid = true;          // came up from under the hoop
      }
      if (b.passedTop && !b.scored && b.p.y < RIM.y - 0.3) {
        if (hd < RIM.R + 0.15 && !b.invalid) { b.scored = true; this.emit('score', b); }
        b.passedTop = false;
      }
      b.prevY = b.p.y;
    }
  }
}
