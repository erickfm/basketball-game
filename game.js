import * as THREE from 'three';
import {
  World, makeBall, solveShot, BALL_R, RIM, BOARD, BRACKET, ARM, POLE, GYM,
  THREE_PT, CORNER_X, CORNER_Z,
} from './physics.js';

// ---------- tuning ----------
const PHYS_DT = 1 / 240;
const EYE = 1.75;
const MOVE = 5.2, GROUND_ACCEL = 22, AIR_ACCEL = 1.5;
const JUMP_V = 4.6, PLAYER_G = 16, HANG_V = 1.3, HANG_G = 8;   // softer gravity near the apex = hang time
const CARRY_H = 0.5, CARRY_V = 0.35;     // how much body velocity ends up in the ball
const SPREAD = 0.3, FOCUS_SPREAD = 0.12; // degrees, 1 sigma, perfect release standing still
const SPIN = 2.5;                        // backspin rev/s on a clean release
const FOV = 75, FOCUS_FOV = 60, SENS = 0.0022;
const MAX_LOOSE = 6;

// ---------- renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x15171c);
const camera = new THREE.PerspectiveCamera(FOV, innerWidth / innerHeight, 0.03, 120);
camera.rotation.order = 'YXZ';
scene.add(camera);
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

scene.add(new THREE.HemisphereLight(0xfff4e0, 0x6a5840, 1.1), new THREE.AmbientLight(0xffffff, 0.35));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(3, 14, 6); sun.target.position.set(0, 0, 4);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12, near: 1, far: 40 });
sun.shadow.bias = -0.0005;
scene.add(sun, sun.target);
const maxAniso = renderer.capabilities.getMaxAnisotropy();

// ---------- court ----------
function courtTexture() {
  const W = GYM.xmax - GYM.xmin, D = GYM.zmax - GYM.zmin, ppm = 80;
  const c = document.createElement('canvas'); c.width = W * ppm; c.height = D * ppm;
  const g = c.getContext('2d');
  const X = x => (x - GYM.xmin) * ppm, Z = z => (z - GYM.zmin) * ppm;
  const plank = 0.08 * ppm;
  for (let i = 0; i * plank < c.width; i++) {
    g.fillStyle = `hsl(32, 48%, ${52 + Math.random() * 10}%)`; g.fillRect(i * plank, 0, plank, c.height);
    g.fillStyle = 'rgba(60,35,10,0.25)'; g.fillRect(i * plank, 0, 1, c.height);
    for (let y = Math.random() * 300; y < c.height; y += 150 + Math.random() * 300) g.fillRect(i * plank, y, plank, 1);
  }
  for (let i = 0; i < 30000; i++) {
    g.fillStyle = `rgba(${Math.random() < .5 ? '255,240,220' : '70,40,15'},0.05)`;
    g.fillRect(Math.random() * c.width, Math.random() * c.height, 2 + Math.random() * 10, 1);
  }
  const base = -1.575, ft = base + 5.8, half = base + 14;
  g.fillStyle = 'rgba(160,40,30,0.75)'; g.fillRect(X(-2.45), Z(base), 4.9 * ppm, (ft - base) * ppm);
  g.strokeStyle = '#f7f3ea'; g.lineWidth = 0.05 * ppm;
  g.strokeRect(X(-7.5), Z(base), 15 * ppm, (half - base) * ppm);
  g.strokeRect(X(-2.45), Z(base), 4.9 * ppm, (ft - base) * ppm);
  g.beginPath(); g.arc(X(0), Z(ft), 1.8 * ppm, 0, Math.PI); g.stroke();
  g.setLineDash([0.3 * ppm, 0.25 * ppm]); g.beginPath(); g.arc(X(0), Z(ft), 1.8 * ppm, Math.PI, Math.PI * 2); g.stroke(); g.setLineDash([]);
  g.beginPath(); g.arc(X(0), Z(0), 1.25 * ppm, 0, Math.PI); g.stroke();
  const a0 = Math.atan2(CORNER_Z, CORNER_X);
  g.beginPath(); g.moveTo(X(-CORNER_X), Z(base)); g.lineTo(X(-CORNER_X), Z(CORNER_Z));
  g.arc(X(0), Z(0), THREE_PT * ppm, Math.PI - a0, a0, true); g.lineTo(X(CORNER_X), Z(base)); g.stroke();
  g.beginPath(); g.arc(X(0), Z(half), 1.8 * ppm, Math.PI, Math.PI * 2); g.stroke();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = maxAniso;
  return t;
}
{
  const W = GYM.xmax - GYM.xmin, D = GYM.zmax - GYM.zmin;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D),
    new THREE.MeshStandardMaterial({ map: courtTexture(), roughness: 0.45 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set((GYM.xmin + GYM.xmax) / 2, 0, (GYM.zmin + GYM.zmax) / 2);
  floor.receiveShadow = true;
  scene.add(floor);
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x6b7690, roughness: 0.9 });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0x8a2a20, roughness: 0.8 });
  const wall = (w, h, x, y, z, ry) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), wallMat);
    m.position.set(x, y, z); m.rotation.y = ry; scene.add(m);
    const t = new THREE.Mesh(new THREE.PlaneGeometry(w, 1.2), trimMat);
    t.position.set(x, 0.6, z); t.rotation.y = ry; t.translateZ(0.01); scene.add(t);
  };
  const cx = (GYM.xmin + GYM.xmax) / 2, cz = (GYM.zmin + GYM.zmax) / 2, hgt = GYM.ceil;
  wall(W, hgt, cx, hgt / 2, GYM.zmin, 0);
  wall(W, hgt, cx, hgt / 2, GYM.zmax, Math.PI);
  wall(D, hgt, GYM.xmin, hgt / 2, cz, Math.PI / 2);
  wall(D, hgt, GYM.xmax, hgt / 2, cz, -Math.PI / 2);
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshStandardMaterial({ color: 0x3a3f4c }));
  ceil.rotation.x = Math.PI / 2; ceil.position.set(cx, hgt, cz); scene.add(ceil);
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xfff6e0 });
  for (let x = -6; x <= 6; x += 6) for (let z = -1; z <= 15; z += 5) {
    const l = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.5), lampMat);
    l.rotation.x = Math.PI / 2; l.position.set(x, hgt - 0.02, z); scene.add(l);
  }
}

