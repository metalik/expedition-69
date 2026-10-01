// Expedition 69 — WebAudio sound engine: synthesized SFX, a light delay-network reverb bus and a
// look-ahead step sequencer driving procedural music. No assets, no dependencies.
// Importing this module never touches `window`; without WebAudio every call is a silent no-op.

/* ========================================================================================
 * Public name lists (SPEC §4.4)
 * ====================================================================================== */

/** Every sound effect name accepted by {@link Audio#play}. */
export const SFX = ['ui_move', 'ui_confirm', 'ui_cancel', 'ui_error', 'menu_open',
  'hit', 'hit_heavy', 'crit', 'whiff', 'parry', 'dodge', 'perfect_dodge', 'jump', 'land', 'hurt', 'block', 'shield_restore',
  'heal', 'buff', 'debuff', 'break', 'ko', 'revive', 'qte_perfect', 'qte_good', 'qte_miss', 'shot', 'counter',
  'telegraph', 'telegraph_red', 'telegraph_gold', 'telegraph_gradient', 'gradient_counter', 'gradient_ready', 'gradient_skill',
  'fire', 'ice', 'lightning', 'earth', 'light', 'dark', 'phase', 'level_up', 'chest', 'flag', 'step', 'swing', 'encounter',
  'victory', 'defeat', 'coin'];

/** Every music track name accepted by {@link Audio#playMusic}. */
export const TRACKS = ['title', 'shore', 'thicket', 'spire', 'summit', 'battle', 'boss', 'final', 'victory', 'gameover', 'ending', 'training'];

/**
 * Per-SFX metadata: `cat` groups the sound for the dev page, `sharp` marks sounds whose
 * attack must stay ≤ 5 ms (combat timing feedback), `duck` (0..1) dips the music briefly.
 * Swelling tells also give `climax` (seconds from the start of the sound to its peak / cut), so a caller
 * can start them `climax` early and land the peak on a beat (the Prism telegraph peaks on the hit).
 */
export const SFX_INFO = Object.freeze(buildSfxInfo());

function buildSfxInfo() {
  const cats = {
    ui: ['ui_move', 'ui_confirm', 'ui_cancel', 'ui_error', 'menu_open', 'coin', 'step', 'swing', 'chest', 'flag'],
    defense: ['parry', 'dodge', 'perfect_dodge', 'jump', 'land', 'block', 'gradient_counter', 'counter'],
    offense: ['hit', 'hit_heavy', 'crit', 'whiff', 'shot', 'hurt', 'break', 'ko', 'qte_perfect', 'qte_good', 'qte_miss'],
    telegraph: ['telegraph', 'telegraph_red', 'telegraph_gold', 'telegraph_gradient'],
    element: ['fire', 'ice', 'lightning', 'earth', 'light', 'dark'],
    support: ['heal', 'buff', 'debuff', 'revive', 'shield_restore', 'gradient_ready', 'gradient_skill', 'phase'],
    sting: ['level_up', 'encounter', 'victory', 'defeat'],
  };
  const sharpSet = new Set([...cats.defense, ...cats.offense, ...cats.element, 'swing', 'step']);
  const duck = { encounter: 0.35, gradient_counter: 0.55, break: 0.7, phase: 0.45, level_up: 0.55, victory: 0.5, defeat: 0.45, gradient_skill: 0.6 };
  // Must match the synth envelopes below: telegraph_gradient's layers all swell for a = 0.56–0.58 s, then cut in
  // ≤ 0.1 s (rendered offline: RMS peak at 0.58 s, below 10 % by 0.65 s).
  const climax = { telegraph_gradient: 0.58 };
  const info = {};
  for (const [cat, names] of Object.entries(cats)) {
    for (const n of names) {
      const entry = { cat, sharp: sharpSet.has(n), duck: duck[n] ?? 1 };
      if (climax[n] !== undefined) entry.climax = climax[n];
      info[n] = Object.freeze(entry);
    }
  }
  return info;
}

/* ========================================================================================
 * Small helpers
 * ====================================================================================== */

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const finite = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
/** MIDI note number → Hz. */
export const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

const warned = new Set();
function warnOnce(msg) {
  if (warned.has(msg)) return;
  warned.add(msg);
  if (typeof console !== 'undefined') console.warn(`[audio] ${msg}`);
}

/** Deterministic PRNG (mulberry32) so offline renders and music humanisation are reproducible. */
export function makeRng(seed = 0x6969) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Returns the AudioContext constructor if this environment has WebAudio, else null. */
function audioContextCtor() {
  const g = typeof globalThis !== 'undefined' ? globalThis : null;
  if (!g) return null;
  return g.AudioContext || g.webkitAudioContext || null;
}

/** Returns the OfflineAudioContext constructor if available, else null. */
function offlineCtor() {
  const g = typeof globalThis !== 'undefined' ? globalThis : null;
  if (!g) return null;
  return g.OfflineAudioContext || g.webkitOfflineAudioContext || null;
}

/** True when real-time WebAudio is available. */
export function hasWebAudio() { return !!audioContextCtor(); }

const noiseCache = new WeakMap();
/**
 * Shared 2-second white-noise buffer for a context (created once per context, deterministic).
 * @param {BaseAudioContext} ctx
 * @returns {AudioBuffer}
 */
export function noiseBuffer(ctx) {
  let buf = noiseCache.get(ctx);
  if (!buf) {
    const len = Math.floor(ctx.sampleRate * 2);
    buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    const r = makeRng(0x9e3779b9);
    for (let i = 0; i < len; i++) d[i] = r() * 2 - 1;
    noiseCache.set(ctx, buf);
  }
  return buf;
}

const curveCache = new Map();
/** Soft-clip (tanh) transfer curve for WaveShaper crunch; cached by drive amount. */
function driveCurve(drive) {
  const key = Math.round(drive * 10);
  let c = curveCache.get(key);
  if (!c) {
    const n = 1024;
    c = new Float32Array(n);
    const k = Math.max(1, drive);
    const norm = Math.tanh(k);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      c[i] = Math.tanh(k * x) / norm;
    }
    curveCache.set(key, c);
  }
  return c;
}

/* ========================================================================================
 * Kit — a tiny layer builder used by every SFX and music instrument.
 * Each layer = source(s) → optional filter → envelope gain → [pan] → dest (+ reverb send).
 * All sources are started and stopped on the audio clock; nothing needs manual cleanup.
 * ====================================================================================== */

/**
 * Layer builder bound to one context, one destination and one start time.
 * Frequencies are multiplied by `pitch`. `end` tracks the latest scheduled stop time.
 */
export class Kit {
  /**
   * @param {BaseAudioContext} ctx
   * @param {AudioNode} out destination for all layers
   * @param {number} when start time (context seconds)
   * @param {{pitch?:number, reverb?:AudioNode|null, rng?:() => number}} [opts]
   */
  constructor(ctx, out, when, opts = {}) {
    this.ctx = ctx;
    this.out = out;
    this.t = when;
    this.p = finite(opts.pitch, 1) > 0 ? finite(opts.pitch, 1) : 1;
    this.rv = opts.reverb || null;
    this.r = opts.rng || Math.random;
    this.end = when;
    this.nodes = 0;
  }

  /** Random float in [a, b). */
  rand(a, b) { return a + (b - a) * this.r(); }

  /**
   * Schedules an envelope on a gain AudioParam and returns its end time.
   * Shapes: 'perc' (a, peak, hold, d — exponential fall to -60 dB over d),
   * 'sus' (a, peak, d, s, off, r — ADSR with note-off), 'swell' (exponential rise over a, linear fall over d),
   * 'pts' (points: [[dt, value], ...] linear segments).
   */
  env(param, t, e = {}) {
    const shape = e.shape || 'perc';
    const peak = finite(e.peak, 0.5);
    const a = Math.max(0.0005, finite(e.a, 0.002));
    if (shape === 'pts') {
      const pts = e.points || [[0, 0], [0.002, peak], [0.3, 0]];
      param.setValueAtTime(pts[0][1], t + pts[0][0]);
      for (let i = 1; i < pts.length; i++) param.linearRampToValueAtTime(pts[i][1], t + pts[i][0]);
      return t + pts[pts.length - 1][0];
    }
    if (shape === 'swell') {
      const d = Math.max(0.005, finite(e.d, 0.08));
      param.setValueAtTime(0.0001, t);
      param.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
      param.linearRampToValueAtTime(0, t + a + d);
      return t + a + d;
    }
    param.setValueAtTime(0, t);
    param.linearRampToValueAtTime(peak, t + a);
    if (shape === 'sus') {
      const s = clamp(finite(e.s, 0.7), 0, 1);
      const d = Math.max(0.01, finite(e.d, 0.3));
      const r = Math.max(0.02, finite(e.r, 0.3));
      const off = Math.max(t + a, finite(e.off, t + a + 0.5));
      param.setTargetAtTime(peak * s, t + a, d / 3);
      param.setTargetAtTime(0, off, r / 5);
      return off + r;
    }
    const hold = Math.max(0, finite(e.hold, 0));
    const d = Math.max(0.005, finite(e.d, 0.2));
    if (hold > 0) param.setValueAtTime(peak, t + a + hold);
    param.setTargetAtTime(0, t + a + hold, d / 6.9);
    return t + a + hold + d;
  }

  /** Builds an optional filter chain; returns {input, output} (same node when single). */
  _filter(f, t) {
    if (!f) return null;
    const ctx = this.ctx;
    const n = ctx.createBiquadFilter();
    n.type = f.type || 'lowpass';
    const f0 = Math.max(10, finite(f.f, 1000) * (f.abs ? 1 : this.p));
    n.frequency.setValueAtTime(f0, t);
    if (f.f1) {
      const f1 = Math.max(10, f.f1 * (f.abs ? 1 : this.p));
      const g = Math.max(0.005, finite(f.glide, 0.2));
      n.frequency.exponentialRampToValueAtTime(f1, t + g);
      if (f.f2) n.frequency.exponentialRampToValueAtTime(Math.max(10, f.f2 * (f.abs ? 1 : this.p)), t + g + finite(f.glide2, 0.2));
    }
    n.Q.value = finite(f.q, n.type === 'bandpass' ? 1.2 : 0.7);
    if (f.gain !== undefined) n.gain.value = f.gain;
    this.nodes++;
    return n;
  }

  /** Connects a layer's final node to its destination, with optional panning and reverb send. */
  _route(node, o, t, end) {
    const ctx = this.ctx;
    let n = node;
    if (o.pan !== undefined || o.panTo !== undefined) {
      const p = ctx.createStereoPanner();
      p.pan.setValueAtTime(clamp(finite(o.pan, 0), -1, 1), t);
      if (o.panTo !== undefined) p.pan.linearRampToValueAtTime(clamp(o.panTo, -1, 1), Math.min(end, t + finite(o.panTime, end - t)));
      n.connect(p);
      n = p;
      this.nodes++;
    }
    n.connect(o.dest || this.out);
    if (this.rv && o.rv) {
      const s = ctx.createGain();
      s.gain.value = o.rv;
      n.connect(s);
      s.connect(this.rv);
      this.nodes++;
    }
  }

  _track(end) { if (end > this.end) this.end = end; }

  /** Applies a frequency glide/vibrato to an oscillator frequency param. */
  _freq(param, f, o, t) {
    const F = Math.max(1, f * (o.abs ? 1 : this.p));
    param.setValueAtTime(F, t);
    if (o.f1) {
      const g = Math.max(0.003, finite(o.glide, 0.1));
      param.exponentialRampToValueAtTime(Math.max(1, o.f1 * (o.abs ? 1 : this.p)), t + g);
    }
    return F;
  }

  /** Adds an LFO to a param: vib = {rate, depth (Hz), delay, fade, decay}. */
  _vib(param, vib, t, end) {
    const ctx = this.ctx;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = finite(vib.rate, 5.5);
    const g = ctx.createGain();
    const depth = finite(vib.depth, 3) * (vib.abs ? 1 : this.p);
    const delay = finite(vib.delay, 0);
    if (vib.decay) {
      g.gain.setValueAtTime(depth, t);
      g.gain.setTargetAtTime(0, t, vib.decay / 4);
    } else {
      g.gain.setValueAtTime(0, t);
      g.gain.setValueAtTime(0, t + delay);
      g.gain.linearRampToValueAtTime(depth, t + delay + finite(vib.fade, 0.2));
    }
    lfo.connect(g);
    g.connect(param);
    lfo.start(t);
    lfo.stop(end + 0.05);
    this.nodes += 2;
  }

  /**
   * Oscillator layer.
   * @param {object} o {type|wave, f, f1, glide, detune, at, env fields…, filter, vib, dest, pan, panTo, rv}
   */
  tone(o = {}) {
    const ctx = this.ctx;
    const t = this.t + finite(o.at, 0);
    const osc = ctx.createOscillator();
    if (o.wave) osc.setPeriodicWave(o.wave); else osc.type = o.type || 'sine';
    this._freq(osc.frequency, finite(o.f, 440), o, t);
    if (o.detune) osc.detune.value = o.detune;
    const g = ctx.createGain();
    const end = this.env(g.gain, t, o);
    if (o.vib) this._vib(osc.frequency, o.vib, t, end);
    const flt = this._filter(o.filter, t);
    if (flt) { osc.connect(flt); flt.connect(g); } else osc.connect(g);
    this._route(g, o, t, end);
    osc.start(t);
    osc.stop(end + 0.03);
    this.nodes += 2;
    this._track(end);
    return end;
  }

