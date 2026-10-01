#!/usr/bin/env node
// Headless end-to-end playthrough of Expedition 69 over tools/cdp.mjs: boots the real index.html, plays the
// prologue with real keys (title gate, credits, settings, New Game, intro, walking the shore, the tutorial battle,
// pause menu, pennant rest/save, shop, a defeat → game over → Rise Again), samples autopilot battles in every zone,
// fights all three bosses through the world (the Stillkeeper's phase change and its dialogue asserted), watches the
// ending and credits back to the title, then tests Continue, Quit to Title and the Training Grounds, checks the
// stage scaling and screenshots the game at several window sizes, plays a phone-sized session with touch only
// (world Menu button, battle menus with every skill disabled, Back / Pause / Done controls, the tab hidden in the
// middle of an enemy attack) and finally picks Veteran for a New Game and Story in Settings (recovery rule checked).
//
//   node tools/e2e.mjs [--out DIR] [--port N] [--phases a,b,…] [--reuse] [--warp N] [--retries N] [--gpu] [--headful] [--verbose]
//
// Each phase starts from a fresh page load and a save-game checkpoint (localStorage), so a phase that hits a
// headless-Chrome stall is retried in a new browser from the same checkpoint. Page exceptions, scene errors caught
// by the engine and console errors/warnings are never retried: they fail the run. Exit code 0 = all phases passed.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launch, sleep } from './cdp.mjs';
import { serve } from './serve.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SAVE_KEY = 'exp69.save.v1';
const SETTINGS_KEY = 'exp69.settings.v1';

// ------------------------------------------------------------------ CLI

const PHASES = ['prologue', 'zones', 'bosses', 'epilogue', 'viewports', 'touch', 'difficulty'];

function parseArgs(argv) {
  const o = {
    out: process.env.E2E_OUT || path.join(os.tmpdir(), 'exp69-e2e'),
    port: 0,
    phases: PHASES,
    warp: 1,
    retries: 1,
    reuse: false,
    gpu: false,
    headful: false,
    verbose: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`Missing value for ${a}`);
      return v;
    };
    if (a === '--out') o.out = path.resolve(val());
    else if (a === '--port') o.port = Number(val());
    else if (a === '--phases') o.phases = val().split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--warp') o.warp = Math.max(1, Math.min(4, Number(val()) || 1));
    else if (a === '--retries') o.retries = Math.max(0, Math.floor(Number(val()) || 0));
    else if (a === '--reuse') o.reuse = true;
    else if (a === '--gpu') o.gpu = true;
    else if (a === '--headful') o.headful = true;
    else if (a === '--verbose' || a === '-v') o.verbose = true;
    else if (a === '--help' || a === '-h') o.help = true;
    else throw new Error(`Unknown argument: ${a}`);
  }
  for (const p of o.phases) if (!PHASES.includes(p)) throw new Error(`Unknown phase "${p}" (phases: ${PHASES.join(', ')})`);
  return o;
}

const USAGE = `Usage: node tools/e2e.mjs [options]
  --out DIR        screenshot + report directory (default $E2E_OUT or <tmp>/exp69-e2e)
  --port N         static server port (default: a free port)
  --phases LIST    comma list of ${PHASES.join(',')} (default: all, in order; later phases
                   reuse the checkpoint of earlier ones, or build one when run alone)
  --reuse          start a requested phase from the checkpoint its predecessor saved in --out
                   by an earlier run, instead of replaying the predecessors
  --warp N         run the page clock N× faster (1–4, default 1 = real time)
  --retries N      retries per phase after a harness stall (default 1)
  --gpu            let headless Chrome use the GPU (default: software raster)
  --headful        show the browser window
  --verbose        stream the page console`;

// ------------------------------------------------------------------ timeline & failures

const T0 = Date.now();
const timeline = [];
let OPTS = null;

function stamp() {
  return `${((Date.now() - T0) / 1000).toFixed(1).padStart(6)}s`;
}

function log(phase, msg) {
  const line = `[${stamp()}] ${phase.padEnd(9)} ${msg}`;
  console.log(line);
  timeline.push(line);
}

/** A failure that a retry cannot fix (a real bug in the game). */
class GameError extends Error {}

// ------------------------------------------------------------------ the page session

class Session {
  constructor(url, phase) {
    this.url = url;
    this.phase = phase;
    this.browser = null;
    this.page = null;
    this.shots = [];
    this.held = new Set();
    this.consoleSeen = 0;
    this.errorsSeen = 0;
    this.issues = [];
  }

  async open({ width = 1280, height = 720, touch = false } = {}) {
    this.browser = await launch({ width, height, headless: !OPTS.headful, gpu: OPTS.gpu, timeout: 30000 });
    this.page = this.browser.page;
    if (touch) {
      // A phone: mobile metrics plus touch emulation, so (pointer: coarse) matches and taps arrive as touch events.
      await this.page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: true });
      await this.page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
      this.page._touch = true;
    }
    this.page.on('console', (m) => {
      if (OPTS.verbose) console.log(`    [console.${m.type}] ${m.text}`);
    });
    if (OPTS.warp > 1) {
      // Scale performance.now / rAF / event timestamps together so the game clock and the input clock agree.
      await this.page.send('Page.addScriptToEvaluateOnNewDocument', {
        source: `(() => {
          const W = ${OPTS.warp}; const perf = window.performance; const real = perf.now.bind(perf); const t0 = real();
          const warped = (t) => t0 + (t - t0) * W;
          perf.now = () => warped(real());
          const raf = window.requestAnimationFrame.bind(window);
          window.requestAnimationFrame = (cb) => raf((t) => cb(warped(t)));
          const d = Object.getOwnPropertyDescriptor(Event.prototype, 'timeStamp');
          Object.defineProperty(Event.prototype, 'timeStamp', { configurable: true, get() { return warped(d.get.call(this)); } });
        })();`,
      });
    }
    return this;
  }

  async close() {
    try {
      await this.releaseAll();
    } catch {
      /* browser may be gone */
    }
    await this.browser?.close();
    this.browser = null;
    this.page = null;
  }

  /** Load index.html with localStorage holding exactly this checkpoint (or nothing), seeded before any page script. */
  async boot({ save = null, settings = null, query = '' } = {}) {
    const page = this.page;
    const seed = `(() => { try { localStorage.clear(); const s = ${JSON.stringify(save)}; const st = ${JSON.stringify(settings)};
      if (s) localStorage.setItem(${JSON.stringify(SAVE_KEY)}, s); if (st) localStorage.setItem(${JSON.stringify(SETTINGS_KEY)}, st); } catch (e) {} })();`;
    const { identifier } = await page.send('Page.addScriptToEvaluateOnNewDocument', { source: seed });
    try {
      await page.goto(`${this.url}index.html${query}`);
    } finally {
      await page.send('Page.removeScriptToEvaluateOnNewDocument', { identifier });
    }
    await this.waitFor('window.__game && window.__game.scenes && window.__game.scenes.size > 0', 20000, 'boot');
    await page.eval(INSTALL_HELPERS);
  }

  // ---- evaluation / waiting

  eval(expr, ...args) {
    return this.page.eval(expr, ...args);
  }

  async waitFor(expr, timeoutMs, what) {
    try {
      return await this.page.waitFor(expr, timeoutMs, { interval: 60 });
    } catch (err) {
      const e = new Error(`timed out waiting for ${what ?? expr} (${timeoutMs} ms)`);
      e.cause = err;
      throw e;
    }
  }

  top() {
    return this.eval('__e2e.top()');
  }

  // ---- input

  async press(code, holdMs = 45) {
    await this.page.press(code, { holdMs });
  }

  async hold(code) {
    if (this.held.has(code)) return;
    this.held.add(code);
    await this.page.keyDown(code);
  }

  async release(code) {
    if (!this.held.has(code)) return;
    this.held.delete(code);
    await this.page.keyUp(code);
  }

  async releaseAll() {
    for (const c of [...this.held]) await this.release(c);
  }

  /** Click the centre of the first element matching `selector` whose text includes `text` (viewport px). */
  async click(selector, text = null) {
    const r = await this.eval((sel, txt) => {
      const els = [...document.querySelectorAll(sel)].filter((e) => !txt || e.textContent.includes(txt));
      const e = els.find((x) => x.getBoundingClientRect().width > 0);
      if (!e) return null;
      const b = e.getBoundingClientRect();
      return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
    }, selector, text);
    if (!r) throw new Error(`nothing to click: ${selector}${text ? ` "${text}"` : ''}`);
    await this.page.click(r.x, r.y);
    return r;
  }

  /** Touch-tap the centre of the first visible element matching `selector` (optionally containing `text`). */
  async tap(selector, text = null) {
    const r = await this.eval((sel, txt) => {
      const els = [...document.querySelectorAll(sel)].filter((e) => !txt || e.textContent.includes(txt));
      const e = els.find((x) => x.getBoundingClientRect().width > 0);
      if (!e) return null;
      const b = e.getBoundingClientRect();
      return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
    }, selector, text);
    if (!r) throw new GameError(`nothing to tap: ${selector}${text ? ` "${text}"` : ''}`);
    await this.page.tap(r.x, r.y);
    return r;
  }

  // ---- screenshots

  async shot(name) {
    const file = path.join(OPTS.out, `${String(this.shots.length + 1 + SHOT_BASE[this.phase]).padStart(3, '0')}-${this.phase}-${name}.png`);
    try {
      await this.page.screenshot(file);
      this.shots.push(file);
    } catch (err) {
      log(this.phase, `  (screenshot ${name} failed: ${err.message})`);
    }
    return file;
  }

  // ---- health

  /** New page exceptions, engine-caught scene errors and console errors/warnings since the last check. */
  async health() {
    const page = this.page;
    const out = [];
    for (const e of page.errors.slice(this.errorsSeen)) out.push(`page exception: ${e.message.split('\n')[0]}`);
    this.errorsSeen = page.errors.length;
    for (const m of page.consoleMessages.slice(this.consoleSeen)) {
      if (/^(error|warning|assert)$|^log\.(error|warning)$/.test(m.type)) out.push(`console.${m.type}: ${m.text.split('\n')[0]}`);
    }
    this.consoleSeen = page.consoleMessages.length;
    let engine = [];
    try {
      engine = await this.eval('(__game.errors || []).splice(0).map((e) => `${e.scene}/${e.phase}: ${e.message}`)');
    } catch {
      /* page gone */
    }
    for (const e of engine) out.push(`scene error: ${e}`);
    this.issues.push(...out);
    return out;
  }

  async assertHealthy(where) {
    const bad = await this.health();
    if (bad.length) throw new GameError(`${where}: ${bad.length} problem(s)\n      ${bad.join('\n      ')}`);
  }
}

