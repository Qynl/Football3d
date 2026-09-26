import { clearChildren, el, hexColor } from './dom.ts';
import { ARENAS } from '../arenas/arenaDefs.ts';
import { RULE_PRESETS, CHAOS_MODIFIERS, type GameMode } from '../match/rules.ts';
import { DIFFICULTIES, PERSONALITIES } from '../ai/personalities.ts';
import {
  ACCESSORIES,
  ARCHETYPES,
  CELEBRATIONS,
  HAIR_COLORS,
  HAIR_STYLES,
  SHIRT_COLORS,
  SHOE_COLORS,
  SHORTS_COLORS,
  SKIN_COLORS,
  type Cosmetics,
} from '../characters/characterDefs.ts';
import { BALL_DESIGNS } from '../ball/ballDesigns.ts';
import { ACTIONS, prettyKey, type ActionId } from '../input/bindings.ts';
import type { Storage } from '../storage/storage.ts';
import type { InputManager } from '../input/input.ts';
import type { AudioEngine } from '../audio/audio.ts';

export interface StartOptions {
  mode: GameMode;
  rulesId: string;
  arenaId: string;
  difficulty: string;
  personality: string;
  chaos: string[];
}

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

export class Ui {
  private root: HTMLElement;
  private host: UiHost;
  private screens = new Map<ScreenName, HTMLElement>();
  private hud!: HTMLElement;
  private bannerEl!: HTMLElement;
  private bannerMain!: HTMLElement;
  private bannerSub!: HTMLElement;
  private bannerTimer = 0;
  private scoreA!: HTMLElement;
  private scoreB!: HTMLElement;
  private nameA!: HTMLElement;
  private nameB!: HTMLElement;
  private clock!: HTMLElement;
  private clockMode!: HTMLElement;
  private chargeWrap!: HTMLElement;
  private chargeFill!: HTMLElement;
  private chargeLabel!: HTMLElement;
  private curveDot!: HTMLElement;
  private staminaFill!: HTMLElement;
  private hudCorner!: HTMLElement;
  private trainingHud!: HTMLElement;
  private debugPanel!: HTMLElement;
  private toastEl!: HTMLElement;
  private toastTimer = 0;
  private endBody!: HTMLElement;
  private current: ScreenName = 'menu';
  private selection: StartOptions;
  private listeningFor: { player: number; action: ActionId } | null = null;
  private lastMode: GameMode = 'quick';

  constructor(host: UiHost) {
    this.host = host;
    this.root = document.getElementById('ui-root')!;
    const l = host.storage.data.loadout;
    this.selection = {
      mode: 'quick',
      rulesId: 'classic',
      arenaId: l.arena,
      difficulty: l.difficulty,
      personality: l.personality,
      chaos: ['superBounce', 'lowGravity'],
    };
    this.buildHud();
    this.buildMenu();
    this.buildPause();
    this.buildEnd();
    this.buildCustomize();
    this.buildSettings();
    this.buildHowTo();
    this.show('menu');
  }

  // ------------------------------------------------------------------- hud

  private buildHud(): void {
    this.scoreA = el('span', { class: 'v' }, ['0']);
    this.scoreB = el('span', { class: 'v' }, ['0']);
    this.nameA = el('span', { class: 'tag' }, ['YOU']);
    this.nameB = el('span', { class: 'tag' }, ['CPU']);
    this.clock = el('div', { class: 'clock' });
    this.clockMode = el('div', { class: 'mode' }, ['QUICK MATCH']);
    const clockValue = el('div', {}, ['3:00']);
    this.clock.append(clockValue, this.clockMode);
    (this.clock as HTMLElement & { valueEl: HTMLElement }).valueEl = clockValue;

    const scoreboard = el('div', { class: 'scoreboard' }, [
      el('div', { class: 'side' }, [this.nameA, this.scoreA]),
      this.clock,
      el('div', { class: 'side' }, [this.scoreB, this.nameB]),
    ]);

    this.bannerMain = el('div', { class: 'main' });
    this.bannerSub = el('div', { class: 'sub' });
    this.bannerEl = el('div', { id: 'banner' }, [this.bannerMain, this.bannerSub]);

    this.chargeFill = el('div', { class: 'charge-fill' });
    this.curveDot = el('div', { class: 'curve-indicator' });
    this.chargeLabel = el('div', { class: 'charge-label' }, ['QUICK']);
    this.chargeWrap = el('div', { class: 'charge-wrap' }, [
      el('div', { class: 'charge-bar' }, [this.chargeFill, this.curveDot]),
      this.chargeLabel,
    ]);

    this.staminaFill = el('div', { class: 'fill' });
    const stamina = el('div', { class: 'stamina' }, [
      el('div', { class: 'label' }, ['STAMINA']),
      el('div', { class: 'bar' }, [this.staminaFill]),
    ]);

    this.hudCorner = el('div', { class: 'hud-corner' });
    this.trainingHud = el('div', { class: 'training-hud', style: { display: 'none' } });
    this.debugPanel = el('div', { id: 'debug-panel' });
    this.toastEl = el('div', { class: 'toast' });

    const hint = el('div', { class: 'controls-hint' }, [
      'WASD move · SHIFT sprint · SPACE jump · HOLD L-CLICK kick · R-CLICK tackle · CTRL slide · E shove · Q lob · ESC pause',
    ]);

    this.hud = el('div', { id: 'hud' }, [
      scoreboard,
      this.bannerEl,
      this.chargeWrap,
      stamina,
      this.hudCorner,
      this.trainingHud,
      this.debugPanel,
      this.toastEl,
      hint,
    ]);
    this.root.append(this.hud);
  }