  /**
   * Noise layer (shared white-noise buffer, random offset).
   * @param {object} o {filter:{type,f,f1,glide,q}, filter2, rate, at, env fields…, dest, pan, panTo, rv, am}
   */
  noise(o = {}) {
    const ctx = this.ctx;
    const t = this.t + finite(o.at, 0);
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx);
    src.loop = true;
    src.playbackRate.value = finite(o.rate, 1);
    const g = ctx.createGain();
    const end = this.env(g.gain, t, o);
    let head = src;
    const f1 = this._filter(o.filter === undefined ? { type: 'bandpass', f: 2000, q: 1 } : o.filter, t);
    if (f1) { head.connect(f1); head = f1; }
    const f2 = this._filter(o.filter2, t);
    if (f2) { head.connect(f2); head = f2; }
    if (o.am) {
      // amplitude flicker (crackle / electric buzz): gain driven by a low-frequency square
      const amg = ctx.createGain();
      amg.gain.value = 0.5;
      const lfo = ctx.createOscillator();
      lfo.type = o.am.type || 'square';
      lfo.frequency.value = finite(o.am.rate, 40);
      const depth = ctx.createGain();
      depth.gain.value = 0.5;
      lfo.connect(depth);
      depth.connect(amg.gain);
      lfo.start(t);
      lfo.stop(end + 0.03);
      head.connect(amg);
      head = amg;
      this.nodes += 3;
    }
    head.connect(g);
    this._route(g, o, t, end);
    src.start(t, this.r() * 1.5);
    src.stop(end + 0.03);
    this.nodes += 2;
    this._track(end);
    return end;
  }

  /**
   * Two-operator FM layer. The modulation index decays from `index` to `index1` (tau `idxDecay`),
   * giving bright attacks that mellow — piano/bell/clang timbres.
   */
  fm(o = {}) {
    const ctx = this.ctx;
    const t = this.t + finite(o.at, 0);
    const car = ctx.createOscillator();
    car.type = o.type || 'sine';
    const mod = ctx.createOscillator();
    mod.type = o.modType || 'sine';
    const ratio = finite(o.ratio, 1);
    const F = this._freq(car.frequency, finite(o.f, 440), o, t);
    const mo = { ...o, f1: o.f1 ? o.f1 * ratio : undefined };
    this._freq(mod.frequency, finite(o.f, 440) * ratio, mo, t);
    const mg = ctx.createGain();
    const dev = F * ratio;
    mg.gain.setValueAtTime(finite(o.index, 2) * dev, t);
    mg.gain.setTargetAtTime(finite(o.index1, 0.2) * dev, t + 0.001, finite(o.idxDecay, 0.15) / 3);
    mod.connect(mg);
    mg.connect(car.frequency);
    if (o.detune) { car.detune.value = o.detune; mod.detune.value = o.detune; }
    const g = ctx.createGain();
    const end = this.env(g.gain, t, o);
    if (o.vib) this._vib(car.frequency, o.vib, t, end);
    const flt = this._filter(o.filter, t);
    if (flt) { car.connect(flt); flt.connect(g); } else car.connect(g);
    this._route(g, o, t, end);
    car.start(t); mod.start(t);
    car.stop(end + 0.03); mod.stop(end + 0.03);
    this.nodes += 4;
    this._track(end);
    return end;
  }

  /**
   * Inharmonic partial bank (struck metal / glass). Each partial has its own amplitude and decay.
   * @param {object} o {f, ratios[], amps[], decays[], a, peak, at, detune, dest, pan, rv}
   */
  metal(o = {}) {
    const ratios = o.ratios || [1, 2.76, 5.4, 8.93];
    const amps = o.amps || ratios.map((_, i) => 1 / (i + 1));
    const decays = o.decays || ratios.map((_, i) => finite(o.d, 0.8) / (1 + i * 0.6));
    const sum = amps.reduce((s, v) => s + v, 0) || 1;
    let end = this.t;
    ratios.forEach((r, i) => {
      end = Math.max(end, this.tone({
        type: 'sine', f: finite(o.f, 1000) * r, abs: o.abs, detune: (o.detune || 0) * (i % 2 ? 1 : -1),
        a: o.a, at: o.at, peak: (finite(o.peak, 0.3) * amps[i]) / sum, d: decays[i],
        dest: o.dest, pan: o.pan, rv: o.rv,
      }));
    });
    return end;
  }

  /** Ring-modulated layer: carrier × modulator — gritty, clangorous sidebands. */
  ring(o = {}) {
    const ctx = this.ctx;
    const t = this.t + finite(o.at, 0);
    const car = ctx.createOscillator();
    car.type = o.type || 'sine';
    this._freq(car.frequency, finite(o.f, 1200), o, t);
    const mod = ctx.createOscillator();
    mod.type = o.modType || 'sine';
    this._freq(mod.frequency, finite(o.fm, 300), { abs: o.abs, f1: o.fm1, glide: o.glide }, t);
    const rm = ctx.createGain();
    rm.gain.value = 0;
    mod.connect(rm.gain);
    car.connect(rm);
    const g = ctx.createGain();
    const end = this.env(g.gain, t, o);
    const flt = this._filter(o.filter, t);
    if (flt) { rm.connect(flt); flt.connect(g); } else rm.connect(g);
    this._route(g, o, t, end);
    car.start(t); mod.start(t);
    car.stop(end + 0.03); mod.stop(end + 0.03);
    this.nodes += 4;
    this._track(end);
    return end;
  }

  /** Ultra-short broadband transient (≤ 1 ms attack) — the "tick" that makes timing feel tight. */
  click(o = {}) {
    return this.noise({
      filter: { type: o.ftype || 'highpass', f: finite(o.f, 2500), q: finite(o.q, 0.7) },
      a: 0.0005, d: finite(o.d, 0.018), peak: finite(o.peak, 0.35), at: o.at, dest: o.dest, pan: o.pan, rv: o.rv,
    });
  }

  /**
   * Creates a sub-bus (GainNode) for layers that share processing — returns the node to use as `dest`.
   * @param {{gain?:number, drive?:number, filter?:object, pan?:number, rv?:number}} o
   */
  bus(o = {}) {
    const ctx = this.ctx;
    const input = ctx.createGain();
    input.gain.value = finite(o.gain, 1);
    let head = input;
    if (o.drive) {
      const ws = ctx.createWaveShaper();
      ws.curve = driveCurve(o.drive);
      ws.oversample = '2x';
      head.connect(ws);
      head = ws;
      this.nodes++;
    }
    const flt = this._filter(o.filter, this.t);
    if (flt) { head.connect(flt); head = flt; }
    this._route(head, o, this.t, this.t + 2);
    this.nodes++;
    return input;
  }
}

/* ========================================================================================
 * Reverb — light convolution-free delay network: feed-forward early-reflection taps into a
 * diagonal feedback delay network (parallel damped comb lines, alternating stereo sides).
 * Cross-coupled mixing matrices are avoided on purpose: browsers break graph cycles by inserting a
 * render-quantum lag wherever their pull order happens to cut the loop, which can make a mixing
 * matrix non-lossless (unstable, and different run to run). Independent loops stay stable
 * whatever lag is inserted, because each loop's gain is < 1 at every frequency.
 * ====================================================================================== */

const ER_TAPS = [[0.0071, 0.6, 0], [0.0113, -0.5, 1], [0.0167, 0.45, 0], [0.0229, -0.4, 1], [0.0293, 0.32, 0], [0.0361, -0.27, 1], [0.0433, 0.2, 0], [0.0517, -0.16, 1]];
const COMB_LENGTHS = [0.0297, 0.0331, 0.0371, 0.0411, 0.0437, 0.0479, 0.0523, 0.0571];

/**
 * Creates a stereo reverb. Connect sends to `input`; `output` carries the wet signal only.
 * @param {BaseAudioContext} ctx
 * @param {{time?:number, damp?:number, predelay?:number, wet?:number, lowCut?:number, size?:number}} [opts]
 *   time = T60 seconds, damp = loop lowpass Hz, size scales all delay lengths.
 * @returns {{input:GainNode, output:GainNode, disconnect:() => void}}
 */
export function createReverb(ctx, opts = {}) {
  const time = Math.max(0.2, finite(opts.time, 1.8));
  const size = finite(opts.size, 1);
  const nodes = [];
  const mk = (n) => { nodes.push(n); return n; };
  const input = mk(ctx.createGain());
  const hp = mk(ctx.createBiquadFilter());
  hp.type = 'highpass';
  hp.frequency.value = finite(opts.lowCut, 240);
  hp.Q.value = -3.01; // WebAudio lowpass/highpass Q is in dB: −3.01 dB = flat (Butterworth)
  const pre = mk(ctx.createDelay(0.5));
  pre.delayTime.value = finite(opts.predelay, 0.014);
  const merger = mk(ctx.createChannelMerger(2));
  const output = mk(ctx.createGain());
  output.gain.value = finite(opts.wet, 1);
  input.connect(hp);
  hp.connect(pre);
  merger.connect(output);

  // late field input: the dry send plus the early reflections (diffusion before the loops)
  const lateIn = mk(ctx.createGain());
  lateIn.gain.value = 0.22;
  pre.connect(lateIn);
  for (const [t, amp, side] of ER_TAPS) {
    const d = mk(ctx.createDelay(0.5));
    d.delayTime.value = t * size;
    const g = mk(ctx.createGain());
    g.gain.value = amp * 0.45;
    pre.connect(d);
    d.connect(g);
    g.connect(merger, 0, side);
    g.connect(lateIn);
  }
  COMB_LENGTHS.forEach((len0, i) => {
    const len = len0 * size * 1.25;
    const d = mk(ctx.createDelay(1));
    d.delayTime.value = len;
    const lp = mk(ctx.createBiquadFilter());
    lp.type = 'lowpass';
    lp.frequency.value = finite(opts.damp, 5200);
    lp.Q.value = -3.01;
    const fb = mk(ctx.createGain());
    fb.gain.value = Math.pow(10, (-3 * len) / time); // per-pass loss for the requested T60
    const tap = mk(ctx.createGain());
    tap.gain.value = (i % 4 < 2 ? 1 : -1) / Math.sqrt(COMB_LENGTHS.length / 2);
    lateIn.connect(d);
    d.connect(lp);
    lp.connect(fb);
    fb.connect(d);
    d.connect(tap);
    tap.connect(merger, 0, i % 2);
  });
  return {
    input, output,
    disconnect() { for (const n of nodes) { try { n.disconnect(); } catch { /* already gone */ } } },
  };
}

/* ========================================================================================
 * Sound effects. Each synth has the signature (ctx, destinationNode, when, opts) → seconds,
 * so it renders identically in a live AudioContext or an OfflineAudioContext.
 * opts: { pitch = 1, reverb: AudioNode|null (send input), rng: () => number }
 * ====================================================================================== */

const synth = (fn) => (ctx, dest, when, opts = {}) => {
  const k = new Kit(ctx, dest, when, opts);
  fn(k, opts);
  if (opts.stats) opts.stats.nodes = k.nodes;
  return k.end - when;
};

/** Shared "struck metal" partial ratios (irrational → clangorous, never a chord). */
const CLANG = [1, 2.405, 3.87, 5.14, 6.72, 8.26];
/** Glass-harmonica-like partial ratios for chimes. */
const GLASS = [1, 2.32, 4.25, 6.63];

/** Airy whoosh used by dodge / perfect dodge / swing / whiff. */
function whoosh(k, { f0 = 700, f1 = 3200, d = 0.22, peak = 0.4, pan = -0.35, panTo = 0.35, at = 0, q = 1.1 } = {}) {
  k.noise({ filter: { type: 'bandpass', f: f0, f1, glide: d * 0.55, f2: f0 * 1.4, glide2: d * 0.45, q }, a: 0.003, d, peak, at, pan, panTo, panTime: d, rv: 0.12 });
  k.noise({ filter: { type: 'highpass', f: 5200 }, a: 0.002, d: d * 0.4, peak: peak * 0.35, at, pan, panTo, panTime: d * 0.5 });
}

/** Layered body impact: click + pitch-dropping thump + driven crunch. */
function impact(k, { weight = 1, crunch = 1, bright = 1, peak = 1 } = {}) {
  const cr = k.bus({ drive: 3 + 2 * crunch, gain: 1 });
  k.click({ f: 2600 * bright, d: 0.018, peak: 0.34 * peak });
  k.tone({ type: 'sine', f: 200 / Math.sqrt(weight), f1: 52 / Math.sqrt(weight), glide: 0.06 + 0.04 * weight, a: 0.0008, d: 0.16 + 0.12 * weight, peak: 0.62 * peak });
  k.tone({ type: 'triangle', f: 330 * bright, f1: 140, glide: 0.05, a: 0.0008, d: 0.07, peak: 0.18 * peak });
  k.noise({ filter: { type: 'bandpass', f: 1300 * bright, f1: 700, glide: 0.08, q: 0.8 }, a: 0.0008, d: 0.08 + 0.05 * weight, peak: 0.34 * crunch * peak, dest: cr, rv: 0.08 });
}

/** Staggered high sine pings — sparkles, shards, glints. */
function pings(k, { n = 6, lo = 2400, hi = 6000, span = 0.3, peak = 0.08, d = [0.05, 0.16], at = 0, rv = 0.35, spread = 0.7 } = {}) {
  for (let i = 0; i < n; i++) {
    const t = at + (i === 0 ? 0 : k.rand(0, span));
    k.tone({ type: 'sine', f: k.rand(lo, hi), a: 0.001, d: k.rand(d[0], d[1]), peak: peak * k.rand(0.6, 1), at: t, pan: k.rand(-spread, spread), rv });
  }
}

/** Arpeggiated chime notes (Hz list) with a glassy FM timbre. */
function chimes(k, freqs, { step = 0.06, d = 0.6, peak = 0.12, ratio = 3.01, index = 1.1, rv = 0.4, at = 0, pan = 0 } = {}) {
  freqs.forEach((f, i) => k.fm({ f, ratio, index, index1: 0.05, idxDecay: 0.12, a: 0.0015, d, peak, at: at + i * step, rv, pan: pan + (i - (freqs.length - 1) / 2) * 0.15 }));
}

/** Detuned "choir" cluster through vowel formants (used by gradient telegraph, phase, skill). */
function choir(k, freqs, { a = 0.4, d = 0.2, peak = 0.16, shape = 'swell', at = 0, rv = 0.5, vowel = [700, 1150] } = {}) {
  const bus = k.bus({ filter: { type: 'lowpass', f: 3200, abs: true }, rv });
  const f1 = k.bus({ filter: { type: 'bandpass', f: vowel[0], q: 4, abs: true }, gain: 1.6, dest: bus });
  const f2 = k.bus({ filter: { type: 'bandpass', f: vowel[1], q: 5, abs: true }, gain: 1.1, dest: bus });
  const per = peak / freqs.length;
  freqs.forEach((f, i) => {
    for (const det of [-11, 9]) {
      const o = { type: 'sawtooth', f, detune: det + (i % 2 ? 3 : -3), a, d, peak: per, shape, at, vib: { rate: 5 + i * 0.3, depth: f * 0.004, delay: 0.1, fade: 0.3 } };
      k.tone({ ...o, dest: f1 });
      k.tone({ ...o, dest: f2, peak: per * 0.7 });
    }
  });
}