const SHOT_BASE = { prologue: 0, zones: 100, bosses: 200, epilogue: 300, viewports: 400, touch: 500, difficulty: 600 };

// Installed into the page after every boot: small read-only probes the driver polls.
const INSTALL_HELPERS = `(() => {
  const G = () => window.__game;
  window.__e2e = {
    top() { const s = G().scenes.top; return s ? s.name : null; },
    stack() { return G().scenes.names(); },
    busy() { return !!G().fading; },
    world() {
      const w = G().debug.world;
      if (!w || !w.party) return null;
      const i = w.debugInfo();
      return { zone: i.zone, mode: i.mode, x: i.x, y: i.y, target: i.target, enemies: i.enemies, bosses: i.bosses, exits: i.exits };
    },
    battle() {
      const b = G().debug.battle;
      if (!b) return null;
      const s = b.state();
      return { mode: s.mode, modal: s.modal, hint: s.hint, menu: s.menu, outcome: s.outcome, round: s.round, finished: s.finished,
        enemies: s.enemies, party: s.party, stats: s.stats, errors: s.errors, enemyRun: s.enemyRun };
    },
    state() {
      const st = G().state;
      if (!st) return null;
      return { zone: st.world.zone, x: st.world.x, y: st.world.y, glint: st.glint, story: { ...st.world.story },
        defeated: Object.keys(st.world.defeated || {}), bosses: Object.keys(st.world.bosses || {}),
        flags: Object.keys(st.world.flagsVisited || {}), lastFlag: st.world.lastFlag,
        party: st.party.map((m) => ({ id: m.id, level: m.level, hp: m.hp, alive: m.alive })),
        items: Object.fromEntries(Object.entries(st.items).map(([k, v]) => [k, v.count])), stats: { ...st.stats } };
    },
    /** Direction toward tile (gx, gy) along a BFS path over the world map (4-connected). */
    step(gx, gy, near) {
      const top = window.__e2e.top();
      if (G().scenes.has('battle')) return { battle: true, top };
      if (top !== 'world') return { covered: true, top };
      const w = G().debug.world;
      if (!w || !w.party || !w.map) return { err: 'no world' };
      const map = w.map; const T = 40; const W = map.w;
      const px = w.party.x; const py = w.party.y;
      const ptx = Math.floor(px / T); const pty = Math.floor(py / T);
      const key = w.zone + ':' + gx + ':' + gy;
      let c = window.__e2eFlow;
      if (!c || c.key !== key || performance.now() - c.t > 1500) {
        const dist = map.bfs(gx, gy, { passable: (x, y) => (x === gx && y === gy) || map.isWalkable(x, y) });
        c = window.__e2eFlow = { key, dist, t: performance.now() };
      }
      const gcx = (gx + 0.5) * T; const gcy = (gy + 0.6) * T;
      const toGoal = Math.hypot(gcx - px, gcy - py);
      if (toGoal <= (near ?? 12)) return { done: true, px, py, tile: [ptx, pty] };
      const here = c.dist[pty * W + ptx];
      let best = null;
      for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = ptx + ox; const ny = pty + oy;
        if (!map.inBounds(nx, ny)) continue;
        const v = c.dist[ny * W + nx];
        if (v < 0) continue;
        if (!best || v < best.v) best = { v, nx, ny };
      }
      let tx = gcx; let ty = gcy;
      if (here > 0 && best && best.v < here) {
        tx = (best.nx + 0.5) * T; ty = (best.ny + 0.6) * T;
      } else if (here !== 0 && (!best || here < 0)) {
        return { dx: gcx - px, dy: gcy - py, lost: true, px, py, tile: [ptx, pty] };
      }
      return { dx: tx - px, dy: ty - py, px, py, tile: [ptx, pty], here, toGoal };
    },
  };
  return true;
})()`;

// ------------------------------------------------------------------ reusable steps

/** Advance any dialogue on top (confirm) until `until()` (page expression) holds. */
async function driveDialogues(s, until, timeoutMs, what) {
  const deadline = Date.now() + timeoutMs;
  let lines = 0;
  for (;;) {
    const r = await s.eval(`(() => ({ top: __e2e.top(), done: !!(${until}) }))()`);
    if (r.done) return lines;
    if (r.top === 'dialogue') {
      await s.press('Enter');
      lines += 1;
      await sleep(160);
    } else await sleep(120);
    if (Date.now() > deadline) throw new Error(`timed out: ${what ?? until}`);
  }
}

/** Wait until the world is on top, playable and not fading (advancing dialogues on the way). */
async function settleWorld(s, timeoutMs = 30000) {
  return driveDialogues(s, `__e2e.top() === 'world' && !__e2e.busy() && __e2e.world() && __e2e.world().mode === 'play'`, timeoutMs, 'world to become playable');
}

/**
 * Walk the party (real arrow keys) to tile (gx, gy); `goal` may be a function returning a fresh [gx, gy] (e.g. a
 * moving enemy). Stops early when `stopExpr` holds. A roaming enemy that catches the party on the way is fought
 * (full autopilot for that battle) and the walk resumes. Returns 'arrived' | 'stopped'.
 */
async function walkTo(s, goal, { stopExpr = null, timeoutMs = 45000, near = 12 } = {}) {
  let deadline = Date.now() + timeoutMs;
  let last = null;
  let stuckSince = Date.now();
  let wiggle = 0;
  try {
    for (;;) {
      if (stopExpr && (await s.eval(stopExpr))) return 'stopped';
      const [gx, gy] = typeof goal === 'function' ? await goal() : goal;
      const r = await s.eval((x, y, n) => window.__e2e.step(x, y, n), gx, gy, near);
      if (r.battle) {
        const t = Date.now();
        await fightIfCaught(s);
        deadline += Date.now() - t;
        last = null;
        stuckSince = Date.now();
        continue;
      }
      if (r.covered) {
        await s.releaseAll();
        if (stopExpr && (await s.eval(stopExpr))) return 'stopped';
        await settleWorld(s);
        continue;
      }
      if (r.err) {
        await s.releaseAll();
        if (stopExpr && (await s.eval(stopExpr))) return 'stopped';
        throw new Error(`walk: ${r.err}`);
      }
      if (r.done) return 'arrived';
      let { dx, dy } = r;
      if (last && Math.hypot(r.px - last.px, r.py - last.py) > 3) {
        stuckSince = Date.now();
        last = r;
      } else if (!last) last = r;
      if (Date.now() - stuckSince > 1400) {
        wiggle = 6;
        stuckSince = Date.now();
        last = null;
      }
      if (wiggle > 0) {
        wiggle -= 1;
        const a = (wiggle % 2 ? 1 : -1) * Math.PI / 2 + Math.atan2(dy, dx);
        dx = Math.cos(a) * 40;
        dy = Math.sin(a) * 40;
      }
      const want = new Set();
      if (dx > 5) want.add('ArrowRight');
      else if (dx < -5) want.add('ArrowLeft');
      if (dy > 5) want.add('ArrowDown');
      else if (dy < -5) want.add('ArrowUp');
      if (r.toGoal < 44 && !r.lost && wiggle === 0) {
        // Fine approach: short pulses, then let the walker settle, so we stop on the tile instead of sliding past.
        await s.releaseAll();
        for (const k of want) await s.hold(k);
        await sleep(Math.max(35, Math.min(110, (r.toGoal / 160) * 1000 * 0.55)));
        await s.releaseAll();
        await sleep(90);
        continue;
      }
      for (const k of [...s.held]) if (!want.has(k)) await s.release(k);
      for (const k of want) await s.hold(k);
      await sleep(70);
      if (Date.now() > deadline) throw new Error(`walk to ${gx},${gy} timed out at tile ${r.tile}`);
    }
  } finally {
    await s.releaseAll();
  }
}

/** Tap a direction so the leader faces it (a short press barely moves). */
async function face(s, dir) {
  const code = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' }[dir];
  await s.press(code, 60);
  await sleep(120);
}

/** If a roaming enemy has just caught the party (battle transition or battle), fight it on autopilot. */
async function fightIfCaught(s) {
  const caught = await s.eval(`__e2e.stack().includes('battle') || (__e2e.world() && ['transition', 'battle'].includes(__e2e.world().mode))`);
  if (!caught) return false;
  await s.releaseAll();
  const prev = await s.eval('JSON.stringify(__game.debug.autopilot)');
  await s.eval('__game.debug.setAutopilot(true)');
  const fight = await runBattle(s, `${s.phase}-ambush`, { shots: false });
  await s.eval((a) => { __game.debug.autopilot = JSON.parse(a); return true; }, prev);
  await settleWorld(s);
  log(s.phase, `  (caught by a roaming enemy: ${fight.outcome})`);
  return true;
}

/**
 * Walk to the tile `stand`, face `dir` and interact (confirm) with the expected `type` (and `id`). A roaming enemy
 * that catches the party at the last moment is fought first and the approach repeated.
 */
async function approach(s, stand, dir, type, id = null) {
  let seen = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    await walkTo(s, stand, { timeoutMs: 45000 });
    await face(s, dir);
    if (await fightIfCaught(s)) continue;
    const w = await s.eval('__e2e.world()');
    seen = w ?? {};
    seen.probe = await s.eval((ty, i) => {
      const ws = __game.debug.world;
      const p = ws?.party;
      const t = ws?.things?.find((x) => x.type === ty && (!i || x.id === i));
      return { fading: !!__game.fading, stack: __e2e.stack(), facing: p?.facingName,
        thing: t ? { d: +Math.hypot(p.x - t.focus.x, p.y - t.focus.y).toFixed(1), reach: t.reach, prompt: !!t.prompt() } : null };
    }, type, id);
    if (w?.mode === 'play' && w.target?.type === type && (!id || w.target.id === id)) {
      await s.press('Enter');
      await sleep(150);
      // A roaming enemy can catch the party right after an instant interaction (a chest opens without pausing the
      // field): the interaction still happened, so only repeat the approach if the thing still offers its prompt.
      if (await fightIfCaught(s)) {
        const pending = await s.eval((ty, i) => {
          const t = __game.debug.world?.things?.find((x) => x.type === ty && (!i || x.id === i));
          return !!t && !!t.prompt();
        }, type, id);
        if (pending) continue;
      }
      return;
    }
    await sleep(250);
  }
  throw new Error(`expected to face ${type}${id ? ` ${id}` : ''} from ${stand}, facing ${JSON.stringify(seen?.target)} at ${seen?.x?.toFixed(2)},${seen?.y?.toFixed(2)} (mode ${seen?.mode}, ${JSON.stringify(seen?.probe)})`);
}

/**
 * Wait for a battle that is starting or running to end, advancing any dialogue it opens (and, with `manual`, playing
 * plain Attacks through the keyboard menus). Returns {outcome, maxPhase, dialogues, rounds, secs, last}.
 * Screenshots: one mid-fight (during an enemy attack), each mid-battle dialogue and the results panel.
 */
