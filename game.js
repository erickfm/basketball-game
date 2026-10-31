import * as THREE from 'three';
import {
  World, makeBall, simulateFlight, BALL_R, RIM, BOARD, BRACKET, ARM, POLE, GYM,
  THREE_PT, CORNER_X, CORNER_Z,
} from './physics.js';

// ---------- tuning ----------
const PHYS_DT = 1 / 240;
const EYE = 1.75;
const WALK = 4.2, SPRINT = 6.2, ADS_WALK = 1.8, JUMP_V = 4.3, PLAYER_G = 14;
const MIN_SPEED = 3, MAX_SPEED = 14, CHARGE_RATE = 4;     // launch speed, m/s and m/s per s
const HIP_SPREAD = 1.8, ADS_SPREAD = 0.3;                  // degrees, 1 sigma
const HIP_POWER = 0.03, ADS_POWER = 0.006;                 // fraction of speed, 1 sigma
const FOV = 75, ADS_FOV = 45, SENS = 0.0022;
const MAX_LOOSE = 6;

// ---------- renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x15171c);
scene.fog = new THREE.Fog(0x15171c, 25, 45);
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
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -13, right: 13, top: 13, bottom: -13, near: 1, far: 40 });
sun.shadow.bias = -0.0004;
scene.add(sun, sun.target);
const maxAniso = renderer.capabilities.getMaxAnisotropy();

// ---------- court ----------
function courtTexture() {
  const W = GYM.xmax - GYM.xmin, D = GYM.zmax - GYM.zmin, ppm = 96;
  const c = document.createElement('canvas'); c.width = W * ppm; c.height = D * ppm;
  const g = c.getContext('2d');
  const X = x => (x - GYM.xmin) * ppm, Z = z => (z - GYM.zmin) * ppm;
  // planks run along z
  const plank = 0.08 * ppm;
  for (let i = 0; i * plank < c.width; i++) {
    const l = 52 + Math.random() * 10;
    g.fillStyle = `hsl(32, 48%, ${l}%)`; g.fillRect(i * plank, 0, plank, c.height);
    g.fillStyle = 'rgba(60,35,10,0.25)'; g.fillRect(i * plank, 0, 1, c.height);
    for (let y = Math.random() * 300; y < c.height; y += 150 + Math.random() * 300) g.fillRect(i * plank, y, plank, 1);
  }
  for (let i = 0; i < 40000; i++) {
    g.fillStyle = `rgba(${Math.random() < .5 ? '255,240,220' : '70,40,15'},0.05)`;
    g.fillRect(Math.random() * c.width, Math.random() * c.height, 2 + Math.random() * 10, 1);
  }
  const base = -1.575, ft = base + 5.8, half = base + 14;
  g.fillStyle = 'rgba(160,40,30,0.75)'; g.fillRect(X(-2.45), Z(base), 4.9 * ppm, (ft - base) * ppm); // key
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
    new THREE.MeshStandardMaterial({ map: courtTexture(), roughness: 0.45, metalness: 0 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set((GYM.xmin + GYM.xmax) / 2, 0, (GYM.zmin + GYM.zmax) / 2);
  floor.receiveShadow = true;
  scene.add(floor);
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x6b7690, roughness: 0.9 });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0x8a2a20, roughness: 0.8 });
  const wall = (w, h, x, y, z, ry) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), wallMat);
    m.position.set(x, y, z); m.rotation.y = ry; m.receiveShadow = true; scene.add(m);
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
  const glass = new THREE.MeshPhysicalMaterial({ color: 0xd8eef5, transparent: true, opacity: 0.28, roughness: 0.05, metalness: 0 });
  boxMesh(BOARD, glass).castShadow = false;
  // painted border + shooter's square on the board face
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
  for (let i = 0; i < 26000; i++) {             // pebble grain
    g.fillStyle = Math.random() < 0.5 ? 'rgba(255,190,140,0.10)' : 'rgba(80,25,5,0.12)';
    g.fillRect(Math.random() * W, Math.random() * H, 2, 2);
  }
  g.fillStyle = '#1a0d06';
  const dot = (x, y, z) => {                     // map a unit-sphere point to the UV canvas
    const theta = Math.acos(Math.max(-1, Math.min(1, y)));
    let phi = Math.atan2(z, -x); if (phi < 0) phi += Math.PI * 2;
    g.beginPath(); g.arc(phi / (Math.PI * 2) * W, theta / Math.PI * H, 3.2, 0, Math.PI * 2); g.fill();
  };
  const circle = (cx, cy, cz, ang) => {          // small circle around axis c with angular radius ang
    const ax = [cx, cy, cz];
    const up = Math.abs(cy) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const e1 = [ax[1] * up[2] - ax[2] * up[1], ax[2] * up[0] - ax[0] * up[2], ax[0] * up[1] - ax[1] * up[0]];
    const l = Math.hypot(...e1); e1[0] /= l; e1[1] /= l; e1[2] /= l;
    const e2 = [ax[1] * e1[2] - ax[2] * e1[1], ax[2] * e1[0] - ax[0] * e1[2], ax[0] * e1[1] - ax[1] * e1[0]];
    for (let t = 0; t < Math.PI * 2; t += 0.004) {
      const ct = Math.cos(t), st = Math.sin(t), ca = Math.cos(ang), sa = Math.sin(ang);
      dot(ca * ax[0] + sa * (ct * e1[0] + st * e2[0]), ca * ax[1] + sa * (ct * e1[1] + st * e2[1]), ca * ax[2] + sa * (ct * e1[2] + st * e2[2]));
    }
  };
  circle(0, 1, 0, Math.PI / 2);                  // equator
  circle(0, 0, 1, Math.PI / 2);                  // meridian
  circle(1, 0, 0, 0.92);                         // the two curved seams
  circle(-1, 0, 0, 0.92);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = maxAniso;
  return t;
}
const ballGeo = new THREE.SphereGeometry(BALL_R, 40, 24);
const ballMat = new THREE.MeshStandardMaterial({ map: ballTexture(), roughness: 0.75 });
function newBallMesh() {
  const m = new THREE.Mesh(ballGeo, ballMat); m.castShadow = true; m.receiveShadow = true; return m;
}

