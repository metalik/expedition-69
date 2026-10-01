// Audio bench for Expedition 69: buttons for every SFX / track, volume buses, an offline waveform
// inspector, and ?selftest=1 — offline metering of every SFX (peak, RMS, -60 dB duration, attack)
// plus a music scheduler smoke test. Results render into the page and window.__selftest.

import {
  Audio, SFX, SFX_INFO, TRACKS, TRACK_DEFS, renderSfx, renderTrack, parseSeq,
} from '../src/core/audio.js';

const params = new URLSearchParams(location.search);
const $ = (sel) => document.querySelector(sel);
const el = (tag, props = {}, kids = []) => {
  const n = Object.assign(document.createElement(tag), props);
  for (const k of [].concat(kids)) n.append(k);
  return n;
};
const db = (x) => (x > 0 ? 20 * Math.log10(x) : -Infinity);
const fmtDb = (x) => (Number.isFinite(db(x)) ? db(x).toFixed(1) : '-inf');

/* ---------------------------------------------------------------------------------------
 * Metering
 * ------------------------------------------------------------------------------------- */

/**
 * Measures an AudioBuffer: peak (abs, all channels), RMS over the active span, duration until the
 * signal stays below -60 dBFS, attack = time to first reach 50% of peak.
 */
export function measure(buffer) {
  const chans = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) chans.push(buffer.getChannelData(c));
  const n = buffer.length;
  const sr = buffer.sampleRate;
  let peak = 0;
  let peakAt = 0;
  for (let i = 0; i < n; i++) {
    for (const ch of chans) { const a = Math.abs(ch[i]); if (a > peak) { peak = a; peakAt = i; } }
  }
  const floor = 0.001; // -60 dBFS
  let last = -1;
  for (let i = n - 1; i >= 0 && last < 0; i--) for (const ch of chans) if (Math.abs(ch[i]) > floor) { last = i; break; }
  let attack = -1;
  let onset = -1;
  const half = peak * 0.5;
  for (let i = 0; i < n && attack < 0; i++) {
    for (const ch of chans) {
      const a = Math.abs(ch[i]);
      if (onset < 0 && a > floor) onset = i;
      if (a >= half) { attack = i; break; }
    }
  }
  let sum = 0;
  const end = Math.max(1, last + 1);
  for (let i = 0; i < end; i++) for (const ch of chans) sum += ch[i] * ch[i];
  const rms = Math.sqrt(sum / (end * chans.length));
  return {
    peak, rms, peakAt: peakAt / sr,
    duration: (last + 1) / sr,
    attack: attack < 0 ? Infinity : attack / sr,
    onset: onset < 0 ? Infinity : onset / sr,
    silent: peak < 0.01,
  };
}

