// Settings overlay (registry 'settings', transparent): difficulty, assist cues, timing feedback, screen shake,
// reduced flashing, live-preview volume sliders, input offset with an audio-metronome or visual-flash calibration
// mini-game, a controls reference built from the live bindings, and reset to defaults. Every change is saved.

import { UIScene, MenuList, el, confirmDialog, toast, sfx } from './widgets.js';
import { escapeHtml, keyLabel, signedMs, pct, hintsHtml, DIFFICULTY_INFO, difficultyFacts } from './text.js';
import { DIFFICULTY } from '../battle/qte.js';
import { defaultSettings, INPUT_OFFSET_RANGE } from '../core/save.js';

const DIFF_IDS = Object.keys(DIFFICULTY);

/** Setting rows (sections are headings). */
const ROWS = [
  { heading: true, label: 'Gameplay' },
  { id: 'difficulty', kind: 'choice', label: 'Difficulty' },
  { id: 'assistCues', kind: 'toggle', label: 'Assist Cues' },
  { id: 'showTimingFeedback', kind: 'toggle', label: 'Timing Feedback' },
  { id: 'screenShake', kind: 'toggle', label: 'Screen Shake' },
  { id: 'reducedFlashing', kind: 'toggle', label: 'Reduced Flashing' },
  { heading: true, label: 'Audio' },
  { id: 'masterVolume', kind: 'slider', label: 'Master Volume', preview: 'ui_confirm' },
  { id: 'sfxVolume', kind: 'slider', label: 'Effects Volume', preview: 'parry' },
  { id: 'musicVolume', kind: 'slider', label: 'Music Volume', preview: null },
  { heading: true, label: 'Timing' },
  { id: 'inputOffset', kind: 'offset', label: 'Input Offset' },
  { id: 'calibrateAudio', kind: 'action', label: 'Calibrate · Metronome' },
  { id: 'calibrateVisual', kind: 'action', label: 'Calibrate · Flash' },
  { heading: true, label: 'Controls & Data' },
  { id: 'controls', kind: 'info', label: 'Controls Reference' },
  { id: 'defaults', kind: 'action', label: 'Restore Defaults' },
  { id: 'back', kind: 'action', label: 'Back' },
];

const DESCRIPTIONS = {
  difficulty: 'How forgiving the timing windows are and how hard the Gloam hits. You may change it whenever you like — even mid-expedition.',
  assistCues: 'Shows a distinct cue over every incoming hit: a clean ring to parry or dodge, a spiked red ring that must be dodged, golden chevrons to jump, a violet prism to counter. Turn off to read attacks from animation and sound alone.',
  showTimingFeedback: 'After each defence or strike, shows how early or late you pressed (“24 ms early”). Wonderful for learning a rhythm — or proving it was not your fault.',
  screenShake: 'Shakes the camera on heavy blows, breaks and failed defences.',
  reducedFlashing: 'Softens full-screen flashes and bright bursts, and uses a gentle pulse for the flash calibration.',
  masterVolume: 'Overall loudness of the expedition.',
  sfxVolume: 'Clangs, whooshes, chimes and every other sound effect. Timing-critical sounds always cut through the music.',
  musicVolume: 'The waltzes, marches and choirs of the endless dusk.',
  inputOffset: 'Shifts every timing judgement to compensate for the latency of your screen, speakers and keyboard. Positive values help if your presses land late. Calibrate to measure it rather than guess.',
  calibrateAudio: 'Tap along with a metronome. The median of your taps becomes your input offset — the most accurate method, and the one to trust for rhythm-heavy fights.',
  calibrateVisual: 'Tap each time the orb flashes — for players who follow the picture rather than the sound. Includes your display’s latency.',
  defaults: 'Restore every setting — difficulty, cues, volumes, timing and bindings — to its original value.',
  back: 'Return to where you were. Settings are saved as you change them.',
};