// ---------- hoop ----------
const boxMesh = (bx, mat) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(bx.max.x - bx.min.x, bx.max.y - bx.min.y, bx.max.z - bx.min.z), mat);
  m.position.set((bx.min.x + bx.max.x) / 2, (bx.min.y + bx.max.y) / 2, (bx.min.z + bx.max.z) / 2);
  m.castShadow = true; scene.add(m); return m;
};
{
  const glass = new THREE.MeshPhysicalMaterial({ color: 0xd8eef5, transparent: true, opacity: 0.28, roughness: 0.05 });
  boxMesh(BOARD, glass).castShadow = false;
  const c = document.createElement('canvas'); c.width = 732; c.height = 428;
  const g = c.getContext('2d'); const s = c.width / 1.83;
  g.strokeStyle = '#fff'; g.lineWidth = 0.05 * s;
  g.strokeRect(g.lineWidth / 2, g.lineWidth / 2, c.width - g.lineWidth, c.height - g.lineWidth);
  const tw = 0.59 * s, th = 0.45 * s, tb = (BOARD.max.y - RIM.y) * s;
  g.strokeRect((c.width - tw) / 2, tb - th, tw, th);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const face = new THREE.Mesh(new THREE.PlaneGeometry(1.83, BOARD.max.y - BOARD.min.y),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
  face.position.set(0, (BOARD.min.y + BOARD.max.y) / 2, BOARD.max.z + 0.002); scene.add(face);

  const steel = new THREE.MeshStandardMaterial({ color: 0x30343c, roughness: 0.5, metalness: 0.6 });
  boxMesh(BRACKET, steel); boxMesh(ARM, steel);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(POLE.r, POLE.r, POLE.h, 20), steel);
  pole.position.set(POLE.x, POLE.h / 2, POLE.z); pole.castShadow = true; scene.add(pole);
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(POLE.r + 0.06, POLE.r + 0.06, 1.8, 20),
    new THREE.MeshStandardMaterial({ color: 0x8a2a20, roughness: 0.9 }));
  pad.position.set(POLE.x, 0.9, POLE.z); scene.add(pad);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(RIM.R, RIM.tube, 12, 64),
    new THREE.MeshStandardMaterial({ color: 0xff4a1c, roughness: 0.4, metalness: 0.5 }));
  rim.rotation.x = Math.PI / 2; rim.position.set(RIM.x, RIM.y, RIM.z); rim.castShadow = true; scene.add(rim);
}

