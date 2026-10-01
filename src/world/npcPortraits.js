// Painted busts of Expedition 69's named NPCs, merchants and ghosts for the dialogue and shop screens: the same
// coats, hats, hair and props as their world figures (entities.js NPC_LOOKS), repainted at portrait scale inside
// the medallion frame the party and boss portraits use (sprites.js renderPortrait). Canvas work only happens on
// call; import-safe in Node (returns null without a DOM).

import { NPC_LOOKS } from './entities.js';
import { makeCanvas, rgba, shade, dab, brush, glow, TAU } from './worldRender.js';
import { PALETTE } from '../render/palette.js';

/** Speaker names (lower case, leading "the " dropped) → NPC look id. */
const NAME_TO_LOOK = new Map();
for (const [id, L] of Object.entries(NPC_LOOKS)) NAME_TO_LOOK.set(normalName(L.name), id);
for (const [name, id] of [
  ['quist', 'quist'], ['pellam', 'quist'], ['orrery', 'orrery'], ['madame', 'orrery'], ['hesper', 'hesper'],
  ['drillmaster', 'hesper'], ['gull', 'gull'], ['ghost', 'ghost'], ['lost expeditioner', 'ghost'],
]) NAME_TO_LOOK.set(name, id);

/** Background disc colours per look [light, dark] (as sprites.js portraits: accent → deep ink). */
const BACKDROPS = {
  lamplighter: ['#3f7a74', '#0f1c1c'],
  cartographer: ['#b98a4a', '#241810'],
  apprentice: ['#c99a5a', '#2a1a10'],
  quist: ['#7a3a64', '#1c0f18'],
  orrery: ['#4a5a9a', '#12142a'],
  horologist: ['#8a6a3a', '#1e160c'],
  hesper: ['#a8403a', '#2a1010'],
  ghost: ['#8a7a58', '#161010'],
  ghost2: ['#8a7a58', '#161010'],
  gull: ['#5f9aa6', '#0f2a33'],
};

const _cache = new Map();

function normalName(name) {
  return String(name ?? '').trim().toLowerCase().replace(/^the\s+/, '');
}

/**
 * NPC look id for a dialogue speaker name ('Pellam Quist' → 'quist'), or null for anyone without a world figure.
 * @param {string} speakerName
 * @returns {string|null}
 */
export function npcLookFor(speakerName) {
  const n = normalName(speakerName);
  if (!n) return null;
  if (NAME_TO_LOOK.has(n)) return NAME_TO_LOOK.get(n);
  for (const word of n.split(/\s+/)) if (NAME_TO_LOOK.has(word)) return NAME_TO_LOOK.get(word);
  if (/\bghost|expeditioner\b/.test(n)) return 'ghost';
  return null;
}

/**
 * Painted bust of a named NPC, merchant or ghost (cached per look and size).
 * @param {string} speakerName dialogue speaker / shop keeper name
 * @param {number} [size=96] canvas edge in px
 * @returns {HTMLCanvasElement|null} null for unknown names or without a DOM
 */
