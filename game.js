import * as THREE from 'three';
import {
  World, makeBall, solveShot, BALL_R, RIM, BOARD, BRACKET, ARM, POLE, GYM,
  THREE_PT, CORNER_X, CORNER_Z,
} from './physics.js';

// ---------- tuning ----------
const PHYS_DT = 1 / 240;
const EYE = 1.75;
const MOVE = 5.2, GROUND_ACCEL = 22, AIR_ACCEL = 2;
const JUMP_V = 4.4, PLAYER_G = 15;
const SPIN = 2.5;                 // backspin rev/s
const RELOAD = 0.25;              // seconds until the next ball is in your hand
const FOV = 75, ZOOM_FOV = 55, SENS = 0.0022;
const MAX_LOOSE = 8;

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
  else if (kind === 'release') noise(1800, 1.5, 0.08, 0.1);
  else { tone(330, 200, 0.12, 0.4 * v, 'triangle'); noise(1200, 1, 0.06, 0.3 * v); }
}

// ---------- state ----------
const player = { p: new THREE.Vector3(0, 0, 5.5), v: new THREE.Vector3(), yaw: 0, pitch: 0.2, onGround: true, bob: 0 };
const keys = new Set();
const stats = { makes: 0, shots: 0, points: 0, streak: 0, best: 0 };
let hasBall = true, reload = 0, zoom = false, zoomT = 0;
let locked = false, acc = 0, dip = 0;
const loose = [];

const $ = id => document.getElementById(id);
const setText = (() => { const cache = {}; return (id, html) => { if (cache[id] !== html) { cache[id] = html; $(id).innerHTML = html; } }; })();
let msgTimer = 0;
function flash(text, color = '#ffd34d', dur = 1.1) {
  const m = $('msg'); m.textContent = text; m.style.color = color; m.style.opacity = 1; msgTimer = dur;
}

function resolveShot(b, made) {
  const s = b.shot; if (!s || s.resolved) return;
  s.resolved = true;
  if (made) {
    stats.makes++; stats.points += s.points; stats.streak++; stats.best = Math.max(stats.best, stats.streak);
    const swish = !s.rim && !s.board;
    flash(`${swish ? 'SWISH' : s.board && !s.rim ? 'BANK' : 'IN'}  +${s.points}`, swish ? '#7dffb0' : '#ffd34d');
  } else {
    stats.streak = 0;
    flash(!s.rim && !s.board ? 'AIRBALL' : 'MISS', '#ff7a6a', 0.8);
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
  }
});

// ---------- input ----------
const canvas = renderer.domElement;
$('start').addEventListener('click', () => { initAudio(); canvas.requestPointerLock(); });
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === canvas;
  $('start').style.display = locked ? 'none' : 'flex';
  if (!locked) { zoom = false; keys.clear(); }
});
addEventListener('contextmenu', e => e.preventDefault());
addEventListener('mousemove', e => {
  if (!locked) return;
  const s = SENS * camera.fov / FOV;            // same feel when zoomed
  player.yaw -= e.movementX * s;
  player.pitch = Math.max(-1.45, Math.min(1.45, player.pitch - e.movementY * s));
});
addEventListener('mousedown', e => {
  if (!locked) return;
  if (e.button === 0 && hasBall) shoot();
  if (e.button === 2) zoom = true;
});
addEventListener('mouseup', e => { if (e.button === 2) zoom = false; });
addEventListener('keydown', e => {
  if (!locked) return;
  keys.add(e.code);
  if (e.code === 'Space' && player.onGround) { player.v.y = JUMP_V; player.onGround = false; }
});
addEventListener('keyup', e => keys.delete(e.code));

// ---------- shooting ----------
const fwd = new THREE.Vector3();

// Where the ball should go. Near the hoop we aim on an upright plane through the
// rim that faces you, so up/down aim is forgiving and you never fight for distance.
// Otherwise: the glass (bank shot), then wherever the crosshair lands.
function aimTarget(o, d) {
  const hx = o.x - RIM.x, hz = o.z - RIM.z, hd = Math.hypot(hx, hz);
  if (hd > 1.0) {
    const nx = hx / hd, nz = hz / hd, dn = d.x * nx + d.z * nz;
    if (dn < -1e-6) {
      const t = ((RIM.x - o.x) * nx + (RIM.z - o.z) * nz) / dn;
      const p = { x: o.x + d.x * t, y: o.y + d.y * t, z: o.z + d.z * t };
      if (t > 0 && Math.hypot(p.x - RIM.x, p.z - RIM.z) < 0.9 && Math.abs(p.y - RIM.y) < 0.6) return p;
    }
  } else if (d.y > 1e-6 && o.y < RIM.y) {
    const t = (RIM.y - o.y) / d.y;                // standing under it: use the rim plane
    return { x: o.x + d.x * t, y: RIM.y, z: o.z + d.z * t };
  }
  if (d.z < -1e-6) {
    const t = (BOARD.max.z - o.z) / d.z;
    const x = o.x + d.x * t, y = o.y + d.y * t;
    if (t > 0 && x > BOARD.min.x && x < BOARD.max.x && y > BOARD.min.y && y < BOARD.max.y) return { x, y, z: BOARD.max.z + BALL_R };
  }
  const t = d.y < -1e-6 ? Math.min(25, (BALL_R - o.y) / d.y) : 12;
  return { x: o.x + d.x * t, y: Math.max(BALL_R, o.y + d.y * t), z: o.z + d.z * t };
}