async function runBattle(s, label, { timeoutMs = 240000, shots = true, drive = true, manual = false } = {}) {
  await s.waitFor(`__e2e.top() === 'battle' || (__e2e.stack().includes('battle'))`, 15000, `${label}: battle scene`);
  const t0 = Date.now();
  let maxPhase = 0;
  let midShot = false;
  let resultShot = false;
  let last = null;
  let lastProgress = Date.now();
  let progressKey = '';
  let dialogues = 0;
  let inDialogue = false;
  for (;;) {
    const r = await s.eval(`(() => ({ top: __e2e.top(), has: __e2e.stack().includes('battle'), b: __e2e.battle() }))()`);
    if (r.top === 'dialogue' && !inDialogue) {
      dialogues += 1;
      if (shots) {
        await sleep(700);
        await s.shot(`${label}-dialogue-${dialogues}`);
      }
    }
    inDialogue = r.top === 'dialogue';
    if (!r.has) break;
    const b = r.b;
    if (b) {
      last = b;
      for (const e of b.enemies) maxPhase = Math.max(maxPhase, e.phase || 0);
      const key = `${b.round}|${b.mode}|${b.enemies.map((e) => e.hp).join(',')}|${b.party.map((p) => p.hp).join(',')}|${b.modal}`;
      if (key !== progressKey) {
        progressKey = key;
        lastProgress = Date.now();
      }
      if (shots && !midShot && b.enemyRun && Date.now() - t0 > 2500) {
        midShot = true;
        await s.shot(`${label}-fight`);
      }
      if (shots && !resultShot && b.modal === 'results') {
        resultShot = true;
        await s.shot(`${label}-results`);
      }
    }
    if (drive && r.top === 'dialogue') await s.press('Enter');
    // Manual play: plain Attack on the first target through the keyboard menus (and close any hint).
    if (manual && r.top === 'battle' && b && (b.modal === 'hint' || (b.menu && (b.menu.level === 'root' || b.menu.level === 'target')))) {
      await sleep(250);
      await s.press('Enter');
    }
    if (Date.now() - lastProgress > 60000) throw new Error(`${label}: battle made no progress for 60 s (${JSON.stringify(last)})`);
    if (Date.now() - t0 > timeoutMs) throw new Error(`${label}: battle did not finish in ${timeoutMs / 1000} s`);
    await sleep(r.top === 'dialogue' ? 180 : 150);
  }
  // The last state polled before the scene popped carries the model's outcome (the results screen lasts seconds).
  const outcome = last?.outcome ?? (await s.eval('(__game.debug.lastBattle && __game.debug.lastBattle.outcome) || null'));
  return { outcome, maxPhase, dialogues, rounds: last?.round ?? null, secs: (Date.now() - t0) / 1000, last };
}

/** Wait until a party command menu is open at its root (confirming any hint panel on the way). */
async function battleMenu(s, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const b = await s.eval('__e2e.battle()');
    if (b?.modal === 'hint') {
      await sleep(450);
      await s.press('Enter');
    } else if (b && b.menu?.level === 'root' && !b.modal) return b;
    if (Date.now() > deadline) throw new Error('the command menu never came up');
    await sleep(120);
  }
}

/** Title: open the gate and wait for the menu. */
async function openTitle(s) {
  await s.waitFor(`__e2e.top() === 'title'`, 15000, 'title scene');
  await sleep(400);
  const open = await s.eval(`!!document.querySelector('.title-screen.is-open')`);
  if (!open) {
    await s.press('Enter');
    await s.waitFor(`!!document.querySelector('.title-screen.is-open')`, 5000, 'title menu to open');
  }
  await sleep(350);
}

/** Title → Continue → world. */
async function continueGame(s, phase) {
  await openTitle(s);
  const first = await s.eval(`(document.querySelector('.title-menu .menu-item.is-focused') || {}).textContent || ''`);
  if (!/Continue/.test(first)) throw new GameError(`Continue should be the focused title entry with a save present (focused: "${first.trim()}")`);
  await s.press('Enter');
  await s.waitFor(`__e2e.top() === 'world' && __e2e.world()`, 15000, 'world after Continue');
  await settleWorld(s);
  const st = await s.eval('__e2e.state()');
  log(phase, `continued the expedition in ${st.zone} (party Lv ${st.party.map((m) => m.level).join('/')})`);
}

/** Save the in-memory expedition and read the checkpoint back out of localStorage. */
async function checkpoint(s) {
  return s.eval((k1, k2) => {
    window.__game.debug.save();
    return { save: localStorage.getItem(k1), settings: localStorage.getItem(k2) };
  }, SAVE_KEY, SETTINGS_KEY);
}

function expect(cond, msg) {
  if (!cond) throw new GameError(msg);
}

// ------------------------------------------------------------------ phase A: prologue