const RAW_SYNTHS = {
  /* ---------------- UI ---------------- */
  ui_move: synth((k) => {
    k.tone({ type: 'sine', f: 1320, f1: 1180, glide: 0.04, a: 0.001, d: 0.06, peak: 0.16 });
    k.tone({ type: 'triangle', f: 2640, a: 0.0008, d: 0.025, peak: 0.05 });
  }),
  ui_confirm: synth((k) => {
    k.click({ f: 4000, d: 0.01, peak: 0.08 });
    k.fm({ f: 987.8, ratio: 2, index: 1.2, index1: 0.1, a: 0.001, d: 0.22, peak: 0.2, rv: 0.15 });
    k.fm({ f: 1480, ratio: 2, index: 1, index1: 0.1, a: 0.001, d: 0.34, peak: 0.18, at: 0.055, rv: 0.2 });
  }),
  ui_cancel: synth((k) => {
    k.tone({ type: 'triangle', f: 700, f1: 440, glide: 0.09, a: 0.001, d: 0.14, peak: 0.2 });
    k.tone({ type: 'sine', f: 350, f1: 220, glide: 0.09, a: 0.001, d: 0.12, peak: 0.12 });
  }),
  ui_error: synth((k) => {
    for (const at of [0, 0.095]) {
      k.tone({ type: 'sawtooth', f: 196, a: 0.002, d: 0.085, hold: 0.02, peak: 0.12, at, filter: { type: 'lowpass', f: 900, q: 1 } });
      k.tone({ type: 'sawtooth', f: 207.7, a: 0.002, d: 0.085, hold: 0.02, peak: 0.1, at, filter: { type: 'lowpass', f: 900, q: 1 } });
    }
  }),
  menu_open: synth((k) => {
    k.noise({ filter: { type: 'bandpass', f: 1100, f1: 3200, glide: 0.1, q: 0.9 }, a: 0.004, d: 0.13, peak: 0.12 });
    k.fm({ f: 659.3, ratio: 3, index: 0.8, index1: 0.05, a: 0.002, d: 0.45, peak: 0.12, at: 0.03, rv: 0.3 });
    k.fm({ f: 987.8, ratio: 3, index: 0.6, index1: 0.05, a: 0.002, d: 0.4, peak: 0.08, at: 0.07, rv: 0.3 });
  }),
  coin: synth((k) => {
    k.tone({ type: 'triangle', f: 1975.5, a: 0.0008, d: 0.07, hold: 0.03, peak: 0.16 });
    k.tone({ type: 'triangle', f: 2637, a: 0.0008, d: 0.38, peak: 0.16, at: 0.075, rv: 0.2 });
    k.tone({ type: 'sine', f: 5274, a: 0.0008, d: 0.12, peak: 0.04, at: 0.075 });
  }),
  step: synth((k) => {
    k.noise({ filter: { type: 'lowpass', f: 900, q: 0.8 }, a: 0.0015, d: 0.05, peak: 0.16 });
    k.tone({ type: 'sine', f: 120, f1: 80, glide: 0.03, a: 0.001, d: 0.045, peak: 0.12 });
  }),
  swing: synth((k) => whoosh(k, { f0: 900, f1: 2600, d: 0.16, peak: 0.3, pan: -0.2, panTo: 0.25 })),

  /* ---------------- offense / impacts ---------------- */
  hit: synth((k) => impact(k, { weight: 1, crunch: 1, bright: 1, peak: 1 })),
  hit_heavy: synth((k) => {
    impact(k, { weight: 2.1, crunch: 1.4, bright: 0.8, peak: 1.05 });
    k.tone({ type: 'sine', f: 58, a: 0.002, d: 0.42, peak: 0.28 });
    k.noise({ filter: { type: 'bandpass', f: 560, q: 1.1 }, a: 0.002, d: 0.3, peak: 0.16, at: 0.015, rv: 0.2 });
  }),
  crit: synth((k) => {
    impact(k, { weight: 1.3, crunch: 1.2, bright: 1.2, peak: 0.95 });
    k.metal({ f: 1760, ratios: CLANG.slice(0, 4), amps: [1, 0.6, 0.45, 0.3], decays: [0.5, 0.35, 0.25, 0.18], peak: 0.26, rv: 0.3 });
    k.noise({ filter: { type: 'highpass', f: 6500 }, a: 0.001, d: 0.22, peak: 0.16, rv: 0.25 });
  }),
  whiff: synth((k) => whoosh(k, { f0: 600, f1: 1900, d: 0.18, peak: 0.26, pan: 0.1, panTo: -0.25, q: 0.8 })),
  hurt: synth((k) => {
    const cr = k.bus({ drive: 4 });
    k.click({ f: 1800, d: 0.02, peak: 0.28 });
    k.tone({ type: 'sine', f: 170, f1: 55, glide: 0.09, a: 0.0008, d: 0.22, peak: 0.52 });
    k.tone({ type: 'sawtooth', f: 310, f1: 120, glide: 0.16, a: 0.001, d: 0.18, peak: 0.2, filter: { type: 'lowpass', f: 1300, q: 1.5 } });
    k.noise({ filter: { type: 'bandpass', f: 950, q: 0.9 }, a: 0.001, d: 0.1, peak: 0.26, dest: cr });
  }),
  shot: synth((k) => {
    const cr = k.bus({ drive: 5 });
    k.noise({ filter: { type: 'highpass', f: 1400 }, a: 0.0005, d: 0.06, peak: 0.55, dest: cr });
    k.tone({ type: 'sine', f: 190, f1: 48, glide: 0.07, a: 0.0008, d: 0.2, peak: 0.46 });
    k.noise({ filter: { type: 'bandpass', f: 2600, f1: 700, glide: 0.25, q: 0.8 }, a: 0.002, d: 0.32, peak: 0.14, rv: 0.35 });
  }),
  break: synth((k) => {
    k.noise({ filter: { type: 'highpass', f: 2200 }, a: 0.0005, d: 0.045, peak: 0.55 });
    k.tone({ type: 'sine', f: 130, f1: 38, glide: 0.12, a: 0.0008, d: 0.34, peak: 0.52 });
    k.ring({ f: 3200, fm: 1370, a: 0.0008, d: 0.14, peak: 0.16 });
    k.noise({ filter: { type: 'bandpass', f: 4600, q: 3.5 }, a: 0.001, d: 0.62, peak: 0.2, rv: 0.35 });
    k.noise({ filter: { type: 'highpass', f: 7200 }, a: 0.001, d: 0.38, peak: 0.16 });
    pings(k, { n: 18, lo: 2600, hi: 7400, span: 0.55, peak: 0.09, d: [0.04, 0.16], rv: 0.4, spread: 0.85 });
  }),
  ko: synth((k) => {
    k.click({ f: 900, ftype: 'lowpass', d: 0.03, peak: 0.28 });
    k.tone({ type: 'sine', f: 105, f1: 34, glide: 0.25, a: 0.001, d: 0.55, peak: 0.55 });
    k.noise({ filter: { type: 'lowpass', f: 420, q: 0.7 }, a: 0.002, d: 0.32, peak: 0.24 });
    k.tone({ type: 'triangle', f: 440, f1: 110, glide: 0.7, a: 0.004, d: 0.75, peak: 0.13, at: 0.05, rv: 0.35 });
  }),
  qte_perfect: synth((k) => {
    k.click({ f: 5000, d: 0.012, peak: 0.24 });
    k.metal({ f: 1760, ratios: GLASS, amps: [1, 0.5, 0.3, 0.18], decays: [0.9, 0.5, 0.3, 0.2], peak: 0.4, a: 0.0008, rv: 0.4 });
    k.metal({ f: 2637, ratios: GLASS, amps: [1, 0.45, 0.25, 0.12], decays: [0.8, 0.45, 0.28, 0.18], peak: 0.2, a: 0.0008, at: 0.035, rv: 0.45 });
  }),
  qte_good: synth((k) => {
    k.click({ f: 4000, d: 0.01, peak: 0.12 });
    k.fm({ f: 1318.5, ratio: 2, index: 1.2, index1: 0.1, idxDecay: 0.1, a: 0.0008, d: 0.42, peak: 0.28, rv: 0.3 });
  }),
  qte_miss: synth((k) => {
    k.tone({ type: 'triangle', f: 300, f1: 210, glide: 0.05, a: 0.0008, d: 0.07, peak: 0.28 });
    k.noise({ filter: { type: 'bandpass', f: 900, q: 2 }, a: 0.0008, d: 0.035, peak: 0.2 });
  }),

  /* ---------------- defense ---------------- */
  parry: synth((k) => {
    // THE signature sound: bright tink → FM clang → inharmonic metal body → ring-mod grit → beating shimmer tail.
    k.noise({ filter: { type: 'highpass', f: 3000 }, a: 0.0005, d: 0.016, peak: 0.5 });
    k.tone({ type: 'triangle', f: 460, f1: 320, glide: 0.04, a: 0.0006, d: 0.05, peak: 0.24 });
    k.fm({ f: 880, ratio: 1.414, index: 6, index1: 0.4, idxDecay: 0.09, a: 0.0006, d: 0.55, peak: 0.2, rv: 0.25 });
    k.metal({ f: 1250, ratios: CLANG, amps: [1, 0.72, 0.56, 0.42, 0.3, 0.2], decays: [1.25, 0.95, 0.72, 0.52, 0.36, 0.26], peak: 0.36, a: 0.0006, rv: 0.35 });
    k.ring({ f: 2350, fm: 620, a: 0.0006, d: 0.24, peak: 0.18 });
    k.tone({ type: 'sine', f: 3520, a: 0.001, d: 1.7, peak: 0.07, pan: -0.3, rv: 0.6 });
    k.tone({ type: 'sine', f: 3531, a: 0.001, d: 1.6, peak: 0.07, pan: 0.3, rv: 0.6 });
    k.tone({ type: 'sine', f: 4698, a: 0.001, d: 1.2, peak: 0.04, pan: 0.2, rv: 0.6 });
    k.tone({ type: 'sine', f: 4712, a: 0.001, d: 1.25, peak: 0.04, pan: -0.2, rv: 0.6 });
    k.tone({ type: 'sine', f: 7040, a: 0.001, d: 0.7, peak: 0.02, rv: 0.6 });
  }),
  dodge: synth((k) => whoosh(k, { f0: 800, f1: 3600, d: 0.22, peak: 0.42 })),
  perfect_dodge: synth((k) => {
    whoosh(k, { f0: 900, f1: 4200, d: 0.2, peak: 0.38 });
    k.tone({ type: 'sine', f: 3136, a: 0.0006, d: 0.05, peak: 0.16 });
    chimes(k, [2093, 3136, 4186], { step: 0.045, d: 0.55, peak: 0.1, ratio: 2.01, index: 0.7, rv: 0.55, at: 0.02 });
    pings(k, { n: 5, lo: 5000, hi: 8000, span: 0.25, peak: 0.04, at: 0.05, rv: 0.5 });
  }),
  jump: synth((k) => {
    k.noise({ filter: { type: 'lowpass', f: 900 }, a: 0.0006, d: 0.05, peak: 0.26 });
    k.tone({ type: 'triangle', f: 240, f1: 880, glide: 0.13, a: 0.0008, d: 0.2, peak: 0.34, vib: { rate: 26, depth: 70, decay: 0.16 } });
    k.tone({ type: 'sine', f: 480, f1: 1760, glide: 0.13, a: 0.001, d: 0.14, peak: 0.1 });
  }),
  land: synth((k) => {
    k.click({ f: 700, ftype: 'lowpass', d: 0.02, peak: 0.26 });
    k.tone({ type: 'sine', f: 150, f1: 52, glide: 0.06, a: 0.0008, d: 0.14, peak: 0.5 });
    k.noise({ filter: { type: 'lowpass', f: 520 }, a: 0.001, d: 0.09, peak: 0.26 });
  }),
  block: synth((k) => {
    k.noise({ filter: { type: 'bandpass', f: 720, q: 3 }, a: 0.0006, d: 0.06, peak: 0.42 });
    k.tone({ type: 'sine', f: 270, f1: 185, glide: 0.05, a: 0.0006, d: 0.13, peak: 0.46 });
    k.tone({ type: 'triangle', f: 515, a: 0.0006, d: 0.05, peak: 0.16 });
  }),
  counter: synth((k) => {
    k.click({ f: 3500, d: 0.012, peak: 0.3 });
    whoosh(k, { f0: 3000, f1: 1200, d: 0.09, peak: 0.28, pan: -0.2, panTo: 0.3 });
    impact(k, { weight: 1.2, crunch: 1.1, bright: 1.1, peak: 0.8 });
    k.metal({ f: 2200, ratios: CLANG.slice(0, 3), amps: [1, 0.5, 0.3], decays: [0.35, 0.25, 0.15], peak: 0.14, at: 0.02, rv: 0.3 });
  }),
  gradient_counter: synth((k) => {
    const cr = k.bus({ drive: 4 });
    k.noise({ filter: { type: 'highpass', f: 2000 }, a: 0.0005, d: 0.035, peak: 0.5 });
    k.tone({ type: 'sine', f: 170, f1: 34, glide: 0.2, a: 0.0008, d: 0.8, peak: 0.55 });
    k.noise({ filter: { type: 'lowpass', f: 3000, f1: 600, glide: 0.25 }, a: 0.0008, d: 0.26, peak: 0.34, dest: cr });
    k.metal({ f: 1480, ratios: CLANG, amps: [1, 0.7, 0.5, 0.35, 0.25, 0.18], decays: [1, 0.8, 0.6, 0.45, 0.3, 0.2], peak: 0.24, rv: 0.4 });
    // prismatic chord: Amaj9 spread with detuned pairs, bell-ish FM
    for (const [i, f] of [880, 1108.7, 1318.5, 1661.2, 1975.5, 2637].entries()) {
      k.fm({ f, ratio: 2.0, index: 1.2, index1: 0.1, a: 0.001, d: 1.3 - i * 0.08, peak: 0.055, detune: i % 2 ? 7 : -7, pan: (i - 2.5) * 0.25, rv: 0.55 });
    }
    k.noise({ filter: { type: 'highpass', f: 6200 }, a: 0.001, d: 1.1, peak: 0.1, rv: 0.4 });
  }),

  /* ---------------- telegraphs (subtle, distinct tells — not timing-critical) ---------------- */
  telegraph: synth((k) => {
    k.noise({ filter: { type: 'highpass', f: 4200 }, a: 0.003, d: 0.12, peak: 0.1 });
    k.tone({ type: 'sine', f: 1760, f1: 1975, glide: 0.08, a: 0.002, d: 0.16, peak: 0.07, rv: 0.3 });
  }),
  telegraph_red: synth((k) => {
    const flt = { type: 'lowpass', f: 240, f1: 720, glide: 0.22, f2: 260, glide2: 0.3, q: 5 };
    k.tone({ type: 'sawtooth', f: 69.3, a: 0.02, hold: 0.12, d: 0.4, peak: 0.2, filter: flt, vib: { rate: 11, depth: 3, fade: 0.1 } });
    k.tone({ type: 'sawtooth', f: 73.4, a: 0.02, hold: 0.12, d: 0.4, peak: 0.16, filter: flt });
    k.noise({ filter: { type: 'lowpass', f: 220 }, a: 0.03, hold: 0.1, d: 0.35, peak: 0.16 });
  }),
  telegraph_gold: synth((k) => {
    k.tone({ type: 'sine', f: 880, f1: 1760, glide: 0.34, a: 0.01, d: 0.36, peak: 0.09, rv: 0.4 });
    chimes(k, [1318.5, 1760, 2349.3], { step: 0.07, d: 0.35, peak: 0.06, ratio: 2, index: 0.6, rv: 0.45 });
    k.noise({ filter: { type: 'highpass', f: 5200 }, shape: 'swell', a: 0.16, d: 0.22, peak: 0.06 });
  }),
  telegraph_gradient: synth((k) => {
    // reverse swell: everything rises into a sudden cut, like time being wound backwards
    k.noise({ filter: { type: 'bandpass', f: 500, f1: 3800, glide: 0.6, q: 1.4 }, shape: 'swell', a: 0.58, d: 0.07, peak: 0.16, pan: 0.4, panTo: -0.4, panTime: 0.6 });
    choir(k, [220, 277.2, 329.6, 415.3], { a: 0.56, d: 0.1, peak: 0.26, shape: 'swell', rv: 0.5 });
    k.tone({ type: 'sine', f: 55, f1: 110, glide: 0.6, shape: 'swell', a: 0.58, d: 0.08, peak: 0.2 });
  }),

  /* ---------------- gradient / support ---------------- */
  gradient_ready: synth((k) => {
    k.click({ f: 5000, d: 0.01, peak: 0.1 });
    chimes(k, [1318.5, 1975.5, 2637], { step: 0.09, d: 0.8, peak: 0.13, ratio: 3.01, index: 0.9, rv: 0.5 });
    k.noise({ filter: { type: 'highpass', f: 6000 }, shape: 'swell', a: 0.25, d: 0.4, peak: 0.05, rv: 0.4 });
  }),
  gradient_skill: synth((k) => {
    k.click({ f: 1500, d: 0.03, peak: 0.3 });
    k.tone({ type: 'sine', f: 90, f1: 40, glide: 0.4, a: 0.001, d: 0.9, peak: 0.42 });
    k.noise({ filter: { type: 'bandpass', f: 300, f1: 6000, glide: 0.55, q: 1.2 }, a: 0.02, hold: 0.25, d: 0.45, peak: 0.2, pan: -0.4, panTo: 0.4, panTime: 0.7, rv: 0.3 });
    choir(k, [220, 329.6, 440, 554.4, 659.3], { a: 0.08, d: 1.1, peak: 0.24, shape: 'perc', rv: 0.55 });
    chimes(k, [1760, 2217.5, 2637, 3520], { step: 0.05, d: 0.9, peak: 0.07, at: 0.25, rv: 0.55 });
  }),
  heal: synth((k) => {
    chimes(k, [1046.5, 1318.5, 1568, 2093], { step: 0.07, d: 0.85, peak: 0.12, ratio: 2, index: 0.8, rv: 0.55 });
    k.tone({ type: 'sine', f: 523.3, a: 0.04, d: 0.9, peak: 0.1, rv: 0.4 });
    k.noise({ filter: { type: 'highpass', f: 7000 }, shape: 'swell', a: 0.2, d: 0.5, peak: 0.04, rv: 0.5 });
  }),
  buff: synth((k) => {
    k.noise({ filter: { type: 'bandpass', f: 600, f1: 3200, glide: 0.3, q: 1.3 }, a: 0.01, d: 0.36, peak: 0.16 });
    k.tone({ type: 'triangle', f: 392, f1: 784, glide: 0.25, a: 0.005, d: 0.36, peak: 0.16 });
    k.fm({ f: 1568, ratio: 3, index: 0.8, index1: 0.05, a: 0.001, d: 0.5, peak: 0.12, at: 0.2, rv: 0.45 });
  }),
  debuff: synth((k) => {
    k.tone({ type: 'sawtooth', f: 415, f1: 196, glide: 0.34, a: 0.004, d: 0.45, peak: 0.14, filter: { type: 'lowpass', f: 900, q: 2 }, vib: { rate: 7, depth: 12, fade: 0.1 } });
    k.tone({ type: 'sine', f: 311, f1: 147, glide: 0.34, a: 0.004, d: 0.42, peak: 0.16 });
    k.noise({ filter: { type: 'lowpass', f: 600 }, a: 0.01, d: 0.32, peak: 0.1, rv: 0.2 });
  }),
  revive: synth((k) => {
    k.click({ f: 4000, d: 0.012, peak: 0.1 });
    chimes(k, [880, 1108.7, 1318.5, 1760, 2217.5], { step: 0.08, d: 1.0, peak: 0.12, ratio: 2, index: 0.9, rv: 0.55 });
    k.tone({ type: 'sine', f: 440, f1: 880, glide: 0.5, a: 0.05, d: 0.8, peak: 0.1, rv: 0.4 });
    k.noise({ filter: { type: 'highpass', f: 6500 }, shape: 'swell', a: 0.35, d: 0.5, peak: 0.05, rv: 0.5 });
  }),
  shield_restore: synth((k) => {
    k.click({ f: 4500, d: 0.01, peak: 0.1 });
    k.fm({ f: 440, f1: 880, glide: 0.22, ratio: 2, index: 1, index1: 0.2, a: 0.008, d: 0.6, peak: 0.14, rv: 0.4 });
    chimes(k, [880, 1320, 1760], { step: 0.06, d: 0.4, peak: 0.09, ratio: 2.76, index: 0.6, rv: 0.45 });
    k.noise({ filter: { type: 'highpass', f: 6000 }, shape: 'swell', a: 0.12, d: 0.3, peak: 0.05 });
  }),
  phase: synth((k) => {
    k.noise({ filter: { type: 'highpass', f: 1600 }, a: 0.0005, d: 0.05, peak: 0.4 });
    k.tone({ type: 'sine', f: 62, f1: 30, glide: 1.0, a: 0.001, d: 1.6, peak: 0.52 });
    k.metal({ f: 520, ratios: CLANG, amps: [1, 0.7, 0.5, 0.4, 0.3, 0.2], decays: [2.2, 1.6, 1.2, 0.9, 0.7, 0.5], peak: 0.2, rv: 0.5 });
    choir(k, [130.8, 196, 233.1, 311.1], { a: 0.4, d: 1.2, peak: 0.26, shape: 'perc', rv: 0.6, at: 0.1 });
  }),

  /* ---------------- elements (impact layers — sharp) ---------------- */
  fire: synth((k) => {
    const cr = k.bus({ drive: 3 });
    k.click({ f: 1200, d: 0.02, peak: 0.3 });
    k.noise({ filter: { type: 'lowpass', f: 1600, f1: 380, glide: 0.4, q: 1.2 }, a: 0.002, d: 0.48, peak: 0.36, dest: cr, rv: 0.15 });
    k.tone({ type: 'sine', f: 130, f1: 60, glide: 0.12, a: 0.0008, d: 0.2, peak: 0.34 });
    for (let i = 0; i < 9; i++) k.click({ f: k.rand(2500, 5500), d: 0.006, peak: k.rand(0.05, 0.12), at: k.rand(0.03, 0.42), pan: k.rand(-0.6, 0.6) });
  }),
  ice: synth((k) => {
    k.click({ f: 5000, d: 0.012, peak: 0.34 });
    k.tone({ type: 'sine', f: 1200, f1: 2600, glide: 0.1, a: 0.0008, d: 0.14, peak: 0.16 });
    k.noise({ filter: { type: 'highpass', f: 6200 }, a: 0.001, d: 0.34, peak: 0.16, rv: 0.3 });
    k.metal({ f: 2900, ratios: GLASS, amps: [1, 0.5, 0.3, 0.2], decays: [0.5, 0.3, 0.2, 0.12], peak: 0.2, rv: 0.4 });
    pings(k, { n: 6, lo: 3200, hi: 6200, span: 0.16, peak: 0.07, rv: 0.45 });
  }),
  lightning: synth((k) => {
    const cr = k.bus({ drive: 6 });
    k.noise({ filter: { type: 'highpass', f: 1500 }, a: 0.0005, d: 0.26, peak: 0.38, dest: cr, am: { rate: 43 }, rv: 0.2 });
    k.tone({ type: 'sawtooth', f: 110, f1: 52, glide: 0.2, a: 0.0008, d: 0.22, peak: 0.22, filter: { type: 'lowpass', f: 3000, q: 1 } });
    k.ring({ f: 1800, fm: 97, a: 0.0008, d: 0.16, peak: 0.16 });
    k.tone({ type: 'sine', f: 90, f1: 40, glide: 0.1, a: 0.0008, d: 0.18, peak: 0.3 });
  }),
  earth: synth((k) => {
    const cr = k.bus({ drive: 3 });
    k.click({ f: 800, ftype: 'lowpass', d: 0.03, peak: 0.34 });
    k.tone({ type: 'sine', f: 95, f1: 38, glide: 0.15, a: 0.0008, d: 0.45, peak: 0.6 });
    k.noise({ filter: { type: 'lowpass', f: 900, q: 0.8 }, a: 0.001, d: 0.34, peak: 0.36, dest: cr });
    for (let i = 0; i < 6; i++) k.noise({ filter: { type: 'bandpass', f: k.rand(380, 950), q: 2 }, a: 0.001, d: k.rand(0.04, 0.1), peak: k.rand(0.06, 0.14), at: k.rand(0.05, 0.35), pan: k.rand(-0.6, 0.6) });
  }),
  light: synth((k) => {
    k.click({ f: 6000, d: 0.012, peak: 0.26 });
    k.fm({ f: 1760, ratio: 3.5, index: 2, index1: 0.2, idxDecay: 0.1, a: 0.0008, d: 0.85, peak: 0.2, rv: 0.5 });
    k.fm({ f: 2637, ratio: 3.5, index: 1.5, index1: 0.2, idxDecay: 0.1, a: 0.0008, d: 0.7, peak: 0.12, rv: 0.5, at: 0.02 });
    k.noise({ filter: { type: 'highpass', f: 8000 }, a: 0.001, d: 0.55, peak: 0.1, rv: 0.4 });
    k.tone({ type: 'sine', f: 880, a: 0.001, d: 0.6, peak: 0.1, rv: 0.4 });
  }),
  dark: synth((k) => {
    k.click({ f: 1000, ftype: 'lowpass', d: 0.03, peak: 0.34 });
    k.tone({ type: 'sawtooth', f: 58, f1: 44, glide: 0.4, a: 0.0015, d: 0.6, peak: 0.26, filter: { type: 'lowpass', f: 420, q: 3 } });
    k.ring({ f: 220, fm: 233, a: 0.0015, d: 0.42, peak: 0.2 });
    k.noise({ filter: { type: 'bandpass', f: 320, f1: 160, glide: 0.4, q: 2 }, a: 0.0015, d: 0.5, peak: 0.24, rv: 0.4 });
  }),

  /* ---------------- world / stings ---------------- */
  level_up: synth((k) => {
    k.click({ f: 3000, d: 0.012, peak: 0.12 });
    const notes = [523.3, 659.3, 784, 1046.5];
    notes.forEach((f, i) => k.fm({ f, ratio: 1, index: 1.4, index1: 0.2, idxDecay: 0.2, a: 0.001, d: 0.7, peak: 0.18, at: i * 0.085, rv: 0.4 }));
    for (const f of [1046.5, 1318.5, 1568]) k.fm({ f, ratio: 2, index: 0.8, index1: 0.05, a: 0.004, d: 1.3, peak: 0.1, at: 0.34, rv: 0.55 });
    pings(k, { n: 8, lo: 3000, hi: 7000, span: 0.6, peak: 0.04, at: 0.34, rv: 0.5 });
  }),
  chest: synth((k) => {
    k.noise({ filter: { type: 'bandpass', f: 320, f1: 520, glide: 0.2, q: 7 }, a: 0.006, d: 0.24, peak: 0.24 });
    k.tone({ type: 'sine', f: 180, f1: 120, glide: 0.05, a: 0.001, d: 0.08, peak: 0.25, at: 0.2 });
    chimes(k, [1568, 1975.5, 2349.3, 3136], { step: 0.06, d: 0.7, peak: 0.1, at: 0.22, rv: 0.5 });
  }),
  flag: synth((k) => {
    k.noise({ filter: { type: 'bandpass', f: 900, f1: 1500, glide: 0.3, q: 0.8 }, a: 0.03, d: 0.35, peak: 0.12, pan: -0.3, panTo: 0.3 });
    for (const [i, f] of [587.3, 740, 880, 1174.7].entries()) k.fm({ f, ratio: 2, index: 1, index1: 0.1, idxDecay: 0.3, a: 0.004, d: 1.6, peak: 0.1, at: 0.05 + i * 0.05, rv: 0.55 });
  }),
  encounter: synth((k) => {
    k.noise({ filter: { type: 'highpass', f: 2000 }, a: 0.0005, d: 0.05, peak: 0.5 });
    k.tone({ type: 'sine', f: 110, f1: 32, glide: 0.35, a: 0.0008, d: 0.8, peak: 0.5 });
    const stab = k.bus({ filter: { type: 'lowpass', f: 2400, f1: 700, glide: 0.8, q: 1, abs: true }, rv: 0.4 });
    for (const f of [130.8, 138.6, 196, 261.6, 277.2]) {
      k.tone({ type: 'sawtooth', f, a: 0.004, d: 1.0, peak: 0.07, dest: stab, detune: k.rand(-8, 8) });
    }
    pings(k, { n: 20, lo: 2600, hi: 7600, span: 0.7, peak: 0.08, d: [0.04, 0.18], rv: 0.5, spread: 0.9 });
    k.noise({ filter: { type: 'bandpass', f: 5000, q: 3 }, a: 0.001, d: 0.8, peak: 0.16, rv: 0.4 });
  }),
  victory: synth((k) => {
    k.tone({ type: 'sine', f: 98, f1: 60, glide: 0.1, a: 0.001, d: 0.5, peak: 0.34 });
    const brass = k.bus({ filter: { type: 'lowpass', f: 900, f1: 3200, glide: 0.08, f2: 1800, glide2: 0.4, q: 1.2, abs: true }, rv: 0.4 });
    for (const [i, f] of [293.7, 370, 440, 587.3].entries()) {
      k.tone({ type: 'sawtooth', f, a: 0.012, hold: 0.45, d: 0.7, peak: 0.08, dest: brass, detune: i % 2 ? 6 : -6, at: i * 0.07 });
    }
    chimes(k, [1174.7, 1480, 1760, 2349.3], { step: 0.07, d: 1.0, peak: 0.07, at: 0.3, rv: 0.5 });
  }),
  defeat: synth((k) => {
    k.tone({ type: 'sine', f: 80, f1: 40, glide: 0.8, a: 0.002, d: 1.4, peak: 0.4 });
    k.metal({ f: 180, ratios: CLANG, amps: [1, 0.6, 0.45, 0.3, 0.2, 0.15], decays: [2.0, 1.5, 1.1, 0.8, 0.6, 0.4], peak: 0.26, rv: 0.5 });
    const pad = k.bus({ filter: { type: 'lowpass', f: 900, abs: true }, rv: 0.45 });
    [[220, 0.1], [207.7, 0.45], [174.6, 0.8]].forEach(([f, at]) => {
      k.tone({ type: 'sawtooth', f, a: 0.02, hold: 0.25, d: 0.6, peak: 0.1, dest: pad, at });
      k.tone({ type: 'sawtooth', f: f * 1.5, a: 0.02, hold: 0.25, d: 0.6, peak: 0.05, dest: pad, at, detune: 5 });
    });
  }),
};

