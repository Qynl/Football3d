import { useState, type ReactNode } from 'react';
import { ACTIONS, prettyKey, type ActionId } from '../../input/bindings.ts';
import type { UiHost, UiState } from '../uiTypes.ts';
import { Pill, Tabs, cx } from './common.tsx';

function Row({ label, children }: { label: string; children: ReactNode }): ReactNode {
  return (
    <div className="row">
      <label>{label}</label>
      <div>{children}</div>
    </div>
  );
}

function Slider({
  label,
  min,
  max,
  step,
  value,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
}): ReactNode {
  return (
    <Row label={label}>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span style={{ minWidth: 42, textAlign: 'right' }}>{value.toFixed(2)}</span>
    </Row>
  );
}

function Toggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}): ReactNode {
  return (
    <div className="row">
      <label>{label}</label>
      <button type="button" className={cx('tab', value && 'active')} onClick={() => onChange(!value)}>
        {value ? 'ON' : 'OFF'}
      </button>
    </div>
  );
}

export function Settings({
  host,
  ui,
  onBack,
  onChange,
  setListening,
}: {
  host: UiHost;
  ui: UiState;
  onBack: () => void;
  onChange: () => void;
  setListening: (v: { player: number; action: ActionId } | null) => void;
}): ReactNode {
  const [tab, setTab] = useState(0);
  const s = host.storage.data.settings;

  // Settings are mutable plain data; every edit commits and re-applies live.
  const commit = (): void => {
    host.storage.save();
    host.applySettings();
    onChange();
  };

  const listenFor = (player: number, action: ActionId): void => {
    setListening({ player, action });
    host.input.captureCallback = (code: string) => {
      host.storage.data.bindings[player][action] = code;
      host.storage.save();
      host.applySettings();
      host.input.captureCallback = null;
      setListening(null);
    };
  };

  const bindingList = (playerIndex: number): ReactNode => (
    <div>
      <div className="hint" style={{ marginBottom: 10 }}>
        {playerIndex === 0
          ? 'Player 1 (also supports gamepad 1: left stick move, A jump, X kick, B tackle, Y shove, LB slide, RT sprint).'
          : 'Player 2 for LOCAL 1v1 (gamepad 2 works too).'}
      </div>
      {ACTIONS.map((action) => {
        const listening =
          ui.listeningFor?.player === playerIndex && ui.listeningFor.action === action.id;
        return (
          <div className="keybind" key={action.id}>
            <div>
              <div>{action.label}</div>
              {action.hint ? <div className="hint">{action.hint}</div> : null}
            </div>
            <button
              type="button"
              className={cx(listening && 'listening')}
              onClick={() => listenFor(playerIndex, action.id)}
            >
              {listening
                ? 'PRESS...'
                : prettyKey(host.storage.data.bindings[playerIndex][action.id])}
            </button>
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="modal modal-wide">
      <h1>SETTINGS</h1>
      <Tabs
        tabs={['GENERAL', 'CONTROLS P1', 'CONTROLS P2']}
        active={tab}
        onPick={(i) => {
          setTab(i);
          host.audio.play('ui');
        }}
      />

      <div className={cx('tab-body', tab === 0 && 'active')}>
        {tab === 0 ? (
          <div>
            <Slider
              label="Master volume"
              min={0}
              max={1}
              step={0.05}
              value={s.masterVolume}
              onChange={(v) => {
                s.masterVolume = v;
                commit();
              }}
            />
            <Slider
              label="Sound effects"
              min={0}
              max={1}
              step={0.05}
              value={s.sfxVolume}
              onChange={(v) => {
                s.sfxVolume = v;
                commit();
              }}
            />
            <Slider
              label="Music"
              min={0}
              max={1}
              step={0.05}
              value={s.musicVolume}
              onChange={(v) => {
                s.musicVolume = v;
                commit();
              }}
            />
            <Slider
              label="Mouse sensitivity"
              min={0.2}
              max={3}
              step={0.1}
              value={s.mouseSensitivity}
              onChange={(v) => {
                s.mouseSensitivity = v;
                commit();
              }}
            />
            <Slider
              label="Screen shake"
              min={0}
              max={1.5}
              step={0.1}
              value={s.screenShake}
              onChange={(v) => {
                s.screenShake = v;
                commit();
              }}
            />
            <Toggle
              label="Invert look Y"
              value={s.invertY}
              onChange={(v) => {
                s.invertY = v;
                commit();
              }}
            />
            <Row label="Camera">
              <Pill
                options={[
                  { id: 'ball', name: 'BALL' },
                  { id: 'player', name: 'PLAYER' },
                ]}
                isActive={(id) => s.cameraMode === id}
                onPick={(id) => {
                  s.cameraMode = id as 'ball' | 'player';
                  commit();
                }}
              />
            </Row>
            <Row label="Quality">
              <Pill
                options={[
                  { id: 'low', name: 'LOW' },
                  { id: 'medium', name: 'MEDIUM' },
                  { id: 'high', name: 'HIGH' },
                ]}
                isActive={(id) => s.quality === id}
                onPick={(id) => {
                  s.quality = id as 'low' | 'medium' | 'high';
                  commit();
                }}
              />
            </Row>
            <Toggle
              label="Shadows"
              value={s.shadows}
              onChange={(v) => {
                s.shadows = v;
                commit();
              }}
            />
            <Toggle
              label="Goal replays"
              value={s.showReplays}
              onChange={(v) => {
                s.showReplays = v;
                commit();
              }}
            />
            <Toggle
              label="Debug overlay (F3)"
              value={s.debug}
              onChange={(v) => {
                s.debug = v;
                commit();
              }}
            />
            <div className="actions">
              <button
                type="button"
                className="btn ghost"
                onClick={() => {
                  host.storage.reset();
                  location.reload();
                }}
              >
                RESET EVERYTHING
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <div className={cx('tab-body', tab === 1 && 'active')}>{tab === 1 ? bindingList(0) : null}</div>
      <div className={cx('tab-body', tab === 2 && 'active')}>{tab === 2 ? bindingList(1) : null}</div>

      <div className="actions">
        <button type="button" className="btn primary" onClick={onBack}>
          BACK
        </button>
      </div>
    </div>
  );
}
