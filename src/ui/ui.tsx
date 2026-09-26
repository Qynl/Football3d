/**
 * The bridge between the imperative game loop and the React UI.
 *
 * `Game` talks to this class exactly as it did to the old hand-rolled DOM UI -
 * `updateHud`, `banner`, `toast`, `show`, `showResult` - and the class pushes
 * that into two external stores that React subscribes to. Nothing in the engine
 * knows React exists, and React never sits in the simulation's hot path.
 */
import { createRoot, type Root } from 'react-dom/client';
import { createElement, type ReactElement } from 'react';
import type { GameMode } from '../match/rules.ts';
import type { ActionId } from '../input/bindings.ts';
import { Store } from './store.ts';
import { App, type AppActions } from './react/App.tsx';
import {
  EMPTY_HUD,
  type HudState,
  type ResultData,
  type ScreenName,
  type StartOptions,
  type UiHost,
  type UiState,
} from './uiTypes.ts';

export type { HudState, ScreenName, StartOptions, UiHost } from './uiTypes.ts';

/** Renders a `Ui` instance inside a surrounding React tree. */
export function UiView({ ui }: { ui: Ui }): ReactElement {
  return ui.element();
}

export class Ui {
  private host: UiHost;
  private actions: AppActions;
  private root: Root | null = null;
  private uiStore: Store<UiState>;
  private hudStore: Store<HudState>;
  private bannerTimer = 0;
  private toastTimer = 0;
  private bannerSeq = 0;
  private toastSeq = 0;
  private lastMode: GameMode = 'quick';
  private settingsReturn: ScreenName = 'menu';

  constructor(host: UiHost) {
    this.host = host;
    const l = host.storage.data.loadout;

    this.hudStore = new Store<HudState>({ ...EMPTY_HUD });
    this.uiStore = new Store<UiState>({
      screen: 'menu',
      endView: 'result',
      result: null,
      banner: null,
      bannerVisible: false,
      toast: null,
      toastVisible: false,
      debug: { text: '', visible: false },
      selection: {
        mode: 'quick',
        rulesId: 'classic',
        arenaId: l.arena,
        difficulty: l.difficulty,
        personality: l.personality,
        chaos: ['superBounce', 'lowGravity'],
      },
      listeningFor: null,
      revision: 0,
    });

    this.actions = {
      show: (screen) => this.show(screen),
      start: (mode) => this.start(mode),
      closeSettings: () => this.closeSettings(),
      openSettingsFrom: (from) => this.openSettingsFrom(from),
      patchSelection: (patch) =>
        this.uiStore.set((prev) => ({ ...prev, selection: { ...prev.selection, ...patch } })),
      setListening: (v) => this.uiStore.set({ listeningFor: v }),
      setEndView: (endView) => this.uiStore.set({ endView }),
      bump: () => this.uiStore.set((prev) => ({ ...prev, revision: prev.revision + 1 })),
    };

  }

  // ----------------------------------------------------------------- render

  /**
   * The React element for this UI. Hosts that already render a React tree
   * (the real page does) drop this straight into their JSX.
   */
  element(): ReactElement {
    return createElement(App, {
      uiStore: this.uiStore,
      hudStore: this.hudStore,
      host: this.host,
      actions: this.actions,
    });
  }

  /** Mount into a plain DOM node, for hosts that are not React themselves. */
  mount(container: HTMLElement): void {
    this.root ??= createRoot(container);
    this.root.render(this.element());
  }

  // ------------------------------------------------------------------- hud

  updateHud(s: HudState): void {
    const prev = this.hudStore.get();
    // The HUD is pushed every frame; only wake React when something changed.
    if (
      prev.scoreA === s.scoreA &&
      prev.scoreB === s.scoreB &&
      prev.nameA === s.nameA &&
      prev.nameB === s.nameB &&
      prev.time === s.time &&
      prev.urgent === s.urgent &&
      prev.mode === s.mode &&
      prev.chargeActive === s.chargeActive &&
      prev.lob === s.lob &&
      prev.aiState === s.aiState &&
      prev.aiRead === s.aiRead &&
      Math.round(prev.charge * 100) === Math.round(s.charge * 100) &&
      Math.round(prev.curve * 100) === Math.round(s.curve * 100) &&
      Math.round(prev.stamina) === Math.round(s.stamina) &&
      prev.training?.score === s.training?.score &&
      prev.training?.last === s.training?.last &&
      !prev.training === !s.training
    ) {
      return;
    }
    this.hudStore.set({ ...s, training: s.training ? { ...s.training } : null });
  }

  banner(main: string, sub = '', duration = 1400): void {
    this.bannerSeq++;
    this.uiStore.set({
      banner: { main, sub, key: this.bannerSeq },
      bannerVisible: true,
    });
    this.bannerTimer = duration / 1000;
  }

  toast(text: string): void {
    this.toastSeq++;
    this.uiStore.set({ toast: { text, key: this.toastSeq }, toastVisible: true });
    this.toastTimer = 1.8;
  }

  tick(dt: number): void {
    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.uiStore.set({ bannerVisible: false });
    }
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.uiStore.set({ toastVisible: false });
    }
  }

  setDebug(text: string, visible: boolean): void {
    const prev = this.uiStore.get().debug;
    if (prev.visible === visible && (!visible || prev.text === text)) return;
    this.uiStore.set({ debug: { text, visible } });
  }

  // ---------------------------------------------------------------- screens

  private start(mode: GameMode): void {
    this.lastMode = mode;
    this.host.audio.play('ui');
    this.host.startMatch({ ...this.uiStore.get().selection, mode });
  }

  private closeSettings(): void {
    this.host.audio.play('uiBack');
    this.show(this.settingsReturn);
  }

  showResult(opts: ResultData): void {
    this.uiStore.set({ result: opts, endView: 'result' });
    this.show('end');
  }

  show(name: ScreenName): void {
    const patch: Partial<UiState> = { screen: name };
    if (name === 'settings') this.settingsReturn = 'menu';
    if (name === 'end') patch.endView = 'result';
    if (this.uiStore.get().listeningFor) {
      patch.listeningFor = null;
      this.host.input.captureCallback = null;
    }
    // Career numbers and loadout are read straight from storage on render.
    patch.revision = this.uiStore.get().revision + 1;
    this.uiStore.set(patch);
  }

  openSettingsFrom(from: ScreenName): void {
    this.settingsReturn = from;
    this.uiStore.set({ screen: 'settings' });
  }

  setListening(v: { player: number; action: ActionId } | null): void {
    this.uiStore.set({ listeningFor: v });
  }

  get currentScreen(): ScreenName {
    return this.uiStore.get().screen;
  }

  get lastPlayedMode(): GameMode {
    return this.lastMode;
  }

  get currentSelection(): StartOptions {
    return this.uiStore.get().selection;
  }

  dispose(): void {
    this.root?.unmount();
    this.root = null;
  }
}
