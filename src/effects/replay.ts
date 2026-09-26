/** Fixed-size replay buffer: records the last few seconds of the match. */

export interface ReplayFrame {
  t: number;
  ballX: number;
  ballY: number;
  ballZ: number;
  players: { x: number; y: number; z: number; yaw: number; slide: number; charge: number }[];
}

export class ReplayRecorder {
  private frames: ReplayFrame[] = [];
  private time = 0;
  private capacity: number;
  private interval = 1 / 45;
  private acc = 0;

  constructor(seconds = 5) {
    this.capacity = Math.ceil(seconds / this.interval);
  }

  reset(): void {
    this.frames.length = 0;
    this.time = 0;
    this.acc = 0;
  }

  record(
    dt: number,
    ball: { x: number; y: number; z: number },
    players: { x: number; y: number; z: number; yaw: number; slide: number; charge: number }[],
  ): void {
    this.time += dt;
    this.acc += dt;
    if (this.acc < this.interval) return;
    this.acc = 0;
    this.frames.push({
      t: this.time,
      ballX: ball.x,
      ballY: ball.y,
      ballZ: ball.z,
      players: players.map((p) => ({ ...p })),
    });
    if (this.frames.length > this.capacity) this.frames.shift();
  }

  /** Returns the last `seconds` of footage (oldest first). */
  take(seconds: number): ReplayFrame[] {
    const cutoff = this.time - seconds;
    return this.frames.filter((f) => f.t >= cutoff).map((f) => ({ ...f, players: f.players.map((p) => ({ ...p })) }));
  }
}

export class ReplayPlayer {
  private frames: ReplayFrame[] = [];
  private time = 0;
  private speed = 0.45;
  active = false;

  start(frames: ReplayFrame[], speed = 0.45): void {
    if (frames.length < 4) {
      this.active = false;
      return;
    }
    this.frames = frames;
    this.time = frames[0].t;
    this.speed = speed;
    this.active = true;
  }

  stop(): void {
    this.active = false;
    this.frames = [];
  }

  /** Advances playback and returns the interpolated frame. */
  update(dt: number): ReplayFrame | null {
    if (!this.active || this.frames.length < 2) return null;
    this.time += dt * this.speed;
    const last = this.frames[this.frames.length - 1];
    if (this.time >= last.t) {
      this.active = false;
      return last;
    }
    let i = 0;
    while (i < this.frames.length - 2 && this.frames[i + 1].t < this.time) i++;
    const a = this.frames[i];
    const b = this.frames[i + 1];
    const span = Math.max(1e-4, b.t - a.t);
    const t = Math.min(1, Math.max(0, (this.time - a.t) / span));
    const lerp = (x: number, y: number) => x + (y - x) * t;
    return {
      t: this.time,
      ballX: lerp(a.ballX, b.ballX),
      ballY: lerp(a.ballY, b.ballY),
      ballZ: lerp(a.ballZ, b.ballZ),
      players: a.players.map((p, idx) => {
        const q = b.players[idx] ?? p;
        return {
          x: lerp(p.x, q.x),
          y: lerp(p.y, q.y),
          z: lerp(p.z, q.z),
          yaw: p.yaw + Math.atan2(Math.sin(q.yaw - p.yaw), Math.cos(q.yaw - p.yaw)) * t,
          slide: lerp(p.slide, q.slide),
          charge: lerp(p.charge, q.charge),
        };
      }),
    };
  }
}