// Held ball (view model) lives in camera space.
const held = newBallMesh();
held.castShadow = false;
camera.add(held);

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

// ---------- trajectory trainer ----------
const trajGeo = new THREE.BufferGeometry();
const trajPos = new Float32Array(400 * 3);
trajGeo.setAttribute('position', new THREE.BufferAttribute(trajPos, 3));
const traj = new THREE.Points(trajGeo, new THREE.PointsMaterial({ color: 0x9fe8ff, size: 0.035, transparent: true, opacity: 0.8 }));
traj.frustumCulled = false; traj.visible = false;
scene.add(traj);

// ---------- audio ----------
let actx = null, noiseBuf = null;
function initAudio() {
  if (actx) return;
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
function sound(kind, speed, dist) {
  if (!actx) return;
  const v = Math.min(1, speed / 7) / (1 + dist * 0.12);
  if (v < 0.01) return;
  if (kind === 'floor') { tone(140, 55, 0.14, 0.9 * v); noise(400, 1, 0.06, 0.4 * v); }
  else if (kind === 'rim') { tone(620, 600, 0.45, 0.25 * v, 'triangle'); tone(1490, 1470, 0.3, 0.12 * v); noise(3000, 2, 0.05, 0.3 * v); }
  else if (kind === 'board') { tone(190, 120, 0.12, 0.7 * v); noise(900, 1, 0.08, 0.5 * v); }
  else if (kind === 'net') noise(2400, 0.8, 0.28, 0.35 * Math.min(1, speed));
  else if (kind === 'ball') tone(220, 120, 0.08, 0.4 * v);
  else { tone(330, 200, 0.12, 0.4 * v, 'triangle'); noise(1200, 1, 0.06, 0.3 * v); }
}

// ---------- game state ----------
const player = { p: new THREE.Vector3(0, 0, 6.5), v: new THREE.Vector3(), yaw: 0, pitch: 0.12, onGround: true, bob: 0 };
const input = { keys: new Set(), lmb: false, rmb: false };
const stats = { makes: 0, shots: 0, points: 0, streak: 0, best: 0 };
let hasBall = true, charging = false, chargeT = 0, lastSpeed = null, spinRev = 2;
let adsT = 0, timeScale = 1, trainer = false, locked = false, acc = 0;
const loose = [];                                 // { body, mesh }
let lastShot = null;

const $ = id => document.getElementById(id);
let msgTimer = 0;
function flash(text, color = '#ffd34d', dur = 1.4) {
  const m = $('msg'); m.textContent = text; m.style.color = color; m.style.opacity = 1; msgTimer = dur;
}

function resolveShot(b, made) {
  const s = b.shot; if (!s || s.resolved) return;
  s.resolved = true;
  if (made) {
    stats.makes++; stats.points += s.points; stats.streak++; stats.best = Math.max(stats.best, stats.streak);
    const swish = !s.rim && !s.board;
    const label = swish ? 'SWISH' : s.board && !s.rim ? 'BANK' : s.board ? 'OFF THE GLASS' : 'IN';
    flash(`${label}  +${s.points}`, swish ? '#7dffb0' : '#ffd34d');
  } else {
    stats.streak = 0;
    flash(!s.rim && !s.board ? 'AIRBALL' : 'MISS', '#ff7a6a', 1.0);
  }
  s.result = made ? 'made' : 'miss';
}

world.on((type, b, d) => {
  const L = loose.find(l => l.body === b);
  const dist = L ? L.mesh.position.distanceTo(camera.position) : 0;
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
  if (!locked) { input.lmb = input.rmb = false; charging = false; input.keys.clear(); }
});
addEventListener('contextmenu', e => e.preventDefault());
addEventListener('mousemove', e => {
  if (!locked) return;
  const s = SENS * (1 - 0.55 * adsT);
  player.yaw -= e.movementX * s;
  player.pitch = Math.max(-1.45, Math.min(1.45, player.pitch - e.movementY * s));
});
addEventListener('mousedown', e => {
  if (!locked) return;
  if (e.button === 0) { input.lmb = true; if (hasBall) { charging = true; chargeT = 0; } }
  if (e.button === 2) input.rmb = true;
});
addEventListener('mouseup', e => {
  if (e.button === 0) { input.lmb = false; if (charging && locked) shoot(); charging = false; }
  if (e.button === 2) input.rmb = false;
});
addEventListener('wheel', e => {
  if (!locked) return;
  spinRev = Math.max(-2, Math.min(5, Math.round((spinRev - Math.sign(e.deltaY) * 0.25) * 4) / 4));
}, { passive: true });
addEventListener('keydown', e => {
  if (!locked) return;
  input.keys.add(e.code);
  if (e.code === 'KeyR' && !hasBall) hasBall = true;
  if (e.code === 'KeyT') trainer = !trainer;
  if (e.code === 'KeyF') timeScale = timeScale === 1 ? 0.25 : 1;
  if (e.code === 'Space' && player.onGround) { player.v.y = JUMP_V; player.onGround = false; }
});
addEventListener('keyup', e => input.keys.delete(e.code));

// ---------- shooting ----------
const tmp = new THREE.Vector3(), fwd = new THREE.Vector3(), right = new THREE.Vector3(), up = new THREE.Vector3();
const gauss = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const chargeSpeed = () => Math.min(MAX_SPEED, MIN_SPEED + CHARGE_RATE * chargeT);

function currentSpread() {
  const moving = Math.hypot(player.v.x, player.v.z);
  const angle = THREE.MathUtils.lerp(HIP_SPREAD, ADS_SPREAD, adsT) + moving * (0.55 - 0.3 * adsT) + (player.onGround ? 0 : 0.5);
  const power = THREE.MathUtils.lerp(HIP_POWER, ADS_POWER, adsT) + moving * 0.004;
  return { angle, power };
}

function releasePoint(out) {
  camera.getWorldDirection(fwd);
  return out.copy(camera.position).addScaledVector(fwd, 0.35).add(tmp.set(0, -0.05, 0));
}
function backspinAxis(dir) {
  // w = s * normalize(dir x up) is backspin (top of ball rotates toward the shooter)
  const ax = new THREE.Vector3(dir.x, 0, dir.z).normalize().cross(new THREE.Vector3(0, 1, 0));
  return ax.lengthSq() < 1e-6 ? new THREE.Vector3(1, 0, 0) : ax.normalize();
}

function shoot() {
  const speed0 = chargeSpeed();
  const sp = currentSpread();
  camera.getWorldDirection(fwd);
  right.crossVectors(fwd, camera.up).normalize();
  up.crossVectors(right, fwd).normalize();
  const rad = sp.angle * Math.PI / 180;
  const dir = fwd.clone().addScaledVector(right, Math.tan(gauss() * rad)).addScaledVector(up, Math.tan(gauss() * rad)).normalize();
  const speed = speed0 * (1 + gauss() * sp.power);
  const v = dir.clone().multiplyScalar(speed).add(player.v);   // your momentum carries into the ball
  const w = backspinAxis(dir).multiplyScalar(spinRev * Math.PI * 2);
  const p = releasePoint(new THREE.Vector3());

  const body = makeBall(p, v, w);
  const fd = Math.hypot(player.p.x - RIM.x, player.p.z - RIM.z);
  const three = fd > THREE_PT || (Math.abs(player.p.x) > CORNER_X && player.p.z < CORNER_Z);
  body.shot = { points: three ? 3 : 2, rim: false, board: false, resolved: false, entry: null, t: 0 };
  const mesh = newBallMesh();
  mesh.quaternion.copy(held.getWorldQuaternion(new THREE.Quaternion()));
  scene.add(mesh);
  world.balls.push(body);
  loose.push({ body, mesh });
  while (loose.length > MAX_LOOSE) removeLoose(loose[0]);

  stats.shots++;
  lastSpeed = speed0;
  lastShot = { body, speed: speed0, actual: speed, angle: Math.asin(dir.y) * 180 / Math.PI, spin: spinRev, dist: fd };
  hasBall = false;
}

function removeLoose(l) {
  if (l.body.shot && !l.body.shot.resolved) resolveShot(l.body, false);
  scene.remove(l.mesh);
  world.balls.splice(world.balls.indexOf(l.body), 1);
  loose.splice(loose.indexOf(l), 1);
}

// ---------- update ----------
const keyDown = c => input.keys.has(c);
function updatePlayer(dt) {
  adsT = THREE.MathUtils.clamp(adsT + (input.rmb ? dt : -dt) / 0.22, 0, 1);
  const f = (keyDown('KeyW') ? 1 : 0) - (keyDown('KeyS') ? 1 : 0);
  const s = (keyDown('KeyD') ? 1 : 0) - (keyDown('KeyA') ? 1 : 0);
  const sprint = keyDown('ShiftLeft') && adsT < 0.1 && f > 0 && !charging;
  let speed = THREE.MathUtils.lerp(sprint ? SPRINT : WALK, ADS_WALK, adsT);
  const sinY = Math.sin(player.yaw), cosY = Math.cos(player.yaw);
  let wx = -sinY * f + cosY * s, wz = -cosY * f - sinY * s;
  const wl = Math.hypot(wx, wz); if (wl > 0) { wx /= wl; wz /= wl; } else speed = 0;
  const accel = player.onGround ? 14 : 2;
  const k = 1 - Math.exp(-accel * dt);
  player.v.x += (wx * speed - player.v.x) * k;
  player.v.z += (wz * speed - player.v.z) * k;
  player.v.y -= PLAYER_G * dt;
  player.p.addScaledVector(player.v, dt);
  if (player.p.y <= 0) { player.p.y = 0; player.v.y = 0; player.onGround = true; }
  const m = 0.4;
  player.p.x = THREE.MathUtils.clamp(player.p.x, GYM.xmin + m, GYM.xmax - m);
  player.p.z = THREE.MathUtils.clamp(player.p.z, GYM.zmin + m, GYM.zmax - m);
  const dx = player.p.x - POLE.x, dz = player.p.z - POLE.z, d = Math.hypot(dx, dz), minD = POLE.r + 0.06 + 0.35;
  if (d < minD) { player.p.x = POLE.x + dx / d * minD; player.p.z = POLE.z + dz / d * minD; }

  const hs = Math.hypot(player.v.x, player.v.z);
  if (player.onGround) player.bob += hs * dt * 1.7;
  const bob = Math.sin(player.bob * 2) * 0.025 * Math.min(1, hs / WALK) * (1 - 0.7 * adsT);
  camera.position.set(player.p.x, player.p.y + EYE + bob, player.p.z);
  camera.rotation.set(player.pitch, player.yaw, 0);
  const fov = THREE.MathUtils.lerp(FOV, ADS_FOV, adsT);
  if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }

  if (charging) chargeT += dt;

  // pick up loose balls you walk into
  if (!hasBall) {
    for (const l of loose) {
      if (l.body.age < 0.6) continue;
      const b = l.body.p;
      const hy = THREE.MathUtils.clamp(b.y, player.p.y + 0.2, player.p.y + EYE + 0.2);
      if (Math.hypot(b.x - player.p.x, b.y - hy, b.z - player.p.z) < 0.55) { removeLoose(l); hasBall = true; break; }
    }
  }
}