/**
 * Output trims per SFX (linear gain on the synth's dry and reverb outputs), calibrated with the
 * dev bench self-test so combat hits peak around 0.75–0.9, UI sounds around 0.15–0.3 and nothing clips.
 */
export const SFX_LEVELS = Object.freeze({
  hit: 0.8, hit_heavy: 0.66, crit: 0.6, break: 0.85, shot: 0.46, counter: 0.72, gradient_counter: 0.71,
  lightning: 0.4, hurt: 0.82, encounter: 0.86, dodge: 1.85, perfect_dodge: 1.6, whiff: 2.1, swing: 1.7,
  qte_perfect: 1.3, qte_good: 1.25,
});

/** Wraps a synth so its dry output and reverb send pass through a trim gain. */
function leveled(fn, level) {
  if (level === 1) return fn;
  return (ctx, dest, when, opts = {}) => {
    const out = ctx.createGain();
    out.gain.value = level;
    out.connect(dest);
    let reverb = null;
    if (opts.reverb) {
      reverb = ctx.createGain();
      reverb.gain.value = level;
      reverb.connect(opts.reverb);
    }
    return fn(ctx, out, when, { ...opts, reverb });
  };
}

/**
 * The SFX synth table: name → (ctx, destinationNode, when, opts) → duration (s).
 * opts: { pitch = 1, reverb: AudioNode|null, rng: () => number, stats?: {nodes} }.
 */
export const SFX_SYNTHS = Object.freeze(Object.fromEntries(
  Object.entries(RAW_SYNTHS).map(([name, fn]) => [name, leveled(fn, SFX_LEVELS[name] ?? 1)]),
));

/* ========================================================================================
 * Music theory helpers — note names, chord symbols and a compact melody notation.
 * ====================================================================================== */

const NOTE_PC = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

