// Training look: the Training Mannequin, a straw-and-canvas dummy on a pole with a painted target.
// Custom rig: the whole figure rocks around its base pivot; the crossbar arm halves swing.

/**
 * Build the training look definitions with the shared sprite kit.
 * @param {object} K painting kit from sprites.js
 * @returns {Record<string, object>}
 */
export function defineTrainingLooks(K) {
  const { TAU, lerp, hash, shade, paint, paintR, paintAxis, fill, stroke, capsule, ell, circ, poly, blob, line, curve, frame, unframe, pt } = K;
  const PARTY_ALIAS = { flurry: 'thrust', heavy: 'slam', leap: 'charge', buff: 'cast', heal: 'cast', shoot: 'bolt', gradient: 'nova' };
  const DM = { wood: '#8a5a32', woodD: '#4f321c', canvas: '#d8c49a', canvasD: '#a58f66', straw: '#e8c35a', strawD: '#a8822c', rope: '#b99a62',
    red: '#b8352c', white: '#f3ead8', stitch: '#3a2a1c' };
  const FIELDS = ['tilt', 'bx', 'by', 'af', 'ab', 'hd', 'sq', 'ch', 'rel', 'air', 'sx', 'ex'];
  const PIV = 8, BODY_Y = 82, ARM_Y = 100, HEAD_Y = 124, POLE = 146;

  function straw(ctx, x, y, a, n, len, st) {
    for (let i = 0; i < n; i++) {
      const aa = a + (hash(i * 7.1 + x) - 0.5) * 0.9, l = len * (0.6 + hash(i * 3.3 + y) * 0.5);
      line(ctx, x, y, x + Math.cos(aa) * l, y + Math.sin(aa) * l);
      stroke(ctx, i % 2 ? DM.straw : DM.strawD, 1.2, 0.95);
    }
  }

  function sackArt(ctx, st) {
    // body sack, local origin at the body centre
    blob(ctx, [-18, 28, -24, 6, -22, -18, -12, -30, 12, -30, 22, -18, 24, 6, 18, 28, 0, 32]);
    paint(ctx, DM.canvas, 0, 0, 30, st, 1.1, 0.8);
    // patches + seams
    ctx.beginPath(); ctx.rect(-19, 8, 10, 11); paint(ctx, DM.canvasD, -14, 13, 7, st, 0.6, 0.4);
    for (let i = 0; i < 4; i++) { line(ctx, -19 + i * 3, 8, -18 + i * 3, 6); stroke(ctx, DM.stitch, 0.8, 0.8); }
    curve(ctx, -2, -30, -6, 0, -2, 31); stroke(ctx, DM.canvasD, 1.2, 0.7);
    // painted target
    const rings = [[13, DM.red], [10, DM.white], [7, DM.red], [4, DM.white], [2, DM.red]];
    for (const [r, c] of rings) { ell(ctx, 7, -2, r * 0.82, r); paintR(ctx, c, 7, -2, r, st, r === 13 ? 0.6 : 0, 0.4, -0.25, 0.2); }
    // rope ties
    curve(ctx, -21, -20, 0, -15, 21, -20); stroke(ctx, DM.rope, 2.6);
    curve(ctx, -23, 16, 0, 22, 23, 16); stroke(ctx, DM.rope, 2.6);
    straw(ctx, -20, 26, 2.2, 5, 9, st);
    straw(ctx, 16, 28, 1.1, 4, 8, st);
  }

  function headArt(ctx, st) {
    straw(ctx, -4, -13, -1.9, 7, 11, st);
    circ(ctx, 0, 0, 15);
    paintR(ctx, DM.canvas, 0, 0, 15, st, 1.1, 0.85);
    // stitched X eyes + mouth
    for (const [x, y] of [[6, -3], [12, -2]]) { line(ctx, x - 2, y - 2, x + 2, y + 2); stroke(ctx, DM.stitch, 1.3); line(ctx, x + 2, y - 2, x - 2, y + 2); stroke(ctx, DM.stitch, 1.3); }
    curve(ctx, 4, 6, 9, 8.5, 13, 5); stroke(ctx, DM.stitch, 1.1);
    for (let i = 0; i < 4; i++) { line(ctx, 5 + i * 2.5, 5.5 + (i === 1 || i === 2 ? 1.5 : 0), 5.4 + i * 2.5, 8.5 + (i === 1 || i === 2 ? 1 : 0)); stroke(ctx, DM.stitch, 0.7); }
    // neck tie
    poly(ctx, [-6, 13, 6, 13, 8, 19, -8, 19]); paint(ctx, DM.canvasD, 0, 16, 7, st, 0.6, 0.4);
    curve(ctx, -7, 14, 0, 16, 7, 14); stroke(ctx, DM.rope, 2.2);
    curve(ctx, -10, -8, -6, -13, 0, -14); stroke(ctx, '#fff4d8', 1.3, 0.45);
  }

  function baseArt(ctx, st) {
    ctx.beginPath(); ctx.rect(-30, -6, 60, 6); paintAxis(ctx, DM.woodD, -30, -3, 30, -3, 4, st, 1, 0.5);
    ctx.beginPath(); ctx.rect(-8, -9, 16, 9); paint(ctx, DM.wood, 0, -5, 8, st, 1, 0.6);
    for (const x of [-24, 24]) { circ(ctx, x, -3, 1.2); fill(ctx, '#2a1d12'); }
  }

  function toWorld(J, lx, ly, o) {
    const c = Math.cos(J.tilt), s = Math.sin(J.tilt);
    o.x = J.pivot.x + lx * c - ly * s; o.y = J.pivot.y + lx * s + ly * c;
    return o;
  }

  const dummy = K.custom({
    id: 'dummy', name: 'Training Mannequin', kind: 'enemy', height: 150, fields: FIELDS, jumpH: 36, shadowRx: 32, magic: '#ffe39a', fxScale: 0.8,
    defaultVariant: 'slash', variantAlias: PARTY_ALIAS,
    ready: { tilt: 0, bx: 0, by: 0, af: 0.05, ab: 0.05, hd: 0, sq: 0, ch: 0, rel: 0, air: 0, sx: 1, ex: 0 },
    book: {
      guard: { tilt: -0.08, af: -0.3, ab: 0.2 },
      parry: { tilt: -0.12, af: -0.7 },
      dodge: { tilt: -0.45, bx: -12 },
      hurt: { tilt: -0.36, hd: -0.45, af: -0.4, ab: 0.4, sq: 0.1 },
      cast: { g: { tilt: -0.1, af: -0.8, ab: -0.8, hd: -0.2 }, r: { tilt: 0.15, af: 0.3, ab: 0.3 } },
      aimNear: { af: -0.1 }, aimFar: { af: -0.1 },
      ko: { a: { tilt: -0.7, hd: -0.3, af: 0.4 }, b: { tilt: -1.46, hd: -0.5, af: 0.9, ab: -0.4 } },
      victory: { tilt: 0.05, af: -0.9, ab: -0.9, hd: 0.25 },
      jump: { crouch: { sq: 0.14 }, up: { sq: -0.1, af: -0.4, ab: -0.4 }, tuck: { tilt: 0.05 }, land: { sq: 0.2 } },
      carry: {},
      variants: {
        slash: { a: { tilt: -0.3, af: -1.1 }, c: { tilt: 0.35, af: 0.75 }, f: { tilt: 0.3, af: 0.95 } },
        thrust: { a: { tilt: -0.25, bx: -6, af: -0.2 }, c: { tilt: 0.3, bx: 14, af: -0.05 }, f: { tilt: 0.25, bx: 14 } },
        slam: { a: { tilt: -0.45, af: -1.2, ab: -1.2, by: -6 }, c: { tilt: 0.45, af: 0.8, ab: 0.8 }, f: { tilt: 0.42, af: 0.9, ab: 0.9 } },
        bite: { a: { tilt: -0.3, hd: -0.55 }, c: { tilt: 0.4, hd: 0.5 }, f: { tilt: 0.35, hd: 0.3 } },
        spin: {
          a: { tilt: -0.15, af: -0.5, ab: 0.5 }, c: { tilt: 0.22, af: 0.25, ab: -0.25 }, f: { tilt: 0.1 },
          windup: [[0, 'R'], [0.42, 'A', 'outCubic'], [0.8, 'A2'], [0.9, { tilt: 0.1, sx: -1, af: 0.2 }, 'linear'], [1, 'C', 'linear']],
        },
        charge: { a: { tilt: -0.3, bx: -10, sq: 0.12 }, c: { tilt: 0.25, bx: 30 }, f: { tilt: 0.2, bx: 28 } },
        bolt: { a: { tilt: -0.2, af: -0.9 }, c: { tilt: 0.2, af: 0.1 }, f: { tilt: 0.15 }, gather: true },
        wave: { a: { tilt: -0.15, by: -12, af: -0.8, ab: -0.8 }, c: { tilt: 0.1, sq: 0.3, af: 0.6, ab: 0.6 }, f: { sq: 0.15 }, gather: true },
        beam: { a: { tilt: -0.15 }, c: { tilt: 0.15 }, f: { tilt: 0.12 }, gather: true, sustain: true },
        nova: { a: { tilt: 0.1, sq: 0.2, af: 0.8, ab: 0.8 }, c: { tilt: -0.1, sq: -0.15, af: -1, ab: -1 }, f: { af: -0.6, ab: -0.6 }, gather: true },
        cast: { a: { tilt: -0.15, af: -1, hd: -0.2 }, c: { tilt: 0.15, af: 0.2 }, f: { tilt: 0.1 }, gather: true },
      },
    },
    newJ() { return { pivot: pt(), body: pt(), head: pt(), armF: pt(), armB: pt(), top: pt(), target: pt(), tilt: 0, af: 0, ab: 0, hd: 0, sq: 0, ch: 0, rel: 0, sx: 1, air: 0, ex: 0, rootX: 0, P: null }; },
    solve(look, P, J) {
      const f = look.fi;
      J.P = P;
      J.air = P[f.air];
      J.rootX = P[f.bx];
      J.tilt = P[f.tilt]; J.af = P[f.af]; J.ab = P[f.ab]; J.hd = P[f.hd]; J.sq = P[f.sq];
      J.ch = P[f.ch]; J.rel = P[f.rel]; J.sx = P[f.sx]; J.ex = P[f.ex];
      J.pivot.x = P[f.bx]; J.pivot.y = -PIV + P[f.by] - J.air;
      const k = 1 - J.sq * 0.25;
      toWorld(J, 0, -(BODY_Y - PIV) * k, J.body);
      toWorld(J, 7, -(BODY_Y - PIV) * k - 2, J.target);
      toWorld(J, 2, -(HEAD_Y - PIV) * k, J.head);
      toWorld(J, 36 * Math.cos(J.af), -(ARM_Y - PIV) * k + 36 * Math.sin(J.af), J.armF);
      toWorld(J, -36 * Math.cos(J.ab), -(ARM_Y - PIV) * k + 36 * Math.sin(J.ab), J.armB);
      toWorld(J, 0, -(POLE + 4) * k, J.top);
    },
    breathe(look, P, st, amt) { P[look.fi.tilt] += Math.sin(st.t * (TAU / 3300) + st.seed) * 0.025 * amt; P[look.fi.hd] += Math.sin(st.t * (TAU / 2100) + st.seed) * 0.05 * amt; },
    tremble(look, P, st, k) { P[look.fi.tilt] += Math.sin(st.t * 0.08 + st.seed) * 0.02 * k; },
    slump(look, P) { P[look.fi.tilt] -= 0.12; P[look.fi.hd] += 0.4; P[look.fi.af] += 0.5; P[look.fi.ab] += 0.5; },
    locomotion(look, P, run, phase) {
      const f = look.fi;
      P.set(look._carry);
      const hop = Math.abs(Math.sin(phase * Math.PI * 2));
      P[f.by] = -hop * (run ? 12 : 5);
      P[f.tilt] = (run ? 0.12 : 0.04) + Math.sin(phase * TAU * 2) * 0.03;
      P[f.sq] = (1 - hop) * 0.12;
      P[f.af] = 0.2 * Math.sin(phase * TAU); P[f.ab] = -0.2 * Math.sin(phase * TAU);
    },
    anchors(look, J, o) {
      o.head.x = J.head.x; o.head.y = J.head.y;
      o.chest.x = J.target.x; o.chest.y = J.target.y;
      o.weapon.x = J.armF.x; o.weapon.y = J.armF.y;
      o.feet.x = J.pivot.x; o.feet.y = 0;
      o.top.x = J.top.x; o.top.y = J.top.y;
      o.center.x = J.body.x; o.center.y = J.body.y;
      o.tip.x = J.armF.x; o.tip.y = J.armF.y;
    },
    bounds(look, J, o) {
      o[0] = Math.min(J.body.x, J.head.x) - 26; o[2] = Math.max(J.body.x, J.head.x) + 26;
      o[1] = Math.min(J.head.y, J.body.y) - 16; o[3] = Math.max(J.body.y + 34, J.pivot.y);
    },
    extent(look, J, o) {
      o[0] = Math.min(J.pivot.x - 34, J.top.x - 30, J.armB.x - 20, J.armF.x - 20); o[2] = Math.max(J.pivot.x + 34, J.top.x + 30, J.armF.x + 20, J.armB.x + 20);
      o[1] = Math.min(J.top.y, J.armF.y, J.armB.y) - 30; o[3] = 6;
    },
    castPoint(J, o) { o.x = J.target.x; o.y = J.target.y; },
    trailPts(J, o) { o[0] = J.armF.x; o[1] = J.armF.y; o[2] = lerp(J.body.x, J.armF.x, 0.5); o[3] = lerp(J.body.y, J.armF.y, 0.5); },
    weak: [{ id: 'target', r: 15, at(J, o) { o.x = J.target.x; o.y = J.target.y; } }],
    portrait: { abs: false, x: 0, y: 10, r: 30, bg: ['#b98a6a', '#2a1e16'] },
    draw(ctx, J, st) {
      const k = 1 - J.sq * 0.25;
      // base (stays on the ground; lifts with jumps)
      frame(ctx, st, J.pivot.x, J.pivot.y + PIV, 0);
      K.sprite(ctx, st, 'dummy:base', 66, 14, 33, 11, baseArt);
      unframe(ctx, st);
      frame(ctx, st, J.pivot.x, J.pivot.y, J.tilt, 1, k);
      // pole
      capsule(ctx, 0, 0, 0, -POLE, 3.4, 3);
      paintAxis(ctx, DM.wood, 0, 0, 0, -POLE, 3.4, st, 1, 0.6);
      // back arm half
      frame(ctx, st, 0, -(ARM_Y - PIV), Math.PI - J.ab);
      armHalf(ctx, st, true);
      unframe(ctx, st);
      // sack body
      frame(ctx, st, 0, -(BODY_Y - PIV), 0);
      K.sprite(ctx, st, 'dummy:sack', 56, 72, 28, 36, sackArt);
      if (J.ch > 0.01 && !st.ghost) K.glow(ctx, 7, -2, 16 + J.ch * 14, '#ffd27a', 0.5 * J.ch);
      unframe(ctx, st);
      // front arm half
      frame(ctx, st, 0, -(ARM_Y - PIV), J.af);
      armHalf(ctx, st, false);
      unframe(ctx, st);
      // head
      frame(ctx, st, 2, -(HEAD_Y - PIV), J.hd);
      K.sprite(ctx, st, 'dummy:head', 44, 50, 20, 30, headArt);
      unframe(ctx, st);
      unframe(ctx, st);
    },
  });

  function armHalf(ctx, st, back) {
    const c = back ? shade(DM.wood, -0.25) : DM.wood;
    capsule(ctx, 0, 0, 36, 0, 2.6, 2.4);
    paintAxis(ctx, c, 0, 0, 36, 0, 2.6, st, 0.9, 0.5);
    ell(ctx, 30, 0, 5, 4); paint(ctx, back ? shade(DM.canvas, -0.2) : DM.canvas, 30, 0, 5, st, 0.8, 0.5);
    line(ctx, 27, -3.5, 27, 3.5); stroke(ctx, DM.rope, 1.6);
    straw(ctx, 35, 0, 0, 6, 9, st);
  }

  return { dummy };
}
