const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');
const W = 1000, H = 600;            // logical world size
const GRAVITY = 1400, BALL_R = 16, ROUND_TIME = 60;
const hoop = { x: 820, y: 230, w: 70 }; // rim from x to x+w
const rimL = { x: hoop.x, y: hoop.y }, rimR = { x: hoop.x + hoop.w, y: hoop.y };
const board = { x: hoop.x + hoop.w + 8, top: hoop.y - 110, bottom: hoop.y + 20 };

let scale = 1, offX = 0, offY = 0;
function resize() {
  canvas.width = innerWidth * devicePixelRatio;
  canvas.height = innerHeight * devicePixelRatio;
  scale = Math.min(canvas.width / W, canvas.height / H);
  offX = (canvas.width - W * scale) / 2;
  offY = (canvas.height - H * scale) / 2;
}
addEventListener('resize', resize); resize();

let state, ball, drag, msg;
function reset() {
  state = { score: 0, shots: 0, makes: 0, time: ROUND_TIME, over: false, best: +localStorageGet('best') || 0 };
  newSpot(); msg = null;
}
function localStorageGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function localStorageSet(k, v) { try { localStorage.setItem(k, v); } catch {} }
function newSpot() {
  const x = 120 + Math.random() * 380, y = 520;
  ball = { x, y, vx: 0, vy: 0, home: { x, y }, flying: false, touchedRim: false, scored: false, above: false };
}

function toWorld(e) {
  const r = canvas.getBoundingClientRect();
  return { x: ((e.clientX - r.left) * devicePixelRatio - offX) / scale,
           y: ((e.clientY - r.top) * devicePixelRatio - offY) / scale };
}
canvas.addEventListener('pointerdown', e => {
  if (state.over) { reset(); return; }
  const p = toWorld(e);
  if (!ball.flying && Math.hypot(p.x - ball.x, p.y - ball.y) < 80) drag = p;
});
canvas.addEventListener('pointermove', e => { if (drag) drag = toWorld(e); });
canvas.addEventListener('pointerup', () => {
  if (!drag) return;
  const dx = ball.x - drag.x, dy = ball.y - drag.y;
  const pull = Math.min(Math.hypot(dx, dy), 220);
  if (pull > 15) {
    const a = Math.atan2(dy, dx), power = pull * 6.5;
    ball.vx = Math.cos(a) * power; ball.vy = Math.sin(a) * power;
    ball.flying = true; state.shots++;
  }
  drag = null;
});

function collidePoint(p) {
  const dx = ball.x - p.x, dy = ball.y - p.y, d = Math.hypot(dx, dy);
  if (d < BALL_R + 3 && d > 0) {
    const nx = dx / d, ny = dy / d, dot = ball.vx * nx + ball.vy * ny;
    if (dot < 0) { ball.vx -= 1.6 * dot * nx; ball.vy -= 1.6 * dot * ny; }
    ball.x = p.x + nx * (BALL_R + 3); ball.y = p.y + ny * (BALL_R + 3);
    ball.touchedRim = true;
  }
}

function update(dt) {
  if (state.over) return;
  state.time -= dt;
  if (state.time <= 0) {
    state.time = 0; state.over = true;
    if (state.score > state.best) { state.best = state.score; localStorageSet('best', state.best); }
    return;
  }
  if (!ball.flying) return;
  const steps = 4, h = dt / steps;
  for (let i = 0; i < steps; i++) {
    ball.vy += GRAVITY * h;
    const prevY = ball.y;
    ball.x += ball.vx * h; ball.y += ball.vy * h;
    collidePoint(rimL); collidePoint(rimR);
    // backboard
    if (ball.x + BALL_R > board.x && ball.x < board.x + 10 && ball.y > board.top && ball.y < board.bottom && ball.vx > 0) {
      ball.x = board.x - BALL_R; ball.vx *= -0.6;
    }
    // score: ball center passes downward through rim plane between the rim points
    if (!ball.scored && prevY < hoop.y && ball.y >= hoop.y && ball.vy > 0 &&
        ball.x > rimL.x + 4 && ball.x < rimR.x - 4) {
      ball.scored = true;
      const pts = ball.touchedRim ? 2 : 3;
      state.score += pts; state.makes++;
      msg = { text: ball.touchedRim ? '+2' : 'SWISH! +3', t: 1 };
    }
    // floor
    if (ball.y + BALL_R > H - 40) { ball.y = H - 40 - BALL_R; ball.vy *= -0.5; ball.vx *= 0.8; }
  }
  const settled = ball.y + BALL_R >= H - 41 && Math.abs(ball.vy) < 60;
  if (settled || ball.x < -50 || ball.x > W + 50) {
    if (ball.scored) newSpot();
    else { ball.x = ball.home.x; ball.y = ball.home.y; ball.vx = ball.vy = 0; ball.flying = false; ball.touchedRim = false; }
  }
}