export function npcPortrait(speakerName, size = 96) {
  const look = npcLookFor(speakerName);
  if (!look) return null;
  const S = Math.max(16, Math.round(size));
  const key = `${look}@${S}`;
  if (_cache.has(key)) return _cache.get(key);
  const c = makeCanvas(S, S);
  if (c && typeof c.getContext === 'function') {
    try {
      paintPortrait(c.getContext('2d'), look, S);
    } catch (err) {
      console.warn(`[world] npc portrait "${look}" failed:`, err?.message ?? err);
    }
  }
  const out = c && typeof c.toDataURL === 'function' ? c : null;
  _cache.set(key, out);
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════ painting (100 × 100 units)

function paintPortrait(g, look, S) {
  const L = NPC_LOOKS[look];
  const [bg0, bg1] = BACKDROPS[look] ?? ['#5a4a3a', '#1c1512'];
  const R = S / 2;
  // background disc with brush strokes and a warm glow from the top-right (sprites.js portrait frame)
  const bg = g.createRadialGradient(R * 0.8, R * 0.7, R * 0.1, R, R, R);
  bg.addColorStop(0, bg0);
  bg.addColorStop(1, bg1);
  g.fillStyle = bg;
  g.beginPath();
  g.arc(R, R, R - 0.5, 0, TAU);
  g.fill();
  g.save();
  g.beginPath();
  g.arc(R, R, R - 0.5, 0, TAU);
  g.clip();
  for (let i = 0; i < 7; i++) {
    const h = frac(Math.sin((i + 1) * 91.7 + look.length * 13.1) * 43758.5453);
    g.beginPath();
    g.arc(R + (h - 0.5) * R * 0.6, R + (frac(h * 7.3) - 0.5) * R * 0.6, R * (0.45 + h * 0.5), h * TAU, h * TAU + 1.2 + h);
    g.strokeStyle = rgba(i % 2 ? bg0 : '#fff1d0', 0.07 + h * 0.07);
    g.lineWidth = R * (0.12 + h * 0.18);
    g.lineCap = 'round';
    g.stroke();
  }
  glow(g, R * 1.35, R * 0.55, R * 0.9, '#ffd9a0', 0.25);
  g.scale(S / 100, S / 100);
  if (L.gull) paintGull(g);
  else if (L.ghost) {
    // a lost expeditioner: the same bust in pale gold light, only half there
    glow(g, 50, 50, 46, '#ffe0a0', 0.2);
    g.globalAlpha = 0.5;
    paintBust(g, L);
    g.globalAlpha = 1;
    glow(g, 50, 44, 24, '#fff0c0', 0.16);
  } else paintBust(g, L);
  g.restore();
  // vignette + gilded rim
  const vg = g.createRadialGradient(R, R, R * 0.55, R, R, R);
  vg.addColorStop(0, 'rgba(10,6,8,0)');
  vg.addColorStop(1, 'rgba(10,6,8,0.55)');
  g.fillStyle = vg;
  g.beginPath();
  g.arc(R, R, R - 0.5, 0, TAU);
  g.fill();
  g.beginPath();
  g.arc(R, R, R - Math.max(0.8, S * 0.02), 0, TAU);
  g.strokeStyle = rgba(PALETTE.gold, 0.85);
  g.lineWidth = Math.max(1, S * 0.03);
  g.stroke();
}

function frac(v) {
  return v - Math.floor(v);
}

/** Shoulders, head, face, hair, hat and props of a standing figure's look, facing a little to the right. */
function paintBust(g, L) {
  const coat = L.coat;
  const lit = shade(coat, 0.32);
  const dark = shade(coat, -0.5);
  const skin = L.skin;
  const ink = 'rgba(21,14,12,0.6)';
  const hx = 50;
  const hy = 44;
  g.lineJoin = 'round';
  g.lineCap = 'round';

  // trinket pack behind the shoulder (Quist)
  if (L.prop === 'pack') {
    g.fillStyle = '#6a4a2e';
    g.beginPath();
    g.roundRect(14, 50, 26, 50, 6);
    g.fill();
    g.fillStyle = '#c9a052';
    g.fillRect(13, 64, 28, 3);
    dab(g, 22, 50, 8, 4, 0, '#8a6a4a');
    dab(g, 19, 78, 3.4, 3.4, 0, '#e0b458');
    dab(g, 30, 86, 2.6, 2.6, 0, '#9fd9f0');
  }
  // hair falling behind the head (long hair, buns)
  if (L.hat === 'bun' || L.dress) {
    g.fillStyle = shade(L.hair, -0.15);
    g.beginPath();
    g.ellipse(hx - 3, hy + 6, 17, 20, 0, 0, TAU);
    g.fill();
  }

  // shoulders and coat
  g.beginPath();
  g.moveTo(8, 100);
  g.bezierCurveTo(8, 80, 18, 69, 36, 66);
  g.quadraticCurveTo(50, 62, 64, 66);
  g.bezierCurveTo(82, 69, 92, 80, 92, 100);
  g.closePath();
  const cg = g.createLinearGradient(10, 0, 90, 0);
  cg.addColorStop(0, dark);
  cg.addColorStop(0.55, coat);
  cg.addColorStop(1, lit);
  g.fillStyle = cg;
  g.fill();
  g.strokeStyle = ink;
  g.lineWidth = 1;
  g.stroke();
  // shawl draped over the shoulders (Orrery)
  if (L.shawl) {
    g.fillStyle = rgba(L.shawl, 0.92);
    g.beginPath();
    g.moveTo(14, 84);
    g.quadraticCurveTo(22, 68, 38, 66);
    g.quadraticCurveTo(50, 86, 62, 66);
    g.quadraticCurveTo(78, 68, 86, 84);
    g.quadraticCurveTo(50, 104, 14, 84);
    g.fill();
    g.strokeStyle = rgba(shade(L.shawl, -0.4), 0.8);
    g.lineWidth = 0.8;
    g.stroke();
  }
  // apron bib (Apprentice, Horologist)
  if (L.apron) {
    g.fillStyle = L.apron;
    g.beginPath();
    g.moveTo(40, 100);
    g.lineTo(41, 74);
    g.lineTo(59, 74);
    g.lineTo(60, 100);
    g.closePath();
    g.fill();
    g.strokeStyle = shade(L.apron, -0.35);
    g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(41, 74);
    g.lineTo(36, 66);
    g.moveTo(59, 74);
    g.lineTo(64, 66);
    g.stroke();
  }
  // coat opening, collar and buttons in the trim colour
  if (!L.apron && !L.shawl) {
    g.strokeStyle = L.trim;
    g.lineWidth = 1.6;
    g.beginPath();
    g.moveTo(52, 70);
    g.quadraticCurveTo(51, 86, 52, 100);
    g.stroke();
    for (let k = 0; k < 3; k++) dab(g, 56, 78 + k * 8, 1.5, 1.5, 0, L.trim);
  }
  g.fillStyle = shade(coat, -0.2);
  g.beginPath();
  g.moveTo(38, 66);
  g.lineTo(47, 78);
  g.lineTo(50, 66);
  g.closePath();
  g.moveTo(62, 66);
  g.lineTo(54, 78);
  g.lineTo(50, 66);
  g.closePath();
  g.fill();
  g.strokeStyle = rgba(L.trim, 0.8);
  g.lineWidth = 1;
  g.stroke();
  if (L.epaulettes) {
    for (const [x, a] of [[24, -0.35], [76, 0.35]]) {
      dab(g, x, 71, 9, 4, a, L.trim);
      for (let k = -3; k <= 3; k++) brush(g, x + k * 2.2, 73, 6, 1, Math.PI / 2 + a, shade(L.trim, -0.2));
    }
  }
  if (L.satchel) {
    g.strokeStyle = '#4a3020';
    g.lineWidth = 3.4;
    g.beginPath();
    g.moveTo(30, 68);
    g.lineTo(72, 100);
    g.stroke();
  }
  if (L.prop === 'pack') {
    g.strokeStyle = '#4a3020';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(40, 66);
    g.quadraticCurveTo(36, 84, 34, 100);
    g.stroke();
  }

  // neck and head
  dab(g, hx + 1, hy + 18, 7, 7, 0, shade(skin, -0.22));
  const hg = g.createRadialGradient(hx + 5, hy - 5, 2, hx, hy, 19);
  hg.addColorStop(0, shade(skin, 0.22));
  hg.addColorStop(1, shade(skin, -0.28));
  g.fillStyle = hg;
  g.beginPath();
  g.ellipse(hx, hy, 14.5, 17, 0, 0, TAU);
  g.fill();
  dab(g, hx - 14, hy + 1, 3, 4.4, 0, shade(skin, -0.12)); // ear (the head turns a little right)
  // cheeks
  dab(g, hx - 6, hy + 7, 4, 2.6, 0, rgba('#e07a6a', 0.22));
  dab(g, hx + 9, hy + 7, 3.2, 2.4, 0, rgba('#e07a6a', 0.18));

  // hair (cropped top; white sides for the Horologist)
  g.fillStyle = L.hair;
  g.beginPath();
  if (L.hat === 'none') {
    g.ellipse(hx - 12, hy - 2, 4.5, 8, 0.2, 0, TAU);
    g.ellipse(hx + 12.5, hy - 2, 3.6, 7, -0.2, 0, TAU);
  } else {
    g.ellipse(hx - 2, hy - 8, 15.5, 11, -0.12, Math.PI * 0.95, Math.PI * 2.05);
  }
  g.fill();
  if (L.hat === 'bun') dab(g, hx - 6, hy - 18, 7.5, 6.5, 0, L.hair);

  // face: brows, eyes, nose, mouth — turned a touch to the right
  const brow = shade(L.hair, -0.25);
  brush(g, hx - 10, hy - 3, 7, 1.8, -0.12, brow);
  brush(g, hx + 3, hy - 3.6, 7, 1.8, 0.1, brow);
  for (const [ex, w] of [[hx - 6, 2.6], [hx + 7, 2.3]]) {
    dab(g, ex, hy + 1, w, 1.9, 0, '#f6ecdc');
    dab(g, ex + 0.6, hy + 1.1, 1.4, 1.6, 0, '#2a1c14');
    dab(g, ex + 1.1, hy + 0.4, 0.45, 0.45, 0, '#fff');
  }
  g.strokeStyle = shade(skin, -0.38);
  g.lineWidth = 1.3;
  g.beginPath();
  g.moveTo(hx + 1.5, hy + 2);
  g.quadraticCurveTo(hx + 4.5, hy + 8, hx + 1, hy + 9.2);
  g.stroke();
  if (!L.beard && !L.moustache) {
    g.strokeStyle = shade(skin, -0.45);
    g.lineWidth = 1.4;
    g.beginPath();
    g.moveTo(hx - 3.5, hy + 12.5);
    g.quadraticCurveTo(hx + 1, hy + 14.5, hx + 5, hy + 12);
    g.stroke();
  }
  if (L.beard) {
    g.fillStyle = L.hair;
    g.beginPath();
    g.moveTo(hx - 13, hy + 3);
    g.quadraticCurveTo(hx - 12, hy + 20, hx + 1, hy + 23);
    g.quadraticCurveTo(hx + 13, hy + 20, hx + 13.5, hy + 3);
    g.quadraticCurveTo(hx + 8, hy + 10, hx, hy + 9.5);
    g.quadraticCurveTo(hx - 8, hy + 10, hx - 13, hy + 3);
    g.fill();
    g.strokeStyle = rgba(shade(L.hair, -0.3), 0.6);
    g.lineWidth = 0.7;
    for (let k = 0; k < 5; k++) {
      g.beginPath();
      g.moveTo(hx - 8 + k * 4, hy + 11);
      g.lineTo(hx - 7 + k * 3.6, hy + 19);
      g.stroke();
    }
  }
  if (L.moustache) {
    g.fillStyle = L.hair;
    for (const s of [-1, 1]) {
      g.beginPath();
      g.moveTo(hx + 1, hy + 10);
      g.quadraticCurveTo(hx + 1 + s * 6, hy + 8.5, hx + 1 + s * 10, hy + 7);
      g.quadraticCurveTo(hx + 1 + s * 7, hy + 12.5, hx + 1, hy + 11.8);
      g.fill();
    }
  }
  if (L.glasses) {
    g.strokeStyle = '#e0c070';
    g.lineWidth = 1.2;
    g.beginPath();
    g.arc(hx - 6, hy + 1, 4.4, 0, TAU);
    g.moveTo(hx + 11.4, hy + 1);
    g.arc(hx + 7, hy + 1, 4.2, 0, TAU);
    g.moveTo(hx - 1.6, hy + 0.5);
    g.lineTo(hx + 2.8, hy + 0.5);
    g.stroke();
  }
  if (L.prop === 'loupe') {
    // the Horologist's eyeglass loupe over the right eye
    g.fillStyle = '#3a2a14';
    g.beginPath();
    g.ellipse(hx + 7, hy + 1, 6, 5.4, 0, 0, TAU);
    g.fill();
    g.fillStyle = rgba('#bfe0f0', 0.55);
    g.beginPath();
    g.ellipse(hx + 7, hy + 1, 4.2, 3.8, 0, 0, TAU);
    g.fill();
    g.strokeStyle = '#e8c16a';
    g.lineWidth = 1.2;
    g.stroke();
  }

  // hats
  const hc = L.hatCol ?? '#2a2420';
  const band = rgba(L.trim, 0.9);
  if (L.hat === 'brim') {
    dab(g, hx, hy - 13, 25, 5, -0.05, hc);
    g.fillStyle = hc;
    g.beginPath();
    g.roundRect(hx - 12, hy - 31, 24, 19, 6);
    g.fill();
    g.fillStyle = band;
    g.fillRect(hx - 12, hy - 18, 24, 3.2);
    g.fillStyle = 'rgba(255,240,220,0.16)';
    g.fillRect(hx + 6, hy - 29, 2.4, 13);
  } else if (L.hat === 'top') {
    dab(g, hx, hy - 13, 21, 4.4, 0, hc);
    g.fillStyle = hc;
    g.fillRect(hx - 11.5, hy - 42, 23, 30);
    dab(g, hx, hy - 42, 11.5, 2.4, 0, shade(hc, 0.1));
    g.fillStyle = L.trim;
    g.fillRect(hx - 11.5, hy - 19, 23, 3.6);
    g.fillStyle = 'rgba(255,240,220,0.22)';
    g.fillRect(hx + 6, hy - 40, 2.6, 26);
  } else if (L.hat === 'tricorn') {
    g.fillStyle = hc;
    g.beginPath();
    g.moveTo(hx - 24, hy - 12);
    g.quadraticCurveTo(hx - 6, hy - 38, hx, hy - 30);
    g.quadraticCurveTo(hx + 8, hy - 38, hx + 24, hy - 12);
    g.quadraticCurveTo(hx, hy - 20, hx - 24, hy - 12);
    g.fill();
    g.strokeStyle = rgba(L.trim, 0.85);
    g.lineWidth = 1.4;
    g.beginPath();
    g.moveTo(hx - 22, hy - 13);
    g.quadraticCurveTo(hx, hy - 21, hx + 22, hy - 13);
    g.stroke();
  } else if (L.hat === 'cap') {
    g.fillStyle = hc;
    g.beginPath();
    g.ellipse(hx - 1, hy - 12, 16, 10, 0, Math.PI, TAU);
    g.fill();
    dab(g, hx + 12, hy - 11.5, 10, 3, 0.08, shade(hc, -0.15));
    dab(g, hx - 1, hy - 21, 2, 2, 0, shade(hc, 0.3));
  } else if (L.hat === 'feather') {
    dab(g, hx, hy - 14, 22, 4.4, -0.1, hc);
    g.fillStyle = hc;
    g.beginPath();
    g.ellipse(hx, hy - 18, 12.5, 9, 0, Math.PI, TAU);
    g.fill();
    g.fillStyle = band;
    g.fillRect(hx - 12, hy - 19, 24, 2.6);
    brush(g, hx - 6, hy - 20, 30, 7, -2.3, '#f0e8d8');
    brush(g, hx - 6, hy - 20, 26, 2.4, -2.28, 'rgba(160,140,120,0.6)');
  }

  // props in hand at the bust's edge, with their light
  if (L.prop === 'lanternPole') {
    g.strokeStyle = '#3a281e';
    g.lineWidth = 2.6;
    g.beginPath();
    g.moveTo(84, 100);
    g.lineTo(86, 22);
    g.stroke();
    g.fillStyle = '#2a1c14';
    g.fillRect(80, 22, 13, 17);
    g.fillStyle = '#ffd27a';
    g.fillRect(82, 24, 9, 13);
    glow(g, 86.5, 30, 26, '#ffb45a', 0.55);
    glow(g, 86.5, 30, 8, '#fff0c0', 0.7);
  } else if (L.prop === 'map') {
    g.fillStyle = '#efe0bc';
    g.beginPath();
    g.moveTo(56, 100);
    g.lineTo(62, 84);
    g.lineTo(94, 88);
    g.lineTo(92, 100);
    g.closePath();
    g.fill();
    g.strokeStyle = 'rgba(120,80,40,0.7)';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(66, 92);
    g.quadraticCurveTo(74, 86, 84, 94);
    g.stroke();
    dab(g, 78, 91, 1.8, 1.8, 0, '#a3302a');
  } else if (L.prop === 'sunToy') {
    const x = 80;
    const y = 88;
    glow(g, x, y, 20, '#ffd27a', 0.6);
    dab(g, x, y, 6, 6, 0, '#e0b458');
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU;
      brush(g, x + Math.cos(a) * 7, y + Math.sin(a) * 7, 4, 1.8, a, '#e0b458');
    }
  } else if (L.prop === 'orb') {
    glow(g, 80, 88, 22, '#b89cff', 0.6);
    dab(g, 80, 88, 7.5, 7.5, 0, '#8a6ac4');
    dab(g, 78, 86, 2.6, 2.6, 0, '#f0e8ff');
  } else if (L.prop === 'cane') {
    dab(g, 82, 92, 4, 4, 0, '#e0b458');
    g.strokeStyle = '#2a1c14';
    g.lineWidth = 2.4;
    g.beginPath();
    g.moveTo(82, 95);
    g.lineTo(84, 100);
    g.stroke();
  }
  // sunlit rim down the right side of head and shoulders
  g.strokeStyle = 'rgba(255,236,196,0.5)';
  g.lineWidth = 1.2;
  g.beginPath();
  g.ellipse(hx, hy, 14.5, 17, 0, -Math.PI * 0.45, Math.PI * 0.2);
  g.stroke();
  g.beginPath();
  g.moveTo(66, 66.5);
  g.bezierCurveTo(82, 70, 90, 80, 91, 96);
  g.stroke();
}

