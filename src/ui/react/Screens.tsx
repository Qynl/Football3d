import type { ReactNode } from 'react';
import type { ResultData, UiHost, UiState } from '../uiTypes.ts';
import { CardGrid, StatGrid } from './common.tsx';
import { arenaCards } from './Menu.tsx';

export function Pause({
  host,
  onSettings,
}: {
  host: UiHost;
  onSettings: () => void;
}): ReactNode {
  return (
    <div className="modal">
      <h1>PAUSED</h1>
      <div className="subtitle">Take a breath. The ball is not going anywhere.</div>
      <div className="actions">
        <button type="button" className="btn primary" onClick={() => host.resumeGame()}>
          RESUME
        </button>
        <button type="button" className="btn" onClick={() => host.rematch()}>
          RESTART MATCH
        </button>
        <button type="button" className="btn" onClick={onSettings}>
          SETTINGS
        </button>
        <button type="button" className="btn danger" onClick={() => host.quitToMenu()}>
          MAIN MENU
        </button>
      </div>
    </div>
  );
}

export function EndScreen({
  host,
  ui,
  result,
  onPickArenaView,
  patchSelection,
}: {
  host: UiHost;
  ui: UiState;
  result: ResultData | null;
  onPickArenaView: () => void;
  patchSelection: (patch: Partial<UiState['selection']>) => void;
}): ReactNode {
  if (ui.endView === 'arena') {
    return (
      <div className="modal">
        <h1 style={{ textAlign: 'center' }}>PICK A PITCH</h1>
        <CardGrid
          items={arenaCards()}
          active={ui.selection.arenaId}
          onPick={(id) => {
            patchSelection({ arenaId: id });
            host.storage.data.loadout.arena = id;
            host.storage.save();
            host.changeArena(id);
            host.rematch();
          }}
        />
        <div className="actions">
          <button type="button" className="btn danger" onClick={() => host.quitToMenu()}>
            MAIN MENU
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="modal">
      <div>
        <h1 style={{ textAlign: 'center' }}>{result?.title ?? ''}</h1>
        <div className="result-score">{result?.scoreLine ?? ''}</div>
        <div className="result-line">{result?.subtitle ?? ''}</div>
        <StatGrid entries={result?.stats ?? []} />
        <div className="actions">
          <button type="button" className="btn primary" onClick={() => host.rematch()}>
            REMATCH
            <small>Instant restart</small>
          </button>
          <button type="button" className="btn" onClick={onPickArenaView}>
            CHANGE ARENA
          </button>
          <button type="button" className="btn danger" onClick={() => host.quitToMenu()}>
            MAIN MENU
          </button>
        </div>
      </div>
    </div>
  );
}

function Kbd({ children }: { children: ReactNode }): ReactNode {
  return <span className="kbd">{children}</span>;
}

export function HowTo({ onDone }: { onDone: () => void }): ReactNode {
  return (
    <div className="modal modal-wide">
      <h1>HOW TO PLAY</h1>
      <div className="subtitle">Seven inputs. A thousand stupid, wonderful accidents.</div>
      <div className="hint">
        <p>
          <b>Move</b> <Kbd>W</Kbd>
          <Kbd>A</Kbd>
          <Kbd>S</Kbd>
          <Kbd>D</Kbd> — camera-relative. <b>Sprint</b> <Kbd>Shift</Kbd> (costs stamina).{' '}
          <b>Jump</b> <Kbd>Space</Kbd>.
        </p>
        <p>
          <b>Kick</b> — hold <Kbd>Left Click</Kbd>. Power grows continuously the longer you hold: a
          tap is a close-control touch, a full charge is a rocket you will probably mis-hit. Release
          any time.
        </p>
        <p>
          <b>Aim</b> — the ball leaves along the direction you are <i>running</i>, deflected by
          where your foot meets the ball and by your momentum. Run across the ball to slice it,
          sprint through it to add pace.
        </p>
        <p>
          <b>Curve</b> — hold <Kbd>A</Kbd> or <Kbd>D</Kbd> while charging to put sidespin on the
          shot. The Magnus force is real; the ball will bend around a defender.
        </p>
        <p>
          <b>Lob</b> — hold <Kbd>Q</Kbd> while kicking, or scoop the ball from underneath, to chip
          it over your opponent.
        </p>
        <p>
          <b>Air kicks</b> — jump and kick. Volleys, aerial clearances, desperate mid-air pokes: all
          legal, all physical. A falling kick is scrappier than a rising one.
        </p>
        <p>
          <b>Tackle</b> <Kbd>Right Click</Kbd> pokes at the ball. <b>Slide</b> <Kbd>Ctrl</Kbd>{' '}
          commits you to a long, fast challenge — it moves the ball hard, but hitting a player first
          is a foul. <b>Shove</b> <Kbd>E</Kbd> barges an opponent off the ball; do it far from the
          ball and it is a foul.
        </p>
        <p>
          <b>Camera</b> <Kbd>C</Kbd> toggles ball-cam and player-cam. Mouse nudges the view; it
          self-centres.
        </p>
        <p>
          <b>Everything bounces</b>: low walls, posts, crossbar, and your opponent. Own goals
          absolutely count.
        </p>
        <p>
          <Kbd>Esc</Kbd> pause · <Kbd>R</Kbd> instant rematch after a match · <Kbd>F3</Kbd> debug
          overlay.
        </p>
      </div>
      <div className="actions">
        <button type="button" className="btn primary" onClick={onDone}>
          GOT IT
        </button>
      </div>
    </div>
  );
}
