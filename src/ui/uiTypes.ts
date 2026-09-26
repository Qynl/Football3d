import type { GameMode } from '../match/rules.ts';
import type { Storage } from '../storage/storage.ts';
import type { InputManager } from '../input/input.ts';
import type { AudioEngine } from '../audio/audio.ts';
import type { ActionId } from '../input/bindings.ts';

export interface StartOptions {
  mode: GameMode;
  rulesId: string;
  arenaId: string;
  difficulty: string;
  personality: string;
  chaos: string[];
}

/** Everything the UI is allowed to do to the game. */
export interface UiHost {
  storage: Storage;
  input: InputManager;
  audio: AudioEngine;
  startMatch(opts: StartOptions): void;
  resumeGame(): void;
  quitToMenu(): void;
  rematch(): void;
  applySettings(): void;
  applyLoadout(): void;
  changeArena(id: string): void;
}

export interface HudState {
  scoreA: number;
  scoreB: number;
  nameA: string;
  nameB: string;
  time: string;
  urgent: boolean;
  mode: string;
  charge: number;
  chargeActive: boolean;
  curve: number;
  lob: boolean;
  stamina: number;
  aiState: string;
  aiRead: string;
  training: { score: number; combo: number; last: string } | null;
}

export type ScreenName = 'menu' | 'game' | 'pause' | 'end' | 'customize' | 'settings' | 'howto';

export interface ResultData {
  title: string;
  subtitle: string;
  scoreLine: string;
  stats: [string, string][];
}

export interface BannerData {
  main: string;
  sub: string;
  /** Bumped on every banner so React remounts the node and replays the animation. */
  key: number;
}

export interface ToastData {
  text: string;
  key: number;
}

/** The whole menu/overlay state. Mutated only through the Ui bridge. */
export interface UiState {
  screen: ScreenName;
  /** 'result' shows the end-of-match card, 'arena' the pitch picker. */
  endView: 'result' | 'arena';
  result: ResultData | null;
  banner: BannerData | null;
  bannerVisible: boolean;
  toast: ToastData | null;
  toastVisible: boolean;
  debug: { text: string; visible: boolean };
  selection: StartOptions;
  listeningFor: { player: number; action: ActionId } | null;
  /** Bumped whenever storage-backed data changes so panels re-read it. */
  revision: number;
}

export const EMPTY_HUD: HudState = {
  scoreA: 0,
  scoreB: 0,
  nameA: 'YOU',
  nameB: 'CPU',
  time: '3:00',
  urgent: false,
  mode: 'QUICK MATCH',
  charge: 0,
  chargeActive: false,
  curve: 0,
  lob: false,
  stamina: 100,
  aiState: '',
  aiRead: '',
  training: null,
};
