// Gilded Thicket enemy looks: Thornstag (golden-leaved stag), Gilded Harlequin (look id 'mime', harlequin duelist),
// Bloomwitch (rose-headed witch) and the Bellwether mini-boss (ram-horned bell giant with hammer).

/**
 * Build the thicket look definitions with the shared sprite kit.
 * @param {object} K painting kit from sprites.js
 * @returns {Record<string, object>}
 */
export function defineThicketLooks(K) {
  const { D, lerp, hash, shade, mix, paint, paintR, paintAxis, fill, stroke, capsule, limb, ell, circ, poly, blob,
    line, curve, glow, frame, unframe, foot, hand, along, sprite, strip, polyline, mitt } = K;
  const tmp = { x: 0, y: 0 }, tmp2 = { x: 0, y: 0 };
  const PARTY_ALIAS = { flurry: 'thrust', heavy: 'slam', leap: 'charge', buff: 'cast', heal: 'cast', shoot: 'bolt', gradient: 'nova' };
  const rot = (o, bx, by, a, lx, ly) => { const c = Math.cos(a), s = Math.sin(a); o.x = bx + lx * c - ly * s; o.y = by + lx * s + ly * c; return o; };

  // ================================================================== THORNSTAG
  const TS = { fur: '#c9a43a', furD: '#7d5f1c', furL: '#ecd27a', belly: '#e9d9aa', leaf: '#e3c15b', leafD: '#9a7424', antler: '#3f2b1d', thorn: '#5c3b25',
    heart: '#ffb347', heartGlow: '#ffcf6a', hoof: '#2a1d17', eye: '#ffd27a', nose: '#241712' };

  function leaf(ctx, x, y, len, w, a, c, st, ol = 0.5) {
    const ca = Math.cos(a), sa = Math.sin(a);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + ca * len * 0.5 - sa * w, y + sa * len * 0.5 + ca * w, x + ca * len, y + sa * len);
    ctx.quadraticCurveTo(x + ca * len * 0.5 + sa * w, y + sa * len * 0.5 - ca * w, x, y);
    ctx.closePath();
    paint(ctx, c, x + ca * len * 0.5, y + sa * len * 0.5, len * 0.5, st, ol, 0.5);
  }

  function stagBodyArt(ctx, st) {
    const h = 36;
    blob(ctx, [-44, -6, -30, -22, 0, -24, 28, -24, 44, -8, 42, 12, 26, 22, -4, 22, -34, 18, -46, 6]);
    paint(ctx, TS.fur, 0, -2, 40, st, 1.1, 0.9);
    // belly
    ctx.beginPath(); ctx.moveTo(-30, 16); ctx.quadraticCurveTo(0, 26, 30, 18); ctx.quadraticCurveTo(0, 16, -30, 12); ctx.closePath();
    fill(ctx, TS.belly, 0.75);
    // leaf fur along the back and flank
    for (let row = 0; row < 3; row++) {
      for (let i = 0; i < 8; i++) {
        const x = -38 + i * 10 + (row % 2) * 5, y = -19 + row * 8 + hash(i + row * 9) * 2;
        leaf(ctx, x, y, 11, 3.6, 0.35 + hash(i * 3 + row) * 0.3, row === 0 ? TS.leaf : mix(TS.leaf, TS.furD, 0.25 * row), st, 0.35);
      }
    }
    // heartwood hollow in the chest
    ell(ctx, 32, 4, 9, 11, 0.2); fill(ctx, '#2a160c');
    ell(ctx, 32, 4, 5.5, 7.5, 0.2);
    const g = ctx.createRadialGradient(31, 3, 1, 32, 4, 8);
    g.addColorStop(0, '#fff2c0'); g.addColorStop(0.5, TS.heart); g.addColorStop(1, '#8a4a14');
    ctx.fillStyle = g; ctx.fill();
    for (let i = 0; i < 3; i++) { curve(ctx, 29 + i * 2, -3, 31 + i * 2, 4, 29 + i * 2, 10); stroke(ctx, '#8a4a14', 0.8, 0.8); }
    curve(ctx, 25, -6, 32, -10, 39, -4); stroke(ctx, TS.furD, 2, 0.8);
  }

  function antlerArt(dark) {
    // main beam along +x (up/back once rotated), curling toward +y (forward) at the crown;
    // thorny tines branch off the front (+y) side, golden leaves at the tips
    return (ctx, st) => {
      const c = dark ? shade(TS.antler, -0.28) : TS.antler;
      const lc = dark ? shade(TS.leaf, -0.3) : TS.leaf;
      const pts = [];
      for (let i = 0; i <= 7; i++) { const u = i / 7; pts.push(u * 58, -Math.sin(u * Math.PI * 0.85) * 7 + u * u * 16); }
      strip(ctx, pts, 7, 2.2);
      paint(ctx, c, 29, 2, 12, st, 0.9, 0.6);
      const tines = [[8, 0.3, 1.05, 16], [22, 0.6, 0.85, 19], [36, 3.6, 0.7, 16], [48, 8.4, 0.5, 12]];
      for (const [x, y, a, l] of tines) {
        const ex = x + Math.cos(a) * l, ey = y + Math.sin(a) * l;
        const mx = x + Math.cos(a) * l * 0.5 - Math.sin(a) * 2.5, my = y + Math.sin(a) * l * 0.5 + Math.cos(a) * 2.5;
        ctx.beginPath(); ctx.moveTo(x - 2, y); ctx.quadraticCurveTo(mx, my, ex, ey); ctx.quadraticCurveTo(mx + 1.5, my - 1, x + 3, y); ctx.closePath();
        paint(ctx, c, mx, my, 6, st, 0.8, 0.5);
        leaf(ctx, ex, ey, 7.5, 2.6, a + 0.4, lc, st, 0.4);
      }
      // thorns along the back (-y) edge
      for (let i = 0; i < 7; i++) {
        const u = (i + 0.5) / 7, x = u * 58, y = -Math.sin(u * Math.PI * 0.85) * 7 + u * u * 16;
        poly(ctx, [x - 2, y - 1.5, x + 1.5, y - 6.5, x + 2, y - 1.5]);
        fill(ctx, dark ? shade(TS.thorn, -0.3) : TS.thorn);
      }
      leaf(ctx, 30, -4, 8, 2.8, -1.9, lc, st, 0.4);
      leaf(ctx, 56, 14, 8, 2.6, 0.9, lc, st, 0.4);
    };
  }
  const antlerNear = antlerArt(false), antlerFar = antlerArt(true);
  const ANT_A = -2.05;

  function stagFront(ctx, S, Kk, F, st, far) {
    const d = far ? -0.28 : 0;
    limb(ctx, S.x, S.y - 4, Kk.x, Kk.y, 8.5, 4.6, shade(TS.fur, d), st);
    limb(ctx, Kk.x, Kk.y, F.x, F.y, 3.8, 2.6, shade(TS.furD, d), st);
    poly(ctx, [F.x - 4, F.y, F.x + 5, F.y, F.x + 4, F.y + 4.5, F.x - 4, F.y + 4.5]);
    paint(ctx, shade(TS.hoof, d), F.x, F.y + 2, 4, st, 0.6, 0.4);
  }
  function stagHind(ctx, S, Kk, H, F, st, far) {
    const d = far ? -0.28 : 0;
    limb(ctx, S.x, S.y - 6, Kk.x, Kk.y, 12, 6.5, shade(TS.fur, d), st);
    limb(ctx, Kk.x, Kk.y, H.x, H.y, 6, 3.4, shade(TS.fur, d - 0.08), st);
    limb(ctx, H.x, H.y, F.x, F.y, 3, 2.5, shade(TS.furD, d), st);
    poly(ctx, [F.x - 4, F.y, F.x + 5, F.y, F.x + 4, F.y + 4.5, F.x - 4, F.y + 4.5]);
    paint(ctx, shade(TS.hoof, d), F.x, F.y + 2, 4, st, 0.6, 0.4);
  }

  function stagHeadArt(ctx, st) {
    // skull + snout (head frame: +x toward the nose)
    ctx.beginPath();
    ctx.moveTo(-8, -6);
    ctx.quadraticCurveTo(2, -12, 14, -7);
    ctx.quadraticCurveTo(26, -3, 32, 1);
    ctx.quadraticCurveTo(33, 6, 28, 7);
    ctx.lineTo(8, 7);
    ctx.quadraticCurveTo(-6, 9, -9, 2);
    ctx.closePath();
    paint(ctx, TS.fur, 10, 0, 18, st, 1, 0.9);
    ctx.beginPath(); ctx.moveTo(10, 4); ctx.quadraticCurveTo(22, 6, 30, 5); ctx.lineTo(28, 7); ctx.lineTo(9, 7); ctx.closePath();
    fill(ctx, TS.belly, 0.7);
    ell(ctx, 31, 2, 3, 2.4); fill(ctx, TS.nose);
    // leafy brow
    leaf(ctx, -4, -8, 12, 3.4, -0.25, TS.leaf, st);
    leaf(ctx, 0, -9, 10, 3, 0.05, TS.leafD, st);
    // ear (swept back)
    ctx.beginPath(); ctx.moveTo(-3, -7); ctx.quadraticCurveTo(-12, -16, -20, -13); ctx.quadraticCurveTo(-13, -8, -6, -3); ctx.closePath();
    paint(ctx, TS.fur, -10, -10, 8, st, 0.8, 0.8);
    curve(ctx, -5, -6, -11, -11, -17, -12.5); stroke(ctx, TS.furD, 1.1, 0.8);
  }

  const thornstag = K.quadruped({
    id: 'thornstag', name: 'Thornstag', kind: 'enemy', height: 190, topExtra: 60, magic: '#ffcf6a', fxScale: 1.2, variantAlias: PARTY_ALIAS,
    body: { standH: 92, bodyLen: 70, bodyR: 22, fu: 36, fl: 40, bu: 36, bl: 32, cannon: 22, legDrop: 10, legSpread: 5, neckOff: 4, neckUp: 12,
      neckLen: 44, neckAng: -64 * D, headLen: 32, headAng: 24 * D, headR: 11, tailLen: 14, tailUp: 10, hoof: 4 },
    pad: 60, shadowRx: 62,
    castPoint(J, o) { rot(o, J.body.x, J.body.y, J.bp, 32, 4); },
    weak: [
      { id: 'heartwood', r: 16, at(J, o) { rot(o, J.body.x, J.body.y, J.bp, 32, 4); } },
      { id: 'antlers', r: 22, at(J, o) { rot(tmp, J.nt.x, J.nt.y, J.ha, 0, -8); rot(o, tmp.x, tmp.y, J.ha + ANT_A - 0.1, 30, 8); } },
    ],
    anchors(look, J, o) {
      o.head.x = J.nt.x; o.head.y = J.nt.y;
      rot(o.chest, J.body.x, J.body.y, J.bp, 32, 4);
      rot(tmp, J.nt.x, J.nt.y, J.ha, 0, -8); rot(o.weapon, tmp.x, tmp.y, J.ha + ANT_A - 0.1, 40, 14);
      o.feet.x = J.body.x; o.feet.y = Math.max(J.fnF.y, J.bnF.y) + 4;
      rot(o.top, tmp.x, tmp.y, J.ha + ANT_A - 0.1, 56, 12);
      o.center.x = J.body.x; o.center.y = J.body.y;
      o.tip.x = o.weapon.x; o.tip.y = o.weapon.y;
    },
    portrait: { x: 2, y: -14, r: 36, bg: ['#c9953f', '#2a2012'] },
    draw(ctx, J, st) {
      const t = st.t;
      // far legs
      stagFront(ctx, J.ffS, J.ffK, J.ffF, st, true);
      stagHind(ctx, J.bfS, J.bfK, J.bfH, J.bfF, st, true);
      // far antler
      rot(tmp, J.nt.x, J.nt.y, J.ha, -4, -9);
      frame(ctx, st, tmp.x, tmp.y, J.ha + ANT_A + 0.42);
      sprite(ctx, st, 'thornstag:antlerFar', 84, 64, 8, 18, antlerFar);
      unframe(ctx, st);
      // tail
      limb(ctx, J.tail.x, J.tail.y, J.tailTip.x, J.tailTip.y, 5, 2.5, TS.furL, st, 0.8, 0.5);
      // body
      frame(ctx, st, J.body.x, J.body.y, J.bp);
      sprite(ctx, st, 'thornstag:body', 104, 60, 52, 30, stagBodyArt);
      unframe(ctx, st);
      if (!st.ghost) { rot(tmp2, J.body.x, J.body.y, J.bp, 32, 4); glow(ctx, tmp2.x, tmp2.y, 18 + 5 * Math.sin(t * 0.004 + st.seed) + J.ch * 14, TS.heartGlow, 0.55); }
      // near legs
      stagHind(ctx, J.bnS, J.bnK, J.bnH, J.bnF, st, false);
      stagFront(ctx, J.fnS, J.fnK, J.fnF, st, false);
      // neck + leafy mane
      limb(ctx, J.nb.x, J.nb.y + 6, J.nt.x, J.nt.y, 15, 8.5, TS.fur, st);
      for (let i = 0; i < 5; i++) {
        along(tmp2, J.nb.x - 6, J.nb.y - 6, J.nt.x - 4, J.nt.y - 7, i / 5);
        leaf(ctx, tmp2.x, tmp2.y, 12, 3.4, J.na - 2.4 + Math.sin(t * 0.003 + i) * 0.1, i % 2 ? TS.leaf : TS.leafD, st, 0.45);
      }
      // head + jaw
      frame(ctx, st, J.nt.x, J.nt.y, J.ha);
      frame(ctx, st, 6, 6, J.ja * 0.55);
      ctx.beginPath(); ctx.moveTo(0, -1); ctx.quadraticCurveTo(12, 3, 24, 1); ctx.lineTo(22, 4); ctx.quadraticCurveTo(10, 6, 0, 3); ctx.closePath();
      paint(ctx, TS.furD, 12, 2, 10, st, 0.8, 0.4);
      unframe(ctx, st);
      sprite(ctx, st, 'thornstag:head', 50, 30, 12, 15, stagHeadArt);
      const blink = (t + st.seed * 300) % 3800 < 120 ? 0.2 : 1;
      ell(ctx, 8, -3, 2.6, 1.9 * blink, -0.2); fill(ctx, '#1a0e08');
      if (!st.ghost) glow(ctx, 8.6, -3.2, 6, TS.eye, 0.8 * blink);
      unframe(ctx, st);
      // near antler
      rot(tmp, J.nt.x, J.nt.y, J.ha, 0, -8);
      frame(ctx, st, tmp.x, tmp.y, J.ha + ANT_A - 0.1);
      sprite(ctx, st, 'thornstag:antlerNear', 84, 64, 8, 18, antlerNear);
      unframe(ctx, st);
    },
  });

  // ================================================================== GILDED HARLEQUIN (look id 'mime')
  const GM = { gold: '#d9ad4a', goldD: '#8a6424', ivory: '#f4ecd9', ivoryD: '#c9bfa8', black: '#1d1719', mask: '#f8f4ec', maskD: '#d8cfbf',
    tear: '#1e161a', lip: '#b8434d', ribbon: '#f6efe0', ribbonEdge: '#d9ad4a', glove: '#f7f2e8' };

  function mimeTorsoArt(ctx, st) {
    const T = 46;
    const path = () => blob(ctx, [-9.5, 3, -11, -16, -10.5, -34, -7, -T + 2, -2, -T - 1, 5, -T, 11, -T + 6, 12, -28, 9.5, -12, 9.5, 3]);
    path();
    paint(ctx, GM.ivory, 1, -T * 0.5, 18, st, 1, 0.8);
    ctx.save();
    path();
    ctx.clip();
    for (let row = -1; row < 7; row++) {
      for (let col = -2; col < 3; col++) {
        if ((row + col) % 2 === 0) continue;
        const cx = col * 9 + (row % 2) * 4.5, cy = -row * 8 - 2;
        poly(ctx, [cx, cy - 5, cx + 4.5, cy, cx, cy + 5, cx - 4.5, cy]);
        ctx.fillStyle = K.lit(ctx, GM.gold, cx, cy, 5, st); ctx.fill();
      }
    }
    ctx.restore();
    path();
    stroke(ctx, GM.goldD, 0.8, 0.6);
    // buttons (pom-poms)
    for (let i = 0; i < 3; i++) { circ(ctx, 9, -34 + i * 10, 2.2); paintR(ctx, GM.black, 9, -34 + i * 10, 2.2, st, 0.4, 0.6); }
    // belt
    ctx.beginPath(); ctx.moveTo(-10, -1); ctx.lineTo(10, -1); ctx.lineTo(9.6, 3); ctx.lineTo(-9.6, 3); ctx.closePath();
    paint(ctx, GM.black, 0, 1, 10, st, 0.5, 0.5);
  }

  function mimeMaskArt(ctx, st) {
    // head back (dark hood under the cap)
    ell(ctx, -3, -1, 10, 11); paintR(ctx, GM.black, -3, -1, 10.5, st, 1, 0.4);
    // porcelain mask in profile
    ctx.beginPath();
    ctx.moveTo(-1, -11);
    ctx.quadraticCurveTo(9, -12, 11, -4);
    ctx.lineTo(13.4, 1);
    ctx.lineTo(11, 2);
    ctx.quadraticCurveTo(12, 5.5, 10.5, 7);
    ctx.quadraticCurveTo(9, 11, 3, 11.5);
    ctx.quadraticCurveTo(-3, 11, -3, 4);
    ctx.closePath();
    paint(ctx, GM.mask, 5, 0, 12, st, 1, 0.95, -0.28, 0.35);
    // eye hole + painted details
    ell(ctx, 6.5, -2.5, 2.4, 1.3, -0.1); fill(ctx, '#15100f');
    circ(ctx, 7, -2.7, 0.6); fill(ctx, '#ffe7a0', 0.9);
    curve(ctx, 3.5, -5.8, 7, -7.8, 10.2, -5.4); stroke(ctx, GM.gold, 1.4);
    ctx.beginPath(); ctx.moveTo(6.4, 0.2); ctx.quadraticCurveTo(7.8, 2.4, 6.6, 4.6); ctx.quadraticCurveTo(5.2, 2.4, 6.4, 0.2); ctx.closePath(); fill(ctx, GM.tear);
    curve(ctx, 8.2, 6.8, 9.8, 7.6, 11, 6.2); stroke(ctx, GM.lip, 1.3);
    curve(ctx, 1, 9, 5, 10.5, 9, 8.8); stroke(ctx, GM.maskD, 0.8, 0.8);
    curve(ctx, 0, -9, 4, -10.5, 8, -9.2); stroke(ctx, '#ffffff', 1.1, 0.6);
  }

  function mimeRuff(ctx, x, y, st) {
    const n = 9;
    ctx.beginPath();
    for (let i = 0; i <= n; i++) {
      const a = Math.PI * 0.95 + (i / n) * Math.PI * 1.1;
      const rx = 11, ry = 5.5;
      const px = x + Math.cos(a) * rx, py = y + Math.sin(a) * ry * -1;
      if (i === 0) ctx.moveTo(px, py); else ctx.quadraticCurveTo(x + Math.cos(a - 0.17) * rx * 1.25, y - Math.sin(a - 0.17) * ry * 1.4, px, py);
    }
    ctx.lineTo(x + 8, y + 4);
    ctx.quadraticCurveTo(x, y + 7, x - 8, y + 4);
    ctx.closePath();
    paint(ctx, GM.ivory, x, y, 11, st, 0.9, 0.8);
    for (let i = 0; i < 6; i++) { line(ctx, x - 8 + i * 3.2, y - 3.5, x - 7 + i * 3, y + 3.5); stroke(ctx, GM.ivoryD, 0.7, 0.8); }
  }

  function mimeCap(ctx, J, st) {
    const t = st.t;
    const sw = Math.sin(t * 0.0026 + st.seed);
    // two drooping points (gold forward, ivory back) with bells
    const tips = [[-24 - J.cape * 8, 8 + sw * 2, GM.ivory], [16, 12 + sw * 1.5, GM.gold]];
    for (const [tx, ty, c] of tips) {
      ctx.beginPath();
      ctx.moveTo(-8, -8);
      ctx.quadraticCurveTo(tx * 0.5, -24, tx, ty);
      ctx.quadraticCurveTo(tx * 0.4 + 2, -12, 8, -9);
      ctx.closePath();
      paint(ctx, c, tx * 0.4, -10, 14, st, 0.9, 0.8);
      circ(ctx, tx, ty + 2.5, 2.8); paintR(ctx, GM.gold, tx, ty + 2.5, 2.8, st, 0.6, 0.8, -0.35, 0.5);
    }
    ctx.beginPath(); ctx.moveTo(-10.5, -5); ctx.quadraticCurveTo(0, -11, 10.5, -6); ctx.lineTo(10, -9); ctx.quadraticCurveTo(0, -14, -10, -8.5); ctx.closePath();
    paint(ctx, GM.black, 0, -8, 10, st, 0.7, 0.5);
  }

  function mimeSword(ctx, J, st) {
    const b = st.look.body, wl = b.wlen, t = st.t;
    frame(ctx, st, J.hN.x, J.hN.y, J.w);
    const pts = [];
    for (let i = 0; i <= 8; i++) { const x = 8 + (i / 8) * (wl - 8); pts.push(x, Math.sin(x * 0.11 - t * 0.012 + st.seed) * (0.6 + i * 0.28)); }
    strip(ctx, pts, 7, 1.2);
    paint(ctx, GM.ribbon, wl * 0.5, 0, 5, st, 0.8, 0.9, -0.25, 0.35);
    polyline(ctx, pts);
    stroke(ctx, GM.ribbonEdge, 1, 0.9);
    // hilt: cup + grip + pommel
    ell(ctx, 6, 0, 3, 6.5); paint(ctx, GM.gold, 6, 0, 6, st, 0.7, 0.8);
    capsule(ctx, -7, 0, 4, 0, 1.8, 1.6); paintAxis(ctx, GM.black, -7, 0, 4, 0, 2, st, 0.5, 0.3);
    circ(ctx, -8.6, 0, 2.4); paintR(ctx, GM.gold, -8.6, 0, 2.4, st, 0.5, 0.7);
    unframe(ctx, st);
    // loose streamer from the pommel (world-space gravity)
    const px = J.hN.x - Math.cos(J.w) * 9, py = J.hN.y - Math.sin(J.w) * 9;
    const sp = [];
    for (let i = 0; i <= 6; i++) {
      const u = i / 6;
      sp.push(px - u * (14 + J.cape * 16) + Math.sin(t * 0.004 + u * 4 + st.seed) * 3 * u, py + u * 22 - J.cape * u * 10);
    }
    strip(ctx, sp, 4, 1.5);
    paint(ctx, GM.gold, px - 6, py + 10, 10, st, 0.6, 0.6);
  }

  const mime = K.humanoid({
    id: 'mime', name: 'Gilded Harlequin', kind: 'enemy', height: 165, topExtra: 14,
    body: { thigh: 39, shin: 38, upper: 25, fore: 24, torso: 46, neck: 8, headR: 11.5, shDrop: 5, shN: -4, shF: 5, hipN: -2, hipF: 2, wlen: 88, wtail: 12, grip: 12, bw: 18 },
    shootHand: 'far', armSwing: 0.4, magic: '#ffe39a', trailColor: '#fff4d8', variantAlias: PARTY_ALIAS, defaultVariant: 'thrust',
    book: {
      ready: { nhx: 0.7, nhy: 0.28, w: -18 * D, fhx: 0.1, fhy: -0.55, lean: -0.04, hd: -0.05, ry: 0.06, nfx: -0.2, ffx: 0.3, ffy: 0 },
      victory: { nhx: 0.3, nhy: -0.9, w: -80 * D, fhx: -0.5, fhy: -0.3, lean: -0.15, hd: -0.25 },
      carry: { nhx: 0.3, nhy: 0.55, w: -40 * D, fhx: 0.1, fhy: -0.5 },
      variants: {
        slash: { a: { fhx: 0.6, fhy: -0.6 } },
        thrust: { a: { fhx: -0.3, fhy: -0.5 }, c: { fhx: -0.7, fhy: -0.25 } },
      },
    },
    weak: [{ id: 'mask', r: 13, at(J, o) { const a = J.headA; o.x = J.head.x + 5 * Math.cos(a); o.y = J.head.y + 5 * Math.sin(a); } }],
    portrait: { x: 2, y: 0, r: 24, bg: ['#d9ad4a', '#2a1f14'] },
    draw(ctx, J, st) {
      // far arm (gold sleeve)
      limb(ctx, J.sF.x, J.sF.y, J.eF.x, J.eF.y, 5, 4.4, shade(GM.gold, -0.25), st);
      limb(ctx, J.eF.x, J.eF.y, J.hF.x, J.hF.y, 4.4, 3.8, shade(GM.gold, -0.25), st);
      hand(ctx, J.hF.x, J.hF.y, 4, shade(GM.glove, -0.2), st, 0.8);
      // legs (harlequin: swapped colours)
      const b = st.look.body;
      for (const far of [true, false]) {
        const p = far ? J.pF : J.pN, k = far ? J.kF : J.kN, f = far ? J.fF : J.fN;
        const d = far ? -0.2 : 0;
        limb(ctx, p.x, p.y, k.x, k.y, 6.8, 5, shade(far ? GM.gold : GM.ivory, d), st);
        limb(ctx, k.x, k.y, f.x, f.y, 5, 3.6, shade(far ? GM.ivory : GM.gold, d), st);
        circ(ctx, k.x, k.y, 3.2); paintR(ctx, shade(GM.black, d), k.x, k.y, 3.2, st, 0.4, 0.5);
        foot(ctx, f.x, f.y, 14, b.ankle, shade(GM.black, d), st, Math.max(0, -(f.y + b.ankle)));
        circ(ctx, f.x + 15, f.y + 1, 1.6); fill(ctx, GM.gold);
      }
      // torso
      frame(ctx, st, J.hip.x, J.hip.y, J.lean);
      sprite(ctx, st, 'mime:torso', 30, 56, 14, 50, mimeTorsoArt);
      unframe(ctx, st);
      // tabard tails
      const nx = Math.cos(J.lean), ny = Math.sin(J.lean);
      for (let i = 0; i < 2; i++) {
        const bx = J.hip.x + nx * (i ? 6 : -8), by = J.hip.y + ny * (i ? 6 : -8) + 2;
        poly(ctx, [bx - 5, by, bx + 5, by, bx + 1 - J.cape * 6, by + 14]);
        paint(ctx, i ? GM.gold : GM.ivory, bx, by + 5, 6, st, 0.7, 0.6);
      }
      mimeRuff(ctx, J.neck.x + 1, J.neck.y + 1, st);
      frame(ctx, st, J.head.x, J.head.y, J.headA);
      sprite(ctx, st, 'mime:mask', 30, 30, 14, 14, mimeMaskArt);
      mimeCap(ctx, J, st);
      unframe(ctx, st);
      // near arm (ivory sleeve) + ribbon sword
      limb(ctx, J.sN.x, J.sN.y, J.eN.x, J.eN.y, 5.2, 4.6, GM.ivory, st);
      limb(ctx, J.eN.x, J.eN.y, J.hN.x, J.hN.y, 4.6, 4, GM.ivory, st);
      mimeSword(ctx, J, st);
      hand(ctx, J.hN.x, J.hN.y, 4.2, GM.glove, st, 0.8);
    },
  });

  // ================================================================== BLOOMWITCH
  const BW = { rose: '#b3263a', roseD: '#6a0f22', roseL: '#ea5a6c', gown: '#c23a4c', gownL: '#e37c8c', gownD: '#7a1a2c', leaf: '#4f7a3a', leafD: '#2c4a22',
    skin: '#bcd6a4', skinD: '#86a870', wand: '#2e4a2a', bud: '#ff9ac0', thorn: '#1f3320' };

  function roseArt(ctx, st) {
    // sepals
    for (let i = 0; i < 4; i++) {
      const a = 1.2 + i * 0.55;
      ctx.beginPath(); ctx.moveTo(0, 12); ctx.quadraticCurveTo(Math.cos(a) * 18, 12 + Math.sin(a) * 8, Math.cos(a) * 26, 12 + Math.sin(a) * 12); ctx.quadraticCurveTo(Math.cos(a) * 12, 16, 0, 14); ctx.closePath();
      paint(ctx, i % 2 ? BW.leaf : BW.leafD, Math.cos(a) * 12, 14, 12, st, 0.8, 0.5);
    }
    // outer cupped petals
    const outer = [[-18, 2, 16, 14, -0.4], [16, 4, 15, 13, 0.4], [-4, 10, 20, 11, 0], [-14, -12, 14, 12, -0.8], [12, -12, 14, 12, 0.7]];
    for (const [x, y, rx, ry, a] of outer) {
      ell(ctx, x, y, rx, ry, a);
      paintR(ctx, BW.rose, x, y, Math.max(rx, ry), st, 1, 0.8);
      curve(ctx, x - rx * 0.6, y - ry * 0.3, x, y - ry * 0.9, x + rx * 0.6, y - ry * 0.3);
      stroke(ctx, BW.roseL, 1.2, 0.55);
    }
    // inner petals spiral
    for (let i = 0; i < 7; i++) {
      const a = i * 2.3, r = 13 - i * 1.5;
      const x = Math.cos(a) * r * 0.5, y = -2 + Math.sin(a) * r * 0.35;
      ell(ctx, x, y, r, r * 0.72, a);
      paintR(ctx, mix(BW.rose, BW.roseD, i / 9), x, y, r, st, 0.8, 0.7);
      ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.72, a, Math.PI * 1.05, Math.PI * 1.9); stroke(ctx, BW.roseL, 1, 0.6);
    }
    // heart
    ctx.beginPath();
    for (let i = 0; i < 30; i++) { const a = i * 0.45, r = 5 * (1 - i / 32); const x = Math.cos(a) * r, y = -3 + Math.sin(a) * r * 0.7; if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
    stroke(ctx, BW.roseD, 1.4, 0.9);
  }

  function bloomSkirt(ctx, J, st) {
    const t = st.t;
    const sway = Math.sin(t * 0.0018 + st.seed);
    const nx = Math.cos(J.lean), ny = Math.sin(J.lean);
    const hx = J.hip.x, hy = J.hip.y;
    const fmin = Math.min(J.fN.x, J.fF.x, J.kN.x - 6, J.kF.x - 6), fmax = Math.max(J.fN.x, J.fF.x, J.kN.x, J.kF.x);
    const hemY = Math.max(J.fN.y, J.fF.y) + 2;
    const backX = fmin - 22 - J.cape * 18 - sway * 3, frontX = fmax + 16;
    ctx.beginPath();
    ctx.moveTo(hx - nx * 11, hy - ny * 11 - 8);
    ctx.quadraticCurveTo(backX + 6, lerp(hy, hemY, 0.45), backX, hemY - 6);
    ctx.quadraticCurveTo(lerp(backX, frontX, 0.5), hemY + 4, frontX, hemY - 4);
    ctx.quadraticCurveTo(frontX - 4, lerp(hy, hemY, 0.45), hx + nx * 10, hy + ny * 10 - 8);
    ctx.closePath();
    paint(ctx, BW.gown, lerp(backX, frontX, 0.55), lerp(hy, hemY, 0.55), 34, st, 1, 0.8);
    // petal layers: rounded, overlapping, each slightly tilted and swaying
    for (let layer = 0; layer < 3; layer++) {
      const y0 = lerp(hy, hemY, [0.3, 0.55, 0.78][layer]);
      const n = [5, 6, 7][layer];
      const x0 = lerp(backX, hx - 10, [0.5, 0.25, 0.02][layer]), x1 = lerp(frontX, hx + 10, [0.5, 0.25, 0.02][layer]);
      for (let i = 0; i < n; i++) {
        const u = (i + 0.5 + (layer % 2) * 0.25) / (n + 0.25);
        const x = lerp(x0, x1, u);
        const ph = Math.sin(t * 0.0022 + i * 1.3 + layer + st.seed) * 2;
        const w = 9 + hash(i * 3.1 + layer) * 3, hgt = 18 + layer * 3 + hash(i + layer * 7) * 5;
        const tilt = (u - 0.5) * 0.5 + ph * 0.02;
        const tx = x + Math.sin(tilt) * hgt + ph, ty = y0 + Math.cos(tilt) * hgt;
        ctx.beginPath();
        ctx.moveTo(x - w * 0.6, y0);
        ctx.bezierCurveTo(x - w * 1.3, y0 + hgt * 0.6, tx - w, ty + 2, tx, ty);
        ctx.bezierCurveTo(tx + w, ty + 2, x + w * 1.3, y0 + hgt * 0.6, x + w * 0.6, y0);
        ctx.closePath();
        const c = [mix(BW.gown, BW.gownD, 0.25), mix(BW.gown, BW.gownL, 0.35), BW.gownL][layer];
        paint(ctx, c, x, y0 + hgt * 0.5, w + 4, st, 0.6, 0.8);
        curve(ctx, x, y0 + 3, (x + tx) / 2 + 1, (y0 + ty) / 2, tx, ty - 4); stroke(ctx, BW.gownD, 0.8, 0.45);
      }
    }
  }

  const bloomwitch = K.humanoid({
    id: 'bloomwitch', name: 'Bloomwitch', kind: 'enemy', height: 185, topExtra: 14,
    body: { thigh: 40, shin: 40, upper: 27, fore: 26, torso: 46, neck: 12, headR: 21, shDrop: 5, shN: -4, shF: 5, hipN: -2, hipF: 2, wlen: 58, wtail: 8, grip: 10, bw: 22 },
    shootHand: 'near', armSwing: 0.18, magic: '#ff9ac0', trailColor: '#ffd0e0', variantAlias: PARTY_ALIAS, defaultVariant: 'cast',
    book: {
      ready: { nhx: 0.55, nhy: 0.3, w: -55 * D, fhx: 0.3, fhy: 0.55, lean: -0.02, hd: -0.05, ry: 0.02, nfx: -0.1, ffx: 0.16 },
      carry: { nhx: 0.4, nhy: 0.45, w: -50 * D, fhx: 0.25, fhy: 0.55 },
    },
    castPoint(J, o) { o.x = J.tip.x; o.y = J.tip.y; },
    weak: [{ id: 'bloom', r: 24, at(J, o) { o.x = J.head.x; o.y = J.head.y - 2; } }],
    portrait: { x: 0, y: 6, r: 32, bg: ['#c9606a', '#2a1418'] },
    draw(ctx, J, st) {
      const t = st.t;
      // far arm (vine-wrapped)
      limb(ctx, J.sF.x, J.sF.y, J.eF.x, J.eF.y, 4.2, 3.6, shade(BW.skin, -0.2), st);
      limb(ctx, J.eF.x, J.eF.y, J.hF.x, J.hF.y, 3.6, 3, shade(BW.skin, -0.2), st);
      hand(ctx, J.hF.x, J.hF.y, 3.4, shade(BW.skin, -0.25), st, 0.7);
      bloomSkirt(ctx, J, st);
      // bodice of leaves
      frame(ctx, st, J.hip.x, J.hip.y, J.lean);
      const T = 46;
      blob(ctx, [-9, 2, -10, -16, -9.5, -32, -6, -T + 2, 0, -T, 7, -T + 2, 10.5, -30, 8.5, -14, 9, 2]);
      paint(ctx, BW.leaf, 0, -T * 0.5, 16, st, 1, 0.8);
      for (let i = 0; i < 5; i++) {
        const y = -6 - i * 7.5;
        ctx.beginPath(); ctx.moveTo(-8, y); ctx.quadraticCurveTo(0, y - 6, 9, y - 1); ctx.quadraticCurveTo(0, y + 3, -8, y); ctx.closePath();
        paint(ctx, i % 2 ? BW.leafD : mix(BW.leaf, BW.leafD, 0.3), 0, y - 2, 8, st, 0.4, 0.6);
      }
      // petal collar
      for (let i = 0; i < 5; i++) { ell(ctx, -8 + i * 4.2, -T + 2, 4.5, 2.6, -0.5 + i * 0.25); paint(ctx, BW.gownL, -8 + i * 4, -T + 2, 4, st, 0.5, 0.6); }
      unframe(ctx, st);
      // neck stem + rose head
      limb(ctx, J.neck.x, J.neck.y + 2, J.head.x, J.head.y + 12, 3.6, 3.2, BW.leafD, st, 0.8, 0.4);
      frame(ctx, st, J.head.x, J.head.y, J.headA * 0.6);
      sprite(ctx, st, 'bloomwitch:rose', 60, 50, 30, 26, roseArt);
      if (!st.ghost) {
        const fl = 0.7 + 0.3 * Math.sin(t * 0.006 + st.seed);
        glow(ctx, 5, -3, 7, '#ff6aa0', 0.7 * fl);
        glow(ctx, -2, -1, 6, '#ff6aa0', 0.55 * fl);
      }
      unframe(ctx, st);
      // near arm + thorn wand
      limb(ctx, J.sN.x, J.sN.y, J.eN.x, J.eN.y, 4.4, 3.8, BW.skin, st);
      limb(ctx, J.eN.x, J.eN.y, J.hN.x, J.hN.y, 3.8, 3.2, BW.skin, st);
      along(tmp, J.eN.x, J.eN.y, J.hN.x, J.hN.y, 0.2); along(tmp2, J.eN.x, J.eN.y, J.hN.x, J.hN.y, 0.8);
      curve(ctx, tmp.x, tmp.y - 3, (tmp.x + tmp2.x) / 2 + 3, (tmp.y + tmp2.y) / 2 + 3, tmp2.x, tmp2.y - 3); stroke(ctx, BW.leafD, 1.4, 0.9);
      const wl = st.look.body.wlen;
      frame(ctx, st, J.hN.x, J.hN.y, J.w);
      capsule(ctx, -8, 0, wl - 4, 0, 1.8, 1.1);
      paintAxis(ctx, BW.wand, -8, 0, wl - 4, 0, 2, st, 0.8, 0.5);
      for (let i = 0; i < 6; i++) { const x = 4 + i * 8, sg = i % 2 ? 1 : -1; poly(ctx, [x, sg * 1.2, x + 2.5, sg * 5, x + 3, sg * 1]); fill(ctx, BW.thorn); }
      ell(ctx, wl, 0, 5, 3.6); paint(ctx, BW.bud, wl, 0, 5, st, 0.7, 0.8);
      leaf2(ctx, wl - 4, 0, st);
      unframe(ctx, st);
      if (!st.ghost) glow(ctx, J.tip.x, J.tip.y, 10 + Math.sin(t * 0.007) * 2 + J.ch * 12, BW.bud, 0.6);
      hand(ctx, J.hN.x, J.hN.y, 3.6, BW.skin, st, 0.7);
    },
  });
  function leaf2(ctx, x, y, st) {
    for (const s of [-1, 1]) {
      ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x - 3, y + s * 5, x - 8, y + s * 4); ctx.quadraticCurveTo(x - 4, y + s * 1, x, y); ctx.closePath();
      paint(ctx, BW.leaf, x - 4, y + s * 3, 4, st, 0.4, 0.4);
    }
  }

  // ================================================================== BELLWETHER
  const BL = { bronze: '#a8743a', bronzeD: '#5e3d1e', bronzeL: '#e0ad63', verd: '#5a9a82', cloak: '#3d4b2f', cloakD: '#222b19', horn: '#cfb68f', hornD: '#7e6647',
    eye: '#ffe08a', fur: '#4d3b2b', wood: '#5a3b24', iron: '#3a3432' };

  function bellArt(ctx, st) {
    // bell body (crown at top, flared lip at bottom); origin at bell centre
    ctx.beginPath();
    ctx.moveTo(-18, -40);
    ctx.quadraticCurveTo(0, -48, 18, -40);
    ctx.quadraticCurveTo(28, -30, 28, -8);
    ctx.quadraticCurveTo(30, 14, 46, 28);
    ctx.quadraticCurveTo(0, 38, -46, 28);
    ctx.quadraticCurveTo(-30, 14, -28, -8);
    ctx.quadraticCurveTo(-28, -30, -18, -40);
    ctx.closePath();
    paint(ctx, BL.bronze, 0, -6, 44, st, 1.4, 0.95);
    // verdigris streaks
    for (let i = 0; i < 4; i++) { curve(ctx, -20 + i * 12, -34, -22 + i * 13, -6, -26 + i * 15, 22); stroke(ctx, BL.verd, 3 + (i % 2) * 2, 0.28); }
    // lip band + mouth
    ctx.beginPath(); ctx.moveTo(-46, 28); ctx.quadraticCurveTo(0, 38, 46, 28); ctx.quadraticCurveTo(0, 30, -44, 22); ctx.closePath();
    paint(ctx, BL.bronzeL, 0, 28, 30, st, 0.8, 0.8);
    ell(ctx, 0, 29, 42, 6.5); fill(ctx, '#140c08');
    // decorative bands
    curve(ctx, -27, -14, 0, -20, 27, -14); stroke(ctx, BL.bronzeD, 2.4, 0.8);
    curve(ctx, -29, 8, 0, 2, 31, 8); stroke(ctx, BL.bronzeD, 2, 0.7);
    for (let i = 0; i < 7; i++) { const x = -24 + i * 8; circ(ctx, x, -17 + Math.abs(x) * 0.12, 1.6); fill(ctx, BL.bronzeL); }
    // engraved eye socket (front)
    ctx.beginPath(); ctx.moveTo(4, -5); ctx.quadraticCurveTo(15, -15, 26, -5); ctx.quadraticCurveTo(15, 3, 4, -5); ctx.closePath();
    fill(ctx, '#2a1a0c');
    ctx.beginPath(); ctx.moveTo(4, -5); ctx.quadraticCurveTo(15, -15, 26, -5); stroke(ctx, BL.bronzeL, 1.4, 0.9);
    // crown loop
    ctx.beginPath(); ctx.ellipse(0, -46, 9, 6, 0, Math.PI, 0); ctx.lineWidth = 5; ctx.strokeStyle = BL.bronzeD; ctx.stroke();
    curve(ctx, -22, -32, -10, -42, 6, -44); stroke(ctx, '#fff2d0', 2, 0.35);
  }

  function hornArt(dark) {
    return (ctx, st) => {
      const pts = [];
      for (let i = 0; i <= 16; i++) {
        const u = i / 16, a = -0.4 - u * 4.6, r = 26 * (1 - u * 0.62);
        pts.push(Math.cos(a) * r - 4, Math.sin(a) * r + 14);
      }
      strip(ctx, pts, 17, 5);
      const c = dark ? shade(BL.horn, -0.3) : BL.horn;
      paint(ctx, c, 0, 4, 26, st, 1.1, 0.8);
      for (let i = 1; i < 14; i += 1) {
        const x = pts[i * 2], y = pts[i * 2 + 1], x2 = pts[i * 2 + 2], y2 = pts[i * 2 + 3];
        const dx = x2 - x, dy = y2 - y, d = Math.hypot(dx, dy) || 1, w = lerp(17, 5, i / 16) / 2;
        line(ctx, x - dy / d * w, y + dx / d * w, x + dy / d * w, y - dx / d * w);
        stroke(ctx, dark ? shade(BL.hornD, -0.3) : BL.hornD, 1, 0.7);
      }
    };
  }
  const hornNear = hornArt(false), hornFar = hornArt(true);

  function bellTorsoArt(ctx, st) {
    const T = 100;
    blob(ctx, [-40, 6, -48, -30, -46, -70, -30, -T - 2, 4, -T - 6, 34, -T + 6, 46, -60, 42, -22, 34, 6]);
    paint(ctx, BL.bronze, 0, -T * 0.5, 50, st, 1.3, 0.9);
    // cuirass plates
    for (let i = 0; i < 3; i++) { curve(ctx, -38, -24 - i * 22, 2, -34 - i * 24, 42, -24 - i * 22); stroke(ctx, BL.bronzeD, 2.4, 0.75); }
    // bell emblem
    ctx.beginPath(); ctx.moveTo(14, -70); ctx.quadraticCurveTo(22, -70, 22, -58); ctx.quadraticCurveTo(22, -50, 28, -46); ctx.lineTo(0, -46); ctx.quadraticCurveTo(6, -50, 6, -58); ctx.quadraticCurveTo(6, -70, 14, -70); ctx.closePath();
    paint(ctx, BL.bronzeL, 14, -58, 12, st, 0.8, 0.8);
    // rope sash
    curve(ctx, -40, -6, 0, 4, 38, -12); stroke(ctx, '#b89a64', 6);
    curve(ctx, -40, -6, 0, 4, 38, -12); stroke(ctx, '#7a5f34', 1.2, 0.8);
    // fur mantle at the shoulders
    blob(ctx, [-44, -80, -36, -T - 8, 0, -T - 14, 34, -T, 40, -84, 0, -88]);
    paint(ctx, BL.fur, 0, -T + 4, 40, st, 1, 0.5);
    for (let i = 0; i < 9; i++) { curve(ctx, -36 + i * 9, -T - 6, -38 + i * 9, -92, -34 + i * 9, -84); stroke(ctx, shade(BL.fur, 0.25), 1.2, 0.6); }
  }

  function hammerArt(ctx, st) {
    const L = 120;
    capsule(ctx, -30, 0, L - 10, 0, 4, 4.6);
    paintAxis(ctx, BL.wood, -30, 0, L - 10, 0, 4.6, st, 1, 0.6);
    for (const x of [-26, 20, 60]) { ctx.beginPath(); ctx.rect(x - 3, -5.5, 6, 11); paintAxis(ctx, BL.bronzeD, x - 3, 0, x + 3, 0, 5.5, st, 0.6, 0.5); }
    // hammer head: bronze drum with flared faces
    ctx.beginPath();
    ctx.moveTo(L - 16, -30); ctx.lineTo(L + 16, -30); ctx.lineTo(L + 20, -36); ctx.lineTo(L + 22, 36); ctx.lineTo(L + 16, 30); ctx.lineTo(L - 16, 30); ctx.lineTo(L - 22, 36); ctx.lineTo(L - 20, -36); ctx.closePath();
    paint(ctx, BL.bronze, L, 0, 30, st, 1.3, 0.9);
    for (const y of [-18, 0, 18]) { line(ctx, L - 17, y, L + 17, y); stroke(ctx, BL.bronzeD, 2, 0.7); }
    circ(ctx, L, 0, 7); paintR(ctx, BL.bronzeL, L, 0, 7, st, 0.8, 0.8);
  }

  const bellwether = K.humanoid({
    id: 'bellwether', name: 'The Bellwether', kind: 'enemy', height: 300, topExtra: 16, olScale: 1.5, fxScale: 2,
    body: { thigh: 50, shin: 48, upper: 52, fore: 52, torso: 100, neck: 10, headR: 40, shDrop: 20, shN: -26, shF: 30, hipN: -10, hipF: 10, wlen: 120, wreach: 146, wtail: 30, grip: 44, bw: 58, ankle: 8 },
    twoHand: 1, shootHand: 'near', armSwing: 0.2, magic: '#ffd98a', trailColor: '#ffe9c0', weaponFocus: 1, variantAlias: PARTY_ALIAS, defaultVariant: 'slam',
    pad: 52, jumpH: 0.6, shadowRx: 90,
    book: {
      ready: { nhx: 0.46, nhy: 0.55, w: -62 * D, two: 0.8, fhx: 0.5, fhy: 0.3, lean: 0.1, hd: 0.08, ry: 0.08, nfx: -0.26, ffx: 0.28 },
      carry: { nhx: 0.3, nhy: 0.6, w: -120 * D, fhx: 0.3, fhy: 0.5 },
      victory: { nhx: 0.3, nhy: -0.9, w: -95 * D, two: 0, fhx: 0.6, fhy: -0.6, lean: -0.15, hd: -0.3 },
      variants: { slash: { a: { two: 1 }, c: { two: 1 }, f: { two: 1 } }, thrust: { a: { two: 1 }, c: { two: 1 }, f: { two: 1 } } },
    },
    castPoint(J, o) { const a = J.headA * 0.5; o.x = J.head.x + 15 * Math.cos(a) + 5 * Math.sin(a); o.y = J.head.y + 15 * Math.sin(a) - 5 * Math.cos(a); },
    trailPts(J, o) { o[0] = J.hN.x + Math.cos(J.w) * 142; o[1] = J.hN.y + Math.sin(J.w) * 142; o[2] = J.hN.x + Math.cos(J.w) * 98; o[3] = J.hN.y + Math.sin(J.w) * 98; },
    weak: [
      { id: 'bell_clapper', r: 17, at(J, o, st) { const sw = clapperSwing(J, st); const a = J.headA * 0.5; rot(o, J.head.x, J.head.y, a, Math.sin(sw) * 26, 16 + Math.cos(sw) * 26); } },
      { id: 'eye', r: 14, at(J, o) { const a = J.headA * 0.5; rot(o, J.head.x, J.head.y, a, 15, -5); } },
    ],
    portrait: { x: 4, y: 4, r: 62, bg: ['#a8743a', '#1c140c'] },
    draw(ctx, J, st) {
      const t = st.t;
      const b = st.look.body;
      const sway = Math.sin(t * 0.0017 + st.seed);
      // cloak behind
      const nx = Math.cos(J.lean), ny = Math.sin(J.lean);
      const top = rot(tmp, J.hip.x, J.hip.y, J.lean, -34, -92);
      const tx = top.x, ty = top.y;
      const kmin = Math.min(J.kN.x, J.kF.x);
      ctx.beginPath();
      ctx.moveTo(tx + 20, ty - 6);
      ctx.quadraticCurveTo(tx - 40 - J.cape * 30, ty + 60, kmin - 40 - J.cape * 40 + sway * 6, Math.max(J.kN.y, J.kF.y) + 20);
      ctx.lineTo(kmin - 4, Math.max(J.kN.y, J.kF.y) + 26);
      ctx.quadraticCurveTo(J.hip.x - nx * 30, J.hip.y + 10, tx + 34, ty + 10);
      ctx.closePath();
      paint(ctx, BL.cloak, tx - 20, ty + 60, 60, st, 1.2, 0.5);
      for (let i = 0; i < 3; i++) { curve(ctx, tx - i * 10, ty + 10, tx - 30 - i * 12, ty + 80, kmin - 30 - i * 6, Math.max(J.kN.y, J.kF.y) + 16); stroke(ctx, BL.cloakD, 2.4, 0.6); }
      // far arm
      limb(ctx, J.sF.x, J.sF.y, J.eF.x, J.eF.y, 16, 14, shade(BL.fur, -0.2), st);
      limb(ctx, J.eF.x, J.eF.y, J.hF.x, J.hF.y, 14, 13, shade(BL.bronze, -0.3), st);
      if (J.two <= 0.3) mitt(ctx, J.eF, J.hF, st, shade(BL.bronze, -0.3), 0.8, shade(BL.fur, -0.2));
      // legs
      for (const far of [true, false]) {
        const p = far ? J.pF : J.pN, k = far ? J.kF : J.kN, f = far ? J.fF : J.fN;
        const d = far ? -0.24 : 0;
        limb(ctx, p.x, p.y, k.x, k.y, 20, 15, shade(BL.fur, d), st, 1.2);
        limb(ctx, k.x, k.y, f.x, f.y, 14, 11, shade(BL.bronze, d), st, 1.2);
        circ(ctx, k.x, k.y, 12); paintR(ctx, shade(BL.bronzeD, d), k.x, k.y, 12, st, 1, 0.6);
        foot(ctx, f.x, f.y, 24, b.ankle, shade(BL.iron, d), st, Math.max(0, -(f.y + b.ankle)), 1.2);
      }
      // torso
      frame(ctx, st, J.hip.x, J.hip.y, J.lean);
      sprite(ctx, st, 'bellwether:torso', 110, 130, 54, 118, bellTorsoArt);
      unframe(ctx, st);
      // head: far horn, bell, clapper, eye, near horn
      const ha = J.headA * 0.5;
      rot(tmp, J.head.x, J.head.y, ha, -14, -28);
      frame(ctx, st, tmp.x, tmp.y, ha, 1.25, 1.25);
      sprite(ctx, st, 'bellwether:hornFar', 70, 70, 36, 30, hornFar);
      unframe(ctx, st);
      const sw = clapperSwing(J, st);
      rot(tmp, J.head.x, J.head.y, ha, 0, 16);
      rot(tmp2, J.head.x, J.head.y, ha, Math.sin(sw) * 26, 16 + Math.cos(sw) * 26);
      line(ctx, tmp.x, tmp.y, tmp2.x, tmp2.y); stroke(ctx, BL.iron, 4.5);
      circ(ctx, tmp2.x, tmp2.y, 11); paintR(ctx, BL.iron, tmp2.x, tmp2.y, 11, st, 1.1, 0.7);
      frame(ctx, st, J.head.x, J.head.y, ha);
      sprite(ctx, st, 'bellwether:bell', 100, 94, 50, 52, bellArt);
      const fl = 0.75 + 0.25 * Math.sin(t * 0.005 + st.seed) + J.ch * 0.5;
      ell(ctx, 15, -5.5, 5, 4); fill(ctx, BL.eye);
      circ(ctx, 16, -5.5, 2); fill(ctx, '#3a1a08');
      if (!st.ghost) glow(ctx, 15, -5, 22 * fl, BL.eye, 0.55);
      unframe(ctx, st);
      rot(tmp, J.head.x, J.head.y, ha, 8, -24);
      frame(ctx, st, tmp.x, tmp.y, ha, 1.25, 1.25);
      sprite(ctx, st, 'bellwether:hornNear', 70, 70, 36, 30, hornNear);
      unframe(ctx, st);
      // pauldron (near)
      ell(ctx, J.sN.x, J.sN.y + 4, 26, 16, J.lean * 0.5 + 0.2);
      paintR(ctx, BL.bronze, J.sN.x, J.sN.y + 4, 26, st, 1.2, 0.9);
      for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.ellipse(J.sN.x, J.sN.y + 6 + i * 5, 24 - i * 3, 13 - i * 2, J.lean * 0.5 + 0.2, 0.2, Math.PI - 0.2); stroke(ctx, BL.bronzeD, 1.6, 0.7); }
      // near arm + hammer
      frame(ctx, st, J.hN.x, J.hN.y, J.w);
      sprite(ctx, st, 'bellwether:hammer', 190, 80, 36, 40, hammerArt);
      unframe(ctx, st);
      limb(ctx, J.sN.x, J.sN.y, J.eN.x, J.eN.y, 16, 14, BL.fur, st, 1.2);
      limb(ctx, J.eN.x, J.eN.y, J.hN.x, J.hN.y, 14, 13, BL.bronze, st, 1.2);
      mitt(ctx, J.eN, J.hN, st, BL.bronze, 0.82, BL.fur);
      if (J.two > 0.3) mitt(ctx, J.eF, J.hF, st, shade(BL.bronze, -0.12), 0.78, shade(BL.fur, -0.1));
    },
  });
  function clapperSwing(J, st) { return Math.sin(st.t * 0.0035 + st.seed) * 0.28 - (J.lean - 0.1) * 0.8 + J.ch * Math.sin(st.t * 0.03) * 0.3; }

  return { thornstag, mime, bloomwitch, bellwether };
}
