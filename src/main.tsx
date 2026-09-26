/**
 * Page entry point.
 *
 * React owns the document: it renders the canvas host, the UI overlay and the
 * loading curtain. The game engine itself is a plain imperative object that is
 * created once, inside an effect, and handed the canvas host to render into -
 * React never re-renders the simulation, and the simulation never touches the
 * DOM outside its canvas.
 */
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import './ui/styles.css';
import { Game } from './game/game.ts';
import { UiView } from './ui/ui.tsx';

function Loader({ done }: { done: boolean }): ReactElement {
  return (
    <div id="loading" className={done ? 'hidden' : ''}>
      <div style={{ textAlign: 'center' }}>
        <div className="loader-ball" />
        <div
          style={{
            fontWeight: 900,
            letterSpacing: '3px',
            fontSize: '13px',
            color: '#9fb0d0',
          }}
        >
          WARMING UP THE PITCH
        </div>
      </div>
    </div>
  );
}

function Kickoff(): ReactElement {
  const hostRef = useRef<HTMLDivElement>(null);
  const started = useRef(false);
  const [game, setGame] = useState<Game | null>(null);
  const [warm, setWarm] = useState(false);

  useEffect(() => {
    // Guard against React 19's double-invoked effects in development: the
    // engine allocates a WebGL context and must only ever exist once.
    if (started.current || !hostRef.current) return;
    started.current = true;

    const g = new Game(hostRef.current);
    g.start();
    setGame(g);
    // Handy for poking at the simulation from the console.
    (window as unknown as { KICKOFF: Game }).KICKOFF = g;

    // Drop the curtain once the renderer has actually put pixels on screen.
    requestAnimationFrame(() => requestAnimationFrame(() => setWarm(true)));

    // Browsers only allow audio after a gesture, so wake it on the first one.
    const wake = (): void => {
      g.audio.init();
      if (!g.audio.ready) return;
      const s = g.storage.data.settings;
      g.audio.setVolumes(s.masterVolume, s.sfxVolume, s.musicVolume);
      g.audio.startMusic('menu');
      window.removeEventListener('pointerdown', wake);
      window.removeEventListener('keydown', wake);
    };
    window.addEventListener('pointerdown', wake);
    window.addEventListener('keydown', wake);
    return () => {
      window.removeEventListener('pointerdown', wake);
      window.removeEventListener('keydown', wake);
    };
  }, []);

  return (
    <>
      <div id="app" ref={hostRef} />
      <div id="ui-root">{game ? <UiView ui={game.ui} /> : null}</div>
      <Loader done={warm} />
    </>
  );
}

createRoot(document.getElementById('root')!).render(<Kickoff />);