async function phasePrologue(s) {
  const P = 'prologue';
  await s.boot();
  await s.waitFor(`__e2e.top() === 'title'`, 15000, 'title');
  await sleep(900);
  await s.assertHealthy('boot');
  log(P, 'booted index.html → title (0 errors, 0 warnings)');
  await s.shot('title-gate');
  await s.press('Enter');
  await s.waitFor(`!!document.querySelector('.title-screen.is-open')`, 5000, 'title menu');
  await sleep(500);
  const items = await s.eval(`[...document.querySelectorAll('.title-menu .menu-item')].map((e) => e.textContent.trim())`);
  expect(!items.some((t) => /Continue/.test(t)), `a fresh profile must not offer Continue (${items.join(' | ')})`);
  log(P, `"press any key" opened the menu: ${items.map((t) => t.split(/\s{2,}/)[0]).join(' · ')}`);
  await s.shot('title-menu');

  // Credits modal (mouse) and settings (keyboard) from the title.
  await s.click('.title-menu .menu-item', 'Credits');
  await s.waitFor(`!!document.querySelector('.credits-modal')`, 3000, 'credits');
  await sleep(300);
  await s.shot('credits');
  await s.press('Escape');
  await s.waitFor(`!document.querySelector('.credits-modal')`, 3000, 'credits to close');
  await s.click('.title-menu .menu-item', 'Settings');
  await s.waitFor(`__e2e.top() === 'settings'`, 3000, 'settings');
  await sleep(500);
  await s.shot('settings');
  await s.press('Escape');
  await s.waitFor(`__e2e.top() === 'title'`, 3000, 'back to title');
  log(P, 'credits modal (mouse) and settings (Esc back) work from the title');

  // New Game → difficulty → intro.
  await sleep(300);
  await s.eval(`(() => { const m = [...document.querySelectorAll('.title-menu .menu-item')]; return m.findIndex((e) => e.classList.contains('is-focused')); })()`);
  // Move focus back to New Game with the keyboard.
  for (let i = 0; i < 6; i++) {
    const f = await s.eval(`(document.querySelector('.title-menu .menu-item.is-focused') || {}).textContent || ''`);
    if (/New Game/.test(f)) break;
    await s.press('ArrowUp');
    await sleep(120);
  }
  await s.press('Enter');
  await s.waitFor(`!!document.querySelector('.difficulty-modal')`, 4000, 'difficulty picker');
  await sleep(450);
  await s.shot('difficulty');
  await s.press('Enter');
  await s.waitFor(`__e2e.top() === 'intro'`, 8000, 'intro');
  const diff = await s.eval('__game.settings.difficulty');
  log(P, `New Game → difficulty "${diff}" → intro`);
  let presses = 0;
  let introShots = 0;
  const introDeadline = Date.now() + 90000;
  while ((await s.top()) === 'intro') {
    await sleep(700);
    if (introShots < 2 && presses % 4 === 1) {
      introShots += 1;
      await s.shot(`intro-${introShots}`);
    }
    await s.press('Enter');
    presses += 1;
    if (Date.now() > introDeadline) throw new Error('intro did not finish');
  }
  await s.waitFor(`__e2e.top() === 'world' || __e2e.top() === 'dialogue'`, 10000, 'world after intro');
  log(P, `intro advanced with ${presses} confirm presses → world`);

  // Shore arrival.
  await s.waitFor(`__e2e.top() === 'dialogue'`, 12000, 'shore arrival dialogue');
  await sleep(900);
  await s.shot('arrival-dialogue');
  const lines = await settleWorld(s, 60000);
  let st = await s.eval('__e2e.state()');
  expect(st.story.shore_arrival, 'shore_arrival not recorded');
  log(P, `shore arrival dialogue advanced (${lines} presses); world playable at ${st.x.toFixed(1)},${st.y.toFixed(1)}`);
  await sleep(600);
  await s.shot('shore-start');

  // Walk to the tutorial Driftling and let it (or a swing) start the tutorial battle.
  await s.eval('__game.debug.setAutopilot(true)');
  const tut = await s.eval(`(__e2e.world().enemies.find((e) => e.encounter === 'tutorial_driftling') || null)`);
  expect(tut, 'no tutorial Driftling on the shore');
  const res = await walkTo(s, async () => {
    const w = await s.eval('__e2e.world()');
    const e = w?.enemies.find((x) => x.id === tut.id);
    return e ? [Math.floor(e.x), Math.floor(e.y)] : [15, 15];
  }, { stopExpr: `__e2e.top() !== 'world' || __e2e.world().mode !== 'play'`, near: 30, timeoutMs: 40000 });
  if (res === 'arrived') {
    // Close enough: strike first.
    await s.press('Enter');
  }
  const b1 = await runBattle(s, 'tutorial');
  await settleWorld(s);
  st = await s.eval('__e2e.state()');
  expect(b1.outcome === 'victory', `tutorial battle outcome ${b1.outcome}`);
  expect(st.story.tutorial_done, 'tutorial_done not set after the tutorial battle');
  expect(st.defeated.includes(tut.id), `${tut.id} not marked defeated`);
  const hints = await s.eval('Object.keys(__game.state.world.hintsSeen || {})');
  log(P, `walked to the Driftling → tutorial battle won in ${b1.secs.toFixed(0)} s, ${b1.rounds} rounds; hints shown: ${hints.join(', ')}`);
  await s.assertHealthy('tutorial');

  // Pause menu: every tab.
  await sleep(500);
  await s.press('Escape');
  await s.waitFor(`__e2e.top() === 'pause'`, 4000, 'pause menu');
  await sleep(600);
  const tabs = await s.eval(`[...document.querySelectorAll('.pause-screen .tab')].map((e) => e.textContent.trim())`);
  for (let i = 0; i < tabs.length; i++) {
    await s.shot(`pause-${i + 1}-${tabs[i].toLowerCase().replace(/[^a-z]+/g, '-')}`);
    if (i < tabs.length - 1) {
      await s.press('KeyE');
      await sleep(450);
    }
  }
  await s.press('Escape');
  await s.waitFor(`__e2e.top() === 'world'`, 4000, 'pause to close');
  log(P, `pause menu tabs browsed with E: ${tabs.join(' · ')}`);

  // First Expedition Pennant (a 'flag' entity): dialogue, rest, save, leave.
  await settleWorld(s);
  const flag = { x: 20, y: 19 };
  await approach(s, [flag.x, flag.y + 1], 'up', 'flag', 'shore_camp_flag');
  await driveDialogues(s, `__e2e.top() === 'flag'`, 30000, 'pennant menu');
  await sleep(700);
  await s.shot('pennant-menu');
  await s.eval('__game.debug.healParty(0.35)');
  const hpBefore = (await s.eval('__e2e.state()')).party.map((m) => m.hp);
  await s.click('.flag-screen .menu-item', 'Rest');
  await sleep(900);
  await s.shot('pennant-rest');
  await s.waitFor(`!document.querySelector('.flag-screen.is-resting')`, 6000, 'rest to finish');
  st = await s.eval('__e2e.state()');
  const saved = await s.eval((k) => !!localStorage.getItem(k), SAVE_KEY);
  expect(st.party.every((m, i) => m.hp > hpBefore[i]), `rest did not heal (${hpBefore} → ${st.party.map((m) => m.hp)})`);
  expect(saved, 'rest did not save the journal');
  expect(st.lastFlag?.flagId === 'shore_camp_flag', 'lastFlag not set by resting');
  await s.click('.flag-screen .menu-item', 'Save');
  await sleep(500);
  await s.click('.flag-screen .menu-item', 'Leave');
  await s.waitFor(`__e2e.top() === 'world'`, 4000, 'pennant menu to close');
  log(P, `pennant: first-rest dialogue → Rest healed ${hpBefore.join('/')} → ${st.party.map((m) => m.hp).join('/')} and saved; Save; Leave`);

  // Merchant: greeting, then the shop.
  await settleWorld(s);
  await approach(s, [26, 19], 'up', 'merchant');
  await driveDialogues(s, `__e2e.top() === 'shop'`, 30000, 'shop');
  await sleep(700);
  const keeper = await s.eval(`(document.querySelector('.shop-screen') || document.body).textContent.includes('Pellam Quist')`);
  await s.shot('shop');
  await s.press('Escape');
  await s.waitFor(`__e2e.top() === 'world'`, 4000, 'shop to close');
  expect(keeper, 'the shore shop should name Pellam Quist as keeper (the merchant who greets you)');
  log(P, 'merchant greeting → shop (keeper Pellam Quist) → Esc back to the shore');

  // A map NPC (the Lamplighter), then the Training Mannequin: a practice bout started from the world.
  await settleWorld(s);
  await approach(s, [16, 24], 'up', 'npc', 'lamplighter');
  await s.waitFor(`__e2e.top() === 'dialogue'`, 4000, 'lamplighter dialogue');
  // Non-party speakers get the world's painted NPC bust (npcPortrait), not the monogram stand-in.
  await s.waitFor(`!!document.querySelector('.dialogue-screen .dlg-portrait .portrait img, .dialogue-screen .dlg-portrait .monogram')`, 4000, 'speaker portrait');
  await sleep(400);
  const bust = await s.eval(`(() => { const p = document.querySelector('.dialogue-screen .dlg-portrait'); return { img: !!p?.querySelector('.portrait img'), name: ((document.querySelector('.dialogue-screen .dlg-name') || {}).textContent || '').trim() }; })()`);
  expect(/Lamplighter/.test(bust.name) && bust.img, `the Lamplighter should speak first, shown with a painted bust (${JSON.stringify(bust)})`);
  await s.shot('npc-dialogue');
  await settleWorld(s);
  const before = await s.eval('__e2e.state()');
  await s.eval(() => { __game.debug.setAutopilot({ defense: 'perfect', offense: 'perfect', commands: null }); return true; });
  await approach(s, [20, 25], 'up', 'trainer');
  await driveDialogues(s, `__e2e.stack().includes('battle')`, 40000, 'practice bout');
  await battleMenu(s);
  await sleep(300);
  await s.shot('world-training');
  await s.press('Backspace');
  await s.waitFor(`__e2e.top() === 'world'`, 20000, 'back from the practice bout');
  await settleWorld(s);
  let after = await s.eval('__e2e.state()');
  expect(JSON.stringify(after.party) === JSON.stringify(before.party) && after.glint === before.glint, 'a practice bout must not change the party or the purse');
  log(P, 'talked to the Lamplighter (painted NPC bust); trainer greeting → practice bout from the map → Backspace leaves; nothing changed');

  // A chest by the northern lighthouse.
  await approach(s, [12, 7], 'up', 'chest', 'shore_chest_lighthouse');
  await sleep(700);
  await s.shot('chest');
  after = await s.eval('__e2e.state()');
  const chests = await s.eval('Object.keys(__game.state.world.chests || {})');
  expect(chests.includes('shore_chest_lighthouse'), 'chest not recorded as opened');
  const toast = await s.eval(`((document.querySelector('.wv-toast') || {}).innerText || '').trim().split(/\\s*\\n\\s*/).join(' · ')`);
  log(P, `opened the lighthouse chest: "${toast}"`);

  // Flee: walk into a roaming enemy, choose Flee from the command menu with the keyboard (↑ wraps to it).
  const nearest = `(() => { const w = __e2e.world(); const e = w.enemies.filter((x) => x.state !== 'dying').sort((a, b) => Math.hypot(a.x - w.x, a.y - w.y) - Math.hypot(b.x - w.x, b.y - w.y))[0]; return e || null; })()`;
  let target = await s.eval(nearest);
  expect(target, 'no roaming enemy on the shore');
  const chase = async () => {
    const w = await s.eval('__e2e.world()');
    const e = w?.enemies.find((x) => x.id === target.id);
    return e ? [Math.floor(e.x), Math.floor(e.y)] : [Math.floor(target.x), Math.floor(target.y)];
  };
  await walkTo(s, chase, { stopExpr: `__e2e.top() !== 'world' || __e2e.world().mode !== 'play'`, near: 30, timeoutMs: 45000 });
  if ((await s.top()) === 'world') await s.press('Enter');
  await s.waitFor(`__e2e.stack().includes('battle')`, 10000, 'battle to start');
  await battleMenu(s);
  await s.press('ArrowUp');
  await sleep(250);
  const fleeItem = await s.eval(`(document.querySelector('.bt-menu .bt-mi.bt-sel, .bt-menu .bt-mi.bt-focus, .bt-menu .bt-mi[aria-selected="true"]') || {}).textContent || ''`);
  await s.press('Enter');
  const fled = await runBattle(s, 'flee', { shots: false, timeoutMs: 30000 });
  expect(fled.outcome === 'fled', `fleeing should end the battle as "fled" (got ${fled.outcome}; focused "${fleeItem}")`);
  await settleWorld(s);
  const stillThere = await s.eval((id) => __e2e.world().enemies.some((e) => e.id === id), target.id);
  expect(stillThere, 'a fled-from enemy must stay on the map');
  log(P, `fled from ${target.encounter} with ↑ Enter: back on the map, the enemy still roams`);

  // Defeat: a level-1 party at 1 HP that never defends (commands typed by the driver: Attack, Enter, Enter) walks
  // into a roaming enemy → game over → Rise Again.
  await s.eval(() => {
    __game.debug.setAutopilot({ defense: 'none', offense: 'none', commands: null });
    __game.debug.healParty(0);
    return true;
  });
  await sleep(2200); // the post-flee grace period
  target = await s.eval(nearest);
  expect(target, 'no roaming enemy on the shore to lose to');
  await walkTo(s, chase, { stopExpr: `__e2e.top() !== 'world' || __e2e.world().mode !== 'play'`, near: 30, timeoutMs: 45000 });
  if ((await s.top()) === 'world') await s.press('Enter');
  const journal = await s.eval((k) => { const w = JSON.parse(localStorage.getItem(k)).world; return { zone: w.zone, x: w.x, y: w.y }; }, SAVE_KEY);
  const lost = await runBattle(s, 'defeat', { shots: false, manual: true, timeoutMs: 180000 });
  expect(lost.outcome === 'defeat', `the 1-HP party should have lost to ${target.encounter} (outcome ${lost.outcome})`);
  await s.waitFor(`__e2e.top() === 'gameover'`, 15000, 'game over after the defeat');
  await sleep(1800);
  await s.shot('gameover');
  const deaths = (await s.eval('__e2e.state()')).stats.deaths;
  expect(deaths >= 1, 'defeat did not count a death');
  await s.press('Enter');
  await s.waitFor(`__e2e.top() === 'world'`, 15000, 'world after Rise Again');
  await settleWorld(s);
  st = await s.eval('__e2e.state()');
  expect(st.party.every((m) => m.alive && m.hp > 1), 'party should be restored from the journal after Rise Again');
  expect(st.zone === journal.zone && Math.hypot(st.x - journal.x, st.y - journal.y) < 1.01,
    `Rise Again should return to the journal's position ${journal.x},${journal.y} (got ${st.x},${st.y})`);
  log(P, `defeat: 1-HP party lost to ${target.encounter} → game over → Rise Again → back at ${st.zone} ${st.x.toFixed(0)},${st.y.toFixed(0)} from the journal`);
  await s.eval('__game.debug.setAutopilot(true)');
  await s.assertHealthy('prologue');
  return checkpoint(s);
}

// ------------------------------------------------------------------ phase B: zone sampling

const ZONE_PLAN = [
  { zone: 'shore', level: 3, count: 2 },
  { zone: 'thicket', level: 7, count: 2 },
  { zone: 'spire', level: 12, count: 2 },
  { zone: 'summit', level: 15, count: 1 },
];

