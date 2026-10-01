// Summit look: The Stillkeeper, a towering clockwork knight with a cracked sun-halo crown and a
// sundial glaive. Phase ≥ 1 ("Unwound"): the halo shatters into orbiting shards and cracks glow.

/**
 * Build the summit look definitions with the shared sprite kit.
 * @param {object} K painting kit from sprites.js
 * @returns {Record<string, object>}
 */
export function defineSummitLooks(K) {
  const { D, TAU, lerp, hash, shade, paint, paintR, paintAxis, fill, stroke, capsule, limb, ell, circ, poly, blob,
    line, curve, glow, frame, unframe, foot, along, sprite, polyline, mitt } = K;
  const tmp = { x: 0, y: 0 }, tmp2 = { x: 0, y: 0 };
  const PARTY_ALIAS = { flurry: 'thrust', heavy: 'slam', leap: 'slam', buff: 'cast', heal: 'cast', shoot: 'beam', gradient: 'nova' };
  const rot = (o, bx, by, a, lx, ly) => { const c = Math.cos(a), s = Math.sin(a); o.x = bx + lx * c - ly * s; o.y = by + lx * s + ly * c; return o; };

  const SK = { gold: '#d9ac52', goldD: '#7a5620', goldL: '#f6dc92', enamel: '#1d2340', enamelL: '#39447a', cape: '#5a1f3a', capeD: '#2c0e1d',
    light: '#fff0c0', crack: '#fff4cf', visor: '#ffd98a', steel: '#cfd6de', dark: '#120e14', heart: '#ffcf6a' };
  const HALO_R = 58;

  function gearPath(ctx, x, y, r, teeth, a) {
    ctx.beginPath();
    const n = teeth * 2;
    for (let i = 0; i <= n; i++) {
      const u = (i / n) * TAU + a;
      const rr = i % 2 ? r : r * 0.8;
      const u0 = u - (TAU / n) * 0.3, u1 = u + (TAU / n) * 0.3;
      if (i === 0) ctx.moveTo(x + Math.cos(u0) * rr, y + Math.sin(u0) * rr); else ctx.lineTo(x + Math.cos(u0) * rr, y + Math.sin(u0) * rr);
      ctx.lineTo(x + Math.cos(u1) * rr, y + Math.sin(u1) * rr);
    }
    ctx.closePath();
  }

  function haloArt(ctx, st) {
    // sun crown ring with rays and a deep crack (phase 0)
    const g = -0.3, gap = 0.1;
    for (let i = 0; i < 16; i++) {
      const a = (i * TAU) / 16 - Math.PI / 2;
      if (Math.abs(Math.atan2(Math.sin(a - g), Math.cos(a - g))) < 0.25) continue;
      const long = i % 2 === 0;
      const r0 = HALO_R + 2, r1 = HALO_R + (long ? 26 : 14);
      poly(ctx, [Math.cos(a - 0.06) * r0, Math.sin(a - 0.06) * r0, Math.cos(a) * r1, Math.sin(a) * r1, Math.cos(a + 0.06) * r0, Math.sin(a + 0.06) * r0]);
      paint(ctx, SK.gold, Math.cos(a) * (r0 + 8), Math.sin(a) * (r0 + 8), 12, st, 0.8, 0.7);
    }
    ctx.beginPath();
    ctx.arc(0, 0, HALO_R + 4, g + gap, g - gap + TAU, false);
    ctx.arc(0, 0, HALO_R - 6, g - gap + TAU, g + gap, true);
    ctx.closePath();
    paintR(ctx, SK.gold, 0, 0, HALO_R + 4, st, 1.2, 0.9);
    ctx.beginPath(); ctx.arc(0, 0, HALO_R - 1, 0, TAU); stroke(ctx, SK.goldD, 1.4, 0.7);
    // crack lines
    polyline(ctx, [Math.cos(-0.2) * (HALO_R + 4), Math.sin(-0.2) * (HALO_R + 4), Math.cos(-0.25) * HALO_R, Math.sin(-0.25) * HALO_R, Math.cos(-0.18) * (HALO_R - 6), Math.sin(-0.18) * (HALO_R - 6)]);
    stroke(ctx, SK.dark, 1.4, 0.9);
    polyline(ctx, [Math.cos(2.6) * (HALO_R + 4), Math.sin(2.6) * (HALO_R + 4), Math.cos(2.66) * HALO_R, Math.sin(2.66) * HALO_R, Math.cos(2.58) * (HALO_R - 6), Math.sin(2.58) * (HALO_R - 6)]);
    stroke(ctx, SK.dark, 1.2, 0.9);
  }

  function shard(ctx, x, y, a, s, st) {
    frame(ctx, st, x, y, a);
    poly(ctx, [-9 * s, -4 * s, 10 * s, -6 * s, 14 * s, 2 * s, -2 * s, 6 * s, -12 * s, 3 * s]);
    paint(ctx, SK.gold, 0, 0, 12 * s, st, 0.9, 0.9, -0.35, 0.45);
    line(ctx, -6 * s, 0, 8 * s, -2 * s); stroke(ctx, SK.crack, 1.2, 0.9);
    unframe(ctx, st);
  }

  function torsoArt(phase) {
    return (ctx, st) => {
      const T = 128;
      // cuirass
      blob(ctx, [-44, 6, -52, -34, -50, -84, -36, -T, 2, -T - 8, 38, -T + 4, 52, -80, 48, -34, 40, 6]);
      paint(ctx, SK.gold, 0, -T * 0.5, 56, st, 1.4, 0.95);
      // enamel panels
      for (const [x, y, w, h] of [[-40, -96, 30, 40], [-40, -50, 26, 36]]) {
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + w, y + 4); ctx.lineTo(x + w - 2, y + h); ctx.lineTo(x + 2, y + h - 4); ctx.closePath();
        paint(ctx, SK.enamel, x + w / 2, y + h / 2, w * 0.6, st, 0.8, 0.6);
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + w, y + 4); ctx.lineTo(x + w - 2, y + h); ctx.lineTo(x + 2, y + h - 4); ctx.closePath();
        stroke(ctx, SK.goldL, 1.4, 0.8);
      }
      // chest cage opening around the heart gear
      ell(ctx, 18, -80, 22, 24); fill(ctx, SK.dark);
      ctx.beginPath(); ctx.ellipse(18, -80, 22, 24, 0, 0, TAU); stroke(ctx, SK.goldL, 3, 0.9);
      for (let i = 0; i < 5; i++) { const x = 6 + i * 6; line(ctx, x, -102, x, -58); stroke(ctx, SK.goldD, 2, 0.8); }
      // belt + tassets
      ctx.beginPath(); ctx.moveTo(-46, -4); ctx.quadraticCurveTo(0, 6, 44, -4); ctx.lineTo(44, 6); ctx.quadraticCurveTo(0, 16, -46, 6); ctx.closePath();
      paint(ctx, SK.enamel, 0, 2, 40, st, 1, 0.6);
      for (let i = 0; i < 4; i++) {
        ctx.beginPath(); ctx.moveTo(-42 + i * 22, 8); ctx.lineTo(-22 + i * 22, 8); ctx.lineTo(-24 + i * 22, 36); ctx.quadraticCurveTo(-33 + i * 22, 40, -40 + i * 22, 34); ctx.closePath();
        paint(ctx, i % 2 ? SK.gold : shade(SK.gold, -0.15), -32 + i * 22, 22, 14, st, 1, 0.8);
      }
      // sunburst engraving
      for (let i = 0; i < 8; i++) { const a = -Math.PI / 2 + (i - 3.5) * 0.3; line(ctx, -14 + Math.cos(a) * 8, -40 + Math.sin(a) * 8, -14 + Math.cos(a) * 18, -40 + Math.sin(a) * 18); stroke(ctx, SK.goldD, 1.4, 0.8); }
      circ(ctx, -14, -40, 6); paintR(ctx, SK.goldL, -14, -40, 6, st, 0.6, 0.6);
      // cracks
      const glowC = phase ? SK.crack : null;
      const segs = [[-30, -T + 8, -22, -100, -30, -88, -20, -74], [30, -30, 22, -18, 30, -8], [-48, -60, -38, -54, -42, -44]];
      for (const sg of segs) {
        if (glowC) { polyline(ctx, sg); stroke(ctx, glowC, 5, 0.45); }
        polyline(ctx, sg); stroke(ctx, phase ? SK.crack : SK.dark, phase ? 2 : 1.4, 0.95);
      }
    };
  }
  const torsoP0 = torsoArt(0), torsoP1 = torsoArt(1);

  function helmArt(phase) {
    return (ctx, st) => {
      // crown spikes
      for (let i = 0; i < 5; i++) {
        const x = -18 + i * 9, h = i === 2 ? 22 : 14;
        poly(ctx, [x - 4, -24, x, -24 - h, x + 4, -24]);
        paint(ctx, SK.gold, x, -30, 8, st, 0.8, 0.8);
      }
      ctx.beginPath();
      ctx.moveTo(-26, 20); ctx.quadraticCurveTo(-32, -10, -18, -26); ctx.quadraticCurveTo(4, -34, 24, -18); ctx.quadraticCurveTo(34, -2, 30, 16); ctx.quadraticCurveTo(4, 30, -26, 20); ctx.closePath();
      paint(ctx, SK.gold, 0, -4, 30, st, 1.3, 0.95);
      // face plate
      ctx.beginPath(); ctx.moveTo(6, -18); ctx.quadraticCurveTo(28, -14, 30, 4); ctx.quadraticCurveTo(26, 18, 8, 20); ctx.closePath();
      paint(ctx, SK.enamel, 18, 0, 16, st, 1, 0.7);
      // visor slit (T-shape)
      ctx.beginPath(); ctx.rect(10, -6, 20, 4.6); fill(ctx, '#0a0608');
      ctx.beginPath(); ctx.rect(19, -6, 4, 16); fill(ctx, '#0a0608');
      curve(ctx, -24, 16, 0, 26, 28, 14); stroke(ctx, SK.goldL, 1.6, 0.9);
      if (phase) { polyline(ctx, [-18, -22, -10, -10, -16, 2, -8, 12]); stroke(ctx, SK.crack, 3.6, 0.45); polyline(ctx, [-18, -22, -10, -10, -16, 2, -8, 12]); stroke(ctx, SK.crack, 1.6, 0.95); }
      else { polyline(ctx, [-18, -22, -10, -10, -16, 2]); stroke(ctx, SK.dark, 1.3, 0.9); }
    };
  }
  const helmP0 = helmArt(0), helmP1 = helmArt(1);

  function glaiveArt(ctx, st) {
    const L = 190, tail = 70;
    capsule(ctx, -tail, 0, L - 18, 0, 4.4, 5);
    paintAxis(ctx, SK.enamel, -tail, 0, L - 18, 0, 5, st, 1.1, 0.6);
    for (const x of [-tail + 8, -20, 40, 110, L - 24]) { ctx.beginPath(); ctx.rect(x - 4, -6.5, 8, 13); paintAxis(ctx, SK.gold, x - 4, 0, x + 4, 0, 6.5, st, 0.7, 0.7); }
    // butt spike
    poly(ctx, [-tail - 22, 0, -tail + 2, -5, -tail + 2, 5]); paint(ctx, SK.gold, -tail - 8, 0, 8, st, 0.8, 0.7);
    // sundial blade: half disc on the +y side, gnomon on top
    ctx.beginPath();
    ctx.moveTo(L - 34, 0);
    ctx.arc(L + 10, 0, 44, Math.PI, 0, false);
    ctx.lineTo(L + 54, 4);
    ctx.lineTo(L - 34, 4);
    ctx.closePath();
    paint(ctx, SK.steel, L + 10, -18, 44, st, 1.2, 0.95, -0.35, 0.4);
    ctx.beginPath(); ctx.arc(L + 10, 0, 40, Math.PI, 0, false); stroke(ctx, SK.goldL, 2.2, 0.9);
    for (let i = 1; i < 12; i++) { const a = Math.PI + (i / 12) * Math.PI; line(ctx, L + 10 + Math.cos(a) * 12, Math.sin(a) * 12, L + 10 + Math.cos(a) * 36, Math.sin(a) * 36); stroke(ctx, SK.goldD, i % 3 === 0 ? 1.6 : 0.8, 0.8); }
    circ(ctx, L + 10, 0, 6); paintR(ctx, SK.gold, L + 10, 0, 6, st, 0.8, 0.8);
    // gnomon
    poly(ctx, [L + 6, -2, L + 14, -2, L + 40, -58]); paint(ctx, SK.gold, L + 20, -24, 14, st, 0.9, 0.8);
  }

  const stillkeeper = K.humanoid({
    id: 'stillkeeper', name: 'The Stillkeeper', kind: 'enemy', height: 380, topExtra: 34, olScale: 1.7, fxScale: 2.6,
    body: { thigh: 70, shin: 68, upper: 72, fore: 72, torso: 128, neck: 12, headR: 32, shDrop: 24, shN: -30, shF: 34, hipN: -12, hipF: 12, wlen: 190, wreach: 238, wtail: 92, grip: 70, bw: 64, ankle: 11 },
    twoHand: 1, shootHand: 'near', armSwing: 0.2, magic: '#ffe39a', trailColor: '#fff4d0', weaponFocus: 1.05, variantAlias: PARTY_ALIAS, defaultVariant: 'slash',
    pad: 64, jumpH: 0.5, shadowRx: 120,
    book: {
      ready: { nhx: 0.45, nhy: 0.5, w: -66 * D, two: 0.65, fhx: 0.5, fhy: 0.3, lean: 0.06, hd: 0.08, ry: 0.06, nfx: -0.25, ffx: 0.27 },
      carry: { nhx: 0.35, nhy: 0.55, w: -70 * D, two: 0.6, fhx: 0.4, fhy: 0.4 },
      victory: { nhx: 0.2, nhy: -0.95, w: -92 * D, two: 0, fhx: 0.6, fhy: 0.3, lean: -0.1, hd: -0.25 },
      variants: {
        slash: { a: { two: 1 }, c: { two: 1 }, f: { two: 1 } },
        thrust: { a: { two: 1 }, c: { two: 1 }, f: { two: 1 } },
        spin: { a: { two: 1 }, c: { two: 1 }, f: { two: 1 } },
      },
    },
    castPoint(J, o) { const L = 200; o.x = J.hN.x + Math.cos(J.w) * L; o.y = J.hN.y + Math.sin(J.w) * L; },
    trailPts(J, o) { o[0] = J.hN.x + Math.cos(J.w) * 244; o[1] = J.hN.y + Math.sin(J.w) * 244; o[2] = J.hN.x + Math.cos(J.w) * 160; o[3] = J.hN.y + Math.sin(J.w) * 160; },
    weak: [
      { id: 'halo', r: 26, at(J, o, st) { haloPoint(J, st, o); } },
      { id: 'heart_gear', r: 20, at(J, o) { rot(o, J.hip.x, J.hip.y, J.lean, 18, -80); } },
    ],
    anchors(look, J, o) {
      o.head.x = J.head.x; o.head.y = J.head.y;
      rot(o.chest, J.hip.x, J.hip.y, J.lean, 18, -80);
      const L = 200; o.weapon.x = J.hN.x + Math.cos(J.w) * L; o.weapon.y = J.hN.y + Math.sin(J.w) * L;
      o.feet.x = (J.fN.x + J.fF.x) / 2; o.feet.y = Math.max(J.fN.y, J.fF.y) + 11;
      o.top.x = J.head.x - 10; o.top.y = J.head.y - HALO_R - 26;
      o.center.x = lerp(J.hip.x, J.neck.x, 0.45); o.center.y = lerp(J.hip.y, J.neck.y, 0.45);
      o.tip.x = J.hN.x + Math.cos(J.w) * 244; o.tip.y = J.hN.y + Math.sin(J.w) * 244;
    },
    portrait: { x: -4, y: -2, r: 60, bg: ['#f0b25a', '#1a0e10'] },
    draw(ctx, J, st) {
      const t = st.t, b = st.look.body;
      const ph = st.phase >= 1 ? 1 : 0;
      const sway = Math.sin(t * 0.0015 + st.seed);
      // cape (tattered)
      const top = rot(tmp, J.hip.x, J.hip.y, J.lean, -30, -118);
      const tx = top.x, ty = top.y;
      const kmin = Math.min(J.kN.x, J.kF.x), ky = Math.max(J.kN.y, J.kF.y);
      ctx.beginPath();
      ctx.moveTo(tx + 26, ty - 6);
      const cbx = kmin - 110 - J.cape * 60 + sway * 10;
      ctx.quadraticCurveTo(tx - 90 - J.cape * 50, ty + 80, cbx, ky + 44);
      const n = 8;
      for (let i = 1; i <= n; i++) {
        const u = i / n;
        ctx.lineTo(lerp(cbx, kmin + 10, u), ky + 44 + (i % 2 ? -20 - hash(i) * 12 : 8));
      }
      ctx.quadraticCurveTo(J.hip.x - 20, J.hip.y + 20, tx + 40, ty + 14);
      ctx.closePath();
      paint(ctx, SK.cape, tx - 30, ty + 90, 90, st, 1.4, 0.5);
      if (!st.ghost) {
        ctx.save();
        ctx.clip();
        for (let i = 0; i < 4; i++) { curve(ctx, tx - i * 14, ty + 14, tx - 50 - i * 22, ty + 110, cbx + 20 + i * 26, ky + 34); stroke(ctx, SK.capeD, 3, 0.6); }
        curve(ctx, tx + 20, ty - 4, tx - 70 - J.cape * 40, ty + 60, cbx, ky + 44); stroke(ctx, '#c9a0b0', 1.6, 0.35);
        ctx.restore();
      }
      // halo (phase 0 cracked ring, phase 1 orbiting shards)
      const hx = J.head.x - 10, hy = J.head.y - 6;
      if (!ph) {
        if (!st.ghost) glow(ctx, hx, hy, HALO_R * 1.55, '#ffd98a', 0.36 + 0.06 * Math.sin(t * 0.003));
        frame(ctx, st, hx, hy, Math.sin(t * 0.0008) * 0.04);
        sprite(ctx, st, 'stillkeeper:halo', 180, 180, 90, 90, haloArt);
        unframe(ctx, st);
      } else {
        if (!st.ghost) glow(ctx, hx, hy, HALO_R * 1.4, '#fff0c0', 0.3 + 0.1 * Math.sin(t * 0.006));
        for (let i = 0; i < 9; i++) {
          const a = t * 0.0011 * (i % 2 ? 1 : -0.8) + (i * TAU) / 9;
          const r = HALO_R + 8 + Math.sin(t * 0.002 + i) * 8 + (i % 3) * 6;
          shard(ctx, hx + Math.cos(a) * r, hy + Math.sin(a) * r * 0.82, a + t * 0.002 * (i % 2 ? 1 : -1), 0.9 + (i % 3) * 0.25, st);
        }
        haloPoint(J, st, tmp2);
        shard(ctx, tmp2.x, tmp2.y, t * 0.003, 1.6, st);
        if (!st.ghost) glow(ctx, tmp2.x, tmp2.y, 20, SK.crack, 0.5);
      }
      // far arm
      limb(ctx, J.sF.x, J.sF.y, J.eF.x, J.eF.y, 20, 17, shade(SK.enamel, -0.1), st, 1.3);
      limb(ctx, J.eF.x, J.eF.y, J.hF.x, J.hF.y, 17, 15, shade(SK.gold, -0.3), st, 1.3);
      if (J.two <= 0.3) mitt(ctx, J.eF, J.hF, st, shade(SK.gold, -0.3), 0.9, SK.enamel);
      // legs
      for (const far of [true, false]) {
        const p = far ? J.pF : J.pN, k = far ? J.kF : J.kN, f = far ? J.fF : J.fN;
        const d = far ? -0.26 : 0;
        limb(ctx, p.x, p.y, k.x, k.y, 24, 18, shade(SK.enamel, d), st, 1.3);
        limb(ctx, k.x, k.y, f.x, f.y, 19, 14, shade(SK.gold, d), st, 1.3);
        circ(ctx, k.x, k.y, 15); paintR(ctx, shade(SK.gold, d + 0.05), k.x, k.y, 15, st, 1.1, 0.8);
        along(tmp2, k.x, k.y, f.x, f.y, 0.5); line(ctx, tmp2.x - 12, tmp2.y, tmp2.x + 12, tmp2.y + 2); stroke(ctx, shade(SK.goldD, d), 2.4, 0.8);
        foot(ctx, f.x, f.y, 36, b.ankle, shade(SK.gold, d - 0.1), st, Math.max(0, -(f.y + b.ankle)), 1.3);
        if (ph && !far && !st.ghost) {
          along(tmp2, k.x, k.y, f.x, f.y, 0.35);
          glowCracks(ctx, st, [[tmp2.x - 10, tmp2.y - 8, tmp2.x - 2, tmp2.y + 2, tmp2.x - 8, tmp2.y + 14, tmp2.x + 2, tmp2.y + 26]], t);
        }
      }
      // torso + heart gear
      frame(ctx, st, J.hip.x, J.hip.y, J.lean);
      sprite(ctx, st, ph ? 'stillkeeper:torso1' : 'stillkeeper:torso0', 120, 184, 58, 146, ph ? torsoP1 : torsoP0);
      const ga = t * (ph ? 0.0024 : 0.0009);
      gearPath(ctx, 18, -80, 17, 12, ga);
      paintR(ctx, SK.heart, 18, -80, 17, st, 1, 0.8, -0.4, 0.5);
      gearPath(ctx, 18, -80, 8, 8, -ga * 1.6);
      paintR(ctx, SK.gold, 18, -80, 8, st, 0.8, 0.6);
      circ(ctx, 18, -80, 3); fill(ctx, SK.dark);
      if (!st.ghost) glow(ctx, 18, -80, 34 + 8 * Math.sin(t * 0.004) + J.ch * 20, SK.heart, ph ? 0.7 : 0.45);
      if (ph && !st.ghost) glowCracks(ctx, st, TORSO_CRACKS, t);
      unframe(ctx, st);
      // head
      limb(ctx, J.neck.x, J.neck.y + 6, J.head.x, J.head.y + 10, 14, 14, SK.enamel, st, 1.2, 0.4);
      frame(ctx, st, J.head.x, J.head.y, J.headA);
      sprite(ctx, st, ph ? 'stillkeeper:helm1' : 'stillkeeper:helm0', 76, 90, 36, 52, ph ? helmP1 : helmP0);
      if (!st.ghost) {
        const fl = 0.75 + 0.25 * Math.sin(t * 0.006) + J.ch * 0.4;
        glow(ctx, 20, -3.5, 26 * fl, ph ? '#ffffff' : SK.visor, 0.7);
        glow(ctx, 21, 2, 12 * fl, SK.visor, 0.5);
      }
      unframe(ctx, st);
      // pauldron
      ell(ctx, J.sN.x, J.sN.y + 6, 34, 22, J.lean * 0.5 + 0.2);
      paintR(ctx, SK.gold, J.sN.x, J.sN.y + 6, 34, st, 1.3, 0.95);
      for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.ellipse(J.sN.x, J.sN.y + 10 + i * 7, 32 - i * 4, 18 - i * 3, J.lean * 0.5 + 0.2, 0.25, Math.PI - 0.25); stroke(ctx, SK.goldD, 2, 0.7); }
      if (ph) { polyline(ctx, [J.sN.x - 20, J.sN.y - 6, J.sN.x - 8, J.sN.y + 4, J.sN.x - 14, J.sN.y + 16]); stroke(ctx, SK.crack, 2, 0.9); }
      // near arm + glaive
      frame(ctx, st, J.hN.x, J.hN.y, J.w);
      sprite(ctx, st, 'stillkeeper:glaive', 380, 140, 100, 72, glaiveArt);
      unframe(ctx, st);
      limb(ctx, J.sN.x, J.sN.y, J.eN.x, J.eN.y, 20, 17, SK.enamel, st, 1.3);
      limb(ctx, J.eN.x, J.eN.y, J.hN.x, J.hN.y, 17, 15, SK.gold, st, 1.3);
      mitt(ctx, J.eN, J.hN, st, SK.gold, 0.95, SK.enamel);
      if (J.two > 0.3) mitt(ctx, J.eF, J.hF, st, shade(SK.gold, -0.15), 0.9, SK.enamel);
      if (ph && !st.ghost) K.motes(ctx, J.hip.x, J.hip.y - 60, 140, 200, 8, t, SK.crack, 3, 0.7, st.seed);
    },
  });

  const TORSO_CRACKS = [
    [-30, -120, -22, -100, -30, -88, -20, -74, -26, -60],
    [30, -30, 22, -18, 30, -8],
    [-48, -60, -38, -54, -42, -44, -34, -36],
    [40, -110, 32, -100, 38, -92],
    [-10, -20, -2, -12, -8, -2],
    [46, -70, 38, -60, 44, -50, 36, -40],
    [8, -44, 16, -34, 10, -24, 18, -14],
  ];
  /** Additive, pulsing white-gold crack light (phase 2 "Unwound"). */
  function glowCracks(ctx, st, segs, t) {
    const pc = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = 'lighter';
    const pulse = 0.7 + 0.3 * Math.sin(t * 0.006 + st.seed);
    for (let i = 0; i < segs.length; i++) {
      const sg = segs[i];
      polyline(ctx, sg); stroke(ctx, '#ffd98a', 7, 0.28 * pulse);
      polyline(ctx, sg); stroke(ctx, SK.crack, 2.4, 0.95 * pulse);
      glow(ctx, sg[2], sg[3], 16, SK.crack, 0.5 * pulse);
    }
    ctx.globalCompositeOperation = pc;
  }

  function haloPoint(J, st, o) {
    const hx = J.head.x - 10, hy = J.head.y - 6;
    if (st.phase >= 1) {
      const a = -Math.PI / 2 + Math.sin(st.t * 0.0009) * 0.9;
      o.x = hx + Math.cos(a) * (HALO_R + 18); o.y = hy + Math.sin(a) * (HALO_R + 18) * 0.82;
    } else { o.x = hx + 8; o.y = hy - HALO_R - 2; }
    return o;
  }

  return { stillkeeper };
}
