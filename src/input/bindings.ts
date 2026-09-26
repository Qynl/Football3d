export type ActionId =
  | 'forward'
  | 'back'
  | 'left'
  | 'right'
  | 'sprint'
  | 'jump'
  | 'kick'
  | 'tackle'
  | 'slide'
  | 'challenge'
  | 'lob'
  | 'camera';

export interface ActionMeta {
  id: ActionId;
  label: string;
  hint: string;
}

export const ACTIONS: ActionMeta[] = [
  { id: 'forward', label: 'Move forward', hint: 'Run away from the camera' },
  { id: 'back', label: 'Move back', hint: 'Run towards the camera' },
  { id: 'left', label: 'Move left', hint: '' },
  { id: 'right', label: 'Move right', hint: '' },
  { id: 'sprint', label: 'Sprint', hint: 'Burns stamina, wide turns' },
  { id: 'jump', label: 'Jump', hint: 'Set up volleys, hurdle slides' },
  { id: 'kick', label: 'Kick (hold to charge)', hint: 'Power scales with hold time' },
  { id: 'tackle', label: 'Tackle', hint: 'Short poke at the ball' },
  { id: 'slide', label: 'Slide tackle', hint: 'Committed, risky, big impact' },
  { id: 'challenge', label: 'Body challenge', hint: 'Shoulder barge the opponent' },
  { id: 'lob', label: 'Lob modifier', hint: 'Hold while kicking to chip it' },
  { id: 'camera', label: 'Toggle camera', hint: 'Ball cam / player cam' },
];

export type Bindings = Record<ActionId, string>;

/** Codes prefixed with `Mouse` refer to mouse buttons. */
export const DEFAULT_BINDINGS_P1: Bindings = {
  forward: 'KeyW',
  back: 'KeyS',
  left: 'KeyA',
  right: 'KeyD',
  sprint: 'ShiftLeft',
  jump: 'Space',
  kick: 'Mouse0',
  tackle: 'Mouse2',
  slide: 'ControlLeft',
  challenge: 'KeyE',
  lob: 'KeyQ',
  camera: 'KeyC',
};

export const DEFAULT_BINDINGS_P2: Bindings = {
  forward: 'ArrowUp',
  back: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight',
  sprint: 'ShiftRight',
  jump: 'Numpad0',
  kick: 'Numpad1',
  tackle: 'Numpad2',
  slide: 'Numpad3',
  challenge: 'Numpad4',
  lob: 'Numpad5',
  camera: 'Numpad9',
};

export function prettyKey(code: string): string {
  if (code.startsWith('Mouse')) {
    const n = Number(code.slice(5));
    return n === 0 ? 'L-Click' : n === 2 ? 'R-Click' : n === 1 ? 'M-Click' : `Mouse${n}`;
  }
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Arrow')) return code.slice(5) + ' Arrow';
  if (code.startsWith('Numpad')) return 'Num ' + code.slice(6);
  switch (code) {
    case 'ShiftLeft':
      return 'L-Shift';
    case 'ShiftRight':
      return 'R-Shift';
    case 'ControlLeft':
      return 'L-Ctrl';
    case 'ControlRight':
      return 'R-Ctrl';
    case 'Space':
      return 'Space';
    default:
      return code;
  }
}
