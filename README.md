# Basketball Game

A first-person basketball shooting game in the browser, built around ball physics.

**Play:** https://erickfm.github.io/basketball-game/

## How to play

Put the crosshair on the rim, or on the glass for a bank shot. **Click to shoot. Space to jump.** That's it.

| Input | Action |
|---|---|
| `WASD` | Move |
| Mouse | Aim |
| `LMB` | Shoot |
| `RMB` | Focus: slight zoom, steadier hands |
| `Space` | Jump (click in the air for a jump shot) |
| `R` | Get a ball right away (otherwise it's passed back to you) |
| `F` | Slow motion |

There's no power meter. You throw the right amount for wherever you're aiming, like a real shooter. What decides the shot is **when you release**. Jump shots are the best shot in the game if you time them. Set shots from the floor work up close but get shakier with distance:

- **The ball leaves with your hand's speed plus your body's speed.** Shoot at the top of your jump and your body adds nothing, so the shot is pure. Early (still rising) and it flies long. Late (falling) and it drops short. Drifting sideways or forward pushes the ball the same way.
- The ring around the crosshair tightens as you reach the top of the jump and turns **green** in the perfect window (about ±25 ms). There's a little hang time at the top to give you a chance.
- A sloppy release also adds sidespin, which curves the ball and changes how it comes off the rim.
- From the free-throw line, swishes need about ±30 ms and makes about ±55 ms. Further out, the window is tighter.
- The depth comes from those rules: stop before you pull up, compensate when you fade or drift, aim at the glass for bank shots (the top corner of the square works), and read your release timing, drift and entry angle in the top-right after every shot.

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
