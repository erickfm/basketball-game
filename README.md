# Basketball Game

A first-person basketball shooting game in the browser, built around ball physics.

**Play:** https://erickfm.github.io/basketball-game/

## Controls

| Input | Action |
|---|---|
| `WASD` | Move (`Shift` sprint, `Space` jump) |
| Mouse | Look / aim. The ball leaves along your crosshair |
| Hold `LMB` | Charge launch speed. Release to shoot |
| Hold `RMB` | Aim down: zoom, slower movement, much tighter spread |
| Mouse wheel | Adjust backspin (-2 to 5 rev/s) |
| `R` | New ball (or walk over a loose one) |
| `T` | Trajectory trainer (shows the ideal flight path) |
| `F` | Slow motion |

## Why it's hard

- You choose the launch speed (shown in m/s, with a marker at your last shot) and the angle. Nothing is auto-aimed.
- Hip shots have about 1.8° of spread and 3% power noise. Aiming (RMB) cuts that to 0.3° and 0.6%. Moving or jumping adds more.
- Your movement carries into the ball, so shooting on the move changes the shot.
- From the free-throw line, only about half the speeds in a 0.4 m/s window go in, and clean swishes need about ±0.03 m/s.

## Physics (`physics.js`)

- Gravity, quadratic air drag, and Magnus lift from spin.
- The ball is a hollow sphere (I = ⅔mr²). Every contact is an impulse with restitution and Coulomb friction at the contact point, so spin and velocity trade off: backspin softens rim and backboard hits, and the ball skids then rolls on the floor.
- The rim is a real torus. The backboard, bracket and arm are boxes, and the pole is a cylinder. Balls also collide with each other.
- The net is a verlet cloth that the ball pushes through and that slows the ball down.
- A basket counts only when the ball's center drops through the ring from above.
- Units are SI. A dropped ball from 1.8 m bounces back to about 1.23 m (regulation is 1.2–1.4 m).

`physics.js` has no rendering dependencies, so you can run it headless in Node.

## Run locally

ES modules need a web server (opening the file directly won't work):

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

Three.js is loaded from a CDN. There is no build step.
