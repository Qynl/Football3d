import type { ReactNode } from 'react';
import type { GameMode } from '../../match/rules.ts';
import type { ActionId } from '../../input/bindings.ts';
import type { HudState, ScreenName, UiHost, UiState } from '../uiTypes.ts';
import type { Store } from '../store.ts';
import { Hud } from './Hud.tsx';
import { Menu } from './Menu.tsx';
import { Customize } from './Customize.tsx';
import { Settings } from './Settings.tsx';
import { EndScreen, HowTo, Pause } from './Screens.tsx';
import { cx, useStore } from './common.tsx';

export interface AppActions {
  show(screen: ScreenName): void;
  start(mode: GameMode): void;
  closeSettings(): void;
  openSettingsFrom(from: ScreenName): void;
  patchSelection(patch: Partial<UiState['selection']>): void;
  setListening(v: { player: number; action: ActionId } | null): void;
  setEndView(view: 'result' | 'arena'): void;
  bump(): void;
}

function Screen({
  name,
  current,
  centered,
  children,
}: {
  name: ScreenName;
  current: ScreenName;
  centered?: boolean;
  children: ReactNode;
}): ReactNode {
  const visible = name === current;
  return (
    <div className={cx('screen', centered && 'center', visible && 'visible')}>
      {/* Screens are unmounted while hidden so menus never cost frames mid-match. */}
      {visible ? children : null}
    </div>
  );
}

export function App({
  uiStore,
  hudStore,
  host,
  actions,
}: {
  uiStore: Store<UiState>;
  hudStore: Store<HudState>;
  host: UiHost;
  actions: AppActions;
}): ReactNode {
  const ui = useStore(uiStore);
  const hud = useStore(hudStore);

  return (
    <>
      <Hud hud={hud} ui={ui} />

      <Screen name="menu" current={ui.screen}>
        <Menu
          host={host}
          ui={ui}
          onStart={actions.start}
          onShow={actions.show}
          patchSelection={actions.patchSelection}
        />
      </Screen>

      <Screen name="pause" current={ui.screen} centered>
        <Pause host={host} onSettings={() => actions.openSettingsFrom('pause')} />
      </Screen>

      <Screen name="end" current={ui.screen} centered>
        <EndScreen
          host={host}
          ui={ui}
          result={ui.result}
          onPickArenaView={() => actions.setEndView('arena')}
          patchSelection={actions.patchSelection}
        />
      </Screen>

      <Screen name="customize" current={ui.screen} centered>
        <Customize host={host} onDone={() => actions.show('menu')} onChange={actions.bump} />
      </Screen>

      <Screen name="settings" current={ui.screen} centered>
        <Settings
          host={host}
          ui={ui}
          onBack={actions.closeSettings}
          onChange={actions.bump}
          setListening={actions.setListening}
        />
      </Screen>

      <Screen name="howto" current={ui.screen} centered>
        <HowTo onDone={() => actions.show('menu')} />
      </Screen>
    </>
  );
}
