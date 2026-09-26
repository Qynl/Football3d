import { clamp } from '../core/math.ts';
import {
  DEFAULT_BINDINGS_P1,
  DEFAULT_BINDINGS_P2,
  type ActionId,
  type Bindings,
} from './bindings.ts';

export interface ControlState {
  moveX: number;
  moveZ: number;
  sprint: boolean;
  jumpPressed: boolean;
  kickHeld: boolean;
  kickPressed: boolean;
  kickReleased: boolean;
  tacklePressed: boolean;
  slidePressed: boolean;
  challengePressed: boolean;
  lobHeld: boolean;
  cameraPressed: boolean;
  aimYaw: number;
  aimPitch: number;
  /** True when this control source produced any input this frame. */
  active: boolean;
}

function emptyState(): ControlState {
  return {
    moveX: 0,
    moveZ: 0,
    sprint: false,
    jumpPressed: false,
    kickHeld: false,
    kickPressed: false,
    kickReleased: false,
    tacklePressed: false,
    slidePressed: false,
    challengePressed: false,
    lobHeld: false,
    cameraPressed: false,
    aimYaw: 0,
    aimPitch: 0,
    active: false,
  };
}

export interface InputOptions {
  mouseSensitivity: number;
  invertY: boolean;
  gamepadDeadzone: number;
}

/**
 * Central input manager: keyboard, mouse (pointer lock) and gamepads.
 * Player 0 uses bindings set 1 + mouse + gamepad 0, player 1 uses bindings set 2
 * + gamepad 1 (for local versus).
 */
export class InputManager {
  private keys = new Set<string>();
  private pressedThisFrame = new Set<string>();
  private releasedThisFrame = new Set<string>();
  private mouseDelta = { x: 0, y: 0 };
  private wheel = 0;
  bindings: [Bindings, Bindings] = [{ ...DEFAULT_BINDINGS_P1 }, { ...DEFAULT_BINDINGS_P2 }];
  options: InputOptions = { mouseSensitivity: 1, invertY: false, gamepadDeadzone: 0.18 };
  private states: [ControlState, ControlState] = [emptyState(), emptyState()];
  private prevGamepadButtons: Map<number, boolean[]> = new Map();
  private element: HTMLElement | null = null;
  pointerLocked = false;
  /** Set while the UI is capturing a key for rebinding. */
  captureCallback: ((code: string) => void) | null = null;
  enabled = true;
  /** Any gamepad seen this session. */
  gamepadConnected = false;
  lastInputWasGamepad = false;

