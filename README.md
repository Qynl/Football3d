# KICKOFF!

A fast, physics-driven **1v1 arcade football game** that runs in the browser.
One human footballer, one AI opponent, one ball, two goals, a compact arena and
no faffing about: you are playing within a couple of seconds of loading.

Everything here is original — geometry, characters, sounds and music are all
generated procedurally in code. No third-party assets, no artwork, no samples.

Built with **TypeScript + React + Vite**, rendered with **Three.js** on a
purpose-built deterministic physics solver.

```bash
npm install
npm run dev      # play at http://localhost:5173
npm test         # typecheck + 99 automated play-tests
npm run build    # production bundle
```

## Controls

| Action | Keyboard / mouse | Notes |
| --- | --- | --- |
| Move | `W A S D` | Camera-relative, arcade momentum |
| Sprint | `Shift` | Burns stamina |
| Jump | `Space` | Sets up volleys and aerial clearances |
| Kick | **Left mouse** (hold) | Continuous charge — tap for a touch, hold for a rocket |
| Lob | **Right mouse** while charging | Chips it over an advancing opponent |
| Curve | `A` / `D` late in the wind-up | Sideways input bends the ball, it does not spin your body |
| Tackle | `B` | Quick poke at the ball |
| Slide tackle | `Ctrl` | Big commitment, big reward, foul if you are late |
| Body challenge | `E` | Shoulder barge, momentum decides who wins |
| Pause | `Esc` | |

Bindings are remappable in **Settings → Controls**, and a gamepad is picked up
automatically if one is connected.

There is no auto-aim. Where the ball goes is decided by the direction you are
facing, your momentum, where your foot meets the ball and how long you charged.

## Modes

* **Quick Match** – first to 5, three minutes, golden goal if it is level.
* **Rule sets** – first to 3, first to 5, timed, golden goal.
* **Training** – free play with pop-up targets to shoot at.
* **Penalty Duel** – five kicks each, then sudden death.
* **Local 1v1** – two players on one keyboard.
* **Chaos** – giant/tiny ball, low gravity, super bounce, turbo, slippery pitch,
  huge/tiny goals, double ball, random bounce, meteor ball. Off by default.

## Arenas

Classic Stadium, Rooftop, Beach, Neon Arena, Ice Rink and Tiny Box. The
differences are mechanical, not cosmetic: pitch size, ground friction, rolling
resistance, player traction and how lively the boundary walls are. Ice really
is slippery; the Tiny Box really is chaos.

## The opponent

The AI is a hand-written utility-driven state machine with steering behaviours —
no machine learning, no scripted cheating. It shares the exact same `Footballer`
code as you, drives it through the same `ControlState` struct, and is subject to
the same speeds, accelerations, jump height, charge times, cooldowns and
physics. It only ever "aims" by physically turning, and its perception is
reaction-limited and slightly noisy.

* **Difficulties** – Easy, Normal, Hard, Expert change reaction time,
  anticipation, tackle skill, charge accuracy and mistake rate.
* **Personalities** – Balanced, Aggressive, Defensive, Fast, Risky, Technical and
  Chaos genuinely rewire the utility weights (pressing, line depth, shot range,
  slide appetite, lobs, curve).
* **Adaptation** – it watches your habits (how much you dribble, how often you
  press, where you shoot) and shifts its weights. It never gains extra physics.

## Architecture

```
src/
  core/        maths, RNG, easing
  physics/     deterministic ball world, colliders, capsule resolution
  ball/        ball body, spin, Magnus, designs
  player/      the Footballer: movement, kicking, tackling, fouls
  ai/          perception, personalities, adaptation, controller
  combat/      tackle/challenge outcomes (inside player + physics)
  match/       rules, match manager, training targets
  camera/      third-person rig with ball bias and shake
  arenas/      arena definitions, pitch textures, construction
  characters/  archetypes, cosmetics, procedural rigs
  effects/     particles, VFX, slow-mo/hitstop, replays
  audio/       synthesised SFX and music sequencer
  ui/          React UI: HUD, menus, screens, stores, styles
  storage/     localStorage save data
  input/       bindings, keyboard/mouse/gamepad
  debug/       collider and AI debug overlays
  game/        the Game shell that wires it all together
  main.tsx     React entry point: mounts the canvas host and the UI overlay
```

**React only owns the interface.** `main.tsx` renders the canvas host and the
overlay; an effect builds the `Game` once and hands it the host element. From
there the engine runs its own fixed-timestep loop and never re-renders through
React. The HUD and menus subscribe to two tiny external stores (`src/ui/store.ts`)
via `useSyncExternalStore` — the 60 Hz HUD store is diffed before it is written,
so a frame that changes nothing costs zero renders, and HUD updates never touch
the menu tree.

Gameplay runs on a fixed 120 Hz timestep with an accumulator, so the simulation
is deterministic and frame-rate independent. Physics is a purpose-built rigid
ball solver (impulses, restitution, rolling friction, angular velocity, Magnus
curve, quadratic drag) rather than a general physics engine — it is small,
predictable and testable in plain Node.

## Tests

`npm test` typechecks the project and then runs 99 play-tests in
`tests/run.ts` (Node loads the TypeScript and JSX sources directly through
`tests/loader.mjs`). They drive the real systems, not mocks:

* ball physics — settling, bouncing, rolling, wall rebounds, curve
* movement — acceleration, sprinting, stopping, jumping, ice vs grass
* kicking — charge curve, lobs, volleys, sidespin, power monotonicity
* goals and rules — swept-plane goal detection, posts, crossbar, own goals,
  golden goal, match end
* tackles, slides, body challenges, fouls and free kicks
* the AI — scoring against a passive opponent, difficulty ordering, legal speed
  limits, personality differences, long soaks without NaN
* determinism, all six arenas, penalty duels
* a full end-to-end boot of the real entry point (`src/main.tsx`) in jsdom with
  a WebGL shim: React mounts, the renderer, audio, storage and every game mode
  come up, real keyboard and mouse events drive the player, the rendered menus
  are asserted in the DOM, clicking the actual **PLAY** button starts a match,
  and the test fails on any React warning or error
