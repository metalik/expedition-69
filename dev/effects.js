// FX showcase and headless check page for src/render/effects.js, backgrounds.js and icons.js.
// URL params: ?bg=<zone>[&phase=1][&t=ms][&cam=x,y,zoom][&guide=1][&actors=1] · ?title=1 · ?demo=1[&zone=]
// ?icons=1 · ?cues=1[&bg=] · ?perf=1 · ?lanes=1[&at=ms][&zone=] (combat-text lanes: a 7-hit finisher with QTE
// ratings and timing words, plus a boss pile-up; freezes at `at`) — anything else opens the interactive showcase.

import {
  Effects, BURST_KINDS, PROJECTILE_KINDS, drawQteRing, drawDefenseCue, drawTargetMarker, drawEnemyBars, applyDesaturation,
} from '../src/render/effects.js';
import { drawBattleBackground, drawTitleBackground, BATTLE_ZONES, FLOOR_BAND, backgroundBuildTime } from '../src/render/backgrounds.js';
import {
  statusIcon, elementIcon, itemIcon, mechanicIcon, cueIcon, iconCanvas,
  STATUS_ICON_IDS, ELEMENT_ICON_IDS, ITEM_ICON_IDS, MECHANIC_ICON_KEYS, CUE_ICON_IDS,
} from '../src/render/icons.js';
import { PALETTE, FONTS, ELEMENT_COLORS, HIT_TYPE_COLORS } from '../src/render/palette.js';

const params = new URLSearchParams(location.search);
const num = (k, d) => (params.has(k) ? Number(params.get(k)) : d);
const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');
const dpr = params.has('dpr') ? Math.min(3, Math.max(0.5, Number(params.get('dpr')) || 1)) : Math.min(2, window.devicePixelRatio || 1);
canvas.width = 1280 * dpr;
canvas.height = 720 * dpr;
const baseTransform = () => ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

// Actor slots from the spec (§3.2)
const PARTY = [{ x: 390, y: 470, name: 'Gideon', col: '#3a5a8a' }, { x: 265, y: 565, name: 'Nyra', col: '#e9dcc0' }, { x: 250, y: 385, name: 'Sable', col: '#a3302a' }];
const FOES = [{ x: 905, y: 470, name: 'Shellguard' }, { x: 1045, y: 380, name: 'Driftling' }, { x: 1050, y: 575, name: 'Tidecaller' }];

function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function report(err) {
  if (window.__showError) window.__showError(String(err && (err.stack || err.message) || err));
  console.error(err);
}

// ---------------------------------------------------------------------------------------------
// Stand-in actors (this page must not depend on the sprites module)
// ---------------------------------------------------------------------------------------------

function drawStandIn(x, y, facing, color, h = 150, enemy = false) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(facing, 1);
  ctx.fillStyle = 'rgba(8,5,3,0.45)';
  ctx.beginPath();
  ctx.ellipse(0, 0, h * 0.32, h * 0.07, 0, 0, Math.PI * 2);
  ctx.fill();
  const body = enemy ? '#2a1c24' : '#1f1a1c';
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.moveTo(-h * 0.14, 0);
  ctx.quadraticCurveTo(-h * 0.2, -h * 0.5, -h * 0.1, -h * 0.72);
  ctx.lineTo(h * 0.12, -h * 0.72);
  ctx.quadraticCurveTo(h * 0.2, -h * 0.45, h * 0.14, 0);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.arc(0, -h * 0.82, h * 0.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(h * 0.12, -h * 0.72);
  ctx.quadraticCurveTo(h * 0.2, -h * 0.45, h * 0.14, 0);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, -h * 0.82, h * 0.1, -1.2, 1.2);
  ctx.stroke();
  // weapon
  ctx.strokeStyle = enemy ? '#8a6a5a' : '#d8d0c0';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(h * 0.14, -h * 0.45);
  ctx.lineTo(h * 0.42, -h * 0.7);
  ctx.stroke();
  ctx.restore();
}

function drawActors() {
  const all = [
    ...PARTY.map((p) => ({ ...p, f: 1, enemy: false })),
    ...FOES.map((e) => ({ ...e, f: -1, enemy: true, col: '#ff9a7a' })),
  ].sort((a, b) => a.y - b.y);
  for (const a of all) drawStandIn(a.x, a.y, a.f, a.col, a.enemy ? 140 : 150, a.enemy);
}

