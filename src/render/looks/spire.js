// Meridian Spire enemy looks: Coghound (brass gear hound with an exposed mainspring), Porcelain
// Sentinel (cracked kintsugi knight with a clock-face shield) and Hour Wraith (smoke of clock hands).

/**
 * Build the spire look definitions with the shared sprite kit.
 * @param {object} K painting kit from sprites.js
 * @returns {Record<string, object>}
 */
export function defineSpireLooks(K) {
  const { D, TAU, lerp, shade, paint, paintR, paintAxis, fill, stroke, capsule, limb, ell, circ, poly, blob, line,
    curve, glow, frame, unframe, foot, hand, along, sprite, polyline } = K;
  const tmp = { x: 0, y: 0 };
  const PARTY_ALIAS = { flurry: 'thrust', heavy: 'slam', leap: 'charge', buff: 'cast', heal: 'cast', shoot: 'bolt', gradient: 'nova' };
  const rot = (o, bx, by, a, lx, ly) => { const c = Math.cos(a), s = Math.sin(a); o.x = bx + lx * c - ly * s; o.y = by + lx * s + ly * c; return o; };

  /** Toothed gear path. */
  function gearPath(ctx, x, y, r, teeth, a) {
    ctx.beginPath();
    const n = teeth * 2;
    for (let i = 0; i <= n; i++) {
      const u = (i / n) * TAU + a;
      const rr = i % 2 ? r : r * 0.78;
      const u0 = u - (TAU / n) * 0.28, u1 = u + (TAU / n) * 0.28;
      if (i === 0) ctx.moveTo(x + Math.cos(u0) * rr, y + Math.sin(u0) * rr); else ctx.lineTo(x + Math.cos(u0) * rr, y + Math.sin(u0) * rr);
      ctx.lineTo(x + Math.cos(u1) * rr, y + Math.sin(u1) * rr);
    }
    ctx.closePath();
  }
  function gear(ctx, x, y, r, teeth, a, c, st, ol = 0.7) {
    gearPath(ctx, x, y, r, teeth, a);
    paintR(ctx, c, x, y, r, st, ol, 0.7);
    circ(ctx, x, y, r * 0.3); fill(ctx, shade(c, -0.45));
  }

  // ================================================================== COGHOUND
  const CH = { brass: '#c4933f', brassD: '#6f5426', brassL: '#ecc877', steel: '#7d7f86', steelD: '#3d3e44', dark: '#1f1a18', spring: '#ffd46a', springGlow: '#ffb347', eye: '#ff6a3a' };

  function houndBodyArt(ctx, st) {
    // dark interior
    blob(ctx, [-34, -4, -24, -16, 10, -17, 32, -12, 36, 4, 22, 16, -6, 14, -30, 10]);
    paint(ctx, CH.dark, 0, 0, 30, st, 1, 0.3);
    // interior gears
    gear(ctx, -14, 2, 9, 9, 0.3, CH.brassD, st, 0.4);
    gear(ctx, 2, -4, 7, 8, 0.1, shade(CH.brassD, 0.1), st, 0.4);
    // spine plate
    ctx.beginPath(); ctx.moveTo(-36, -6); ctx.quadraticCurveTo(-10, -22, 34, -14); ctx.lineTo(36, -8); ctx.quadraticCurveTo(-8, -14, -34, 0); ctx.closePath();
    paint(ctx, CH.brass, 0, -12, 30, st, 1, 0.9);
    for (let i = 0; i < 6; i++) { const x = -26 + i * 10; circ(ctx, x, -13 - Math.sin(i / 5 * Math.PI) * 3, 1.4); fill(ctx, CH.brassL); }
    // rib bands
    for (let i = 0; i < 5; i++) {
      const x = -18 + i * 9;
      ctx.beginPath(); ctx.moveTo(x - 2, -12); ctx.quadraticCurveTo(x + 5, 2, x + 1, 15); ctx.lineTo(x + 4, 14); ctx.quadraticCurveTo(x + 8, 2, x + 2, -13); ctx.closePath();
      paint(ctx, CH.brass, x + 3, 2, 8, st, 0.7, 0.7);
    }
    // chest plate
    ctx.beginPath(); ctx.moveTo(24, -14); ctx.quadraticCurveTo(40, -8, 38, 6); ctx.quadraticCurveTo(32, 16, 22, 14); ctx.quadraticCurveTo(30, 2, 24, -14); ctx.closePath();
    paint(ctx, CH.brass, 30, 0, 12, st, 0.9, 0.9);
    // haunch plate
    ell(ctx, -26, 2, 12, 11, -0.2); paint(ctx, CH.brass, -26, 2, 12, st, 0.9, 0.8);
    ell(ctx, -26, 2, 7, 6, -0.2); stroke(ctx, CH.brassD, 1.2, 0.8);
  }

  function houndHeadArt(ctx, st) {
    // skull plate + long snout (+x forward)
    ctx.beginPath();
    ctx.moveTo(-8, -8); ctx.quadraticCurveTo(4, -12, 16, -7); ctx.lineTo(36, -3); ctx.quadraticCurveTo(39, 0, 36, 2); ctx.lineTo(10, 3); ctx.quadraticCurveTo(-6, 6, -9, 0); ctx.closePath();
    paint(ctx, CH.brass, 12, -2, 20, st, 1, 0.9);
    line(ctx, 14, -6.5, 34, -2.6); stroke(ctx, CH.brassD, 1.2, 0.8);
    for (let i = 0; i < 4; i++) { circ(ctx, 18 + i * 5, 0.5, 1); fill(ctx, CH.brassD); }
    ell(ctx, 36, -0.5, 2.4, 2); fill(ctx, CH.dark);
    // fin ears
    ctx.beginPath(); ctx.moveTo(-4, -8); ctx.lineTo(-16, -22); ctx.lineTo(-10, -20); ctx.lineTo(2, -9); ctx.closePath();
    paint(ctx, CH.steel, -7, -14, 8, st, 0.8, 0.7);
    for (let i = 0; i < 3; i++) { line(ctx, -3 - i * 3.5, -9 - i * 3.5, -1 - i * 3.5, -10.5 - i * 3.5); stroke(ctx, CH.steelD, 0.8, 0.8); }
    // cheek gear
    gear(ctx, 1, -1, 5.5, 8, 0.2, CH.brassL, st, 0.5);
  }

  const coghound = K.quadruped({
    id: 'coghound', name: 'Coghound', kind: 'enemy', height: 120, topExtra: 26, magic: '#ffb347', fxScale: 0.9, variantAlias: PARTY_ALIAS, defaultVariant: 'bite',
    body: { standH: 58, bodyLen: 54, bodyR: 16, fu: 26, fl: 28, bu: 27, bl: 22, cannon: 15, legDrop: 6, legSpread: 4, neckOff: 2, neckUp: 6,
      neckLen: 24, neckAng: -36 * D, headLen: 36, headAng: 16 * D, headR: 10, tailLen: 28, tailUp: 2, hoof: 3 },
    pad: 44, shadowRx: 44,
    castPoint(J, o) { rot(o, J.nt.x, J.nt.y, J.ha, 30, 3); },
    weak: [{ id: 'mainspring', r: 15, at(J, o) { rot(o, J.body.x, J.body.y, J.bp, 8, 6); } }],
    anchors(look, J, o) {
      o.head.x = J.nt.x; o.head.y = J.nt.y;
      rot(o.chest, J.body.x, J.body.y, J.bp, 8, 6);
      rot(o.weapon, J.nt.x, J.nt.y, J.ha, 30, 4);
      o.feet.x = J.body.x; o.feet.y = Math.max(J.fnF.y, J.bnF.y) + 3;
      o.top.x = J.nt.x; o.top.y = Math.min(J.nt.y, J.body.y) - 22;
      o.center.x = J.body.x; o.center.y = J.body.y;
      o.tip.x = o.weapon.x; o.tip.y = o.weapon.y;
    },
    portrait: { x: 10, y: 0, r: 30, bg: ['#b8893b', '#1a1510'] },
    draw(ctx, J, st) {
      const t = st.t;
      const spin = t * 0.004 + J.ex * TAU;
      const leg = (S, Kk, F, far, hind, H) => {
        const d = far ? -0.3 : 0;
        limb(ctx, S.x, S.y, Kk.x, Kk.y, hind ? 5.5 : 4.5, 3.4, shade(CH.steel, d), st, 0.9, 0.6);
        if (hind) { limb(ctx, Kk.x, Kk.y, H.x, H.y, 3.4, 2.8, shade(CH.steel, d), st, 0.9, 0.6); limb(ctx, H.x, H.y, F.x, F.y, 2.8, 2.6, shade(CH.brass, d), st, 0.9, 0.6); }
        else limb(ctx, Kk.x, Kk.y, F.x, F.y, 3.4, 2.6, shade(CH.brass, d), st, 0.9, 0.6);
        poly(ctx, [F.x - 3, F.y, F.x + 7, F.y + 1, F.x + 5, F.y + 3.5, F.x - 3, F.y + 3.5]); paint(ctx, shade(CH.steelD, d), F.x + 2, F.y + 2, 4, st, 0.5, 0.4);
        gear(ctx, S.x, S.y, hind ? 7.5 : 6.5, 8, far ? -spin : spin, shade(CH.brass, d), st, 0.6);
        circ(ctx, Kk.x, Kk.y, 2.6); paintR(ctx, shade(CH.brassL, d), Kk.x, Kk.y, 2.6, st, 0.4, 0.4);
      };
      leg(J.ffS, J.ffK, J.ffF, true, false);
      leg(J.bfS, J.bfK, J.bfF, true, true, J.bfH);
      // chain tail
      for (let i = 0; i <= 6; i++) {
        const u = i / 6;
        const x = lerp(J.tail.x, J.tailTip.x, u), y = lerp(J.tail.y, J.tailTip.y, u) + Math.sin(u * Math.PI + t * 0.006) * 3 * u;
        ell(ctx, x, y, 3, 2, i % 2 ? 1.2 : 0.2); ctx.lineWidth = 1.6; ctx.strokeStyle = i % 2 ? CH.steel : CH.brass; ctx.stroke();
      }
      gear(ctx, J.tailTip.x, J.tailTip.y, 4.5, 7, spin * 1.5, CH.brassL, st, 0.5);
      // body
      frame(ctx, st, J.body.x, J.body.y, J.bp);
      sprite(ctx, st, 'coghound:body', 84, 44, 42, 22, houndBodyArt);
      // mainspring (live glow, slow unwind)
      const cx = 8, cy = 6;
      ctx.beginPath();
      for (let i = 0; i < 44; i++) {
        const a = i * 0.42 + t * 0.002, r = 1 + i * 0.2;
        const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r * 0.9;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      stroke(ctx, CH.spring, 1.5, 0.95);
      if (!st.ghost) glow(ctx, cx, cy, 14 + 3 * Math.sin(t * 0.006 + st.seed) + J.ch * 10, CH.springGlow, 0.55);
      // wind-up key (turning)
      const kx = -12, ky = -18, ks = Math.cos(t * 0.003 + st.seed);
      line(ctx, kx, ky, kx, ky - 7); stroke(ctx, CH.brassD, 2.4);
      frame(ctx, st, kx, ky - 12, 0, Math.abs(ks) < 0.12 ? 0.12 : ks, 1);
      // butterfly key bow: two flared wings around a hub
      ctx.beginPath();
      ctx.moveTo(0, -2.2);
      ctx.bezierCurveTo(-4, -7.5, -11, -6.5, -10.5, 0);
      ctx.bezierCurveTo(-11, 6.5, -4, 7.5, 0, 2.2);
      ctx.bezierCurveTo(4, 7.5, 11, 6.5, 10.5, 0);
      ctx.bezierCurveTo(11, -6.5, 4, -7.5, 0, -2.2);
      ctx.closePath();
      paint(ctx, CH.brassL, 0, 0, 10, st, 0.8, 0.9);
      curve(ctx, -8.5, -2.5, -5, 0, -8.5, 2.5); stroke(ctx, CH.brassD, 0.9, 0.8);
      curve(ctx, 8.5, -2.5, 5, 0, 8.5, 2.5); stroke(ctx, CH.brassD, 0.9, 0.8);
      circ(ctx, 0, 0, 2.2); paintR(ctx, CH.brass, 0, 0, 2.2, st, 0.5, 0.5);
      unframe(ctx, st);
      unframe(ctx, st);
      leg(J.bnS, J.bnK, J.bnF, false, true, J.bnH);
      leg(J.fnS, J.fnK, J.fnF, false, false);
      // neck segments
      for (let i = 0; i < 3; i++) {
        along(tmp, J.nb.x, J.nb.y + 3, J.nt.x, J.nt.y, i / 3 + 0.12);
        ell(ctx, tmp.x, tmp.y, 7 - i * 0.6, 8 - i * 0.6, J.na);
        paintR(ctx, i % 2 ? CH.brass : shade(CH.brass, -0.15), tmp.x, tmp.y, 7, st, 0.8, 0.6);
      }
      // head + jaw
      frame(ctx, st, J.nt.x, J.nt.y, J.ha);
      frame(ctx, st, 4, 3, J.ja * 0.6 + 0.04);
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(28, 0); ctx.quadraticCurveTo(30, 3, 27, 5); ctx.lineTo(2, 5); ctx.closePath();
      paint(ctx, CH.steel, 14, 2, 12, st, 0.8, 0.6);
      for (let i = 0; i < 6; i++) { poly(ctx, [5 + i * 4, 0.2, 7 + i * 4, -2.8, 9 + i * 4, 0.2]); fill(ctx, '#f2ead8'); }
      unframe(ctx, st);
      for (let i = 0; i < 6; i++) { poly(ctx, [11 + i * 4, 2.6, 13 + i * 4, 5.4, 15 + i * 4, 2.6]); fill(ctx, '#f2ead8'); }
      sprite(ctx, st, 'coghound:head', 58, 36, 18, 24, houndHeadArt);
      circ(ctx, 12, -4, 2.4); fill(ctx, CH.dark);
      if (!st.ghost) glow(ctx, 12.4, -4.2, 7 + J.ch * 5, CH.eye, 0.9);
      circ(ctx, 12.6, -4.2, 1.1); fill(ctx, '#ffe0c0');
      unframe(ctx, st);
    },
  });

  // ================================================================== PORCELAIN SENTINEL
  const PS = { por: '#ece7de', porD: '#bdb6ab', blue: '#2f5fa8', blueL: '#6f95d4', gold: '#d9b25a', goldD: '#8a6a2a', crack: '#3a2a1a', steel: '#dfe5ec',
    visor: '#9fd0ff', face: '#f4eee0', numeral: '#2a2430' };

  /** Delft-blue flourish: a four-petal flower with two curling scroll leaves. */
  function delft(ctx, x, y, s, st) {
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2 + Math.PI / 4;
      ell(ctx, x + Math.cos(a) * 2.4 * s, y + Math.sin(a) * 2.4 * s, 2 * s, 1.2 * s, a);
      fill(ctx, i % 2 ? PS.blueL : PS.blue, 0.9);
    }
    circ(ctx, x, y, 1 * s); fill(ctx, PS.gold);
    ctx.beginPath(); ctx.moveTo(x - 3 * s, y + 3 * s); ctx.bezierCurveTo(x - 7 * s, y + 5 * s, x - 9 * s, y + 1 * s, x - 7 * s, y - 1 * s); stroke(ctx, PS.blue, 0.9 * s, 0.85);
    ctx.beginPath(); ctx.moveTo(x + 3 * s, y - 3 * s); ctx.bezierCurveTo(x + 7 * s, y - 5 * s, x + 9 * s, y - 1 * s, x + 7 * s, y + 1 * s); stroke(ctx, PS.blue, 0.9 * s, 0.85);
  }
  function kintsugi(ctx, pts, st) {
    polyline(ctx, pts);
    stroke(ctx, PS.crack, 1.6, 0.9);
    polyline(ctx, pts);
    stroke(ctx, PS.gold, 0.9, 0.9);
  }

  function sentinelTorsoArt(ctx, st) {
    const T = 62;
    blob(ctx, [-16, 3, -18, -22, -17, -46, -12, -T + 1, -3, -T - 2, 8, -T, 17, -T + 8, 19, -38, 16, -16, 14, 3]);
    paint(ctx, PS.por, 1, -T * 0.5, 26, st, 1.1, 0.95);
    // gold trim & plate lines
    curve(ctx, -14, -T + 6, 4, -T + 12, 18, -T + 8); stroke(ctx, PS.gold, 1.6, 0.9);
    curve(ctx, -16, -20, 0, -14, 16, -18); stroke(ctx, PS.gold, 1.4, 0.85);
    curve(ctx, -16, -4, 0, 2, 15, -2); stroke(ctx, PS.goldD, 1.4, 0.8);
    // delft filigree
    delft(ctx, 6, -40, 1.1, st);
    delft(ctx, -6, -30, 0.8, st);
    delft(ctx, 8, -10, 0.7, st);
    // big chest crack (weak point) with gold kintsugi
    kintsugi(ctx, [-2, -T + 4, 3, -48, 0, -40, 6, -33, 3, -26], st);
    kintsugi(ctx, [3, -48, 9, -46, 13, -50], st);
    kintsugi(ctx, [0, -40, -6, -37, -9, -40], st);
    // tassets
    for (let i = 0; i < 3; i++) {
      ctx.beginPath(); ctx.moveTo(-15 + i * 10, 2); ctx.lineTo(-5 + i * 10, 2); ctx.lineTo(-6 + i * 10, 16); ctx.quadraticCurveTo(-10 + i * 10, 18, -14 + i * 10, 16); ctx.closePath();
      paint(ctx, i === 1 ? PS.por : PS.porD, -10 + i * 10, 9, 8, st, 0.9, 0.8);
      line(ctx, -14 + i * 10, 15, -6 + i * 10, 15); stroke(ctx, PS.gold, 1.1, 0.9);
    }
  }

  function sentinelHelmArt(ctx, st) {
    // crest plume (porcelain fin)
    ctx.beginPath(); ctx.moveTo(-10, -14); ctx.quadraticCurveTo(-4, -34, 14, -30); ctx.quadraticCurveTo(2, -26, 4, -14); ctx.closePath();
    paint(ctx, PS.blue, 0, -24, 12, st, 0.9, 0.8);
    // helm
    ctx.beginPath();
    ctx.moveTo(-14, 10); ctx.quadraticCurveTo(-17, -12, -4, -17); ctx.quadraticCurveTo(12, -19, 17, -6); ctx.quadraticCurveTo(19, 4, 16, 12); ctx.quadraticCurveTo(2, 16, -14, 10); ctx.closePath();
    paint(ctx, PS.por, 1, -2, 18, st, 1.1, 0.95);
    // visor slit
    ctx.beginPath(); ctx.moveTo(3, -4); ctx.lineTo(18, -5); ctx.lineTo(18, -1.4); ctx.lineTo(3, -0.6); ctx.closePath();
    fill(ctx, '#15202e');
    curve(ctx, -12, 6, 2, 10, 16, 7); stroke(ctx, PS.gold, 1.4, 0.9);
    delft(ctx, -5, -7, 0.7, st);
    kintsugi(ctx, [-8, -16, -5, -10, -9, -4], st);
    for (let i = 0; i < 3; i++) { circ(ctx, 8 + i * 3.5, 5, 0.9); fill(ctx, '#15202e'); }
  }

  function clockShieldArt(ctx, st) {
    const r = 34;
    circ(ctx, 0, 0, r);
    paintR(ctx, PS.gold, 0, 0, r, st, 1.2, 0.9);
    circ(ctx, 0, 0, r - 5);
    paintR(ctx, PS.face, 0, 0, r - 5, st, 0.6, 0.6, -0.25, 0.3);
    for (let i = 0; i < 12; i++) {
      const a = (i * TAU) / 12 - Math.PI / 2;
      const r0 = i % 3 === 0 ? r - 13 : r - 10;
      line(ctx, Math.cos(a) * r0, Math.sin(a) * r0, Math.cos(a) * (r - 7), Math.sin(a) * (r - 7));
      stroke(ctx, PS.numeral, i % 3 === 0 ? 2.4 : 1.2, 0.9);
    }
    ctx.beginPath(); ctx.arc(0, 0, r - 16, 0, TAU); stroke(ctx, PS.blueL, 0.8, 0.6);
    kintsugi(ctx, [-r + 6, -6, -14, -2, -10, 8, -16, 18], st);
  }

  const sentinel = K.humanoid({
    id: 'sentinel', name: 'Porcelain Sentinel', kind: 'enemy', height: 215, topExtra: 22, olScale: 1.15, fxScale: 1.3,
    body: { thigh: 46, shin: 46, upper: 32, fore: 32, torso: 62, neck: 8, headR: 15, shDrop: 8, shN: -8, shF: 10, hipN: -4, hipF: 4, wlen: 110, wtail: 14, grip: 12, bw: 26, ankle: 6 },
    twoHand: 0, shootHand: 'near', armSwing: 0.22, magic: '#9fd0ff', trailColor: '#e8f4ff', variantAlias: PARTY_ALIAS, defaultVariant: 'slash',
    book: {
      ready: { nhx: 0.5, nhy: 0.55, w: -58 * D, fhx: 0.62, fhy: 0.2, lean: 0.04, ry: 0.05, nfx: -0.22, ffx: 0.26 },
      guard: { fhx: 0.85, fhy: 0.05, nhx: 0.3, nhy: 0.45, w: -80 * D },
      parry: { fhx: 0.9, fhy: 0.0 },
      carry: { nhx: 0.3, nhy: 0.6, w: -100 * D, fhx: 0.4, fhy: 0.35 },
    },
    castPoint(J, o) { o.x = J.tip.x; o.y = J.tip.y; },
    parryPoint(J, o) { o.x = J.hF.x + 8; o.y = J.hF.y; },
    weak: [
      { id: 'clockface', r: 26, at(J, o) { o.x = J.hF.x + 8; o.y = J.hF.y; } },
      { id: 'crack', r: 18, at(J, o) { rot(o, J.hip.x, J.hip.y, J.lean, 2, -42); } },
    ],
    portrait: { x: 2, y: 2, r: 30, bg: ['#6f95d4', '#141a2a'] },
    draw(ctx, J, st) {
      const t = st.t, b = st.look.body;
      // far arm
      limb(ctx, J.sF.x, J.sF.y, J.eF.x, J.eF.y, 7, 6.2, PS.porD, st);
      limb(ctx, J.eF.x, J.eF.y, J.hF.x, J.hF.y, 6.2, 5.6, PS.porD, st);
      // legs
      for (const far of [true, false]) {
        const p = far ? J.pF : J.pN, k = far ? J.kF : J.kN, f = far ? J.fF : J.fN;
        const d = far ? -0.22 : 0;
        limb(ctx, p.x, p.y, k.x, k.y, 9, 7, shade(PS.por, d), st);
        limb(ctx, k.x, k.y, f.x, f.y, 7.5, 6, shade(PS.por, d), st);
        circ(ctx, k.x, k.y, 6.5); paintR(ctx, shade(PS.gold, d), k.x, k.y, 6.5, st, 0.8, 0.7);
        if (!far) { along(tmp, k.x, k.y, f.x, f.y, 0.5); delft(ctx, tmp.x, tmp.y - 2, 0.6, st); }
        foot(ctx, f.x, f.y, 17, b.ankle, shade(PS.porD, d), st, Math.max(0, -(f.y + b.ankle)));
      }
      // torso
      frame(ctx, st, J.hip.x, J.hip.y, J.lean);
      sprite(ctx, st, 'sentinel:torso', 44, 90, 20, 70, sentinelTorsoArt);
      unframe(ctx, st);
      // clock-face shield on the far hand, hands ticking
      frame(ctx, st, J.hF.x + 8, J.hF.y, J.lean * 0.3);
      frame(ctx, st, 0, 0, 0, 0.7, 1);
      sprite(ctx, st, 'sentinel:shield', 76, 76, 38, 38, clockShieldArt);
      const hA = t * 0.0004 + st.seed, mA = t * 0.004 + st.seed * 2;
      line(ctx, 0, 0, Math.cos(hA) * 14, Math.sin(hA) * 14); stroke(ctx, PS.numeral, 3);
      line(ctx, 0, 0, Math.cos(mA) * 22, Math.sin(mA) * 22); stroke(ctx, PS.numeral, 1.8);
      circ(ctx, 0, 0, 3); paintR(ctx, PS.gold, 0, 0, 3, st, 0.5, 0.6);
      unframe(ctx, st);
      unframe(ctx, st);
      // head
      limb(ctx, J.neck.x, J.neck.y + 3, J.head.x, J.head.y + 6, 6, 6, PS.porD, st, 0.8, 0.4);
      frame(ctx, st, J.head.x, J.head.y, J.headA);
      sprite(ctx, st, 'sentinel:helm', 44, 56, 20, 38, sentinelHelmArt);
      if (!st.ghost) glow(ctx, 12, -2.8, 12 + J.ch * 10, PS.visor, 0.6 + 0.15 * Math.sin(t * 0.005));
      unframe(ctx, st);
      // near arm: pauldron + vambrace + long sword
      frame(ctx, st, J.hN.x, J.hN.y, J.w);
      const wl = b.wlen;
      ctx.beginPath(); ctx.moveTo(7, -3); ctx.lineTo(wl - 10, -2.6); ctx.lineTo(wl, 0); ctx.lineTo(wl - 10, 2.6); ctx.lineTo(7, 3); ctx.closePath();
      paintAxis(ctx, PS.steel, 7, 0, wl, 0, 3, st, 0.9, 0.9, -0.35, 0.4);
      line(ctx, 9, 0, wl - 12, 0); stroke(ctx, '#9aa4b0', 0.8, 0.7);
      capsule(ctx, 5, -9, 5, 9, 2, 2); paintAxis(ctx, PS.gold, 5, -9, 5, 9, 2.4, st, 0.7, 0.8);
      capsule(ctx, -12, 0, 4, 0, 2.2, 2); paintAxis(ctx, PS.blue, -12, 0, 4, 0, 2.4, st, 0.6, 0.5);
      circ(ctx, -13.5, 0, 3); paintR(ctx, PS.gold, -13.5, 0, 3, st, 0.6, 0.7);
      unframe(ctx, st);
      limb(ctx, J.sN.x, J.sN.y, J.eN.x, J.eN.y, 7.4, 6.4, PS.por, st);
      limb(ctx, J.eN.x, J.eN.y, J.hN.x, J.hN.y, 6.8, 6, PS.por, st);
      along(tmp, J.eN.x, J.eN.y, J.hN.x, J.hN.y, 0.45); delft(ctx, tmp.x, tmp.y, 0.55, st);
      ell(ctx, J.sN.x, J.sN.y + 2, 13, 9, J.lean * 0.5 + 0.25);
      paintR(ctx, PS.por, J.sN.x, J.sN.y + 2, 13, st, 1, 0.9);
      ctx.beginPath(); ctx.ellipse(J.sN.x, J.sN.y + 3, 12, 8, J.lean * 0.5 + 0.25, 0.3, Math.PI - 0.3); stroke(ctx, PS.gold, 1.4, 0.9);
      hand(ctx, J.hN.x, J.hN.y, 5.2, PS.porD, st, 0.8);
    },
  });

  // ================================================================== HOUR WRAITH
  const HW = { smoke: '#6b5a86', smokeD: '#3a2f4e', smokeL: '#a996c8', face: '#e9e1cc', faceD: '#b3a88f', iron: '#2a2330', gold: '#d9b25a', eye: '#c7a0ff', eyeCore: '#ffffff' };

  function clockHand(ctx, x0, y0, x1, y1, w, c, st, ornate) {
    const a = Math.atan2(y1 - y0, x1 - x0), L = Math.hypot(x1 - x0, y1 - y0);
    frame(ctx, st, x0, y0, a);
    ctx.beginPath();
    ctx.moveTo(-w * 0.8, 0);
    ctx.lineTo(L * 0.62, -w);
    if (ornate) { ctx.lineTo(L * 0.7, -w * 2.4); ctx.lineTo(L * 0.78, -w); }
    ctx.lineTo(L, 0);
    if (ornate) { ctx.lineTo(L * 0.78, w); ctx.lineTo(L * 0.7, w * 2.4); }
    ctx.lineTo(L * 0.62, w);
    ctx.closePath();
    paintAxis(ctx, c, 0, 0, L, 0, w * 2, st, 0.8, 0.6);
    if (ornate) { circ(ctx, L * 0.7, 0, w * 1.1); fill(ctx, HW.gold); }
    unframe(ctx, st);
  }

  function wraithFaceArt(ctx, st) {
    circ(ctx, 0, 0, 16);
    paintR(ctx, HW.face, 0, 0, 16, st, 1, 0.8, -0.4, 0.3);
    ctx.beginPath(); ctx.arc(0, 0, 16, 0, TAU); stroke(ctx, HW.gold, 2.2, 0.9);
    for (let i = 0; i < 12; i++) {
      const a = (i * TAU) / 12;
      line(ctx, Math.cos(a) * 12.5, Math.sin(a) * 12.5, Math.cos(a) * 15, Math.sin(a) * 15);
      stroke(ctx, HW.iron, i % 3 === 0 ? 1.8 : 0.9, 0.9);
    }
    // cracks through the face
    polyline(ctx, [-2, -16, 1, -8, -3, -2, 2, 6, 0, 16]); stroke(ctx, HW.iron, 1.2, 0.85);
    polyline(ctx, [1, -8, 8, -6, 12, -10]); stroke(ctx, HW.iron, 0.9, 0.8);
    // hollow eye sockets
    ell(ctx, 5, -3, 4, 3.2, -0.2); fill(ctx, '#140f1c');
    ell(ctx, -5, -3, 3.4, 3, 0.2); fill(ctx, '#140f1c');
    ctx.beginPath(); ctx.moveTo(-5, 7); ctx.quadraticCurveTo(1, 4, 7, 7); ctx.quadraticCurveTo(1, 10, -5, 7); ctx.closePath(); fill(ctx, '#140f1c', 0.85);
  }

  const hourwraith = K.humanoid({
    id: 'hourwraith', name: 'Hour Wraith', kind: 'enemy', height: 200, topExtra: 22, floating: true, jumpH: 0.9, olScale: 1.05, fxScale: 1.3,
    body: { thigh: 40, shin: 40, upper: 30, fore: 36, torso: 56, neck: 8, headR: 16, shDrop: 8, shN: -8, shF: 9, hipN: -3, hipF: 3, wlen: 30, wtail: 0, grip: 10, bw: 26 },
    twoHand: 0, shootHand: 'near', armSwing: 0.3, magic: '#c7a0ff', trailColor: '#e0cfff', variantAlias: PARTY_ALIAS, defaultVariant: 'slash',
    book: {
      ready: { nhx: 0.5, nhy: 0.45, w: 30 * D, fhx: 0.55, fhy: 0.3, fe: -1, lean: 0.14, hd: 0.1, ry: -0.05, nfx: -0.1, nfy: 0.25, ffx: 0.12, ffy: 0.25 },
      carry: { nhx: 0.3, nhy: 0.55, w: 60 * D, fhx: 0.3, fhy: 0.5 },
      victory: { nhx: -0.3, nhy: -0.9, w: -110 * D, fhx: 0.6, fhy: -0.8, lean: -0.2, hd: -0.3 },
    },
    castPoint(J, o) { o.x = J.tip.x; o.y = J.tip.y; },
    weak: [{ id: 'pendulum', r: 15, at(J, o, st) { pendulumPos(J, st, o); } }],
    extent(look, J, o) {
      o[0] = Math.min(J.hip.x, J.hN.x, J.hF.x, J.tip.x) - 60; o[2] = Math.max(J.hip.x, J.hN.x, J.hF.x, J.tip.x, J.head.x) + 60;
      o[1] = Math.min(J.head.y, J.hN.y, J.hF.y, J.tip.y) - 70; o[3] = 10;
    },
    bounds(look, J, o) { o[0] = Math.min(J.hip.x, J.neck.x) - 26; o[2] = Math.max(J.hip.x, J.neck.x, J.head.x) + 26; o[1] = J.head.y - 20; o[3] = J.hip.y + 40; },
    anchors(look, J, o) {
      o.head.x = J.head.x; o.head.y = J.head.y;
      o.chest.x = lerp(J.hip.x, J.neck.x, 0.62); o.chest.y = lerp(J.hip.y, J.neck.y, 0.62);
      o.weapon.x = J.tip.x; o.weapon.y = J.tip.y;
      o.feet.x = J.hip.x; o.feet.y = 0;
      o.top.x = J.head.x; o.top.y = J.head.y - 34;
      o.center.x = lerp(J.hip.x, J.neck.x, 0.4); o.center.y = lerp(J.hip.y, J.neck.y, 0.4);
      o.tip.x = J.tip.x; o.tip.y = J.tip.y;
    },
    portrait: { x: 0, y: 4, r: 30, bg: ['#6b5a86', '#140f1c'] },
    draw(ctx, J, st) {
      const t = st.t;
      // smoke tail: soft puffs drifting down and back from the hips
      const tails = 4;
      for (let i = 0; i < tails; i++) {
        const off = (i - (tails - 1) / 2) * 8;
        for (let k = 0; k <= 6; k++) {
          const u = k / 6;
          const x = J.hip.x + off * (1 - u * 0.4) + Math.sin(t * 0.003 + u * 5 + i * 1.7 + st.seed) * (4 + u * 10) - u * 16 - J.cape * u * 20;
          const y = J.hip.y + 8 + u * (-J.hip.y - 8) * 0.92;
          K.puff(ctx, x, y, 34 - u * 16, k % 2 ? HW.smoke : HW.smokeD, (0.9 - u * 0.5) * (st.ghost ? 0.5 : 1));
        }
      }
      // far arm (clock hand)
      clockHand(ctx, J.sF.x, J.sF.y, J.eF.x, J.eF.y, 2.6, shade(HW.iron, 0.1), st, false);
      clockHand(ctx, J.eF.x, J.eF.y, J.hF.x + (J.hF.x - J.eF.x) * 0.4, J.hF.y + (J.hF.y - J.eF.y) * 0.4, 3.2, HW.iron, st, true);
      // smoky torso: drifting translucent puffs around a darker core
      frame(ctx, st, J.hip.x, J.hip.y, J.lean);
      const T = 56;
      ell(ctx, 1, -T * 0.5, 12, T * 0.48); fill(ctx, HW.smokeD, st.ghost ? 0.4 : 0.8);
      for (let i = 0; i < 10; i++) {
        const u = i / 9;
        const px = Math.sin(t * 0.0021 + i * 2.1 + st.seed) * 7 + (i % 2 ? 5 : -4);
        const py = -u * T + Math.cos(t * 0.0017 + i * 1.3) * 3;
        const r = 26 + Math.sin(t * 0.003 + i * 1.7) * 4 + (1 - Math.abs(u - 0.55)) * 10;
        K.puff(ctx, px, py, r, i % 3 === 0 ? HW.smokeL : i % 2 ? HW.smoke : HW.smokeD, st.ghost ? 0.4 : 0.95);
      }
      if (!st.ghost) glow(ctx, 2, -T * 0.55, 30, '#8a70c0', 0.25);
      unframe(ctx, st);
      // pendulum (behind the rib hands)
      pendulumPos(J, st, tmp);
      const topx = J.neck.x, topy = J.neck.y + 4;
      line(ctx, topx, topy, tmp.x, tmp.y); stroke(ctx, HW.gold, 2);
      circ(ctx, tmp.x, tmp.y, 8.5); paintR(ctx, HW.gold, tmp.x, tmp.y, 8.5, st, 0.9, 0.9, -0.35, 0.5);
      if (!st.ghost) glow(ctx, tmp.x, tmp.y, 16, '#ffe7a0', 0.4);
      // ribs of clock hands
      frame(ctx, st, J.hip.x, J.hip.y, J.lean);
      for (let i = 0; i < 5; i++) {
        const y = -T + 10 + i * 8;
        const len = 20 - Math.abs(i - 2) * 2;
        ctx.beginPath(); ctx.moveTo(-8, y); ctx.quadraticCurveTo(6, y - 6, len - 4, y + 2); ctx.lineTo(len - 6, y + 4); ctx.quadraticCurveTo(4, y - 2, -8, y + 3); ctx.closePath();
        paint(ctx, HW.iron, 4, y, 12, st, 0.5, 0.6);
      }
      unframe(ctx, st);
      // head: clock face + hand horns + eyes
      frame(ctx, st, J.head.x, J.head.y, J.headA);
      clockHand(ctx, -4, -10, -16, -34, 2.2, HW.iron, st, true);
      clockHand(ctx, 4, -12, 14, -30, 1.8, HW.iron, st, false);
      sprite(ctx, st, 'hourwraith:face', 40, 40, 20, 20, wraithFaceArt);
      if (!st.ghost) {
        const fl = 0.75 + 0.25 * Math.sin(t * 0.009 + st.seed) + J.ch * 0.5;
        glow(ctx, 5, -3, 9 * fl, HW.eye, 0.9);
        glow(ctx, -5, -3, 7 * fl, HW.eye, 0.7);
        circ(ctx, 5, -3, 1.4); fill(ctx, HW.eyeCore);
      }
      unframe(ctx, st);
      // wisps rising
      if (!st.ghost) K.motes(ctx, J.head.x, J.head.y - 8, 40, 50, 5, t, HW.smokeL, 3, 0.5, st.seed);
      // near arm (clock hand, weapon = claw tip)
      clockHand(ctx, J.sN.x, J.sN.y, J.eN.x, J.eN.y, 2.8, shade(HW.iron, 0.2), st, false);
      clockHand(ctx, J.eN.x, J.eN.y, J.tip.x, J.tip.y, 3.6, shade(HW.iron, 0.12), st, true);
      circ(ctx, J.eN.x, J.eN.y, 3.2); paintR(ctx, HW.gold, J.eN.x, J.eN.y, 3.2, st, 0.5, 0.6);
      circ(ctx, J.sN.x, J.sN.y, 4.2); paintR(ctx, HW.gold, J.sN.x, J.sN.y, 4.2, st, 0.5, 0.6);
    },
  });
  function pendulumPos(J, st, o) {
    const sw = Math.sin(st.t * (TAU / 1600) + st.seed) * 0.5;
    const L = 30;
    const a = sw - J.lean * 0.5;
    o.x = J.neck.x + Math.sin(a) * L; o.y = J.neck.y + 4 + Math.cos(a) * L;
    return o;
  }

  return { coghound, sentinel, hourwraith };
}
