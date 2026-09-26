# Neon Ice 1v1 Hockey Sim

A React + Vite first-person 1v1 hockey simulator powered by Three.js.

## What's new

- React-rendered menu, HUD, stat panels, radar, live coach, and match screens.
- Vite dev/build pipeline with bundled Three.js.
- First-person simulation mode with pointer-lock mouse look and flick-boost shooting.
- Click-to-shoot mode with cursor aim.
- Adaptive rival AI that steals, rushes, shoots, and gets more aggressive as the game goes on.
- Stamina, shot power, skill multiplier, momentum, last-shot readout, and target-shot bonus.
- Neon arena visuals with bloom, glass, ice scratches, dynamic light rails, puck trails, goal horn, and particle ice spray.

## Run locally

```bash
npm install
npm run dev
```

The Vite server binds to `0.0.0.0:4173` for Arena live preview support.

## Production build

```bash
npm run build
npm run preview
```

## Modes

- **Simulation mode**: pointer-lock first-person mouse look. Hold left mouse to charge, move your mouse to aim/flick, release to shoot.
- **Click-to-shoot mode**: cursor aims at the ice/net. Click or hold-release to shoot.

## Controls

- `WASD` skate
- `SHIFT` sprint; stamina matters
- `SPACE` brake/recover
- `Mouse` aim/look
- `Hold LMB` charge shot
- `Release LMB` shoot
- `Right mouse` soft puck drag/deke
- `E` poke/check
- `M` switch mode
- `R` reset puck
