/**
 * Original character archetypes. Differences are deliberately subtle so matches
 * stay fair - cosmetics never affect gameplay at all.
 */

export interface Archetype {
  id: string;
  name: string;
  blurb: string;
  /** Multipliers applied on top of the shared base stats. */
  maxSpeed: number;
  acceleration: number;
  sprintMultiplier: number;
  jump: number;
  airControl: number;
  mass: number;
  kickPower: number;
  curve: number;
  bodyStrength: number;
  /** Tackle reach multiplier. */
  reach: number;
}

export const ARCHETYPES: Archetype[] = [
  {
    id: 'balanced',
    name: 'Nova',
    blurb: 'All-rounder. No weaknesses, no tricks.',
    maxSpeed: 1,
    acceleration: 1,
    sprintMultiplier: 1,
    jump: 1,
    airControl: 1,
    mass: 1,
    kickPower: 1,
    curve: 1,
    bodyStrength: 1,
    reach: 1,
  },
  {
    id: 'speedster',
    name: 'Dash',
    blurb: 'Quickest feet on the pitch, easy to shove off the ball.',
    maxSpeed: 1.085,
    acceleration: 1.12,
    sprintMultiplier: 1.04,
    jump: 1.0,
    airControl: 1.05,
    mass: 0.88,
    kickPower: 0.96,
    curve: 1.05,
    bodyStrength: 0.85,
    reach: 0.98,
  },
  {
    id: 'power',
    name: 'Boulder',
    blurb: 'Heavy hitter. Wins every collision, turns like a bus.',
    maxSpeed: 0.945,
    acceleration: 0.94,
    sprintMultiplier: 0.98,
    jump: 0.96,
    airControl: 0.92,
    mass: 1.2,
    kickPower: 1.07,
    curve: 0.92,
    bodyStrength: 1.22,
    reach: 1.06,
  },
  {
    id: 'trickster',
    name: 'Pip',
    blurb: 'Air specialist. Bends it, floats it, fears tackles.',
    maxSpeed: 1.01,
    acceleration: 1.03,
    sprintMultiplier: 1,
    jump: 1.07,
    airControl: 1.45,
    mass: 0.93,
    kickPower: 0.955,
    curve: 1.3,
    bodyStrength: 0.92,
    reach: 1.02,
  },
];

export function getArchetype(id: string): Archetype {
  return ARCHETYPES.find((a) => a.id === id) ?? ARCHETYPES[0];
}

export interface Cosmetics {
  shirt: number;
  shorts: number;
  shoes: number;
  skin: number;
  hairStyle: string;
  hairColor: number;
  accessory: string;
  celebration: string;
}

export const SHIRT_COLORS = [
  0xff5a5f, 0x2f80ed, 0xfdc500, 0x2ec4b6, 0x9b5de5, 0xff8c42, 0xf2f6ff, 0x1b1f3b,
];
export const SHORTS_COLORS = [0xffffff, 0x1b1f3b, 0x2f80ed, 0xff5a5f, 0x2ec4b6, 0xfdc500];
export const SHOE_COLORS = [0xffffff, 0x111318, 0xff2e63, 0x00d2ff, 0xffe066, 0x8affc1];
export const SKIN_COLORS = [0xf7d0b0, 0xe8b48c, 0xc98a5e, 0x8d5a3b, 0x5c3a25, 0xffd9c0];
export const HAIR_COLORS = [0x2b2118, 0x4a2c16, 0xd8a13a, 0xe8e8e8, 0xff4f8b, 0x38b6ff, 0x7bd44a];
export const HAIR_STYLES = ['short', 'spiky', 'bun', 'curls', 'bald', 'mohawk'];
export const ACCESSORIES = ['none', 'headband', 'cap', 'visor', 'scarf'];
export const CELEBRATIONS = ['jump', 'spin', 'fistpump', 'slide', 'dance', 'point'];

export const DEFAULT_COSMETICS: Cosmetics = {
  shirt: SHIRT_COLORS[0],
  shorts: SHORTS_COLORS[0],
  shoes: SHOE_COLORS[0],
  skin: SKIN_COLORS[0],
  hairStyle: 'short',
  hairColor: HAIR_COLORS[0],
  accessory: 'none',
  celebration: 'jump',
};

export const AI_COSMETICS: Cosmetics = {
  shirt: SHIRT_COLORS[1],
  shorts: SHORTS_COLORS[1],
  shoes: SHOE_COLORS[1],
  skin: SKIN_COLORS[2],
  hairStyle: 'spiky',
  hairColor: HAIR_COLORS[1],
  accessory: 'none',
  celebration: 'fistpump',
};
