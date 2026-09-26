import { MATCH_BALL_RADIUS } from '../physics/colliders.ts';
import type { ArenaDef } from '../arenas/arenaDefs.ts';
import type { PlayerModifiers } from '../player/footballer.ts';

export type GameMode = 'quick' | 'training' | 'local' | 'penalty' | 'chaos';

export interface MatchRules {
  id: string;
  name: string;
  blurb: string;
  /** First to N goals wins (null = no goal limit). */
  goalTarget: number | null;
  /** Match length in seconds (null = untimed). */
  duration: number | null;
  /** Next goal wins once the clock runs out level. */
  goldenGoal: boolean;
}

export const RULE_PRESETS: MatchRules[] = [
  {
    id: 'classic',
    name: 'First to 5 · 3:00',
    blurb: 'The default. Race to five before the clock dies.',
    goalTarget: 5,
    duration: 180,
    goldenGoal: true,
  },
  {
    id: 'first3',
    name: 'First to 3',
    blurb: 'Short and brutal. No clock.',
    goalTarget: 3,
    duration: null,
    goldenGoal: false,
  },
  {
    id: 'first5',
    name: 'First to 5',
    blurb: 'No clock, pure race.',
    goalTarget: 5,
    duration: null,
    goldenGoal: false,
  },
  {
    id: 'timed',
    name: '3 Minutes',
    blurb: 'Most goals when the whistle blows.',
    goalTarget: null,
    duration: 180,
    goldenGoal: true,
  },
  {
    id: 'golden',
    name: 'Golden Goal',
    blurb: 'One goal. That is the whole match.',
    goalTarget: 1,
    duration: null,
    goldenGoal: false,
  },
];

export function getRules(id: string): MatchRules {
  return RULE_PRESETS.find((r) => r.id === id) ?? RULE_PRESETS[0];
}

export interface ChaosModifier {
  id: string;
  name: string;
  blurb: string;
  apply(ctx: ChaosContext): void;
}

export interface ChaosContext {
  arena: ArenaDef;
  ballRadius: number;
  ballRestitution: number;
  gravity: number;
  players: PlayerModifiers;
  extraBalls: number;
  randomBounce: number;
  meteor: boolean;
}

export function defaultChaosContext(arena: ArenaDef): ChaosContext {
  return {
    arena: { ...arena, theme: arena.theme },
    ballRadius: MATCH_BALL_RADIUS,
    ballRestitution: 0.6,
    gravity: arena.gravity,
    players: { speed: 1, acceleration: 1, jump: 1, gravity: 1, kickPower: 1, curve: 1 },
    extraBalls: 0,
    randomBounce: 0,
    meteor: false,
  };
}

export const CHAOS_MODIFIERS: ChaosModifier[] = [
  {
    id: 'giantBall',
    name: 'Giant Ball',
    blurb: 'A beach-ball sized problem.',
    apply: (c) => {
      c.ballRadius = MATCH_BALL_RADIUS * 1.75;
    },
  },
  {
    id: 'tinyBall',
    name: 'Tiny Ball',
    blurb: 'Good luck finding it.',
    apply: (c) => {
      c.ballRadius = MATCH_BALL_RADIUS * 0.4;
    },
  },
  {
    id: 'lowGravity',
    name: 'Low Gravity',
    blurb: 'Everything floats. Volleys everywhere.',
    apply: (c) => {
      c.gravity = -8.4;
      c.players.gravity = 0.45;
      c.players.jump = 1.05;
    },
  },
  {
    id: 'superBounce',
    name: 'Super Bounce',
    blurb: 'The ball simply refuses to settle.',
    apply: (c) => {
      c.ballRestitution = 0.92;
      c.arena.groundRestitution = 0.88;
      c.arena.wallRestitution = 0.95;
      c.arena.rollingResistance *= 0.5;
    },
  },
  {
    id: 'turbo',
    name: 'Turbo Players',
    blurb: 'Both players get rocket boots.',
    apply: (c) => {
      c.players.speed = 1.32;
      c.players.acceleration = 1.35;
    },
  },
  {
    id: 'slippery',
    name: 'Slippery Pitch',
    blurb: 'Ice-rink traction on any surface.',
    apply: (c) => {
      c.arena.traction = 0.4;
      c.arena.groundFriction = 0.16;
      c.arena.rollingResistance = 0.15;
    },
  },
  {
    id: 'hugeGoals',
    name: 'Huge Goals',
    blurb: 'Hard to miss. Harder to defend.',
    apply: (c) => {
      c.arena.goalWidth *= 1.45;
      c.arena.goalHeight *= 1.25;
    },
  },
  {
    id: 'tinyGoals',
    name: 'Tiny Goals',
    blurb: 'Precision or nothing.',
    apply: (c) => {
      c.arena.goalWidth *= 0.62;
      c.arena.goalHeight *= 0.8;
    },
  },
  {
    id: 'wallHeavy',
    name: 'High Walls',
    blurb: 'Everything rebounds. Nothing leaves.',
    apply: (c) => {
      c.arena.wallHeight = 2.6;
      c.arena.wallRestitution = 0.9;
    },
  },
  {
    id: 'doubleBall',
    name: 'Double Ball',
    blurb: 'Two balls, one brain.',
    apply: (c) => {
      c.extraBalls = 1;
    },
  },
  {
    id: 'randomBounce',
    name: 'Random Bounce',
    blurb: 'The pitch has opinions.',
    apply: (c) => {
      c.randomBounce = 1;
    },
  },
  {
    id: 'meteor',
    name: 'Meteor Ball',
    blurb: 'Heavy, fast, unforgiving.',
    apply: (c) => {
      c.ballRestitution = 0.35;
      c.players.kickPower = 1.35;
      c.arena.rollingResistance *= 0.7;
    },
  },
];

export function getChaosModifier(id: string): ChaosModifier | undefined {
  return CHAOS_MODIFIERS.find((m) => m.id === id);
}