  updateHud(s: HudState): void {
    this.scoreA.textContent = String(s.scoreA);
    this.scoreB.textContent = String(s.scoreB);
    this.nameA.textContent = s.nameA;
    this.nameB.textContent = s.nameB;
    const clock = this.clock as HTMLElement & { valueEl: HTMLElement };
    clock.valueEl.textContent = s.time;
    this.clock.classList.toggle('urgent', s.urgent);
    this.clockMode.textContent = s.mode;

    this.chargeWrap.classList.toggle('active', s.chargeActive);
    this.chargeFill.style.width = `${Math.round(s.charge * 100)}%`;
    this.curveDot.style.left = `${50 + s.curve * 46}%`;
    this.chargeLabel.textContent = s.lob
      ? 'LOB'
      : s.charge < 0.12
        ? 'QUICK'
        : s.charge < 0.42
          ? 'NORMAL'
          : s.charge < 0.78
            ? 'POWER'
            : 'MAX POWER';
    this.staminaFill.style.width = `${Math.round(s.stamina)}%`;

    this.hudCorner.innerHTML = s.aiState
      ? `<b>${s.aiState}</b><br>${s.aiRead}`
      : '';

    if (s.training) {
      this.trainingHud.style.display = 'block';
      this.trainingHud.innerHTML = `${s.training.score} PTS<small>${s.training.last || 'hit the rings'}</small>`;
    } else {
      this.trainingHud.style.display = 'none';
    }
  }

  banner(main: string, sub = '', duration = 1400): void {
    this.bannerMain.textContent = main;
    this.bannerSub.textContent = sub;
    this.bannerEl.classList.remove('show');
    void this.bannerEl.offsetWidth;
    this.bannerEl.classList.add('show');
    this.bannerTimer = duration / 1000;
  }

  toast(text: string): void {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('show');
    this.toastTimer = 1.8;
  }

