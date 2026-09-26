import { useState, type ReactNode } from 'react';
import {
  ACCESSORIES,
  ARCHETYPES,
  CELEBRATIONS,
  HAIR_COLORS,
  HAIR_STYLES,
  SHIRT_COLORS,
  SHOE_COLORS,
  SHORTS_COLORS,
  SKIN_COLORS,
} from '../../characters/characterDefs.ts';
import { BALL_DESIGNS } from '../../ball/ballDesigns.ts';
import type { UiHost } from '../uiTypes.ts';
import { CardGrid, Pill, Swatches, Tabs } from './common.tsx';

function OptionRow({
  label,
  options,
  value,
  onPick,
}: {
  label: string;
  options: string[];
  value: string;
  onPick: (v: string) => void;
}): ReactNode {
  return (
    <div style={{ marginTop: 12 }}>
      <h2>{label}</h2>
      <Pill
        options={options.map((o) => ({ id: o, name: o }))}
        isActive={(id) => id === value}
        onPick={onPick}
      />
    </div>
  );
}

export function Customize({
  host,
  onDone,
  onChange,
}: {
  host: UiHost;
  onDone: () => void;
  onChange: () => void;
}): ReactNode {
  const [tab, setTab] = useState(0);
  const store = host.storage;
  const loadout = store.data.loadout;
  const cos = loadout.cosmetics;

  // Cosmetics are stored as plain mutable data; commit + tell the game to rebuild.
  const commit = (): void => {
    store.save();
    host.applyLoadout();
    host.audio.play('ui');
    onChange();
  };

  return (
    <div className="modal modal-wide">
      <h1>CUSTOMIZE</h1>
      <div className="subtitle">Cosmetics never change the physics. Archetypes barely do.</div>

      <Tabs
        tabs={['CHARACTER', 'BALL', 'OPPONENT KIT']}
        active={tab}
        onPick={(i) => {
          setTab(i);
          host.audio.play('ui');
        }}
      />

      <div className={`tab-body${tab === 0 ? ' active' : ''}`}>
        {tab === 0 ? (
          <div>
            <CardGrid
              items={ARCHETYPES.map((a) => ({ id: a.id, name: a.name, desc: a.blurb }))}
              active={loadout.archetype}
              onPick={(id) => {
                loadout.archetype = id;
                commit();
              }}
            />
            <Swatches
              label="Shirt"
              colors={SHIRT_COLORS}
              value={cos.shirt}
              onPick={(c) => {
                cos.shirt = c;
                commit();
              }}
            />
            <Swatches
              label="Shorts"
              colors={SHORTS_COLORS}
              value={cos.shorts}
              onPick={(c) => {
                cos.shorts = c;
                commit();
              }}
            />
            <Swatches
              label="Boots"
              colors={SHOE_COLORS}
              value={cos.shoes}
              onPick={(c) => {
                cos.shoes = c;
                commit();
              }}
            />
            <Swatches
              label="Skin"
              colors={SKIN_COLORS}
              value={cos.skin}
              onPick={(c) => {
                cos.skin = c;
                commit();
              }}
            />
            <Swatches
              label="Hair colour"
              colors={HAIR_COLORS}
              value={cos.hairColor}
              onPick={(c) => {
                cos.hairColor = c;
                commit();
              }}
            />
            <OptionRow
              label="Hair"
              options={HAIR_STYLES}
              value={cos.hairStyle}
              onPick={(v) => {
                cos.hairStyle = v;
                commit();
              }}
            />
            <OptionRow
              label="Accessory"
              options={ACCESSORIES}
              value={cos.accessory}
              onPick={(v) => {
                cos.accessory = v;
                commit();
              }}
            />
            <OptionRow
              label="Celebration"
              options={CELEBRATIONS}
              value={cos.celebration}
              onPick={(v) => {
                cos.celebration = v;
                commit();
              }}
            />
          </div>
        ) : null}
      </div>

      <div className={`tab-body${tab === 1 ? ' active' : ''}`}>
        {tab === 1 ? (
          <CardGrid
            items={BALL_DESIGNS.map((b) => ({ id: b.id, name: b.name, desc: 'Purely cosmetic' }))}
            active={loadout.ball}
            onPick={(id) => {
              loadout.ball = id;
              commit();
            }}
          />
        ) : null}
      </div>

      <div className={`tab-body${tab === 2 ? ' active' : ''}`}>
        {tab === 2 ? (
          <div>
            <div className="hint">Used in LOCAL 1v1 and as the CPU kit.</div>
            <CardGrid
              items={ARCHETYPES.map((a) => ({ id: a.id, name: a.name, desc: a.blurb }))}
              active={loadout.p2Archetype}
              onPick={(id) => {
                loadout.p2Archetype = id;
                commit();
              }}
            />
            <Swatches
              label="Shirt"
              colors={SHIRT_COLORS}
              value={loadout.p2Cosmetics.shirt}
              onPick={(c) => {
                loadout.p2Cosmetics.shirt = c;
                commit();
              }}
            />
            <Swatches
              label="Shorts"
              colors={SHORTS_COLORS}
              value={loadout.p2Cosmetics.shorts}
              onPick={(c) => {
                loadout.p2Cosmetics.shorts = c;
                commit();
              }}
            />
            <Swatches
              label="Skin"
              colors={SKIN_COLORS}
              value={loadout.p2Cosmetics.skin}
              onPick={(c) => {
                loadout.p2Cosmetics.skin = c;
                commit();
              }}
            />
            <OptionRow
              label="Hair"
              options={HAIR_STYLES}
              value={loadout.p2Cosmetics.hairStyle}
              onPick={(v) => {
                loadout.p2Cosmetics.hairStyle = v;
                commit();
              }}
            />
          </div>
        ) : null}
      </div>

      <div className="actions">
        <button type="button" className="btn primary" onClick={onDone}>
          DONE
        </button>
      </div>
    </div>
  );
}
