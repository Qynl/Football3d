import type { ReactNode } from 'react';
import { ARENAS } from '../../arenas/arenaDefs.ts';
import { CHAOS_MODIFIERS, RULE_PRESETS, type GameMode } from '../../match/rules.ts';
import { DIFFICULTIES, PERSONALITIES } from '../../ai/personalities.ts';
import type { UiHost, UiState } from '../uiTypes.ts';
import { CardGrid, Pill, StatGrid, hexColor } from './common.tsx';

export function arenaCards(): { id: string; name: string; desc: string; color: string }[] {
  return ARENAS.map((a) => ({
    id: a.id,
    name: a.name,
    desc: a.blurb,
    color: `linear-gradient(140deg, ${hexColor(a.theme.sky)}, ${hexColor(a.theme.grassA)} 60%, ${hexColor(
      a.theme.wallAccent,
    )})`,
  }));
}

interface MenuProps {
  host: UiHost;
  ui: UiState;
  onStart: (mode: GameMode) => void;
  onShow: (screen: 'customize' | 'settings' | 'howto') => void;
  patchSelection: (patch: Partial<UiState['selection']>) => void;
}

export function Menu({ host, ui, onStart, onShow, patchSelection }: MenuProps): ReactNode {
  const sel = ui.selection;
  const stats = host.storage.data.stats;
  const click = () => host.audio.play('ui');

  const pickArena = (id: string): void => {
    click();
    patchSelection({ arenaId: id });
    host.storage.data.loadout.arena = id;
    host.storage.save();
  };

  return (
    <>
      <div className="menu-backdrop" />
      <div className="menu-wrap">
        <div className="brand">
          <h1 className="logo">
            KICK<span>OFF!</span>
          </h1>
          <p className="tagline">
            One player. One opponent. One ball, and physics that do not care about your feelings.
            Charge your shots, volley them out of the air, slide in late and accept the
            consequences.
          </p>
          <div className="menu-buttons">
            <button type="button" className="btn primary" onClick={() => onStart('quick')}>
              PLAY
              <small>First whistle in 3 seconds</small>
            </button>
            <button type="button" className="btn" onClick={() => onStart('training')}>
              TRAINING
              <small>Free play + targets</small>
            </button>
            <button type="button" className="btn" onClick={() => onStart('local')}>
              LOCAL 1v1
              <small>Two players, one keyboard</small>
            </button>
            <button type="button" className="btn" onClick={() => onStart('penalty')}>
              PENALTY DUEL
              <small>Best of five</small>
            </button>
            <button type="button" className="btn" onClick={() => onStart('chaos')}>
              CHAOS MODE
              <small>Rules optional</small>
            </button>
            <div style={{ height: 6 }} />
            <button type="button" className="btn ghost" onClick={() => onShow('customize')}>
              CUSTOMIZE
            </button>
            <button type="button" className="btn ghost" onClick={() => onShow('settings')}>
              SETTINGS
            </button>
            <button type="button" className="btn ghost" onClick={() => onShow('howto')}>
              HOW TO PLAY
            </button>
          </div>
        </div>

        <div className="setup-grid">
          <div className="panel">
            <h2>Arena</h2>
            <CardGrid items={arenaCards()} active={sel.arenaId} onPick={pickArena} />
          </div>

          <div className="panel">
            <h2>Opponent</h2>
            <div className="hint" style={{ marginBottom: 6 }}>
              Skill
            </div>
            <Pill
              options={DIFFICULTIES}
              isActive={(id) => sel.difficulty === id}
              onPick={(id) => {
                click();
                patchSelection({ difficulty: id });
                host.storage.data.loadout.difficulty = id;
                host.storage.save();
              }}
            />
            <div className="hint" style={{ margin: '10px 0 6px' }}>
              Personality
            </div>
            <Pill
              options={PERSONALITIES}
              isActive={(id) => sel.personality === id}
              titleOf={(o) => PERSONALITIES.find((p) => p.id === o.id)?.blurb}
              onPick={(id) => {
                click();
                patchSelection({ personality: id });
                host.storage.data.loadout.personality = id;
                host.storage.save();
              }}
            />
            <div className="hint" style={{ marginTop: 8 }}>
              {PERSONALITIES.find((p) => p.id === sel.personality)?.blurb ?? ''}
            </div>
          </div>

          <div className="panel">
            <h2>Match rules</h2>
            <Pill
              options={RULE_PRESETS}
              isActive={(id) => sel.rulesId === id}
              onPick={(id) => {
                click();
                patchSelection({ rulesId: id });
              }}
            />
            <div className="hint" style={{ marginTop: 8 }}>
              {RULE_PRESETS.find((r) => r.id === sel.rulesId)?.blurb ?? ''}
            </div>
          </div>

          <div className="panel">
            <h2>Chaos modifiers</h2>
            <div className="hint" style={{ marginBottom: 8 }}>
              Only used by CHAOS MODE. Mix freely.
            </div>
            <Pill
              options={CHAOS_MODIFIERS}
              isActive={(id) => sel.chaos.includes(id)}
              titleOf={(o) => CHAOS_MODIFIERS.find((m) => m.id === o.id)?.blurb}
              onPick={(id) => {
                click();
                const chaos = sel.chaos.includes(id)
                  ? sel.chaos.filter((c) => c !== id)
                  : [...sel.chaos, id];
                patchSelection({ chaos });
              }}
            />
          </div>

          <div className="panel">
            <h2>Career</h2>
            <StatGrid
              entries={[
                ['Played', stats.matches],
                ['Won', stats.wins],
                ['Lost', stats.losses],
                ['Goals', stats.goals],
                ['Best strike', stats.bestGoalDistance ? `${stats.bestGoalDistance.toFixed(0)}m` : '-'],
                ['Aerials', stats.aerialGoals],
                ['Own goals', stats.ownGoals],
                ['Range best', stats.trainingBest],
              ]}
            />
          </div>
        </div>
      </div>
    </>
  );
}