async function phaseZones(s, cp) {
  const P = 'zones';
  await s.boot(cp);
  await continueGame(s, P);
  await s.eval('__game.debug.setAutopilot(true)');
  for (const plan of ZONE_PLAN) {
    await s.eval((lv) => { __game.debug.setLevel(lv); __game.debug.healParty(1); return true; }, plan.level);
    await s.eval((z) => { __game.debug.gotoZone(z); return true; }, plan.zone);
    await s.waitFor(`__e2e.world() && __e2e.world().zone === ${JSON.stringify(plan.zone)}`, 15000, `${plan.zone} to load`);
    const dlg = await settleWorld(s, 60000);
    await sleep(900);
    await s.shot(`${plan.zone}-world`);
    const encs = await s.eval(async (z) => {
      const m = await import('/src/data/encounters.js');
      return m.encountersInZone(z).map((e) => e.id);
    }, plan.zone);
    expect(encs.length >= 1, `no encounters in ${plan.zone}`);
    // Sample the easiest and the hardest regular encounter of the zone.
    const picks = [...new Set([encs[0], encs[encs.length - 1]])].slice(0, plan.count);
    for (const id of picks) {
      const play0 = await s.eval('__game.state.stats.playTimeMs');
      const wall0 = Date.now();
      await s.eval((e) => { __game.debug.healParty(1); __game.debug.lastBattle = null; __game.debug.startBattle(e); return true; }, id);
      const r = await runBattle(s, `${plan.zone}-${id}`, { shots: id === picks[0] });
      expect(r.outcome === 'victory', `${id}: outcome ${r.outcome}`);
      // The play clock (main.js, the only accumulator) runs through battles too: ≈ the wall time spent in this one.
      const playSecs = ((await s.eval('__game.state.stats.playTimeMs')) - play0) / 1000;
      const wallSecs = ((Date.now() - wall0) / 1000) * OPTS.warp;
      expect(playSecs > wallSecs * 0.8 && playSecs < wallSecs * 1.05 + 1, `${id}: play time +${playSecs.toFixed(1)} s over ${wallSecs.toFixed(1)} s of battle`);
      log(P, `${plan.zone} Lv${plan.level}: ${id} → victory in ${r.secs.toFixed(0)} s (${r.rounds} rounds; play clock +${playSecs.toFixed(0)} s)`);
      await settleWorld(s);
    }
    log(P, `${plan.zone}: arrival${dlg ? ` dialogue (${dlg} presses)` : ''} + ${picks.length} autopilot battle(s) ok`);
    await s.assertHealthy(plan.zone);
  }
  return checkpoint(s);
}

// ------------------------------------------------------------------ phase C: the three bosses and the ending

async function bossFight(s, P, { zone, level, from, boss, dialogues = false }) {
  await s.eval((lv) => { __game.debug.setLevel(lv); __game.debug.healParty(1); return true; }, level);
  await s.eval((z, x, y) => { __game.debug.gotoZone(z, x, y); return true; }, zone, from[0], from[1]);
  await s.waitFor(`__e2e.world() && __e2e.world().zone === ${JSON.stringify(zone)}`, 15000, `${zone} to load`);
  await settleWorld(s, 60000);
  await s.eval((d) => { __game.debug.setAutopilot({ defense: 'perfect', offense: 'perfect', commands: 'auto', dialogues: d }); __game.debug.lastBattle = null; return true; }, dialogues);
  const pos = await s.eval((id) => { const w = __game.debug.world; const b = w.bosses.find((x) => x.id === id); return b ? [Math.floor(b.x / 40), Math.floor(b.y / 40)] : null; }, boss);
  expect(pos, `boss ${boss} is not in ${zone}`);
  // Walk up to it: its proximity trigger starts the pre-battle dialogue.
  await walkTo(s, [pos[0], pos[1] + 2], { stopExpr: `__e2e.top() !== 'world' || __e2e.world().mode !== 'play'`, timeoutMs: 45000 });
  await s.waitFor(`__e2e.top() === 'dialogue'`, 8000, `${boss} pre-battle dialogue`);
  await sleep(800);
  await s.shot(`${boss}-pre`);
  await driveDialogues(s, `__e2e.stack().includes('battle')`, 60000, `${boss} battle to start`);
  const lv = (await s.eval('__e2e.state()')).party.map((m) => m.level).join('/');
  const r = await runBattle(s, boss, { timeoutMs: 300000 });
  expect(r.outcome === 'victory', `${boss}: outcome ${r.outcome}`);
  const st = await s.eval('__e2e.state()');
  expect(st.bosses.includes(boss), `${boss} not recorded as defeated (${st.bosses})`);
  r.level = lv;
  return r;
}

async function phaseBosses(s, cp) {
  const P = 'bosses';
  await s.boot(cp);
  await continueGame(s, P);

  // The Wreck Warden → the way to the thicket opens → walk through it.
  let r = await bossFight(s, P, { zone: 'shore', level: 5, from: [53, 20], boss: 'wreck_warden' });
  await s.waitFor(`__e2e.top() === 'dialogue'`, 10000, 'warden_post');
  await settleWorld(s, 60000);
  let w = await s.eval('__e2e.world()');
  expect(w.exits.find((x) => x.to === 'thicket')?.open, 'the exit to the thicket did not open');
  log(P, `Wreck Warden (party Lv ${r.level}): pre-dialogue → battle won in ${r.secs.toFixed(0)} s (${r.rounds} rounds) → post-dialogue → exit open`);
  await walkTo(s, [63, 18], { stopExpr: `__e2e.world() && __e2e.world().zone === 'thicket'`, near: 4, timeoutMs: 30000 });
  await s.waitFor(`__e2e.world() && __e2e.world().zone === 'thicket'`, 15000, 'walk into the thicket');
  await settleWorld(s);
  log(P, 'walked through the eastern pass → Gilded Thicket');

  r = await bossFight(s, P, { zone: 'thicket', level: 10, from: [52, 10], boss: 'bellwether' });
  await s.waitFor(`__e2e.top() === 'dialogue'`, 10000, 'bellwether_post');
  await settleWorld(s, 60000);
  w = await s.eval('__e2e.world()');
  expect(w.exits.find((x) => x.to === 'spire')?.open, 'the exit to the spire did not open');
  log(P, `Bellwether (party Lv ${r.level}): battle won in ${r.secs.toFixed(0)} s (${r.rounds} rounds) → exit to the Spire open`);
  await walkTo(s, [52, 0], { stopExpr: `__e2e.world() && __e2e.world().zone === 'spire'`, near: 4, timeoutMs: 30000 });
  await s.waitFor(`__e2e.world() && __e2e.world().zone === 'spire'`, 15000, 'walk into the spire');
  await settleWorld(s);
  log(P, 'walked north out of the Bronze Hollow → Meridian Spire');

  // Up the spire to the summit on foot.
  await s.eval((lv) => { __game.debug.setLevel(lv); __game.debug.healParty(1); return true; }, 15);
  await s.eval(() => { __game.debug.world.teleport('spire', 26, 3); return true; });
  await settleWorld(s);
  await walkTo(s, [26, 0], { stopExpr: `__e2e.world() && __e2e.world().zone === 'summit'`, near: 4, timeoutMs: 30000 });
  await s.waitFor(`__e2e.world() && __e2e.world().zone === 'summit'`, 15000, 'walk onto the summit');
  await settleWorld(s, 60000);
  await s.shot('summit-arena');
  log(P, 'climbed from the Meridian Landing onto the Summit');

  // The Stillkeeper (phase-2 dialogue kept on) → post dialogue → ending.
  r = await bossFight(s, P, { zone: 'summit', level: 16, from: [15, 14], boss: 'stillkeeper', dialogues: true });
  expect(r.maxPhase >= 1, 'the Stillkeeper never changed phase');
  expect(r.dialogues >= 1, 'the Stillkeeper phase-2 dialogue never appeared');
  log(P, `Stillkeeper (party Lv ${r.level}): phase change to "Unwound" (phase ${r.maxPhase}) with its mid-battle dialogue, won in ${r.secs.toFixed(0)} s (${r.rounds} rounds)`);
  await driveDialogues(s, `__e2e.top() === 'ending'`, 60000, 'ending scene');
  log(P, 'stillkeeper_post → ending');
  await s.assertHealthy('bosses');

  // Ending slides, then the credits (held confirm fast-forwards), then the final card → title.
  let slides = 0;
  while (await s.eval(`__e2e.top() === 'ending' && !document.querySelector('.credits-roll')`)) {
    await sleep(900);
    if (slides === 1 || slides === 6) await s.shot(`ending-${slides}`);
    await s.press('Enter');
    slides += 1;
    if (slides > 40) throw new Error('ending slides did not finish');
  }
  await sleep(1200);
  await s.shot('credits-roll');
  await s.hold('Enter');
  await s.waitFor(`!!document.querySelector('.ending-final.is-visible')`, 30000, 'credits to roll');
  await s.release('Enter');
  await sleep(2200);
  await s.shot('ending-final');
  await s.press('Enter');
  await s.waitFor(`__e2e.top() === 'title'`, 12000, 'title after the ending');
  const seen = await s.eval((k) => JSON.parse(localStorage.getItem(k)).world.story.ending_seen === true, SAVE_KEY);
  expect(seen, 'ending_seen not saved');
  log(P, `ending: ${slides} slides → credits (held Enter) → final card → title; ending_seen saved`);
  await s.assertHealthy('ending');
  return checkpoint(s);
}

// ------------------------------------------------------------------ phase D: Continue, defeat, training