const q = new THREE.Quaternion(), ax = new THREE.Vector3();
function syncBalls(dt) {
  for (const l of loose) {
    const b = l.body;
    l.mesh.position.set(b.p.x, b.p.y, b.p.z);
    const wl = Math.hypot(b.w.x, b.w.y, b.w.z);
    if (wl > 1e-4) { q.setFromAxisAngle(ax.set(b.w.x / wl, b.w.y / wl, b.w.z / wl), wl * dt); l.mesh.quaternion.premultiply(q); }
    if (b.shot && !b.shot.resolved && b.age > 10) resolveShot(b, false);   // stuck on the rim, etc.
  }
}

const hipPos = new THREE.Vector3(0.34, -0.38, -0.9), adsPos = new THREE.Vector3(0.0, -0.45, -0.85);
function updateViewModel(dt) {
  held.visible = hasBall;
  if (!hasBall) return;
  held.position.lerpVectors(hipPos, adsPos, adsT);
  if (charging) held.position.y += Math.min(1, chargeT / 1.5) * 0.08;
  held.rotation.x -= spinRev * dt * 0.6;
}

function updateTrainer() {
  traj.visible = trainer && hasBall;
  if (!traj.visible) return;
  camera.updateMatrixWorld();
  camera.getWorldDirection(fwd);
  const speed = charging ? chargeSpeed() : lastSpeed ?? 7;
  const v = fwd.clone().multiplyScalar(speed).add(player.v);
  const w = backspinAxis(fwd).multiplyScalar(spinRev * Math.PI * 2);
  const pts = simulateFlight(releasePoint(new THREE.Vector3()), v, w, 3, 1 / 60);
  let n = 0;
  for (const q of pts) {
    if (n >= 400) break;
    if (Math.hypot(q.x - camera.position.x, q.y - camera.position.y, q.z - camera.position.z) < 1.5) continue;
    trajPos[n * 3] = q.x; trajPos[n * 3 + 1] = q.y; trajPos[n * 3 + 2] = q.z; n++;
  }
  trajGeo.setDrawRange(0, n);
  trajGeo.attributes.position.needsUpdate = true;
}

