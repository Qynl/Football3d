import { useSyncExternalStore, type ReactNode } from 'react';
import type { Store } from '../store.ts';

/** Subscribe a component to one of the engine-owned stores. */
export function useStore<T>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

export function hexColor(c: number): string {
  return `#${c.toString(16).padStart(6, '0')}`;
}

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

export interface CardItem {
  id: string;
  name: string;
  desc: string;
  color?: string;
}

export function CardGrid({
  items,
  active,
  onPick,
}: {
  items: CardItem[];
  active: string;
  onPick: (id: string) => void;
}): ReactNode {
  return (
    <div className="cards">
      {items.map((item) => (
        <div
          key={item.id}
          className={cx('card', active === item.id && 'active')}
          onClick={() => onPick(item.id)}
        >
          {item.color ? <div className="thumb" style={{ background: item.color }} /> : null}
          <div className="name">{item.name}</div>
          <div className="desc">{item.desc}</div>
        </div>
      ))}
    </div>
  );
}

export function Pill({
  options,
  isActive,
  onPick,
  labelOf,
  titleOf,
}: {
  options: { id: string; name: string }[];
  isActive: (id: string) => boolean;
  onPick: (id: string) => void;
  labelOf?: (o: { id: string; name: string }) => string;
  titleOf?: (o: { id: string; name: string }) => string | undefined;
}): ReactNode {
  return (
    <div className="pill">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          className={isActive(o.id) ? 'active' : ''}
          title={titleOf?.(o)}
          onClick={() => onPick(o.id)}
        >
          {labelOf ? labelOf(o) : o.name}
        </button>
      ))}
    </div>
  );
}

export function Swatches({
  label,
  colors,
  value,
  onPick,
}: {
  label: string;
  colors: number[];
  value: number;
  onPick: (c: number) => void;
}): ReactNode {
  return (
    <div style={{ marginTop: 12 }}>
      <h2>{label}</h2>
      <div className="swatches">
        {colors.map((c) => (
          <div
            key={c}
            className={cx('swatch', value === c && 'active')}
            style={{ background: hexColor(c) }}
            onClick={() => onPick(c)}
          />
        ))}
      </div>
    </div>
  );
}

export function Tabs({
  tabs,
  active,
  onPick,
}: {
  tabs: string[];
  active: number;
  onPick: (i: number) => void;
}): ReactNode {
  return (
    <div className="tabs">
      {tabs.map((t, i) => (
        <div key={t} className={cx('tab', i === active && 'active')} onClick={() => onPick(i)}>
          {t}
        </div>
      ))}
    </div>
  );
}

export function StatGrid({ entries }: { entries: [string, string | number][] }): ReactNode {
  return (
    <div className="stat-grid">
      {entries.map(([k, v]) => (
        <div className="stat" key={k}>
          <div className="v">{String(v)}</div>
          <div className="k">{k}</div>
        </div>
      ))}
    </div>
  );
}