// ---------- ball look ----------
function ballTexture() {
  const W = 1024, H = 512, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#d4642a'; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 26000; i++) {
    g.fillStyle = Math.random() < 0.5 ? 'rgba(255,190,140,0.10)' : 'rgba(80,25,5,0.12)';
    g.fillRect(Math.random() * W, Math.random() * H, 2, 2);
  }
  g.fillStyle = '#1a0d06';
  const dot = (x, y, z) => {
    const theta = Math.acos(Math.max(-1, Math.min(1, y)));
    let phi = Math.atan2(z, -x); if (phi < 0) phi += Math.PI * 2;
    g.beginPath(); g.arc(phi / (Math.PI * 2) * W, theta / Math.PI * H, 3.2, 0, Math.PI * 2); g.fill();
  };
  const circle = (cx, cy, cz, ang) => {
    const ax = [cx, cy, cz];
    const up = Math.abs(cy) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const e1 = [ax[1] * up[2] - ax[2] * up[1], ax[2] * up[0] - ax[0] * up[2], ax[0] * up[1] - ax[1] * up[0]];
    const l = Math.hypot(...e1); e1[0] /= l; e1[1] /= l; e1[2] /= l;
    const e2 = [ax[1] * e1[2] - ax[2] * e1[1], ax[2] * e1[0] - ax[0] * e1[2], ax[0] * e1[1] - ax[1] * e1[0]];
    const ca = Math.cos(ang), sa = Math.sin(ang);
    for (let t = 0; t < Math.PI * 2; t += 0.004) {
      const ct = Math.cos(t), st = Math.sin(t);
      dot(ca * ax[0] + sa * (ct * e1[0] + st * e2[0]), ca * ax[1] + sa * (ct * e1[1] + st * e2[1]), ca * ax[2] + sa * (ct * e1[2] + st * e2[2]));
    }
  };
  circle(0, 1, 0, Math.PI / 2); circle(0, 0, 1, Math.PI / 2);
  circle(1, 0, 0, 0.92); circle(-1, 0, 0, 0.92);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = maxAniso;
  return t;
}
const ballGeo = new THREE.SphereGeometry(BALL_R, 40, 24);
const ballMat = new THREE.MeshStandardMaterial({ map: ballTexture(), roughness: 0.75 });
function newBallMesh() {
  const m = new THREE.Mesh(ballGeo, ballMat); m.castShadow = true; return m;
}
const held = newBallMesh(); held.castShadow = false; camera.add(held);
const passMesh = newBallMesh(); passMesh.visible = false; scene.add(passMesh);

// ---------- net ----------
const world = new World();
const netGeo = new THREE.BufferGeometry();
const netPos = new Float32Array(world.net.links.length * 6);
netGeo.setAttribute('position', new THREE.BufferAttribute(netPos, 3));
const netMesh = new THREE.LineSegments(netGeo, new THREE.LineBasicMaterial({ color: 0xf2f2f2 }));
netMesh.frustumCulled = false;
scene.add(netMesh);
function updateNet() {
  let k = 0;
  for (const [i, j] of world.net.links) {
    const a = world.net.pts[i].p, b = world.net.pts[j].p;
    netPos[k++] = a.x; netPos[k++] = a.y; netPos[k++] = a.z;
    netPos[k++] = b.x; netPos[k++] = b.y; netPos[k++] = b.z;
  }
  netGeo.attributes.position.needsUpdate = true;
}

// ---------- shot trail (so you can read the flight and any curve) ----------
const TRAIL_N = 90;
const trailPos = new Float32Array(TRAIL_N * 3);
const trailGeo = new THREE.BufferGeometry();
trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPos, 3));
const trail = new THREE.Line(trailGeo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 }));
trail.frustumCulled = false; scene.add(trail);
let trailBall = null, trailCount = 0;