function updateHud(dt) {
  const pct = stats.shots ? Math.round(stats.makes / stats.shots * 100) : 0;
  $('stats').innerHTML = `<b>${stats.points}</b> pts<br>${stats.makes}/${stats.shots} (${pct}%) · streak ${stats.streak} · best ${stats.best}`;
  if (lastShot) {
    const s = lastShot.body.shot;
    $('last').innerHTML = `Last shot · ${lastShot.dist.toFixed(1)} m out<br>` +
      `release ${lastShot.speed.toFixed(2)} m/s (actual ${lastShot.actual.toFixed(2)}) @ ${lastShot.angle.toFixed(1)}°<br>` +
      `backspin ${lastShot.spin.toFixed(2)} rev/s` + (s.entry != null ? ` · entry ${s.entry.toFixed(1)}°` : '');
  }
  const cs = charging ? chargeSpeed() : null;
  $('plabel').textContent = hasBall
    ? `${cs != null ? cs.toFixed(2) + ' m/s' : 'hold LMB to charge'} · backspin ${spinRev.toFixed(2)} rev/s`
    : 'R for a new ball, or walk over a loose one';
  $('fill').style.width = cs != null ? ((cs - MIN_SPEED) / (MAX_SPEED - MIN_SPEED) * 100) + '%' : '0';
  const gh = $('ghost');
  if (lastSpeed != null) { gh.style.display = 'block'; gh.style.left = ((lastSpeed - MIN_SPEED) / (MAX_SPEED - MIN_SPEED) * 100) + '%'; }
  // crosshair gap = 2 sigma of the angular spread
  const sp = currentSpread();
  const gap = 4 + Math.tan(2 * sp.angle * Math.PI / 180) / Math.tan(camera.fov * Math.PI / 360) * (innerHeight / 2);
  const len = 8;
  Object.assign($('cl').style, { width: len + 'px', height: '2px', left: -(gap + len) + 'px', top: '-1px' });
  Object.assign($('cr').style, { width: len + 'px', height: '2px', left: gap + 'px', top: '-1px' });
  Object.assign($('cu').style, { width: '2px', height: len + 'px', left: '-1px', top: -(gap + len) + 'px' });
  Object.assign($('cd').style, { width: '2px', height: len + 'px', left: '-1px', top: gap + 'px' });
  $('modes').textContent = [timeScale < 1 ? 'SLOW-MO' : '', trainer ? 'TRAJECTORY TRAINER' : ''].filter(Boolean).join(' · ');
  if (msgTimer > 0) { msgTimer -= dt; if (msgTimer <= 0) $('msg').style.opacity = 0; }
}

let last = performance.now();
function frame(now) {
  const rdt = Math.min(0.05, (now - last) / 1000); last = now;
  const dt = rdt * timeScale;
  updatePlayer(dt);
  acc += dt;
  let n = 0;
  while (acc >= PHYS_DT && n++ < 40) { world.step(PHYS_DT); acc -= PHYS_DT; }
  syncBalls(dt);
  updateNet();
  updateViewModel(dt);
  updateTrainer();
  updateHud(rdt);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
