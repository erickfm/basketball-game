# Basketball Game

A first-person basketball shooting game in the browser, built around ball physics.

**Play:** https://erickfm.github.io/basketball-game/

## How to play

Aim at the hoop and click. Aim at the glass for a bank shot.

| Input | Action |
|---|---|
| `WASD` | Move |
| `Space` | Jump |
| Mouse | Aim |
| Click | Shoot |
| `RMB` | Zoom |

For now the throw is automatic: the ball is launched exactly at whatever the crosshair is on. Near the hoop, aim is measured on an upright plane through the rim, so you aim left/right and never have to fight for distance. Once the ball leaves your hand, the physics below decides what happens.

## Physics (`physics.js`)

- Gravity, quadratic air drag, and Magnus lift from spin.
- The ball is a hollow sphere (I = ⅔mr²). Every contact is an impulse with restitution and Coulomb friction at the contact point, so spin and velocity trade off: backspin softens rim and backboard hits, and the ball skids then rolls on the floor.
- The rim is a real torus. The backboard, bracket and arm are boxes, and the pole is a cylinder. Balls also collide with each other.
- The net is a verlet cloth that the ball pushes through and that slows the ball down.
- A basket counts only when the ball's center drops through the ring from above.
- Units are SI. A dropped ball from 1.8 m bounces back to about 1.23 m (regulation is 1.2–1.4 m).

`physics.js` has no rendering dependencies, so you can run it headless in Node.

## Run locally (with shot logging)

```sh
python3 devserver.py          # serves the game on http://localhost:8000 and collects shot logs
python3 tools/shotlog.py      # summarize every logged shot
python3 tools/shotlog.py --shot 7   # one shot in detail
```

Each shot is written to `logs/shots.jsonl` (not committed). A record includes:
- **Before the shot:** your position, movement and view angle, plus your mouse movement in the 600 ms before the click and recent frame times.
- **The launch:** the aim point, release point, speed and angle.
- **The flight:** the ball's position every frame, including where it was on your screen and whether it was on screen.
- **Contacts:** every rim, glass and floor hit, with the entry angle and the result.

On GitHub Pages there's no server, so press `L` to download the log instead.

Three.js is loaded from a CDN. There is no build step.
