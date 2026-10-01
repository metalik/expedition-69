// Sprite gallery / test bench for src/render/sprites.js. Modes via URL params:
//   (none) grid of all looks · ?look=id&anim=&variant=&p=&t=&scale=&facing=&aura=&flash=&tint=&broken=&phase=&mech=
//   ?sheet=id[&set=basic|party|enemy|all] · ?portraits=1 · ?weak=1 · ?world=1 · ?perf=1 · &play=1 (animate) · keyboard scrubbing.

import {
  LOOK_IDS, ANIM_IDS, PARTY_VARIANTS, ENEMY_VARIANTS, drawActor, getAnchors, getBounds, weakPointPositions,
  lookHeight, renderPortrait, getLookInfo,
} from '../src/render/sprites.js';

const Q = new URLSearchParams(location.search);
const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d', { willReadFrequently: false });
const info = document.getElementById('info');
const help = document.getElementById('help');
const DPR = Math.min(2, window.devicePixelRatio || 1);
const PARTY = new Set(['gideon', 'nyra', 'sable']);

const num = (k, d) => (Q.has(k) ? parseFloat(Q.get(k)) : d);
const STANCES = ['neutral', 'assault', 'guard', 'virtuoso'];
const GLYPHS = ['fire', 'ice', 'storm', 'earth', 'light'];

function parseMech(id) {
  const m = Q.get('mech');
  if (id === 'gideon') return { type: 'surge', value: m ? parseFloat(m) : 4 };
  if (id === 'nyra') return { type: 'glyphs', list: m ? m.split(',') : ['fire', 'ice', 'light'] };
  if (id === 'sable') return { type: 'stance', value: m || 'neutral' };
  return null;
}

function setup(w, h) {
  canvas.width = Math.round(w * DPR);
  canvas.height = Math.round(h * DPR);
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}

function backdrop(w, h) {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#2b2340'); g.addColorStop(0.55, '#6b4a63'); g.addColorStop(0.85, '#c98a6a'); g.addColorStop(1, '#8f6f52');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  const s = ctx.createRadialGradient(w * 0.78, h * 0.3, 10, w * 0.78, h * 0.3, h * 0.7);
  s.addColorStop(0, 'rgba(255,215,154,0.35)'); s.addColorStop(1, 'rgba(255,215,154,0)');
  ctx.fillStyle = s;
  ctx.fillRect(0, 0, w, h);
}

function ground(x0, x1, y) {
  ctx.fillStyle = 'rgba(40,26,18,0.35)';
  ctx.fillRect(x0, y, x1 - x0, 3);
}