// ---------- audio ----------
let actx = null, noiseBuf = null;
function initAudio() {
  if (actx) { actx.resume(); return; }
  actx = new AudioContext();
  noiseBuf = actx.createBuffer(1, actx.sampleRate * 0.5, actx.sampleRate);
  const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
}
function tone(freq, endFreq, dur, vol, type = 'sine') {
  const o = actx.createOscillator(), g = actx.createGain(), t = actx.currentTime;
  o.type = type; o.frequency.setValueAtTime(freq, t); o.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(actx.destination); o.start(t); o.stop(t + dur);
}
function noise(freq, q, dur, vol) {
  const s = actx.createBufferSource(), f = actx.createBiquadFilter(), g = actx.createGain(), t = actx.currentTime;
  s.buffer = noiseBuf; f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f).connect(g).connect(actx.destination); s.start(t); s.stop(t + dur);
}
function sound(kind, speed = 5, dist = 0) {
  if (!actx) return;
  const v = Math.min(1, speed / 7) / (1 + dist * 0.12);
  if (v < 0.01) return;
  if (kind === 'floor') { tone(140, 55, 0.14, 0.9 * v); noise(400, 1, 0.06, 0.4 * v); }
  else if (kind === 'rim') { tone(620, 600, 0.45, 0.25 * v, 'triangle'); tone(1490, 1470, 0.3, 0.12 * v); noise(3000, 2, 0.05, 0.3 * v); }
  else if (kind === 'board') { tone(190, 120, 0.12, 0.7 * v); noise(900, 1, 0.08, 0.5 * v); }
  else if (kind === 'net') noise(2400, 0.8, 0.28, 0.35 / (1 + dist * 0.1));
  else if (kind === 'ball') tone(220, 120, 0.08, 0.4 * v);
  else if (kind === 'release') noise(1800, 1.5, 0.09, 0.12);
  else if (kind === 'catch') { tone(160, 90, 0.07, 0.5); noise(700, 1, 0.04, 0.25); }
  else if (kind === 'perfect') { tone(880, 880, 0.12, 0.08, 'triangle'); }
  else { tone(330, 200, 0.12, 0.4 * v, 'triangle'); noise(1200, 1, 0.06, 0.3 * v); }
}

// ---------- state ----------
const player = { p: new THREE.Vector3(0, 0, 5.5), v: new THREE.Vector3(), yaw: 0, pitch: 0.18, onGround: true, bob: 0, takeoff: new THREE.Vector3() };
const keys = new Set();
const stats = { makes: 0, shots: 0, points: 0, streak: 0, best: 0, perfect: 0 };
let hasBall = true, raising = false, focus = false, focusT = 0, raiseT = 0;
let timeScale = 1, locked = false, acc = 0;
let kick = 0, dip = 0;
let pending = null;              // the shot we're waiting on before the ball comes back
let pass = null;                 // ball flying back to you
const loose = [];
let lastShot = null;

const $ = id => document.getElementById(id);
const setText = (() => { const cache = {}; return (id, html) => { if (cache[id] !== html) { cache[id] = html; $(id).innerHTML = html; } }; })();
let msgTimer = 0, relTimer = 0;
function flash(text, color = '#ffd34d', dur = 1.3) {
  const m = $('msg'); m.textContent = text; m.style.color = color; m.style.opacity = 1; msgTimer = dur;
}
function flashRelease(text, color) {
  const r = $('rel'); r.textContent = text; r.style.color = color; r.style.opacity = 1; relTimer = 0.9;
}

function resolveShot(b, made) {
  const s = b.shot; if (!s || s.resolved) return;
  s.resolved = true; s.resolvedAt = performance.now();
  if (made) {
    stats.makes++; stats.points += s.points; stats.streak++; stats.best = Math.max(stats.best, stats.streak);
    const swish = !s.rim && !s.board;
    const label = swish ? 'SWISH' : s.board && !s.rim ? 'BANK' : s.board ? 'OFF THE GLASS' : 'IN';
    flash(`${label}  +${s.points}`, swish ? '#7dffb0' : '#ffd34d');
  } else {
    stats.streak = 0;
    flash(!s.rim && !s.board ? 'AIRBALL' : 'MISS', '#ff7a6a', 0.9);
  }
}

