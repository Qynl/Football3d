/** AI difficulty + personality definitions. These change behaviour, not stats. */

export interface Difficulty {
  id: string;
  name: string;
  /** Seconds of perception delay. */
  reaction: number;
  /** How far ahead the AI simulates the ball. */
  horizon: number;
  /** Radians of aim error on shots. */
  aimError: number;
  /** Error applied to the chosen kick charge (0..1). */
  chargeError: number;
  /** Chance per decision tick to do something suboptimal. */
  mistakeChance: number;
  /** How long a hesitation lasts when a mistake fires. */
  hesitation: number;
  /** Quality of interception point selection (0..1). */
  anticipation: number;
  /** Willingness + timing quality of tackles. */
  tackleSkill: number;
  /** Decision tick rate (seconds). */
  tickRate: number;
}

export const DIFFICULTIES: Difficulty[] = [
  {
    id: 'easy',
    name: 'Easy',
    reaction: 0.46,
    horizon: 0.8,
    aimError: 0.42,
    chargeError: 0.38,
    mistakeChance: 0.34,
    hesitation: 0.7,
    anticipation: 0.28,
    tackleSkill: 0.22,
    tickRate: 0.3,
  },
  {
    id: 'normal',
    name: 'Normal',
    reaction: 0.26,
    horizon: 1.4,
    aimError: 0.2,
    chargeError: 0.2,
    mistakeChance: 0.16,
    hesitation: 0.4,
    anticipation: 0.55,
    tackleSkill: 0.48,
    tickRate: 0.18,
  },
  {
    id: 'hard',
    name: 'Hard',
    reaction: 0.13,
    horizon: 2.1,
    aimError: 0.075,
    chargeError: 0.09,
    mistakeChance: 0.05,
    hesitation: 0.22,
    anticipation: 0.82,
    tackleSkill: 0.78,
    tickRate: 0.11,
  },
  {
    id: 'expert',
    name: 'Expert',
    reaction: 0.075,
    horizon: 2.8,
    aimError: 0.032,
    chargeError: 0.05,
    mistakeChance: 0.018,
    hesitation: 0.14,
    anticipation: 0.95,
    tackleSkill: 0.94,
    tickRate: 0.08,
  },
];

export function getDifficulty(id: string): Difficulty {
  return DIFFICULTIES.find((d) => d.id === id) ?? DIFFICULTIES[1];
}

export interface Personality {
  id: string;
  name: string;
  blurb: string;
  /** Utility multipliers. */
  attack: number;
  defend: number;
  press: number;
  intercept: number;
  /** Likelihood of committing to slides. */
  slide: number;
  /** Preference for long shots. */
  longShot: number;
  /** Preference for lobs/chips. */
  lob: number;
  /** Uses walls for rebounds. */
  wallPlay: number;
  /** Randomness injected into decisions. */
  chaos: number;
  /** How deep it holds its defensive line (0 = on the line, 1 = high). */
  line: number;
  /** Sprint eagerness. */
  hustle: number;
}

export const PERSONALITIES: Personality[] = [
  {
    id: 'balanced',
    name: 'Balanced',
    blurb: 'Plays the percentages.',
    attack: 1,
    defend: 1,
    press: 1,
    intercept: 1,
    slide: 0.5,
    longShot: 0.5,
    lob: 0.35,
    wallPlay: 0.35,
    chaos: 0.1,
    line: 0.5,
    hustle: 0.6,
  },
  {
    id: 'aggressive',
    name: 'Aggressive',
    blurb: 'Presses you into mistakes. Relentless.',
    attack: 1.25,
    defend: 0.75,
    press: 1.75,
    intercept: 1.1,
    slide: 0.85,
    longShot: 0.55,
    lob: 0.2,
    wallPlay: 0.2,
    chaos: 0.15,
    line: 0.85,
    hustle: 0.95,
  },
  {
    id: 'defensive',
    name: 'Defensive',
    blurb: 'Lives between you and the goal.',
    attack: 0.8,
    defend: 1.7,
    press: 0.6,
    intercept: 1.2,
    slide: 0.3,
    longShot: 0.25,
    lob: 0.5,
    wallPlay: 0.3,
    chaos: 0.05,
    line: 0.2,
    hustle: 0.45,
  },
  {
    id: 'fast',
    name: 'Sprinter',
    blurb: 'Always first to the ball, rarely composed.',
    attack: 1.15,
    defend: 0.9,
    press: 1.3,
    intercept: 1.45,
    slide: 0.6,
    longShot: 0.35,
    lob: 0.25,
    wallPlay: 0.25,
    chaos: 0.15,
    line: 0.7,
    hustle: 1,
  },
  {
    id: 'risky',
    name: 'Gambler',
    blurb: 'Big shots, wild slides, occasional disasters.',
    attack: 1.35,
    defend: 0.65,
    press: 1.1,
    intercept: 0.9,
    slide: 1,
    longShot: 1.2,
    lob: 0.45,
    wallPlay: 0.4,
    chaos: 0.3,
    line: 0.75,
    hustle: 0.8,
  },
  {
    id: 'technical',
    name: 'Technician',
    blurb: 'Angles, curves and wall rebounds.',
    attack: 1.1,
    defend: 1.1,
    press: 0.85,
    intercept: 1.15,
    slide: 0.35,
    longShot: 0.6,
    lob: 0.7,
    wallPlay: 1.1,
    chaos: 0.05,
    line: 0.45,
    hustle: 0.55,
  },
  {
    id: 'chaos',
    name: 'Wildcard',
    blurb: 'Nobody knows. Not even the Wildcard.',
    attack: 1.1,
    defend: 0.9,
    press: 1.2,
    intercept: 1,
    slide: 0.9,
    longShot: 0.9,
    lob: 0.9,
    wallPlay: 0.8,
    chaos: 0.75,
    line: 0.6,
    hustle: 0.85,
  },
];

export function getPersonality(id: string): Personality {
  return PERSONALITIES.find((p) => p.id === id) ?? PERSONALITIES[0];
}