function label(text, x, y, size = 13, color = '#f3dba0', align = 'center') {
  ctx.font = `600 ${size}px Cinzel, Georgia, serif`;
  ctx.textAlign = align;
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillText(text, x + 1, y + 1);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

/** Time a draw call in ms (median of `n`). */
function timed(fn, n = 1) {
  const ts = [];
  for (let i = 0; i < n; i++) { const t0 = performance.now(); fn(); ts.push(performance.now() - t0); }
  ts.sort((a, b) => a - b);
  return ts[Math.floor(ts.length / 2)];
}

function overlay(id, pose) {
  const b = getBounds(id, pose);
  ctx.save();
  ctx.strokeStyle = 'rgba(120,220,255,0.9)';
  ctx.setLineDash([4, 3]);
  ctx.lineWidth = 1;
  ctx.strokeRect(b.x, b.y, b.w, b.h);
  ctx.setLineDash([]);
  const a = getAnchors(id, pose);
  const cols = { head: '#ff7ad9', chest: '#ffd24a', weapon: '#7aff9a', feet: '#ffffff', top: '#7ab8ff', center: '#ff9a4a', tip: '#b0ffb0', cast: '#c7a0ff' };
  for (const k in a) {
    ctx.fillStyle = cols[k] || '#fff';
    ctx.beginPath(); ctx.arc(a[k].x, a[k].y, 3, 0, Math.PI * 2); ctx.fill();
    ctx.font = '10px ui-monospace, Menlo, monospace';
    ctx.textAlign = 'left';
    ctx.fillText(k, a[k].x + 4, a[k].y - 3);
  }
  for (const w of weakPointPositions(id, pose)) {
    ctx.strokeStyle = '#ff4a3d';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(w.x, w.y, w.r, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#ffd0c8';
    ctx.font = '11px ui-monospace, Menlo, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(w.id, w.x, w.y - w.r - 3);
  }
  ctx.restore();
}

// ------------------------------------------------------------------ modes

function gridMode(t, weak) {
  const cols = 6, cw = 250, chh = 300;
  const rows = Math.ceil(LOOK_IDS.length / cols);
  const W = cols * cw, H = rows * chh + 10;
  setup(W, H);
  backdrop(W, H);
  let total = 0;
  LOOK_IDS.forEach((id, i) => {
    const cx = (i % cols) * cw + cw / 2, cy = Math.floor(i / cols) * chh + chh - 42;
    const h = lookHeight(id);
    const scale = Math.min(1, 220 / h);
    const pose = { x: cx, y: cy, scale, facing: PARTY.has(id) ? 1 : -1, anim: 'idle', t: t + i * 137, mechanic: parseMech(id) };
    ground(cx - cw * 0.4, cx + cw * 0.4, cy);
    const ms = timed(() => drawActor(ctx, id, pose), 1);
    total += ms;
    if (weak) overlay(id, pose);
    const inf = getLookInfo(id);
    label(inf ? inf.name : id, cx, cy + 20, 13);
    label(`${id} · h${h} · ${ms.toFixed(2)}ms`, cx, cy + 35, 10, '#c9b894');
  });
  info.textContent = `grid · ${LOOK_IDS.length} looks · total ${total.toFixed(2)} ms`;
}

function singlePose(id) {
  const facing = num('facing', PARTY.has(id) ? 1 : -1);
  return {
    anim: Q.get('anim') || 'idle', variant: Q.get('variant') || null, p: num('p', 0), t: num('t', 800), facing,
    aura: Q.get('aura') || null, flash: num('flash', 0), tint: Q.get('tint') || null, broken: Q.get('broken') === '1',
    phase: num('phase', 0), mechanic: parseMech(id), alpha: num('alpha', 1),
  };
}

const live = { id: null, animIdx: 0, varIdx: 0, p: 0, playing: false, aura: 0, broken: false, weak: false, facing: 1, flashT: 0, mech: 0, phase: 0 };

function singleMode(t) {
  const id = live.id;
  const W = 1280, H = 720;
  setup(W, H);
  backdrop(W, H);
  const h = lookHeight(id);
  const scale = num('scale', Math.min(2.2, 520 / h));
  const pose = singlePose(id);
  const anims = ANIM_IDS;
  const variants = PARTY.has(id) ? PARTY_VARIANTS : ENEMY_VARIANTS;
  if (Q.get('play') === '1' || live.interactive) {
    pose.anim = anims[live.animIdx];
    pose.variant = variants[live.varIdx];
    pose.p = live.p;
    pose.facing = live.facing;
    pose.aura = [null, 'red', 'gold', 'gradient', 'white'][live.aura];
    pose.broken = live.broken;
    pose.phase = live.phase;
    const fl = Math.max(0, 1 - (t - live.flashT) / 220);
    pose.flash = fl;
    if (PARTY.has(id)) {
      if (id === 'gideon') pose.mechanic = { type: 'surge', value: live.mech };
      if (id === 'nyra') pose.mechanic = { type: 'glyphs', list: GLYPHS.slice(0, live.mech % 5) };
      if (id === 'sable') pose.mechanic = { type: 'stance', value: STANCES[live.mech % 4] };
    }
    pose.t = t;
  }
  pose.x = W / 2; pose.y = H - 90; pose.scale = scale;
  ground(0, W, pose.y);
  const ms = timed(() => drawActor(ctx, id, pose), 1);
  if (Q.get('weak') === '1' || live.weak) overlay(id, pose);
  info.textContent = `${id} · ${pose.anim}${pose.variant && ['windup', 'strike', 'recover'].includes(pose.anim) ? '/' + pose.variant : ''} · p=${pose.p.toFixed(2)} · scale ${scale.toFixed(2)} · ${ms.toFixed(3)} ms`;
  label(`${id} — ${pose.anim}${['windup', 'strike', 'recover'].includes(pose.anim) ? ' / ' + (pose.variant || '') : ''}  p=${pose.p.toFixed(2)}`, 20, 34, 18, '#f3dba0', 'left');
  label(`draw ${ms.toFixed(3)} ms`, 20, 58, 13, '#c9b894', 'left');
}

function sheetMode(t) {
  const id = Q.get('sheet');
  const set = Q.get('set') || (Q.get('vars') ? 'none' : 'basic');
  const party = PARTY.has(id);
  const h = lookHeight(id);
  const cellH = num('cell', 190);
  const scale = num('scale', Math.min(1.1, (cellH - 50) / (h * 1.05)));
  const cellW = Math.max(120, h * scale * 0.95 + 20);
  const rows = [];
  if (set === 'basic' || set === 'all') {
    rows.push(['idle', null, [0, 0.33, 0.66], [0, 700, 1400]]);
    rows.push(['run', null, [0, 0.25, 0.5, 0.75]]);
    rows.push(['walk', null, [0, 0.25, 0.5, 0.75]]);
    rows.push(['hurt', null, [0, 0.12, 0.35, 0.8]]);
    rows.push(['dodge', null, [0.1, 0.26, 0.45, 0.8]]);
    rows.push(['parry', null, [0.05, 0.1, 0.3, 0.7]]);
    rows.push(['jump', null, [0.1, 0.3, 0.52, 0.7, 0.9]]);
    rows.push(['cast', null, [0.2, 0.5, 0.78, 0.95]]);
    rows.push(['shoot', null, [0, 0.1, 0.4]]);
    rows.push(['aim', null, [0]]);
    rows.push(['guard', null, [0.6]]);
    rows.push(['ko', null, [0.2, 0.5, 0.75, 1]]);
    rows.push(['victory', null, [0.2, 1]]);
  }
  let vs = set === 'party' ? PARTY_VARIANTS : set === 'enemy' ? ENEMY_VARIANTS : set === 'all' ? (party ? PARTY_VARIANTS : ENEMY_VARIANTS) : [];
  if (Q.get('vars')) vs = Q.get('vars').split(',');
  for (const v of vs) {
    rows.push(['windup', v, [0.2, 0.45, 0.86, 1]]);
    rows.push(['strike', v, [0, 0.15, 0.35, 0.8]]);
    if (Q.get('recover') === '1') rows.push(['recover', v, [0.3, 0.7]]);
  }
  const cols = Math.max(...rows.map((r) => r[2].length));
  const W = Math.ceil(140 + cols * cellW), H = Math.ceil(rows.length * cellH + 20);
  setup(W, H);
  backdrop(W, H);
  let worst = 0;
  const facing = num('facing', party ? 1 : -1);
  rows.forEach(([anim, variant, ps, ts], r) => {
    const y = r * cellH + cellH - 22;
    ground(0, W, y);
    label(anim + (variant ? '/' + variant : ''), 10, y - cellH + 40, 13, '#f3dba0', 'left');
    ps.forEach((p, c) => {
      const x = 140 + c * cellW + cellW / 2;
      const pose = { x, y, scale, facing, anim, variant, p, t: ts ? ts[c] : 900 + c * 90, mechanic: parseMech(id), aura: Q.get('aura') || null, phase: num('phase', 0), broken: Q.get('broken') === '1' };
      const ms = timed(() => drawActor(ctx, id, pose), 1);
      worst = Math.max(worst, ms);
      if (Q.get('weak') === '1') overlay(id, pose);
      label(`p${p}`, x, y + 16, 10, '#c9b894');
    });
  });
  info.textContent = `sheet ${id} · set ${set} · worst ${worst.toFixed(3)} ms`;
}

function portraitMode() {
  const sizes = [96, 64, 48];
  const cw = 110;
  const W = Math.max(900, LOOK_IDS.length * cw + 20), H = 380;
  setup(W, H);
  ctx.fillStyle = '#1b1510';
  ctx.fillRect(0, 0, W, H);
  LOOK_IDS.forEach((id, i) => {
    const x = 10 + i * cw;
    let y = 16;
    for (const s of sizes) {
      const c = renderPortrait(id, s);
      if (c) ctx.drawImage(c, x + (cw - s) / 2 - 5, y, s, s);
      y += s + 12;
    }
    label(id, x + cw / 2 - 5, y + 14, 11, '#f3dba0');
  });
  info.textContent = 'portraits · 96 / 64 / 48 px';
}

function worldMode(t) {
  const W = 1280, H = 560;
  setup(W, H);
  backdrop(W, H);
  const n = LOOK_IDS.length, per = 8;
  LOOK_IDS.forEach((id, i) => {
    const row = Math.floor(i / per), col = i % per;
    const x = 90 + col * 150, y = 200 + row * 250;
    ground(x - 60, x + 60, y);
    const anim = Q.get('anim') || 'run';
    drawActor(ctx, id, { x, y, scale: 0.45, facing: 1, anim, t: t + i * 91, p: 0, mechanic: parseMech(id) });
    drawActor(ctx, id, { x: x + 55, y, scale: 0.45, facing: -1, anim: anim === 'run' ? 'walk' : 'idle', t: t + i * 53, p: 0, mechanic: parseMech(id) });
    label(id, x + 25, y + 18, 10);
  });
  info.textContent = `world scale 0.45 · ${n} looks · run (facing right) + walk (facing left)`;
}

function fxMode(t) {
  const ids = (Q.get('ids') || 'gideon,sable,shellguard,mime,sentinel,wreck_warden').split(',');
  const variants = [
    ['aura red', { aura: 'red', anim: 'windup', variant: 'slash', p: 0.6 }],
    ['aura gold', { aura: 'gold', anim: 'windup', variant: 'wave', p: 0.6 }],
    ['aura prism', { aura: 'gradient', anim: 'windup', variant: 'charge', p: 0.6 }],
    ['aura white', { aura: 'white', anim: 'windup', variant: 'thrust', p: 0.6 }],
    ['flash', { flash: 0.85, anim: 'hurt', p: 0.05 }],
    ['frozen tint', { tint: '#9fd9f0' }],
    ['broken', { broken: true }],
    ['ko alpha', { anim: 'ko', p: 0.7 }],
  ];
  const cw = 170, ch = 250;
  const W = 150 + variants.length * cw, H = ids.length * ch + 20;
  setup(W, H);
  backdrop(W, H);
  ids.forEach((id, r) => {
    const y = r * ch + ch - 30;
    ground(0, W, y);
    label(id, 10, y - ch + 50, 13, '#f3dba0', 'left');
    const scale = Math.min(1, 200 / lookHeight(id));
    variants.forEach(([name, extra], c) => {
      const x = 150 + c * cw + cw / 2;
      drawActor(ctx, id, { x, y, scale, facing: PARTY.has(id) ? 1 : -1, t: t + c * 100, mechanic: parseMech(id), ...extra });
      if (r === 0) label(name, x, 20 + 14, 11, '#c9b894');
    });
  });
  info.textContent = 'fx overlays: aura / flash / tint / broken / ko';
}

function perfMode() {
  const W = 1280, H = 720;
  setup(W, H);
  backdrop(W, H);
  const lines = [];
  const anims = [['idle'], ['run'], ['windup', 'slash', 0.9], ['strike', 'slash', 0.1], ['dodge', null, 0.3], ['hurt', null, 0.1, { flash: 0.8 }], ['idle', null, 0, { aura: 'red' }], ['idle', null, 0, { broken: true }]];
  let worst = 0;
  for (const id of LOOK_IDS) {
    const res = [];
    for (const [anim, variant, p = 0, extra = {}] of anims) {
      const pose = { x: 640, y: 600, scale: Math.min(1, 380 / lookHeight(id)), facing: -1, anim, variant, p, t: 1000, mechanic: parseMech(id), ...extra };
      for (let i = 0; i < 12; i++) { pose.t += 16; drawActor(ctx, id, pose); }
      ctx.getImageData(0, 0, 1, 1);
      const N = 20, batches = [];
      for (let k = 0; k < 3; k++) {
        const t0 = performance.now();
        for (let i = 0; i < N; i++) { pose.t += 16; drawActor(ctx, id, pose); }
        ctx.getImageData(0, 0, 1, 1); // force rasterisation so the timing is honest
        batches.push((performance.now() - t0) / N);
      }
      batches.sort((x, y) => x - y);
      const ms = batches[1];
      worst = Math.max(worst, ms);
      res.push(`${anim}${variant ? '/' + variant : ''}${extra.flash ? '+flash' : ''}${extra.aura ? '+aura' : ''}${extra.broken ? '+broken' : ''} ${ms.toFixed(3)}`);
    }
    lines.push(`${id.padEnd(12)} ${res.join(' | ')}`);
  }
  ctx.fillStyle = 'rgba(16,12,10,0.88)';
  ctx.fillRect(0, 0, W, H);
  ctx.font = '11px ui-monospace, Menlo, monospace';
  ctx.fillStyle = '#e9dcc0';
  ctx.textAlign = 'left';
  lines.forEach((l, i) => ctx.fillText(l, 10, 24 + i * 16));
  ctx.fillStyle = worst < 1 ? '#8fcf6b' : '#e0553d';
  ctx.fillText(`worst average ${worst.toFixed(3)} ms per actor-frame`, 10, 24 + lines.length * 16 + 12);
  info.textContent = `perf · worst ${worst.toFixed(3)} ms`;
  window.__perf = { worst, lines };
}

// ------------------------------------------------------------------ keyboard / loop

function setupInteractive() {
  live.interactive = true;
  live.id = Q.get('look');
  live.facing = num('facing', PARTY.has(live.id) ? 1 : -1);
  live.animIdx = Math.max(0, ANIM_IDS.indexOf(Q.get('anim') || 'idle'));
  const variants = PARTY.has(live.id) ? PARTY_VARIANTS : ENEMY_VARIANTS;
  live.varIdx = Math.max(0, variants.indexOf(Q.get('variant') || variants[0]));
  live.p = num('p', 0);
  live.playing = Q.get('play') === '1';
  help.style.display = 'block';
  help.textContent = [
    '←/→  scrub p      ↑/↓  anim',
    'V    variant      N    next look',
    'Space play/pause  F    flip facing',
    'A    aura cycle   B    broken',
    'H    hit flash    W    weak overlay',
    'M    mechanic     P    boss phase',
  ].join('\n');
  window.addEventListener('keydown', (e) => {
    const variantsNow = PARTY.has(live.id) ? PARTY_VARIANTS : ENEMY_VARIANTS;
    switch (e.code) {
      case 'ArrowLeft': live.p = Math.max(0, live.p - (e.shiftKey ? 0.01 : 0.05)); break;
      case 'ArrowRight': live.p = Math.min(1, live.p + (e.shiftKey ? 0.01 : 0.05)); break;
      case 'ArrowUp': live.animIdx = (live.animIdx + ANIM_IDS.length - 1) % ANIM_IDS.length; live.p = 0; break;
      case 'ArrowDown': live.animIdx = (live.animIdx + 1) % ANIM_IDS.length; live.p = 0; break;
      case 'KeyV': live.varIdx = (live.varIdx + 1) % variantsNow.length; live.p = 0; break;
      case 'KeyN': { const i = LOOK_IDS.indexOf(live.id); live.id = LOOK_IDS[(i + 1) % LOOK_IDS.length]; live.facing = PARTY.has(live.id) ? 1 : -1; live.varIdx = 0; break; }
      case 'Space': live.playing = !live.playing; e.preventDefault(); break;
      case 'KeyF': live.facing = -live.facing; break;
      case 'KeyA': live.aura = (live.aura + 1) % 5; break;
      case 'KeyB': live.broken = !live.broken; break;
      case 'KeyH': live.flashT = performance.now(); break;
      case 'KeyW': live.weak = !live.weak; break;
      case 'KeyM': live.mech = (live.mech + 1) % 11; break;
      case 'KeyP': live.phase = live.phase ? 0 : 1; break;
      default: return;
    }
    e.preventDefault();
  });
}

let last = performance.now();
function loop(now) {
  const dt = now - last; last = now;
  if (live.playing) {
    const dur = { windup: 900, strike: 450, recover: 500, jump: 800, ko: 1400, hurt: 500, dodge: 450, parry: 420, cast: 1000, shoot: 400, victory: 1200 }[ANIM_IDS[live.animIdx]] || 1200;
    live.p += dt / dur;
    if (live.p > 1) live.p = 0;
  }
  try { singleMode(now); } catch (e) { document.getElementById('errors').textContent += 'LOOP: ' + e.stack + '\n'; return; }
  requestAnimationFrame(loop);
}

function main() {
  const t = num('t', 1000);
  try {
    if (Q.has('look')) {
      live.id = Q.get('look');
      if (Q.get('play') === '1' || Q.get('interactive') === '1') { setupInteractive(); singleMode(performance.now()); requestAnimationFrame(loop); }
      else singleMode(t);
    } else if (Q.has('sheet')) sheetMode(t);
    else if (Q.get('portraits') === '1') portraitMode();
    else if (Q.get('world') === '1') worldMode(t);
    else if (Q.get('perf') === '1') perfMode();
    else if (Q.get('fx') === '1') fxMode(t);
    else gridMode(t, Q.get('weak') === '1');
  } catch (e) {
    document.getElementById('errors').textContent += 'MAIN: ' + (e.stack || e) + '\n';
  }
  document.body.dataset.ready = '1';
}

main();