world.on((type, b, d) => {
  const dist = Math.hypot(b.p.x - camera.position.x, b.p.y - camera.position.y, b.p.z - camera.position.z);
  if (type === 'hit') {
    if (b.shot && !b.shot.resolved) {
      if (d.kind === 'rim') b.shot.rim = true;
      if (d.kind === 'board') b.shot.board = true;
      if (d.kind === 'floor' && !b.scored) resolveShot(b, false);
    }
    const now = performance.now();
    b.lastSound = b.lastSound || {};
    if (!(now - (b.lastSound[d.kind] || 0) < 45)) { b.lastSound[d.kind] = now; sound(d.kind, d.speed, dist); }
  } else if (type === 'score') {
    sound('net', 1, dist);
    resolveShot(b, true);
  } else if (type === 'cross' && b.shot && b.shot.entry == null) {
    b.shot.entry = d.entry * 180 / Math.PI;
  }
});

// ---------- input ----------
const canvas = renderer.domElement;
$('start').addEventListener('click', () => { initAudio(); canvas.requestPointerLock(); });
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === canvas;
  $('start').style.display = locked ? 'none' : 'flex';
  if (!locked) { raising = false; focus = false; keys.clear(); }
});
addEventListener('contextmenu', e => e.preventDefault());
addEventListener('mousemove', e => {
  if (!locked) return;
  const s = SENS * (1 - 0.35 * focusT);
  player.yaw -= e.movementX * s;
  player.pitch = Math.max(-1.45, Math.min(1.45, player.pitch - e.movementY * s));
});
addEventListener('mousedown', e => {
  if (!locked) return;
  if (e.button === 0 && hasBall) shoot();
  if (e.button === 2) focus = true;
});
addEventListener('mouseup', e => {
  if (e.button === 2) focus = false;
});
addEventListener('keydown', e => {
  if (!locked) return;
  keys.add(e.code);
  if (e.code === 'KeyR' && !hasBall) giveBall();
  if (e.code === 'KeyF') timeScale = timeScale === 1 ? 0.25 : 1;
  if (e.code === 'Space' && player.onGround) jump();
});
addEventListener('keyup', e => keys.delete(e.code));

function jump() {
  player.v.y = JUMP_V; player.onGround = false;
  player.takeoff.copy(player.p);
}

// ---------- shooting ----------
const fwd = new THREE.Vector3(), right = new THREE.Vector3(), up = new THREE.Vector3(), tmp = new THREE.Vector3();
const gauss = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

// Seconds from the apex of the jump given vertical body speed. Negative = early (still rising).
function timingError(vy) {
  const a = Math.abs(vy);
  const t = a < HANG_V ? a / HANG_G : HANG_V / HANG_G + (a - HANG_V) / PLAYER_G;
  return vy > 0 ? -t : t;
}

// Where the crosshair points: the glass (bank shot), the rim plane, or failing that somewhere on the floor.
function aimTarget(o, d) {
  let best = null, tBest = Infinity;
  if (d.z < -1e-6) {
    const t = (BOARD.max.z - o.z) / d.z;
    if (t > 0) {
      const x = o.x + d.x * t, y = o.y + d.y * t;
      if (x > BOARD.min.x && x < BOARD.max.x && y > BOARD.min.y && y < BOARD.max.y) {
        tBest = t; best = { x, y, z: BOARD.max.z + BALL_R };
      }
    }
  }
  if (d.y > 1e-6 && o.y < RIM.y) {
    const t = (RIM.y - o.y) / d.y;
    if (t < tBest && t < 40) { tBest = t; best = { x: o.x + d.x * t, y: RIM.y, z: o.z + d.z * t }; }
  }
  if (!best) {
    const t = d.y < -1e-6 ? Math.min(25, (BALL_R - o.y) / d.y) : 12;
    best = { x: o.x + d.x * t, y: Math.max(BALL_R, o.y + d.y * t), z: o.z + d.z * t };
  }
  return best;
}