async function phaseEpilogue(s, cp) {
  const P = 'epilogue';
  await s.boot(cp);
  await continueGame(s, P);
  // After the finale the journal reopens at the summit pennant's camp, not in the arena beside the roaming guards.
  const camp = await s.eval(`(() => { const w = __e2e.world(); const f = __game.debug.world.things.find((t) => t.id === 'summit_flag'); return { zone: w.zone, x: w.x, y: w.y, fx: f ? f.tx : null, fy: f ? f.ty : null }; })()`);
  expect(camp.zone === 'summit' && camp.fx !== null && Math.hypot(camp.x - (camp.fx + 0.5), camp.y - (camp.fy + 1.6)) < 1.2,
    `Continue after the ending should start by the summit pennant (${JSON.stringify(camp)})`);
  await sleep(600);
  await s.shot('continued');

  // Fast travel from the summit's pennant back to Driftwood Camp.
  await approach(s, [12, 21], 'up', 'flag', 'summit_flag');
  await driveDialogues(s, `__e2e.top() === 'flag'`, 20000, 'summit pennant');
  await sleep(500);
  await s.click('.flag-screen .menu-item', 'Fast Travel');
  await s.waitFor(`!!document.querySelector('.travel-panel')`, 3000, 'fast travel list');
  await sleep(400);
  await s.shot('fast-travel');
  await s.click('.travel-panel .menu-item', 'Driftwood Camp');
  await s.waitFor(`__e2e.world() && __e2e.world().zone === 'shore' && __e2e.top() === 'world'`, 15000, 'arrival at Driftwood Camp');
  await settleWorld(s);
  const ft = await s.eval('__e2e.world()');
  expect(Math.hypot(ft.x - 20.5, ft.y - 20.6) < 2, `fast travel should land by the Driftwood Camp pennant (at ${ft.x},${ft.y})`);
  log(P, `summit pennant → Fast Travel → Driftwood Camp (landed at ${ft.x.toFixed(1)},${ft.y.toFixed(1)})`);

  // Pause → System → Quit to Title (mouse on the confirm dialog).
  await s.press('Escape');
  await s.waitFor(`__e2e.top() === 'pause'`, 4000, 'pause');
  await sleep(400);
  await s.click('.pause-screen .tab', 'System');
  await sleep(400);
  await s.click('.pause-screen .menu-item', 'Quit to Title');
  await s.waitFor(`!!document.querySelector('.confirm-modal')`, 3000, 'quit confirm');
  await sleep(300);
  await s.shot('quit-confirm');
  await s.click('.confirm-modal .menu-item', 'Quit');
  await s.waitFor(`__e2e.top() === 'title'`, 8000, 'title after quitting');
  log(P, 'pause → System → Quit to Title (confirm) → title');

  // Training Grounds: a practice bout driven with the keyboard.
  await openTitle(s);
  await s.eval(() => { __game.debug.setAutopilot({ defense: 'perfect', offense: 'perfect', commands: null }); return true; });
  await s.click('.title-menu .menu-item', 'Training Grounds');
  await s.waitFor(`__e2e.top() === 'battle'`, 6000, 'training battle');
  const menuReady = `(() => { const b = __e2e.battle(); if (!b) return false; if (b.modal === 'hint') return 'hint'; return b.menu && b.menu.level === 'root' && !b.modal ? 'menu' : false; })()`;
  const waitMenu = async () => {
    const deadline = Date.now() + 60000;
    for (;;) {
      const v = await s.eval(menuReady);
      if (v === 'menu') return;
      if (v === 'hint') {
        await sleep(500);
        await s.press('Enter');
      }
      if (Date.now() > deadline) throw new Error('practice command menu never came up');
      await sleep(150);
    }
  };
  await waitMenu();
  await sleep(400);
  await s.shot('training-menu');
  await s.press('Enter'); // Attack
  await s.waitFor(`(() => { const b = __e2e.battle(); return b && b.menu && b.menu.level === 'target'; })()`, 4000, 'target select');
  await sleep(300);
  await s.shot('training-target');
  await s.press('Enter'); // on the mannequin
  await waitMenu();
  await sleep(300);
  // Drill (mouse): the mannequin attacks right now; the autopilot defends.
  await s.click('.bt-menu .bt-mi', 'Drill');
  const drillDeadline = Date.now() + 15000;
  let shotDrill = false;
  for (;;) {
    const b = await s.eval('__e2e.battle()');
    if (b?.modal === 'hint') {
      await sleep(500);
      if (!shotDrill) {
        shotDrill = true;
        await s.shot('training-hint');
      }
      await s.press('Enter');
    } else if (b?.enemyRun) break;
    if (Date.now() > drillDeadline) throw new Error('the drill attack never started');
    await sleep(120);
  }
  await sleep(700);
  await s.shot('training-drill');
  await waitMenu();
  await s.press('Backspace'); // leave the bout
  await s.waitFor(`__e2e.top() === 'title'`, 20000, 'title after training');
  const restored = await s.eval('__game.state === null');
  expect(restored, 'the temporary training state leaked into the title');
  log(P, 'Training Grounds: Attack via keyboard, Drill via mouse, Backspace leaves → title (temporary state discarded)');
  await s.assertHealthy('epilogue');
  return checkpoint(s);
}

// ------------------------------------------------------------------ phase E: window sizes

const VIEWPORTS = [[1600, 900], [800, 600], [390, 844], [844, 390]];

async function phaseViewports(s, cp) {
  const P = 'viewports';
  await s.boot(cp);
  const report = [];
  for (const [w, h] of VIEWPORTS) {
    await s.page.setViewport(w, h);
    await s.page.reload();
    await s.waitFor('window.__game && window.__game.scenes.size > 0', 20000, 'boot');
    await s.eval(INSTALL_HELPERS);
    await openTitle(s);
    const geo = await s.eval(`(() => { const r = document.getElementById('stage').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, vw: innerWidth, vh: innerHeight, sx: document.documentElement.scrollWidth, sy: document.documentElement.scrollHeight, canvas: document.getElementById('game').width }; })()`);
    const fits = geo.x >= -0.5 && geo.y >= -0.5 && geo.x + geo.w <= geo.vw + 0.5 && geo.y + geo.h <= geo.vh + 0.5 && geo.sx <= geo.vw + 1 && geo.sy <= geo.vh + 1;
    expect(fits, `${w}×${h}: stage does not fit the window ${JSON.stringify(geo)}`);
    expect(Math.abs(geo.w / geo.h - 16 / 9) < 0.01, `${w}×${h}: stage lost its 16:9 aspect`);
    const hint = await s.eval(`(() => { const e = document.getElementById('rotate-hint'); if (!e) return null; const r = e.getBoundingClientRect(); return { shown: getComputedStyle(e).display !== 'none', top: r.top }; })()`);
    const portrait = w / h <= 0.75;
    expect(hint && hint.shown === portrait, `${w}×${h}: the "turn your device" hint should be ${portrait ? 'shown' : 'hidden'}`);
    expect(!hint.shown || hint.top >= geo.y + geo.h, `${w}×${h}: the rotate hint overlaps the stage`);
    await s.shot(`${w}x${h}-title`);
    await s.press('Enter');
    await s.waitFor(`__e2e.top() === 'world'`, 15000, 'world');
    await settleWorld(s);
    await sleep(700);
    await s.shot(`${w}x${h}-world`);
    await s.press('Escape');
    await s.waitFor(`__e2e.top() === 'pause'`, 4000, 'pause');
    await sleep(500);
    await s.shot(`${w}x${h}-pause`);
    await s.press('Escape');
    await s.waitFor(`__e2e.top() === 'world'`, 4000, 'pause close');
    await s.eval(() => { __game.debug.setAutopilot(true); __game.debug.startBattle('shore_shell_and_drift'); return true; });
    await s.waitFor(`(() => { const b = __e2e.battle(); return b && (b.enemyRun || b.menu); })()`, 20000, 'battle underway');
    await sleep(700);
    await s.shot(`${w}x${h}-battle`);
    await s.eval('__game.debug.winBattle()');
    await s.waitFor(`__e2e.top() === 'world'`, 30000, 'battle to end');
    report.push(`${w}×${h} → stage ${geo.w.toFixed(0)}×${geo.h.toFixed(0)} at ${geo.x.toFixed(0)},${geo.y.toFixed(0)} (backing ${geo.canvas}px)`);
    await s.assertHealthy(`${w}×${h}`);
  }
  log(P, `stage letterboxes correctly: ${report.join('; ')}`);
  return cp;
}

// ------------------------------------------------------------------ phase F: a phone, touch only

/** Viewport (CSS px) of `sel`'s first visible match, or null. */
const rectOf = (s, sel, text = null) => s.eval((q, txt) => {
  const e = [...document.querySelectorAll(q)].find((x) => (!txt || x.textContent.includes(txt)) && x.getBoundingClientRect().width > 0);
  if (!e) return null;
  const b = e.getBoundingClientRect();
  return { x: b.left + b.width / 2, y: b.top + b.height / 2, w: b.width, h: b.height, dis: e.classList.contains('bt-dis') };
}, sel, text);

/** Tappable extent (CSS px, halo included) of `sel` through its centre: probes elementFromPoint outwards. */
const hitSize = (s, sel) => s.eval((q) => {
  const e = [...document.querySelectorAll(q)].find((x) => x.getBoundingClientRect().width > 0);
  if (!e) return null;
  const b = e.getBoundingClientRect();
  const cx = b.left + b.width / 2;
  const cy = b.top + b.height / 2;
  const hits = (x, y) => !!document.elementFromPoint(x, y)?.closest?.(q);
  const reach = (dx, dy) => { let d = 0; while (d < 120 && hits(cx + dx * (d + 1), cy + dy * (d + 1))) d += 1; return d; };
  return { x: cx, y: cy, w: reach(-1, 0) + reach(1, 0) + 1, h: reach(0, -1) + reach(0, 1) + 1, visual: [Math.round(b.width), Math.round(b.height)] };
}, sel);

/** Battle snapshot for the touch checks: menu level, modal, current member and its AP, free aim, runs. */
const touchBattle = (s) => s.eval(`(() => { const b = __e2e.battle(); const d = __game.debug.battle; if (!b || !d) return null; const x = d.state();
  return { mode: b.mode, menu: b.menu, modal: b.modal, current: x.current, ap: (x.party.find((p) => p.id === x.current) || {}).ap,
    freeAim: x.freeAim, partyRun: x.partyRun, enemyRun: x.enemyRun, outcome: b.outcome }; })()`);

/** Wait for the command menu's root, dismissing hint panels by tapping outside them. */
async function touchRoot(s, what, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const b = await touchBattle(s);
    if (b?.modal === 'hint') {
      await sleep(450);
      await s.page.tap(24, 24);
      await sleep(300);
    } else if (b?.menu?.level === 'root' && !b.modal && !b.partyRun && !b.enemyRun) return b;
    if (Date.now() > deadline) throw new GameError(`${what}: the command menu never came up (${JSON.stringify(b)})`);
    await sleep(120);
  }
}

/** Viewport point of an enemy's body centre (camera → 1280×720 stage → CSS px). */
const enemyTapPoint = (s) => s.eval(() => {
  const sc = __game.debug.battle.scene;
  const e = sc.model.living('enemy')[0];
  const b = sc.views.get(e.id).bounds(sc.worldTime);
  const p = sc.camera.toScreen(b.x + b.w / 2, b.y + b.h * 0.55);
  const r = document.getElementById('stage').getBoundingClientRect();
  return { x: r.left + (p.x * r.width) / 1280, y: r.top + (p.y * r.height) / 720, id: e.id };
});

