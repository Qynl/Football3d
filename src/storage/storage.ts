import { DEFAULT_BINDINGS_P1, DEFAULT_BINDINGS_P2, type Bindings } from '../input/bindings.ts';
import { AI_COSMETICS, DEFAULT_COSMETICS, type Cosmetics } from '../characters/characterDefs.ts';

const KEY = 'kickoff.save.v1';

export interface SaveData {
  settings: {
    masterVolume: number;
    sfxVolume: number;
    musicVolume: number;
    mouseSensitivity: number;
    invertY: boolean;
    cameraMode: 'ball' | 'player';
    shadows: boolean;
    quality: 'low' | 'medium' | 'high';
    screenShake: number;
    showReplays: boolean;
    debug: boolean;
  };
  bindings: [Bindings, Bindings];
  loadout: {
    archetype: string;
    cosmetics: Cosmetics;
    ball: string;
    arena: string;
    difficulty: string;
    personality: string;
    p2Archetype: string;
    p2Cosmetics: Cosmetics;
  };
  stats: {
    matches: number;
    wins: number;
    losses: number;
    draws: number;
    goals: number;
    conceded: number;
    bestGoalDistance: number;
    aerialGoals: number;
    wallGoals: number;
    ownGoals: number;
    trainingBest: number;
  };
}

export function defaultSave(): SaveData {
  return {
    settings: {
      masterVolume: 0.75,
      sfxVolume: 0.9,
      musicVolume: 0.4,
      mouseSensitivity: 1,
      invertY: false,
      cameraMode: 'ball',
      shadows: true,
      quality: 'high',
      screenShake: 1,
      showReplays: true,
      debug: false,
    },
    bindings: [{ ...DEFAULT_BINDINGS_P1 }, { ...DEFAULT_BINDINGS_P2 }],
    loadout: {
      archetype: 'balanced',
      cosmetics: { ...DEFAULT_COSMETICS },
      ball: 'classic',
      arena: 'classic',
      difficulty: 'normal',
      personality: 'balanced',
      p2Archetype: 'speedster',
      p2Cosmetics: { ...AI_COSMETICS },
    },
    stats: {
      matches: 0,
      wins: 0,
      losses: 0,
      draws: 0,
      goals: 0,
      conceded: 0,
      bestGoalDistance: 0,
      aerialGoals: 0,
      wallGoals: 0,
      ownGoals: 0,
      trainingBest: 0,
    },
  };
}

function merge<T>(base: T, patch: unknown): T {
  if (typeof patch !== 'object' || patch === null) return base;
  const out = Array.isArray(base) ? ([...(base as unknown as unknown[])] as unknown as T) : { ...base };
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    const current = (out as Record<string, unknown>)[k];
    if (current !== undefined && typeof current === 'object' && current !== null && !Array.isArray(current)) {
      (out as Record<string, unknown>)[k] = merge(current, v);
    } else if (current !== undefined) {
      (out as Record<string, unknown>)[k] = v;
    }
  }
  return out;
}

export class Storage {
  data: SaveData;

  constructor() {
    this.data = this.load();
  }

  private load(): SaveData {
    const base = defaultSave();
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return base;
      return merge(base, JSON.parse(raw));
    } catch {
      return base;
    }
  }

  save(): void {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      /* storage unavailable - game still runs */
    }
  }

  reset(): void {
    this.data = defaultSave();
    this.save();
  }
}