function shoot() {
  camera.updateMatrixWorld();
  camera.getWorldDirection(fwd);
  const target = aimTarget(camera.position, fwd);
  const p0 = held.getWorldPosition(new THREE.Vector3());
  const sol = solveShot(p0, target, SPIN);

  const grounded = player.onGround;
  if (grounded) player.takeoff.copy(player.p);
  const te = grounded ? 0 : timingError(player.v.y);
  const ate = Math.abs(te);
  // Set shots (feet on the floor) are all arm, so they get shakier with distance.
  const strain = grounded ? Math.hypot(target.x - p0.x, target.z - p0.z) : 0;
  const drift = Math.hypot(player.v.x, player.v.z);

  // Random error is small on a clean, planted release and grows when you're sloppy.
  const spreadDeg = THREE.MathUtils.lerp(SPREAD, FOCUS_SPREAD, focusT) + 3 * ate + 0.12 * drift + 0.12 * strain;
  const powerSigma = 0.004 + 0.05 * ate + 0.003 * strain;
  const v = new THREE.Vector3(sol.v.x, sol.v.y, sol.v.z);
  const speed = v.length();
  const dir = v.clone().normalize();
  right.crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
  up.crossVectors(right, dir).normalize();
  const rad = spreadDeg * Math.PI / 180;
  dir.addScaledVector(right, Math.tan(gauss() * rad)).addScaledVector(up, Math.tan(gauss() * rad)).normalize();
  v.copy(dir).multiplyScalar(speed * (1 + gauss() * powerSigma));
  // The physics part: your body's velocity is in the ball too.
  v.x += player.v.x * CARRY_H; v.z += player.v.z * CARRY_H; v.y += player.v.y * CARRY_V;
  // Sloppy releases come off the side of the hand: sidespin curves the ball and changes how it takes the rim.
  const w = { x: sol.w.x, y: gauss() * 45 * ate, z: sol.w.z };

  const body = makeBall(p0, v, w);
  const fd = Math.hypot(player.takeoff.x - RIM.x, player.takeoff.z - RIM.z);
  const three = fd > THREE_PT || (Math.abs(player.takeoff.x) > CORNER_X && player.takeoff.z < CORNER_Z);
  body.shot = { points: three ? 3 : 2, rim: false, board: false, resolved: false, entry: null, releasedAt: performance.now() };
  const mesh = newBallMesh();
  mesh.position.copy(p0);
  mesh.quaternion.copy(held.getWorldQuaternion(new THREE.Quaternion()));
  scene.add(mesh);
  world.balls.push(body);
  loose.push({ body, mesh });
  while (loose.length > MAX_LOOSE) removeLoose(loose[0]);

  stats.shots++;
  const ms = Math.round(te * 1000);
  let grade, color;
  if (grounded) { grade = 'SET SHOT'; color = '#cfd6e6'; }
  else if (ate < 0.025) { grade = 'PERFECT'; color = '#5cff8a'; stats.perfect++; sound('perfect'); }
  else if (ate < 0.06) { grade = te < 0 ? `GOOD · ${-ms}ms early` : `GOOD · ${ms}ms late`; color = '#ffd34d'; }
  else { grade = te < 0 ? `EARLY · ${-ms}ms` : `LATE · ${ms}ms`; color = '#ff7a6a'; }
  flashRelease(grade, color);
  sound('release');
  lastShot = { body, te, grounded, drift, speed: v.length(), angle: Math.asin(v.y / v.length()) * 180 / Math.PI, dist: fd, bank: target.z > BOARD.max.z && target.z < BOARD.max.z + BALL_R + 0.01 };
  pending = body;
  hasBall = false;
  kick = 0.035;
  trailBall = body; trailCount = 0;
}

function removeLoose(l) {
  if (l.body.shot && !l.body.shot.resolved) resolveShot(l.body, false);
  scene.remove(l.mesh);
  world.balls.splice(world.balls.indexOf(l.body), 1);
  loose.splice(loose.indexOf(l), 1);
  if (trailBall === l.body) trailBall = null;
}