async function phaseTouch(s, cp) {
  const P = 'touch';
  await s.boot(cp);
  // Title: a tap opens the gate, a tap on Continue loads the journal.
  await s.waitFor(`__e2e.top() === 'title'`, 15000, 'title');
  await sleep(700);
  await s.page.tap(640, 300);
  await s.waitFor(`!!document.querySelector('.title-screen.is-open')`, 5000, 'title menu (tap)');
  await sleep(500);
  await s.tap('.title-menu .menu-item', 'Continue');
  await s.waitFor(`__e2e.top() === 'world' && __e2e.world()`, 15000, 'world after tapping Continue');
  await settleWorld(s);
  await sleep(600);
  const dev = await s.eval('__game.input.lastDevice');
  expect(dev === 'touch', `taps should make touch the input device (lastDevice ${dev})`);
  // (The key bar shows on a zone's first arrival; bring it back to read its wording for the touch device.)
  const keys = await s.eval(`(__game.debug.world._showKeys(), [...document.querySelectorAll('.wv-keys > span')].map((e) => e.textContent.trim()).join(' · '))`);
  expect(/Tap/.test(keys) && !/Enter|Space/.test(keys), `the world key bar should use touch wording (got "${keys}")`);
  await s.shot('world');

  // World: the Menu button opens the pause menu; System → Resume closes it again (taps only).
  const menuBtn = await hitSize(s, '.wv-menu');
  expect(menuBtn && menuBtn.w >= 44 && menuBtn.h >= 44, `the world Menu button should be a ≥ 44 px tap target (${JSON.stringify(menuBtn)})`);
  await s.page.tap(menuBtn.x, menuBtn.y);
  await s.waitFor(`__e2e.top() === 'pause'`, 4000, 'pause from the Menu button');
  await sleep(600);
  await s.shot('pause');
  await s.tap('.pause-screen .tab', 'System');
  await sleep(400);
  await s.tap('.pause-screen .menu-item', 'Resume');
  await s.waitFor(`__e2e.top() === 'world'`, 4000, 'pause to close from Resume');
  await settleWorld(s);
  log(P, `phone 844×390, touch only: tap → title → Continue; key bar "${keys.trim()}"; Menu button (tap area ${menuBtn.w}×${menuBtn.h} px) → pause → System → Resume`);

  // Battle (a summit pair, so the enemies get turns at this level): manual commands, perfect defence (the fight
  // waits on our taps).
  await s.eval(() => { __game.debug.setAutopilot({ defense: 'perfect', offense: 'perfect', commands: null }); __game.debug.healParty(1); __game.debug.startBattle('summit_vigil'); return true; });
  await s.waitFor(`__e2e.stack().includes('battle')`, 10000, 'battle to start');
  let b = await touchRoot(s, 'first turn');
  await sleep(500);

  // 1) No usable skill: Skills is disabled and a tap on it keeps the root menu (the old soft-lock).
  await s.eval(() => { const sc = __game.debug.battle.scene; sc.model.get(sc.menu.actorId).ap = 0; sc._menuShowRoot(); return true; });
  await sleep(300);
  const skills0 = await rectOf(s, '.bt-menu .bt-mi', 'Skills');
  expect(skills0?.dis, `Skills should be disabled with 0 AP (${JSON.stringify(skills0)})`);
  await s.shot('battle-skills-disabled');
  await s.page.tap(skills0.x, skills0.y);
  await sleep(400);
  b = await touchBattle(s);
  if (b.menu?.level === 'list') {
    // Tolerated only if the list offers a way back.
    await s.tap('.bt-list .bt-back');
    await sleep(400);
    b = await touchBattle(s);
  }
  expect(b.menu?.level === 'root', `tapping the disabled Skills entry must leave the root menu usable (${JSON.stringify(b.menu)})`);
  // 2) Attack → target → Back → root.
  await s.tap('.bt-menu .bt-mi', 'Attack');
  await sleep(400);
  b = await touchBattle(s);
  expect(b.menu?.level === 'target', `Attack should open target selection (${JSON.stringify(b.menu)})`);
  const back = await hitSize(s, '.bt-target .bt-back');
  expect(back && back.h >= 40, `the target Back control should be ≥ 40 px tall (${JSON.stringify(back)})`);
  await s.page.tap(back.x, back.y);
  await sleep(400);
  b = await touchBattle(s);
  expect(b.menu?.level === 'root', `Back from target selection should return to the root menu (${JSON.stringify(b.menu)})`);
  // 3) With AP: Skills → list → Back → root.
  await s.eval(() => { const sc = __game.debug.battle.scene; sc.model.get(sc.menu.actorId).ap = 6; sc._menuShowRoot(); return true; });
  await sleep(300);
  await s.tap('.bt-menu .bt-mi', 'Skills');
  await sleep(400);
  b = await touchBattle(s);
  expect(b.menu?.level === 'list', `Skills should open its list with AP to spend (${JSON.stringify(b.menu)})`);
  const help = await s.eval(`(document.querySelector('.bt-info') || {}).textContent || ''`);
  await s.shot('battle-skill-list');
  await s.tap('.bt-list .bt-back');
  await sleep(400);
  b = await touchBattle(s);
  expect(b.menu?.level === 'root', `Back from the skill list should return to the root menu (${JSON.stringify(b.menu)})`);
  // 4) The round Pause control → pause → Resume.
  const nav = await hitSize(s, '.bt-nav');
  expect(nav && nav.w >= 44 && nav.h >= 44, `the battle Pause control should be a ≥ 44 px tap target (${JSON.stringify(nav)})`);
  await s.page.tap(nav.x, nav.y);
  await sleep(400);
  b = await touchBattle(s);
  expect(b.modal === 'pause', `the Pause control should open the battle pause (${JSON.stringify(b)})`);
  await s.shot('battle-pause');
  await s.tap('.bt-pause .bt-mi', 'Resume');
  await sleep(400);
  b = await touchBattle(s);
  expect(!b.modal && b.menu?.level === 'root', `Resume should close the pause (${JSON.stringify(b)})`);
  // 5) Free Aim → Done leaves without spending AP.
  const apAim = b.ap;
  await s.tap('.bt-menu .bt-mi', 'Free Aim');
  await sleep(700);
  b = await touchBattle(s);
  if (b.modal === 'hint') {
    await s.page.tap(24, 24);
    await sleep(500);
    b = await touchBattle(s);
  }
  expect(b.freeAim, `Free Aim should open (${JSON.stringify(b)})`);
  await s.tap('.bt-aim .bt-done');
  await sleep(700);
  b = await touchBattle(s);
  expect(!b.freeAim && b.menu?.level === 'root' && b.ap === apAim, `Done should leave Free Aim with AP unchanged (${apAim} → ${JSON.stringify(b)})`);
  // 6) Attack → tap the enemy on the canvas: the attack is carried out.
  const actor = b.current;
  await s.tap('.bt-menu .bt-mi', 'Attack');
  await sleep(700);
  const pt = await enemyTapPoint(s);
  await s.page.tap(pt.x, pt.y);
  await s.waitFor(`(() => { const d = __game.debug.battle; if (!d) return true; const x = d.state(); return x.partyRun || x.current !== ${JSON.stringify(actor)} || x.enemyRun; })()`, 6000, 'the tapped Attack to play out');
  log(P, `battle by touch: Skills disabled at 0 AP and inert when tapped; Attack → target → Back; Skills → list ("${help.trim()}") → Back; Pause control → Resume; Free Aim → Done (AP ${apAim} kept); Attack → tap on ${pt.id} executes`);

  // 7) The tab goes away 15–60 ms before an enemy hit lands and comes back 9 s later: nothing may resolve while it
  //    is hidden (no watchdog, no forced hits), the battle clock resumes where it stopped and every hit is still
  //    answerable (perfect defence ⇒ no hit taken). The play clock must not count the hidden time either.
  await s.eval(() => { __game.debug.setAutopilot(true); return true; });
  await s.eval(() => {
    window.__e2eHide = null;
    const g = window.__game;
    const setVis = (v) => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => v });
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => v === 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
    };
    window.__e2eShow = () => {
      const h = window.__e2eHide;
      setVis('visible');
      delete document.visibilityState;
      delete document.hidden;
      return h;
    };
    g.events.on('visibility', (vis, info) => { if (vis && window.__e2eHide) window.__e2eHide.back = info; });
    const tick = () => {
      const d = g.debug.battle;
      const u = d?.upcomingHits?.();
      const i = u ? u.hits.findIndex((h) => h.type !== 'feint' && !h.resolved) : -1;
      if (u && i >= 0 && u.local > u.hits[i].t - 60 && u.local < u.hits[i].t - 15) {
        const sc = d.scene;
        window.__e2eHide = { run: sc.enemyRun, name: u.name, hit: i, local: u.local, t: u.hits[i].t, hitsTaken: sc.model.stats.hitsTaken,
          play: g.state.stats.playTimeMs, resolved: sc.enemyRun.resolved.map((r) => (r ? r.outcome : null)) };
        setVis('hidden');
        return;
      }
      if (d) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    return true;
  });
  await s.waitFor('!!window.__e2eHide || !__game.debug.battle', 60000, 'an enemy attack to hide the tab in');
  const hid = await s.eval(`!!window.__e2eHide && document.visibilityState === 'hidden' && __game.hidden`);
  expect(hid, 'the tab should have been hidden just before an enemy hit');
  const HIDE_MS = 9000;
  await sleep(HIDE_MS);
  const mid = await s.eval(() => { const h = window.__e2eHide; return { now: h.run.now, resolved: h.run.resolved.map((r) => (r ? r.outcome : null)), done: h.run.done }; });
  await s.eval('window.__e2eShow(), true');
  await s.waitFor('window.__e2eHide.run.done', 20000, 'the enemy attack to finish after the tab returned');
  await sleep(300);
  const after = await s.eval(() => {
    const h = window.__e2eHide;
    const sc = __game.debug.battle?.scene;
    return { name: h.name, hit: h.hit, local: +h.local.toFixed(1), t: h.t, back: h.back, outcomes: h.run.resolved.map((r) => (r ? `${r.outcome}${r.voided ? '(void)' : ''}` : null)),
      hitsTaken: (sc ? sc.model.stats.hitsTaken : null), hitsTakenBefore: h.hitsTaken, playDelta: __game.state.stats.playTimeMs - h.play, before: h.resolved };
  });
  expect(JSON.stringify(mid.resolved) === JSON.stringify(after.before) && !mid.done, `nothing may resolve while the tab is hidden (before ${JSON.stringify(after.before)}, while hidden ${JSON.stringify(mid.resolved)})`);
  expect(after.back && after.back.hiddenMs >= HIDE_MS - 500, `the engine should report the hidden time (${JSON.stringify(after.back)})`);
  expect(after.outcomes.every((o) => o && o !== 'hit' && !/void/.test(o)), `every hit should still be defended after the tab returns (${after.outcomes.join(', ')})`);
  expect(after.hitsTaken === after.hitsTakenBefore, `no hit may land because the tab was away (hitsTaken ${after.hitsTakenBefore} → ${after.hitsTaken})`);
  expect(after.playDelta < 3000, `play time must not count the hidden tab (+${after.playDelta.toFixed(0)} ms over a ${HIDE_MS} ms absence)`);
  await s.assertHealthy('hidden tab');
  log(P, `tab hidden ${(after.t - after.local).toFixed(0)} ms before hit #${after.hit} of ${after.name} for ${(after.back.hiddenMs / 1000).toFixed(1)} s: nothing resolved meanwhile; afterwards ${after.outcomes.join('/')}, hits taken ${after.hitsTaken - after.hitsTakenBefore}, play clock +${(after.playDelta / 1000).toFixed(1)} s`);
  const end = await runBattle(s, 'touch', { shots: false, timeoutMs: 120000 });
  expect(end.outcome === 'victory', `the touch battle should end in victory (${end.outcome})`);
  await settleWorld(s);
  await s.assertHealthy(P);
  return cp;
}

// ------------------------------------------------------------------ phase G: difficulty selection

