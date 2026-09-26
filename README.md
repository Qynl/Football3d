# Neon Ice 1v1 Hockey Sim

A first-person 1v1 hockey simulator built with Three.js. The required Three.js runtime files are vendored in `vendor/three`, so the game does not need a CDN to run.

## Play

Open `index.html` with a local web server. For example:

```bash
python3 -m http.server 4173 --bind 0.0.0.0
```

Then visit the served URL.

## Modes

- **Simulation mode**: pointer-lock first-person mouse look. Hold left mouse to charge, move your mouse to aim/flick, release to shoot.
- **Click-to-shoot mode**: cursor aims at the ice/net. Click or hold-release to shoot.

## Controls

- `WASD` skate
- `SHIFT` sprint
- `SPACE` brake
- `Mouse` aim/look
- `Hold LMB` charge shot
- `Release LMB` shoot
- `Right mouse` soft puck drag/deke
- `E` poke/check
- `M` switch mode
- `R` reset puck