/** The frozen gull, in mid-squawk. */
function paintGull(g) {
  g.fillStyle = '#e8e4dc';
  g.beginPath();
  g.moveTo(20, 96);
  g.quadraticCurveTo(10, 70, 30, 58);
  g.quadraticCurveTo(46, 52, 52, 66);
  g.closePath();
  g.fill();
  g.fillStyle = '#5a5a60';
  brush(g, 14, 88, 30, 8, -1.1, '#4a4a52');
  dab(g, 52, 48, 17, 15, 0, '#f5f2ec');
  dab(g, 44, 72, 16, 14, 0, '#f5f2ec');
  g.fillStyle = '#f0b040';
  g.beginPath();
  g.moveTo(66, 44);
  g.lineTo(88, 38);
  g.lineTo(68, 48);
  g.lineTo(86, 55);
  g.lineTo(65, 51);
  g.closePath();
  g.fill();
  dab(g, 84, 53, 1.8, 1.8, 0, '#c0402a');
  dab(g, 58, 43, 2.4, 2.4, 0, '#1e1410');
  dab(g, 58.6, 42.4, 0.7, 0.7, 0, '#fff');
  for (let i = 0; i < 6; i++) dab(g, 16 + i * 13, 22 + (i % 2) * 10, 1.4, 1.4, 0, 'rgba(234,250,244,0.8)');
}
