import type { ReactNode } from 'react';
import type { HudState, UiState } from '../uiTypes.ts';
import { cx } from './common.tsx';

function chargeLabel(s: HudState): string {
  if (s.lob) return 'LOB';
  if (s.charge < 0.12) return 'QUICK';
  if (s.charge < 0.42) return 'NORMAL';
  if (s.charge < 0.78) return 'POWER';
  return 'MAX POWER';
}

export function Hud({ hud, ui }: { hud: HudState; ui: UiState }): ReactNode {
  const visible = ui.screen === 'game' || ui.screen === 'pause';
  return (
    <div id="hud" className={cx(visible && 'visible')}>
      <div className="scoreboard">
        <div className="side">
          <span className="tag">{hud.nameA}</span>
          <span className="v">{hud.scoreA}</span>
        </div>
        <div className={cx('clock', hud.urgent && 'urgent')}>
          <div>{hud.time}</div>
          <div className="mode">{hud.mode}</div>
        </div>
        <div className="side">
          <span className="v">{hud.scoreB}</span>
          <span className="tag">{hud.nameB}</span>
        </div>
      </div>

      {/* Keyed so every new banner remounts the node and replays the pop animation. */}
      <div
        id="banner"
        key={ui.banner?.key ?? 'none'}
        className={cx(ui.bannerVisible && 'show')}
      >
        <div className="main">{ui.banner?.main ?? ''}</div>
        <div className="sub">{ui.banner?.sub ?? ''}</div>
      </div>

      <div className={cx('charge-wrap', hud.chargeActive && 'active')}>
        <div className="charge-bar">
          <div className="charge-fill" style={{ width: `${Math.round(hud.charge * 100)}%` }} />
          <div className="curve-indicator" style={{ left: `${50 + hud.curve * 46}%` }} />
        </div>
        <div className="charge-label">{chargeLabel(hud)}</div>
      </div>

      <div className="stamina">
        <div className="label">STAMINA</div>
        <div className="bar">
          <div className="fill" style={{ width: `${Math.round(hud.stamina)}%` }} />
        </div>
      </div>

      <div className="hud-corner">
        {hud.aiState ? (
          <>
            <b>{hud.aiState}</b>
            <br />
            {hud.aiRead}
          </>
        ) : null}
      </div>

      <div className="training-hud" style={{ display: hud.training ? 'block' : 'none' }}>
        {hud.training ? (
          <>
            {hud.training.score} PTS<small>{hud.training.last || 'hit the rings'}</small>
          </>
        ) : null}
      </div>

      <div id="debug-panel" className={cx(ui.debug.visible && 'visible')}>
        {ui.debug.visible ? ui.debug.text : ''}
      </div>

      <div className={cx('toast', ui.toastVisible && 'show')}>{ui.toast?.text ?? ''}</div>

      <div className="controls-hint">
        WASD move · SHIFT sprint · SPACE jump · HOLD L-CLICK kick · R-CLICK tackle · CTRL slide · E
        shove · Q lob · ESC pause
      </div>
    </div>
  );
}
