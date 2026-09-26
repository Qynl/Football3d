import { clamp } from '../core/math.ts';

export type SfxName =
  | 'kick'
  | 'kickPower'
  | 'kickQuick'
  | 'bounce'
  | 'wall'
  | 'post'
  | 'crossbar'
  | 'net'
  | 'tackle'
  | 'slide'
  | 'dive'
  | 'header'
  | 'body'
  | 'goal'
  | 'whistle'
  | 'ui'
  | 'uiBack'
  | 'count'
  | 'countGo'
  | 'jump'
  | 'land'
  | 'charge'
  | 'save'
  | 'foul';

/**
 * 100% procedural audio - every sound is synthesised at runtime with WebAudio,
 * so there are no third-party samples anywhere in the project.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfxBus!: GainNode;
  private musicBus!: GainNode;
  private compressor!: DynamicsCompressorNode;
  private noiseBuffer!: AudioBuffer;
  private started = false;
  private musicTimer: number | null = null;
  private step = 0;
  private nextNoteTime = 0;
  private tempo = 128;
  private musicMode: 'menu' | 'match' | 'off' = 'off';
  private intensity = 0;
  private chargeOsc: OscillatorNode | null = null;
  private chargeGain: GainNode | null = null;
  masterVolume = 0.75;
  sfxVolume = 0.9;
  musicVolume = 0.42;
  muted = false;

  /** Must be called from a user gesture. */
  init(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctor: typeof AudioContext =
      window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    this.ctx = new Ctor();
    this.compressor = this.ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -14;
    this.compressor.knee.value = 24;
    this.compressor.ratio.value = 8;
    this.compressor.attack.value = 0.004;
    this.compressor.release.value = 0.22;
    this.master = this.ctx.createGain();
    this.master.gain.value = this.masterVolume;
    this.sfxBus = this.ctx.createGain();
    this.sfxBus.gain.value = this.sfxVolume;
    this.musicBus = this.ctx.createGain();
    this.musicBus.gain.value = this.musicVolume;
    this.sfxBus.connect(this.compressor);
    this.musicBus.connect(this.compressor);
    this.compressor.connect(this.master);
    this.master.connect(this.ctx.destination);

    // Shared white-noise buffer.
    const len = this.ctx.sampleRate * 1.2;
    this.noiseBuffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.started = true;
  }

  get ready(): boolean {
    return this.started && !!this.ctx;
  }

  setVolumes(master: number, sfx: number, music: number): void {
    this.masterVolume = master;
    this.sfxVolume = sfx;
    this.musicVolume = music;
    if (!this.ctx) return;
    this.master.gain.value = this.muted ? 0 : master;
    this.sfxBus.gain.value = sfx;
    this.musicBus.gain.value = music;
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.ctx) this.master.gain.value = m ? 0 : this.masterVolume;
  }

  private now(): number {
    return this.ctx!.currentTime;
  }

  private noise(duration: number, gain: number, filter: number, q = 1, type: BiquadFilterType = 'bandpass'): void {
    if (!this.ctx) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const biquad = this.ctx.createBiquadFilter();
    biquad.type = type;
    biquad.frequency.value = filter;
    biquad.Q.value = q;
    const g = this.ctx.createGain();
    const t = this.now();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0008, t + duration);
    src.connect(biquad).connect(g).connect(this.sfxBus);
    src.start(t);
    src.stop(t + duration + 0.05);
  }

  private tone(
    freq: number,
    endFreq: number,
    duration: number,
    gain: number,
    type: OscillatorType = 'sine',
    delay = 0,
    bus?: GainNode,
  ): void {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    const g = this.ctx.createGain();
    const t = this.now() + delay;
    osc.frequency.setValueAtTime(freq, t);
    if (endFreq !== freq) osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), t + duration);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0008, t + duration);
    osc.connect(g).connect(bus ?? this.sfxBus);
    osc.start(t);
    osc.stop(t + duration + 0.05);
  }

  /** FM bell used for post/crossbar hits. */
  private bell(freq: number, duration: number, gain: number, ratio = 2.4): void {
    if (!this.ctx) return;
    const t = this.now();
    const carrier = this.ctx.createOscillator();
    const mod = this.ctx.createOscillator();
    const modGain = this.ctx.createGain();
    const g = this.ctx.createGain();
    carrier.frequency.value = freq;
    mod.frequency.value = freq * ratio;
    modGain.gain.setValueAtTime(freq * 2.2, t);
    modGain.gain.exponentialRampToValueAtTime(freq * 0.05, t + duration);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0008, t + duration);
    mod.connect(modGain).connect(carrier.frequency);
    carrier.connect(g).connect(this.sfxBus);
    carrier.start(t);
    mod.start(t);
    carrier.stop(t + duration + 0.05);
    mod.stop(t + duration + 0.05);
  }

  play(name: SfxName, intensity = 1): void {
    if (!this.ready) return;
    const i = clamp(intensity, 0, 1.6);
    switch (name) {
      case 'kickQuick':
        this.tone(220, 90, 0.1, 0.22, 'triangle');
        this.noise(0.07, 0.18, 1800, 0.8);
        break;
      case 'kick':
        this.tone(190 - i * 40, 62, 0.16 + i * 0.05, 0.28 + i * 0.18, 'triangle');
        this.noise(0.1, 0.22 + i * 0.12, 1500 + i * 700, 0.9);
        break;
      case 'kickPower':
        this.tone(150, 45, 0.3, 0.5, 'sawtooth');
        this.tone(300, 70, 0.22, 0.3, 'triangle');
        this.noise(0.22, 0.42, 900, 0.6, 'lowpass');
        break;
      case 'bounce':
        this.tone(320 + i * 260, 130, 0.09, 0.1 + i * 0.16, 'sine');
        this.noise(0.05, 0.05 + i * 0.1, 2400, 1.4);
        break;
      case 'wall':
        this.tone(160, 80, 0.13, 0.16 + i * 0.16, 'square');
        this.noise(0.09, 0.14 * i, 1100, 1.1);
        break;
      case 'post':
        this.bell(430, 0.85, 0.34 * (0.5 + i), 3.1);
        this.noise(0.12, 0.16, 2600, 2);
        break;
      case 'crossbar':
        this.bell(620, 0.7, 0.32 * (0.5 + i), 2.7);
        this.noise(0.1, 0.14, 3200, 2);
        break;
      case 'net':
        this.noise(0.28, 0.1 + i * 0.08, 3600, 0.6, 'highpass');
        break;
      case 'tackle':
        this.tone(120, 55, 0.16, 0.3, 'square');
        this.noise(0.18, 0.28, 700, 0.7, 'lowpass');
        break;
      case 'slide':
        this.noise(0.55, 0.26, 950, 0.7, 'bandpass');
        this.tone(90, 60, 0.4, 0.1, 'sine');
        break;
      case 'dive':
        // Effort grunt + the whoosh of a body leaving the ground.
        this.tone(170, 110, 0.22, 0.2, 'sawtooth');
        this.noise(0.3, 0.16, 1400, 0.5, 'bandpass');
        break;
      case 'header':
        // Flat, hollow thump: the ball meeting a forehead, not a boot.
        this.tone(140, 70, 0.16, 0.34 + i * 0.25, 'sine');
        this.noise(0.09, 0.3, 700, 0.9, 'lowpass');
        break;
      case 'body':
        this.tone(95, 48, 0.2, 0.28 + i * 0.2, 'sine');
        this.noise(0.14, 0.2, 500, 0.8, 'lowpass');
        break;
      case 'save':
        this.tone(260, 150, 0.12, 0.2, 'triangle');
        this.noise(0.14, 0.2, 1400, 1);
        break;
      case 'jump':
        this.tone(320, 520, 0.12, 0.09, 'sine');
        break;
      case 'land':
        this.tone(110, 60, 0.11, 0.12 * i, 'sine');
        this.noise(0.09, 0.1 * i, 700, 0.9, 'lowpass');
        break;
      case 'whistle':
        this.whistle();
        break;
      case 'foul':
        this.whistle(0.9);
        break;
      case 'goal':
        this.goalSound();
        break;
      case 'ui':
        this.tone(660, 880, 0.07, 0.1, 'square');
        break;
      case 'uiBack':
        this.tone(440, 300, 0.09, 0.09, 'square');
        break;
      case 'count':
        this.tone(520, 520, 0.14, 0.18, 'triangle');
        break;
      case 'countGo':
        this.tone(780, 1040, 0.3, 0.24, 'triangle');
        this.tone(1040, 1560, 0.3, 0.12, 'sine', 0.04);
        break;
      case 'charge':
        break;
    }
  }

  private whistle(len = 0.55): void {
    if (!this.ctx) return;
    const t = this.now();
    const osc = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    const vib = this.ctx.createOscillator();
    const vibGain = this.ctx.createGain();
    const g = this.ctx.createGain();
    osc.type = 'sine';
    osc2.type = 'sine';
    osc.frequency.value = 2350;
    osc2.frequency.value = 2900;
    vib.frequency.value = 22;
    vibGain.gain.value = 110;
    vib.connect(vibGain);
    vibGain.connect(osc.frequency);
    vibGain.connect(osc2.frequency);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.18, t + 0.02);
    g.gain.setValueAtTime(0.18, t + len * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0008, t + len);
    osc.connect(g);
    osc2.connect(g);
    g.connect(this.sfxBus);
    osc.start(t);
    osc2.start(t);
    vib.start(t);
    osc.stop(t + len + 0.05);
    osc2.stop(t + len + 0.05);
    vib.stop(t + len + 0.05);
  }

  private goalSound(): void {
    if (!this.ctx) return;
    // Crowd roar: filtered noise swelling up.
    const t = this.now();
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(420, t);
    filter.frequency.exponentialRampToValueAtTime(1500, t + 0.5);
    filter.Q.value = 0.7;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.42, t + 0.25);
    g.gain.setValueAtTime(0.42, t + 1.1);
    g.gain.exponentialRampToValueAtTime(0.0008, t + 2.6);
    src.connect(filter).connect(g).connect(this.sfxBus);
    src.start(t);
    src.stop(t + 2.7);
    // Air-horn style chord.
    const notes = [261.6, 329.6, 392, 523.3];
    notes.forEach((n, i) => {
      this.tone(n, n, 0.85, 0.11, 'sawtooth', i * 0.05);
      this.tone(n * 2, n * 2, 0.6, 0.05, 'square', i * 0.05);
    });
  }

  /** Continuous rising tone while a shot charges. */
  updateCharge(charge: number): void {
    if (!this.ready) return;
    if (charge <= 0.02) {
      if (this.chargeOsc) {
        const t = this.now();
        this.chargeGain!.gain.cancelScheduledValues(t);
        this.chargeGain!.gain.setTargetAtTime(0, t, 0.03);
        this.chargeOsc.stop(t + 0.2);
        this.chargeOsc = null;
        this.chargeGain = null;
      }
      return;
    }
    if (!this.chargeOsc) {
      const osc = this.ctx!.createOscillator();
      const g = this.ctx!.createGain();
      osc.type = 'sawtooth';
      g.gain.value = 0.0001;
      const filter = this.ctx!.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 900;
      osc.connect(filter).connect(g).connect(this.sfxBus);
      osc.start();
      this.chargeOsc = osc;
      this.chargeGain = g;
    }
    const t = this.now();
    this.chargeOsc.frequency.setTargetAtTime(110 + charge * 330, t, 0.02);
    this.chargeGain!.gain.setTargetAtTime(0.018 + charge * 0.05, t, 0.03);
  }

  // ------------------------------------------------------------------ music

  startMusic(mode: 'menu' | 'match'): void {
    if (!this.ready) return;
    this.musicMode = mode;
    this.tempo = mode === 'menu' ? 104 : 128;
    if (this.musicTimer !== null) return;
    this.nextNoteTime = this.now() + 0.1;
    this.step = 0;
    this.musicTimer = window.setInterval(() => this.scheduler(), 25);
  }

  stopMusic(): void {
    this.musicMode = 'off';
    if (this.musicTimer !== null) {
      clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
  }

  setIntensity(v: number): void {
    this.intensity = clamp(v, 0, 1);
  }

  /** Short celebratory sting layered over the music. */
  goalSting(): void {
    if (!this.ready) return;
    const notes = [523.3, 659.3, 784, 1046.5];
    notes.forEach((n, i) => this.tone(n, n, 0.35, 0.12, 'square', i * 0.08, this.musicBus));
  }

  private scheduler(): void {
    if (!this.ctx || this.musicMode === 'off') return;
    const secondsPerStep = 60 / this.tempo / 4;
    while (this.nextNoteTime < this.now() + 0.12) {
      this.scheduleStep(this.step, this.nextNoteTime);
      this.nextNoteTime += secondsPerStep;
      this.step = (this.step + 1) % 64;
    }
  }

  private scheduleStep(step: number, time: number): void {
    const ctx = this.ctx!;
    const bar = Math.floor(step / 16);
    const s = step % 16;
    const menu = this.musicMode === 'menu';
    const energy = menu ? 0.35 : 0.55 + this.intensity * 0.45;

    // Root progression (natural minor vibes, original melody).
    const roots = [55, 65.41, 49, 58.27]; // A1, C2, G1, Bb1
    const root = roots[bar % roots.length];

    // Kick drum.
    if (s % 4 === 0 || (!menu && s === 14 && bar % 2 === 1)) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.frequency.setValueAtTime(150, time);
      osc.frequency.exponentialRampToValueAtTime(45, time + 0.12);
      g.gain.setValueAtTime(0.5 * energy, time);
      g.gain.exponentialRampToValueAtTime(0.001, time + 0.18);
      osc.connect(g).connect(this.musicBus);
      osc.start(time);
      osc.stop(time + 0.2);
    }

    // Clap / snare.
    if (s === 4 || s === 12) {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 1900;
      f.Q.value = 0.9;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.26 * energy, time);
      g.gain.exponentialRampToValueAtTime(0.001, time + 0.14);
      src.connect(f).connect(g).connect(this.musicBus);
      src.start(time);
      src.stop(time + 0.16);
    }

    // Hats.
    if (s % 2 === 1 && (!menu || s % 4 === 1)) {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      const f = ctx.createBiquadFilter();
      f.type = 'highpass';
      f.frequency.value = 7000;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.07 * energy, time);
      g.gain.exponentialRampToValueAtTime(0.001, time + 0.05);
      src.connect(f).connect(g).connect(this.musicBus);
      src.start(time);
      src.stop(time + 0.06);
    }

    // Bassline.
    if (s % 2 === 0) {
      const pattern = [0, 0, 7, 0, 0, 5, 3, 0];
      const semis = pattern[(s / 2) % pattern.length];
      const freq = root * Math.pow(2, semis / 12);
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(320 + this.intensity * 700, time);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, time);
      g.gain.linearRampToValueAtTime(0.2 * energy, time + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, time + 0.18);
      osc.frequency.value = freq;
      osc.connect(f).connect(g).connect(this.musicBus);
      osc.start(time);
      osc.stop(time + 0.22);
    }

    // Arpeggio lead, only when the match heats up.
    if (!menu && this.intensity > 0.25 && s % 2 === 0) {
      const arp = [12, 15, 19, 22, 19, 15];
      const semis = arp[(step / 2) % arp.length];
      const osc = ctx.createOscillator();
      osc.type = 'square';
      const g = ctx.createGain();
      const freq = root * 2 * Math.pow(2, semis / 12);
      osc.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, time);
      g.gain.linearRampToValueAtTime(0.055 * this.intensity, time + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, time + 0.14);
      osc.connect(g).connect(this.musicBus);
      osc.start(time);
      osc.stop(time + 0.16);
    }

    // Pad chord on bar starts.
    if (s === 0) {
      [0, 3, 7].forEach((semis, idx) => {
        const osc = ctx.createOscillator();
        osc.type = 'triangle';
        const g = ctx.createGain();
        osc.frequency.value = root * 4 * Math.pow(2, semis / 12);
        g.gain.setValueAtTime(0.0001, time);
        g.gain.linearRampToValueAtTime(0.035 * energy, time + 0.08);
        g.gain.exponentialRampToValueAtTime(0.001, time + 1.5);
        osc.connect(g).connect(this.musicBus);
        osc.start(time + idx * 0.01);
        osc.stop(time + 1.6);
      });
    }
  }
}