// Rebounder passes you the next ball as soon as the shot is decided.
function updateReturn(dt) {
  if (hasBall || pass) return;
  const s = pending && pending.shot;
  const now = performance.now();
  const ready = !s || (s.resolved && now - s.resolvedAt > 250) || now - s.releasedAt > 2200;
  if (!ready) return;
  const from = new THREE.Vector3(RIM.x + 0.4, 1.3, RIM.z + 0.8);
  pass = { from, t: 0, dur: Math.max(0.22, from.distanceTo(camera.position) / 16) };
  passMesh.visible = true;
}
function updatePass(dt) {
  if (!pass) return;
  pass.t += dt;
  const k = Math.min(1, pass.t / pass.dur);
  const to = held.getWorldPosition(tmp);
  passMesh.position.lerpVectors(pass.from, to, k);
  passMesh.position.y += Math.sin(k * Math.PI) * 0.6;
  passMesh.rotation.x -= dt * 20;
  if (k >= 1) giveBall();
}
function giveBall() {
  pass = null; passMesh.visible = false; pending = null;
  hasBall = true; sound('catch');
}

// ---------- update ----------
function updatePlayer(dt) {
  focusT = THREE.MathUtils.clamp(focusT + (focus ? dt : -dt) / 0.08, 0, 1);
  const f = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
  const s = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
  const sinY = Math.sin(player.yaw), cosY = Math.cos(player.yaw);
  let wx = -sinY * f + cosY * s, wz = -cosY * f - sinY * s;
  const wl = Math.hypot(wx, wz);
  const speed = wl > 0 ? MOVE * (1 - 0.2 * focusT) : 0;
  if (wl > 0) { wx /= wl; wz /= wl; }
  const k = 1 - Math.exp(-(player.onGround ? GROUND_ACCEL : AIR_ACCEL) * dt);
  player.v.x += (wx * speed - player.v.x) * k;
  player.v.z += (wz * speed - player.v.z) * k;
  if (!player.onGround) player.v.y -= (Math.abs(player.v.y) < HANG_V ? HANG_G : PLAYER_G) * dt;
  player.p.addScaledVector(player.v, dt);
  if (player.p.y <= 0 && !player.onGround) {
    dip = Math.min(0.08, -player.v.y * 0.012);
    player.p.y = 0; player.v.y = 0; player.onGround = true;
  }
  const m = 0.4;
  player.p.x = THREE.MathUtils.clamp(player.p.x, GYM.xmin + m, GYM.xmax - m);
  player.p.z = THREE.MathUtils.clamp(player.p.z, GYM.zmin + m, GYM.zmax - m);
  const dx = player.p.x - POLE.x, dz = player.p.z - POLE.z, d = Math.hypot(dx, dz), minD = POLE.r + 0.06 + 0.35;
  if (d < minD) { player.p.x = POLE.x + dx / d * minD; player.p.z = POLE.z + dz / d * minD; }

  const hs = Math.hypot(player.v.x, player.v.z);
  if (player.onGround) player.bob += hs * dt * 1.8;
  const bob = player.onGround ? Math.sin(player.bob * 2) * 0.02 * Math.min(1, hs / MOVE) : 0;
  kick *= Math.exp(-14 * dt); dip *= Math.exp(-10 * dt);
  camera.position.set(player.p.x, player.p.y + EYE + bob - dip, player.p.z);
  camera.rotation.set(player.pitch + kick, player.yaw, 0);
  const fov = THREE.MathUtils.lerp(FOV, FOCUS_FOV, focusT);
  if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
  raising = hasBall && !player.onGround;   // ball goes up to the set point while you're in the air
}

const q = new THREE.Quaternion(), ax = new THREE.Vector3();
function syncBalls(dt) {
  const now = performance.now();
  for (const l of [...loose]) {
    const b = l.body;
    l.mesh.position.set(b.p.x, b.p.y, b.p.z);
    const wl = Math.hypot(b.w.x, b.w.y, b.w.z);
    if (wl > 1e-4) { q.setFromAxisAngle(ax.set(b.w.x / wl, b.w.y / wl, b.w.z / wl), wl * dt); l.mesh.quaternion.premultiply(q); }
    if (b.shot && !b.shot.resolved && b.age > 8) resolveShot(b, false);   // stuck on the rim, etc.
    if (b.age > 12) removeLoose(l);
  }
  if (trailBall) {
    if (trailCount < TRAIL_N && trailBall.age < 3) {
      trailPos[trailCount * 3] = trailBall.p.x; trailPos[trailCount * 3 + 1] = trailBall.p.y; trailPos[trailCount * 3 + 2] = trailBall.p.z;
      trailCount++;
      trailGeo.setDrawRange(0, trailCount);
      trailGeo.attributes.position.needsUpdate = true;
    }
  }
  trail.visible = !!trailBall && trailCount > 1;
}

