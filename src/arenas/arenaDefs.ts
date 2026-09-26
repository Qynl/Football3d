/**
 * Arena definitions. Pure data: dimensions, surface behaviour and theme colours.
 * Gameplay differences are real (friction, bounce, size, wall height, gravity).
 */

export interface ArenaTheme {
  /** Sky / background colour. */
  sky: number;
  skyBottom: number;
  fog: number;
  fogDensity: number;
  grassA: number;
  grassB: number;
  lineColor: number;
  wallColor: number;
  wallAccent: number;
  crowdColors: number[];
  /** Hoarding panel colours; falls back to the crowd palette. */
  adColors?: number[];
  /** Terracing concrete, its shaded risers and the roof. */
  standColor?: number;
  standShadow?: number;
  roofColor?: number;
  ambient: number;
  ambientIntensity: number;
  sunColor: number;
  sunIntensity: number;
  /** Decoration set drawn around the pitch. */
  decor: 'stadium' | 'rooftop' | 'beach' | 'neon' | 'ice' | 'tiny';
  /** Surface texture style. */
  surface: 'grass' | 'sand' | 'neon' | 'ice' | 'turf';
}

export interface ArenaDef {
  id: string;
  name: string;
  blurb: string;
  /** Half extents of the playing surface. */
  halfWidth: number;
  halfLength: number;
  /** Inner goal width (post to post) and height (under the bar). */
  goalWidth: number;
  goalHeight: number;
  goalDepth: number;
  postRadius: number;
  /** Perimeter wall height (ball bounces below this). */
  wallHeight: number;
  wallRestitution: number;
  /** Ball-vs-pitch surface. */
  groundFriction: number;
  groundRestitution: number;
  rollingResistance: number;
  /** Multiplier on player acceleration/braking - low = slippery. */
  traction: number;
  gravity: number;
  theme: ArenaTheme;
}

const stadiumTheme: ArenaTheme = {
  sky: 0x3f93ea,
  skyBottom: 0xaed8ff,
  fog: 0xc2e0ff,
  fogDensity: 0.0062,
  grassA: 0x3fa14a,
  grassB: 0x379141,
  lineColor: 0xf2fff4,
  wallColor: 0xf4f7fb,
  wallAccent: 0x2f80ed,
  crowdColors: [0xff6b6b, 0xffd93d, 0x4dd4ac, 0x5b8cff, 0xf78fb3, 0xffffff],
  adColors: [0x2f80ed, 0xff6b6b, 0x11253f, 0xffd93d, 0x4dd4ac, 0x7a5cff],
  standColor: 0xc3cdda,
  standShadow: 0x8792a3,
  roofColor: 0xe6ecf6,
  ambient: 0xbcd8ff,
  ambientIntensity: 0.85,
  sunColor: 0xfff6e0,
  sunIntensity: 1.45,
  decor: 'stadium',
  surface: 'grass',
};