/** Draws a min/max waveform of a buffer into a canvas. */
function drawWave(canvas, buffer, { color = '#e0b458', grid = false, maxSec = null } = {}) {
  const g = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  g.clearRect(0, 0, W, H);
  const L = buffer.getChannelData(0);
  const R = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : L;
  const len = maxSec ? Math.min(buffer.length, Math.ceil(maxSec * buffer.sampleRate)) : buffer.length;
  if (grid) {
    g.strokeStyle = 'rgba(243,219,160,0.12)';
    g.lineWidth = 1;
    const secs = len / buffer.sampleRate;
    const stepS = secs > 3 ? 0.5 : secs > 1 ? 0.25 : 0.1;
    g.fillStyle = 'rgba(243,219,160,0.45)';
    g.font = '11px ui-monospace, Menlo, monospace';
    for (let s = 0; s <= secs; s += stepS) {
      const x = (s / secs) * W;
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke();
      g.fillText(`${s.toFixed(2)}s`, x + 3, 12);
    }
    g.beginPath(); g.moveTo(0, H / 2); g.lineTo(W, H / 2); g.stroke();
  }
  g.fillStyle = color;
  const per = len / W;
  for (let x = 0; x < W; x++) {
    let lo = 0;
    let hi = 0;
    const a = Math.floor(x * per);
    const b = Math.min(len, Math.floor((x + 1) * per) + 1);
    for (let i = a; i < b; i++) {
      const v = (L[i] + R[i]) * 0.5;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    const y0 = H / 2 - hi * (H / 2) * 0.95;
    const y1 = H / 2 - lo * (H / 2) * 0.95;
    g.fillRect(x, y0, 1, Math.max(1, y1 - y0));
  }
}

/* ---------------------------------------------------------------------------------------
 * Live bench
 * ------------------------------------------------------------------------------------- */

const audio = new Audio();
window.__audio = audio;
const state = { pitch: 1, pan: 0, volume: 1 };

function slider(label, min, max, step, value, onInput, fmt = (v) => v.toFixed(2)) {
  const out = el('output', { textContent: fmt(value) });
  const input = el('input', { type: 'range', min, max, step, value });
  input.addEventListener('input', () => { const v = Number(input.value); out.textContent = fmt(v); onInput(v); });
  return el('label', { className: 'slider' }, [el('span', { textContent: label }), input, out]);
}

function buildControls() {
  const vols = audio.getVolumes();
  const c = $('#controls');
  c.append(
    slider('Master', 0, 1, 0.01, vols.master, (v) => audio.setVolumes({ master: v })),
    slider('SFX', 0, 1, 0.01, vols.sfx, (v) => audio.setVolumes({ sfx: v })),
    slider('Music', 0, 1, 0.01, vols.music, (v) => audio.setVolumes({ music: v })),
    slider('Pitch', 0.5, 2, 0.01, 1, (v) => { state.pitch = v; }),
    slider('Pan', -1, 1, 0.05, 0, (v) => { state.pan = v; }),
  );
}

function updateStatus() {
  const ctx = audio.context;
  $('#status').innerHTML = `WebAudio <b>${audio.available ? 'yes' : 'no'}</b> · context <b>${ctx ? ctx.state : 'not created'}</b>`
    + ` · unlocked <b>${audio.unlocked}</b> · track <b>${audio.currentTrack ?? '—'}</b>`
    + (ctx ? ` · sample rate <b>${ctx.sampleRate}</b> · base latency <b>${((ctx.baseLatency || 0) * 1000).toFixed(1)} ms</b>` : '');
  for (const b of document.querySelectorAll('#tracks button[data-track]')) b.classList.toggle('on', b.dataset.track === audio.currentTrack);
}

async function inspect(name) {
  try {
    const { buffer, declared, nodes } = await renderSfx(name, { pitch: state.pitch, seed: (Math.random() * 1e9) >>> 0 });
    const m = measure(buffer);
    drawWave($('#inspector'), buffer, { grid: true, color: SFX_INFO[name].sharp ? '#e0b458' : '#9fd9f0' });
    $('#meta').innerHTML = `<b>${name}</b> · peak <b>${m.peak.toFixed(3)}</b> (${fmtDb(m.peak)} dB) · RMS <b>${fmtDb(m.rms)} dB</b>`
      + ` · attack <b>${(m.attack * 1000).toFixed(2)} ms</b> · −60 dB at <b>${m.duration.toFixed(2)} s</b> · synth ${declared.toFixed(2)} s · ${nodes} nodes`;
  } catch (err) {
    $('#meta').textContent = `inspect failed: ${err.message}`;
  }
}

function buildSfxButtons() {
  const byCat = {};
  for (const name of SFX) (byCat[SFX_INFO[name].cat] ||= []).push(name);
  const root = $('#sfx');
  for (const [cat, names] of Object.entries(byCat)) {
    const btns = el('div', { className: 'btns' });
    for (const name of names) {
      const b = el('button', { textContent: name, className: SFX_INFO[name].sharp ? 'sharp' : '', title: `play ${name}` });
      b.addEventListener('click', () => {
        audio.unlock();
        // the first click creates the context; give resume() a tick before playing
        const go = () => { audio.play(name, { pitch: state.pitch, pan: state.pan, volume: state.volume }); updateStatus(); };
        if (audio.context && audio.context.state !== 'running') setTimeout(go, 60); else go();
        inspect(name);
      });
      btns.append(b);
    }
    root.append(el('div', { className: 'cat' }, [el('h3', { textContent: cat }), btns]));
  }
}

function buildTrackButtons() {
  const root = $('#tracks');
  for (const t of TRACKS) {
    const def = TRACK_DEFS[t];
    const b = el('button', { textContent: t, title: `${def.bpm} bpm · ${def.beats}/4${def.loop === false ? ' · one-shot' : ''}` });
    b.dataset.track = t;
    b.addEventListener('click', () => { audio.unlock(); audio.playMusic(t, { fade: 900 }); updateStatus(); });
    root.append(b);
  }
  const stop = el('button', { textContent: 'stop', className: 'stop' });
  stop.addEventListener('click', () => { audio.stopMusic({ fade: 800 }); updateStatus(); });
  root.append(stop);
}

/* ---------------------------------------------------------------------------------------
 * Self-test
 * ------------------------------------------------------------------------------------- */

async function selftest() {
  document.body.classList.add('selftest');
  $('#selftest').hidden = false;
  const report = { done: false, sfx: [], music: [], failures: [], warnings: [] };
  window.__selftest = report;
  const t0 = performance.now();

  // --- every SFX, rendered offline through the reverb bus ---
  for (const name of SFX) {
    const info = SFX_INFO[name];
    try {
      const { buffer, declared, nodes } = await renderSfx(name, { seed: 7 });
      const m = measure(buffer);
      const flags = [];
      if (m.silent) flags.push('silent');
      if (m.peak > 0.99) flags.push('clipping');
      if (info.sharp && m.attack > 0.005) flags.push('slow-attack');
      const warn = [];
      if (m.peak < 0.05 && !m.silent) warn.push('quiet');
      if (m.duration > 4.5) warn.push('long');
      report.sfx.push({ name, cat: info.cat, sharp: info.sharp, ...m, declared, nodes, flags, warn, buffer });
      for (const f of flags) report.failures.push(`${name}: ${f}`);
      for (const w of warn) report.warnings.push(`${name}: ${w}`);
    } catch (err) {
      report.sfx.push({ name, cat: info.cat, sharp: info.sharp, error: err.message, flags: ['error'], warn: [] });
      report.failures.push(`${name}: error ${err.message}`);
    }
  }

  // --- music: schedule each track offline for ~2.5 s and render ---
  for (const t of TRACKS) {
    const def = TRACK_DEFS[t];
    try {
      const secs = 2.5;
      const { buffer, notes, nodes, steps } = await renderTrack(t, secs);
      const m = measure(buffer);
      // structural check: every melody sequence referenced must fit the loop (catches typos)
      const totalSteps = def.chords.trim().split(/\s+/).length * def.beats * def.sub;
      const flags = [];
      if (notes === 0) flags.push('no-notes');
      if (m.silent) flags.push('silent');
      if (m.peak > 0.99) flags.push('clipping');
      report.music.push({ name: t, bpm: def.bpm, meter: `${def.beats}/4`, bars: totalSteps / (def.beats * def.sub), loop: def.loop !== false, notes, nodes, steps, ...m, flags });
      for (const f of flags) report.failures.push(`music ${t}: ${f}`);
    } catch (err) {
      report.music.push({ name: t, error: err.message, flags: ['error'] });
      report.failures.push(`music ${t}: error ${err.message}`);
    }
  }
  try { parseSeq('a4:2 . - c#5+e5:3 | bb3'); } catch (err) { report.failures.push(`parseSeq: ${err.message}`); }
  report.ms = Math.round(performance.now() - t0);

  // --- live Audio facade (needs a running context: a gesture or an autoplay-permissive browser) ---
  if (params.get('live') !== '0') {
    $('#st-summary').textContent = 'Offline checks done · running live Audio checks…';
    report.live = await liveTest();
    for (const r of report.live) {
      if (r.state === 'fail') report.failures.push(`live: ${r.name}${r.detail ? ` (${r.detail})` : ''}`);
      if (r.state === 'skip') report.warnings.push(`live: ${r.name} skipped`);
    }
  }
  renderReport(report);
  report.done = true;
  for (const r of report.sfx) delete r.buffer;
  document.title = report.failures.length ? `SELFTEST FAIL (${report.failures.length})` : 'SELFTEST PASS';
}

function renderReport(report) {
  const sharp = report.sfx.filter((r) => r.sharp && Number.isFinite(r.attack));
  const worstAttack = sharp.reduce((w, r) => (r.attack > w.attack ? r : w), { attack: 0, name: '—' });
  const maxPeak = report.sfx.reduce((w, r) => (r.peak > w.peak ? r : w), { peak: 0, name: '—' });
  const sum = $('#st-summary');
  sum.className = `summary ${report.failures.length ? 'fail' : 'pass'}`;
  sum.textContent = `${report.failures.length ? 'FAIL' : 'PASS'} · ${report.sfx.length} SFX · ${report.music.length} tracks · `
    + `${report.failures.length} failures · ${report.warnings.length} warnings · worst sharp attack ${(worstAttack.attack * 1000).toFixed(2)} ms (${worstAttack.name}) · `
    + `max peak ${maxPeak.peak.toFixed(3)} (${maxPeak.name}) · ${report.ms} ms`
    + (report.failures.length ? ` — ${report.failures.join('; ')}` : '')
    + (report.warnings.length ? ` — warnings: ${report.warnings.join('; ')}` : '');

  const head = ['sfx', 'wave', 'peak', 'dBFS', 'RMS dB', 'attack ms', 'dur s', 'nodes', 'status'];
  const half = Math.ceil(report.sfx.length / 2);
  for (const part of [report.sfx.slice(0, half), report.sfx.slice(half)]) {
    const table = el('table');
    table.append(el('tr', {}, head.map((h) => el('th', { textContent: h }))));
    for (const r of part) {
      const tr = el('tr', { className: r.flags.length ? 'bad' : '' });
      const wave = el('canvas', { className: 'wave', width: 240, height: 44 });
      if (r.buffer) drawWave(wave, r.buffer, { color: r.flags.length ? '#e0553d' : r.sharp ? '#e0b458' : '#9fd9f0', maxSec: Math.max(0.25, Math.min(3, r.duration)) });
      const status = el('td');
      if (r.error) status.append(el('span', { className: 'flag err', textContent: r.error }));
      for (const f of r.flags) if (f !== 'error') status.append(el('span', { className: 'flag err', textContent: f }));
      for (const w of r.warn) status.append(el('span', { className: 'flag warn', textContent: w }));
      if (!r.flags.length && !r.warn.length) status.append(el('span', { className: 'flag ok', textContent: 'ok' }));
      tr.append(
        el('td', { textContent: r.name + (r.sharp ? ' ◆' : '') }),
        el('td', {}, wave),
        el('td', { className: 'num', textContent: r.error ? '' : r.peak.toFixed(3) }),
        el('td', { className: 'num', textContent: r.error ? '' : fmtDb(r.peak) }),
        el('td', { className: 'num', textContent: r.error ? '' : fmtDb(r.rms) }),
        el('td', { className: 'num', textContent: r.error ? '' : (r.attack * 1000).toFixed(2) }),
        el('td', { className: 'num', textContent: r.error ? '' : r.duration.toFixed(2) }),
        el('td', { className: 'num', textContent: r.error ? '' : String(r.nodes) }),
        status,
      );
      table.append(tr);
    }
    $('#st-sfx').append(table);
  }

  const mt = el('table');
  mt.append(el('tr', {}, ['track', 'bpm', 'meter', 'bars', 'loop', 'steps (2.5 s)', 'notes', 'nodes', 'peak', 'RMS dB', 'status'].map((h) => el('th', { textContent: h }))));
  for (const r of report.music) {
    const status = el('td');
    if (r.error) status.append(el('span', { className: 'flag err', textContent: r.error }));
    for (const f of r.flags) if (f !== 'error') status.append(el('span', { className: 'flag err', textContent: f }));
    if (!r.flags.length) status.append(el('span', { className: 'flag ok', textContent: 'ok' }));
    mt.append(el('tr', { className: r.flags.length ? 'bad' : '' }, [
      el('td', { textContent: r.name }),
      el('td', { className: 'num', textContent: r.bpm ?? '' }),
      el('td', { textContent: r.meter ?? '' }),
      el('td', { className: 'num', textContent: r.bars ?? '' }),
      el('td', { textContent: r.loop === undefined ? '' : r.loop ? 'loop' : 'one-shot' }),
      el('td', { className: 'num', textContent: r.steps ?? '' }),
      el('td', { className: 'num', textContent: r.notes ?? '' }),
      el('td', { className: 'num', textContent: r.nodes ?? '' }),
      el('td', { className: 'num', textContent: r.error ? '' : r.peak.toFixed(3) }),
      el('td', { className: 'num', textContent: r.error ? '' : fmtDb(r.rms) }),
      status,
    ]));
  }
  $('#st-music').append(mt);

  if (report.live) {
    const lt = el('table');
    lt.append(el('tr', {}, ['live check', 'result', 'detail'].map((h) => el('th', { textContent: h }))));
    for (const r of report.live) {
      const cls = r.state === 'pass' ? 'ok' : r.state === 'skip' ? 'warn' : 'err';
      lt.append(el('tr', { className: r.state === 'fail' ? 'bad' : '' }, [
        el('td', { textContent: r.name }),
        el('td', {}, el('span', { className: `flag ${cls}`, textContent: r.state })),
        el('td', { textContent: r.detail || '' }),
      ]));
    }
    $('#st-live').append(lt);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitUntil(fn, timeout) {
  const t0 = performance.now();
  while (performance.now() - t0 < timeout) { if (fn()) return true; await sleep(20); }
  return !!fn();
}

/** End-to-end checks of the game-facing Audio class on a real AudioContext. */
async function liveTest() {
  const rows = [];
  const check = (name, ok, detail = '') => rows.push({ name, state: ok ? 'pass' : 'fail', detail: String(detail) });
  const a = new Audio();
  check('WebAudio available', a.available);
  a.setVolumes({ master: 0.4, sfx: 0.8, music: 0.5 });
  a.playMusic('title');
  check('track requested before unlock is pending', a.currentTrack === 'title' && !a.context, `ctx=${a.context ? 'created' : 'none'}`);
  a.unlock();
  const early = a.play('ui_confirm', { volume: 0.3 });
  check('sound in the unlocking gesture is kept', !!early, a.context ? a.context.state : 'no context');
  const running = await waitUntil(() => a.context && a.context.state === 'running', 1500);
  if (!running) {
    rows.push({ name: 'context running (needs a user gesture or --autoplay-policy=no-user-gesture-required)', state: 'skip', detail: a.context ? a.context.state : 'no context' });
    return rows;
  }
  check('context running after unlock', true, `${a.context.sampleRate} Hz`);
  check('pending track started on unlock', a._music && a._music.name === 'title');
  const p1 = a._music && a._music.player;
  a.playMusic('title', { fade: 50 });
  check('same track is a no-op', a._music && a._music.player === p1);

  await sleep(60); // stay clear of the 30 ms dedupe window after the unlock sound
  const nulls = [];
  for (const n of SFX) { if (!a.play(n, { volume: 0.4, pitch: 1, pan: 0 })) nulls.push(n); await sleep(12); }
  check('every SFX plays live', nulls.length === 0, nulls.join(', ') || `${SFX.length} played`);
  await sleep(40);
  const h1 = a.play('hit');
  const h2 = a.play('hit');
  check('identical SFX within 30 ms are merged', !!h1 && h2 === null, `first=${h1 ? 'played' : 'null'} second=${h2 ? 'played' : 'null'} state=${a.context.state} t=${a.context.currentTime.toFixed(3)}`);
  const warn = console.warn;
  let warns = 0;
  console.warn = (...args) => { warns++; warn.apply(console, args); };
  const u1 = a.play('no_such_sound');
  a.play('no_such_sound');
  console.warn = warn;
  check('unknown SFX returns null and warns once', u1 === null && warns === 1, `warnings=${warns}`);
  for (let i = 0; i < 8; i++) { a.play('coin', { volume: 0.2, pitch: 1 + i * 0.05 }); await sleep(35); }
  const coins = a._voices.filter((v) => v.name === 'coin').length;
  check('per-name voice cap (≤ 4)', coins <= 4, `${coins} coin voices`);
  check('global voice cap (≤ 32)', a._voices.length <= 32, `${a._voices.length} voices`);
  const handle = a.play('parry', { volume: 0.3 });
  check('play() returns a stoppable handle', handle && typeof handle.stop === 'function', `handle=${handle ? 'ok' : 'null'} voices=${a._voices.length} state=${a.context.state}`);
  if (handle) handle.stop(30);

  a.playMusic('battle', { fade: 300 });
  check('crossfade switches currentTrack', a.currentTrack === 'battle');
  const fp = a._music && a._music.player;
  await sleep(150);
  const gMid = fp ? fp.out.gain.value : -1;
  await sleep(300);
  const gEnd = fp ? fp.out.gain.value : -1;
  check('new track fades in (gain rises from 0 to 1)', gMid > 0 && gMid < 0.9 && gEnd > 0.98, `mid=${gMid.toFixed(2)} end=${gEnd.toFixed(2)}`);
  check('previous track stopped after fade', p1 && p1.done && p1.timer === null);
  const bp = a._music && a._music.player;
  const n0 = bp ? bp.noteCount : 0;
  await sleep(700);
  check('scheduler keeps creating notes', bp && bp.noteCount > n0, `${bp ? bp.noteCount - n0 : 0} notes in 0.7 s, track=${a.currentTrack} timer=${bp && bp.timer} next=${bp && bp.nextTime.toFixed(2)} now=${a.context.currentTime.toFixed(2)} done=${bp && bp.done}`);
  check('finished voices are collected', bp && bp.live.length < 80, `${bp ? bp.live.length : '?'} live notes`);

  a.setVolumes({ master: 0.3, music: 0.25 });
  const v = a.getVolumes();
  check('setVolumes merges partial updates', v.master === 0.3 && v.music === 0.25 && v.sfx === 0.8, JSON.stringify(v));

  a.suspend();
  const susp = await waitUntil(() => a.context.state === 'suspended', 1500);
  check('suspend() suspends the context', susp, a.context.state);
  check('play() is silent while suspended', a.play('ui_move') === null);
  a.resumeCtx();
  const resumed = await waitUntil(() => a.context.state === 'running', 1500);
  check('resumeCtx() resumes', resumed, a.context.state);

  a.playMusic('victory', { fade: 100 });
  const vp = a._music && a._music.player;
  check('victory defaults to one-shot', vp && vp.loop === false);
  const ended = await waitUntil(() => a.currentTrack === null, 12000);
  check('one-shot jingle ends → currentTrack null', ended, `currentTrack=${a.currentTrack}`);

  a.playMusic('shore', { fade: 100 });
  a.playMusic('gameover', { loop: true, fade: 100 });
  check('explicit loop option overrides the default', a._music && a._music.player.loop === true);
  a.stopMusic({ fade: 150 });
  check('stopMusic clears currentTrack', a.currentTrack === null);
  await sleep(250);
  try { await a.context.close(); } catch { /* ignore */ }
  return rows;
}

/* ---------------------------------------------------------------------------------------
 * Boot
 * ------------------------------------------------------------------------------------- */

if (params.get('selftest') === '1') {
  selftest().catch((err) => window.__showError(`selftest crashed: ${err.stack || err}`));
} else {
  buildControls();
  buildSfxButtons();
  buildTrackButtons();
  updateStatus();
  setInterval(updateStatus, 500);
  window.addEventListener('keydown', (e) => { if (e.code === 'Space' && e.target === document.body) { e.preventDefault(); audio.play('parry'); } });
}
