// Party looks for Expedition 69: Gideon Marchal (Vanguard), Nyra Solace (Glyphwright) and
// Sable Arden (Duelist). Humanoid rigs with bespoke costume painting and mechanic flourishes
// (Gideon's surge gauntlet, Nyra's orbiting glyphs, Sable's stance-tinted plume and blade).

/**
 * Build the party look definitions with the shared sprite kit.
 * @param {object} K painting kit from sprites.js
 * @returns {Record<string, object>}
 */
export function definePartyLooks(K) {
  const { D, TAU, clamp, lerp, hash, shade, mix, paint, paintR, paintAxis, fill, stroke, capsule, limb, ell, circ,
    poly, blob, line, curve, glow, star, bolt, frame, unframe, foot, hand, mech, along, sprite } = K;
  const tmp = { x: 0, y: 0 }, tmp2 = { x: 0, y: 0 };

  // ------------------------------------------------------------------ shared humanoid parts
  /** Trouser thigh + boot shin + foot. */
  function leg(ctx, J, st, far, c) {
    const pS = far ? J.pF : J.pN, k = far ? J.kF : J.kN, f = far ? J.fF : J.fN;
    const d = far ? -0.16 : 0;
    const b = st.look.body;
    limb(ctx, pS.x, pS.y, k.x, k.y, c.thighR, c.kneeR, shade(c.trouser, d), st);
    limb(ctx, k.x, k.y, f.x, f.y, c.kneeR * 0.95, c.ankleR, shade(c.boot, d), st);
    if (c.cuff) {
      const dx = f.x - k.x, dy = f.y - k.y, dd = Math.hypot(dx, dy) || 1;
      const ux = dx / dd, uy = dy / dd, nx = -uy, ny = ux;
      const r0 = c.kneeR * 1.45, r1 = c.kneeR * 1.02;
      const ax = k.x - ux * 3, ay = k.y - uy * 3, bx = k.x + ux * c.cuffLen, by = k.y + uy * c.cuffLen;
      poly(ctx, [ax + nx * r0, ay + ny * r0, bx + nx * r1, by + ny * r1, bx - nx * r1, by - ny * r1, ax - nx * r0, ay - ny * r0]);
      paintAxis(ctx, shade(c.cuff, d), ax, ay, bx, by, r0, st, 1, 0.6);
      line(ctx, ax + nx * r0, ay + ny * r0, ax - nx * r0, ay - ny * r0);
      stroke(ctx, shade(c.cuff, 0.25 + d), 1, 0.7);
    }
    foot(ctx, f.x, f.y, c.footLen, b.ankle, shade(c.shoe || c.boot, d - 0.05), st, Math.max(0, -(f.y + b.ankle)));
  }

  /** Two-segment sleeve arm (upper + fore) ending at the hand. */
  function arm(ctx, s, e, h, st, color, r0, r1, r2) {
    limb(ctx, s.x, s.y, e.x, e.y, r0, r1, color, st);
    limb(ctx, e.x, e.y, h.x, h.y, r1, r2, color, st);
  }

  function torsoFrame(ctx, J, st) { frame(ctx, st, J.hip.x, J.hip.y, J.lean); }

  // ================================================================== GIDEON
  const GC = {
    navy: '#294470', navyD: '#1a2b49', lapel: '#1f345a', gold: '#e3b75a', brass: '#c9973f', brassD: '#7d5a22',
    trouser: '#363743', boot: '#2b1f19', cuff: '#4d3626', skin: '#dda683', skinD: '#b87d5c', beard: '#c9c3ba', hair: '#9d978f',
    glove: '#5c3c2a', steel: '#dfe6ee', leather: '#5f3a24', visor: '#141110', arc: '#9fdcff', belt: '#4a2f1f',
    thighR: 8.2, kneeR: 6.6, ankleR: 5.4, footLen: 14, cuffLen: 8,
  };

  function gideonGauntlet(ctx, J, st, s01) {
    const e = J.eF, h = J.hF;
    const t = st.t;
    const dx = h.x - e.x, dy = h.y - e.y, d = Math.hypot(dx, dy) || 1;
    const nx = -dy / d, ny = dx / d;
    // bracer
    limb(ctx, e.x, e.y, h.x - dx * 0.08, h.y - dy * 0.08, 7.6, 8.8, GC.brass, st, 1, 0.9);
    // bands
    ctx.lineCap = 'butt';
    for (const u of [0.22, 0.5, 0.76]) {
      const bx = e.x + dx * u, by = e.y + dy * u;
      line(ctx, bx - nx * 8.2, by - ny * 8.2, bx + nx * 8.2, by + ny * 8.2);
      stroke(ctx, GC.brassD, 1.8, 0.85, 'butt');
    }
    ctx.lineCap = 'round';
    // coil tube
    const cx0 = e.x + dx * 0.18 - nx * 4.5, cy0 = e.y + dy * 0.18 - ny * 4.5;
    const cx1 = e.x + dx * 0.84 - nx * 4.5, cy1 = e.y + dy * 0.84 - ny * 4.5;
    line(ctx, cx0, cy0, cx1, cy1);
    stroke(ctx, '#233345', 4.2);
    line(ctx, cx0, cy0, cx1, cy1);
    stroke(ctx, mix('#6aa9d6', '#e8fbff', s01), 2.2);
    for (let i = 0; i < 5; i++) {
      const u = 0.22 + i * 0.14;
      circ(ctx, e.x + dx * u - nx * 4.5, e.y + dy * u - ny * 4.5, 1.6);
      fill(ctx, GC.brassD);
    }
    // fist
    circ(ctx, h.x, h.y, 7.4);
    paintR(ctx, GC.brass, h.x, h.y, 7.4, st, 1, 0.9);
    for (let i = 0; i < 3; i++) {
      const a = Math.atan2(dy, dx) - 0.7 + i * 0.7;
      circ(ctx, h.x + Math.cos(a) * 5.2, h.y + Math.sin(a) * 5.2, 2.2);
      paintR(ctx, shade(GC.brass, 0.15), h.x + Math.cos(a) * 5.2, h.y + Math.sin(a) * 5.2, 2.2, st, 0.5, 0.4);
    }
    if (st.ghost) return;
    // glow + arcs
    const fl = 0.8 + 0.2 * Math.sin(t * 0.043 + st.seed);
    glow(ctx, h.x, h.y, (13 + 18 * s01) * fl, GC.arc, 0.28 + 0.5 * s01);
    glow(ctx, (cx0 + cx1) / 2, (cy0 + cy1) / 2, 10 + 10 * s01, GC.arc, 0.2 + 0.35 * s01);
    const n = 1 + Math.round(s01 * 4);
    const seed = Math.floor(t / 70);
    for (let i = 0; i < n; i++) {
      if (hash(seed * 3.1 + i) > 0.35 + 0.6 * s01 && i > 0) continue;
      const a = hash(seed + i * 11.3) * TAU;
      const r = 9 + hash(seed * 1.7 + i) * (7 + 14 * s01);
      bolt(ctx, h.x + Math.cos(a) * 5, h.y + Math.sin(a) * 5, h.x + Math.cos(a) * r, h.y + Math.sin(a) * r, seed + i, GC.arc, 0.6 + 0.5 * s01, 0.28, 0.5 + 0.5 * s01);
    }
  }

  function gideonSaber(ctx, J, st) {
    const wl = st.look.body.wlen;
    frame(ctx, st, J.hN.x, J.hN.y, J.w);
    sprite(ctx, st, 'gideon:saber', wl + 16, 16, 12, 8, gideonSaberArt);
    unframe(ctx, st);
  }
  function gideonSaberArt(ctx, st) {
    const wl = st.look.body.wlen;
    // blade
    ctx.beginPath();
    ctx.moveTo(5, -2.4);
    ctx.quadraticCurveTo(wl * 0.55, -4.8, wl, 1.2);
    ctx.quadraticCurveTo(wl * 0.62, 1.4, 5, 2.3);
    ctx.closePath();
    paintAxis(ctx, GC.steel, 5, 0, wl, 0, 3.6, st, 0.8, 0.9, -0.35, 0.4);
    curve(ctx, 8, -1.2, wl * 0.55, -3.3, wl - 3, 0.6);
    stroke(ctx, '#ffffff', 0.8, 0.8);
    curve(ctx, 8, 0.9, wl * 0.55, -0.4, wl * 0.85, 0.6);
    stroke(ctx, '#6c7686', 0.7, 0.45);
    // grip + pommel
    capsule(ctx, -7, 0, 4, 0, 2.3, 2.1);
    paintAxis(ctx, GC.leather, -7, 0, 4, 0, 2.3, st, 0.7, 0.4);
    circ(ctx, -8, 0, 2.6);
    paintR(ctx, GC.brass, -8, 0, 2.6, st, 0.7, 0.6);
  }

  function gideonBasket(ctx, J, st) {
    frame(ctx, st, J.hN.x, J.hN.y, J.w);
    sprite(ctx, st, 'gideon:basket', 20, 20, 10, 13, gideonBasketArt);
    unframe(ctx, st);
  }
  function gideonBasketArt(ctx, st) {
    ctx.beginPath();
    ctx.moveTo(4.4, -3.2);
    ctx.quadraticCurveTo(1, -10.5, -7.5, -4.2);
    ctx.lineTo(-7.2, -2.2);
    ctx.quadraticCurveTo(-0.5, -6.8, 3.4, -1);
    ctx.closePath();
    paint(ctx, GC.brass, -1, -5, 6, st, 0.7, 0.8);
    capsule(ctx, 4.6, -4.2, 4.6, 4.4, 1.5, 1.3);
    paint(ctx, GC.brass, 4.6, 0, 3, st, 0.6, 0.6);
  }

  function gideonCoat(ctx, J, st) {
    const t = st.t;
    const sway = Math.sin(t * 0.0021 + st.seed);
    const cape = J.cape;
    const nx = Math.cos(J.lean), ny = Math.sin(J.lean);
    const hx = J.hip.x, hy = J.hip.y;
    const wbx = hx - nx * 13, wby = hy - ny * 13 - 4;
    const wfx = hx + nx * 12, wfy = hy + ny * 12 - 4;
    const kmin = Math.min(J.kN.x, J.kF.x), kmax = Math.max(J.kN.x, J.kF.x);
    const hemY = Math.max(J.kN.y, J.kF.y) + 9;
    const backX = kmin - 11 - cape * 20 - sway * 1.6;
    const midX = (kmin + kmax) / 2;
    const frontX = kmax + 8;
    // back panel
    ctx.beginPath();
    ctx.moveTo(wbx, wby);
    ctx.quadraticCurveTo(backX + 2, lerp(wby, hemY, 0.55), backX, hemY - 2 - cape * 8);
    ctx.quadraticCurveTo(lerp(backX, midX, 0.5), hemY + 3, midX - 1, hemY);
    ctx.lineTo(hx, hy + 14);
    ctx.closePath();
    paint(ctx, shade(GC.navy, -0.12), hx - 8, hy + 14, 26, st, 1, 0.5);
    curve(ctx, hx - 6, hy + 4, backX + 8, lerp(wby, hemY, 0.6), backX + 7, hemY - 3);
    stroke(ctx, GC.navyD, 1.6, 0.6);
    // front panel
    ctx.beginPath();
    ctx.moveTo(hx - 2, hy + 10);
    ctx.lineTo(midX + 1, hemY + 1);
    ctx.quadraticCurveTo(lerp(midX, frontX, 0.5), hemY + 3, frontX, hemY - 1);
    ctx.quadraticCurveTo(frontX + 2, lerp(wfy, hemY, 0.4), wfx, wfy);
    ctx.closePath();
    paint(ctx, GC.navy, lerp(midX, frontX, 0.5), lerp(hy, hemY, 0.5), 22, st, 1, 0.8);
    // gold hem trim
    curve(ctx, midX + 1, hemY + 1, lerp(midX, frontX, 0.5), hemY + 3, frontX, hemY - 1);
    stroke(ctx, GC.gold, 1.3, 0.8);
    curve(ctx, frontX, hemY - 1, frontX + 2, lerp(wfy, hemY, 0.4), wfx, wfy);
    stroke(ctx, GC.gold, 1.1, 0.7);
  }

  function gideonTorso(ctx, J, st, T) {
    torsoFrame(ctx, J, st);
    // coat body
    blob(ctx, [-12.5, 3, -14, -16, -13.5, -36, -10, -T + 1, -4, -T - 1, 7, -T, 14, -T + 7, 17, -32, 14.5, -14, 12.5, 3]);
    paint(ctx, GC.navy, 2, -T * 0.5, 22, st, 1, 0.85);
    // lapels
    ctx.beginPath();
    ctx.moveTo(4, -T + 1);
    ctx.lineTo(13, -T + 8);
    ctx.lineTo(10.5, -24);
    ctx.lineTo(7, -30);
    ctx.closePath();
    paint(ctx, GC.lapel, 9, -36, 8, st, 0.5, 0.5);
    line(ctx, 13, -T + 8, 10.5, -24);
    stroke(ctx, GC.gold, 1, 0.8);
    // buttons (double breasted)
    for (let i = 0; i < 3; i++) {
      for (const bx of [6.5, 12.5]) {
        const by = -34 + i * 9;
        circ(ctx, bx, by, 1.9);
        paintR(ctx, GC.brass, bx, by, 1.9, st, 0.5, 0.5, -0.4, 0.5);
      }
    }
    // chest fold
    curve(ctx, -8, -38, -2, -26, -6, -12);
    stroke(ctx, GC.navyD, 1.4, 0.5);
    // belt
    ctx.beginPath();
    ctx.moveTo(-13.2, -2); ctx.lineTo(13.4, -2); ctx.lineTo(13, 3.6); ctx.lineTo(-12.8, 3.6); ctx.closePath();
    paint(ctx, GC.belt, 0, 0, 12, st, 0.6, 0.4);
    ctx.beginPath(); ctx.rect(8.5, -2.8, 5.2, 7.2);
    paint(ctx, GC.brass, 11, 0.8, 4, st, 0.6, 0.6);
    // collar
    ctx.beginPath();
    ctx.moveTo(-7, -T - 1);
    ctx.quadraticCurveTo(-7, -T - 9, -2, -T - 10);
    ctx.lineTo(7, -T - 6.5);
    ctx.quadraticCurveTo(9.5, -T - 2, 7.5, -T + 1.5);
    ctx.closePath();
    paint(ctx, GC.navyD, 0, -T - 4, 8, st, 0.8, 0.6);
    curve(ctx, -2, -T - 10, 5, -T - 8, 7, -T - 6.5);
    stroke(ctx, GC.gold, 1.1, 0.9);
    unframe(ctx, st);
  }

  function gideonHead(ctx, J, st) {
    limb(ctx, J.neck.x, J.neck.y + 2, J.head.x - 1, J.head.y + 4, 5.5, 5.5, GC.skinD, st, 0.8, 0.3);
    frame(ctx, st, J.head.x, J.head.y, J.headA);
    sprite(ctx, st, 'gideon:head', 42, 50, 17, 26, gideonHeadArt);
    unframe(ctx, st);
  }
  function gideonHeadArt(ctx, st) {
    // hair back
    ell(ctx, -3.5, -1.5, 10.5, 11);
    paintR(ctx, GC.hair, -3.5, -1.5, 11, st, 1, 0.4);
    // face
    ell(ctx, 1, 0.5, 11.2, 12.4);
    paintR(ctx, GC.skin, 1, 0.5, 12, st, 1, 0.9);
    // ear
    ell(ctx, -3.8, 1, 2.6, 3.6);
    paintR(ctx, GC.skinD, -3.8, 1, 3.6, st, 0.6, 0.3);
    // nose
    poly(ctx, [8.8, -4.5, 14.4, 2.6, 13.6, 4.3, 9.4, 4.6]);
    paint(ctx, GC.skin, 11, 1, 5, st, 0.6, 0.9);
    // beard
    ctx.beginPath();
    ctx.moveTo(-5.2, 0.5);
    ctx.quadraticCurveTo(-6.4, 10, 0, 15.5);
    ctx.quadraticCurveTo(6, 19.5, 11.2, 14.2);
    ctx.quadraticCurveTo(14.4, 10.8, 13.8, 6.6);
    ctx.lineTo(10, 6.8);
    ctx.quadraticCurveTo(6.5, 4.4, 2.6, 5.4);
    ctx.quadraticCurveTo(-1.4, 4.2, -2.8, -2.6);
    ctx.closePath();
    paint(ctx, GC.beard, 4, 9, 10, st, 1, 0.8);
    for (let i = 0; i < 4; i++) {
      curve(ctx, 1 + i * 2.6, 8 + i * 0.6, 2 + i * 2.7, 12 + i * 0.4, 1.5 + i * 2.8, 15.5 - i * 0.6);
      stroke(ctx, shade(GC.beard, -0.25), 0.7, 0.55);
    }
    // mustache
    curve(ctx, 8.4, 5.6, 12, 4.8, 14.6, 7.8);
    stroke(ctx, shade(GC.beard, 0.1), 2.2);
    // eye + brow + crow's feet
    ell(ctx, 6.8, -2.2, 1.75, 1.25, -0.1);
    fill(ctx, '#1d1310');
    circ(ctx, 7.3, -2.6, 0.45);
    fill(ctx, '#ffffff', 0.8);
    curve(ctx, 3.4, -5.8, 7, -7.4, 10.4, -5.2);
    stroke(ctx, '#8f8880', 2);
    line(ctx, 3.2, -1.6, 1.6, -0.8);
    stroke(ctx, GC.skinD, 0.6, 0.7);
    // cap crown
    ctx.beginPath();
    ctx.moveTo(-11.4, -5);
    ctx.quadraticCurveTo(-13.4, -14.5, -6, -18.6);
    ctx.quadraticCurveTo(3.5, -22.6, 11.6, -15.4);
    ctx.lineTo(12.8, -8.2);
    ctx.quadraticCurveTo(1, -10, -11.4, -5);
    ctx.closePath();
    paint(ctx, GC.navy, 0, -13, 12, st, 1, 0.9);
    // band
    ctx.beginPath();
    ctx.moveTo(-11.6, -4.8);
    ctx.quadraticCurveTo(1, -10, 12.9, -8);
    ctx.lineTo(12.4, -11.4);
    ctx.quadraticCurveTo(1, -13.4, -11.9, -8.6);
    ctx.closePath();
    paint(ctx, GC.navyD, 0, -9, 10, st, 0.6, 0.4);
    curve(ctx, -11.9, -8.6, 1, -13.4, 12.4, -11.4);
    stroke(ctx, GC.gold, 1.1, 0.9);
    // visor
    ctx.beginPath();
    ctx.moveTo(8.6, -8.8);
    ctx.quadraticCurveTo(16.5, -9.6, 20.6, -5.4);
    ctx.quadraticCurveTo(15.5, -5.8, 9.2, -6.2);
    ctx.closePath();
    paint(ctx, GC.visor, 14, -7, 6, st, 0.6, 0.9);
    // badge
    circ(ctx, 8.6, -13.2, 2.5);
    paintR(ctx, GC.brass, 8.6, -13.2, 2.5, st, 0.5, 0.6, -0.4, 0.5);
    line(ctx, 8.6, -14.6, 8.6, -11.8);
    stroke(ctx, GC.brassD, 0.7);
    curve(ctx, 7.3, -12.6, 8.6, -11.2, 9.9, -12.6);
    stroke(ctx, GC.brassD, 0.7);
  }

  const gideon = K.humanoid({
    id: 'gideon', name: 'Gideon Marchal', kind: 'party', height: 155, topExtra: 9,
    body: { thigh: 35, shin: 34, upper: 25, fore: 24, torso: 50, neck: 8, headR: 13, shDrop: 6, shN: -5, shF: 7, hipN: -3, hipF: 3, wlen: 72, wtail: 10, grip: 14, bw: 25 },
    shootHand: 'far', twoHand: 0, armSwing: 0.3, magic: '#9fdcff', trailColor: '#e4f6ff',
    book: {
      ready: { nhx: 0.3, nhy: 0.72, w: -22 * D, fhx: 0.62, fhy: 0.04, lean: 0.05, ry: 0.07, nfx: -0.25, ffx: 0.29 },
      carry: { nhx: 0.12, nhy: 0.74, w: 150 * D, fhx: 0.4, fhy: 0.45 },
      victory: { nhx: 0.22, nhy: 0.32, w: -128 * D, fhx: 0.3, fhy: -0.95, lean: -0.06, hd: -0.18, ry: 0.02, nfx: -0.24, ffx: 0.24 },
      guard: { fhx: 0.62, fhy: -0.05, nhx: 0.35, nhy: 0.35, w: -95 * D },
      variants: {
        heavy: {
          a: { fhx: 0.1, fhy: -0.95, nhx: -0.2, nhy: -0.7, w: -150 * D },
          c: { fhx: 0.95, fhy: 0.35, nhx: 0.1, nhy: 0.6, w: -120 * D, two: 0 },
          f: { fhx: 0.85, fhy: 0.55, nhx: 0.1, nhy: 0.65, w: -125 * D },
        },
        shoot: { shoot: true, a: {}, c: {} },
      },
    },
    castPoint(J, o) { o.x = J.hF.x; o.y = J.hF.y; },
    weak: [],
    portrait: { x: 2, y: 5, r: 26, bg: ['#4f6f9a', '#141c2c'] },
    draw(ctx, J, st) {
      const surge = mech(st, 'surge');
      const s01 = surge ? clamp(surge.value / 10, 0, 1) : 0;
      const T = st.look.body.torso;
      // far arm (sleeve + gauntlet)
      limb(ctx, J.sF.x, J.sF.y, J.eF.x, J.eF.y, 7.4, 6.6, shade(GC.navy, -0.2), st);
      gideonGauntlet(ctx, J, st, s01);
      leg(ctx, J, st, true, GC);
      leg(ctx, J, st, false, GC);
      gideonCoat(ctx, J, st);
      gideonTorso(ctx, J, st, T);
      gideonHead(ctx, J, st);
      // near arm + saber
      arm(ctx, J.sN, J.eN, J.hN, st, GC.navy, 7.6, 6.6, 5.6);
      along(tmp, J.eN.x, J.eN.y, J.hN.x, J.hN.y, 0.66);
      along(tmp2, J.eN.x, J.eN.y, J.hN.x, J.hN.y, 0.9);
      limb(ctx, tmp.x, tmp.y, tmp2.x, tmp2.y, 6.4, 6.2, GC.navyD, st, 0.7, 0.4);
      line(ctx, tmp.x, tmp.y, tmp2.x, tmp2.y);
      // epaulette
      frame(ctx, st, J.sN.x, J.sN.y - 1, J.lean * 0.6);
      ell(ctx, 0, 0, 9, 4.2);
      paint(ctx, GC.gold, 0, -1, 8, st, 0.8, 0.9);
      for (let i = 0; i < 6; i++) { line(ctx, -7 + i * 2.8, 3, -7.4 + i * 2.8, 7.4); stroke(ctx, shade(GC.gold, -0.15), 1.3); }
      unframe(ctx, st);
      gideonSaber(ctx, J, st);
      hand(ctx, J.hN.x, J.hN.y, 5, GC.glove, st);
      gideonBasket(ctx, J, st);
    },
  });

  // ================================================================== NYRA
  const NC = {
    robe: '#efe6d3', robeD: '#cdbfa6', gold: '#d9ae55', sash: '#2e6e72', skin: '#a8714f', skinD: '#7f5038', hair: '#2a1b17',
    lips: '#7c3b36', tome: '#6c2e2a', page: '#f6ecd2', wood: '#5a3a26', feather: '#fbf6ea', ink: '#fff1b8',
    trouser: '#e2d7c1', boot: '#e2d7c1', shoe: '#c49a45', thighR: 7, kneeR: 5.5, ankleR: 4.2, footLen: 12,
  };
  const GLYPH_COL = { fire: '#ff8a4a', ice: '#a8e2ff', storm: '#f4e36a', earth: '#d0a060', light: '#fff4c8' };

  function nyraSleeve(ctx, s, e, h, st, far) {
    const c = far ? shade(NC.robe, -0.18) : NC.robe;
    limb(ctx, s.x, s.y, e.x, e.y, 5.4, 4.8, c, st);
    const dx = h.x - e.x, dy = h.y - e.y, d = Math.hypot(dx, dy) || 1;
    const ux = dx / d, uy = dy / d;
    let nx = -uy, ny = ux;
    if (ny < 0) { nx = -nx; ny = -ny; }
    const wx = h.x - ux * 3.5, wy = h.y - uy * 3.5;
    const droop = 3 + 5 * Math.abs(ux);
    const mx = lerp(e.x, wx, 0.55), my = lerp(e.y, wy, 0.55);
    const cx1 = wx + ux * 2 + nx * 2.5, cy1 = wy + uy * 2 + ny * 2.5;
    const bx = wx + nx * 9 + ux, by = wy + ny * 9 + droop;
    hand(ctx, h.x, h.y, 3.8, far ? shade(NC.skin, -0.15) : NC.skin, st, 0.8);
    ctx.beginPath();
    ctx.moveTo(e.x - nx * 4.6, e.y - ny * 4.6);
    ctx.quadraticCurveTo(mx - nx * 5.2, my - ny * 5.2, wx - nx * 6, wy - ny * 6);
    ctx.quadraticCurveTo(cx1, cy1, bx, by);
    ctx.quadraticCurveTo(mx + nx * 8, my + ny * 8 + droop * 0.5, e.x + nx * 4.8, e.y + ny * 4.8);
    ctx.closePath();
    paint(ctx, c, mx, my, 9, st, 1, 0.7);
    curve(ctx, wx - nx * 6, wy - ny * 6, cx1, cy1, bx, by);
    stroke(ctx, NC.gold, 1.7, far ? 0.6 : 0.95);
    curve(ctx, e.x + nx * 3, e.y + ny * 3, mx + nx * 5, my + ny * 5 + droop * 0.3, bx - ux * 3 - nx * 2, by - 2);
    stroke(ctx, NC.robeD, 0.9, 0.6);
  }

  function nyraBraid(ctx, J, st) {
    const t = st.t;
    const ca = Math.cos(J.headA), sa = Math.sin(J.headA);
    let x = J.head.x + (-8.5 * ca - 4 * sa), y = J.head.y + (-8.5 * sa + 4 * ca);
    const sway = Math.sin(t * 0.0024 + st.seed + 0.6);
    for (let i = 0; i < 7; i++) {
      const u = i / 6;
      const nx = x - 1.4 - J.cape * 3.2 + sway * 0.9 * u - J.lean * 3;
      const ny = y + 6.4;
      const rr = 4.3 - u * 1.3;
      ell(ctx, (x + nx) / 2 + (i % 2 ? 0.8 : -0.8), (y + ny) / 2, rr, 3.7, i % 2 ? 0.5 : -0.5);
      paintR(ctx, NC.hair, (x + nx) / 2, (y + ny) / 2, rr, st, 0.8, 0.5);
      x = nx; y = ny;
    }
    ell(ctx, x, y + 1, 2.8, 1.8, 0.3);
    paint(ctx, NC.gold, x, y + 1, 3, st, 0.6, 0.6);
    curve(ctx, x, y + 2, x - 2 + sway, y + 6, x - 1 + sway * 1.5, y + 9);
    stroke(ctx, NC.hair, 2.4);
  }

  function nyraSkirt(ctx, J, st) {
    const t = st.t;
    const sway = Math.sin(t * 0.0019 + st.seed);
    const nx = Math.cos(J.lean), ny = Math.sin(J.lean);
    const hx = J.hip.x, hy = J.hip.y;
    const fmin = Math.min(J.fN.x, J.fF.x, J.kN.x - 4, J.kF.x - 4), fmax = Math.max(J.fN.x, J.fF.x, J.kN.x, J.kF.x);
    const hemY = Math.max(J.fN.y, J.fF.y) - 1;
    const backX = fmin - 12 - J.cape * 16 - sway * 2;
    const frontX = fmax + 8 + sway * 0.8;
    const wbx = hx - nx * 11, wby = hy - ny * 11 - 6;
    const wfx = hx + nx * 10, wfy = hy + ny * 10 - 6;
    ctx.beginPath();
    ctx.moveTo(wbx, wby);
    ctx.quadraticCurveTo(backX + 3, lerp(wby, hemY, 0.5), backX, hemY - J.cape * 6);
    ctx.quadraticCurveTo(lerp(backX, frontX, 0.5), hemY + 4, frontX, hemY);
    ctx.quadraticCurveTo(frontX - 1, lerp(wfy, hemY, 0.45), wfx, wfy);
    ctx.closePath();
    paint(ctx, NC.robe, lerp(backX, frontX, 0.55), lerp(hy, hemY, 0.5), 30, st, 1, 0.85);
    // folds
    for (let i = 0; i < 3; i++) {
      const u = 0.25 + i * 0.25;
      curve(ctx, lerp(wbx, wfx, u), hy, lerp(backX, frontX, u) + sway * 2, lerp(hy, hemY, 0.6), lerp(backX, frontX, u) - 1, hemY + 1);
      stroke(ctx, NC.robeD, 1.4, 0.55);
    }
    // gold hem + front panel trim
    curve(ctx, backX, hemY - J.cape * 6, lerp(backX, frontX, 0.5), hemY + 4, frontX, hemY);
    stroke(ctx, NC.gold, 2.4, 0.95);
    curve(ctx, wfx - 3, wfy + 2, frontX - 4, lerp(wfy, hemY, 0.5), frontX - 5, hemY + 1);
    stroke(ctx, NC.gold, 1.4, 0.8);
  }

  function nyraTorso(ctx, J, st, T) {
    torsoFrame(ctx, J, st);
    blob(ctx, [-10, 2, -11, -18, -10.5, -34, -7.5, -T + 2, -3, -T - 1, 5, -T, 11, -T + 8, 12.5, -28, 9.5, -12, 10, 2]);
    paint(ctx, NC.robe, 1, -T * 0.5, 18, st, 1, 0.9);
    // neckline
    ctx.beginPath();
    ctx.moveTo(2, -T); ctx.lineTo(8.5, -T + 2); ctx.lineTo(7, -T + 7); ctx.closePath();
    paint(ctx, NC.skin, 6, -T + 3, 4, st, 0, 0.5);
    curve(ctx, 2, -T, 5, -T + 5, 7, -T + 7); stroke(ctx, NC.gold, 1.3);
    line(ctx, 8.5, -T + 2, 7, -T + 7); stroke(ctx, NC.gold, 1.3);
    // gold filigree
    curve(ctx, 3, -T + 15, 10, -24, 6, -14);
    stroke(ctx, NC.gold, 1, 0.75);
    // sash
    ctx.beginPath();
    ctx.moveTo(-11, -3); ctx.lineTo(10.5, -5); ctx.lineTo(10.2, 3); ctx.lineTo(-10.6, 4); ctx.closePath();
    paint(ctx, NC.sash, 0, 0, 10, st, 0.7, 0.6);
    line(ctx, -11, -3, 10.5, -5); stroke(ctx, NC.gold, 1);
    line(ctx, -10.6, 4, 10.2, 3); stroke(ctx, NC.gold, 1);
    unframe(ctx, st);
    // sash tails (world space, gravity)
    const sway = Math.sin(st.t * 0.0026 + st.seed);
    const nx = Math.cos(J.lean), ny = Math.sin(J.lean);
    const bx = J.hip.x - nx * 10, by = J.hip.y - ny * 10;
    ctx.beginPath();
    ctx.moveTo(bx, by - 2);
    ctx.quadraticCurveTo(bx - 6 - J.cape * 6, by + 10, bx - 5 - J.cape * 12 + sway * 2, by + 24);
    ctx.lineTo(bx - 1 - J.cape * 10 + sway * 2, by + 23);
    ctx.quadraticCurveTo(bx - 1, by + 10, bx + 2, by + 1);
    ctx.closePath();
    paint(ctx, NC.sash, bx - 3, by + 12, 8, st, 0.8, 0.5);
  }

  function nyraHead(ctx, J, st) {
    limb(ctx, J.neck.x, J.neck.y + 2, J.head.x, J.head.y + 4, 4.4, 4.2, NC.skinD, st, 0.8, 0.3);
    frame(ctx, st, J.head.x, J.head.y, J.headA);
    sprite(ctx, st, 'nyra:head', 32, 33, 16, 17, nyraHeadArt);
    unframe(ctx, st);
  }
  function nyraHeadArt(ctx, st) {
    ell(ctx, -3, -1.5, 10.4, 11.4);
    paintR(ctx, NC.hair, -3, -1.5, 11, st, 1, 0.5);
    ell(ctx, 1.2, 0.8, 9.8, 11.2);
    paintR(ctx, NC.skin, 1.2, 0.8, 11, st, 1, 0.9);
    // nose, lips, chin
    poly(ctx, [8.6, -2.4, 11.8, 2.6, 9.6, 3.4]);
    paint(ctx, NC.skin, 10, 1, 3, st, 0.4, 0.8);
    curve(ctx, 8.4, 6.2, 9.8, 6.6, 10.6, 5.8);
    stroke(ctx, NC.lips, 1.6);
    // eye
    ell(ctx, 6.4, -1.4, 1.8, 1.15, -0.05);
    fill(ctx, '#1a0f0c');
    circ(ctx, 6.9, -1.8, 0.45); fill(ctx, '#ffffff', 0.8);
    curve(ctx, 4.2, -2.6, 6.4, -3.4, 8.6, -2.2); stroke(ctx, '#1a0f0c', 0.9);
    curve(ctx, 3.8, -5.4, 6.6, -6.6, 9.4, -5); stroke(ctx, NC.hair, 1.2);
    // hair front sweep
    ctx.beginPath();
    ctx.moveTo(-11, -2);
    ctx.quadraticCurveTo(-11, -13, -1, -13.2);
    ctx.quadraticCurveTo(8, -13, 10.4, -6);
    ctx.quadraticCurveTo(6, -9.5, 1.5, -7.5);
    ctx.quadraticCurveTo(-3, -5, -4.5, 2);
    ctx.closePath();
    paint(ctx, NC.hair, -2, -8, 10, st, 1, 0.7);
    curve(ctx, -8, -8, -2, -12, 6, -10); stroke(ctx, shade(NC.hair, 0.3), 0.8, 0.6);
    // circlet
    curve(ctx, -10.6, -4.5, 0, -10.8, 9.6, -7.2); stroke(ctx, NC.gold, 1.5);
    ell(ctx, 8.8, -7.4, 1.8, 2.2, 0.3);
    paintR(ctx, '#3fb3a8', 8.8, -7.4, 2.2, st, 0.5, 0.8, -0.4, 0.6);
    // ear stud
    circ(ctx, -3.2, 2.8, 1); fill(ctx, NC.gold);
  }

  function nyraTome(ctx, J, st) {
    const t = st.t;
    const bob = Math.sin(t * 0.0031 + st.seed) * 2.2;
    const A = st.look.body.A;
    const reach = clamp(((J.hF.x - J.neck.x) / A - 0.35) / 0.35, 0, 1);
    const hx = J.neck.x - 30 - J.lean * 10, hy = J.neck.y - 24;
    const fx = J.hF.x + 5 + J.ch * 4, fy = J.hF.y - 15 - J.ch * 6;
    const x = lerp(hx, fx, reach), y = lerp(hy, fy, reach) + bob;
    const tilt = -0.18 + Math.sin(t * 0.0017 + st.seed) * 0.06;
    frame(ctx, st, x, y, tilt);
    // cover
    poly(ctx, [-14, 2, 14, 2, 15, 5.5, -15, 5.5]);
    paint(ctx, NC.tome, 0, 4, 12, st, 0.8, 0.5);
    // pages (open, V shape)
    poly(ctx, [-13, 2.5, -1, 4.5, -0.6, -2.5, -12, -5.5]);
    paint(ctx, NC.page, -6, -1, 8, st, 0.6, 0.6);
    poly(ctx, [13, 2.5, 1, 4.5, 0.6, -2.5, 12, -5.5]);
    paint(ctx, shade(NC.page, 0.05), 6, -1, 8, st, 0.6, 0.8);
    // flipping page
    const ph = (t / 2600 + st.seed * 0.1) % 1;
    if (ph < 0.22) {
      const u = ph / 0.22;
      const sx = Math.cos(u * Math.PI);
      poly(ctx, [0, 4.5, 12 * sx, 2.5 - Math.sin(u * Math.PI) * 5, 12 * sx, -5.5 - Math.sin(u * Math.PI) * 5, 0, -2.5]);
      paint(ctx, shade(NC.page, -0.08), 6 * sx, -1, 7, st, 0.5, 0.4);
    }
    // runes
    for (let i = 0; i < 3; i++) {
      line(ctx, -10 + i * 0.5, -2.6 + i * 2.2, -3 + i * 0.3, -1 + i * 2.1); stroke(ctx, NC.gold, 0.7, 0.8);
      line(ctx, 3 + i * 0.3, -1 + i * 2.1, 10 - i * 0.5, -2.6 + i * 2.2); stroke(ctx, NC.gold, 0.7, 0.8);
    }
    // corner caps
    for (const cx of [-14, 14]) { circ(ctx, cx, 4, 1.6); fill(ctx, NC.gold); }
    unframe(ctx, st);
    if (!st.ghost) {
      glow(ctx, x, y - 4, 16 + J.ch * 16, NC.ink, 0.25 + J.ch * 0.4 + Math.sin(t * 0.004) * 0.05);
      K.motes(ctx, x, y - 2, 18, 22, 3, t, NC.ink, 1.6, 0.8, st.seed);
    }
  }

  function nyraStaff(ctx, J, st) {
    const b = st.look.body;
    const wl = b.wlen, tail = b.wtail;
    const t = st.t;
    frame(ctx, st, J.hN.x, J.hN.y, J.w);
    sprite(ctx, st, 'nyra:staff', wl + tail + 18, 14, tail + 7, 7, nyraShaftArt);
    // feather sweeping back from the head
    const sw = Math.sin(t * 0.0023 + st.seed) * 0.08 + J.cape * 0.1;
    frame(ctx, st, wl - 12, 0, Math.PI - 0.5 + sw);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(14, -10, 34, -6);
    ctx.quadraticCurveTo(22, 2, 0, 3);
    ctx.closePath();
    paint(ctx, NC.feather, 16, -2, 12, st, 0.8, 0.9);
    curve(ctx, 0, 1, 16, -3, 33, -5.5); stroke(ctx, NC.gold, 1.1);
    for (let i = 1; i < 6; i++) { line(ctx, i * 5.5, -1.5 + i * -0.4, i * 5.5 + 3, -7 + i * 0.1); stroke(ctx, NC.robeD, 0.6, 0.7); }
    unframe(ctx, st);
    unframe(ctx, st);
    if (!st.ghost) {
      const tx = J.hN.x + Math.cos(J.w) * (wl + 8), ty = J.hN.y + Math.sin(J.w) * (wl + 8);
      glow(ctx, tx, ty, 7 + Math.sin(t * 0.006) * 1.5, NC.ink, 0.7);
    }
  }
  function nyraShaftArt(ctx, st) {
    const b = st.look.body;
    const wl = b.wlen, tail = b.wtail;
    // shaft
    capsule(ctx, -tail, 0, wl - 10, 0, 2.2, 2.4);
    paintAxis(ctx, NC.wood, -tail, 0, wl - 10, 0, 2.4, st, 0.9, 0.6);
    for (const u of [-tail + 3, -12, 18, wl - 14]) {
      ctx.beginPath(); ctx.rect(u - 1.8, -3, 3.6, 6);
      paintAxis(ctx, NC.gold, u - 2, 0, u + 2, 0, 3, st, 0.5, 0.6);
    }
    // ferrule
    poly(ctx, [-tail - 5, 0, -tail + 1, -2.6, -tail + 1, 2.6]);
    paint(ctx, NC.gold, -tail, 0, 3, st, 0.6, 0.6);
    // gold nib head
    ctx.beginPath();
    ctx.moveTo(wl - 14, -4.2);
    ctx.quadraticCurveTo(wl - 3, -4.8, wl + 8, 0);
    ctx.quadraticCurveTo(wl - 3, 4.8, wl - 14, 4.2);
    ctx.closePath();
    paintAxis(ctx, NC.gold, wl - 14, 0, wl + 8, 0, 4.4, st, 0.9, 0.9, -0.35, 0.45);
    line(ctx, wl - 4, 0, wl + 7, 0); stroke(ctx, '#6a4a1a', 0.8);
    circ(ctx, wl - 5, 0, 1.3); fill(ctx, '#6a4a1a');
  }

  function glyphSymbol(ctx, g, x, y, r, a, st) {
    const c = GLYPH_COL[g] || '#ffffff';
    glow(ctx, x, y, r * 2.6, c, 0.55 * a);
    ctx.save();
    ctx.globalAlpha *= a;
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = c;
    ctx.beginPath();
    if (g === 'fire') {
      ctx.moveTo(x, y + r);
      ctx.quadraticCurveTo(x - r * 1.05, y + r * 0.5, x - r * 0.2, y - r * 0.35);
      ctx.quadraticCurveTo(x + r * 0.05, y - r * 0.8, x - r * 0.1, y - r * 1.15);
      ctx.quadraticCurveTo(x + r * 1.1, y - r * 0.2, x + r * 0.6, y + r * 0.55);
      ctx.quadraticCurveTo(x + r * 0.35, y + r, x, y + r);
      ctx.moveTo(x, y + r * 0.6);
      ctx.quadraticCurveTo(x - r * 0.35, y + r * 0.2, x + r * 0.05, y - r * 0.25);
    }
    else if (g === 'ice') { for (let i = 0; i < 3; i++) { const a2 = (i * Math.PI) / 3; ctx.moveTo(x - Math.cos(a2) * r, y - Math.sin(a2) * r); ctx.lineTo(x + Math.cos(a2) * r, y + Math.sin(a2) * r); } }
    else if (g === 'storm') { ctx.moveTo(x - r * 0.5, y - r); ctx.lineTo(x + r * 0.2, y - r * 0.1); ctx.lineTo(x - r * 0.25, y + r * 0.1); ctx.lineTo(x + r * 0.5, y + r); }
    else if (g === 'earth') { ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath(); ctx.moveTo(x - r * 0.5, y); ctx.lineTo(x + r * 0.5, y); }
    else { ctx.arc(x, y, r * 0.55, 0, TAU); for (let i = 0; i < 4; i++) { const a2 = (i * Math.PI) / 2 + Math.PI / 4; ctx.moveTo(x + Math.cos(a2) * r * 0.75, y + Math.sin(a2) * r * 0.75); ctx.lineTo(x + Math.cos(a2) * r * 1.15, y + Math.sin(a2) * r * 1.15); } }
    ctx.stroke();
    ctx.restore();
  }

  function nyraGlyphs(ctx, J, st, front) {
    const m = mech(st, 'glyphs');
    if (!m || !Array.isArray(m.list) || !m.list.length || st.ghost) return;
    const n = Math.min(4, m.list.length);
    const cx = lerp(J.hip.x, J.neck.x, 0.7), cy = lerp(J.hip.y, J.neck.y, 0.7) - 4;
    for (let i = 0; i < n; i++) {
      const a = st.t * 0.0014 + (i * TAU) / n;
      const s = Math.sin(a);
      if ((s >= 0) !== front) continue;
      const x = cx + Math.cos(a) * 38, y = cy + s * 12 - 8;
      glyphSymbol(ctx, m.list[i], x, y, 5 + s * 1.2, front ? 1 : 0.55, st);
    }
  }

  const nyra = K.humanoid({
    id: 'nyra', name: 'Nyra Solace', kind: 'party', height: 148, topExtra: 2,
    body: { thigh: 34, shin: 34, upper: 23, fore: 22, torso: 45, neck: 8, headR: 11.8, shDrop: 5, shN: -4, shF: 4, hipN: -2, hipF: 2, wlen: 70, wreach: 80, wtail: 56, grip: 16, bw: 20 },
    shootHand: 'near', twoHand: 0.6, armSwing: 0.2, magic: '#fff1b8', trailColor: '#fff3c8', weaponFocus: 1.05,
    book: {
      ready: { nhx: 0.42, nhy: 0.56, w: -70 * D, fhx: 0.28, fhy: 0.55, lean: 0.02, ry: 0.03, nfx: -0.12, ffx: 0.17 },
      carry: { nhx: 0.3, nhy: 0.55, w: -70 * D, fhx: 0.3, fhy: 0.45 },
      victory: { nhx: 0.22, nhy: -0.85, w: -84 * D, fhx: 0.7, fhy: -0.1, lean: -0.08, hd: -0.2, ry: 0.0 },
      guard: { nhx: 0.5, nhy: 0.25, w: -100 * D, fhx: 0.6, fhy: 0.05 },
      parry: { nhx: 0.62, nhy: 0.05, w: -105 * D, fhx: 0.55, fhy: 0.15 },
      aimNear: { nhx: 0.95, nhy: -0.05, w: -4 * D, fhx: 0.3, fhy: 0.35 },
      hurt: { w: -118 * D, nhx: 0.05, nhy: 0.45 },
      dodge: { w: -120 * D, nhx: 0.05, nhy: 0.5 },
      ko: { a: { w: -100 * D, nhx: 0.45, nhy: 0.45 }, b: { w: -94 * D, nhx: 0.52, nhy: 0.3, fhx: 0.45, fhy: 0.85 } },
      jump: { up: { w: -80 * D }, tuck: { w: -60 * D } },
      variants: {
        slash: {
          a: { nhx: -0.2, nhy: -0.6, w: -140 * D },
          c: { nhx: 0.85, nhy: 0.25, w: 20 * D },
          f: { nhx: 0.5, nhy: 0.7, w: 70 * D },
        },
      },
    },
    castPoint(J, o) { const wl = 78; o.x = J.hN.x + Math.cos(J.w) * wl; o.y = J.hN.y + Math.sin(J.w) * wl; },
    trailPts(J, o) { o[0] = J.hN.x + Math.cos(J.w) * 78; o[1] = J.hN.y + Math.sin(J.w) * 78; o[2] = J.hN.x + Math.cos(J.w) * 40; o[3] = J.hN.y + Math.sin(J.w) * 40; },
    weak: [],
    portrait: { x: 1, y: 4, r: 24, bg: ['#c9a45a', '#2a1f18'] },
    draw(ctx, J, st) {
      const T = st.look.body.torso;
      nyraGlyphs(ctx, J, st, false);
      nyraBraid(ctx, J, st);
      nyraSleeve(ctx, J.sF, J.eF, J.hF, st, true);
      leg(ctx, J, st, true, NC);
      leg(ctx, J, st, false, NC);
      nyraSkirt(ctx, J, st);
      nyraTorso(ctx, J, st, T);
      nyraHead(ctx, J, st);
      nyraTome(ctx, J, st);
      nyraStaff(ctx, J, st);
      nyraSleeve(ctx, J.sN, J.eN, J.hN, st, false);
      nyraGlyphs(ctx, J, st, true);
    },
  });

  // ================================================================== SABLE
  const SC = {
    coat: '#b3342c', coatD: '#6f1d1a', gold: '#e3b75a', shirt: '#f4ede1', trouser: '#221d25', boot: '#171315', cuff: '#5a3a28',
    skin: '#e9c6a4', skinD: '#c49474', hair: '#2b1b16', hat: '#1d1818', band: '#8e2a24', steel: '#e7ecf2', glove: '#2a1d1a',
    thighR: 7.4, kneeR: 5.8, ankleR: 4.8, footLen: 14, cuffLen: 7,
  };
  const STANCE = {
    neutral: { plume: '#fbf7ef', blade: null },
    assault: { plume: '#ff7a4e', blade: '#ff5a3a' },
    guard: { plume: '#9fc8ff', blade: '#8fc4ff' },
    virtuoso: { plume: '#ffd46a', blade: '#ffd46a' },
  };

  function sableTails(ctx, J, st) {
    const sway = Math.sin(st.t * 0.0024 + st.seed);
    const nx = Math.cos(J.lean), ny = Math.sin(J.lean);
    const bx = J.hip.x - nx * 10, by = J.hip.y - ny * 10 - 6;
    const kneeY = Math.max(J.kN.y, J.kF.y);
    const len = Math.max(26, kneeY - by + 2);
    for (let i = 0; i < 2; i++) {
      const off = i * 4;
      const tx = bx - 8 - J.cape * 22 - off + sway * (1.5 + i), ty = by + len - J.cape * 12 - i * 2;
      ctx.beginPath();
      ctx.moveTo(bx + 2 - off * 0.5, by);
      ctx.quadraticCurveTo(bx - 4 - off - J.cape * 8, by + len * 0.5, tx, ty);
      ctx.lineTo(tx + 6, ty - 3);
      ctx.quadraticCurveTo(bx + 4 - off, by + len * 0.45, bx + 8 - off * 0.5, by + 2);
      ctx.closePath();
      paint(ctx, i ? SC.coatD : shade(SC.coat, -0.15), bx, by + len * 0.5, 14, st, 1, 0.5);
      line(ctx, tx, ty, tx + 6, ty - 3); stroke(ctx, SC.gold, 1.2, 0.8);
    }
  }

  function sableTorso(ctx, J, st, T, pistolHolstered) {
    torsoFrame(ctx, J, st);
    blob(ctx, [-10, 2, -11.2, -16, -11, -34, -8, -T + 2, -3, -T - 1, 5, -T, 11.5, -T + 7, 12.5, -28, 10.5, -12, 10, 2]);
    paint(ctx, SC.coat, 1, -T * 0.5, 18, st, 1, 0.9);
    // shirt front & jabot
    ctx.beginPath();
    ctx.moveTo(1, -T); ctx.lineTo(9, -T + 2); ctx.lineTo(11.8, -26); ctx.lineTo(8, -16); ctx.closePath();
    paint(ctx, SC.shirt, 8, -30, 8, st, 0.6, 0.6);
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.ellipse(10 + i * 0.6, -T + 5 + i * 4.2, 3.4, 2.4, 0.4, 0, TAU);
      paint(ctx, SC.shirt, 10, -T + 5 + i * 4, 3.5, st, 0.5, 0.8);
    }
    // lapel edge & buttons
    line(ctx, 9, -T + 2, 8, -16); stroke(ctx, SC.coatD, 1.4);
    for (let i = 0; i < 3; i++) { circ(ctx, 5.2, -24 + i * 6.5, 1.5); paintR(ctx, SC.gold, 5.2, -24 + i * 6.5, 1.5, st, 0.4, 0.4, -0.4, 0.5); }
    // back seam fold
    curve(ctx, -6, -40, -1, -26, -5, -8); stroke(ctx, SC.coatD, 1.3, 0.6);
    // belt
    ctx.beginPath(); ctx.moveTo(-10.6, -2.5); ctx.lineTo(10.4, -2.5); ctx.lineTo(10.2, 2.6); ctx.lineTo(-10.2, 2.6); ctx.closePath();
    paint(ctx, '#1a1416', 0, 0, 10, st, 0.6, 0.5);
    ctx.beginPath(); ctx.rect(6.5, -3.1, 4.4, 6.2); paint(ctx, SC.gold, 8.6, 0, 3, st, 0.5, 0.6);
    // gold trim on coat edge
    curve(ctx, -3, -T - 1, 5, -T - 2, 11.5, -T + 7); stroke(ctx, SC.gold, 1.2, 0.9);
    unframe(ctx, st);
    if (pistolHolstered) {
      // holster + pistol at the near hip
      const nx = Math.cos(J.lean), ny = Math.sin(J.lean);
      const px = J.hip.x - nx * 3, py = J.hip.y - ny * 3 + 4;
      frame(ctx, st, px, py, J.lean * 0.5 + 1.25);
      ctx.beginPath(); ctx.rect(-2, -3.5, 14, 7);
      paint(ctx, '#4a2e1e', 5, 0, 7, st, 0.8, 0.5);
      unframe(ctx, st);
      frame(ctx, st, px, py, J.lean * 0.5 - 0.5);
      sablePistolShape(ctx, st, 0.85);
      unframe(ctx, st);
    }
  }

  function sablePistolShape(ctx, st, k = 1) {
    // grip (curved) + lock + barrel, pointing along +x from the grip
    ctx.beginPath();
    ctx.moveTo(-2 * k, -2.5 * k);
    ctx.quadraticCurveTo(-7 * k, 2 * k, -6 * k, 7 * k);
    ctx.lineTo(-2.5 * k, 7.5 * k);
    ctx.quadraticCurveTo(-2 * k, 2.5 * k, 2 * k, 1.5 * k);
    ctx.closePath();
    paint(ctx, '#6a3f24', -3 * k, 2 * k, 5 * k, st, 0.7, 0.5);
    ctx.beginPath(); ctx.rect(-2 * k, -2.8 * k, 19 * k, 3.6 * k);
    paint(ctx, '#3b3f48', 7 * k, -1 * k, 6 * k, st, 0.7, 0.8);
    ctx.beginPath(); ctx.rect(-1 * k, -3.6 * k, 6 * k, 5 * k);
    paint(ctx, SC.gold, 2 * k, -1 * k, 4 * k, st, 0.5, 0.6);
    circ(ctx, 17 * k, -1 * k, 1.6 * k); fill(ctx, '#15121a');
  }

  function sableHead(ctx, J, st, plumeC) {
    const t = st.t;
    const sway = Math.sin(t * 0.0027 + st.seed);
    limb(ctx, J.neck.x, J.neck.y + 2, J.head.x, J.head.y + 4, 4.4, 4.2, SC.skinD, st, 0.8, 0.3);
    // cravat
    ell(ctx, J.neck.x + 3, J.neck.y + 1, 5.5, 3.2, 0.3);
    paint(ctx, SC.shirt, J.neck.x + 3, J.neck.y, 5, st, 0.7, 0.7);
    frame(ctx, st, J.head.x, J.head.y, J.headA);
    // ponytail
    ctx.beginPath();
    ctx.moveTo(-8, -2);
    ctx.quadraticCurveTo(-17 - J.cape * 6, 4 + sway, -18 - J.cape * 10 + sway * 2, 16 - J.cape * 4);
    ctx.quadraticCurveTo(-12, 10, -6, 5);
    ctx.closePath();
    paint(ctx, SC.hair, -12, 6, 8, st, 0.9, 0.5);
    ell(ctx, -8.6, 1, 2.2, 3, 0.4); paint(ctx, SC.band, -8.6, 1, 3, st, 0.5, 0.6);
    sprite(ctx, st, 'sable:head', 30, 30, 15, 16, sableFaceArt);
    // hat: brim, crown, band (cached), plume (live)
    frame(ctx, st, 1, -9.6, -0.14);
    sprite(ctx, st, 'sable:hat', 42, 22, 21, 15, sableHatArt);
    const fl = J.cape * 0.25;
    frame(ctx, st, -6, -5, -0.35 - fl + sway * 0.05);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(-10, -16, -30, -8 + sway * 1.5);
    ctx.quadraticCurveTo(-34, -2, -30, 3);
    ctx.quadraticCurveTo(-18, -2, 0, 3);
    ctx.closePath();
    paint(ctx, plumeC, -15, -4, 14, st, 0.9, 0.9, -0.3, 0.3);
    curve(ctx, 0, 1.5, -14, -6, -30, -2); stroke(ctx, shade(plumeC, -0.25), 0.8, 0.8);
    for (let i = 1; i < 7; i++) { curve(ctx, -i * 4, -2 - i * 0.2, -i * 4 - 3, -7 - i * 0.2, -i * 4 - 6, -9 + i * 0.4); stroke(ctx, shade(plumeC, -0.2), 0.6, 0.6); }
    unframe(ctx, st);
    unframe(ctx, st);
    unframe(ctx, st);
  }
  function sableFaceArt(ctx, st) {
    ell(ctx, -2.5, -1.5, 10, 10.6);
    paintR(ctx, SC.hair, -2.5, -1.5, 10.5, st, 1, 0.5);
    ell(ctx, 1.4, 0.8, 9.4, 10.8);
    paintR(ctx, SC.skin, 1.4, 0.8, 10.5, st, 1, 0.9);
    // sharp nose + jaw
    poly(ctx, [8.6, -3.4, 12.6, 2.4, 9.8, 3.4]);
    paint(ctx, SC.skin, 10, 0.5, 3, st, 0.4, 0.8);
    curve(ctx, 8.2, 6.4, 9.6, 6.2, 10.3, 5.6); stroke(ctx, '#9a5a4c', 1.1);
    // determined eye + brow
    ell(ctx, 6.5, -1.6, 1.7, 1.05, -0.12); fill(ctx, '#140c0a');
    circ(ctx, 7, -2, 0.42); fill(ctx, '#ffffff', 0.85);
    line(ctx, 3.8, -4.6, 9.4, -3.8); stroke(ctx, SC.hair, 1.5);
    // fringe lock
    ctx.beginPath();
    ctx.moveTo(-9, -6);
    ctx.quadraticCurveTo(-2, -13, 8.5, -8.5);
    ctx.quadraticCurveTo(9.5, -4, 7.2, -2.5);
    ctx.quadraticCurveTo(5.5, -6.4, 0, -6.8);
    ctx.closePath();
    paint(ctx, SC.hair, 0, -8, 8, st, 0.9, 0.6);
  }
  function sableHatArt(ctx, st) {
    ell(ctx, 0, 0, 17.5, 4.2);
    paint(ctx, SC.hat, 0, 0, 16, st, 1, 0.8);
    ctx.beginPath();
    ctx.moveTo(-9, -0.5);
    ctx.quadraticCurveTo(-10, -11, -1, -12.5);
    ctx.quadraticCurveTo(8.5, -12, 9, -0.5);
    ctx.closePath();
    paint(ctx, SC.hat, 0, -6, 10, st, 1, 0.8);
    ctx.beginPath(); ctx.moveTo(-9.2, -1); ctx.quadraticCurveTo(0, -4.4, 9.2, -1); ctx.lineTo(9, -4.2); ctx.quadraticCurveTo(0, -7.4, -9.4, -4.2); ctx.closePath();
    paint(ctx, SC.band, 0, -3, 8, st, 0.5, 0.5);
  }

  function sableRapier(ctx, J, st, bladeC) {
    const wl = st.look.body.wlen;
    frame(ctx, st, J.hN.x, J.hN.y, J.w);
    sprite(ctx, st, 'sable:rapier', wl + 14, 22, 12, 11, sableRapierArt);
    if (bladeC && !st.ghost) {
      const pc = ctx.globalCompositeOperation;
      ctx.globalCompositeOperation = 'lighter';
      line(ctx, 8, 0, wl, 0); stroke(ctx, bladeC, 3.2, 0.35 + 0.1 * Math.sin(st.t * 0.01));
      ctx.globalCompositeOperation = pc;
      glow(ctx, wl * 0.8, 0, 12, bladeC, 0.35);
    }
    unframe(ctx, st);
  }
  function sableRapierArt(ctx, st) {
    const wl = st.look.body.wlen;
    ctx.beginPath(); ctx.moveTo(6, -1.5); ctx.lineTo(wl, 0); ctx.lineTo(6, 1.5); ctx.closePath();
    paintAxis(ctx, SC.steel, 6, 0, wl, 0, 1.6, st, 0.7, 0.9, -0.3, 0.4);
    line(ctx, 8, -0.4, wl - 4, 0); stroke(ctx, '#ffffff', 0.6, 0.8);
    // quillons + knuckle bow + cup
    capsule(ctx, 5, -7, 5, 7, 1.2, 1.2); paint(ctx, SC.gold, 5, 0, 5, st, 0.5, 0.7);
    curve(ctx, 5, -1.5, -1, -9.5, -8, -2.5); stroke(ctx, SC.gold, 1.5);
    ell(ctx, 6.5, 0, 2.5, 4.5); paint(ctx, SC.gold, 6.5, 0, 4, st, 0.5, 0.8);
    capsule(ctx, -7, 0, 4, 0, 1.8, 1.6); paint(ctx, '#2a1d1a', -1, 0, 2, st, 0.5, 0.3);
    circ(ctx, -8.4, 0, 2.3); paintR(ctx, SC.gold, -8.4, 0, 2.3, st, 0.5, 0.6);
  }

  const sable = K.humanoid({
    id: 'sable', name: 'Sable Arden', kind: 'party', height: 152, topExtra: 12,
    body: { thigh: 36, shin: 35, upper: 24, fore: 23, torso: 44, neck: 9, headR: 11.2, shDrop: 5, shN: -4, shF: 5, hipN: -2, hipF: 2, wlen: 84, wtail: 10, grip: 10, bw: 20 },
    shootHand: 'far', twoHand: 0, armSwing: 0.34, magic: '#ffe0c8', trailColor: '#fff0e4',
    book: {
      ready: { nhx: 0.74, nhy: 0.18, w: -12 * D, fhx: -0.22, fhy: -0.38, fe: -1, lean: 0.02, ry: 0.12, nfx: -0.32, ffx: 0.34 },
      carry: { nhx: 0.25, nhy: 0.65, w: -145 * D, fhx: 0.3, fhy: 0.55, fe: 1 },
      victory: { nhx: 0.42, nhy: -0.15, w: -94 * D, fhx: 0.35, fhy: 0.55, fe: 1, lean: -0.04, hd: -0.1, ry: 0.03, nfx: -0.16, ffx: 0.2 },
      aimFar: { fhx: 0.98, fhy: -0.06, fe: 1, nhx: 0.12, nhy: 0.72, w: 152 * D, ex: 1, w2: 0 },
      guard: { nhx: 0.62, nhy: 0.05, w: -70 * D, fhx: -0.1, fhy: 0.2, fe: 1 },
      parry: { nhx: 0.7, nhy: -0.08, w: -98 * D, fhx: -0.15, fhy: -0.25, fe: -1 },
      dodge: { fe: -1, fhx: -0.3, fhy: -0.3 },
      hurt: { fe: 1 },
      variants: {
        thrust: {
          a: { nhx: -0.3, nhy: 0.1, w: -6 * D, fhx: -0.3, fhy: -0.4, fe: -1, rx: -0.16, ry: 0.18 },
          c: { nhx: 1.0, nhy: 0.02, w: 0, fhx: -0.8, fhy: -0.1, fe: -1, rx: 0.36, ry: 0.26, ffx: 0.72, nfx: -0.42 },
          f: { nhx: 0.96, nhy: 0.06, w: 3 * D, fhx: -0.78, fhy: -0.05, fe: -1, rx: 0.38, ry: 0.25, ffx: 0.72, nfx: -0.42 },
        },
        flurry: {
          a: { fhx: -0.3, fhy: -0.35, fe: -1 },
          c: { fhx: -0.5, fhy: -0.3, fe: -1 },
          f: { fhx: -0.45, fhy: -0.3, fe: -1 },
        },
        shoot: { shoot: true, a: {}, c: {} },
      },
    },
    castPoint(J, o) {
      if (J.ex > 0.5) {
        const a = Math.atan2(J.hF.y - J.eF.y, J.hF.x - J.eF.x) + J.w2;
        o.x = J.hF.x + Math.cos(a) * 19 - Math.sin(a) * -1.1; o.y = J.hF.y + Math.sin(a) * 19 + Math.cos(a) * -1.1;
      } else { o.x = J.tip.x; o.y = J.tip.y; }
    },
    weak: [],
    portrait: { x: 0, y: 1, r: 25, bg: ['#b8473d', '#2a1216'] },
    draw(ctx, J, st) {
      const T = st.look.body.torso;
      const m = mech(st, 'stance');
      const sc = STANCE[m ? m.value : 'neutral'] || STANCE.neutral;
      const aiming = J.ex > 0.5;
      sableTails(ctx, J, st);
      // far arm
      arm(ctx, J.sF, J.eF, J.hF, st, SC.coatD, 6.2, 5.4, 4.6);
      if (aiming) {
        const a = Math.atan2(J.hF.y - J.eF.y, J.hF.x - J.eF.x) + J.w2;
        frame(ctx, st, J.hF.x, J.hF.y, a);
        sablePistolShape(ctx, st, 1.1);
        unframe(ctx, st);
      }
      hand(ctx, J.hF.x, J.hF.y, 4, SC.glove, st, 0.8);
      leg(ctx, J, st, true, SC);
      leg(ctx, J, st, false, SC);
      sableTorso(ctx, J, st, T, !aiming);
      sableHead(ctx, J, st, sc.plume);
      // near arm
      arm(ctx, J.sN, J.eN, J.hN, st, SC.coat, 6.4, 5.6, 4.8);
      along(tmp, J.eN.x, J.eN.y, J.hN.x, J.hN.y, 0.78);
      circ(ctx, tmp.x, tmp.y, 5.4); paint(ctx, SC.shirt, tmp.x, tmp.y, 5, st, 0.6, 0.7);
      sableRapier(ctx, J, st, sc.blade);
      hand(ctx, J.hN.x, J.hN.y, 4.3, SC.glove, st, 0.8);
      if (m && m.value === 'virtuoso' && !st.ghost) {
        for (let i = 0; i < 3; i++) {
          const u = ((st.t / 900) + i / 3) % 1;
          const bx = lerp(J.hN.x, J.tip.x, 0.3 + u * 0.7), by = lerp(J.hN.y, J.tip.y, 0.3 + u * 0.7);
          star(ctx, bx, by - 3, 3.5, '#ffe28a', Math.sin(u * Math.PI), u * 3);
        }
      }
    },
  });

  return { gideon, nyra, sable };
}