/** Battle on the current difficulty from 50% HP with perfect defence; returns the model's difficulty and HP rows. */
async function recoveryBattle(s, label) {
  await s.eval(() => { __game.debug.setAutopilot(true); __game.debug.healParty(0.5); __game.debug.lastBattle = null; __game.debug.startBattle('shore_driftling_pair'); return true; });
  await s.waitFor(`!!__game.debug.battle`, 10000, `${label}: battle`);
  const inBattle = await s.eval(() => { const sc = __game.debug.battle.scene; return { difficulty: sc.model.difficulty, windowScale: sc.model.data?.DIFFICULTY?.[sc.model.difficulty]?.windowScale }; });
  const r = await runBattle(s, label, { shots: false, timeoutMs: 120000 });
  expect(r.outcome === 'victory', `${label}: outcome ${r.outcome}`);
  await settleWorld(s);
  const hp = await s.eval(async () => {
    const { derivedStats } = await import('/src/game/progression.js');
    const res = __game.debug.lastBattle;
    return { summaryDifficulty: res?.summary?.difficulty ?? null,
      rows: __game.state.party.map((m) => ({ id: m.id, after: m.hp, max: derivedStats(m).maxHp, end: (res?.summary?.party || []).find((p) => p.id === m.id)?.hp ?? null })) };
  });
  return { ...inBattle, ...hp };
}

async function phaseDifficulty(s, cp) {
  const P = 'difficulty';
  await s.boot(cp);
  await openTitle(s);
  // New Game over an existing journal: confirm the overwrite, then pick Veteran (→ from the current setting).
  for (let i = 0; i < 6; i++) {
    const f = await s.eval(`(document.querySelector('.title-menu .menu-item.is-focused') || {}).textContent || ''`);
    if (/New Game/.test(f)) break;
    await s.press('ArrowDown');
    await sleep(120);
  }
  await s.press('Enter');
  await s.waitFor(`!!document.querySelector('.confirm-modal')`, 4000, 'overwrite confirmation');
  await sleep(300);
  await s.click('.confirm-modal .menu-item', 'Overwrite');
  await s.waitFor(`!!document.querySelector('.difficulty-modal')`, 4000, 'difficulty picker');
  await sleep(400);
  const want = 'Veteran';
  for (let i = 0; i < 3; i++) {
    const f = await s.eval(`(document.querySelector('.difficulty-modal .menu-item.is-focused .diff-name') || {}).textContent || ''`);
    if (f === want) break;
    await s.press('ArrowRight');
    await sleep(200);
  }
  const card = await s.eval(`(document.querySelector('.difficulty-modal .menu-item.is-focused') || {}).textContent || ''`);
  expect(/Veteran/.test(card), `the picker should focus Veteran (focused "${card.trim().slice(0, 80)}")`);
  await s.shot('veteran-picker');
  await s.press('Enter');
  await s.waitFor(`__e2e.top() === 'intro'`, 8000, 'intro after picking Veteran');
  const saved = await s.eval((k) => ({ live: __game.settings.difficulty, stored: JSON.parse(localStorage.getItem(k) || '{}').difficulty }), SETTINGS_KEY);
  expect(saved.live === 'veteran' && saved.stored === 'veteran', `Veteran should be the live and stored difficulty (${JSON.stringify(saved)})`);
  while ((await s.top()) === 'intro') {
    await sleep(500);
    await s.press('Enter');
  }
  await s.waitFor(`__e2e.top() === 'dialogue' || __e2e.top() === 'world'`, 12000, 'world after the intro');
  await settleWorld(s, 60000);
  await s.eval(() => { __game.debug.setLevel(8); return true; });
  const vet = await recoveryBattle(s, 'veteran');
  expect(vet.difficulty === 'veteran' && vet.summaryDifficulty === 'veteran', `the battle should run on Veteran (${vet.difficulty}, summary ${vet.summaryDifficulty})`);
  expect(vet.rows.every((m) => m.end !== null && m.after === m.end), `Veteran: no post-battle recovery (${JSON.stringify(vet.rows)})`);
  log(P, `New Game over a journal → Overwrite → Veteran picked (live + stored); battle on Veteran (windows ×${vet.windowScale}); HP ${vet.rows.map((m) => `${m.end}→${m.after}`).join(', ')} (no recovery)`);

  // Story from the pause menu's Settings: ◀ twice on the Difficulty row, then back to the field.
  await s.press('Escape');
  await s.waitFor(`__e2e.top() === 'pause'`, 4000, 'pause');
  await sleep(400);
  await s.click('.pause-screen .tab', 'System');
  await sleep(400);
  await s.click('.pause-screen .menu-item', 'Settings');
  await s.waitFor(`__e2e.top() === 'settings'`, 4000, 'settings from the pause menu');
  await sleep(500);
  for (let i = 0; i < 4 && (await s.eval('__game.settings.difficulty')) !== 'story'; i++) {
    await s.press('ArrowLeft');
    await sleep(200);
  }
  await sleep(300);
  await s.shot('story-settings');
  const story = await s.eval((k) => ({ live: __game.settings.difficulty, stored: JSON.parse(localStorage.getItem(k) || '{}').difficulty }), SETTINGS_KEY);
  expect(story.live === 'story', `Settings ◀ should reach Story (${JSON.stringify(story)})`);
  await s.press('Escape');
  await s.waitFor(`__e2e.top() === 'pause'`, 4000, 'back to pause');
  await sleep(300);
  await s.press('Escape');
  await s.waitFor(`__e2e.top() === 'world'`, 4000, 'back to the field');
  await settleWorld(s);
  const sto = await recoveryBattle(s, 'story');
  expect(sto.difficulty === 'story' && sto.summaryDifficulty === 'story', `the battle should run on Story (${sto.difficulty}, summary ${sto.summaryDifficulty})`);
  expect(sto.rows.every((m) => m.end !== null && m.after === Math.min(m.max, Math.round(m.end + m.max * 0.2))), `Story: 20% post-battle recovery (${JSON.stringify(sto.rows)})`);
  const stored = await s.eval((k) => JSON.parse(localStorage.getItem(k) || '{}').difficulty, SETTINGS_KEY);
  expect(stored === 'story', `Story should be saved with the settings (stored ${stored})`);
  log(P, `pause → System → Settings → ◀ Story (live + stored); battle on Story (windows ×${sto.windowScale}); HP ${sto.rows.map((m) => `${m.end}→${m.after}`).join(', ')} (+20%)`);
  await s.assertHealthy(P);
  return cp;
}

// ------------------------------------------------------------------ runner

const RUNNERS = {
  prologue: phasePrologue, zones: phaseZones, bosses: phaseBosses, epilogue: phaseEpilogue, viewports: phaseViewports, touch: phaseTouch,
  difficulty: phaseDifficulty,
};
/** Browser window per phase (default 1280×720, mouse + keyboard). */
const VIEW = { touch: { width: 844, height: 390, touch: true } };
// The checkpoint each phase starts from. The bosses start from the prologue's level-1 party so that every boss is
// fought at its intended level (the zone sampling raises the party to 15 along the way).
const NEEDS = { zones: 'prologue', bosses: 'prologue', epilogue: 'bosses', viewports: 'epilogue', touch: 'epilogue', difficulty: 'epilogue' };

async function runPhase(url, name, cp) {
  let lastErr = null;
  for (let attempt = 0; attempt <= OPTS.retries; attempt++) {
    const s = new Session(url, name);
    const t = Date.now();
    try {
      await s.open(VIEW[name]);
      if (attempt) log(name, `retry ${attempt} in a fresh browser`);
      const out = await RUNNERS[name](s, cp);
      await s.assertHealthy(name);
      log(name, `PASSED in ${((Date.now() - t) / 1000).toFixed(0)} s (${s.shots.length} screenshots)`);
      return { cp: out, shots: s.shots.length };
    } catch (err) {
      lastErr = err;
      log(name, `FAILED: ${err.message}`);
      try {
        await s.shot('failure');
        const info = await Promise.race([s.eval(`({ stack: __e2e.stack(), world: __e2e.world(), battle: __e2e.battle() })`), sleep(4000).then(() => 'no answer')]);
        log(name, `  state at failure: ${JSON.stringify(info).slice(0, 900)}`);
        const bad = await Promise.race([s.health(), sleep(3000).then(() => [])]);
        if (bad.length) log(name, `  ${bad.join('\n  ')}`);
      } catch {
        /* page unreachable */
      }
      if (err instanceof GameError) break;
    } finally {
      await s.close();
    }
  }
  throw lastErr;
}

async function main() {
  try {
    OPTS = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    console.error(USAGE);
    return 2;
  }
  if (OPTS.help) {
    console.log(USAGE);
    return 0;
  }
  mkdirSync(OPTS.out, { recursive: true });
  const server = await serve({ port: OPTS.port, root: ROOT, quiet: true });
  const url = `http://127.0.0.1:${server.port}/`;
  log('e2e', `serving ${ROOT} at ${url}; screenshots → ${OPTS.out}${OPTS.warp > 1 ? `; clock warp ×${OPTS.warp}` : ''}`);
  const requested = new Set(OPTS.phases);
  const cpFile = (name) => path.join(OPTS.out, `checkpoint-${name}.json`);
  const checkpoints = {};
  // Every requested phase needs its predecessor's checkpoint: from disk with --reuse, otherwise by running it.
  const pending = [...requested];
  while (pending.length) {
    const need = NEEDS[pending.pop()];
    if (!need || requested.has(need) || checkpoints[need]) continue;
    if (OPTS.reuse && existsSync(cpFile(need))) {
      checkpoints[need] = JSON.parse(readFileSync(cpFile(need), 'utf8'));
      log('e2e', `reusing the "${need}" checkpoint from an earlier run`);
    } else {
      requested.add(need);
      pending.push(need);
    }
  }
  let failed = null;
  let shots = 0;
  for (const name of PHASES) {
    if (!requested.has(name)) continue;
    try {
      const r = await runPhase(url, name, NEEDS[name] ? checkpoints[NEEDS[name]] : null);
      checkpoints[name] = r.cp;
      shots += r.shots;
      if (r.cp) writeFileSync(cpFile(name), JSON.stringify(r.cp));
    } catch (err) {
      failed = { name, err };
      break;
    }
  }
  await server.close();
  const summary = failed ? `E2E FAILED in phase "${failed.name}": ${failed.err.message.split('\n')[0]}` : `E2E PASSED: ${[...requested].join(', ')} (${shots} screenshots)`;
  log('e2e', summary);
  writeFileSync(path.join(OPTS.out, 'timeline.txt'), `${timeline.join('\n')}\n`);
  return failed ? 1 : 0;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) main().then((code) => process.exit(code), (err) => {
  console.error(err);
  process.exit(2);
});