function drawGuide() {
  ctx.save();
  ctx.setLineDash([8, 6]);
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = 1;
  for (const y of [FLOOR_BAND.top, FLOOR_BAND.bottom]) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(1280, y);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.font = `12px ${FONTS.title}`;
  ctx.fillText('floor band', 8, FLOOR_BAND.top - 6);
  ctx.restore();
}

function caption(text, x = 16, y = 30, size = 18) {
  ctx.save();
  ctx.font = `700 ${size}px ${FONTS.title}`;
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 4;
  ctx.strokeStyle = 'rgba(10,6,4,0.9)';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = PALETTE.paleGold;
  ctx.fillText(text, x, y);
  ctx.restore();
}

function small(text, x, y, align = 'center', color = PALETTE.parchment) {
  ctx.save();
  ctx.font = `600 12px ${FONTS.title}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(10,6,4,0.9)';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.restore();
}

// ---------------------------------------------------------------------------------------------
// Modes
// ---------------------------------------------------------------------------------------------

const fx = new Effects({ reducedFlashing: params.get('reduced') === '1' });
window.__fx = fx; // debug handle for inspection from the console / CDP
let zone = params.get('bg') || params.get('zone') || 'shore';
let phase = num('phase', 0);
let showActors = params.get('actors') === '1';
let camSway = false;
let desatOn = false;
let freezeAt = null;
let fixedT = params.has('t') ? num('t', 0) : null;
const camParam = (params.get('cam') || '').split(',').map(Number);
const camera = { x: camParam[0] || 0, y: camParam[1] || 0, zoom: camParam[2] || 1 };
const mode = params.get('title') === '1' ? 'title'
  : params.get('demo') === '1' ? 'demo'
    : params.get('icons') === '1' ? 'icons'
      : params.get('cues') === '1' ? 'cues'
        : params.get('perf') === '1' ? 'perf'
          : params.get('bursts') === '1' ? 'bursts'
            : params.get('banners') === '1' ? 'banners'
              : params.get('lanes') === '1' ? 'lanes'
                : params.has('bg') ? 'bg' : 'interactive';

if (mode !== 'interactive') document.body.classList.add('capture');
// Zoomed capture for close inspection: &zoom=2&zx=600&zy=200 shows the region starting at (zx, zy).
if (params.has('zoom')) {
  const z = Number(params.get('zoom')) || 1;
  const st = document.getElementById('stage');
  st.style.transform = `scale(${z}) translate(${-num('zx', 0)}px, ${-num('zy', 0)}px)`;
}

function drawBg(t) {
  if (zone === 'title') drawTitleBackground(ctx, t);
  else drawBattleBackground(ctx, zone, t, { camera, phase });
}

// --- icon sheet --------------------------------------------------------------------------------
function renderIconSheet() {
  baseTransform();
  const g = ctx.createLinearGradient(0, 0, 0, 720);
  g.addColorStop(0, '#231a15');
  g.addColorStop(1, '#0f0b09');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 1280, 720);
  caption('Icons — canvas bitmaps at 44 px (top) · DOM <img> dataURLs at 20 px & 32 px (bottom of each group)', 16, 22, 15);
  const groups = [
    ['Status', 'status', STATUS_ICON_IDS, statusIcon],
    ['Element', 'element', ELEMENT_ICON_IDS, elementIcon],
    ['Item', 'item', ITEM_ICON_IDS, itemIcon],
    ['Mechanic', 'mechanic', MECHANIC_ICON_KEYS, mechanicIcon],
    ['Cue', 'cue', CUE_ICON_IDS, cueIcon],
  ];
  const dom = document.getElementById('domIcons');
  dom.innerHTML = '';
  let y = 56;
  for (const [title, kind, ids, fn] of groups) {
    caption(title, 16, y + 4, 14);
    const perRow = 15;
    ids.forEach((id, i) => {
      const col = i % perRow;
      const row = Math.floor(i / perRow);
      const x = 110 + col * 78;
      const yy = y + row * 128;
      const c = iconCanvas(kind, id, 44);
      if (c) ctx.drawImage(c, x - 22, yy - 16, 44, 44);
      const parts = id.split('_');
      if (parts.length > 1) { small(parts[0], x, yy + 34, 'center'); small(parts.slice(1).join(' '), x, yy + 47, 'center'); }
      else small(id, x, yy + 38, 'center');
      const domMode = params.get('domimg') || 'svg';
      if (domMode === 'none') return;
      for (const [size, dy, dx] of [[20, 62, -18], [32, 60, 6]]) {
        const img = new Image();
        img.src = domMode === 'png' ? iconCanvas(kind, id, size).toDataURL() : fn(id, size);
        img.width = size;
        img.height = size;
        img.style.left = `${x + dx}px`;
        img.style.top = `${yy + dy}px`;
        img.alt = id;
        dom.appendChild(img);
      }
    });
    y += 128 * Math.ceil(ids.length / perRow);
    if (y > 700) break;
  }
}

// --- cue sheet ---------------------------------------------------------------------------------
function renderCues(t) {
  baseTransform();
  drawBattleBackground(ctx, params.get('bg') || 'shore', 3000, { camera });
  ctx.fillStyle = 'rgba(10,6,4,0.25)';
  ctx.fillRect(0, 0, 1280, 720);
  caption('Offensive QTE ring (progress 0 → 1 closes) · ratings', 16, 24, 15);
  const qp = [0.05, 0.45, 0.8, 1.0];
  qp.forEach((p, i) => {
    drawQteRing(ctx, 110 + i * 165, 140, { progress: p, label: i === 3 ? 'E' : 'Space', t });
    small(`progress ${p}`, 110 + i * 165, 245);
  });
  ['perfect', 'good', 'miss'].forEach((rt, i) => {
    drawQteRing(ctx, 800 + i * 165, 140, { progress: 1, rating: rt, ratingAge: 150, t });
    small(rt, 800 + i * 165, 245);
  });
  caption('Defence assist cues — distinct shapes per hit type (progress 0.35 / 0.9)', 16, 278, 15);
  const types = [['normal', 'E / Q'], ['unparryable', 'DODGE'], ['jump', 'Space'], ['gradient', 'F']];
  types.forEach(([type, label], i) => {
    [0.35, 0.9].forEach((p, j) => {
      const x = 90 + i * 300 + j * 140;
      drawDefenseCue(ctx, x, 370, { progress: p, type, label: j ? label : '', t });
      small(`${type} ${p}`, x, 462, 'center', HIT_TYPE_COLORS[type]);
    });
  });
  drawDefenseCue(ctx, 1215, 370, { progress: 0.6, type: 'normal', label: 'E', t, radius: 52, locked: true });
  small('whiff lockout', 1225, 478, 'center', '#ff8a76');
  caption('Target markers · enemy bars (full + shields · ghost chip + hot break · broken · boss)', 16, 500, 15);
  [PALETTE.gold, PALETTE.frost, PALETTE.rose].forEach((c, i) => drawTargetMarker(ctx, 70 + i * 70, 600, { t: t + i * 300, color: c }));
  drawEnemyBars(ctx, 340, 548, { id: 'a', name: 'Shellguard', hp: 420, maxHp: 420, breakValue: 20, breakMax: 100, shields: 3, statuses: ['chill', 'mark'], t });
  drawEnemyBars(ctx, 520, 548, { id: 'b', name: 'Porcelain Sentinel', hp: 180, maxHp: 520, ghostHp: 330, breakValue: 86, breakMax: 100, shields: 0, statuses: ['burn', 'weakened', 'slow'], t });
  drawEnemyBars(ctx, 700, 548, { id: 'c', name: 'Tidecaller', hp: 60, maxHp: 300, breakValue: 100, breakMax: 100, broken: true, statuses: ['stun', 'defenseless'], t });
  drawEnemyBars(ctx, 1010, 548, { id: 'd', name: 'The Stillkeeper', hp: 5200, maxHp: 8000, ghostHp: 5900, breakValue: 180, breakMax: 350, shields: 8, boss: true, width: 300, statuses: ['powerful', 'shell', 'haste', 'regen'], t });
  small('shields ×8 collapse to one pip + count', 1010, 640);
}

// --- composed demo moment ----------------------------------------------------------------------
function setupDemo() {
  Math.random = seeded(42);
  zone = params.get('zone') || 'spire';
  showActors = true;
  const [gid, nyra, sable] = PARTY;
  const [e0, e1, e2] = FOES;
  const script = [
    [0, () => fx.banner('Tidal Rend', { style: 'caption', color: PALETTE.sea })],
    [300, () => fx.shockwave(e2.x - 40, e2.y, { toX: nyra.x + 30, duration: 1000, color: HIT_TYPE_COLORS.jump })],
    [380, () => { fx.burst(sable.x, sable.y - 70, 'heal'); fx.number(sable.x, sable.y - 150, 128, { kind: 'heal' }); }],
    [440, () => { fx.burst(e0.x - 10, e0.y - 70, 'lightning'); fx.number(e0.x, e0.y - 120, 356, { kind: 'damage', color: ELEMENT_COLORS.lightning }); }],
    [470, () => fx.number(e0.x - 40, e0.y - 150, 'BLOCKED', { kind: 'block' })],
    [560, () => fx.burst(e2.x, e2.y - 60, 'fire')],
    [590, () => fx.number(e2.x, e2.y - 130, 88, { kind: 'damage', affinity: 'resist' })],
    [620, () => fx.projectile({ from: { x: nyra.x + 40, y: nyra.y - 90 }, to: { x: e0.x, y: e0.y - 70 }, duration: 520, kind: 'orb', color: ELEMENT_COLORS.fire, arc: 60 })],
    [650, () => fx.slash(e1.x, e1.y - 70, { angle: -0.5, length: 180, width: 16, color: PALETTE.paleGold, life: 420 })],
    [720, () => { fx.burst(e1.x, e1.y - 80, 'crit', { dir: -1 }); fx.number(e1.x, e1.y - 120, 1234, { kind: 'crit', affinity: 'weak' }); }],
    [480, () => fx.banner('Parry', { sub: '+1 AP · Prism +8' })],
    [760, () => { fx.burst(gid.x + 60, gid.y - 90, 'parry', { dir: -1 }); fx.shake(4, 160); }],
    [790, () => fx.number(gid.x + 10, gid.y - 170, 1, { kind: 'ap' })],
  ];
  script.sort((a, b) => a[0] - b[0]);
  let i = 0;
  let clock = 0;
  const T = num('at', 880);
  while (clock <= T) {
    while (i < script.length && script[i][0] <= clock) { script[i][1](); i++; }
    fx.update(16);
    clock += 16;
  }
  freezeAt = clock;
}

function renderDemoOverlay(t) {
  const [gid, nyra] = PARTY;
  const [e0, e1, e2] = FOES;
  drawTargetMarker(ctx, e0.x, e0.y - 158, { t });
  drawQteRing(ctx, e1.x, e1.y - 80, { progress: 0.82, label: 'Space', t });
  drawDefenseCue(ctx, nyra.x, nyra.y - 80, { progress: 0.7, type: 'jump', label: 'Space', t });
  drawEnemyBars(ctx, e0.x, e0.y + 14, { id: 'e0', name: e0.name, hp: 260, maxHp: 420, ghostHp: 330, breakValue: 64, breakMax: 100, shields: 2, statuses: ['mark'], t });
  drawEnemyBars(ctx, e1.x, e1.y + 14, { id: 'e1', name: e1.name, hp: 40, maxHp: 280, ghostHp: 160, breakValue: 92, breakMax: 100, statuses: ['chill', 'burn'], t });
  drawEnemyBars(ctx, e2.x, e2.y + 14, { id: 'e2', name: e2.name, hp: 210, maxHp: 300, breakValue: 100, breakMax: 100, broken: true, statuses: ['stun', 'defenseless'], t });
  void gid;
}

// --- burst gallery: every preset frozen at the same age -----------------------------------------
const cells = [];
function setupBursts() {
  Math.random = seeded(7);
  zone = params.get('zone') || 'spire';
  const at = num('at', 140);
  const cols = 7;
  BURST_KINDS.forEach((k, i) => {
    const x = 100 + (i % cols) * 180;
    const y = 120 + Math.floor(i / cols) * 170;
    cells.push({ k, x, y });
    fx.burst(x, y, k, { dir: 1 });
  });
  for (let c = 0; c <= at; c += 10) fx.update(10);
  freezeAt = at;
}
function renderBurstLabels() {
  ctx.save();
  ctx.fillStyle = 'rgba(10,6,4,0.35)';
  ctx.fillRect(0, 0, 1280, 720);
  ctx.restore();
  for (const c of cells) small(c.k, c.x, c.y + 72);
  caption(`Burst presets at ${num('at', 140)} ms`, 16, 24, 15);
}

// --- banner styles at a fixed age ---------------------------------------------------------------
function setupBanners() {
  zone = params.get('zone') || 'thicket';
  const at = num('at', 800);
  fx.banner('Victory', { style: 'title', sub: 'Expedition 69 presses on', life: 3000, y: 330 });
  fx.banner('Break!', { color: PALETTE.breakBar, life: 3000, y: 150 });
  fx.banner('Rime Lance', { style: 'caption', color: ELEMENT_COLORS.ice, life: 3000, y: 60 });
  fx.banner('Counter!', { color: PALETTE.crimson, life: 3000, y: 540, sub: 'Riposte', slot: 'low' });
  for (let c = 0; c <= at; c += 16) fx.update(16);
  freezeAt = at;
}

// --- combat-text lanes -------------------------------------------------------------------------
// Mirrors the battle's spawn points: numbers at min(chest − 34, head + 26), timing words under the ring,
// status / shield words over the head; enemy bars drawn after the text (as the battle does).
const lanes = { clock: 0, script: [], i: 0, rings: [], at: num('at', 1150) };
window.__lanes = lanes;
function setupLanes() {
  Math.random = seeded(11);
  zone = params.get('zone') || 'training';
  showActors = true;
  const e = FOES[0];
  const chestY = e.y - 80, headY = e.y - 130;
  const numY = Math.min(chestY - 34, headY + 26);
  const dmg = [75, 82, 85, 91, 88, 97, 727];
  dmg.forEach((d, i) => {
    const T = 300 + i * 150;
    const rating = i % 3 === 1 ? 'good' : 'perfect';
    lanes.rings.push({ x: e.x, y: chestY, t0: T - 450, T, rating });
    lanes.script.push([T, () => {
      fx.number(e.x, numY, d, { kind: i === dmg.length - 1 ? 'crit' : 'damage', anchorId: 'e0', color: PALETTE.paleGold });
      fx.text(e.x, chestY + 66, rating === 'perfect' ? 'on time' : '18 ms early', { size: 15, color: PALETTE.parchment, life: 900, rise: 18, anchorId: 'e0' });
      fx.burst(e.x, chestY, 'hit', { dir: 1 });
    }]);
  });
  // Boss-style pile-up on another foe: a crit, a shield gain, a stance word and a resist, all in one beat.
  const b = FOES[2];
  const bHead = b.y - 130;
  lanes.script.push([900, () => {
    fx.number(b.x, Math.min(b.y - 114, bHead + 26), 408, { kind: 'crit', anchorId: 'e2' });
    fx.text(b.x, bHead - 40, '+2 Shields', { size: 18, color: PALETTE.shield, life: 1000, anchorId: 'e2' });
    fx.text(b.x, bHead - 50, 'Guard Stance', { size: 17, color: '#8fc8ff', life: 950, anchorId: 'e2' });
    fx.text(b.x, bHead - 44, 'Burn resisted', { size: 18, color: PALETTE.paleGold, life: 1000, anchorId: 'e2' });
  }]);
  lanes.script.sort((a, c) => a[0] - c[0]);
}

function stepLanes() {
  if (lanes.clock >= lanes.at) return;
  lanes.clock += 16;
  while (lanes.i < lanes.script.length && lanes.script[lanes.i][0] <= lanes.clock) lanes.script[lanes.i++][1]();
  fx.update(16);
}

function renderLanesOverlay() {
  const t = lanes.clock;
  const [e0, , e2] = FOES;
  drawEnemyBars(ctx, e0.x, e0.y - 184, { id: 'l0', name: 'Training Mannequin', hp: 2600, maxHp: 4000, breakValue: 60, breakMax: 100, statuses: ['mark', 'weakened'], t });
  drawEnemyBars(ctx, e2.x, e2.y - 184, { id: 'l2', name: 'Tidecaller', hp: 220, maxHp: 300, breakValue: 30, breakMax: 100, shields: 2, t });
  for (const r of lanes.rings) {
    if (t < r.t0 || t > r.T + 520) continue;
    if (t < r.T) drawQteRing(ctx, r.x, r.y, { progress: (t - r.t0) / (r.T - r.t0), label: 'Space', t });
    else drawQteRing(ctx, r.x, r.y, { rating: r.rating, ratingAge: t - r.T, t });
  }
  caption(`Combat-text lanes at ${Math.round(t)} ms`, 16, 24, 15);
}

// --- perf --------------------------------------------------------------------------------------
const perf = { n: 0, fx: 0, bg: 0, max: 0, started: 0 };
function perfStep(t) {
  while (fx.particleCount < 600) {
    const k = BURST_KINDS[(Math.random() * BURST_KINDS.length) | 0];
    fx.burst(200 + Math.random() * 880, 200 + Math.random() * 380, k);
  }
}

// ---------------------------------------------------------------------------------------------
// Frame loop
// ---------------------------------------------------------------------------------------------

let last = performance.now();
const t0 = last;
let perfEl = document.getElementById('perf');

function frame(now) {
  try {
    const dt = Math.min(50, now - last);
    last = now;
    const t = fixedT != null ? fixedT : now - t0;
    if (mode === 'icons') { requestAnimationFrame(frame); return; } // static sheet; keep the loop alive for headless virtual time

    baseTransform();
    ctx.clearRect(0, 0, 1280, 720);
    if (mode === 'cues') {
      renderCues(t);
      requestAnimationFrame(frame);
      return;
    }
    if (camSway) {
      camera.x = Math.sin(t * 0.0006) * 60;
      camera.y = Math.sin(t * 0.0009) * 14;
      camera.zoom = 1.04 + Math.sin(t * 0.0005) * 0.04;
    }
    const tb = performance.now();
    drawBg(t);
    const bgMs = performance.now() - tb;
    if (params.get('guide') === '1') drawGuide();

    if (mode === 'bg' || mode === 'title') {
      if (showActors) drawActors();
      requestAnimationFrame(frame);
      return;
    }

    const tf = performance.now();
    if (mode === 'perf') perfStep(t);
    if (mode === 'lanes') stepLanes();
    else if (freezeAt == null) fx.update(dt);
    const sh = fx.shakeOffset();
    ctx.save();
    ctx.translate(sh.x, sh.y);
    if (showActors) drawActors();
    if (mode === 'demo') renderDemoOverlay(freezeAt ?? t);
    if (mode === 'bursts') renderBurstLabels();
    if (mode === 'interactive') renderInteractiveOverlay(t);
    fx.render(ctx);
    if (mode === 'lanes') renderLanesOverlay();
    ctx.restore();
    if (desatOn) applyDesaturation(ctx, 0.85, { tint: PALETTE.violet });
    else if (fx.desaturation > 0) applyDesaturation(ctx, fx.desaturation, { tint: PALETTE.violet });
    fx.renderScreen(ctx);
    const fxMs = performance.now() - tf;

    if (mode === 'perf' || params.get('stats') === '1') {
      perf.n++;
      perf.fx += fxMs;
      perf.bg += bgMs;
      perf.max = Math.max(perf.max, fxMs);
      if (perf.n % 30 === 0) {
        const s = `particles ${fx.particleCount}\nfx avg ${(perf.fx / perf.n).toFixed(2)} ms (max ${perf.max.toFixed(2)})\nbg avg ${(perf.bg / perf.n).toFixed(2)} ms\nbuild ${zone}: ${(backgroundBuildTime(zone, { phase, scale: dpr }) ?? 0).toFixed(0)} ms`;
        perfEl.textContent = s;
        document.title = s.replace(/\n/g, ' | ');
      }
    }
  } catch (err) {
    report(err);
    return;
  }
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------------------------
// Interactive showcase
// ---------------------------------------------------------------------------------------------

let selectedBurst = 'parry';
let cueLoop = false;
let qteLoop = false;

function renderInteractiveOverlay(t) {
  if (cueLoop) {
    const types = ['normal', 'unparryable', 'jump', 'gradient'];
    const cycle = 1600;
    PARTY.forEach((p, i) => {
      const type = types[(Math.floor(t / cycle) + i) % types.length];
      drawDefenseCue(ctx, p.x, p.y - 80, { progress: ((t + i * 300) % cycle) / 1200, type, label: type === 'jump' ? 'Space' : type === 'gradient' ? 'F' : type === 'unparryable' ? 'Q' : 'E', t });
    });
  }
  if (qteLoop) {
    const p = (t % 1100) / 900;
    if (p <= 1.1) drawQteRing(ctx, FOES[0].x, FOES[0].y - 80, { progress: p, label: 'Space', t });
    else drawQteRing(ctx, FOES[0].x, FOES[0].y - 80, { rating: 'perfect', ratingAge: (p - 1.1) * 900, t });
  }
  FOES.forEach((e, i) => {
    drawEnemyBars(ctx, e.x, e.y + 14, { id: 'i' + i, name: e.name, hp: demoHp[i], maxHp: 400, breakValue: demoBreak[i], breakMax: 100, broken: demoBreak[i] >= 100, shields: i === 0 ? demoShields : 0, statuses: i === 1 ? ['burn', 'chill'] : [], t });
  });
  drawTargetMarker(ctx, FOES[target].x, FOES[target].y - 158, { t });
}

const demoHp = [400, 400, 400];
const demoBreak = [0, 0, 0];
let demoShields = 3;
let target = 0;

function hitTarget(amount, kind = 'damage', affinity = null) {
  const e = FOES[target];
  if (kind === 'block' || (target === 0 && demoShields > 0 && kind !== 'heal')) {
    demoShields = Math.max(0, demoShields - 1);
    fx.burst(e.x, e.y - 70, 'shield');
    fx.number(e.x, e.y - 120, 'BLOCKED', { kind: 'block' });
    return;
  }
  demoHp[target] = Math.max(0, demoHp[target] - amount);
  if (demoHp[target] === 0) demoHp[target] = 400;
  demoBreak[target] = Math.min(100, demoBreak[target] + 18);
  fx.number(e.x, e.y - 120, amount, { kind, affinity });
  if (demoBreak[target] >= 100) {
    fx.burst(e.x, e.y - 70, 'break');
    fx.banner('Break!', { color: PALETTE.breakBar });
    fx.shake(12, 300);
    setTimeout(() => { demoBreak[target] = 0; }, 2500);
  }
}

function button(row, label, fn) {
  const b = document.createElement('button');
  b.textContent = label;
  b.addEventListener('click', () => { try { fn(b); } catch (err) { report(err); } });
  document.getElementById(row).appendChild(b);
  return b;
}

function toggle(row, label, init, fn) {
  const l = document.createElement('label');
  l.className = 'tog';
  const i = document.createElement('input');
  i.type = 'checkbox';
  i.checked = init;
  i.addEventListener('change', () => fn(i.checked));
  l.append(i, label);
  document.getElementById(row).appendChild(l);
}

function setupInteractive() {
  document.getElementById('panel').hidden = false;
  showActors = true;
  const fit = () => {
    const s = Math.min(1, (window.innerWidth - 4) / 1280);
    const st = document.getElementById('stage');
    // the transform scales the canvas; the box itself is sized to the scaled result so the panel follows it
    st.style.transform = `scale(${s})`;
    st.style.width = `${1280 * s}px`;
    st.style.height = `${720 * s}px`;
  };
  window.addEventListener('resize', fit);
  fit();

  const sceneBtns = [];
  const scenes = [...BATTLE_ZONES.map((z) => [z, z, 0]), ['summit · phase 2', 'summit', 1], ['title', 'title', 0]];
  for (const [label, z, ph] of scenes) {
    const b = button('sceneRow', label, () => {
      zone = z; phase = ph;
      sceneBtns.forEach((x) => x.classList.toggle('sel', x === b));
    });
    if (z === zone && ph === phase) b.classList.add('sel');
    sceneBtns.push(b);
  }
  button('sceneRow', 'phase cross-fade', () => {
    zone = 'summit';
    const start = performance.now();
    const step = () => { phase = Math.min(1, (performance.now() - start) / 1500); if (phase < 1) requestAnimationFrame(step); };
    step();
  });
  button('sceneRow', 'target: next', () => { target = (target + 1) % FOES.length; });

  const burstBtns = [];
  for (const k of BURST_KINDS) {
    const b = button('burstRow', k, () => {
      selectedBurst = k;
      burstBtns.forEach((x) => x.classList.toggle('sel', x === b));
      const e = ['heal', 'buff', 'jump', 'land', 'dodge', 'perfectDodge', 'glyph', 'surge'].includes(k) ? PARTY[0] : FOES[target];
      fx.burst(e.x, e.y - 70, k, { dir: e === PARTY[0] ? 1 : -1 });
    });
    if (k === selectedBurst) b.classList.add('sel');
    burstBtns.push(b);
  }

  button('textRow', 'damage', () => hitTarget(Math.round(80 + Math.random() * 200)));
  button('textRow', 'crit', () => { hitTarget(Math.round(400 + Math.random() * 900), 'crit'); fx.burst(FOES[target].x, FOES[target].y - 70, 'crit', { dir: -1 }); });
  button('textRow', 'weak', () => hitTarget(Math.round(200 + Math.random() * 200), 'damage', 'weak'));
  button('textRow', 'resist', () => hitTarget(Math.round(20 + Math.random() * 40), 'damage', 'resist'));
  button('textRow', 'immune', () => fx.number(FOES[target].x, FOES[target].y - 120, 0, { affinity: 'immune' }));
  button('textRow', 'heal', () => { fx.number(PARTY[1].x, PARTY[1].y - 150, 140, { kind: 'heal' }); fx.burst(PARTY[1].x, PARTY[1].y - 70, 'heal'); });
  button('textRow', '+1 AP', () => fx.number(PARTY[0].x, PARTY[0].y - 170, 1, { kind: 'ap' }));
  button('textRow', 'blocked', () => hitTarget(0, 'block'));
  button('textRow', 'text', () => fx.text(640, 300, 'Surge ×6', { color: PALETTE.frost }));
  button('textRow', 'banner PARRY', () => { fx.banner('Parry', { sub: '+1 AP' }); fx.burst(PARTY[0].x + 60, PARTY[0].y - 90, 'parry', { dir: -1 }); });
  button('textRow', 'banner COUNTER!', () => { fx.banner('Counter!', { color: PALETTE.crimson }); fx.burst(FOES[0].x - 20, FOES[0].y - 80, 'counter', { dir: 1 }); });
  button('textRow', 'banner BREAK!', () => fx.banner('Break!', { color: PALETTE.breakBar }));
  button('textRow', 'banner VICTORY', () => fx.banner('Victory', { style: 'title', sub: 'Expedition 69 presses on', life: 2600 }));
  button('textRow', 'caption', () => fx.banner('Tidal Rend', { style: 'caption', color: PALETTE.sea }));

  for (const k of PROJECTILE_KINDS) {
    button('motionRow', `projectile ${k}`, () => {
      const from = { x: PARTY[0].x + 50, y: PARTY[0].y - 90 };
      const e = FOES[target];
      fx.projectile({ from, to: { x: e.x, y: e.y - 70 }, kind: k, duration: k === 'bullet' ? 140 : 480, arc: k === 'orb' || k === 'glyph' ? 70 : 0, onArrive: () => hitTarget(60) });
    });
  }
  button('motionRow', 'shockwave', () => fx.shockwave(FOES[2].x - 40, FOES[2].y, { toX: PARTY[1].x + 20, duration: 850, onArrive: ({ x, y }) => fx.burst(x, y, 'jump') }));
  button('motionRow', 'slash', () => fx.slash(FOES[target].x, FOES[target].y - 70, { angle: -0.4, length: 190, width: 16, color: PALETTE.paleGold, life: 300 }));
  button('motionRow', 'tracer', () => fx.line(PARTY[2].x + 40, PARTY[2].y - 100, FOES[target].x, FOES[target].y - 70, { color: PALETTE.paleGold, width: 3, life: 200 }));
  button('motionRow', 'ring', () => fx.ring(640, 400, { r0: 10, r1: 160, life: 600, color: PALETTE.gold, width: 5 }));

  button('screenRow', 'flash', () => fx.screenFlash('#fff6e0', 160, 0.6));
  button('screenRow', 'shake', () => fx.shake(10, 300));
  button('screenRow', 'vignette (hurt)', () => fx.vignette(PALETTE.crimson, 700, 0.55));
  button('screenRow', 'prism attack', () => {
    fx.desaturate(0.9, 1800);
    fx.vignette(PALETTE.violet, 1800, 0.5);
    fx.banner('Prism Attack', { color: HIT_TYPE_COLORS.gradient, sub: 'Prism Counter with F' });
    setTimeout(() => fx.burst(PARTY[0].x + 40, PARTY[0].y - 80, 'gradient'), 900);
  });
  button('screenRow', 'clear', () => fx.clear());

  toggle('optRow', 'stand-in actors', showActors, (v) => { showActors = v; });
  toggle('optRow', 'looping defence cues', false, (v) => { cueLoop = v; });
  toggle('optRow', 'looping QTE ring', false, (v) => { qteLoop = v; });
  toggle('optRow', 'camera sway (parallax)', false, (v) => { camSway = v; if (!v) { camera.x = 0; camera.y = 0; camera.zoom = 1; } });
  toggle('optRow', 'desaturate', false, (v) => { desatOn = v; });
  toggle('optRow', 'reduced flashing', fx.reducedFlashing, (v) => { fx.reducedFlashing = v; });

  canvas.addEventListener('pointerdown', (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 1280;
    const y = ((e.clientY - rect.top) / rect.height) * 720;
    fx.burst(x, y, selectedBurst, { dir: x < 640 ? 1 : -1 });
  });
}

// ---------------------------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------------------------

try {
  if (mode === 'icons') renderIconSheet();
  if (mode === 'title') zone = 'title';
  if (mode === 'demo') setupDemo();
  if (mode === 'bursts') setupBursts();
  if (mode === 'banners') setupBanners();
  if (mode === 'lanes') setupLanes();
  if (mode === 'interactive') setupInteractive();
  if (mode === 'perf') { zone = params.get('zone') || 'spire'; }
  requestAnimationFrame(frame);
  // Fonts arrive asynchronously; redraw static sheets once they do.
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (mode === 'icons') renderIconSheet(); });
} catch (err) {
  report(err);
}