function sliderHtml(v, { centered = false } = {}) {
  const x = Math.max(0, Math.min(1, v));
  const lo = centered ? Math.min(0.5, x) : 0;
  const hi = centered ? Math.max(0.5, x) : x;
  return `<span class="slider${centered ? ' is-centered' : ''}" style="--v:${x.toFixed(3)};--lo:${lo.toFixed(3)};--hi:${hi.toFixed(3)}"><i class="sl-fill"></i><i class="sl-thumb"></i></span>`;
}

/** Control reference rows: [label, actions] or ['group', title]. */
const CONTROL_ROWS = [
  ['group', 'Exploration & Menus'],
  ['Move', 'move'],
  ['Interact · Confirm', ['confirm']],
  ['Back', ['cancel']],
  ['Menu', ['menu']],
  ['group', 'Defence — Enemy Turns'],
  ['Parry', ['parry']],
  ['Dodge', ['dodge']],
  ['Jump', ['jump']],
  ['Prism Counter', ['gradient']],
  ['group', 'Offense — Your Turns'],
  ['Timed Strike', ['qte']],
];

const SHORT = { Backspace: 'Bksp', 'D-Pad ↑': 'D↑', 'D-Pad ↓': 'D↓', 'D-Pad ←': 'D←', 'D-Pad →': 'D→' };

function capsFor(input, action, device) {
  const labels = typeof input?.keyLabels === 'function' ? input.keyLabels(action, device) : [];
  return labels.map((raw) => {
    const l = SHORT[raw] ?? raw;
    return `<span class="kbd${device === 'gamepad' ? ' kbd-pad' : ''}${l.length > 3 ? ' kbd-wide' : ''}">${escapeHtml(l)}</span>`;
  }).join('');
}

/** HTML table of every binding for keyboard and gamepad. */
export function controlsTableHtml(game) {
  const input = game.input;
  let rows = '';
  for (const [label, actions] of CONTROL_ROWS) {
    if (label === 'group') {
      rows += `<tr class="grp"><td colspan="3">${escapeHtml(actions)}</td></tr>`;
      continue;
    }
    let kb;
    let pad;
    if (actions === 'move') {
      const first = ['up', 'down', 'left', 'right'].map((a) => input.keyLabels(a, 'keyboard'));
      kb = [0, 1].map((k) => first.map((l) => (l[k] ? `<span class="kbd">${escapeHtml(l[k])}</span>` : '')).join('')).join('<i class="k-sep"></i>');
      pad = '<span class="kbd kbd-pad kbd-wide">D-Pad</span><span class="kbd kbd-pad kbd-wide">L-Stick</span>';
    } else {
      kb = actions.map((a) => capsFor(input, a, 'keyboard')).join('');
      pad = actions.map((a) => capsFor(input, a, 'gamepad')).join('');
    }
    rows += `<tr><td>${escapeHtml(label)}</td><td>${kb}</td><td>${pad}</td></tr>`;
  }
  return `<table class="controls-table"><thead><tr><th>Action</th><th>Keyboard</th><th>Gamepad</th></tr></thead><tbody>${rows}</tbody></table>`;
}

// ------------------------------------------------------------------ calibration

const TAP_ACTIONS = ['confirm', 'qte', 'parry', 'dodge', 'jump', 'gradient'];
const BEAT_MS = 600;
const WARMUP = 2;
const BEATS = 14;
const MIN_TAPS = 8;
const MAX_MATCH = 280;