export const ARENAS: ArenaDef[] = [
  {
    id: 'classic',
    name: 'Classic Stadium',
    blurb: 'Balanced pitch, true bounce. The benchmark.',
    halfWidth: 12,
    halfLength: 17,
    goalWidth: 7,
    goalHeight: 2.5,
    goalDepth: 1.9,
    postRadius: 0.12,
    wallHeight: 1.05,
    wallRestitution: 0.68,
    groundFriction: 0.62,
    groundRestitution: 0.52,
    rollingResistance: 0.95,
    traction: 1,
    gravity: -20.5,
    theme: stadiumTheme,
  },
  {
    id: 'rooftop',
    name: 'Rooftop',
    blurb: 'Tight cage above the city. Rebounds everywhere.',
    halfWidth: 9.5,
    halfLength: 13.5,
    goalWidth: 6.2,
    goalHeight: 2.35,
    goalDepth: 1.5,
    postRadius: 0.11,
    wallHeight: 1.6,
    wallRestitution: 0.8,
    groundFriction: 0.7,
    groundRestitution: 0.58,
    rollingResistance: 1.15,
    traction: 1.08,
    gravity: -20.5,
    theme: {
      sky: 0xe8763f,
      skyBottom: 0xffc07a,
      fog: 0xf7c89b,
      fogDensity: 0.011,
      grassA: 0x2f6d55,
      grassB: 0x2a6250,
      lineColor: 0xeafff6,
      wallColor: 0x4a5568,
      wallAccent: 0xffa94d,
      crowdColors: [0xffa94d, 0xff6b6b, 0xffe066, 0x74c0fc],
      ambient: 0xffd9b0,
      ambientIntensity: 0.9,
      sunColor: 0xffc98a,
      sunIntensity: 1.5,
      decor: 'rooftop',
      surface: 'turf',
    },
  },
  {
    id: 'beach',
    name: 'Beach',
    blurb: 'Heavy sand. The ball dies fast, sprinting matters.',
    halfWidth: 12.5,
    halfLength: 17.5,
    goalWidth: 7.2,
    goalHeight: 2.5,
    goalDepth: 1.8,
    postRadius: 0.13,
    wallHeight: 0.75,
    wallRestitution: 0.42,
    groundFriction: 0.92,
    groundRestitution: 0.3,
    rollingResistance: 3.1,
    traction: 0.82,
    gravity: -20.5,
    theme: {
      sky: 0x35b6ef,
      skyBottom: 0xb2ecff,
      fog: 0xd2f0ff,
      fogDensity: 0.006,
      grassA: 0xe8d39a,
      grassB: 0xdfc98d,
      lineColor: 0xfffdf2,
      wallColor: 0xe7c98f,
      wallAccent: 0x36b3d9,
      crowdColors: [0xff8fab, 0xffd93d, 0x56cfe1, 0xffffff],
      ambient: 0xdff4ff,
      ambientIntensity: 1.0,
      sunColor: 0xfff3d0,
      sunIntensity: 1.6,
      decor: 'beach',
      surface: 'sand',
    },
  },
  {
    id: 'neon',
    name: 'Neon Arena',
    blurb: 'Night court, springy boards, fast ball.',
    halfWidth: 11,
    halfLength: 15.5,
    goalWidth: 6.8,
    goalHeight: 2.45,
    goalDepth: 1.7,
    postRadius: 0.12,
    wallHeight: 1.25,
    wallRestitution: 0.86,
    groundFriction: 0.5,
    groundRestitution: 0.62,
    rollingResistance: 0.6,
    traction: 1.02,
    gravity: -20.5,
    theme: {
      sky: 0x0b0b1f,
      skyBottom: 0x1b1040,
      fog: 0x120a2a,
      fogDensity: 0.016,
      grassA: 0x16123a,
      grassB: 0x1b1747,
      lineColor: 0x3df5ff,
      wallColor: 0x241a5c,
      wallAccent: 0xff3df5,
      crowdColors: [0xff3df5, 0x3df5ff, 0xfff05a, 0x8a5bff],
      ambient: 0x5b3dff,
      ambientIntensity: 0.9,
      sunColor: 0x9ad8ff,
      sunIntensity: 0.9,
      decor: 'neon',
      surface: 'neon',
    },
  },
  {
    id: 'ice',
    name: 'Ice Rink',
    blurb: 'Almost no friction. Momentum is everything.',
    halfWidth: 11.5,
    halfLength: 16,
    goalWidth: 7,
    goalHeight: 2.4,
    goalDepth: 1.7,
    postRadius: 0.12,
    wallHeight: 1.15,
    wallRestitution: 0.78,
    groundFriction: 0.14,
    groundRestitution: 0.48,
    rollingResistance: 0.12,
    traction: 0.38,
    gravity: -20.5,
    theme: {
      sky: 0x79c2ee,
      skyBottom: 0xcdeeff,
      fog: 0xdff2ff,
      fogDensity: 0.012,
      grassA: 0xd9f0ff,
      grassB: 0xcbe8fb,
      lineColor: 0x6aa9d6,
      wallColor: 0xf2fbff,
      wallAccent: 0x58a6ff,
      crowdColors: [0x74c0fc, 0xffffff, 0xa5d8ff, 0xffd8a8],
      ambient: 0xe4f6ff,
      ambientIntensity: 1.05,
      sunColor: 0xffffff,
      sunIntensity: 1.2,
      decor: 'ice',
      surface: 'ice',
    },
  },
  {
    id: 'tiny',
    name: 'Tiny Box',
    blurb: 'Pocket-sized pitch. Pure chaos, no rest.',
    halfWidth: 7.5,
    halfLength: 10.5,
    goalWidth: 5.4,
    goalHeight: 2.2,
    goalDepth: 1.3,
    postRadius: 0.11,
    wallHeight: 1.45,
    wallRestitution: 0.82,
    groundFriction: 0.62,
    groundRestitution: 0.55,
    rollingResistance: 1.0,
    traction: 1.05,
    gravity: -20.5,
    theme: {
      sky: 0x7c46f0,
      skyBottom: 0xcfa8fb,
      fog: 0xd7bffa,
      fogDensity: 0.014,
      grassA: 0x46b06a,
      grassB: 0x3da05f,
      lineColor: 0xffffff,
      wallColor: 0xfff3f8,
      wallAccent: 0xb14dff,
      crowdColors: [0xff6b6b, 0xffd93d, 0x4dd4ac, 0xb14dff],
      ambient: 0xe8d6ff,
      ambientIntensity: 0.95,
      sunColor: 0xfff0f6,
      sunIntensity: 1.35,
      decor: 'tiny',
      surface: 'grass',
    },
  },
];

export function getArena(id: string): ArenaDef {
  return ARENAS.find((a) => a.id === id) ?? ARENAS[0];
}