/** "c#4" / "bb3" / "a5" → MIDI number (C4 = 60). */
export function noteToMidi(name) {
  const m = /^([a-gA-G])(#|b)?(-?\d)$/.exec(String(name).trim());
  if (!m) throw new Error(`bad note "${name}"`);
  return NOTE_PC[m[1].toLowerCase()] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + (Number(m[3]) + 1) * 12;
}

const CHORD_QUALITIES = {
  '': [0, 4, 7], m: [0, 3, 7], 7: [0, 4, 7, 10], m7: [0, 3, 7, 10], maj7: [0, 4, 7, 11], dim: [0, 3, 6],
  m7b5: [0, 3, 6, 10], dim7: [0, 3, 6, 9], sus4: [0, 5, 7], sus2: [0, 2, 7], '7sus4': [0, 5, 7, 10],
  add9: [0, 4, 7, 14], madd9: [0, 3, 7, 14], 6: [0, 4, 7, 9], m6: [0, 3, 7, 9], 9: [0, 4, 7, 10, 14],
  m9: [0, 3, 7, 10, 14], maj9: [0, 4, 7, 11, 14], aug: [0, 4, 8], '7b9': [0, 4, 7, 10, 13],
};

/**
 * Parses a chord symbol ("Am7", "D/F#", "Bbmaj7", "Bm7b5") into
 * { sym, root (pitch class), iv (intervals), pcs (Set), bass (pitch class) }.
 */
export function parseChord(sym) {
  const m = /^([A-G])(#|b)?([^/]*)(?:\/([A-G])(#|b)?)?$/.exec(sym);
  if (!m || !(m[3] in CHORD_QUALITIES)) throw new Error(`bad chord "${sym}"`);
  const pc = (l, acc) => (NOTE_PC[l.toLowerCase()] + (acc === '#' ? 1 : acc === 'b' ? -1 : 0) + 12) % 12;
  const root = pc(m[1], m[2]);
  const iv = CHORD_QUALITIES[m[3]];
  return { sym, root, iv, pcs: new Set(iv.map((i) => (root + i) % 12)), bass: m[4] ? pc(m[4], m[5]) : root };
}

/** Root of a chord in a given octave (octave 2 → C2 = 36). */
export const rootOf = (ch, oct) => (oct + 1) * 12 + ch.root;
/** Bass note (slash bass if any) in a given octave. */
export const bassOf = (ch, oct) => (oct + 1) * 12 + ch.bass;
/** Chord interval at index i of the chord (third = 1, fifth = 2), wrapping into higher octaves. */
export const degree = (ch, i) => ch.iv[i % ch.iv.length] + 12 * Math.floor(i / ch.iv.length);
/** `n` ascending chord tones starting at or above MIDI `lo` (a close voicing). */
export function voicing(ch, lo, n) {
  const out = [];
  let m = lo;
  while (out.length < n && m < lo + 48) {
    if (ch.pcs.has(((m % 12) + 12) % 12)) out.push(m);
    m++;
  }
  return out;
}

/**
 * Parses the melody mini-notation: whitespace-separated tokens, each `note[:len]`, `.[:len]` (rest)
 * or `-[:len]` (tie). `+` stacks notes ("d5+f#5"). `|` is ignored (bar lines). Lengths are in steps.
 * @returns {{len:number, at:Map<number, {m:number[], l:number}[]>}}
 */
export function parseSeq(str) {
  const at = new Map();
  let s = 0;
  let last = null;
  for (const tok of str.trim().split(/\s+/)) {
    if (!tok || tok === '|') continue;
    const [body, lenStr] = tok.split(':');
    const len = lenStr ? Number(lenStr) : 1;
    if (!(len > 0)) throw new Error(`bad length in "${tok}"`);
    if (body === '.') last = null;
    else if (body === '-') { if (last) last.l += len; } else {
      last = { m: body.split('+').map(noteToMidi), l: len };
      if (!at.has(s)) at.set(s, []);
      at.get(s).push(last);
    }
    s += len;
  }
  return { len: s, at };
}

/* ========================================================================================
 * Instruments — (kit, midi, durSeconds, velocity) → schedules one note. `poly` caps voices,
 * `rv` is the reverb send. Kept to a handful of nodes each; everything stops after release.
 * ====================================================================================== */

export const INSTRUMENTS = {
  piano: {
    poly: 14, rv: 0.28,
    fn(k, m, dur, v) {
      const f = mtof(m);
      const decay = clamp(3.4 - (m - 40) * 0.05, 0.8, 3.4);
      const off = k.t + Math.max(0.06, dur);
      k.fm({ f, abs: true, ratio: 1, index: 1.1 + 0.9 * v, index1: 0.18, idxDecay: 0.45, shape: 'sus', a: 0.003, peak: 0.15 * v, d: decay, s: 0, off, r: 0.22 });
      k.tone({ type: 'sine', f: f * 2, abs: true, a: 0.002, d: Math.min(0.5, decay * 0.3), peak: 0.035 * v });
      k.noise({ filter: { type: 'lowpass', f: 2600, abs: true }, a: 0.001, d: 0.02, peak: 0.018 * v });
    },
  },
  strings: {
    poly: 10, rv: 0.45,
    fn(k, m, dur, v) {
      const f = mtof(m);
      const off = k.t + dur;
      const bus = k.bus({ filter: { type: 'lowpass', f: Math.min(5000, 650 + 1500 * v + f * 0.6), q: 0.6, abs: true } });
      for (const det of [-9, 0, 8]) k.tone({ type: 'sawtooth', f, abs: true, detune: det, shape: 'sus', a: 0.3, peak: 0.036 * v, d: 0.6, s: 0.85, off, r: 0.75, dest: bus });
    },
  },
  spicc: {
    poly: 8, rv: 0.2,
    fn(k, m, dur, v) {
      const f = mtof(m);
      // static filter on purpose: automated biquads are costly and this voice plays every 16th
      const bus = k.bus({ filter: { type: 'lowpass', f: Math.min(4200, f * 3 + 500), q: 0.8, abs: true } });
      for (const det of [-7, 7]) k.tone({ type: 'sawtooth', f, abs: true, detune: det, a: 0.004, d: Math.max(0.09, Math.min(0.18, dur * 1.2)), peak: 0.07 * v, dest: bus });
    },
  },
  pizz: {
    poly: 6, rv: 0.25,
    fn(k, m, dur, v) {
      k.fm({ f: mtof(m), abs: true, ratio: 1, index: 0.9, index1: 0.05, idxDecay: 0.06, a: 0.002, d: 0.42, peak: 0.24 * v });
    },
  },
  accordion: {
    poly: 8, rv: 0.25,
    fn(k, m, dur, v) {
      const f = mtof(m);
      const off = k.t + dur;
      const bus = k.bus({ filter: { type: 'lowpass', f: 1900, q: 0.9, abs: true } });
      k.tone({ type: 'sawtooth', f, abs: true, detune: -10, shape: 'sus', a: 0.05, peak: 0.04 * v, d: 0.3, s: 0.9, off, r: 0.14, dest: bus });
      k.tone({ type: 'sawtooth', f, abs: true, detune: 10, shape: 'sus', a: 0.05, peak: 0.04 * v, d: 0.3, s: 0.9, off, r: 0.14, dest: bus });
      k.tone({ type: 'triangle', f: f * 2, abs: true, shape: 'sus', a: 0.05, peak: 0.018 * v, d: 0.3, s: 0.8, off, r: 0.12, dest: bus });
    },
  },
  harp: {
    poly: 12, rv: 0.42,
    fn(k, m, dur, v) {
      const f = mtof(m);
      const d = clamp(2.2 - (m - 48) * 0.035, 0.6, 2.2);
      k.fm({ f, abs: true, ratio: 2, index: 1.2, index1: 0.05, idxDecay: 0.1, a: 0.002, d, peak: 0.12 * v });
      k.tone({ type: 'sine', f, abs: true, a: 0.002, d: d * 1.2, peak: 0.05 * v });
    },
  },
  flute: {
    poly: 3, rv: 0.42,
    fn(k, m, dur, v) {
      const f = mtof(m);
      const off = k.t + dur;
      const vib = { rate: 5.2, depth: f * 0.006, delay: 0.16, fade: 0.25, abs: true };
      k.tone({ type: 'sine', f, abs: true, shape: 'sus', a: 0.06, peak: 0.13 * v, d: 0.3, s: 0.85, off, r: 0.14, vib });
      k.tone({ type: 'triangle', f, abs: true, shape: 'sus', a: 0.05, peak: 0.035 * v, d: 0.3, s: 0.7, off, r: 0.12 });
      k.noise({ filter: { type: 'bandpass', f: f * 2, q: 4, abs: true }, shape: 'sus', a: 0.03, peak: 0.03 * v, d: 0.15, s: 0.35, off, r: 0.1 });
    },
  },
  reed: {
    poly: 3, rv: 0.36,
    fn(k, m, dur, v) {
      const f = mtof(m);
      const off = k.t + dur;
      const bus = k.bus({ filter: { type: 'bandpass', f: Math.max(900, f * 2.2), q: 1.1, abs: true }, gain: 1.8 });
      k.tone({ type: 'sawtooth', f, abs: true, shape: 'sus', a: 0.045, peak: 0.06 * v, d: 0.3, s: 0.85, off, r: 0.12, dest: bus, vib: { rate: 5.6, depth: f * 0.005, delay: 0.18, fade: 0.2, abs: true } });
      k.tone({ type: 'sine', f, abs: true, shape: 'sus', a: 0.04, peak: 0.05 * v, d: 0.3, s: 0.8, off, r: 0.12 });
    },
  },
  brass: {
    poly: 10, rv: 0.32,
    fn(k, m, dur, v) {
      const f = mtof(m);
      const off = k.t + dur;
      // two static-filter layers (a warm sustained body + a short bright "blat") instead of a filter
      // sweep: automated biquads recompute coefficients per sample, static ones are nearly free
      const body = k.bus({ filter: { type: 'lowpass', f: Math.min(5000, f * 2.6), q: 1.2, abs: true } });
      const bite = k.bus({ filter: { type: 'lowpass', f: Math.min(8000, f * (4.5 + 3 * v)), q: 0.8, abs: true } });
      for (const det of [-6, 6]) k.tone({ type: 'sawtooth', f, abs: true, detune: det, shape: 'sus', a: 0.04, peak: 0.05 * v, d: 0.4, s: 0.8, off, r: 0.2, dest: body });
      k.tone({ type: 'sawtooth', f, abs: true, a: 0.012, d: 0.16, peak: 0.035 * v * v, dest: bite });
    },
  },
  choir: {
    poly: 10, rv: 0.6,
    fn(k, m, dur, v) {
      const f = mtof(m);
      const off = k.t + dur;
      const out = k.bus({ filter: { type: 'lowpass', f: 3000, abs: true } });
      const f1 = k.bus({ filter: { type: 'bandpass', f: 680, q: 3.5, abs: true }, gain: 2.2, dest: out });
      const f2 = k.bus({ filter: { type: 'bandpass', f: 1120, q: 4.5, abs: true }, gain: 1.3, dest: out });
      const pre = k.ctx.createGain();
      pre.connect(f1);
      pre.connect(f2);
      const vib = { rate: 4.8 + k.rand(0, 0.8), depth: f * 0.005, delay: 0.25, fade: 0.4, abs: true };
      for (const det of [-11, 10]) k.tone({ type: 'sawtooth', f, abs: true, detune: det, shape: 'sus', a: 0.5, peak: 0.05 * v, d: 0.6, s: 0.9, off, r: 0.9, dest: pre, vib });
    },
  },
  bass: {
    poly: 3, rv: 0.05,
    fn(k, m, dur, v) {
      const f = mtof(m);
      const off = k.t + dur;
      k.tone({ type: 'sine', f, abs: true, shape: 'sus', a: 0.005, peak: 0.26 * v, d: 0.5, s: 0.55, off, r: 0.08 });
      k.tone({ type: 'triangle', f: f * 2, abs: true, shape: 'sus', a: 0.004, peak: 0.07 * v, d: 0.15, s: 0.3, off, r: 0.06, filter: { type: 'lowpass', f: 900, abs: true } });
    },
  },
  bell: {
    poly: 6, rv: 0.55,
    fn(k, m, dur, v) {
      const f = mtof(m);
      k.fm({ f, abs: true, ratio: 3.5, index: 2.6, index1: 0.3, idxDecay: 0.9, a: 0.002, d: 3.2, peak: 0.11 * v });
      k.tone({ type: 'sine', f: f * 2, abs: true, a: 0.002, d: 1.6, peak: 0.03 * v });
    },
  },
  glock: {
    poly: 8, rv: 0.45,
    fn(k, m, dur, v) {
      k.metal({ f: mtof(m), abs: true, ratios: [1, 2.76, 5.4], amps: [1, 0.22, 0.07], decays: [1.0, 0.32, 0.14], peak: 0.13 * v, a: 0.001 });
    },
  },
  kick: {
    poly: 3, rv: 0.04,
    fn(k, m, dur, v) {
      k.tone({ type: 'sine', f: 120, f1: 44, glide: 0.08, abs: true, a: 0.001, d: 0.42, peak: 0.5 * v });
      k.click({ f: 2200, ftype: 'lowpass', d: 0.012, peak: 0.06 * v });
    },
  },
  taiko: {
    poly: 4, rv: 0.22,
    fn(k, m, dur, v) {
      k.tone({ type: 'sine', f: 96, f1: 56, glide: 0.12, abs: true, a: 0.001, d: 0.75, peak: 0.46 * v });
      k.noise({ filter: { type: 'lowpass', f: 340, abs: true }, a: 0.001, d: 0.14, peak: 0.26 * v });
      k.click({ f: 1400, ftype: 'lowpass', d: 0.015, peak: 0.08 * v });
    },
  },
  timp: {
    poly: 3, rv: 0.32,
    fn(k, m, dur, v) {
      const f = mtof(m);
      k.tone({ type: 'sine', f: f * 1.02, f1: f, glide: 0.05, abs: true, a: 0.002, d: 1.7, peak: 0.32 * v });
      k.tone({ type: 'sine', f: f * 1.5, abs: true, a: 0.002, d: 0.8, peak: 0.08 * v });
      k.noise({ filter: { type: 'lowpass', f: 520, abs: true }, a: 0.001, d: 0.14, peak: 0.16 * v });
    },
  },
  snare: {
    poly: 3, rv: 0.16,
    fn(k, m, dur, v) {
      k.noise({ filter: { type: 'bandpass', f: 1900, q: 0.7, abs: true }, a: 0.001, d: 0.17, peak: 0.16 * v });
      k.tone({ type: 'triangle', f: 195, f1: 160, glide: 0.04, abs: true, a: 0.001, d: 0.08, peak: 0.12 * v });
    },
  },
  hat: {
    poly: 3, rv: 0.05,
    fn(k, m, dur, v) { k.noise({ filter: { type: 'highpass', f: 7600, abs: true }, a: 0.0008, d: 0.035, peak: 0.06 * v }); },
  },
  shaker: {
    poly: 3, rv: 0.1,
    fn(k, m, dur, v) { k.noise({ filter: { type: 'bandpass', f: 5600, q: 1.4, abs: true }, a: 0.012, d: 0.07, peak: 0.07 * v }); },
  },
  tick: {
    poly: 3, rv: 0.22,
    fn(k, m, dur, v) {
      k.noise({ filter: { type: 'bandpass', f: 3900, q: 9, abs: true }, a: 0.0005, d: 0.02, peak: 0.26 * v });
      k.tone({ type: 'sine', f: 2450, abs: true, a: 0.0005, d: 0.012, peak: 0.04 * v });
    },
  },
  tock: {
    poly: 3, rv: 0.22,
    fn(k, m, dur, v) {
      k.noise({ filter: { type: 'bandpass', f: 1250, q: 7, abs: true }, a: 0.0005, d: 0.035, peak: 0.26 * v });
      k.tone({ type: 'sine', f: 880, abs: true, a: 0.0005, d: 0.025, peak: 0.05 * v });
    },
  },
  cymbal: {
    poly: 2, rv: 0.4,
    fn(k, m, dur, v) {
      k.noise({ filter: { type: 'highpass', f: 5200, abs: true }, a: 0.002, d: 1.7, peak: 0.07 * v });
      k.noise({ filter: { type: 'bandpass', f: 9000, q: 1, abs: true }, a: 0.002, d: 1.2, peak: 0.035 * v });
    },
  },
  waves: {
    poly: 3, rv: 0.3,
    fn(k, m, dur, v) {
      const pan = k.rand(-0.5, 0.5);
      k.noise({ filter: { type: 'lowpass', f: 320, f1: 1300, glide: dur * 0.42, f2: 380, glide2: dur * 0.5, q: 0.4, abs: true }, shape: 'pts', points: [[0, 0], [dur * 0.42, 0.13 * v], [dur, 0]], pan, panTo: -pan });
      k.noise({ filter: { type: 'highpass', f: 3200, abs: true }, shape: 'pts', points: [[0, 0], [dur * 0.4, 0], [dur * 0.5, 0.03 * v], [dur * 0.9, 0]], pan: -pan * 0.5 });
    },
  },
  wind: {
    poly: 2, rv: 0.45,
    fn(k, m, dur, v) {
      k.noise({ filter: { type: 'bandpass', f: 500, f1: 950, glide: dur * 0.5, f2: 420, glide2: dur * 0.5, q: 3, abs: true }, shape: 'pts', points: [[0, 0], [dur * 0.5, 0.09 * v], [dur, 0]], pan: k.rand(-0.6, 0.6), panTo: k.rand(-0.6, 0.6) });
    },
  },
  rise: {
    poly: 2, rv: 0.45,
    fn(k, m, dur, v) { k.noise({ filter: { type: 'highpass', f: 1800, f1: 7000, glide: dur, abs: true }, shape: 'swell', a: dur, d: 0.05, peak: 0.08 * v }); },
  },
};

/* ========================================================================================
 * Tracks. Each track: { bpm, beats (per bar), sub (steps per beat), chords (one symbol per bar,
 * "X,Y" splits a bar), loop, gain, tail, step(s, P) }. The player calls step() once per step with
 * s = { abs, bar, step, beat, sub, spb, sd, bd, barDur, chord, loop, time } and P = the player
 * (P.note / P.chord / P.melody / P.drum). Tonal palette: minor-key Belle-Époque harmony,
 * waltzes for exploration, driving 4/4 for battle; the ending reprises the title theme in major.
 * ====================================================================================== */

/** Waltz "oom-pah-pah": bass on beat 1, short chord on beats 2 and 3 (sub = 2). */
function waltz(s, P, inst, { bassOct = 2, lo = 55, n = 3, vel = 0.6 } = {}) {
  if (s.step === 0) P.note(inst, bassOf(s.chord, bassOct), s.bd * 2.1, vel);
  if (s.step === 2 || s.step === 4) P.chord(inst, voicing(s.chord, lo, n), s.bd * 0.75, vel * 0.55);
}
/** Sustained chord pad at the start of each bar. */
function pad(s, P, inst, { lo = 52, n = 3, vel = 0.4, bars = 1 } = {}) {
  if (s.step === 0 && s.bar % bars === 0) P.chord(inst, voicing(s.chord, lo, n), s.barDur * bars * 0.98, vel);
}

const TITLE_MEL = parseSeq(`
  a4:3 b4 c5:2 | b4:2 a4:2 e4:2 | f4:3 e4 d4:2 | g#4:4 e4:2 |
  a4:3 b4 c5:2 | d5:2 c5:2 a4:2 | b4:2 a4:2 f4:2 | e4:6 |
  a4:3 g4 f4:2 | g4:3 f4 e4:2 | e4:2 g4:2 c5:2 | b4:3 a4 e4:2 |
  d4:2 f4:2 a4:2 | c5:2 b4:2 a4:2 | g#4:2 b4:2 d5:2 | c5:3 b4 a4:2`);

const ENDING_MEL = parseSeq(`
  a4:3 bb4 c5:2 | c5:2 bb4:2 g4:2 | a4:3 g4 f4:2 | d5:4 bb4:2 |
  c5:3 d5 c5:2 | bb4:2 a4:2 g4:2 | e4:2 g4:2 bb4:2 | a4:6 |
  d5:3 c5 bb4:2 | c5:3 bb4 g4:2 | a4:2 c5:2 e5:2 | f5:3 e5 d5:2 |
  bb4:2 d5:2 f5:2 | a5:2 g5:2 f5:2 | bb4:2 c5:2 e5:2 | f5:6`);

const SHORE_MEL = parseSeq(`
  .:24 | a4:2 d5:2 e5:2 | c5:4 a4:2 | d5:2 f5:2 a5:2 | e5:4 c#5:2 |
  .:24 | d5:2 f5:2 d5:2 | c5:4 a4:2 | bb4:2 d5:2 f5:2 | e5:6`);

const THICKET_MEL = parseSeq(`
  b4:4 e5:2 f#5:2 g5:6 f#5:2 | e5:8 .:4 b4:2 c5:2 | d5:4 b4:2 d5:2 g5:6 a5:2 | f#5:12 .:4 |
  e5:4 c5:2 e5:2 a5:6 g5:2 | g5:4 f#5:2 e5:2 b4:8 | c5:4 e5:4 g5:4 b5:4 | a5:6 f#5:2 d#5:8 |
  g5:4 f#5:2 e5:2 b5:6 a5:2 | g5:8 e5:4 .:4 | d5:2 e5:2 g5:4 b5:4 a5:4 | a5:8 f#5:8 |
  c6:4 b5:2 a5:2 e5:6 g5:2 | f#5:4 e5:4 b4:8 | c5:2 d5:2 e5:4 g5:4 f#5:4 | f#5:4 b4:4 d#5:8`);

const TRAINING_MEL = parseSeq(`
  e5:2 g5:2 c6:4 b5:2 g5:2 e5:4 | a5:4 e5:2 c5:2 e5:8 | f5:2 a5:2 c6:4 a5:2 f5:2 a5:4 | g5:6 f5:2 e5:2 d5:2 b4:4 |
  e5:2 g5:2 c6:4 d6:2 c6:2 g5:4 | b5:4 g5:2 e5:2 g5:8 | a5:2 g5:2 f5:2 e5:2 d5:4 f5:4 | d5:4 b4:4 g4:4 .:4`);

const BATTLE_LEAD = parseSeq(`
  .:64 |
  d5:6 e5:2 f5:4 a5:4 | bb5:6 a5:2 g5:4 f5:4 | g5:6 a5:2 bb5:4 d6:4 | c#6:8 a5:4 e5:4 |
  .:64 |
  g5:6 f5:2 d5:4 g5:4 | f5:6 e5:2 d5:4 f5:4 | e5:6 f5:2 g5:4 a5:4 | c#6:4 e6:4 a5:8`);
const BATTLE_COUNTER = parseSeq(`
  .:128 | d5:8 f5:8 | e5:8 g5:8 | a5:12 f5:4 | d5:16 | .:64`);

const BOSS_LEAD = parseSeq(`
  .:128 |
  c5:8 bb4:4 ab4:4 | bb4:8 d5:4 f5:4 | g5:12 f5:2 eb5:2 | bb4:16 |
  ab5:8 g5:4 f5:4 | eb5:8 f5:4 ab5:4 | g5:8 d5:4 b4:4 | f5:8 d5:4 b4:4`);

const FINAL_CHOIR = parseSeq(`
  .:128 | f4:8 ab4:8 | g4:8 bb4:8 | c5:16 | eb5:8 c5:8 | db5:8 f5:8 | ab4:16 | g4:8 bb4:8 | c5:16 | .:256`);
const FINAL_LEAD = parseSeq(`
  .:256 |
  c5:6 eb5:2 ab5:8 | g5:6 f5:2 eb5:8 | f5:6 g5:2 ab5:4 c6:4 | bb5:12 ab5:4 |
  c6:6 bb5:2 ab5:8 | g5:6 ab5:2 bb5:8 | f5:4 ab5:4 db6:8 | bb5:8 g5:8 |
  ab5:6 g5:2 f5:8 | f5:6 eb5:2 db5:8 | eb5:6 f5:2 ab5:4 c6:4 | bb5:16 |
  db6:6 c6:2 bb5:8 | ab5:6 bb5:2 f5:8 | g5:6 ab5:2 bb5:8 | c6:4 e5:4 g5:4 c6:4`);

const VICTORY_MEL = parseSeq(`
  d5 . d5 d5 a5:4 f#5:4 a5:4 | b5:4 a5:2 g5:2 f#5:2 e5:2 f#5:4 | d5+f#5+a5+d6:16`);
const GAMEOVER_MEL = parseSeq(`e5:2 d5:2 c5:2 | b4:3 a4 f4:2 | e4:2 g#4:2 b4:2 | a4:6`);

/** Battle-style drum groove on 16ths (sub = 4). `heavy` adds taiko weight. */
function groove(s, P, { heavy = false, vel = 1 } = {}) {
  const kicks = heavy ? { 0: 1, 3: 0.5, 6: 0.7, 8: 0.95, 10: 0.45, 11: 0.6, 14: 0.8 } : { 0: 1, 6: 0.6, 8: 0.9, 11: 0.5, 14: 0.55 };
  if (kicks[s.step]) P.drum(heavy ? 'taiko' : 'kick', kicks[s.step] * vel);
  if (heavy && (s.step === 0 || s.step === 8)) P.drum('kick', 0.8 * vel);
  if (heavy ? s.step === 12 : s.step === 4 || s.step === 12) P.drum('snare', 0.6 * vel);
  if (s.step % 2 === 0) P.drum('hat', (s.step % 4 === 2 ? 0.55 : 0.3) * vel);
}
/** 16th-note string ostinato (root / octave / fifth figure) — the engine of the battle tracks. */
function ostinato(s, P, { oct = 3, vel = 0.6, figure = [0, 12, 'f', 12] } = {}) {
  const r = rootOf(s.chord, oct);
  const x = figure[s.step % figure.length];
  const m = x === 'f' ? r + degree(s.chord, 2) : x === 't' ? r + degree(s.chord, 1) : r + x;
  P.note('spicc', m, s.sd * 0.9, (s.step % 4 === 0 ? 1 : 0.62) * vel);
}

export const TRACK_DEFS = {
  title: {
    bpm: 84, beats: 3, sub: 2, loop: true, gain: 0.95,
    chords: 'Am Am/G Dm/F E7 Am F Bm7b5 E7 F G C Am Dm Am/E E7 Am',
    step(s, P) {
      waltz(s, P, 'piano', { vel: 0.62 });
      pad(s, P, 'strings', { lo: 52, n: 3, vel: 0.3 + (s.loop % 2) * 0.15 });
      if (s.loop % 2) P.melody(TITLE_MEL, s, 'flute', 0.7, { transpose: 12 });
      else P.melody(TITLE_MEL, s, 'piano', 0.78, { transpose: 12, legato: 1.3 });
    },
  },
  shore: {
    bpm: 72, beats: 3, sub: 2, loop: true, gain: 1.05,
    chords: 'Dm C Bb C Dm Am Bbmaj7 A7 Dm F Gm C Bb F/A Gm7 A7',
    step(s, P) {
      pad(s, P, 'accordion', { lo: 57, n: 3, vel: 0.5 });
      if (s.step === 0) P.note('bass', bassOf(s.chord, 2), s.bd * 1.6, 0.45);
      if (s.step === 4) P.note('bass', rootOf(s.chord, 2) + degree(s.chord, 2), s.bd * 0.8, 0.3);
      const tones = voicing(s.chord, 50, 4);
      P.note('harp', tones[[0, 1, 2, 3, 2, 1][s.step]], s.sd * 2, s.step === 0 ? 0.42 : 0.3);
      if (s.step === 0 && s.bar % 2 === 0) P.note('waves', 0, s.barDur * 2.2, 0.9);
      P.melody(SHORE_MEL, s, s.loop % 2 ? 'accordion' : 'flute', s.loop % 2 ? 0.55 : 0.62, { transpose: s.loop % 2 ? 0 : 12 });
    },
  },
  thicket: {
    bpm: 92, beats: 4, sub: 4, loop: true, gain: 1.55,
    chords: 'Em9 Cmaj7 G D/F# Am7 Em/G Cmaj7 B7 Em9 Cmaj7 G D/F# Am7 Em/G Cmaj7 B7',
    step(s, P) {
      if (s.step % 2 === 0) {
        const tones = voicing(s.chord, 52, 5);
        P.note('harp', tones[[0, 2, 1, 3, 2, 4, 3, 1][s.step / 2]], s.sd * 4, s.step % 4 === 0 ? 0.36 : 0.26);
      }
      if (s.step === 0 || s.step === 8) P.note('pizz', s.step === 0 ? bassOf(s.chord, 2) : rootOf(s.chord, 2) + degree(s.chord, 2), s.bd, 0.55);
      pad(s, P, 'strings', { lo: 55, n: 3, vel: 0.22 });
      if (s.step === 4 || s.step === 12) P.drum('shaker', 0.35);
      P.melody(THICKET_MEL, s, s.bar < 8 ? 'reed' : 'flute', 0.62, { legato: 0.92 });
    },
  },
  spire: {
    bpm: 104, beats: 4, sub: 4, loop: true, gain: 2.1,
    chords: 'Cm Ab Fm G Cm Eb Ab G7 Fm Cm/Eb Db G Ab Fm G G7',
    step(s, P) {
      if (s.step % 4 === 0) P.drum('tick', s.step === 0 ? 0.6 : 0.45);
      else if (s.step % 4 === 2) P.drum('tock', 0.38);
      if (s.step === 0 || s.step === 8) P.chord('brass', voicing(s.chord, 53, 3), s.bd * 1.8, 0.38);
      if (s.step % 4 === 0) {
        const r = rootOf(s.chord, 2);
        P.note('pizz', [r, r + degree(s.chord, 2), r + 12, r + degree(s.chord, 2)][s.step / 4], s.bd * 0.9, 0.55);
      }
      if (s.bar % 2 === 1 && [0, 3, 6, 10].includes(s.step)) {
        const tones = voicing(s.chord, 72, 4);
        P.note('glock', tones[[0, 2, 1, 3][[0, 3, 6, 10].indexOf(s.step)]], s.sd * 2, 0.3);
      }
      if (s.step === 0 && s.bar % 4 === 0) P.note('bell', rootOf(s.chord, 3), 3, 0.35);
    },
  },
  summit: {
    bpm: 56, beats: 4, sub: 2, loop: true, gain: 1.9,
    chords: 'Cm Db Cm Bbm Ab Db Gsus4 G',
    step(s, P) {
      pad(s, P, 'choir', { lo: 55, n: 4, vel: 0.5 });
      if (s.step === 0) P.note('strings', rootOf(s.chord, 1) + 12, s.barDur * 1.02, 0.55);
      if (s.step === 0 && s.bar % 2 === 0) { P.note('bell', rootOf(s.chord, 2) + 12, 4, 0.45); P.note('wind', 0, s.barDur * 2, 0.8); }
      if (s.step === 4 && s.bar % 2 === 1) P.drum('timp', 0.4, 0, rootOf(s.chord, 2));
      const h = ((s.abs * 2654435761) >>> 0) / 4294967296;
      if (h < 0.14 && s.step % 2 === 1) P.note('glock', voicing(s.chord, 84, 3)[Math.floor(h * 21) % 3], s.sd, 0.16);
    },
  },
  battle: {
    bpm: 150, beats: 4, sub: 4, loop: true, gain: 0.8,
    chords: 'Dm Bb C A Dm Bb Gm A Bb C Dm Dm Gm Bb A A',
    step(s, P) {
      ostinato(s, P, { oct: 3, vel: 0.55 });
      if (s.step % 2 === 0) {
        const r = rootOf(s.chord, 1);
        P.note('bass', [r, r, r + 12, r, r, r + 12, r, r + 10][s.step / 2], s.sd * 1.6, 0.6);
      }
      groove(s, P);
      if (s.step === 0 && s.bar % 8 === 0) P.drum('cymbal', 0.6);
      if (s.step === 0 && s.bar % 2 === 0) P.drum('taiko', 0.55);
      if (s.step === 0) P.chord('brass', voicing(s.chord, 57, 3), s.sd * 3, 0.5);
      if (s.step === 10) P.chord('brass', voicing(s.chord, 57, 3), s.sd * 2, 0.36);
      if (s.bar >= 8 && s.bar < 12) pad(s, P, 'strings', { lo: 50, n: 3, vel: 0.3 });
      P.melody(BATTLE_LEAD, s, 'brass', 0.72);
      P.melody(BATTLE_COUNTER, s, 'strings', 0.62);
    },
  },
  boss: {
    bpm: 132, beats: 4, sub: 4, loop: true, gain: 0.72,
    chords: 'Cm Cm Ab Bb Cm Cm Fm G Ab Bb Cm Eb Fm Ab G G7',
    step(s, P) {
      pad(s, P, 'choir', { lo: 55, n: 4, vel: 0.52 });
      if (s.step % 2 === 0) ostinato({ ...s, step: s.step / 2 }, P, { oct: 2, vel: 0.62, figure: [0, 12, 0, 12, 'f', 12, 't', 'f'] });
      groove(s, P, { heavy: true, vel: 0.95 });
      if (s.step === 0 && s.bar % 4 === 0) P.drum('timp', 0.8, 0, rootOf(s.chord, 2));
      if (s.step === 0 && s.bar % 8 === 0) P.drum('cymbal', 0.6);
      if (s.step === 0 || s.step === 6) P.chord('brass', voicing(s.chord, 48, 3), s.sd * 3, 0.5);
      P.melody(BOSS_LEAD, s, 'brass', 0.7);
      P.melody(BOSS_LEAD, s, 'choir', 0.45, { transpose: -12 });
    },
  },
  final: {
    bpm: 140, beats: 4, sub: 4, loop: true, gain: 1.0,
    chords: 'Fm Fm Db Eb Fm Fm Bbm C Db Eb Fm Ab Bbm Db C C7 ' +
      'Ab Eb Fm Db Ab Eb Db Eb Fm Db Ab Eb Bbm Db Eb C',
    step(s, P) {
      const B = s.bar >= 16;
      const build = B ? 1 : 0.45 + (s.bar / 16) * 0.45;
      pad(s, P, 'choir', { lo: B ? 60 : 53, n: 4, vel: 0.5 });
      if (B) pad(s, P, 'strings', { lo: 48, n: 3, vel: 0.35 });
      ostinato(s, P, { oct: 2, vel: 0.6 * build, figure: B ? [0, 12, 'f', 12] : [0, 12, 0, 'f'] });
      if (B) groove(s, P, { heavy: s.bar % 4 === 3, vel: 1 });
      else if (s.step === 0 || s.step === 8 || (s.bar >= 8 && (s.step === 6 || s.step === 14))) P.drum('taiko', (s.step === 0 ? 0.9 : 0.6) * build);
      if (s.step === 0 && s.bar % 4 === 0) P.drum('timp', 0.8, 0, rootOf(s.chord, 2));
      if (s.step === 0 && (s.bar === 0 || s.bar === 16 || s.bar === 24)) P.drum('cymbal', 0.8);
      if (s.bar === 15 && s.step === 0) P.note('rise', 0, s.barDur, 1);
      if (B && (s.step === 0 || s.step === 10)) P.chord('brass', voicing(s.chord, 55, 3), s.sd * (s.step ? 2 : 3), 0.45);
      P.melody(FINAL_CHOIR, s, 'choir', 0.8);
      P.melody(FINAL_LEAD, s, 'brass', 0.78);
      P.melody(FINAL_LEAD, s, 'strings', 0.5, { transpose: -12 });
    },
  },
  training: {
    bpm: 110, beats: 4, sub: 4, loop: true, gain: 1.35,
    chords: 'C Am F G C Em F G7',
    step(s, P) {
      if (s.step % 4 === 0) {
        const r = rootOf(s.chord, 2);
        P.note('pizz', [r, r + degree(s.chord, 2), r + 12, r + degree(s.chord, 2)][s.step / 4], s.bd * 0.8, 0.6);
      }
      if (s.step % 4 === 2) P.chord('harp', voicing(s.chord, 60, 3), s.bd, 0.26);
      if (s.step % 2 === 0) P.drum('shaker', s.step % 4 === 2 ? 0.45 : 0.25);
      if (s.step === 0 || s.step === 8) P.drum('kick', 0.32);
      if (s.step === 4 || s.step === 12) P.drum('tock', 0.4);
      P.melody(TRAINING_MEL, s, 'glock', 0.62);
      if (s.loop % 2) P.melody(TRAINING_MEL, s, 'flute', 0.4, { transpose: -12 });
    },
  },
  victory: {
    bpm: 132, beats: 4, sub: 4, loop: false, gain: 1.25, tail: 2.8,
    chords: 'D G,A D',
    step(s, P) {
      P.melody(VICTORY_MEL, s, 'brass', 0.85);
      if (s.bar < 2 && s.step % 4 === 0) P.drum('timp', s.step === 0 ? 0.8 : 0.45, 0, rootOf(s.chord, 2));
      if (s.bar === 1 && s.step === 14) { P.drum('snare', 0.5); P.drum('snare', 0.6, s.sd / 2); }
      if (s.step === 0 && s.bar === 0) P.chord('brass', voicing(s.chord, 50, 3), s.barDur * 0.95, 0.4);
      if (s.bar === 1 && (s.step === 0 || s.step === 8)) P.chord('brass', voicing(s.chord, 50, 3), s.barDur * 0.47, 0.4);
      if (s.bar === 2 && s.step === 0) {
        P.drum('timp', 1, 0, rootOf(s.chord, 2));
        P.drum('cymbal', 0.9);
        P.chord('strings', voicing(s.chord, 50, 4), s.barDur, 0.55);
        P.note('bass', rootOf(s.chord, 1), s.barDur, 0.6);
        [0, 1, 2, 3].forEach((i) => P.note('glock', voicing(s.chord, 86, 4)[i], 0.5, 0.35, i * s.sd));
      }
    },
  },
  gameover: {
    bpm: 76, beats: 3, sub: 2, loop: false, gain: 1.45, tail: 3.2,
    chords: 'Am Dm/F E7 Am',
    step(s, P) {
      pad(s, P, 'strings', { lo: 52, n: 3, vel: 0.42 });
      if (s.step === 0) P.note('piano', bassOf(s.chord, 2), s.barDur, 0.5);
      if (s.step === 2 && s.bar < 3) P.chord('piano', voicing(s.chord, 57, 3), s.bd * 1.6, 0.3);
      P.melody(GAMEOVER_MEL, s, 'piano', 0.7, { transpose: 0, legato: 1.25 });
      if (s.bar === 3 && s.step === 0) P.note('bell', 57, 4, 0.3);
    },
  },
  ending: {
    bpm: 80, beats: 3, sub: 2, loop: true, gain: 0.95,
    chords: 'F C/E Dm Bb F/A Gm7 C7 F Bb C Am Dm Gm7 F/C C7 F',
    step(s, P) {
      waltz(s, P, 'piano', { vel: 0.55, lo: 57 });
      pad(s, P, 'strings', { lo: 53, n: 3, vel: 0.36 });
      if (s.loop % 2) {
        const tones = voicing(s.chord, 60, 4);
        P.note('harp', tones[[0, 1, 2, 3, 2, 1][s.step]], s.sd * 2, 0.24);
        P.melody(ENDING_MEL, s, 'piano', 0.75, { transpose: 12, legato: 1.3 });
      } else P.melody(ENDING_MEL, s, 'flute', 0.72);
      if (s.step === 0 && s.bar === 0) P.note('bell', 77, 4, 0.25);
    },
  },
};

/* ========================================================================================
 * MusicPlayer — look-ahead step sequencer (setInterval ~25 ms, scheduling ~120 ms ahead on the
 * AudioContext clock). Works live (timer) or offline (call scheduleUntil() directly).
 * ====================================================================================== */

const LOOKAHEAD = 0.12;
const TICK_MS = 25;

export class MusicPlayer {
  /**
   * @param {BaseAudioContext} ctx
   * @param {AudioNode} dest dry destination
   * @param {object} def a TRACK_DEFS entry
   * @param {{loop?:boolean, verbIn?:AudioNode|null, seed?:number, onEnd?:() => void}} [opts]
   */
  constructor(ctx, dest, def, opts = {}) {
    this.ctx = ctx;
    this.def = def;
    this.loop = opts.loop ?? def.loop !== false;
    this.onEnd = opts.onEnd || null;
    this.rng = makeRng(opts.seed ?? 0x1234);
    this.spb = def.beats * def.sub;
    this.bd = 60 / def.bpm;
    this.sd = this.bd / def.sub;
    this.barDur = this.bd * def.beats;
    this.bars = def.chords.trim().split(/\s+/).map((tok) => tok.split(',').map(parseChord));
    this.totalSteps = this.bars.length * this.spb;
    this.out = ctx.createGain();
    this.out.connect(dest);
    this.bus = ctx.createGain();
    this.bus.gain.value = finite(def.gain, 1);
    this.bus.connect(this.out);
    this.verbOut = ctx.createGain();
    if (opts.verbIn) this.verbOut.connect(opts.verbIn);
    this.sends = {};
    this.voices = {};
    this.abs = 0;
    this.nextTime = 0;
    this._cur = 0;
    this.timer = null;
    this.done = false;
    this.ended = false;
    this.endAt = Infinity;
    this.noteCount = 0;
    this.nodeCount = 0;
    this.live = [];   // sounding notes { end, g } — disconnected by gc() once released
  }

  /** Starts sequencing at context time `when`; `timer:false` for offline rendering. */
  start(when, { timer = true } = {}) {
    this.nextTime = when;
    this.abs = 0;
    if (timer && typeof setInterval === 'function') {
      this.timer = setInterval(() => this.tick(), TICK_MS);
      this.tick();
    }
  }

  /** Timer callback: schedules ahead, skips (never bursts) if the tab stalled, fires onEnd for one-shots. */
  tick() {
    try {
      const now = this.ctx.currentTime;
      if (!this.done && this.nextTime < now - 0.05) {
        const skip = Math.ceil((now - this.nextTime) / this.sd);
        this.abs += skip;
        this.nextTime += skip * this.sd;
        if (!this.loop && this.abs >= this.totalSteps) this._finish();
      }
      this.scheduleUntil(now + LOOKAHEAD);
      this.gc(now);
      if (this.done && !this.ended && now >= this.endAt) {
        this.ended = true;
        this._clearTimer();
        if (this.onEnd) this.onEnd();
      }
    } catch (err) {
      warnOnce(`music scheduler error: ${err && err.message}`);
      this._clearTimer();
    }
  }

  /** Schedules every step whose start time is before `t`. */
  scheduleUntil(t) {
    while (!this.done && this.nextTime < t) {
      this._step();
      this.abs++;
      this.nextTime += this.sd;
      if (!this.loop && this.abs >= this.totalSteps) this._finish();
    }
  }

  /**
   * Disconnects notes whose release has finished so the render graph stays small (finished voices
   * would otherwise stay connected and be pulled every render quantum until a lazy GC).
   */
  gc(now) {
    if (!this.live.length || this.live[0].end + 0.05 >= now) return;
    const keep = [];
    for (const n of this.live) {
      if (n.end + 0.05 < now) { try { n.g.disconnect(); } catch { /* gone */ } } else keep.push(n);
    }
    this.live = keep;
  }

  _finish() {
    this.done = true;
    this.endAt = this.nextTime + finite(this.def.tail, 2.5);
  }

  _step() {
    const { spb, abs } = this;
    const n = this.bars.length;
    const barAbs = Math.floor(abs / spb);
    const bar = barAbs % n;
    const step = abs % spb;
    const inBar = this.bars[bar];
    const chord = inBar[Math.min(inBar.length - 1, Math.floor((step * inBar.length) / spb))];
    this._cur = this.nextTime;
    this.def.step({
      abs, bar, step, beat: Math.floor(step / this.def.sub), sub: step % this.def.sub, spb,
      sd: this.sd, bd: this.bd, barDur: this.barDur, chord, loop: Math.floor(barAbs / n), time: this.nextTime,
    }, this);
  }

  _send(inst, amount) {
    let s = this.sends[inst];
    if (!s) {
      s = this.ctx.createGain();
      s.gain.value = amount;
      s.connect(this.verbOut);
      this.sends[inst] = s;
    }
    return s;
  }

  /**
   * Plays one note. `at` offsets from the current step time (seconds).
   * @param {string} inst key of INSTRUMENTS
   * @param {number} midi
   * @param {number} dur seconds (note-off for sustained instruments)
   * @param {number} [vel=0.7] 0..1
   * @param {number} [at=0]
   */
  note(inst, midi, dur, vel = 0.7, at = 0) {
    const I = INSTRUMENTS[inst];
    if (!I) { warnOnce(`unknown instrument "${inst}"`); return; }
    if (!Number.isFinite(midi)) return;
    const ctx = this.ctx;
    const t = Math.max(ctx.currentTime, this._cur + at + (this.rng() - 0.5) * 0.006);
    const v = clamp(vel * (0.94 + this.rng() * 0.12), 0, 1.2);
    const list = this.voices[inst] || (this.voices[inst] = []);
    for (let i = list.length - 1; i >= 0; i--) if (list[i].end < t) list.splice(i, 1);
    while (list.length >= I.poly) {
      const old = list.shift();
      old.g.gain.cancelScheduledValues(t);
      old.g.gain.setTargetAtTime(0, t, 0.015);
    }
    const g = ctx.createGain();
    g.connect(this.bus);
    if (I.rv) g.connect(this._send(inst, I.rv));
    const k = new Kit(ctx, g, t, { rng: this.rng });
    I.fn(k, midi, Math.max(0.03, dur), v);
    const rec = { end: k.end, g };
    list.push(rec);
    this.live.push(rec);
    this.noteCount++;
    this.nodeCount += k.nodes + 1;
  }

  /** Plays several notes together; velocity is normalised by chord size. */
  chord(inst, midis, dur, vel = 0.6, at = 0) {
    const scale = midis.length > 1 ? 1.4 / Math.sqrt(midis.length) : 1;
    for (const m of midis) this.note(inst, m, dur, vel * Math.min(1, scale), at);
  }

  /** Plays the notes of a parsed sequence that start on this step (sequence loops over its length). */
  melody(seq, s, inst, vel = 0.7, { transpose = 0, legato = 0.95 } = {}) {
    const evs = seq.at.get(s.abs % seq.len);
    if (!evs) return;
    for (const e of evs) {
      const scale = e.m.length > 1 ? Math.min(1, 1.4 / Math.sqrt(e.m.length)) : 1;
      for (const m of e.m) this.note(inst, m + transpose, e.l * this.sd * legato, vel * scale);
    }
  }

  /** Percussion shorthand. */
  drum(inst, vel = 0.8, at = 0, midi = 60) { this.note(inst, midi, 0.1, vel, at); }

  /**
   * Crossfade helper: ramps this player's dry and wet outputs to `value` over `secs`, starting from
   * `from` (defaults to the current computed gain — pass it explicitly for a fresh player).
   */
  fadeTo(value, when, secs, from) {
    for (const g of [this.out.gain, this.verbOut.gain]) {
      g.cancelScheduledValues(when);
      g.setValueAtTime(from === undefined ? g.value : from, when);
      if (secs > 0.001) g.linearRampToValueAtTime(value, when + secs); else g.setValueAtTime(value, when);
    }
  }

  /** Stops scheduling and releases sounding voices from `when`. */
  stop(when = this.ctx.currentTime) {
    this._clearTimer();
    this.done = true;
    this.ended = true;
    for (const list of Object.values(this.voices)) {
      for (const v of list) { v.g.gain.cancelScheduledValues(when); v.g.gain.setTargetAtTime(0, when, 0.08); }
    }
  }

  /** Detaches the player's output nodes (call after the fade-out finished). */
  disconnect() {
    this._clearTimer();
    for (const n of [this.out, this.verbOut, this.bus, ...Object.values(this.sends)]) { try { n.disconnect(); } catch { /* gone */ } }
  }

  _clearTimer() {
    if (this.timer !== null) { clearInterval(this.timer); this.timer = null; }
  }
}

/* ========================================================================================
 * Audio — the game-facing facade (SPEC §4.4).
 * ====================================================================================== */

const MAX_VOICES = 32;
const MAX_PER_NAME = 4;
const DEDUPE_S = 0.03;
const MUSIC_TRIM = 0.75;
/** Slider value (0..1) → gain; squared for a perceptually even slider. */
const volCurve = (v) => { const x = clamp(finite(v, 0), 0, 1); return x * x; };
/** Wall-clock seconds. Used for dedupe / voice bookkeeping because some devices update
 *  AudioContext.currentTime in coarse output-buffer-sized steps. */
const wallNow = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()) / 1000;

export class Audio {
  /**
   * Creates the facade. The AudioContext itself is created lazily on the first user gesture
   * (unlock), so no autoplay warnings are raised. Safe without WebAudio: every method no-ops.
   */
  constructor() {
    this._ok = !!audioContextCtor();
    this._ctx = null;
    this._unlocked = false;
    this._userSuspended = false;
    this._vol = { master: 0.8, sfx: 0.9, music: 0.55 };
    this._music = null;      // { name, player }
    this._pending = null;    // { track, opts } requested before unlock
    this._voices = [];
    this._lastPlay = new Map();
    this._gesture = null;
    this._resumeAt = -Infinity;
    if (this._ok && typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      this._gesture = () => this.unlock();
      for (const ev of ['pointerdown', 'keydown', 'touchend', 'mousedown']) window.addEventListener(ev, this._gesture, { capture: true, passive: true });
    }
  }

  /** True when WebAudio exists (sound can play once unlocked). */
  get available() { return this._ok; }
  /** True once a user gesture unlocked the context. */
  get unlocked() { return this._unlocked; }
  /** The live AudioContext (null before unlock / without WebAudio). */
  get context() { return this._ctx; }
  /** Name of the playing (or requested-before-unlock) track, or null. */
  get currentTrack() { return this._music ? this._music.name : this._pending ? this._pending.track : null; }

  _init() {
    if (this._ctx || !this._ok) return this._ctx;
    try {
      const C = audioContextCtor();
      let ctx;
      try { ctx = new C({ latencyHint: 'interactive' }); } catch { ctx = new C(); }
      const master = ctx.createGain();
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -8;
      limiter.knee.value = 6;
      limiter.ratio.value = 10;
      limiter.attack.value = 0.002;
      limiter.release.value = 0.18;
      master.connect(limiter);
      limiter.connect(ctx.destination);
      const sfxBus = ctx.createGain();
      sfxBus.connect(master);
      const duck = ctx.createGain();
      duck.connect(master);
      const musicBus = ctx.createGain();
      musicBus.connect(duck);
      const sfxVerb = createReverb(ctx, { time: 1.7, damp: 5200, wet: 0.9 });
      sfxVerb.output.connect(sfxBus);
      const musicVerb = createReverb(ctx, { time: 2.6, damp: 4200, wet: 0.8, size: 1.15 });
      musicVerb.output.connect(musicBus);
      this._ctx = ctx;
      this._n = { master, limiter, sfxBus, musicBus, duck, sfxVerb, musicVerb };
      this._applyVolumes(0);
      if (typeof ctx.addEventListener === 'function') {
        ctx.addEventListener('statechange', () => { if (ctx.state === 'running') this._dropGestureListeners(); });
      }
    } catch (err) {
      this._ok = false;
      this._ctx = null;
      warnOnce(`WebAudio unavailable (${err && err.message}); audio disabled`);
    }
    return this._ctx;
  }

  _dropGestureListeners() {
    if (!this._gesture || typeof window === 'undefined') return;
    for (const ev of ['pointerdown', 'keydown', 'touchend', 'mousedown']) window.removeEventListener(ev, this._gesture, { capture: true });
    this._gesture = null;
  }

  /** Resumes/creates the context from inside a user gesture. Idempotent; starts any pending music. */
  unlock() {
    if (!this._ok) return;
    const ctx = this._init();
    if (!ctx) return;
    this._unlocked = true;
    this._resumeAt = wallNow();
    if (ctx.state !== 'running' && !this._userSuspended) {
      try {
        // iOS needs a sound started inside the gesture
        const b = ctx.createBufferSource();
        b.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
        b.connect(ctx.destination);
        b.start(0);
        const p = ctx.resume();
        if (p && typeof p.catch === 'function') p.catch(() => {});
      } catch { /* retried on the next gesture */ }
    } else if (ctx.state === 'running') this._dropGestureListeners();
    if (this._pending) {
      const { track, opts } = this._pending;
      this._pending = null;
      this._startMusic(track, opts);
    }
  }

  /** Suspends the context (tab hidden). */
  suspend() {
    this._userSuspended = true;
    if (this._ctx && this._ctx.state === 'running') {
      try { const p = this._ctx.suspend(); if (p && p.catch) p.catch(() => {}); } catch { /* ignore */ }
    }
  }

  /** Resumes after suspend() (only once unlocked by a gesture). */
  resumeCtx() {
    this._userSuspended = false;
    if (this._ctx && this._unlocked && this._ctx.state !== 'running' && this._ctx.state !== 'closed') {
      try { const p = this._ctx.resume(); if (p && p.catch) p.catch(() => {}); } catch { /* ignore */ }
    }
  }

  /**
   * Sets any subset of the volume sliders (0..1). Values are remembered even before unlock.
   * @param {{master?:number, sfx?:number, music?:number}} v
   */
  setVolumes(v = {}) {
    for (const key of ['master', 'sfx', 'music']) if (typeof v[key] === 'number' && Number.isFinite(v[key])) this._vol[key] = clamp(v[key], 0, 1);
    this._applyVolumes(0.03);
  }

  /** Current slider values. */
  getVolumes() { return { ...this._vol }; }

  _applyVolumes(tau) {
    if (!this._ctx) return;
    const now = this._ctx.currentTime;
    const set = (param, value) => { if (tau > 0) param.setTargetAtTime(value, now, tau); else param.setValueAtTime(value, now); };
    set(this._n.master.gain, volCurve(this._vol.master));
    set(this._n.sfxBus.gain, volCurve(this._vol.sfx));
    set(this._n.musicBus.gain, volCurve(this._vol.music) * MUSIC_TRIM);
  }

  /**
   * Plays a sound effect. Unknown names warn once. Identical sounds within 30 ms are merged
   * (AoE hits), and voices are capped (4 per name, 32 total; the oldest is stolen).
   * @param {string} name one of SFX
   * @param {{pitch?:number, volume?:number, pan?:number}} [opts]
   * @returns {{name:string, stop:(fadeMs?:number) => void}|null}
   */
  play(name, { pitch = 1, volume = 1, pan = 0 } = {}) {
    const fn = SFX_SYNTHS[name];
    if (!fn) { warnOnce(`unknown sfx "${name}"`); return null; }
    const ctx = this._ctx;
    if (!ctx || !this._unlocked) return null;
    const wall = wallNow();
    // while suspended nothing plays — except right after unlock(), when resume() is in flight and the
    // gesture's own sound (e.g. ui_confirm) should still be heard; later calls would queue into a burst
    if (ctx.state !== 'running' && !(ctx.state === 'suspended' && !this._userSuspended && wall - this._resumeAt < 0.3)) return null;
    const now = ctx.currentTime;
    const last = this._lastPlay.get(name);
    if (last !== undefined && wall - last < DEDUPE_S && wall >= last) return null;
    this._lastPlay.set(name, wall);
    try {
      this._pruneVoices(wall);
      const same = this._voices.filter((v) => v.name === name);
      if (same.length >= MAX_PER_NAME) this._steal(same[0], now);
      if (this._voices.length >= MAX_VOICES) this._steal(this._voices[0], now);
      const vg = ctx.createGain();
      vg.gain.value = clamp(finite(volume, 1), 0, 2);
      const pn = ctx.createStereoPanner();
      pn.pan.value = clamp(finite(pan, 0), -1, 1);
      vg.connect(pn);
      pn.connect(this._n.sfxBus);
      const send = ctx.createGain();
      send.gain.value = vg.gain.value;
      send.connect(this._n.sfxVerb.input);
      const dur = fn(ctx, vg, now, { pitch: clamp(finite(pitch, 1), 0.25, 4), reverb: send });
      const voice = { name, vg, pn, send, end: wall + dur, timer: null };
      voice.timer = setTimeout(() => this._release(voice), (dur + 0.25) * 1000);
      this._voices.push(voice);
      const duck = SFX_INFO[name] ? SFX_INFO[name].duck : 1;
      if (duck < 1) this.duck(duck, 0.35 + Math.min(1, dur) * 0.5);
      return { name, stop: (fadeMs = 40) => this._steal(voice, ctx.currentTime, fadeMs / 1000) };
    } catch (err) {
      warnOnce(`sfx "${name}" failed: ${err && err.message}`);
      return null;
    }
  }

  /** Dips the music bus to `level` (0..1) and recovers over ~`secs`. */
  duck(level = 0.5, secs = 0.5) {
    if (!this._ctx) return;
    const g = this._n.duck.gain;
    const now = this._ctx.currentTime;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.setTargetAtTime(clamp(level, 0, 1), now, 0.015);
    g.setTargetAtTime(1, now + Math.max(0.05, secs), 0.25);
  }

  _pruneVoices(wall) {
    this._voices = this._voices.filter((v) => v.end + 0.05 > wall);
  }

  _steal(voice, now, fade = 0.02) {
    for (const g of [voice.vg.gain, voice.send.gain]) {
      g.cancelScheduledValues(now);
      g.setValueAtTime(g.value, now);
      g.setTargetAtTime(0, now, Math.max(0.004, fade / 3));
    }
    voice.end = Math.min(voice.end, wallNow() + fade);
    this._voices = this._voices.filter((v) => v !== voice);
    clearTimeout(voice.timer);
    voice.timer = setTimeout(() => this._release(voice), fade * 1000 + 120);
  }

  _release(voice) {
    for (const n of [voice.vg, voice.pn, voice.send]) { try { n.disconnect(); } catch { /* gone */ } }
    this._voices = this._voices.filter((v) => v !== voice);
  }

  /**
   * Crossfades to a track. The same track (playing or pending) is a no-op. `loop` defaults to the
   * track's nature (false for the 'victory' and 'gameover' jingles, true otherwise).
   * @param {string} track one of TRACKS
   * @param {{fade?:number, loop?:boolean}} [opts] fade in ms
   */
  playMusic(track, { fade = 800, loop } = {}) {
    const def = TRACK_DEFS[track];
    if (!def) { warnOnce(`unknown track "${track}"`); return; }
    if (this.currentTrack === track) return;
    const opts = { fade: Math.max(0, finite(fade, 800)), loop: loop === undefined ? def.loop !== false : !!loop };
    if (!this._ctx || !this._unlocked) { this._pending = { track, opts }; return; }
    this._startMusic(track, opts);
  }

  _startMusic(track, { fade, loop }) {
    const ctx = this._ctx;
    if (!ctx) return;
    const secs = fade / 1000;
    this._fadeOutCurrent(secs);
    try {
      const rec = { name: track, player: null };
      const player = new MusicPlayer(ctx, this._n.musicBus, TRACK_DEFS[track], {
        loop, verbIn: this._n.musicVerb.input, seed: (Math.random() * 0xffffffff) >>> 0,
        onEnd: () => {
          if (this._music === rec) this._music = null;
          player.disconnect();
        },
      });
      rec.player = player;
      const start = ctx.currentTime + 0.06;
      player.fadeTo(1, start, Math.max(0.01, secs), 0);
      player.start(start);
      this._music = rec;
    } catch (err) {
      warnOnce(`music "${track}" failed: ${err && err.message}`);
      this._music = null;
    }
  }

  _fadeOutCurrent(secs) {
    const cur = this._music;
    this._music = null;
    if (!cur || !cur.player || !this._ctx) return;
    const now = this._ctx.currentTime;
    const p = cur.player;
    p.fadeTo(0, now, Math.max(0.01, secs));
    setTimeout(() => { p.stop(this._ctx.currentTime); }, secs * 1000 + 30);
    setTimeout(() => p.disconnect(), secs * 1000 + 3500);
  }

  /** Fades the current track out (and cancels a pending one). @param {{fade?:number}} [opts] ms */
  stopMusic({ fade = 600 } = {}) {
    this._pending = null;
    this._fadeOutCurrent(Math.max(0, finite(fade, 600)) / 1000);
  }
}

/* ========================================================================================
 * Offline rendering (dev page self-test, tooling). Browser-only; rejects without OfflineAudioContext.
 * ====================================================================================== */

/**
 * Renders one SFX (through a fresh reverb bus) into an AudioBuffer.
 * @param {string} name
 * @param {{sampleRate?:number, pitch?:number, reverb?:boolean, seed?:number}} [opts]
 * @returns {Promise<{buffer:AudioBuffer, declared:number, nodes:number}>}
 */
export async function renderSfx(name, { sampleRate = 44100, pitch = 1, reverb = true, seed = 7 } = {}) {
  const O = offlineCtor();
  if (!O) throw new Error('OfflineAudioContext unavailable');
  const fn = SFX_SYNTHS[name];
  if (!fn) throw new Error(`unknown sfx "${name}"`);
  // dry run to learn the length (node creation is cheap, nothing is rendered)
  const probe = new O(2, 128, sampleRate);
  const declared = fn(probe, probe.destination, 0, { pitch, rng: makeRng(seed) });
  const len = Math.ceil(sampleRate * Math.min(8, declared + (reverb ? 2.2 : 0.2)));
  const ctx = new O(2, len, sampleRate);
  let send = null;
  if (reverb) {
    const rv = createReverb(ctx, { time: 1.7, damp: 5200, wet: 0.9 });
    rv.output.connect(ctx.destination);
    send = rv.input;
  }
  const stats = { nodes: 0 };
  const out = ctx.createGain();
  out.connect(ctx.destination);
  fn(ctx, out, 0, { pitch, reverb: send, rng: makeRng(seed), stats });
  const buffer = await ctx.startRendering();
  return { buffer, declared, nodes: stats.nodes };
}

/**
 * Renders the first `seconds` of a track offline.
 * @param {string} name
 * @param {number} [seconds=2]
 * @param {{sampleRate?:number, loop?:boolean}} [opts]
 * @returns {Promise<{buffer:AudioBuffer, notes:number, nodes:number, steps:number}>}
 */
export async function renderTrack(name, seconds = 2, { sampleRate = 44100, loop } = {}) {
  const O = offlineCtor();
  if (!O) throw new Error('OfflineAudioContext unavailable');
  const def = TRACK_DEFS[name];
  if (!def) throw new Error(`unknown track "${name}"`);
  const ctx = new O(2, Math.ceil(sampleRate * seconds), sampleRate);
  const bus = ctx.createGain();
  bus.gain.value = 0.8;
  bus.connect(ctx.destination);
  const rv = createReverb(ctx, { time: 2.6, damp: 4200, wet: 0.8, size: 1.15 });
  rv.output.connect(bus);
  const player = new MusicPlayer(ctx, bus, def, { loop: loop ?? def.loop !== false, verbIn: rv.input, seed: 42 });
  player.start(0.02, { timer: false });
  // mirror live behaviour: schedule in look-ahead chunks and collect finished voices as we go
  const chunk = 0.25;
  player.scheduleUntil(chunk + LOOKAHEAD);
  const hops = [];
  for (let t = chunk; t < seconds - 0.01; t += chunk) {
    hops.push(ctx.suspend(t).then(() => {
      player.scheduleUntil(t + chunk + LOOKAHEAD);
      player.gc(t);
      return ctx.resume();
    }));
  }
  const buffer = await ctx.startRendering();
  await Promise.all(hops);
  return { buffer, notes: player.noteCount, nodes: player.nodeCount, steps: player.abs };
}