  attach(element: HTMLElement): void {
    this.element = element;
    window.addEventListener('keydown', this.onKeyDown, { passive: false });
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('wheel', this.onWheel, { passive: true });
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    element.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('gamepadconnected', () => (this.gamepadConnected = true));
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (this.captureCallback) {
      e.preventDefault();
      const cb = this.captureCallback;
      this.captureCallback = null;
      cb(e.code);
      return;
    }
    if (e.repeat) return;
    if (
      ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code) &&
      this.enabled
    ) {
      e.preventDefault();
    }
    this.keys.add(e.code);
    this.pressedThisFrame.add(e.code);
    this.lastInputWasGamepad = false;
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
    this.releasedThisFrame.add(e.code);
  };

  private onMouseDown = (e: MouseEvent): void => {
    const code = `Mouse${e.button}`;
    if (this.captureCallback) {
      const cb = this.captureCallback;
      this.captureCallback = null;
      cb(code);
      e.preventDefault();
      return;
    }
    this.keys.add(code);
    this.pressedThisFrame.add(code);
    this.lastInputWasGamepad = false;
  };

  private onMouseUp = (e: MouseEvent): void => {
    const code = `Mouse${e.button}`;
    this.keys.delete(code);
    this.releasedThisFrame.add(code);
  };

  private onMouseMove = (e: MouseEvent): void => {
    if (!this.pointerLocked) return;
    this.mouseDelta.x += e.movementX;
    this.mouseDelta.y += e.movementY;
    this.lastInputWasGamepad = false;
  };

  private onWheel = (e: WheelEvent): void => {
    this.wheel += Math.sign(e.deltaY);
  };

  private onBlur = (): void => {
    this.keys.clear();
  };

  private onPointerLockChange = (): void => {
    this.pointerLocked = document.pointerLockElement === this.element;
  };

  requestPointerLock(): void {
    if (!this.element || this.pointerLocked) return;
    const el = this.element as HTMLElement & { requestPointerLock(opts?: unknown): void };
    try {
      el.requestPointerLock();
    } catch {
      /* ignore */
    }
  }

  exitPointerLock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  isDown(code: string): boolean {
    return this.keys.has(code);
  }

  wasPressed(code: string): boolean {
    return this.pressedThisFrame.has(code);
  }

  takeWheel(): number {
    const w = this.wheel;
    this.wheel = 0;
    return w;
  }

  private gamepad(index: number): Gamepad | null {
    const pads = navigator.getGamepads?.() ?? [];
    let seen = 0;
    for (const pad of pads) {
      if (!pad) continue;
      if (seen === index) return pad;
      seen++;
    }
    return null;
  }

  private padButton(pad: Gamepad, i: number): boolean {
    const b = pad.buttons[i];
    return !!b && (b.pressed || b.value > 0.5);
  }

  private padPressed(pad: Gamepad, padIndex: number, i: number): boolean {
    const prev = this.prevGamepadButtons.get(padIndex);
    const now = this.padButton(pad, i);
    const before = prev?.[i] ?? false;
    return now && !before;
  }

  /** Called once per rendered frame before gameplay reads input. */
  update(): void {
    for (let p = 0; p < 2; p++) {
      const s = this.states[p];
      const b = this.bindings[p];
      const down = (a: ActionId) => this.keys.has(b[a]);
      const pressed = (a: ActionId) => this.pressedThisFrame.has(b[a]);
      const released = (a: ActionId) => this.releasedThisFrame.has(b[a]);

      let mx = (down('right') ? 1 : 0) - (down('left') ? 1 : 0);
      let mz = (down('forward') ? 1 : 0) - (down('back') ? 1 : 0);
      s.sprint = down('sprint');
      s.jumpPressed = pressed('jump');
      s.kickHeld = down('kick');
      s.kickPressed = pressed('kick');
      s.kickReleased = released('kick');
      s.tacklePressed = pressed('tackle');
      s.slidePressed = pressed('slide');
      s.challengePressed = pressed('challenge');
      s.lobHeld = down('lob');
      s.cameraPressed = pressed('camera');
      s.aimYaw = 0;
      s.aimPitch = 0;

      if (p === 0 && this.pointerLocked) {
        s.aimYaw = -this.mouseDelta.x * 0.0022 * this.options.mouseSensitivity;
        s.aimPitch = -this.mouseDelta.y * 0.0018 * this.options.mouseSensitivity * (this.options.invertY ? -1 : 1);
      }

      // Gamepad overlay.
      const pad = this.gamepad(p);
      if (pad) {
        this.gamepadConnected = true;
        const dz = this.options.gamepadDeadzone;
        const ax = pad.axes[0] ?? 0;
        const ay = pad.axes[1] ?? 0;
        const rx = pad.axes[2] ?? 0;
        const ry = pad.axes[3] ?? 0;
        const mag = Math.hypot(ax, ay);
        if (mag > dz) {
          const scale = (mag - dz) / (1 - dz) / mag;
          mx += ax * scale;
          mz += -ay * scale;
          this.lastInputWasGamepad = true;
        }
        if (Math.abs(rx) > dz) s.aimYaw += -rx * 0.055;
        if (Math.abs(ry) > dz) s.aimPitch += -ry * 0.035 * (this.options.invertY ? -1 : 1);
        // Buttons: A jump, X kick, B tackle, Y challenge, LB slide, RT sprint, RB lob.
        if (this.padButton(pad, 7) || this.padButton(pad, 10)) s.sprint = true;
        if (this.padPressed(pad, p, 0)) s.jumpPressed = true;
        const kickNow = this.padButton(pad, 2);
        const kickBefore = this.prevGamepadButtons.get(p)?.[2] ?? false;
        if (kickNow) s.kickHeld = true;
        if (kickNow && !kickBefore) s.kickPressed = true;
        if (!kickNow && kickBefore) s.kickReleased = true;
        if (this.padPressed(pad, p, 1)) s.tacklePressed = true;
        if (this.padPressed(pad, p, 4) || this.padPressed(pad, p, 6)) s.slidePressed = true;
        if (this.padPressed(pad, p, 3)) s.challengePressed = true;
        if (this.padButton(pad, 5)) s.lobHeld = true;
        if (this.padPressed(pad, p, 9)) s.cameraPressed = true;
        this.prevGamepadButtons.set(
          p,
          pad.buttons.map((btn) => btn.pressed || btn.value > 0.5),
        );
        if (pad.buttons.some((btn) => btn.pressed)) this.lastInputWasGamepad = true;
      }

      const len = Math.hypot(mx, mz);
      if (len > 1) {
        mx /= len;
        mz /= len;
      }
      s.moveX = clamp(mx, -1, 1);
      s.moveZ = clamp(mz, -1, 1);
      s.active =
        len > 0.01 ||
        s.kickHeld ||
        s.jumpPressed ||
        s.tacklePressed ||
        s.slidePressed ||
        s.challengePressed;
    }
    this.mouseDelta.x = 0;
    this.mouseDelta.y = 0;
  }

  /** Clears one-frame edges. Call at the very end of the frame. */
  endFrame(): void {
    this.pressedThisFrame.clear();
    this.releasedThisFrame.clear();
  }

  get(playerIndex: number): ControlState {
    return this.states[playerIndex] ?? this.states[0];
  }

  /** Neutral state used when a controller should be ignored (menus, cutscenes). */
  static neutral(): ControlState {
    return emptyState();
  }
}