function drawBall(x, y) {
  ctx.fillStyle = '#e8772e'; ctx.beginPath(); ctx.arc(x, y, BALL_R, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#3a1d0a'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(x, y, BALL_R, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x - BALL_R, y); ctx.lineTo(x + BALL_R, y); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x, y - BALL_R); ctx.lineTo(x, y + BALL_R); ctx.stroke();
}

function draw() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#1b1f2a'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(scale, 0, 0, scale, offX, offY);
  // court
  ctx.fillStyle = '#2a3142'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#c99a5b'; ctx.fillRect(0, H - 40, W, 40);
  // pole + backboard
  ctx.fillStyle = '#888'; ctx.fillRect(board.x + 14, board.top + 40, 10, H - 40 - board.top - 40);
  ctx.fillStyle = '#f2f2f2'; ctx.fillRect(board.x, board.top, 10, board.bottom - board.top);
  // net
  ctx.strokeStyle = '#ddd'; ctx.lineWidth = 1.5;
  for (let i = 0; i <= 4; i++) {
    ctx.beginPath(); ctx.moveTo(hoop.x + i * hoop.w / 4, hoop.y);
    ctx.lineTo(hoop.x + 14 + i * (hoop.w - 28) / 4, hoop.y + 45); ctx.stroke();
  }
  // trajectory preview
  if (drag) {
    const dx = ball.x - drag.x, dy = ball.y - drag.y;
    const pull = Math.min(Math.hypot(dx, dy), 220), a = Math.atan2(dy, dx), p = pull * 6.5;
    let vx = Math.cos(a) * p, vy = Math.sin(a) * p, x = ball.x, y = ball.y;
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    for (let i = 0; i < 18; i++) {
      for (let j = 0; j < 3; j++) { vy += GRAVITY / 60; x += vx / 60; y += vy / 60; }
      ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
    }
  }
  drawBall(ball.x, ball.y);
  // rim (drawn over ball so it looks like it goes through)
  ctx.strokeStyle = '#e03b2f'; ctx.lineWidth = 5;
  ctx.beginPath(); ctx.moveTo(rimL.x, rimL.y); ctx.lineTo(rimR.x + 8, rimR.y); ctx.stroke();
  // HUD
  ctx.fillStyle = '#fff'; ctx.font = 'bold 28px system-ui, sans-serif'; ctx.textAlign = 'left';
  ctx.fillText(`Score: ${state.score}`, 24, 44);
  ctx.font = '18px system-ui, sans-serif';
  ctx.fillText(`Makes: ${state.makes}/${state.shots}   Best: ${state.best}`, 24, 72);
  ctx.textAlign = 'right'; ctx.font = 'bold 28px system-ui, sans-serif';
  ctx.fillText(`${Math.ceil(state.time)}s`, W - 24, 44);
  if (msg && msg.t > 0) {
    ctx.textAlign = 'center'; ctx.globalAlpha = msg.t; ctx.fillStyle = '#ffd34d';
    ctx.font = 'bold 40px system-ui, sans-serif'; ctx.fillText(msg.text, hoop.x + hoop.w / 2, hoop.y - 130);
    ctx.globalAlpha = 1;
  }
  if (state.over) {
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center';
    ctx.font = 'bold 56px system-ui, sans-serif'; ctx.fillText(`Final score: ${state.score}`, W / 2, H / 2 - 10);
    ctx.font = '24px system-ui, sans-serif'; ctx.fillText('Click to play again', W / 2, H / 2 + 36);
  } else if (state.shots === 0 && !ball.flying) {
    ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.font = '22px system-ui, sans-serif';
    ctx.fillText('Drag back from the ball and release to shoot', W / 2, H / 2);
  }
}

let last = performance.now();
function loop(now) {
  const dt = Math.min((now - last) / 1000, 1 / 30); last = now;
  update(dt);
  if (msg) msg.t -= dt;
  draw();
  requestAnimationFrame(loop);
}
reset();
requestAnimationFrame(loop);