const idlePos = new THREE.Vector3(0.3, -0.36, -0.8), setPos = new THREE.Vector3(0.26, -0.2, -0.9);
function updateViewModel(dt) {
  held.visible = hasBall;
  if (!hasBall) return;
  const target = raising ? setPos : idlePos;
  held.position.lerp(target, 1 - Math.exp(-(raising ? 30 : 14) * dt));
  if (player.onGround && !raising) held.position.y += Math.abs(Math.sin(player.bob * 2)) * -0.02;
}

function updateHud(dt) {
  const pct = stats.shots ? Math.round(stats.makes / stats.shots * 100) : 0;
  setText('stats', `<b>${stats.points}</b> pts<br>${stats.makes}/${stats.shots} (${pct}%) · streak ${stats.streak} · best ${stats.best}<br>perfect releases ${stats.perfect}`);
  if (lastShot) {
    const s = lastShot.body.shot, ms = Math.round(lastShot.te * 1000);
    setText('last', `${lastShot.dist.toFixed(1)} m${lastShot.bank ? ' · bank' : ''}<br>` +
      `${lastShot.grounded ? 'set shot' : 'release ' + (ms === 0 ? 'on the apex' : Math.abs(ms) + 'ms ' + (ms < 0 ? 'early' : 'late'))} · drift ${lastShot.drift.toFixed(1)} m/s<br>` +
      `${lastShot.speed.toFixed(2)} m/s @ ${lastShot.angle.toFixed(1)}°` + (s.entry != null ? ` · entry ${s.entry.toFixed(0)}°` : ''));
  }
  // Timing ring: tightens toward the apex of the jump, green inside the perfect window.
  const ring = $('ring');
  if (raising && !player.onGround) {
    const ate = Math.abs(timingError(player.v.y));
    const size = 14 + Math.min(70, ate * 420);
    ring.style.display = 'block';
    ring.style.width = ring.style.height = size + 'px';
    ring.style.left = ring.style.top = -size / 2 - 2 + 'px';
    ring.style.borderColor = ate < 0.025 ? '#5cff8a' : ate < 0.06 ? '#ffd34d' : 'rgba(255,255,255,.8)';
  } else ring.style.display = 'none';
  const gap = 5 + 6 * (1 - focusT) + Math.min(14, Math.hypot(player.v.x, player.v.z) * 2.5);
  const len = 7;
  Object.assign($('cl').style, { width: len + 'px', height: '2px', left: -(gap + len) + 'px', top: '-1px' });
  Object.assign($('cr').style, { width: len + 'px', height: '2px', left: gap + 'px', top: '-1px' });
  Object.assign($('cu').style, { width: '2px', height: len + 'px', left: '-1px', top: -(gap + len) + 'px' });
  Object.assign($('cd').style, { width: '2px', height: len + 'px', left: '-1px', top: gap + 'px' });
  setText('modes', timeScale < 1 ? 'SLOW-MO' : '');
  if (msgTimer > 0) { msgTimer -= dt; if (msgTimer <= 0) $('msg').style.opacity = 0; }
  if (relTimer > 0) { relTimer -= dt; if (relTimer <= 0) $('rel').style.opacity = 0; }
}

let last = performance.now();
function frame(now) {
  const rdt = Math.min(0.05, (now - last) / 1000); last = now;
  const dt = rdt * timeScale;
  updatePlayer(dt);
  acc += dt;
  let n = 0;
  while (acc >= PHYS_DT && n++ < 30) { world.step(PHYS_DT); acc -= PHYS_DT; }
  if (n > 30) acc = 0;
  syncBalls(dt);
  updateNet();
  updateViewModel(rdt);
  updateReturn(dt);
  updatePass(dt);
  updateHud(rdt);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