function shoot() {
  camera.updateMatrixWorld();
  camera.getWorldDirection(fwd);
  const target = aimTarget(camera.position, fwd);
  const p0 = held.getWorldPosition(new THREE.Vector3());
  const sol = solveShot(p0, target, SPIN);

  const body = makeBall(p0, sol.v, sol.w);
  const fd = Math.hypot(player.p.x - RIM.x, player.p.z - RIM.z);
  const three = fd > THREE_PT || (Math.abs(player.p.x) > CORNER_X && player.p.z < CORNER_Z);
  body.shot = { points: three ? 3 : 2, rim: false, board: false, resolved: false };
  const mesh = newBallMesh();
  mesh.position.copy(p0);
  mesh.quaternion.copy(held.getWorldQuaternion(new THREE.Quaternion()));
  scene.add(mesh);
  world.balls.push(body);
  loose.push({ body, mesh });
  while (loose.length > MAX_LOOSE) removeLoose(loose[0]);

  stats.shots++;
  sound('release');
  hasBall = false; reload = RELOAD;
}

function removeLoose(l) {
  if (l.body.shot && !l.body.shot.resolved) resolveShot(l.body, false);
  scene.remove(l.mesh);
  world.balls.splice(world.balls.indexOf(l.body), 1);
  loose.splice(loose.indexOf(l), 1);
}

// ---------- update ----------
function updatePlayer(dt) {
  zoomT = THREE.MathUtils.clamp(zoomT + (zoom ? dt : -dt) / 0.1, 0, 1);
  const f = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
  const s = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
  const sinY = Math.sin(player.yaw), cosY = Math.cos(player.yaw);
  let wx = -sinY * f + cosY * s, wz = -cosY * f - sinY * s;
  const wl = Math.hypot(wx, wz);
  if (wl > 0) { wx /= wl; wz /= wl; }
  const speed = wl > 0 ? MOVE : 0;
  const k = 1 - Math.exp(-(player.onGround ? GROUND_ACCEL : AIR_ACCEL) * dt);
  player.v.x += (wx * speed - player.v.x) * k;
  player.v.z += (wz * speed - player.v.z) * k;
  if (!player.onGround) player.v.y -= PLAYER_G * dt;
  player.p.addScaledVector(player.v, dt);
  if (player.p.y <= 0 && !player.onGround) {
    dip = Math.min(0.06, -player.v.y * 0.01);
    player.p.y = 0; player.v.y = 0; player.onGround = true;
  }
  const m = 0.4;
  player.p.x = THREE.MathUtils.clamp(player.p.x, GYM.xmin + m, GYM.xmax - m);
  player.p.z = THREE.MathUtils.clamp(player.p.z, GYM.zmin + m, GYM.zmax - m);
  const dx = player.p.x - POLE.x, dz = player.p.z - POLE.z, d = Math.hypot(dx, dz), minD = POLE.r + 0.06 + 0.35;
  if (d < minD) { player.p.x = POLE.x + dx / d * minD; player.p.z = POLE.z + dz / d * minD; }

  const hs = Math.hypot(player.v.x, player.v.z);
  if (player.onGround) player.bob += hs * dt * 1.8;
  const bob = player.onGround ? Math.sin(player.bob * 2) * 0.015 * Math.min(1, hs / MOVE) : 0;
  dip *= Math.exp(-10 * dt);
  camera.position.set(player.p.x, player.p.y + EYE + bob - dip, player.p.z);
  camera.rotation.set(player.pitch, player.yaw, 0);
  const fov = THREE.MathUtils.lerp(FOV, ZOOM_FOV, zoomT);
  if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
}

const q = new THREE.Quaternion(), ax = new THREE.Vector3();
function syncBalls(dt) {
  for (const l of [...loose]) {
    const b = l.body;
    l.mesh.position.set(b.p.x, b.p.y, b.p.z);
    const wl = Math.hypot(b.w.x, b.w.y, b.w.z);
    if (wl > 1e-4) { q.setFromAxisAngle(ax.set(b.w.x / wl, b.w.y / wl, b.w.z / wl), wl * dt); l.mesh.quaternion.premultiply(q); }
    if (b.shot && !b.shot.resolved && b.age > 8) resolveShot(b, false);   // stuck on the rim, etc.
    if (b.age > 15) removeLoose(l);
  }
}

// The held ball sits still in the lower right; a new one pops in after each shot.
held.position.set(0.34, -0.38, -1.0);
function updateHeld(dt) {
  if (!hasBall) {
    reload -= dt;
    if (reload <= 0) { hasBall = true; held.scale.setScalar(0.2); }
  }
  held.visible = hasBall;
  if (hasBall) held.scale.setScalar(Math.min(1, held.scale.x + dt * 8));
}

function updateHud(dt) {
  const pct = stats.shots ? Math.round(stats.makes / stats.shots * 100) : 0;
  setText('stats', `<b>${stats.points}</b> pts<br>${stats.makes}/${stats.shots} (${pct}%) · streak ${stats.streak} · best ${stats.best}`);
  if (msgTimer > 0) { msgTimer -= dt; if (msgTimer <= 0) $('msg').style.opacity = 0; }
}

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  updatePlayer(dt);
  acc += dt;
  let n = 0;
  while (acc >= PHYS_DT && n < 30) { world.step(PHYS_DT); acc -= PHYS_DT; n++; }
  if (n >= 30) acc = 0;
  syncBalls(dt);
  updateNet();
  updateHeld(dt);
  updateHud(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