  tick(dt: number): void {
    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.bannerEl.classList.remove('show');
    }
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.toastEl.classList.remove('show');
    }
  }

  setDebug(text: string, visible: boolean): void {
    this.debugPanel.classList.toggle('visible', visible);
    if (visible) this.debugPanel.textContent = text;
  }

  // ------------------------------------------------------------------ menu

  private makeScreen(name: ScreenName, centered: boolean, children: (Node | string)[]): HTMLElement {
    const screen = el('div', { class: `screen${centered ? ' center' : ''}` }, children);
    this.screens.set(name, screen);
    this.root.append(screen);
    return screen;
  }

  private buildMenu(): void {
    const play = el('button', { class: 'btn primary', onclick: () => this.start('quick') }, [
      'PLAY',
      el('small', {}, ['First whistle in 3 seconds']),
    ]);
    const buttons = el('div', { class: 'menu-buttons' }, [
      play,
      el('button', { class: 'btn', onclick: () => this.start('training') }, [
        'TRAINING',
        el('small', {}, ['Free play + targets']),
      ]),
      el('button', { class: 'btn', onclick: () => this.start('local') }, [
        'LOCAL 1v1',
        el('small', {}, ['Two players, one keyboard']),
      ]),
      el('button', { class: 'btn', onclick: () => this.start('penalty') }, [
        'PENALTY DUEL',
        el('small', {}, ['Best of five']),
      ]),
      el('button', { class: 'btn', onclick: () => this.start('chaos') }, [
        'CHAOS MODE',
        el('small', {}, ['Rules optional']),
      ]),
      el('div', { style: { height: '6px' } }),
      el('button', { class: 'btn ghost', onclick: () => this.show('customize') }, ['CUSTOMIZE']),
      el('button', { class: 'btn ghost', onclick: () => this.show('settings') }, ['SETTINGS']),
      el('button', { class: 'btn ghost', onclick: () => this.show('howto') }, ['HOW TO PLAY']),
    ]);

    const brand = el('div', { class: 'brand' }, [
      el('h1', { class: 'logo', html: 'KICK<span>OFF!</span>' }),
      el('p', { class: 'tagline' }, [
        'One player. One opponent. One ball, and physics that do not care about your feelings. Charge your shots, volley them out of the air, slide in late and accept the consequences.',
      ]),
      buttons,
    ]);

    const setup = el('div', { class: 'setup-grid' }, [
      this.arenaPanel(),
      this.opponentPanel(),
      this.rulesPanel(),
      this.chaosPanel(),
      this.statsPanel(),
    ]);

    this.makeScreen('menu', false, [
      el('div', { class: 'menu-backdrop' }),
      el('div', { class: 'menu-wrap' }, [brand, setup]),
    ]);
  }

  private cardGrid(
    items: { id: string; name: string; desc: string; color?: string }[],
    getActive: () => string,
    onPick: (id: string) => void,
  ): HTMLElement {
    const grid = el('div', { class: 'cards' });
    const render = () => {
      clearChildren(grid);
      for (const item of items) {
        const card = el(
          'div',
          {
            class: `card${getActive() === item.id ? ' active' : ''}`,
            onclick: () => {
              onPick(item.id);
              this.host.audio.play('ui');
              render();
            },
          },
          [
            item.color
              ? el('div', { class: 'thumb', style: { background: item.color } })
              : null,
            el('div', { class: 'name' }, [item.name]),
            el('div', { class: 'desc' }, [item.desc]),
          ].filter(Boolean) as Node[],
        );
        grid.append(card);
      }
    };
    render();
    return grid;
  }

  private arenaPanel(): HTMLElement {
    const items = ARENAS.map((a) => ({
      id: a.id,
      name: a.name,
      desc: a.blurb,
      color: `linear-gradient(140deg, ${hexColor(a.theme.sky)}, ${hexColor(a.theme.grassA)} 60%, ${hexColor(
        a.theme.wallAccent,
      )})`,
    }));
    return el('div', { class: 'panel' }, [
      el('h2', {}, ['Arena']),
      this.cardGrid(
        items,
        () => this.selection.arenaId,
        (id) => {
          this.selection.arenaId = id;
          this.host.storage.data.loadout.arena = id;
          this.host.storage.save();
        },
      ),
    ]);
  }

  private opponentPanel(): HTMLElement {
    const diffPill = el('div', { class: 'pill' });
    const persoPill = el('div', { class: 'pill' });
    const renderDiff = () => {
      clearChildren(diffPill);
      for (const d of DIFFICULTIES) {
        diffPill.append(
          el(
            'button',
            {
              class: this.selection.difficulty === d.id ? 'active' : '',
              onclick: () => {
                this.selection.difficulty = d.id;
                this.host.storage.data.loadout.difficulty = d.id;
                this.host.storage.save();
                this.host.audio.play('ui');
                renderDiff();
              },
            },
            [d.name],
          ),
        );
      }
    };
    const renderPerso = () => {
      clearChildren(persoPill);
      for (const p of PERSONALITIES) {
        persoPill.append(
          el(
            'button',
            {
              class: this.selection.personality === p.id ? 'active' : '',
              title: p.blurb,
              onclick: () => {
                this.selection.personality = p.id;
                this.host.storage.data.loadout.personality = p.id;
                this.host.storage.save();
                this.host.audio.play('ui');
                renderPerso();
                desc.textContent = p.blurb;
              },
            },
            [p.name],
          ),
        );
      }
    };
    const desc = el('div', { class: 'hint', style: { marginTop: '8px' } }, [
      PERSONALITIES.find((p) => p.id === this.selection.personality)?.blurb ?? '',
    ]);
    renderDiff();
    renderPerso();
    return el('div', { class: 'panel' }, [
      el('h2', {}, ['Opponent']),
      el('div', { class: 'hint', style: { marginBottom: '6px' } }, ['Skill']),
      diffPill,
      el('div', { class: 'hint', style: { margin: '10px 0 6px' } }, ['Personality']),
      persoPill,
      desc,
    ]);
  }

  private rulesPanel(): HTMLElement {
    const pill = el('div', { class: 'pill' });
    const desc = el('div', { class: 'hint', style: { marginTop: '8px' } }, ['']);
    const render = () => {
      clearChildren(pill);
      for (const r of RULE_PRESETS) {
        pill.append(
          el(
            'button',
            {
              class: this.selection.rulesId === r.id ? 'active' : '',
              onclick: () => {
                this.selection.rulesId = r.id;
                this.host.audio.play('ui');
                render();
              },
            },
            [r.name],
          ),
        );
      }
      desc.textContent = RULE_PRESETS.find((r) => r.id === this.selection.rulesId)?.blurb ?? '';
    };
    render();
    return el('div', { class: 'panel' }, [el('h2', {}, ['Match rules']), pill, desc]);
  }

  private chaosPanel(): HTMLElement {
    const pill = el('div', { class: 'pill' });
    const render = () => {
      clearChildren(pill);
      for (const m of CHAOS_MODIFIERS) {
        pill.append(
          el(
            'button',
            {
              class: this.selection.chaos.includes(m.id) ? 'active' : '',
              title: m.blurb,
              onclick: () => {
                const i = this.selection.chaos.indexOf(m.id);
                if (i >= 0) this.selection.chaos.splice(i, 1);
                else this.selection.chaos.push(m.id);
                this.host.audio.play('ui');
                render();
              },
            },
            [m.name],
          ),
        );
      }
    };
    render();
    return el('div', { class: 'panel' }, [
      el('h2', {}, ['Chaos modifiers']),
      el('div', { class: 'hint', style: { marginBottom: '8px' } }, [
        'Only used by CHAOS MODE. Mix freely.',
      ]),
      pill,
    ]);
  }

  private statsPanel(): HTMLElement {
    const body = el('div', { class: 'stat-grid' });
    const panel = el('div', { class: 'panel' }, [el('h2', {}, ['Career']), body]);
    this.refreshStats = () => {
      const s = this.host.storage.data.stats;
      clearChildren(body);
      const entries: [string, string | number][] = [
        ['Played', s.matches],
        ['Won', s.wins],
        ['Lost', s.losses],
        ['Goals', s.goals],
        ['Best strike', s.bestGoalDistance ? `${s.bestGoalDistance.toFixed(0)}m` : '-'],
        ['Aerials', s.aerialGoals],
        ['Own goals', s.ownGoals],
        ['Range best', s.trainingBest],
      ];
      for (const [k, v] of entries) {
        body.append(el('div', { class: 'stat' }, [el('div', { class: 'v' }, [String(v)]), el('div', { class: 'k' }, [k])]));
      }
    };
    this.refreshStats();
    return panel;
  }

  private refreshStats: () => void = () => {};

  private start(mode: GameMode): void {
    this.lastMode = mode;
    this.host.audio.play('ui');
    this.host.startMatch({ ...this.selection, mode });
  }

  // ----------------------------------------------------------------- pause

  private buildPause(): void {
    const modal = el('div', { class: 'modal' }, [
      el('h1', {}, ['PAUSED']),
      el('div', { class: 'subtitle' }, ['Take a breath. The ball is not going anywhere.']),
      el('div', { class: 'actions' }, [
        el('button', { class: 'btn primary', onclick: () => this.host.resumeGame() }, ['RESUME']),
        el('button', { class: 'btn', onclick: () => this.host.rematch() }, ['RESTART MATCH']),
        el('button', { class: 'btn', onclick: () => this.show('settings') }, ['SETTINGS']),
        el('button', { class: 'btn danger', onclick: () => this.host.quitToMenu() }, ['MAIN MENU']),
      ]),
    ]);
    this.makeScreen('pause', true, [modal]);
  }

  // ------------------------------------------------------------------- end

  private buildEnd(): void {
    this.endBody = el('div', {});
    const modal = el('div', { class: 'modal' }, [this.endBody]);
    this.makeScreen('end', true, [modal]);
  }

  showResult(opts: {
    title: string;
    subtitle: string;
    scoreLine: string;
    stats: [string, string][];
  }): void {
    clearChildren(this.endBody);
    this.endBody.append(
      el('h1', { style: { textAlign: 'center' } }, [opts.title]),
      el('div', { class: 'result-score' }, [opts.scoreLine]),
      el('div', { class: 'result-line' }, [opts.subtitle]),
      el(
        'div',
        { class: 'stat-grid' },
        opts.stats.map(([k, v]) =>
          el('div', { class: 'stat' }, [el('div', { class: 'v' }, [v]), el('div', { class: 'k' }, [k])]),
        ),
      ),
      el('div', { class: 'actions' }, [
        el('button', { class: 'btn primary', onclick: () => this.host.rematch() }, [
          'REMATCH',
          el('small', {}, ['Instant restart']),
        ]),
        el('button', { class: 'btn', onclick: () => this.showArenaSwitch() }, ['CHANGE ARENA']),
        el('button', { class: 'btn danger', onclick: () => this.host.quitToMenu() }, ['MAIN MENU']),
      ]),
    );
    this.show('end');
  }

  private showArenaSwitch(): void {
    clearChildren(this.endBody);
    this.endBody.append(
      el('h1', { style: { textAlign: 'center' } }, ['PICK A PITCH']),
      this.cardGrid(
        ARENAS.map((a) => ({
          id: a.id,
          name: a.name,
          desc: a.blurb,
          color: `linear-gradient(140deg, ${hexColor(a.theme.sky)}, ${hexColor(a.theme.grassA)} 60%, ${hexColor(
            a.theme.wallAccent,
          )})`,
        })),
        () => this.selection.arenaId,
        (id) => {
          this.selection.arenaId = id;
          this.host.storage.data.loadout.arena = id;
          this.host.storage.save();
          this.host.changeArena(id);
          this.host.rematch();
        },
      ),
      el('div', { class: 'actions' }, [
        el('button', { class: 'btn danger', onclick: () => this.host.quitToMenu() }, ['MAIN MENU']),
      ]),
    );
  }

  // ------------------------------------------------------------- customize

  private buildCustomize(): void {
    const body = el('div', {});
    const modal = el('div', { class: 'modal modal-wide' }, [
      el('h1', {}, ['CUSTOMIZE']),
      el('div', { class: 'subtitle' }, ['Cosmetics never change the physics. Archetypes barely do.']),
      body,
      el('div', { class: 'actions' }, [
        el('button', { class: 'btn primary', onclick: () => this.show('menu') }, ['DONE']),
      ]),
    ]);
    this.makeScreen('customize', true, [modal]);
    this.renderCustomize(body);
  }

  private renderCustomize(body: HTMLElement): void {
    const store = this.host.storage;
    const loadout = store.data.loadout;
    const cos = loadout.cosmetics;

    const tabs = el('div', { class: 'tabs' });
    const panes: HTMLElement[] = [];
    const addTab = (name: string, content: HTMLElement) => {
      const pane = el('div', { class: 'tab-body' }, [content]);
      const tab = el(
        'div',
        {
          class: 'tab',
          onclick: () => {
            for (const t of Array.from(tabs.children)) t.classList.remove('active');
            tab.classList.add('active');
            for (const p of panes) p.classList.remove('active');
            pane.classList.add('active');
            this.host.audio.play('ui');
          },
        },
        [name],
      );
      tabs.append(tab);
      panes.push(pane);
      body.append(pane);
      if (panes.length === 1) {
        tab.classList.add('active');
        pane.classList.add('active');
      }
    };

    body.append(tabs);

    // Character archetypes.
    const charPane = el('div', {}, [
      this.cardGrid(
        ARCHETYPES.map((a) => ({ id: a.id, name: a.name, desc: a.blurb })),
        () => loadout.archetype,
        (id) => {
          loadout.archetype = id;
          store.save();
          this.host.applyLoadout();
        },
      ),
    ]);

    const swatchRow = (
      label: string,
      colors: number[],
      get: () => number,
      set: (c: number) => void,
    ): HTMLElement => {
      const row = el('div', { class: 'swatches' });
      const render = () => {
        clearChildren(row);
        for (const c of colors) {
          row.append(
            el('div', {
              class: `swatch${get() === c ? ' active' : ''}`,
              style: { background: hexColor(c) },
              onclick: () => {
                set(c);
                store.save();
                this.host.applyLoadout();
                this.host.audio.play('ui');
                render();
              },
            }),
          );
        }
      };
      render();
      return el('div', { style: { marginTop: '12px' } }, [el('h2', {}, [label]), row]);
    };

    const optionRow = (
      label: string,
      options: string[],
      get: () => string,
      set: (v: string) => void,
    ): HTMLElement => {
      const pill = el('div', { class: 'pill' });
      const render = () => {
        clearChildren(pill);
        for (const o of options) {
          pill.append(
            el(
              'button',
              {
                class: get() === o ? 'active' : '',
                onclick: () => {
                  set(o);
                  store.save();
                  this.host.applyLoadout();
                  this.host.audio.play('ui');
                  render();
                },
              },
              [o],
            ),
          );
        }
      };
      render();
      return el('div', { style: { marginTop: '12px' } }, [el('h2', {}, [label]), pill]);
    };

    const setCos = (patch: Partial<Cosmetics>) => Object.assign(cos, patch);

    charPane.append(
      swatchRow('Shirt', SHIRT_COLORS, () => cos.shirt, (c) => setCos({ shirt: c })),
      swatchRow('Shorts', SHORTS_COLORS, () => cos.shorts, (c) => setCos({ shorts: c })),
      swatchRow('Boots', SHOE_COLORS, () => cos.shoes, (c) => setCos({ shoes: c })),
      swatchRow('Skin', SKIN_COLORS, () => cos.skin, (c) => setCos({ skin: c })),
      swatchRow('Hair colour', HAIR_COLORS, () => cos.hairColor, (c) => setCos({ hairColor: c })),
      optionRow('Hair', HAIR_STYLES, () => cos.hairStyle, (v) => setCos({ hairStyle: v })),
      optionRow('Accessory', ACCESSORIES, () => cos.accessory, (v) => setCos({ accessory: v })),
      optionRow('Celebration', CELEBRATIONS, () => cos.celebration, (v) => setCos({ celebration: v })),
    );
    addTab('CHARACTER', charPane);

    // Ball designs.
    const ballPane = el('div', {}, [
      this.cardGrid(
        BALL_DESIGNS.map((b) => ({ id: b.id, name: b.name, desc: 'Purely cosmetic' })),
        () => loadout.ball,
        (id) => {
          loadout.ball = id;
          store.save();
          this.host.applyLoadout();
        },
      ),
    ]);
    addTab('BALL', ballPane);

    // Player two (local versus).
    const p2 = el('div', {}, [
      el('div', { class: 'hint' }, ['Used in LOCAL 1v1 and as the CPU kit.']),
      this.cardGrid(
        ARCHETYPES.map((a) => ({ id: a.id, name: a.name, desc: a.blurb })),
        () => loadout.p2Archetype,
        (id) => {
          loadout.p2Archetype = id;
          store.save();
          this.host.applyLoadout();
        },
      ),
      swatchRow('Shirt', SHIRT_COLORS, () => loadout.p2Cosmetics.shirt, (c) => (loadout.p2Cosmetics.shirt = c)),
      swatchRow('Shorts', SHORTS_COLORS, () => loadout.p2Cosmetics.shorts, (c) => (loadout.p2Cosmetics.shorts = c)),
      swatchRow('Skin', SKIN_COLORS, () => loadout.p2Cosmetics.skin, (c) => (loadout.p2Cosmetics.skin = c)),
      optionRow('Hair', HAIR_STYLES, () => loadout.p2Cosmetics.hairStyle, (v) => (loadout.p2Cosmetics.hairStyle = v)),
    ]);
    addTab('OPPONENT KIT', p2);
  }

  // -------------------------------------------------------------- settings

  private buildSettings(): void {
    const body = el('div', {});
    const modal = el('div', { class: 'modal modal-wide' }, [
      el('h1', {}, ['SETTINGS']),
      body,
      el('div', { class: 'actions' }, [
        el('button', { class: 'btn primary', onclick: () => this.closeSettings() }, ['BACK']),
      ]),
    ]);
    this.makeScreen('settings', true, [modal]);
    this.renderSettings(body);
  }

  private settingsReturn: ScreenName = 'menu';

  private closeSettings(): void {
    this.host.audio.play('uiBack');
    this.show(this.settingsReturn);
    if (this.settingsReturn === 'pause') return;
  }

  private renderSettings(body: HTMLElement): void {
    const s = this.host.storage.data.settings;
    const save = () => {
      this.host.storage.save();
      this.host.applySettings();
    };

    const tabs = el('div', { class: 'tabs' });
    const panes: HTMLElement[] = [];
    const addTab = (name: string, content: HTMLElement) => {
      const pane = el('div', { class: 'tab-body' }, [content]);
      const tab = el(
        'div',
        {
          class: 'tab',
          onclick: () => {
            for (const t of Array.from(tabs.children)) t.classList.remove('active');
            tab.classList.add('active');
            for (const p of panes) p.classList.remove('active');
            pane.classList.add('active');
          },
        },
        [name],
      );
      tabs.append(tab);
      panes.push(pane);
      body.append(pane);
      if (panes.length === 1) {
        tab.classList.add('active');
        pane.classList.add('active');
      }
    };
    body.append(tabs);

    const slider = (
      label: string,
      min: number,
      max: number,
      step: number,
      get: () => number,
      set: (v: number) => void,
    ): HTMLElement => {
      const value = el('span', { style: { minWidth: '42px', textAlign: 'right' } }, [get().toFixed(2)]);
      const input = el('input', {
        type: 'range',
        min: String(min),
        max: String(max),
        step: String(step),
        value: String(get()),
        oninput: (e: Event) => {
          const v = Number((e.target as HTMLInputElement).value);
          set(v);
          value.textContent = v.toFixed(2);
          save();
        },
      });
      return el('div', { class: 'row' }, [el('label', {}, [label]), el('div', {}, [input, value])]);
    };

    const toggle = (label: string, get: () => boolean, set: (v: boolean) => void): HTMLElement => {
      const btn = el('button', { class: 'tab' + (get() ? ' active' : '') }, [get() ? 'ON' : 'OFF']);
      btn.addEventListener('click', () => {
        set(!get());
        btn.textContent = get() ? 'ON' : 'OFF';
        btn.classList.toggle('active', get());
        save();
        this.host.audio.play('ui');
      });
      return el('div', { class: 'row' }, [el('label', {}, [label]), btn]);
    };

    const choice = (
      label: string,
      options: string[],
      get: () => string,
      set: (v: string) => void,
    ): HTMLElement => {
      const pill = el('div', { class: 'pill' });
      const render = () => {
        clearChildren(pill);
        for (const o of options) {
          pill.append(
            el(
              'button',
              {
                class: get() === o ? 'active' : '',
                onclick: () => {
                  set(o);
                  save();
                  render();
                  this.host.audio.play('ui');
                },
              },
              [o.toUpperCase()],
            ),
          );
        }
      };
      render();
      return el('div', { class: 'row' }, [el('label', {}, [label]), pill]);
    };

    const general = el('div', {}, [
      slider('Master volume', 0, 1, 0.05, () => s.masterVolume, (v) => (s.masterVolume = v)),
      slider('Sound effects', 0, 1, 0.05, () => s.sfxVolume, (v) => (s.sfxVolume = v)),
      slider('Music', 0, 1, 0.05, () => s.musicVolume, (v) => (s.musicVolume = v)),
      slider('Mouse sensitivity', 0.2, 3, 0.1, () => s.mouseSensitivity, (v) => (s.mouseSensitivity = v)),
      slider('Screen shake', 0, 1.5, 0.1, () => s.screenShake, (v) => (s.screenShake = v)),
      toggle('Invert look Y', () => s.invertY, (v) => (s.invertY = v)),
      choice('Camera', ['ball', 'player'], () => s.cameraMode, (v) => (s.cameraMode = v as 'ball' | 'player')),
      choice('Quality', ['low', 'medium', 'high'], () => s.quality, (v) => (s.quality = v as 'low' | 'medium' | 'high')),
      toggle('Shadows', () => s.shadows, (v) => (s.shadows = v)),
      toggle('Goal replays', () => s.showReplays, (v) => (s.showReplays = v)),
      toggle('Debug overlay (F3)', () => s.debug, (v) => (s.debug = v)),
      el('div', { class: 'actions' }, [
        el(
          'button',
          {
            class: 'btn ghost',
            onclick: () => {
              this.host.storage.reset();
              location.reload();
            },
          },
          ['RESET EVERYTHING'],
        ),
      ]),
    ]);
    addTab('GENERAL', general);

    for (const playerIndex of [0, 1]) {
      const list = el('div', {});
      const render = () => {
        clearChildren(list);
        list.append(
          el('div', { class: 'hint', style: { marginBottom: '10px' } }, [
            playerIndex === 0
              ? 'Player 1 (also supports gamepad 1: left stick move, A jump, X kick, B tackle, Y shove, LB slide, RT sprint).'
              : 'Player 2 for LOCAL 1v1 (gamepad 2 works too).',
          ]),
        );
        for (const action of ACTIONS) {
          const code = this.host.storage.data.bindings[playerIndex][action.id];
          const btn = el('button', {}, [prettyKey(code)]);
          btn.addEventListener('click', () => {
            btn.classList.add('listening');
            btn.textContent = 'PRESS...';
            this.listeningFor = { player: playerIndex, action: action.id };
            this.host.input.captureCallback = (newCode: string) => {
              this.host.storage.data.bindings[playerIndex][action.id] = newCode;
              this.host.storage.save();
              this.host.applySettings();
              this.listeningFor = null;
              render();
            };
          });
          list.append(
            el('div', { class: 'keybind' }, [
              el('div', {}, [
                el('div', {}, [action.label]),
                action.hint ? el('div', { class: 'hint' }, [action.hint]) : null,
              ].filter(Boolean) as Node[]),
              btn,
            ]),
          );
        }
      };
      render();
      addTab(playerIndex === 0 ? 'CONTROLS P1' : 'CONTROLS P2', list);
    }
  }

  // ----------------------------------------------------------------- howto

  private buildHowTo(): void {
    const kbd = (k: string) => `<span class="kbd">${k}</span>`;
    const modal = el('div', { class: 'modal modal-wide' }, [
      el('h1', {}, ['HOW TO PLAY']),
      el('div', { class: 'subtitle' }, ['Seven inputs. A thousand stupid, wonderful accidents.']),
      el('div', {
        class: 'hint',
        html: `
        <p><b>Move</b> ${kbd('W')}${kbd('A')}${kbd('S')}${kbd('D')} — camera-relative. <b>Sprint</b> ${kbd('Shift')} (costs stamina). <b>Jump</b> ${kbd('Space')}.</p>
        <p><b>Kick</b> — hold ${kbd('Left Click')}. Power grows continuously the longer you hold: a tap is a close-control touch, a full charge is a rocket you will probably mis-hit. Release any time.</p>
        <p><b>Aim</b> — the ball leaves along the direction you are <i>running</i>, deflected by where your foot meets the ball and by your momentum. Run across the ball to slice it, sprint through it to add pace.</p>
        <p><b>Curve</b> — hold ${kbd('A')} or ${kbd('D')} while charging to put sidespin on the shot. The Magnus force is real; the ball will bend around a defender.</p>
        <p><b>Lob</b> — hold ${kbd('Q')} while kicking, or scoop the ball from underneath, to chip it over your opponent.</p>
        <p><b>Air kicks</b> — jump and kick. Volleys, aerial clearances, desperate mid-air pokes: all legal, all physical. A falling kick is scrappier than a rising one.</p>
        <p><b>Tackle</b> ${kbd('Right Click')} pokes at the ball. <b>Slide</b> ${kbd('Ctrl')} commits you to a long, fast challenge — it moves the ball hard, but hitting a player first is a foul. <b>Shove</b> ${kbd('E')} barges an opponent off the ball; do it far from the ball and it is a foul.</p>
        <p><b>Camera</b> ${kbd('C')} toggles ball-cam and player-cam. Mouse nudges the view; it self-centres.</p>
        <p><b>Everything bounces</b>: low walls, posts, crossbar, and your opponent. Own goals absolutely count.</p>
        <p>${kbd('Esc')} pause · ${kbd('R')} instant rematch after a match · ${kbd('F3')} debug overlay.</p>`,
      }),
      el('div', { class: 'actions' }, [
        el('button', { class: 'btn primary', onclick: () => this.show('menu') }, ['GOT IT']),
      ]),
    ]);
    this.makeScreen('howto', true, [modal]);
  }

  // ---------------------------------------------------------------- screens

  show(name: ScreenName): void {
    this.current = name;
    for (const [key, node] of this.screens) {
      node.classList.toggle('visible', key === name);
    }
    this.hud.classList.toggle('visible', name === 'game' || name === 'pause');
    if (name === 'menu') this.refreshStats();
    if (name === 'settings') this.settingsReturn = 'menu';
    if (this.listeningFor) {
      this.listeningFor = null;
      this.host.input.captureCallback = null;
    }
  }

  openSettingsFrom(from: ScreenName): void {
    this.settingsReturn = from;
    this.show('settings');
  }

  get currentScreen(): ScreenName {
    return this.current;
  }

  get lastPlayedMode(): GameMode {
    return this.lastMode;
  }

  get currentSelection(): StartOptions {
    return this.selection;
  }
}