function median(values) {
  const v = [...values].sort((a, b) => a - b);
  if (!v.length) return 0;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/** Robust median: drop taps further than 3×MAD from the first median, then take the median again. */
export function robustMedian(values) {
  if (!values.length) return { median: 0, spread: 0, used: 0 };
  const m0 = median(values);
  const mad = median(values.map((x) => Math.abs(x - m0))) || 8;
  const kept = values.filter((x) => Math.abs(x - m0) <= Math.max(40, 3 * mad));
  const m = median(kept);
  const spread = median(kept.map((x) => Math.abs(x - m)));
  return { median: m, spread, used: kept.length };
}

/**
 * Calibration mini-game widget (lives on the settings scene's focus stack).
 * mode 'audio': metronome clicks scheduled on the AudioContext; mode 'visual': an orb flashes on each beat.
 */
class Calibration {
  constructor(scene, mode) {
    this.scene = scene;
    this.game = scene.game;
    this.mode = mode;
    this.active = true;
    this.phase = 'ready';
    this.offsets = [];
    this.taken = new Set();
    this.nodes = [];
    this.flashes = [];
    this._seen = new Set();
    this._build();
    this._start();
  }

  setActive(v) {
    this.active = v;
  }

  _build() {
    const g = this.game;
    this.shield = el('div', { class: 'modal-shield' });
    const box = el('div', { class: 'panel modal calib-modal' });
    const how = this.mode === 'audio'
      ? `Tap ${this.scene.cap('confirm')} on every click of the metronome — ${BEATS} beats in all. Listen, don’t watch.`
      : `Tap ${this.scene.cap('confirm')} each time the orb flashes — ${BEATS} beats in all.`;
    box.innerHTML = `
      <div class="modal-title">${this.mode === 'audio' ? 'Metronome Calibration' : 'Flash Calibration'}</div>
      <div class="rule"></div>
      <div class="modal-text">${how}</div>
      <div class="calib-stage"><div class="calib-orb"><b>—</b><small>Ready</small></div></div>
      <div class="calib-plot">
        <i class="cp-axis"></i><i class="cp-zero"></i>
        <span class="cp-lbl" style="left:8%">150 early</span><span class="cp-lbl" style="left:50%">on time</span><span class="cp-lbl" style="left:92%">150 late</span>
      </div>
      <div class="calib-readout">Get ready…</div>
      <div class="calib-actions"></div>`;
    this.orb = box.querySelector('.calib-orb');
    this.orbNum = this.orb.querySelector('b');
    this.orbLbl = this.orb.querySelector('small');
    this.plot = box.querySelector('.calib-plot');
    this.readout = box.querySelector('.calib-readout');
    this.actionsEl = box.querySelector('.calib-actions');
    this.orb.addEventListener('mousedown', (e) => e.preventDefault());
    this.shield.appendChild(box);
    this.scene.root.appendChild(this.shield);
    g.audio?.duck?.(0.15, 12);
  }

  _audioCtx() {
    const a = this.game.audio;
    const ctx = a?.context;
    return ctx && ctx.state === 'running' ? ctx : null;
  }

  /** performance.now() time at which context time `c` (s) is heard. */
  _ctxToPerf(ctx, c) {
    try {
      const ts = typeof ctx.getOutputTimestamp === 'function' ? ctx.getOutputTimestamp() : null;
      if (ts && ts.contextTime > 0 && ts.performanceTime > 0) return ts.performanceTime + (c - ts.contextTime) * 1000;
    } catch {
      /* fall through */
    }
    const lat = (ctx.outputLatency || ctx.baseLatency || 0) * 1000;
    return performance.now() + (c - ctx.currentTime) * 1000 + lat;
  }

  _start() {
    this.phase = 'run';
    this.startedAt = performance.now();
    if (this.mode === 'audio') {
      const ctx = this._audioCtx();
      if (!ctx) {
        this.mode = 'visual';
        this.readout.innerHTML = 'Sound is unavailable — switching to the flash calibration.';
      } else {
        this.ctx = ctx;
        this.c0 = ctx.currentTime + 1.2;
        const vol = Math.max(0.28, (this.game.settings.masterVolume ?? 0.8) * (this.game.settings.sfxVolume ?? 0.9));
        this.out = ctx.createGain();
        this.out.gain.value = vol * 0.55;
        this.out.connect(ctx.destination);
        for (let k = 0; k < BEATS; k++) this._click(ctx, this.c0 + (k * BEAT_MS) / 1000, k % 4 === 0);
        this.readout.innerHTML = 'Listen for the first click…';
        this.orbLbl.textContent = 'Listen';
        return;
      }
    }
    this.p0 = performance.now() + 1200;
    this.flashes = Array.from({ length: BEATS }, () => null);
    this.nextFlash = 0;
    this.orbLbl.textContent = 'Watch';
    if (!this.readout.textContent.includes('unavailable')) this.readout.innerHTML = 'Watch the orb…';
  }

  _click(ctx, t, accent) {
    try {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = accent ? 1760 : 1320;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(accent ? 1 : 0.75, t + 0.0015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.085);
      osc.connect(g);
      g.connect(this.out);
      osc.start(t);
      osc.stop(t + 0.1);
      const len = Math.floor(ctx.sampleRate * 0.012);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 3200;
      const ng = ctx.createGain();
      ng.gain.value = 0.55;
      src.connect(hp);
      hp.connect(ng);
      ng.connect(this.out);
      src.start(t);
      this.nodes.push(osc, src);
    } catch (err) {
      console.warn('[calibration] click failed', err);
    }
  }

  _beatPerf(k) {
    if (this.mode === 'audio') return this._ctxToPerf(this.ctx, this.c0 + (k * BEAT_MS) / 1000);
    return this.flashes[k] ?? this.p0 + k * BEAT_MS;
  }

  _tap(t) {
    const k0 = this.mode === 'audio' ? this._beatPerf(0) : this.p0;
    const k = Math.round((t - k0) / BEAT_MS);
    this.orb.classList.remove('is-tap');
    void this.orb.offsetWidth;
    this.orb.classList.add('is-tap');
    if (k < 0 || k >= BEATS) return;
    const off = t - this._beatPerf(k);
    if (Math.abs(off) > MAX_MATCH || this.taken.has(k)) return;
    this.taken.add(k);
    if (k < WARMUP) return;
    this.offsets.push(off);
    const x = 50 + Math.max(-48, Math.min(48, (off / 150) * 42));
    this.plot.appendChild(el('i', { class: `cp-dot${off < 0 ? ' is-early' : ''}`, style: `left:${x}%` }));
  }

  update(dt) {
    const input = this.game.input;
    if (this.phase === 'done') return false;
    if (input.pressed('cancel')) {
      input.consume(['cancel', 'menu']);
      sfx(this.game, 'ui_cancel');
      this.close();
      return true;
    }
    // taps: one per physical press (a key maps to several actions with the same timestamp)
    for (const p of input.framePresses(TAP_ACTIONS)) {
      const key = `${p.code}|${p.t}`;
      if (this._seen.has(key)) continue;
      this._seen.add(key);
      this._tap(p.t);
    }
    if (input.pointer?.pressed && input.pointer.overUI) this._tap(input.pointer.t || this.game.time);
    input.consume(TAP_ACTIONS);

    const now = this.game.time;
    if (this.mode === 'visual') {
      if (this.nextFlash < BEATS && now >= this.p0 + this.nextFlash * BEAT_MS - 4) {
        this.flashes[this.nextFlash] = now;
        const soft = !!this.game.settings.reducedFlashing;
        this.orb.classList.add(soft ? 'is-soft-flash' : 'is-flash');
        this._unflashAt = now + 90;
        this.orbNum.textContent = String(this.nextFlash + 1);
        this.nextFlash += 1;
        if (this.nextFlash > WARMUP) this.readout.innerHTML = `Keep tapping… <b>${this.offsets.length}</b> taps measured`;
        else this.readout.innerHTML = 'Tap along — the first two flashes are practice.';
      }
      if (this._unflashAt && now >= this._unflashAt) {
        this.orb.classList.remove('is-flash', 'is-soft-flash');
        this._unflashAt = 0;
      }
    } else {
      const k = Math.floor((performance.now() - this._beatPerf(0)) / BEAT_MS);
      if (k >= 0) {
        this.orbNum.textContent = String(Math.min(BEATS, k + 1));
        if (k < WARMUP) this.readout.innerHTML = 'Tap along — the first two clicks are practice.';
        else this.readout.innerHTML = `Keep tapping… <b>${this.offsets.length}</b> taps measured`;
      }
    }
    const end = this._beatPerf(BEATS - 1) + 700;
    if (performance.now() >= end) this._finish();
    return true;
  }

  _finish() {
    this.phase = 'done';
    this._stopAudio();
    this.orb.classList.remove('is-flash', 'is-soft-flash');
    const n = this.offsets.length;
    let items;
    if (n < MIN_TAPS) {
      this.result = null;
      this.readout.innerHTML = `Only <b>${n}</b> of ${BEATS - WARMUP} taps landed near a beat. Try again, tapping steadily with each ${this.mode === 'audio' ? 'click' : 'flash'}.`;
      this.orbNum.textContent = '—';
      this.orbLbl.textContent = 'Retry';
      items = [{ id: 'retry', label: 'Try Again' }, { id: 'cancel', label: 'Cancel', confirmSound: 'ui_cancel' }];
    } else {
      const r = robustMedian(this.offsets);
      const value = Math.round(Math.max(INPUT_OFFSET_RANGE.min, Math.min(INPUT_OFFSET_RANGE.max, r.median)));
      this.result = value;
      const x = 50 + Math.max(-48, Math.min(48, (r.median / 150) * 42));
      this.plot.appendChild(el('i', { class: 'cp-med', style: `left:${x}%` }));
      const feel = Math.abs(value) < 12 ? 'right on the beat' : value > 0 ? 'a little late' : 'a little early';
      this.readout.innerHTML = `Your taps land <b>${signedMs(value)}</b> — ${feel} (spread ±${Math.round(r.spread)} ms over ${r.used} taps).<br><span class="muted">Current offset: ${signedMs(this.game.settings.inputOffset)}</span>`;
      this.orbNum.textContent = signedMs(value).replace(' ms', '');
      this.orbLbl.textContent = 'ms';
      items = [
        { id: 'apply', label: `Apply ${signedMs(value)}` },
        { id: 'retry', label: 'Try Again' },
        { id: 'cancel', label: 'Keep Current', confirmSound: 'ui_cancel' },
      ];
      sfx(this.game, 'qte_perfect', { volume: 0.6 });
    }
    this.menu = new MenuList(this.game, {
      className: 'modal-actions',
      horizontal: true,
      items,
      onConfirm: (item) => this._action(item.id),
      onCancel: () => this.close(),
    });
    this.actionsEl.appendChild(this.menu.el);
    this.scene.focus.push(this.menu);
  }

  _action(id) {
    if (id === 'apply' && this.result !== null) {
      this.scene.setValue('inputOffset', this.result);
      toast(this.game, `Input offset set to ${signedMs(this.result)}`, { kind: 'good' });
      this.close();
    } else if (id === 'retry') {
      const mode = this.mode;
      const scene = this.scene;
      this.close();
      scene.openCalibration(mode);
    } else this.close();
  }

  _stopAudio() {
    for (const n of this.nodes) {
      try {
        n.stop(0);
      } catch {
        /* already stopped */
      }
    }
    this.nodes = [];
    if (this.out) {
      const out = this.out;
      setTimeout(() => {
        try {
          out.disconnect();
        } catch {
          /* gone */
        }
      }, 200);
      this.out = null;
    }
  }

  close() {
    this._stopAudio();
    if (this.menu) this.scene.focus.remove(this.menu);
    this.scene.focus.remove(this);
    this.shield.remove();
    this.phase = 'done';
    this.game.audio?.duck?.(1, 0.05);
  }
}

// ------------------------------------------------------------------ scene

export class SettingsScene extends UIScene {
  constructor(game) {
    super(game);
    this.transparent = true;
  }

  enter(params = {}) {
    this.from = params.from ?? null;
    const root = this.mountRoot('settings-screen');
    root.innerHTML = `
      <div class="backdrop"></div>
      <div class="panel settings-frame">
        <div class="settings-inner">
          <div class="settings-head">
            <div><div class="eyebrow">Expedition 69</div><div class="heading" style="margin-top:8px">Settings</div></div>
            <span class="badge settings-diff"></span>
          </div>
          <div class="settings-list scroll"></div>
          <div class="settings-side panel-inset"></div>
          <div class="settings-foot"><span class="muted">Changes are saved automatically.</span><div class="hint-bar"></div></div>
        </div>
      </div>`;
    root.querySelector('.backdrop').addEventListener('click', () => this.close());
    this.side = root.querySelector('.settings-side');
    this.hintsEl = root.querySelector('.settings-foot .hint-bar');
    this.diffBadge = root.querySelector('.settings-diff');
    const listHost = root.querySelector('.settings-list');
    this.list = new MenuList(this.game, {
      items: ROWS.map((r) => ({ ...r, adjustable: ['choice', 'toggle', 'slider', 'offset'].includes(r.kind), clickAdjust: r.kind === 'slider' })),
      render: (item) => this._renderRow(item),
      scrollEl: listHost,
      describe: (item) => this._describe(item),
      descEl: this.side,
      onConfirm: (item) => this._confirm(item),
      onAdjust: (item, dir, i, e) => this._adjust(item, dir, e),
      onCancel: () => this.close(),
    });
    listHost.appendChild(this.list.el);
    this.focus.set(this.list);
    this._renderHints();
    this._renderBadge();
    this.sfx('menu_open', { volume: 0.8 });
  }

  _renderHints() {
    this.hintsEl.innerHTML = hintsHtml(this.game, [['nav-v', 'Select'], ['nav-h', 'Adjust'], ['confirm', 'Choose'], ['cancel', 'Back']]);
  }

  _renderBadge() {
    this.diffBadge.textContent = `${DIFFICULTY[this.game.settings.difficulty]?.name ?? 'Expeditioner'} · Offset ${signedMs(this.game.settings.inputOffset)}`;
  }

  onDeviceChange() {
    super.onDeviceChange();
    this._renderHints();
    this.list.refresh();
  }

  _renderRow(item) {
    const s = this.game.settings;
    const name = `<span class="set-name">${escapeHtml(item.label)}</span>`;
    let val = '';
    switch (item.kind) {
      case 'choice': {
        const d = DIFFICULTY[s.difficulty];
        val = `<span class="set-arrow" data-adjust="-1">◀</span><span class="set-choice">${escapeHtml(d?.name ?? s.difficulty)}</span><span class="set-arrow" data-adjust="1">▶</span>`;
        break;
      }
      case 'toggle': {
        const on = !!s[item.id];
        val = `<span class="toggle-label">${on ? 'On' : 'Off'}</span><span class="toggle${on ? ' is-on' : ''}"></span>`;
        break;
      }
      case 'slider':
        val = `${sliderHtml(s[item.id])}<span class="set-num">${pct(s[item.id])}</span>`;
        break;
      case 'offset': {
        const v = s.inputOffset;
        const f = (v - INPUT_OFFSET_RANGE.min) / (INPUT_OFFSET_RANGE.max - INPUT_OFFSET_RANGE.min);
        val = `<span class="set-arrow" data-adjust="-1">◀</span>${sliderHtml(f, { centered: true })}<span class="set-arrow" data-adjust="1">▶</span><span class="set-num">${signedMs(v)}</span>`;
        break;
      }
      case 'info':
        val = '<span class="set-arrow">›</span>';
        break;
      default:
        val = '';
    }
    return `<div class="set-row">${name}<span class="set-val">${val}</span></div>`;
  }

  _describe(item) {
    const s = this.game.settings;
    if (item.id === 'controls') {
      return `<h3>Controls</h3>${controlsTableHtml(this.game)}<p class="note">Prompts follow the device you last touched — keyboard, gamepad or touch.</p>`;
    }
    let extra = '';
    if (item.id === 'difficulty') {
      const d = DIFFICULTY[s.difficulty];
      extra = `<div class="rule plain"></div><p><b class="gold">${escapeHtml(d.name)}</b> — ${escapeHtml(DIFFICULTY_INFO[s.difficulty]?.desc ?? '')}</p>
        <p class="note">${difficultyFacts(d).map(([k, v]) => `${escapeHtml(k)} ${escapeHtml(v)}`).join(' · ')}</p>`;
    } else if (item.id === 'inputOffset') {
      extra = `<p class="note">Now ${signedMs(s.inputOffset)}. Adjust in 5 ms steps with ${escapeHtml(keyLabel(this.game, 'left'))} / ${escapeHtml(keyLabel(this.game, 'right'))}.</p>`;
    } else if (item.kind === 'slider') {
      extra = `<p class="note">Now ${pct(s[item.id])}. Adjust with ${escapeHtml(keyLabel(this.game, 'left'))} / ${escapeHtml(keyLabel(this.game, 'right'))} or click the slider.</p>`;
    }
    return `<h3>${escapeHtml(item.label)}</h3><p>${escapeHtml(DESCRIPTIONS[item.id] ?? '')}</p>${extra}`;
  }

  /** Set a setting, persist it, refresh the rows and badge. */
  setValue(key, value) {
    this.game.settings[key] = value;
    this.game.saveSettings();
    const i = this.list.items.findIndex((it) => it.id === key);
    if (i >= 0) this.list.updateItem(i, {});
    this._renderBadge();
  }

  _preview(item) {
    if (!item.preview) return;
    const now = performance.now();
    if (now - (this._lastPreview ?? 0) < 110) return;
    this._lastPreview = now;
    sfx(this.game, item.preview, { volume: 0.8 });
  }

  _adjust(item, dir, e) {
    const s = this.game.settings;
    switch (item.kind) {
      case 'choice': {
        const i = DIFF_IDS.indexOf(s.difficulty);
        const next = DIFF_IDS[(i + (dir || 1) + DIFF_IDS.length) % DIFF_IDS.length];
        this.setValue('difficulty', next);
        sfx(this.game, 'ui_move');
        break;
      }
      case 'toggle':
        this.setValue(item.id, !s[item.id]);
        sfx(this.game, s[item.id] ? 'ui_confirm' : 'ui_cancel', { volume: 0.7 });
        break;
      case 'slider': {
        let v = s[item.id];
        if (dir === 0 && e) {
          const slider = e.target?.closest?.('.slider');
          if (!slider) return;
          const r = slider.getBoundingClientRect();
          v = Math.round(((e.clientX - r.left) / Math.max(1, r.width)) * 20) / 20;
        } else v = Math.round((v + dir * 0.05) * 20) / 20;
        v = Math.max(0, Math.min(1, v));
        if (v === s[item.id]) return;
        this.setValue(item.id, v);
        this._preview(item);
        break;
      }
      case 'offset': {
        const step = dir * 5;
        const v = Math.max(INPUT_OFFSET_RANGE.min, Math.min(INPUT_OFFSET_RANGE.max, Math.round((s.inputOffset + step) / 5) * 5));
        if (v === s.inputOffset) return;
        this.setValue('inputOffset', v);
        sfx(this.game, 'ui_move', { volume: 0.6 });
        this.list.focusIndex(this.list.index, { sound: false });
        break;
      }
      default:
    }
  }

  async _confirm(item) {
    switch (item.kind) {
      case 'choice':
      case 'toggle':
        this._adjust(item, 1);
        return;
      case 'slider':
      case 'offset':
      case 'info':
        return;
      default:
    }
    if (item.id === 'calibrateAudio') this.openCalibration('audio');
    else if (item.id === 'calibrateVisual') this.openCalibration('visual');
    else if (item.id === 'back') this.close();
    else if (item.id === 'defaults') {
      const ok = await confirmDialog(this, {
        title: 'Restore Defaults?',
        text: 'Every setting — including your calibrated input offset and any custom bindings — returns to its original value.',
        confirmLabel: 'Restore',
        cancelLabel: 'Cancel',
        danger: true,
      });
      if (!ok) return;
      Object.assign(this.game.settings, defaultSettings());
      this.game.saveSettings();
      this.list.refresh();
      this._renderBadge();
      toast(this.game, 'Settings restored to their defaults.', { kind: 'good' });
    }
  }

  openCalibration(mode) {
    const c = new Calibration(this, mode);
    this.focus.push(c);
  }

  close() {
    if (this._closing) return;
    this._closing = true;
    this.sfx('ui_cancel');
    if (this.game.scenes.top === this) this.game.scenes.pop({ settings: true });
  }

  update(dt) {
    this.time += dt;
    const input = this.game.input;
    if (this.focus.top === this.list && input.pressed('menu') && !input.pressed('cancel')) {
      input.consume(['menu']);
      this.close();
      return;
    }
    this.focus.update(dt);
  }
}
