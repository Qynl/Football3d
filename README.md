# Neon Ice 1v1 Hockey Sim

A React + Vite first-person 1v1 hockey simulator powered by Three.js.

## Latest upgrade

- Darker, less blown-out rink lighting: lower exposure, lower bloom, darker ice, dimmer HUD glass, vignette, and restrained neon.
- Active goalies at both nets with lateral tracking, save animations, rebounds, and save feedback.
- Real puck elevation: mouse pitch controls low/high shots, crossbars happen, and target snipes beat the goalie.
- Better game feel: tighter sprint/fatigue tuning, dynamic camera FOV, post clanks, less visual washout, and clearer puck/radar feedback.
- Smarter pressure: rival AI gets more aggressive with score/time momentum and goalies force actual shot placement instead of free goals.
- Target-shot bonus still rewards real mouse aim in simulation mode.

## Core features

- React-rendered menu, HUD, stat panels, radar, live coach, and match screens.
- Vite dev/build pipeline with bundled Three.js.
- First-person simulation mode with pointer-lock mouse look and flick-boost shooting.
- Click-to-shoot mode with cursor aim.
- Adaptive rival AI that steals, rushes, shoots, and gets more aggressive as the game goes on.
- Stamina, shot power, skill multiplier, momentum, last-shot readout, and target-shot bonus.
- Neon arena visuals with glass, ice scratches, dynamic light rails, puck trails, goal horn, and particle ice spray.

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
- `Mouse` aim/look; in simulation mode pitch controls shot height
- `Hold LMB` charge shot
- `Release LMB` shoot
- `Right mouse` soft puck drag/deke
- `E` poke/check
- `M` switch mode
- `R` reset puck
