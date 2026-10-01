// Brinegate Shore enemy looks: Driftling (jellyfish lantern), Shellguard (hermit-crab knight),
// Tidecaller (fish-headed acolyte) and the Wreck Warden mini-boss (barnacled diving-suit golem).

/**
 * Build the shore look definitions with the shared sprite kit.
 * @param {object} K painting kit from sprites.js
 * @returns {Record<string, object>}
 */
export function defineShoreLooks(K) {
  const { D, TAU, clamp, lerp, hash, shade, rgba, paint, paintR, paintAxis, fill, stroke, capsule, limb, ell, circ,
    poly, blob, line, curve, glow, frame, unframe, foot, hand, along, sprite, strip, polyline, pt, mitt } = K;
  const tmp = { x: 0, y: 0 }, tmp2 = { x: 0, y: 0 };
  const PARTY_ALIAS = { flurry: 'thrust', heavy: 'slam', leap: 'slam', buff: 'cast', heal: 'cast', shoot: 'bolt', gradient: 'nova' };

  // ================================================================== DRIFTLING
  const DC = { bell: '#63cfc6', bellD: '#2b7f86', rim: '#c9fbf2', brass: '#caa04a', core: '#ffe6a0', coreGlow: '#7ff0e6', rib1: '#6fe0d4', rib2: '#f3dba0' };
  const DF = ['bx', 'by', 'rot', 'sq', 'lash', 'ribs', 'core', 'ch', 'rel', 'air', 'sx', 'ex'];
  const DR = 34, DH = 40;

  function driftRibbons(ctx, J, st, front) {
    const t = st.t;
    const cr = Math.cos(J.rot), sr = Math.sin(J.rot);
    const w = DR * (1 + J.sq * 0.3);
    const idx = front ? [1, 3, 5] : [0, 2, 4, 6];
    for (const i of idx) {
      const u = i / 6 - 0.5;
      const rx = u * w * 1.7, ry = 2;
      const x0 = J.body.x + rx * cr - ry * sr, y0 = J.body.y + rx * sr + ry * cr;
      const len = 62 + hash(i * 3.7) * 22 - J.ribs * 10;
      const pts = [];
      for (let k = 0; k <= 7; k++) {
        const v = k / 7;
        const wave = Math.sin(t * 0.0032 + v * 4.2 + i * 1.3 + st.seed) * (4 + v * 9);
        const spread = u * v * (14 + J.ribs * 30);
        pts.push(x0 + wave + spread + J.lash * v * v * 46 - Math.abs(J.lash) * v * 4, y0 + v * len * (1 - Math.abs(J.lash) * 0.35) - J.lash * v * v * 12);
      }
      strip(ctx, pts, front ? 5.5 : 4.5, 0.6);
      const c = i % 2 ? DC.rib2 : DC.rib1;
      if (st.ghost) { fill(ctx, c, 0.5); continue; }
      ctx.fillStyle = rgba(front ? c : shade(c, -0.25), front ? 0.72 : 0.5);
      ctx.fill();
      polyline(ctx, pts);
      stroke(ctx, '#ffffff', 0.7, front ? 0.45 : 0.2);
    }
  }

  function driftBellArt(ctx, st) {
    // dome
    ctx.beginPath();
    ctx.moveTo(-DR, 0);
    ctx.bezierCurveTo(-DR, -DH * 1.25, DR, -DH * 1.25, DR, 0);
    for (let i = 0; i < 6; i++) {
      const x1 = DR - ((i + 1) * 2 * DR) / 6, xm = DR - ((i + 0.5) * 2 * DR) / 6;
      ctx.quadraticCurveTo(xm, 7, x1, 0);
    }
    ctx.closePath();
    if (st.ghost) { fill(ctx, DC.bell, 0.6); return; }
    const g = ctx.createRadialGradient(st.lx * 10, -DH * 0.55 + st.ly * 10, 3, 0, -DH * 0.4, DR * 1.25);
    g.addColorStop(0, rgba('#d8fff9', 0.75));
    g.addColorStop(0.5, rgba(DC.bell, 0.55));
    g.addColorStop(1, rgba(DC.bellD, 0.85));
    ctx.lineWidth = st.olw * 1.6; ctx.strokeStyle = rgba('#0d3438', 0.55); ctx.stroke();
    ctx.fillStyle = g; ctx.fill();
    K.rim(ctx, 0, -DH * 0.5, DR, st, 0.9, 1.2, DC.rim);
    // lantern cage
    for (const u of [-0.55, 0, 0.55]) {
      curve(ctx, u * DR * 0.35, -DH * 0.92, u * DR * 1.05, -DH * 0.6, u * DR * 0.9, -1);
      stroke(ctx, DC.brass, 1.6, 0.85);
    }
    ell(ctx, 0, -DH * 0.9, 7, 2.6);
    paint(ctx, DC.brass, 0, -DH * 0.9, 6, st, 0.6, 0.6);
    curve(ctx, -3, -DH * 0.95, 0, -DH * 1.18, 3, -DH * 0.95); stroke(ctx, DC.brass, 1.4);
    // specular
    curve(ctx, -DR * 0.62, -DH * 0.45, -DR * 0.5, -DH * 0.88, -DR * 0.1, -DH * 0.97);
    stroke(ctx, '#ffffff', 2, 0.35);
  }

  const driftling = K.custom({
    id: 'driftling', name: 'Driftling', kind: 'enemy', height: 130, fields: DF, floating: true, hover: 92, jumpH: 46,
    magic: '#8ff7ea', fxScale: 0.9, shadowRx: 30, defaultVariant: 'thrust', variantAlias: PARTY_ALIAS, noExtrap: ['ch', 'rel', 'sx', 'air', 'ex', 'core'],
    ready: { bx: 0, by: 0, rot: 0, sq: 0, lash: 0, ribs: 0, core: 0, ch: 0, rel: 0, air: 0, sx: 1, ex: 0 },
    book: {
      guard: { sq: 0.25, by: 8, ribs: -0.5 },
      parry: { sq: 0.3, rot: -0.2, bx: -6 },
      dodge: { bx: -46, by: -12, rot: -0.5, sq: -0.2, lash: -1 },
      hurt: { bx: -14, rot: -0.45, sq: 0.35, lash: -0.6, ribs: 0.6 },
      cast: { g: { sq: -0.2, by: -10, ribs: 0.6, core: 1 }, r: { sq: 0.3, ribs: 1, core: 1 } },
      aimNear: { rot: 0.1, core: 0.5 }, aimFar: { rot: 0.1, core: 0.5 },
      ko: { a: { by: 30, rot: 0.6, sq: 0.3, ribs: -0.5 }, b: { by: 64, rot: 1.1, sq: 0.4, ribs: -1, core: -1 } },
      victory: { by: -14, sq: -0.2, ribs: 0.8, core: 0.6 },
      jump: { crouch: { sq: 0.3, by: 8 }, up: { sq: -0.25, by: -5 }, tuck: { sq: 0.05 }, land: { sq: 0.35, by: 6 } },
      carry: {},
      variants: {
        slash: { a: { bx: -12, rot: -0.35, lash: -1, ribs: 0.4 }, c: { bx: 30, rot: 0.4, lash: 1.2, ribs: 0.5 }, f: { bx: 30, rot: 0.3, lash: 0.8 } },
        thrust: { a: { bx: -20, sq: 0.3, lash: -0.8 }, c: { bx: 40, sq: -0.3, lash: 1.4, rot: 0.2 }, f: { bx: 40, lash: 1.1 } },
        slam: { a: { by: -40, sq: -0.3, ribs: 0.7 }, c: { by: 22, sq: 0.45, ribs: 1, lash: 0.3 }, f: { by: 22, sq: 0.35 } },
        bite: { a: { bx: -10, sq: -0.35, rot: -0.3 }, c: { bx: 34, sq: 0.45, rot: 0.25, lash: 0.6 }, f: { bx: 32, sq: 0.25 } },
        spin: {
          a: { rot: -0.6, ribs: 0.5 }, c: { rot: 0.5, ribs: 1, lash: 0.8, bx: 16 }, f: { rot: 0.2, ribs: 0.4, bx: 16 },
          windup: [[0, 'R'], [0.42, 'A', 'outCubic'], [0.8, 'A2'], [0.9, { rot: 0.2, ribs: 1, sx: -1, bx: 8 }, 'linear'], [1, 'C', 'linear']],
        },
        charge: { a: { bx: -24, by: 6, sq: 0.35, rot: 0.3, lash: -1 }, c: { bx: 50, by: 10, sq: -0.3, rot: 0.45, lash: -1.2 }, f: { bx: 46, rot: 0.3 } },
        bolt: { a: { by: -8, sq: -0.2, core: 1, ribs: 0.5 }, c: { bx: 8, sq: 0.35, core: 1, rot: 0.2 }, f: { bx: 6, sq: 0.1 }, gather: true },
        wave: { a: { by: -30, sq: -0.3, ribs: 0.8 }, c: { by: 16, sq: 0.5, ribs: 1.2 }, f: { by: 14, sq: 0.3 }, gather: true },
        beam: { a: { rot: -0.2, core: 1, sq: -0.1 }, c: { rot: 0.25, core: 1, sq: 0.2 }, f: { rot: 0.2, core: 0.6 }, gather: true, sustain: true },
        nova: { a: { sq: 0.4, ribs: -0.8, core: 1 }, c: { sq: -0.35, ribs: 1.4, core: 1 }, f: { sq: -0.1, ribs: 0.6 }, gather: true },
        cast: { a: { by: -12, ribs: 0.6, core: 1 }, c: { sq: 0.25, core: 1, ribs: 1 }, f: { sq: 0.1, ribs: 0.4 }, gather: true },
      },
    },
    newJ() { return { body: pt(), core: pt(), rot: 0, sq: 0, lash: 0, ribs: 0, corev: 0, ch: 0, rel: 0, sx: 1, air: 0, ex: 0, rootX: 0, P: null }; },
    solve(look, P, J) {
      const f = look.fi;
      J.P = P;
      J.air = P[f.air];
      J.rootX = P[f.bx];
      J.body.x = P[f.bx]; J.body.y = -look.hover + P[f.by] - J.air;
      J.rot = P[f.rot]; J.sq = P[f.sq]; J.lash = P[f.lash]; J.ribs = P[f.ribs]; J.corev = P[f.core];
      J.ch = P[f.ch]; J.rel = P[f.rel]; J.sx = P[f.sx]; J.ex = P[f.ex];
      const cy = -DH * 0.45 * (1 - J.sq * 0.3);
      J.core.x = J.body.x - Math.sin(J.rot) * cy; J.core.y = J.body.y + Math.cos(J.rot) * cy;
    },
    breathe(look, P, st, amt) {
      const f = look.fi;
      P[f.by] += Math.sin(st.t * (TAU / 2400) + st.seed) * 6 * Math.max(amt, 0.6);
      P[f.sq] += Math.sin(st.t * (TAU / 1300) + st.seed) * 0.08;
      P[f.rot] += Math.sin(st.t * (TAU / 3100) + st.seed) * 0.05;
    },
    tremble(look, P, st, k) { P[look.fi.bx] += Math.sin(st.t * 0.09 + st.seed) * 1.5 * k; },
    slump(look, P) { P[look.fi.by] += 14; P[look.fi.rot] += 0.35; P[look.fi.core] -= 0.5; },
    locomotion(look, P, run, phase) {
      const f = look.fi;
      P.set(look._carry);
      P[f.by] = Math.sin(phase * TAU) * 5;
      P[f.sq] = Math.sin(phase * TAU * 2) * 0.12;
      P[f.rot] = run ? 0.32 : 0.1;
      P[f.lash] = run ? -0.9 : -0.4;
    },
    anchors(look, J, o) {
      o.head.x = J.body.x; o.head.y = J.body.y - DH * 0.7;
      o.chest.x = J.core.x; o.chest.y = J.core.y;
      o.weapon.x = J.body.x + 22 + J.lash * 26; o.weapon.y = J.body.y + 30;
      o.feet.x = J.body.x; o.feet.y = 0;
      o.top.x = J.body.x; o.top.y = J.body.y - DH * 1.05;
      o.center.x = J.body.x; o.center.y = J.body.y - 4;
      o.tip.x = o.weapon.x; o.tip.y = o.weapon.y;
    },
    bounds(look, J, o) { o[0] = J.body.x - DR - 4; o[1] = J.body.y - DH - 6; o[2] = J.body.x + DR + 4; o[3] = J.body.y + 46; },
    extent(look, J, o) { o[0] = J.body.x - DR - 70; o[1] = J.body.y - DH - 40; o[2] = J.body.x + DR + 80; o[3] = Math.max(0, J.body.y + 100); },
    castPoint(J, o) { o.x = J.core.x; o.y = J.core.y; },
    weak: [{ id: 'core', r: 16, at(J, o) { o.x = J.core.x; o.y = J.core.y; } }],
    portrait: { abs: false, x: 0, y: 26, r: 42, bg: ['#3f8fa0', '#0f2a33'] },
    draw(ctx, J, st) {
      const t = st.t;
      driftRibbons(ctx, J, st, false);
      frame(ctx, st, J.body.x, J.body.y, J.rot, 1 + J.sq * 0.3, 1 - J.sq * 0.3);
      // core (behind dome glass)
      const cy = -DH * 0.45;
      const fl = 0.8 + 0.2 * Math.sin(t * 0.011 + st.seed) + J.corev * 0.4;
      if (!st.ghost) glow(ctx, 0, cy, 30 * fl, DC.coreGlow, 0.55);
      circ(ctx, 0, cy, 8.5);
      if (!st.ghost) {
        const g = ctx.createRadialGradient(-2, cy - 2, 1, 0, cy, 9);
        g.addColorStop(0, '#ffffff'); g.addColorStop(0.5, DC.core); g.addColorStop(1, '#e0a040');
        ctx.fillStyle = g; ctx.fill();
      } else fill(ctx, DC.core);
      sprite(ctx, st, 'driftling:bell', DR * 2 + 8, DH * 1.4 + 14, DR + 4, DH * 1.25 + 4, driftBellArt);
      if (!st.ghost) glow(ctx, 0, cy, 13 * fl, '#fff6d0', 0.6);
      unframe(ctx, st);
      driftRibbons(ctx, J, st, true);
    },
  });

  // ================================================================== SHELLGUARD
  const SG = { shell: '#d8643a', shellD: '#8a2f1c', belly: '#efc39a', conch: '#f1d9c5', conchIn: '#e59a98', pearl: '#ebe1d2', spiral: '#8d9aa3',
    eye: '#15100d', eyeRing: '#f4d25a' };

  /** Arched crab leg from a hip point to a pointed tip at the humanoid foot target. */
  function crabLeg(ctx, hip, f, st, c, off, lift) {
    const hx = hip.x + off * 0.35, hy = hip.y - 3;
    const tx = f.x + off * 2.1, ty = f.y + 5;
    const out = off < 0 ? -1 : 1;
    const kx = lerp(hx, tx, 0.55) + out * 5, ky = hy - 9 - lift * 0.5;
    limb(ctx, hx, hy, kx, ky, 5, 4.2, c, st, 1, 0.6);
    limb(ctx, kx, ky, tx, ty, 4.2, 1.1, c, st, 1, 0.6);
    circ(ctx, kx, ky, 3.3); paintR(ctx, shade(c, 0.14), kx, ky, 3.3, st, 0.6, 0.5);
    for (let i = 1; i < 3; i++) { along(tmp, kx, ky, tx, ty, i * 0.3); circ(ctx, tmp.x, tmp.y, 1); fill(ctx, shade(c, -0.3)); }
  }

  function shellShieldArt(ctx, st) {
    const r = 25;
    circ(ctx, 0, 0, r);
    paintR(ctx, SG.pearl, 0, 0, r, st, 1.2, 0.9);
    // spiral grooves
    ctx.beginPath();
    for (let i = 0; i <= 60; i++) {
      const a = i * 0.26, rr = r * 0.92 * (1 - i / 66);
      const x = Math.cos(a) * rr, y = Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    stroke(ctx, SG.spiral, 1.6, 0.7);
    for (let i = 0; i < 8; i++) {
      const a = (i * TAU) / 8;
      line(ctx, Math.cos(a) * r * 0.62, Math.sin(a) * r * 0.62, Math.cos(a) * r * 0.97, Math.sin(a) * r * 0.97);
      stroke(ctx, shade(SG.pearl, -0.25), 1, 0.6);
    }
    circ(ctx, 0, 0, 4); paintR(ctx, '#f7ecff', 0, 0, 4, st, 0.6, 0.8);
    curve(ctx, -r * 0.7, -r * 0.35, -r * 0.4, -r * 0.8, r * 0.05, -r * 0.88); stroke(ctx, '#ffffff', 1.6, 0.45);
  }

  function shellTorsoArt(ctx, st) {
    const T = 38;
    blob(ctx, [-15, 4, -19, -14, -17, -30, -9, -T - 2, 3, -T - 2, 14, -32, 17, -14, 13, 4]);
    paint(ctx, SG.shell, 0, -T * 0.5, 22, st, 1, 0.85);
    // belly plates
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.ellipse(8, -6 - i * 7.5, 7.5 - i * 0.6, 3.6, -0.15, 0, TAU);
      paint(ctx, SG.belly, 8, -6 - i * 7.5, 7, st, 0.6, 0.6);
    }
    // carapace bumps
    for (let i = 0; i < 6; i++) {
      const x = -12 + (i % 3) * 5 + hash(i) * 2, y = -30 + Math.floor(i / 3) * 9 + hash(i * 2) * 3;
      circ(ctx, x, y, 2.2); paintR(ctx, shade(SG.shell, 0.15), x, y, 2.2, st, 0.4, 0.5);
    }
    // mandibles
    poly(ctx, [10, -T + 1, 17, -T + 5, 11, -T + 7]); paint(ctx, SG.shellD, 13, -T + 4, 4, st, 0.6, 0.5);
  }

  function conchArt(ctx, st) {
    // conch worn as a helm: body whorl over the head, spire pointing back, aperture facing forward
    // knobs on the shoulder (behind the silhouette edge)
    for (let i = 0; i < 5; i++) {
      const x = -14 + i * 7, y = -19 - Math.sin((i / 4) * Math.PI) * 4;
      poly(ctx, [x - 3.4, y + 3, x + 0.5, y - 6.5, x + 3.4, y + 3]);
      paint(ctx, shade(SG.conch, -0.08), x, y, 5, st, 0.7, 0.6);
    }
    ctx.beginPath();
    ctx.moveTo(8, 9);
    ctx.quadraticCurveTo(-6, 12, -16, 5);
    ctx.quadraticCurveTo(-24, 0, -34, -10);
    ctx.quadraticCurveTo(-26, -17, -16, -18);
    ctx.quadraticCurveTo(0, -27, 14, -15);
    ctx.quadraticCurveTo(21, -8, 19, 1);
    ctx.quadraticCurveTo(15, 7, 8, 9);
    ctx.closePath();
    paint(ctx, SG.conch, -4, -6, 22, st, 1.1, 0.95);
    // spiral sutures on the spire
    for (let i = 0; i < 4; i++) {
      const x = -30 + i * 5.5;
      curve(ctx, x, -12 + i * 0.5, x + 3, -5 + i, x + 6, -15 + i * 0.3);
      stroke(ctx, shade(SG.conch, -0.32), 1.1, 0.75);
    }
    curve(ctx, -12, 6, -6, -8, 6, -12); stroke(ctx, shade(SG.conch, -0.25), 1.1, 0.6);
    // bands of colour
    curve(ctx, -14, 3, 0, -2, 14, -9); stroke(ctx, '#c98b6f', 2.2, 0.55);
    // aperture: flared pink lip + dark mouth
    ctx.beginPath();
    ctx.moveTo(5, 10);
    ctx.quadraticCurveTo(9, -6, 19, -9);
    ctx.quadraticCurveTo(25, 2, 16, 11);
    ctx.closePath();
    paint(ctx, SG.conchIn, 14, 2, 9, st, 0.9, 0.7);
    ctx.beginPath();
    ctx.moveTo(8, 9); ctx.quadraticCurveTo(11, -2, 17, -4); ctx.quadraticCurveTo(20, 4, 14, 9.5); ctx.closePath();
    fill(ctx, '#2c141a', 0.92);
    curve(ctx, -26, -13, -12, -22, 8, -19); stroke(ctx, '#ffffff', 1.4, 0.4);
  }

  const shellguard = K.humanoid({
    id: 'shellguard', name: 'Shellguard', kind: 'enemy', height: 140, topExtra: 26,
    body: { thigh: 24, shin: 25, upper: 21, fore: 22, torso: 38, neck: 3, headR: 13, shDrop: 6, shN: -8, shF: 9, hipN: -5, hipF: 5, wlen: 44, wtail: 12, grip: 8, bw: 22 },
    shootHand: 'near', armSwing: 0.2, magic: '#9fe8ff', trailColor: '#ffe7d8', weaponFocus: 0.8, variantAlias: PARTY_ALIAS,
    book: {
      ready: { nhx: 0.62, nhy: 0.5, w: -12 * D, fhx: 0.5, fhy: 0.02, lean: 0.08, ry: 0.1, nfx: -0.3, ffx: 0.32 },
      guard: { fhx: 0.85, fhy: 0.0, nhx: 0.3, nhy: 0.4, w: -60 * D },
      parry: { fhx: 0.9, fhy: -0.05, nhx: 0.3, nhy: 0.4 },
      variants: {
        bite: { a: { ja: 1, nhx: -0.2, nhy: -0.2, w: -80 * D }, c: { ja: 0, nhx: 1.0, nhy: 0.2, w: 5 * D }, f: { ja: 0.1, nhx: 0.9, nhy: 0.3, w: 15 * D } },
        charge: { a: { fhx: 0.7, fhy: 0.15 }, c: { fhx: 1.0, fhy: 0.05, nhx: 0.3, nhy: 0.5 }, f: { fhx: 0.9, fhy: 0.1 } },
      },
    },
    castPoint(J, o) { o.x = J.tip.x; o.y = J.tip.y; },
    weak: [
      { id: 'conch', r: 18, at(J, o) { const a = J.headA, c = Math.cos(a), s = Math.sin(a); o.x = J.head.x + (-10 * c + 12 * s); o.y = J.head.y + (-10 * s - 12 * c); } },
      { id: 'eye', r: 12, at(J, o) { const a = J.headA, c = Math.cos(a), s = Math.sin(a); o.x = J.head.x + (21 * c - 2 * s); o.y = J.head.y + (21 * s + 2 * c); } },
    ],
    portrait: { x: 0, y: 0, r: 30, bg: ['#d98a5a', '#2a1510'] },
    draw(ctx, J, st) {
      const t = st.t;
      // far arm (shield arm) segments
      limb(ctx, J.sF.x, J.sF.y, J.eF.x, J.eF.y, 5.4, 4.8, shade(SG.shell, -0.2), st);
      limb(ctx, J.eF.x, J.eF.y, J.hF.x, J.hF.y, 4.8, 4.2, shade(SG.shell, -0.2), st);
      // legs: four arched crab legs
      const lf = Math.max(0, -(J.fF.y + 5)), ln = Math.max(0, -(J.fN.y + 5));
      crabLeg(ctx, J.pF, J.fF, st, shade(SG.shell, -0.34), -12, lf);
      crabLeg(ctx, J.pF, J.fF, st, shade(SG.shell, -0.24), 10, lf);
      crabLeg(ctx, J.pN, J.fN, st, shade(SG.shell, -0.1), -14, ln);
      crabLeg(ctx, J.pN, J.fN, st, SG.shell, 12, ln);
      // torso
      frame(ctx, st, J.hip.x, J.hip.y, J.lean);
      sprite(ctx, st, 'shellguard:torso', 44, 50, 22, 44, shellTorsoArt);
      unframe(ctx, st);
      // shield on far hand (held in front)
      frame(ctx, st, J.hF.x + 4, J.hF.y, J.lean * 0.4 - 0.1);
      frame(ctx, st, 0, 0, 0, 0.62, 1);
      sprite(ctx, st, 'shellguard:shield', 56, 56, 28, 28, shellShieldArt);
      unframe(ctx, st);
      unframe(ctx, st);
      // head: conch helm with eye stalks peering out of the aperture
      frame(ctx, st, J.head.x, J.head.y, J.headA);
      sprite(ctx, st, 'shellguard:conch', 64, 46, 38, 30, conchArt);
      const look = Math.sin(t * 0.0017 + st.seed) * 1.2;
      for (const [ex, ey, k] of [[19, 0, 0.75], [22, 4, 1]]) {
        curve(ctx, 12, 6, 15, 3, ex + look * 0.3, ey);
        stroke(ctx, shade(SG.shellD, k < 1 ? -0.2 : 0), 2.6);
        circ(ctx, ex + look * 0.3, ey, 3.4 * k); paintR(ctx, k < 1 ? shade(SG.eyeRing, -0.25) : SG.eyeRing, ex, ey, 3.4 * k, st, 0.8, 0.6);
        circ(ctx, ex + 0.8 + look * 0.4, ey, 1.9 * k); fill(ctx, SG.eye);
        circ(ctx, ex + 1.3, ey - 0.8, 0.6 * k); fill(ctx, '#ffffff', 0.9);
      }
      unframe(ctx, st);
      // near arm: the big pincer
      limb(ctx, J.sN.x, J.sN.y, J.eN.x, J.eN.y, 6.6, 6, SG.shell, st);
      limb(ctx, J.eN.x, J.eN.y, J.hN.x, J.hN.y, 6.2, 10, SG.shell, st);
      frame(ctx, st, J.hN.x, J.hN.y, J.w);
      const open = 0.1 + J.ja * 0.6 + (Math.sin(t * 0.004 + st.seed) * 0.5 + 0.5) * 0.08;
      frame(ctx, st, 7, 5, open);
      ctx.beginPath();
      ctx.moveTo(0, -3); ctx.quadraticCurveTo(20, -5, 38, 3); ctx.quadraticCurveTo(20, 9, 0, 7); ctx.closePath();
      paint(ctx, shade(SG.shell, -0.12), 18, 2, 11, st, 1, 0.6);
      for (let i = 0; i < 4; i++) { poly(ctx, [10 + i * 6, -1.5, 12 + i * 6, -4.5, 14 + i * 6, -1.5]); fill(ctx, SG.belly); }
      unframe(ctx, st);
      ell(ctx, 4, 0, 15, 12.5, 0);
      paintR(ctx, SG.shell, 4, 0, 15, st, 1.1, 0.95);
      ctx.beginPath();
      ctx.moveTo(9, -11); ctx.quadraticCurveTo(32, -18, 46, -3); ctx.quadraticCurveTo(30, -3, 10, 2); ctx.closePath();
      paint(ctx, SG.shell, 27, -7, 14, st, 1.1, 0.95);
      for (let i = 0; i < 5; i++) { poly(ctx, [16 + i * 5.5, -3.5, 18 + i * 5.5, -0.5, 20 + i * 5.5, -3.2]); fill(ctx, SG.belly); }
      for (let i = 0; i < 4; i++) { circ(ctx, -2 + i * 4, -6 + (i % 2) * 5, 1.6); paintR(ctx, shade(SG.shell, 0.2), -2 + i * 4, -6 + (i % 2) * 5, 1.6, st, 0.3, 0.4); }
      curve(ctx, -6, -8, 6, -14, 20, -12); stroke(ctx, '#ffe6d0', 1.4, 0.5);
      unframe(ctx, st);
    },
  });

  // ================================================================== TIDECALLER
  const TC = { robe: '#1f5f63', robeD: '#123a3e', trim: '#8fd3c0', fish: '#5c8fa6', fishD: '#335a6e', belly: '#cad9d6', fin: '#e07a55',
    coral: '#e3613e', coralD: '#9c3522', pearl: '#f4f0ff', pearlGlow: '#bfe9ff', skin: '#6f9c8f', eye: '#f0f4e8' };

  function tideStaffArt(ctx, st) {
    const len = 118;
    // main branch (coral)
    capsule(ctx, -52, 0, len - 12, 0, 2.6, 3.4);
    paintAxis(ctx, TC.coral, -52, 0, len - 12, 0, 3.4, st, 1, 0.7);
    const br = [[60, -1, -0.6, 16], [78, 1, 0.55, 14], [92, -1, -0.8, 12], [34, 1, 0.9, 10], [100, 1, 0.4, 10]];
    for (const [x, sgn, a, l] of br) {
      const ex = x + Math.cos(a) * l, ey = sgn * Math.abs(Math.sin(a)) * l;
      limb(ctx, x, 0, ex, ey, 2.2, 1.2, TC.coral, st, 0.8, 0.5);
      circ(ctx, ex, ey, 1.6); fill(ctx, shade(TC.coral, 0.3));
    }
    // cradle prongs holding the pearl
    for (const a of [-0.7, 0, 0.7]) {
      limb(ctx, len - 14, 0, len - 4 + Math.cos(a) * 4, Math.sin(a) * 9, 2, 1.1, TC.coralD, st, 0.7, 0.4);
    }
  }

  function tideHeadArt(ctx, st) {
    // hood back
    ctx.beginPath();
    ctx.moveTo(-6, 16);
    ctx.quadraticCurveTo(-20, 6, -18, -8);
    ctx.quadraticCurveTo(-14, -22, 2, -19);
    ctx.quadraticCurveTo(12, -17, 15, -9);
    ctx.lineTo(8, 14);
    ctx.closePath();
    paint(ctx, TC.robe, -4, -3, 16, st, 1, 0.8);
    // fish face protruding from the hood
    ctx.beginPath();
    ctx.moveTo(-2, -11);
    ctx.quadraticCurveTo(14, -13, 21, -2);
    ctx.quadraticCurveTo(22, 4, 18, 7);
    ctx.quadraticCurveTo(8, 12, -1, 10);
    ctx.closePath();
    paint(ctx, TC.fish, 9, -1, 13, st, 1, 0.9);
    // belly / jaw
    ctx.beginPath();
    ctx.moveTo(2, 6); ctx.quadraticCurveTo(12, 11, 19, 6.5); ctx.quadraticCurveTo(12, 8, 3, 3); ctx.closePath();
    paint(ctx, TC.belly, 10, 7, 7, st, 0.6, 0.6);
    // scales
    for (let i = 0; i < 5; i++) { curve(ctx, 0 + i * 3, -6 + (i % 2) * 3, 2 + i * 3, -4 + (i % 2) * 3, 0 + i * 3, -2 + (i % 2) * 3); stroke(ctx, TC.fishD, 0.8, 0.6); }
    // gill fins
    ctx.beginPath(); ctx.moveTo(2, -2); ctx.quadraticCurveTo(-6, 2, -3, 9); ctx.quadraticCurveTo(1, 5, 4, 5); ctx.closePath();
    paint(ctx, TC.fin, 0, 3, 5, st, 0.7, 0.6);
    for (let i = 0; i < 3; i++) { line(ctx, 2, 0 + i * 1.6, -3 + i, 6 + i * 1.2); stroke(ctx, shade(TC.fin, -0.3), 0.6, 0.7); }
    // big eye
    circ(ctx, 11, -4.2, 4.6); paintR(ctx, TC.eye, 11, -4.2, 4.6, st, 0.8, 0.6);
    circ(ctx, 12, -4.2, 2.6); fill(ctx, '#101418');
    circ(ctx, 12.8, -5.2, 0.9); fill(ctx, '#ffffff', 0.9);
    // hood rim over the brow
    ctx.beginPath();
    ctx.moveTo(-4, -19); ctx.quadraticCurveTo(10, -19, 15, -9); ctx.lineTo(11, -10); ctx.quadraticCurveTo(6, -15, -3, -14); ctx.closePath();
    paint(ctx, TC.robeD, 5, -14, 8, st, 0.7, 0.5);
    curve(ctx, -3, -14, 6, -15, 11, -10); stroke(ctx, TC.trim, 1.2, 0.8);
  }

  const tidecaller = K.humanoid({
    id: 'tidecaller', name: 'Tidecaller', kind: 'enemy', height: 170, topExtra: 8,
    body: { thigh: 38, shin: 38, upper: 26, fore: 25, torso: 50, neck: 5, headR: 13, shDrop: 6, shN: -5, shF: 6, hipN: -3, hipF: 3, wlen: 118, wreach: 124, wtail: 52, grip: 20, bw: 22 },
    shootHand: 'near', twoHand: 0.5, armSwing: 0.2, magic: '#9ff0ff', trailColor: '#c8fbff', weaponFocus: 0.95, variantAlias: PARTY_ALIAS, defaultVariant: 'bolt',
    book: {
      ready: { nhx: 0.4, nhy: 0.55, w: -80 * D, fhx: 0.5, fhy: 0.3, lean: 0.12, hd: 0.08, ry: 0.06, nfx: -0.15, ffx: 0.18 },
      carry: { nhx: 0.3, nhy: 0.6, w: -70 * D, fhx: 0.3, fhy: 0.5 },
      hurt: { w: -115 * D, nhx: 0.05, nhy: 0.45 },
      dodge: { w: -118 * D, nhx: 0.05, nhy: 0.5 },
      variants: {
        bite: { a: { ja: 1, hd: -0.5 }, c: { ja: 0, hd: 0.35 } },
        bolt: { a: { nhx: -0.3, nhy: -0.5, w: -110 * D }, c: { nhx: 0.95, nhy: -0.15, w: -12 * D } },
      },
    },
    castPoint(J, o) { o.x = J.hN.x + Math.cos(J.w) * 114; o.y = J.hN.y + Math.sin(J.w) * 114; },
    trailPts(J, o) { o[0] = J.hN.x + Math.cos(J.w) * 118; o[1] = J.hN.y + Math.sin(J.w) * 118; o[2] = J.hN.x + Math.cos(J.w) * 70; o[3] = J.hN.y + Math.sin(J.w) * 70; },
    weak: [{ id: 'staff_pearl', r: 14, at(J, o) { o.x = J.hN.x + Math.cos(J.w) * 114; o.y = J.hN.y + Math.sin(J.w) * 114; } }],
    portrait: { x: 4, y: 2, r: 27, bg: ['#3f8fa0', '#0e2226'] },
    draw(ctx, J, st) {
      const t = st.t;
      const sway = Math.sin(t * 0.002 + st.seed);
      // far arm (webbed)
      limb(ctx, J.sF.x, J.sF.y, J.eF.x, J.eF.y, 6.2, 5.8, TC.robeD, st);
      limb(ctx, J.eF.x, J.eF.y, J.hF.x, J.hF.y, 5.8, 6.8, TC.robeD, st);
      hand(ctx, J.hF.x, J.hF.y, 4.2, shade(TC.skin, -0.15), st, 0.8);
      // webbed feet peeking out
      for (const f of [J.fF, J.fN]) {
        ctx.beginPath(); ctx.moveTo(f.x - 5, f.y + 5); ctx.lineTo(f.x + 14, f.y + 5); ctx.lineTo(f.x + 9, f.y - 1); ctx.lineTo(f.x - 2, f.y - 2); ctx.closePath();
        paint(ctx, f === J.fF ? shade(TC.skin, -0.2) : TC.skin, f.x + 4, f.y + 2, 8, st, 0.8, 0.5);
      }
      // robe skirt (floor length, tattered hem with weed fringe)
      const nx = Math.cos(J.lean), ny = Math.sin(J.lean);
      const hx = J.hip.x, hy = J.hip.y;
      const fmin = Math.min(J.fN.x, J.fF.x, J.kN.x - 6, J.kF.x - 6), fmax = Math.max(J.fN.x, J.fF.x, J.kN.x, J.kF.x);
      const hemY = Math.max(J.fN.y, J.fF.y) + 1;
      const backX = fmin - 14 - J.cape * 18 - sway * 2, frontX = fmax + 9;
      ctx.beginPath();
      ctx.moveTo(hx - nx * 13, hy - ny * 13 - 6);
      ctx.quadraticCurveTo(backX + 2, lerp(hy, hemY, 0.5), backX, hemY - 2);
      const n = 9;
      for (let i = 1; i <= n; i++) {
        const x = lerp(backX, frontX, i / n);
        const y = hemY + (i % 2 ? -5 - hash(i) * 3 : 1);
        ctx.lineTo(x, y);
      }
      ctx.quadraticCurveTo(frontX + 1, lerp(hy, hemY, 0.45), hx + nx * 12, hy + ny * 12 - 6);
      ctx.closePath();
      paint(ctx, TC.robe, lerp(backX, frontX, 0.55), lerp(hy, hemY, 0.5), 32, st, 1, 0.8);
      for (let i = 0; i < 3; i++) {
        const u = 0.25 + i * 0.25;
        curve(ctx, lerp(hx - 12, hx + 12, u), hy, lerp(backX, frontX, u) + sway * 3, lerp(hy, hemY, 0.6), lerp(backX, frontX, u), hemY - 2);
        stroke(ctx, TC.robeD, 1.4, 0.6);
      }
      for (let i = 0; i < 4; i++) {
        const x = lerp(backX + 6, frontX - 6, i / 3);
        curve(ctx, x, hemY - 3, x - 3 + sway * 2, hemY + 3, x - 1 + sway * 3, hemY + 7);
        stroke(ctx, '#3f7a3a', 1.6, 0.85);
      }
      // torso
      frame(ctx, st, hx, hy, J.lean);
      const T = 50;
      blob(ctx, [-13, 3, -15, -18, -14, -38, -9, -T + 1, 0, -T - 2, 10, -T + 3, 15, -34, 14, -14, 12, 3]);
      paint(ctx, TC.robe, 0, -T * 0.5, 22, st, 1, 0.8);
      curve(ctx, 2, -T, 12, -30, 9, 2); stroke(ctx, TC.trim, 1.4, 0.8);
      // pearl & shell necklace
      for (let i = 0; i < 7; i++) {
        const a = 0.2 + i * 0.3;
        const px = Math.cos(a) * 10 + 1, py = -T + 4 + Math.sin(a) * 9;
        circ(ctx, px, py, i === 3 ? 2.6 : 1.6);
        paintR(ctx, i === 3 ? '#f7c9b5' : TC.pearl, px, py, 2, st, 0.4, 0.5);
      }
      // rope belt
      curve(ctx, -13, -2, 0, 1, 13, -3); stroke(ctx, '#b8a27a', 2.4);
      unframe(ctx, st);
      // head (hooded fish)
      frame(ctx, st, J.head.x, J.head.y, J.headA);
      sprite(ctx, st, 'tidecaller:head', 46, 42, 22, 22, tideHeadArt);
      // mouth (animated)
      const ja = clamp(J.ja + (st.anim === 'hurt' ? 0.5 : 0), 0, 1);
      ctx.beginPath();
      ctx.moveTo(20.5, 1.5); ctx.lineTo(13, 3 + ja * 1.5); ctx.lineTo(19, 3.5 + ja * 6); ctx.closePath();
      fill(ctx, '#3a1418');
      if (ja > 0.2) { for (let i = 0; i < 3; i++) { poly(ctx, [15 + i * 2, 3.2, 16 + i * 2, 5, 17 + i * 2, 3.4]); fill(ctx, '#f4f0e0'); } }
      unframe(ctx, st);
      // near arm + coral staff
      frame(ctx, st, J.hN.x, J.hN.y, J.w);
      sprite(ctx, st, 'tidecaller:staff', 190, 40, 58, 20, tideStaffArt);
      unframe(ctx, st);
      const px = J.hN.x + Math.cos(J.w) * 114, py = J.hN.y + Math.sin(J.w) * 114;
      if (!st.ghost) glow(ctx, px, py, 18 + Math.sin(t * 0.005 + st.seed) * 3 + J.ch * 12, TC.pearlGlow, 0.55);
      circ(ctx, px, py, 7);
      paintR(ctx, TC.pearl, px, py, 7, st, 0.9, 0.9, -0.3, 0.5);
      limb(ctx, J.sN.x, J.sN.y, J.eN.x, J.eN.y, 6.4, 5.8, TC.robe, st);
      limb(ctx, J.eN.x, J.eN.y, J.hN.x, J.hN.y, 5.8, 7, TC.robe, st);
      hand(ctx, J.hN.x, J.hN.y, 4.6, TC.skin, st, 0.8);
      line(ctx, J.hN.x - 2, J.hN.y - 3, J.hN.x + 3, J.hN.y + 2); stroke(ctx, shade(TC.skin, -0.3), 0.8, 0.8);
    },
  });

  // ================================================================== WRECK WARDEN
  const WW = { brass: '#b8893b', brassD: '#6c4f22', brassL: '#e3bd6a', verd: '#4f9c8a', rust: '#8a4a2a', iron: '#3f3a39', ironD: '#221e1e',
    canvas: '#6d6a58', glow: '#a8f7d8', glowCore: '#fff0b0', barn: '#ddd3c2', barnD: '#8f8373', weed: '#3d6b3a' };

  function barnacles(ctx, st, cx, cy, n, r, seed) {
    for (let i = 0; i < n; i++) {
      const a = hash(seed + i * 3.1) * TAU, d = hash(seed + i * 7.3) * r;
      const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d * 0.7;
      const rr = 2.5 + hash(seed + i) * 3.5;
      ctx.beginPath(); ctx.moveTo(x - rr, y + rr * 0.5); ctx.lineTo(x - rr * 0.55, y - rr); ctx.lineTo(x + rr * 0.55, y - rr); ctx.lineTo(x + rr, y + rr * 0.5); ctx.closePath();
      paint(ctx, WW.barn, x, y, rr, st, 0.6, 0.6);
      ell(ctx, x, y - rr * 0.9, rr * 0.5, rr * 0.22); fill(ctx, WW.barnD);
    }
  }

  function wardenTorsoArt(ctx, st) {
    const T = 105;
    // back tank
    capsule(ctx, -46, -20, -46, -T + 10, 18, 18);
    paintAxis(ctx, WW.brassD, -46, -20, -46, -T + 10, 18, st, 1, 0.5);
    // barrel chest
    blob(ctx, [-44, 6, -56, -34, -52, -80, -34, -T - 4, 4, -T - 8, 40, -T + 6, 54, -62, 48, -22, 34, 6]);
    paint(ctx, WW.brass, 0, -T * 0.5, 56, st, 1.3, 0.9);
    // verdigris patches
    for (let i = 0; i < 5; i++) {
      const x = -30 + hash(i * 5.5) * 60, y = -20 - hash(i * 2.2) * 70;
      ell(ctx, x, y, 7 + hash(i) * 8, 4 + hash(i * 3) * 4, hash(i * 9) * 3);
      fill(ctx, WW.verd, 0.35);
    }
    // canvas lower belly + belt
    ctx.beginPath(); ctx.moveTo(-42, 6); ctx.lineTo(-46, -16); ctx.quadraticCurveTo(0, -24, 46, -16); ctx.lineTo(34, 6); ctx.closePath();
    paint(ctx, WW.canvas, 0, -6, 34, st, 1, 0.5);
    ctx.beginPath(); ctx.moveTo(-47, -14); ctx.quadraticCurveTo(0, -24, 47, -14); ctx.lineTo(47, -22); ctx.quadraticCurveTo(0, -32, -49, -22); ctx.closePath();
    paint(ctx, WW.ironD, 0, -20, 30, st, 0.8, 0.5);
    // chest plate seams + rivets
    curve(ctx, -40, -40, 0, -52, 46, -40); stroke(ctx, WW.brassD, 2.4, 0.8);
    curve(ctx, -30, -84, 6, -96, 38, -84); stroke(ctx, WW.brassD, 2.4, 0.8);
    for (let i = 0; i < 9; i++) {
      const u = i / 8;
      const x = lerp(-38, 44, u), y = -42 - Math.sin(u * Math.PI) * 10;
      circ(ctx, x, y, 2.2); paintR(ctx, WW.brassL, x, y, 2.2, st, 0.4, 0.5);
    }
    // collar ring (helm seat)
    ell(ctx, 4, -T - 2, 36, 10);
    paint(ctx, WW.brassD, 4, -T - 2, 30, st, 1, 0.8);
    for (let i = 0; i < 8; i++) { const a = Math.PI + (i / 7) * Math.PI; circ(ctx, 4 + Math.cos(a) * 32, -T - 2 - Math.sin(a) * 8, 2.4); paintR(ctx, WW.brassL, 4 + Math.cos(a) * 32, -T - 2 - Math.sin(a) * 8, 2.4, st, 0.4, 0.5); }
    // barnacle clusters (back + near shoulder)
    barnacles(ctx, st, -40, -70, 10, 16, 1.7);
    barnacles(ctx, st, -20, -96, 8, 14, 5.1);
    // seaweed strands
    for (let i = 0; i < 3; i++) { curve(ctx, -30 + i * 20, -22, -34 + i * 20, -6, -28 + i * 20, 8); stroke(ctx, WW.weed, 2.4, 0.9); }
  }

  function wardenHelmArt(ctx, st) {
    const R = 40;
    // hoses
    curve(ctx, -30, 10, -58, 0, -60, 34); stroke(ctx, WW.ironD, 9);
    curve(ctx, -30, 10, -58, 0, -60, 34); stroke(ctx, '#4a4545', 5);
    // dome
    circ(ctx, 0, 0, R);
    paintR(ctx, WW.brass, 0, 0, R, st, 1.3, 0.95);
    ell(ctx, -14, 14, 14, 9); fill(ctx, WW.verd, 0.3);
    // side porthole
    circ(ctx, -18, -6, 11); paintR(ctx, WW.brassD, -18, -6, 11, st, 0.8, 0.6);
    circ(ctx, -18, -6, 7); fill(ctx, '#1d3534');
    // front porthole rim
    circ(ctx, 16, 4, 22); paintR(ctx, WW.brassL, 16, 4, 22, st, 1.1, 0.9);
    for (let i = 0; i < 8; i++) { const a = (i * TAU) / 8; circ(ctx, 16 + Math.cos(a) * 19, 4 + Math.sin(a) * 19, 2.2); paintR(ctx, WW.brassD, 16 + Math.cos(a) * 19, 4 + Math.sin(a) * 19, 2.2, st, 0.4, 0.4); }
    circ(ctx, 16, 4, 15.5); fill(ctx, '#0f2624');
    // top valve
    ctx.beginPath(); ctx.rect(-6, -R - 8, 12, 10); paint(ctx, WW.brassD, 0, -R - 3, 8, st, 0.8, 0.6);
    // barnacles on the dome
    barnacles(ctx, st, -24, -24, 6, 10, 9.3);
  }

  function anchorArt(ctx, st) {
    // anchor pointing along +x from the ring at the origin
    const L = 58;
    circ(ctx, 0, 0, 7); ctx.lineWidth = 3.4 * 1; ctx.strokeStyle = WW.ironD; ctx.stroke();
    capsule(ctx, 6, 0, L, 0, 5, 6);
    paintAxis(ctx, WW.iron, 6, 0, L, 0, 6, st, 1.2, 0.6);
    // stock (crossbar)
    capsule(ctx, 12, -22, 12, 22, 3.6, 3.6);
    paintAxis(ctx, WW.rust, 12, -22, 12, 22, 3.6, st, 1, 0.5);
    // arms + flukes
    ctx.beginPath();
    ctx.moveTo(L + 2, 0);
    ctx.quadraticCurveTo(L - 2, -30, L - 24, -34);
    ctx.lineTo(L - 16, -24);
    ctx.quadraticCurveTo(L - 8, -20, L - 4, 0);
    ctx.quadraticCurveTo(L - 8, 20, L - 16, 24);
    ctx.lineTo(L - 24, 34);
    ctx.quadraticCurveTo(L - 2, 30, L + 2, 0);
    ctx.closePath();
    paint(ctx, WW.iron, L - 8, 0, 30, st, 1.2, 0.7);
    for (const s of [-1, 1]) { poly(ctx, [L - 24, 34 * s, L - 34, 26 * s, L - 16, 24 * s]); paint(ctx, WW.rust, L - 24, 28 * s, 8, st, 0.8, 0.5); }
    barnacles(ctx, st, L - 14, 16, 4, 6, 3.3);
    ell(ctx, 30, 2, 8, 3); fill(ctx, WW.rust, 0.5);
  }

  function chain(ctx, x0, y0, x1, y1, sag, st) {
    const n = 11;
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      const x = lerp(x0, x1, u), y = lerp(y0, y1, u) + Math.sin(u * Math.PI) * sag;
      ell(ctx, x, y, 4.2, 2.6, Math.atan2(y1 - y0, x1 - x0) + (i % 2 ? Math.PI / 2 : 0));
      ctx.lineWidth = 2.4; ctx.strokeStyle = i % 2 ? WW.iron : shade(WW.iron, 0.25); ctx.stroke();
    }
  }

  const wreck = K.humanoid({
    id: 'wreck_warden', name: 'The Wreck Warden', kind: 'enemy', height: 300, topExtra: 12, olScale: 1.5, fxScale: 2.2,
    body: { thigh: 54, shin: 50, upper: 58, fore: 58, torso: 105, neck: 4, headR: 40, shDrop: 22, shN: -24, shF: 30, hipN: -10, hipF: 12, wlen: 52, wreach: 108, wtail: 0, grip: 26, bw: 62, ankle: 9 },
    twoHand: 1, shootHand: 'near', armSwing: 0.18, magic: '#a8f7d8', trailColor: '#d8fff0', weaponFocus: 0.95, variantAlias: PARTY_ALIAS, defaultVariant: 'slam',
    pad: 50, jumpH: 0.6, shadowRx: 95,
    book: {
      ready: { nhx: 0.42, nhy: 0.6, w: 82 * D, fhx: 0.5, fhy: 0.55, lean: 0.12, hd: 0.06, ry: 0.08, nfx: -0.26, ffx: 0.28 },
      carry: { nhx: 0.35, nhy: 0.62, w: 110 * D, fhx: 0.35, fhy: 0.6 },
      victory: { nhx: 0.2, nhy: -0.95, w: -95 * D, fhx: 0.6, fhy: 0.4, lean: -0.1, hd: -0.2 },
      variants: {
        slash: { a: { nhx: -0.4, nhy: -0.5, w: -160 * D }, c: { nhx: 0.9, nhy: 0.35, w: 20 * D }, f: { nhx: 0.5, nhy: 0.75, w: 95 * D } },
        slam: { a: { w: -100 * D }, c: { w: 75 * D } },
        bite: { a: { hd: -0.5 }, c: { hd: 0.35 } },
      },
    },
    castPoint(J, o) { const a = J.headA; o.x = J.head.x + 16 * Math.cos(a) - 4 * Math.sin(a); o.y = J.head.y + 16 * Math.sin(a) + 4 * Math.cos(a); },
    trailPts(J, o) { o[0] = J.tip.x; o[1] = J.tip.y; o[2] = J.hN.x + Math.cos(J.w) * 70; o[3] = J.hN.y + Math.sin(J.w) * 70; },
    weak: [
      { id: 'porthole', r: 24, at(J, o) { const a = J.headA; o.x = J.head.x + 16 * Math.cos(a) - 4 * Math.sin(a); o.y = J.head.y + 16 * Math.sin(a) + 4 * Math.cos(a); } },
      { id: 'barnacles', r: 22, at(J, o) { o.x = J.sN.x - 6; o.y = J.sN.y - 8; } },
    ],
    portrait: { x: 6, y: 8, r: 58, bg: ['#3f8f84', '#0e1f1e'] },
    draw(ctx, J, st) {
      const t = st.t;
      const b = st.look.body;
      // far arm
      limb(ctx, J.sF.x, J.sF.y, J.eF.x, J.eF.y, 17, 15, shade(WW.brass, -0.25), st);
      limb(ctx, J.eF.x, J.eF.y, J.hF.x, J.hF.y, 15, 16, shade(WW.brass, -0.25), st);
      mitt(ctx, J.eF, J.hF, st, shade(WW.brass, -0.3), 1, WW.ironD);
      // legs
      for (const far of [true, false]) {
        const p = far ? J.pF : J.pN, k = far ? J.kF : J.kN, f = far ? J.fF : J.fN;
        const d = far ? -0.22 : 0;
        limb(ctx, p.x, p.y, k.x, k.y, 21, 17, shade(WW.canvas, d), st, 1.2);
        limb(ctx, k.x, k.y, f.x, f.y, 17, 15, shade(WW.brass, d), st, 1.2);
        circ(ctx, k.x, k.y, 13); paintR(ctx, shade(WW.brassD, d), k.x, k.y, 13, st, 1, 0.6);
        foot(ctx, f.x, f.y, 30, b.ankle, shade(WW.iron, d), st, Math.max(0, -(f.y + b.ankle)), 1.2);
      }
      // torso
      frame(ctx, st, J.hip.x, J.hip.y, J.lean);
      sprite(ctx, st, 'wreck:torso', 140, 132, 76, 120, wardenTorsoArt);
      unframe(ctx, st);
      // helm
      frame(ctx, st, J.head.x, J.head.y, J.headA);
      sprite(ctx, st, 'wreck:helm', 150, 110, 84, 58, wardenHelmArt);
      unframe(ctx, st);
      const pa = J.headA;
      const phx = J.head.x + 16 * Math.cos(pa) - 4 * Math.sin(pa), phy = J.head.y + 16 * Math.sin(pa) + 4 * Math.cos(pa);
      const fl = 0.8 + 0.2 * Math.sin(t * 0.007 + st.seed) + J.ch * 0.5;
      circ(ctx, phx, phy, 15);
      if (!st.ghost) {
        const g = ctx.createRadialGradient(phx + 3, phy - 3, 1, phx, phy, 15);
        g.addColorStop(0, WW.glowCore); g.addColorStop(0.45, rgba(WW.glow, 0.9)); g.addColorStop(1, rgba('#1b5a4c', 0.95));
        ctx.fillStyle = g; ctx.fill();
        glow(ctx, phx, phy, 40 * fl, WW.glow, 0.45);
      } else fill(ctx, WW.glow);
      line(ctx, phx - 14, phy, phx + 14, phy); stroke(ctx, WW.brassD, 2.6);
      line(ctx, phx, phy - 14, phx, phy + 14); stroke(ctx, WW.brassD, 2.6);
      // near arm + anchor on chain
      const ax = J.tip.x, ay = J.tip.y;
      chain(ctx, J.hN.x, J.hN.y, ax, ay, 8 + Math.sin(t * 0.003) * 2, st);
      frame(ctx, st, ax, ay, J.w);
      sprite(ctx, st, 'wreck:anchor', 90, 80, 12, 40, anchorArt);
      unframe(ctx, st);
      limb(ctx, J.sN.x, J.sN.y, J.eN.x, J.eN.y, 18, 16, WW.brass, st, 1.2);
      limb(ctx, J.eN.x, J.eN.y, J.hN.x, J.hN.y, 16, 17, WW.brass, st, 1.2);
      along(tmp, J.eN.x, J.eN.y, J.hN.x, J.hN.y, 0.5);
      for (let i = 0; i < 4; i++) {
        along(tmp2, J.eN.x, J.eN.y, J.hN.x, J.hN.y, 0.2 + i * 0.2);
        circ(ctx, tmp2.x, tmp2.y - 12, 2.2); paintR(ctx, WW.brassL, tmp2.x, tmp2.y - 12, 2.2, st, 0.4, 0.5);
      }
      mitt(ctx, J.eN, J.hN, st, WW.brass, 1, WW.ironD);
      // shoulder barnacle cluster (weak point)
      barnacles(ctx, st, J.sN.x - 6, J.sN.y - 6, 7, 14, 12.2);
    },
  });

  return { driftling, shellguard, tidecaller, wreck_warden: wreck };
}
