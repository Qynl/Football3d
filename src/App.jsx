import { useEffect } from 'react';

const statCards = [
  ['Speed', 'speed-readout', '0.0 m/s'],
  ['Puck', 'possession-readout', 'loose'],
  ['Shot', 'shot-readout', 'ready'],
  ['Stick', 'stick-readout', 'neutral'],
  ['Momentum', 'momentum-readout', 'neutral'],
];

function StatLine({ label, id, fallback }) {
  return (
    <div className="stat-line">
      <span>{label}</span>
      <strong id={id}>{fallback}</strong>
    </div>
  );
}

function Hud() {
  return (
    <div id="hud" className="hud hidden">
      <div className="scoreboard glass-panel">
        <div className="team you">YOU <span id="player-score">0</span></div>
        <div className="clock" id="game-clock">03:00</div>
        <div className="team rival"><span id="rival-score">0</span> RIVAL</div>
      </div>

      <div className="top-left glass-panel">
        <div className="mode-pill" id="mode-pill">SIMULATION</div>
        {statCards.map(([label, id, fallback]) => (
          <StatLine key={id} label={label} id={id} fallback={fallback} />
        ))}
        <div className="meter-stack">
          <div className="mini-meter-label"><span>Stamina</span><strong id="stamina-readout">100%</strong></div>
          <div className="mini-meter"><div id="stamina-fill" /></div>
          <div className="mini-meter-label"><span>Skill bonus</span><strong id="skill-readout">x1.0</strong></div>
          <div className="mini-meter skill"><div id="skill-fill" /></div>
          <div className="mini-meter-label"><span>Focus</span><strong id="focus-readout">0%</strong></div>
          <div className="mini-meter focus"><div id="focus-fill" /></div>
        </div>
      </div>

      <div className="coach-panel glass-panel">
        <div className="coach-title">Live Coach</div>
        <div id="coach-tip">Win the faceoff. Use mouse movement while charging for extra shot power.</div>
      </div>

      <div className="radar glass-panel" aria-label="Rink radar">
        <div className="radar-title">Radar</div>
        <div className="radar-rink">
          <div className="radar-line center" />
          <div className="radar-line blue-a" />
          <div className="radar-line blue-b" />
          <div id="radar-player" className="radar-dot player" />
          <div id="radar-rival" className="radar-dot rival" />
          <div id="radar-puck" className="radar-dot puck" />
        </div>
      </div>

      <div className="shot-card glass-panel">
        <span>LAST SHOT</span>
        <strong id="last-shot-speed">-- km/h</strong>
        <small id="last-shot-type">Charge a shot</small>
      </div>

      <div className="power-wrap glass-panel">
        <span>SHOT POWER</span>
        <div className="power-track"><div id="power-fill" /></div>
      </div>

      <div id="crosshair" className="crosshair">
        <span /><span /><span /><span />
      </div>

      <div id="toast" className="toast">Win the faceoff. Make it filthy.</div>

      <div className="help glass-panel">
        <b>Controls</b>
        <p><span>WASD</span> skate · <span>SHIFT</span> sprint · <span>Mouse</span> aim/look + blade</p>
        <p><span>Hold LMB</span> charge · <span>Flick mouse</span> shape shot · <span>Right mouse</span> deke</p>
        <p><span>E</span> poke/check · <span>F</span> focus mode · <span>M</span> mode · <span>R</span> reset</p>
      </div>
    </div>
  );
}

function StartScreen() {
  return (
    <div id="start-screen" className="start-screen">
      <div className="hero-card">
        <div className="eyebrow">REACT + VITE · FIRST PERSON · ONE V ONE · REAL MOUSE AIM</div>
        <h1>NEON ICE</h1>
        <h2>1v1 Hockey Simulator</h2>
        <p>
          Darker arena, tighter controls, smarter rival pressure, diving goalies, curved shots,
          real puck elevation, body checks, focus mode, shot preview, live radar, and mouse-flick shooting.
        </p>

        <div className="feature-strip">
          <div><strong>Pointer-lock sim</strong><span>pitch + flick aim</span></div>
          <div><strong>Real rebounds</strong><span>dives + saves</span></div>
          <div><strong>Adaptive AI</strong><span>dekes + snipes</span></div>
          <div><strong>Focus mode</strong><span>slow ice + boost</span></div>
        </div>

        <div className="mode-grid">
          <button id="start-sim" className="primary-action">
            <strong>Simulation mode</strong>
            <span>Pointer lock, mouse-look, stamina, manual shot aiming, flick-boost release.</span>
          </button>
          <button id="start-click" className="secondary-action">
            <strong>Click-to-shoot mode</strong>
            <span>Mouse cursor aims at the ice/goal, click or hold-release to fire.</span>
          </button>
        </div>
        <div className="tip-row">
          <span>Pro tip:</span> Build Focus with dekes/checks, press F, then follow the preview line and rip a curved release.
        </div>
      </div>
    </div>
  );
}

function EndScreen() {
  return (
    <div id="end-screen" className="end-screen hidden">
      <div className="hero-card compact">
        <div className="eyebrow">FINAL HORN</div>
        <h1 id="final-title">YOU WIN</h1>
        <p id="final-copy">Run it back?</p>
        <button id="restart" className="primary-action single">Restart Match</button>
      </div>
    </div>
  );
}

export default function App() {
  useEffect(() => {
    let cancelled = false;
    import('./game/neonIceGame.js').then((module) => {
      if (!cancelled && module?.bootNeonIce) module.bootNeonIce();
    });
    return () => {
      cancelled = true;
      window.__NEON_ICE_DISPOSE__?.();
    };
  }, []);

  return (
    <>
      <div id="game-root" />
      <Hud />
      <StartScreen />
      <EndScreen />
    </>
  );
}
