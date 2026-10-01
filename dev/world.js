// Exploration bench for Expedition 69 (dev/world.html): boots a Game with the real WorldScene plus small stub
// scenes for battle / pause / flag / dialogue / shop / gameover / ending (they log, then pop), and offers a
// whole-map overview, a debug overlay (collision, spawn radii, FPS) and the world validator.
//
// URL: ?zone=shore|thicket|spire|summit  &x=&y= (tile)  &debug=1  &validate=1  &overview=1[&scale=0.5]
//      &view=tx,ty (static 1280×720 render centred on a tile)  &level=N  &bosses=wreck_warden,bellwether
//      &autowin=ms (stub battles resolve themselves)  &outcome=victory|fled|defeat  &mute=1
//      &portraits=1 (every NPC bust beside its world figure)  &worldQuality=low|high (skip the auto budget)
// Keys (bench only): F3 debug overlay · F4 validation panel · 1/2/3 in a stub battle = win / flee / lose.
// Automation: window.__game, window.__bench.{world(), info(), log, battles, validate(), stubs}.

import { Game, Scene } from '../src/core/engine.js';
import { Audio } from '../src/core/audio.js';
import { MAPS } from '../src/data/maps.js';
import { ZONES } from '../src/data/zones.js';
import { ENCOUNTERS } from '../src/data/encounters.js';
import { ENEMIES } from '../src/data/enemies.js';
import { STORY } from '../src/data/story.js';
import { SHOPS } from '../src/data/shops.js';
import { RELICS, STARTING_RELICS } from '../src/data/relics.js';
import { UPGRADES } from '../src/data/items.js';
import { createNewGame, applyBattleResult, restAtFlag, grantPartyXp, autoAllocate, markDefeated } from '../src/game/gameState.js';
import { parseMap, validateWorld, TILE } from '../src/world/tilemap.js';
import { WorldRenderer, Atmosphere } from '../src/world/worldRender.js';
import { WorldScene } from '../src/world/worldScene.js';
import { PropEntity, NpcEntity, FlagEntity, ChestEntity, JournalEntity, ExitEntity, NPC_LOOKS, drawNpc } from '../src/world/entities.js';
import { npcPortrait } from '../src/world/npcPortraits.js';

const Q = new URLSearchParams(location.search);
const logEl = document.getElementById('bench-log');
const log = [];
function note(msg) {
  log.push(msg);
  if (log.length > 14) log.shift();
  if (logEl) logEl.textContent = log.join('\n');
  console.log('[bench]', msg);
}

// ───────────────────────────────────────────────────────── validation

function validate() {
  const r = validateWorld(MAPS, { ENCOUNTERS, STORY, SHOPS, RELICS, UPGRADES, ENEMIES, STARTING_RELICS });
  window.__validation = r;
  return r;
}

function showValidation() {
  const r = validate();
  const el = document.getElementById('validation');
  const rows = Object.entries(r.report).map(([z, c]) => `  ${z.padEnd(8)} ${c.size.padEnd(6)} enemies ${c.enemy}  boss ${c.boss}  pennants ${c.flag}  journals ${c.journal}  chests ${c.chest}  npcs ${c.npc}  merchants ${c.merchant}  exits ${c.exit}  props ${c.prop}  unreachable ${c.unreachable ?? '?'}`);
  el.textContent = [
    `WORLD VALIDATION — ${r.ok ? 'OK ✓' : `${r.errors.length} ERROR(S) ✗`}`,
    '',
    ...rows,
    '',
    `Chest-only relics: ${r.chestRelics.join(', ')}`,
    '',
    r.errors.length ? `Errors:\n  ${r.errors.join('\n  ')}` : 'Errors: none',
    '',
    r.warnings.length ? `Warnings:\n  ${r.warnings.join('\n  ')}` : 'Warnings: none',
    '',
    '(F4 to close)',
  ].join('\n');
  return r;
}

// ───────────────────────────────────────────────────────── static renders

function overview() {
  const zone = Q.get('zone') || 'shore';
  const def = MAPS[zone];
  const map = parseMap(def, zone);
  const R = new WorldRenderer(map, zone, { quality: 1, props: def.entities.filter((e) => e.type === 'prop') });
  const ms = R.buildAll();
  document.getElementById('stage').style.display = 'none';
  const cv = document.createElement('canvas');
  cv.id = 'overview';
  document.body.appendChild(cv);
  const ctx = cv.getContext('2d');
  const t = 4000;
  const drawWorld = (cam, vw, vh) => {
    R.drawGround(ctx, cam, vw, vh);
    R.drawWaterFx(ctx, cam, t, vw, vh);
    const list = [];
    R.collectTall(cam, list, vw, vh);
    for (const e of def.entities) {
      if (e.type === 'prop') new PropEntity(e).collect(list, t, null);
      else if (e.type === 'npc') new NpcEntity(e).collect(list, t, null);
      else if (e.type === 'flag') new FlagEntity(e, false).collect(list, t);
      else if (e.type === 'chest') new ChestEntity(e, false).collect(list, t);
      else if (e.type === 'journal') new JournalEntity(e, false).collect(list, t);
      else if (e.type === 'exit') new ExitEntity(e).collect(list, t);
    }
    list.sort((a, b) => a.y - b.y);
    for (const d of list) {
      if (d.kind === 'tall') R.drawTall(ctx, d, t);
      else d.draw(ctx);
    }
  };
  const view = Q.get('view');
  if (view) {
    const [vx, vy] = view.split(',').map(Number);
    cv.width = 1280;
    cv.height = 720;
    const cam = { x: vx * TILE - 640, y: vy * TILE - 360 };
    R.drawUnderlay(ctx, cam, t);
    ctx.save();
    ctx.translate(-cam.x, -cam.y);
    drawWorld(cam, 1280, 720);
    ctx.restore();
    const atm = new Atmosphere(zone);
    atm.drawParticles(ctx, cam, t);
    atm.drawLight(ctx, t);
  } else {
    const s = Number(Q.get('scale') || 0.5);
    cv.width = map.pxW * s;
    cv.height = map.pxH * s;
    ctx.scale(s, s);
    for (let y = 0; y < map.pxH; y += 720) {
      for (let x = 0; x < map.pxW; x += 1280) {
        ctx.save();
        ctx.translate(x, y);
        ctx.beginPath();
        ctx.rect(0, 0, 1280, 720);
        ctx.clip();
        R.drawUnderlay(ctx, { x, y }, t);
        ctx.restore();
      }
    }
    drawWorld({ x: 0, y: 0 }, map.pxW, map.pxH);
    // entity markers
    ctx.font = '12px monospace';
    for (const e of def.entities) {
      if (e.type === 'prop') continue;
      const col = { enemy: '#ff5a4a', boss: '#ff00aa', chest: '#ffe070', journal: '#fff', flag: '#ffb040', npc: '#7fe0ff', merchant: '#7fffb0', trainer: '#ff9ad0', exit: '#b0ff70', player: '#ffffff' }[e.type] ?? '#ccc';
      ctx.strokeStyle = col;
      ctx.lineWidth = 2;
      ctx.strokeRect(e.x * TILE + 2, e.y * TILE + 2, (e.w ?? 1) * TILE - 4, (e.h ?? 1) * TILE - 4);
      ctx.fillStyle = col;
      ctx.fillText(`${e.type[0].toUpperCase()}${e.id ? ` ${e.id.replace(/^(shore|thicket|spire|summit)_/, '')}` : ''}`, e.x * TILE + 3, e.y * TILE - 3);
    }
  }
  window.__buildMs = ms;
  window.__ready = true;
}

// ───────────────────────────────────────────────────────── NPC portraits

/** Every NPC bust (dialogue and shop sizes) beside the world figure it is painted from. */
function portraits() {
  document.getElementById('stage').style.display = 'none';
  const cv = document.createElement('canvas');
  const looks = Object.keys(NPC_LOOKS);
  const cellW = 300;
  const cellH = 200;
  const cols = 4;
  cv.width = cols * cellW;
  cv.height = Math.ceil(looks.length / cols) * cellH;
  cv.id = 'overview';
  document.body.appendChild(cv);
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#2a2320';
  ctx.fillRect(0, 0, cv.width, cv.height);
  looks.forEach((look, i) => {
    const x = (i % cols) * cellW;
    const y = Math.floor(i / cols) * cellH;
    const name = NPC_LOOKS[look].name;
    const big = npcPortrait(name, 160);
    const small = npcPortrait(name, 64);
    if (big) ctx.drawImage(big, x + 10, y + 10, 160, 160);
    if (small) ctx.drawImage(small, x + 180, y + 10, 64, 64);
    ctx.save();
    ctx.translate(x + 230, y + 175);
    ctx.scale(1.4, 1.4);
    drawNpc(ctx, look, 0, 0, 4000, 1);
    ctx.restore();
    ctx.fillStyle = '#f3dba0';
    ctx.font = '13px Georgia, serif';
    ctx.fillText(`${name} (${look})`, x + 10, y + 190);
  });
  window.__ready = true;
}

// ───────────────────────────────────────────────────────── stub scenes

const STUB_CSS = `
.bench-stub{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);min-width:460px;max-width:760px;padding:22px 28px;
  background:rgba(16,12,10,.92);border:1px solid #e0b458;border-radius:10px;color:#f5eedf;font:18px "Cormorant Garamond",Georgia,serif;box-shadow:0 10px 40px rgba(0,0,0,.6)}
.bench-stub h2{margin:0 0 8px;font:700 18px Cinzel,Georgia,serif;letter-spacing:.16em;color:#f3dba0;text-transform:uppercase}
.bench-stub p{margin:6px 0;line-height:1.3}
.bench-stub .who{font:700 13px Cinzel,Georgia,serif;letter-spacing:.14em;color:#e0b458;text-transform:uppercase}
.bench-stub .row{display:flex;gap:10px;margin-top:14px;flex-wrap:wrap}
.bench-stub button{font:700 13px Cinzel,Georgia,serif;letter-spacing:.1em;padding:8px 14px;border-radius:6px;border:1px solid #e0b458;background:#2a1e14;color:#f3dba0;cursor:pointer}
.bench-stub button:hover{background:#3a2a1a}
.bench-stub small{opacity:.7}
.bench-dialogue{top:auto;bottom:24px;transform:translateX(-50%)}
`;

function stubStyle() {
  if (document.getElementById('bench-stub-style')) return;
  const s = document.createElement('style');
  s.id = 'bench-stub-style';
  s.textContent = STUB_CSS;
  document.head.appendChild(s);
}

class StubPanel extends Scene {
  constructor(game) {
    super(game);
    this.transparent = true;
  }

  panel(html, cls = '') {
    stubStyle();
    const el = document.createElement('div');
    el.className = `bench-stub ${cls}`;
    el.innerHTML = html;
    this.mountUI(el);
    return el;
  }

  render(ctx) {
    ctx.fillStyle = 'rgba(8,5,10,0.35)';
    ctx.fillRect(0, 0, 1280, 720);
  }
}

const battles = [];

class StubBattle extends Scene {
  enter(params) {
    this.params = params;
    battles.push({ ...params, onEnd: undefined });
    note(`battle ▶ ${params.encounterId} [${(params.enemies ?? []).join(', ')}] zone=${params.zone} ambush=${params.ambush} boss=${!!params.boss} practice=${!!params.practice} tutorial=${!!params.tutorial} spawn=${params.spawnId ?? '-'}`);
    this.t = 0;
    const auto = Number(Q.get('autowin'));
    this.auto = Number.isFinite(auto) && auto > 0 ? auto : 0;
    stubStyle();
    const el = document.createElement('div');
    el.className = 'bench-stub';
    const enc = ENCOUNTERS[params.encounterId];
    el.innerHTML = `<h2>Stub battle — ${enc?.name ?? params.encounterId}</h2><p>${(params.enemies ?? []).map((e) => ENEMIES[e]?.name ?? e).join(' · ')}</p>
      <p><small>ambush: ${params.ambush ?? 'none'} · boss: ${!!params.boss} · practice: ${!!params.practice} · tutorial: ${!!params.tutorial} · zone: ${params.zone}</small></p>
      <div class="row"><button data-o="victory">1 · Victory</button><button data-o="fled">2 · Flee</button><button data-o="defeat">3 · Defeat</button></div>`;
    el.addEventListener('click', (ev) => {
      const o = ev.target?.dataset?.o;
      if (o) this.finish(o);
    });
    this.mountUI(el);
  }

  update(dt) {
    this.t += dt;
    const k = this.game.input;
    if (k.keyPressed('Digit1')) this.finish('victory');
    else if (k.keyPressed('Digit2')) this.finish('fled');
    else if (k.keyPressed('Digit3')) this.finish('defeat');
    else if (this.auto && this.t > this.auto) this.finish(Q.get('outcome') || 'victory');
  }

  finish(outcome) {
    if (this.done) return;
    this.done = true;
    const st = this.game.state;
    const p = this.params;
    const summary = {
      outcome, xp: outcome === 'victory' ? 45 : 0, glint: outcome === 'victory' ? 30 : 0, drops: [], practice: !!p.practice,
      party: st.party.map((m) => ({ id: m.id, hp: Math.max(1, Math.round(m.hp * (outcome === 'victory' ? 0.8 : 0.4))), alive: true })),
    };
    const rewards = applyBattleResult(st, summary, { spawnId: p.spawnId, bossId: p.bossId });
    const result = { outcome, summary, rewards };
    note(`battle ◀ ${outcome}`);
    this.game.scenes.pop(result);
    p.onEnd?.(result);
  }

  render(ctx) {
    const g = ctx.createLinearGradient(0, 0, 0, 720);
    g.addColorStop(0, '#2a1c2e');
    g.addColorStop(1, '#0c0810');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 1280, 720);
  }
}

class StubDialogue extends StubPanel {
  enter(params) {
    this.params = params;
    this.lines = params.lines ?? STORY.dialogues[params.id] ?? [{ speaker: 'narrator', text: `(missing dialogue ${params.id})` }];
    this.i = 0;
    note(`dialogue ▶ ${params.id ?? `${this.lines.length} lines`}`);
    this.el = this.panel('', 'bench-dialogue');
    this.show();
    this.el.addEventListener('click', () => this.next());
  }

  show() {
    const l = this.lines[this.i];
    const who = l.speaker === 'narrator' ? '' : (STORY.dialogues && ({ gideon: 'Gideon', nyra: 'Nyra', sable: 'Sable' }[l.speaker] ?? l.speaker));
    this.el.innerHTML = `${who ? `<div class="who">${who}</div>` : ''}<p>${l.text}</p><small>${this.i + 1}/${this.lines.length} · ${this.game.input.keyLabel('confirm')}</small>`;
  }

  next() {
    this.i++;
    if (this.i >= this.lines.length) {
      note('dialogue ◀');
      const done = this.params.onDone;
      this.game.scenes.pop();
      done?.();
      return;
    }
    this.show();
  }

  update() {
    if (this.game.input.pressed('confirm')) {
      this.game.input.consume('confirm');
      this.next();
    }
  }

  render() {}
}

class StubFlag extends StubPanel {
  enter(params) {
    this.params = params;
    note(`pennant ▶ ${params.flagId} "${params.name}"`);
    const el = this.panel(`<h2>${params.name}</h2><p>Expedition Pennant <small>(${params.flagId})</small></p><div class="row"><button data-a="rest">Rest</button><button data-a="leave">Leave</button></div>`);
    el.addEventListener('click', (ev) => {
      const a = ev.target?.dataset?.a;
      if (a === 'rest') this.rest();
      else if (a === 'leave') this.leave();
    });
  }

  rest() {
    restAtFlag(this.game.state, this.params.flagId);
    note('pennant: rested (enemies respawn)');
    this.game.scenes.pop({ rested: true });
  }

  leave() {
    note('pennant ◀');
    this.game.scenes.pop();
  }

  update() {
    const i = this.game.input;
    if (i.pressed('confirm')) {
      i.consume('confirm');
      this.rest();
    } else if (i.pressed('cancel')) {
      i.consume(['cancel', 'menu']);
      this.leave();
    }
  }
}

class StubShop extends StubPanel {
  enter(params) {
    note(`shop ▶ ${params.shopId}`);
    const s = SHOPS[params.shopId];
    this.panel(`<h2>${s?.name ?? params.shopId}</h2><p>${s?.keeper ?? ''} — ${s?.blurb ?? ''}</p><p><small>${(s?.stock ?? []).length} items · ${this.game.input.keyLabel('cancel')} to leave</small></p>`);
  }

  update() {
    const i = this.game.input;
    if (i.pressed('cancel') || i.pressed('confirm')) {
      i.consume(['cancel', 'confirm', 'menu']);
      note('shop ◀');
      this.game.scenes.pop();
    }
  }
}

class StubPause extends StubPanel {
  enter() {
    note('pause ▶');
    this.panel(`<h2>Paused</h2><p>Stub pause menu.</p><p><small>${this.game.input.keyLabel('menu')} / ${this.game.input.keyLabel('confirm')} to resume</small></p>`);
    this.t = 0;
  }

  update(dt) {
    this.t += dt;
    const i = this.game.input;
    if (this.t > 100 && (i.pressed('menu') || i.pressed('confirm') || i.pressed('cancel'))) {
      i.consume();
      note('pause ◀');
      this.game.scenes.pop();
    }
  }
}

class StubGameOver extends StubPanel {
  enter() {
    note('gameover ▶');
    this.transparent = false;
    this.panel('<h2>The expedition falls</h2><p>Stub game over.</p><div class="row"><button data-a="retry">Retry at the last pennant</button></div>')
      .addEventListener('click', () => this.retry());
  }

  retry() {
    const st = this.game.state;
    const lf = st.world.lastFlag;
    for (const m of st.party) {
      m.hp = 1;
      m.alive = true;
    }
    this.game.scenes.reset('world', lf ? { zone: lf.zone, x: lf.x, y: lf.y } : {});
  }

  update() {
    if (this.game.input.pressed('confirm')) this.retry();
  }

  render(ctx) {
    ctx.fillStyle = '#0a0608';
    ctx.fillRect(0, 0, 1280, 720);
  }
}

class StubEnding extends StubPanel {
  enter() {
    note('ending ▶');
    this.transparent = false;
    this.panel('<h2>The Sun moves</h2><p>Stub ending scene.</p>');
  }

  render(ctx) {
    ctx.fillStyle = '#1a1208';
    ctx.fillRect(0, 0, 1280, 720);
  }
}

// ───────────────────────────────────────────────────────── boot

function boot() {
  const game = new Game({});
  window.__game = game;
  if (Q.get('mute') !== '1') {
    try {
      game.audio = new Audio();
      game.audio.setVolumes({ master: game.settings.masterVolume, sfx: game.settings.sfxVolume, music: game.settings.musicVolume });
    } catch (err) {
      console.warn('[bench] audio unavailable', err);
    }
  }
  game.registerScene('world', WorldScene);
  game.registerScene('battle', StubBattle);
  game.registerScene('dialogue', StubDialogue);
  game.registerScene('flag', StubFlag);
  game.registerScene('shop', StubShop);
  game.registerScene('pause', StubPause);
  game.registerScene('gameover', StubGameOver);
  game.registerScene('ending', StubEnding);

  const st = createNewGame({ seed: 69 });
  game.state = st;
  const level = Number(Q.get('level'));
  if (Number.isFinite(level) && level > 1) {
    let guard = 0;
    while (st.party[0].level < level && guard++ < 200) grantPartyXp(st, 200);
    for (const m of st.party) autoAllocate(st, m.id);
  }
  for (const b of (Q.get('bosses') || '').split(',').filter(Boolean)) markDefeated(st, b, { boss: true });
  if (Q.get('seen') === '1') {
    st.world.story = { shore_arrival: true, thicket_arrival: true, spire_arrival: true, summit_arrival: true, world_keys_seen: true, flag_first: true };
  }
  game.debug = game.debug ?? {};
  game.debug.gotoZone = (zone, x, y) => {
    const w = game.scenes.get('world');
    if (w) w.teleport(zone, x, y);
    else game.scenes.reset('world', { zone, x, y });
  };
  game.events.on('scene', (e) => {
    if (e.op !== 'push' && e.op !== 'pop') return;
    const el = document.getElementById('bench-scenes');
    if (el) el.textContent = e.stack.join(' › ');
  });
  const params = {};
  if (Q.get('zone')) params.zone = Q.get('zone');
  if (Q.get('x') && Q.get('y')) {
    params.x = Number(Q.get('x'));
    params.y = Number(Q.get('y'));
  }
  params.arrival = Q.get('arrival') === '1';
  game.scenes.push('world', params);
  const world = game.scenes.get('world');
  if (Q.get('debug') === '1') world.debugOverlay = true;
  game.start();

  // bench-only keys (dev tool; game scenes use input actions)
  window.addEventListener('keydown', (ev) => {
    const w = game.scenes.get('world');
    if (ev.code === 'F3' && w) {
      w.debugOverlay = !w.debugOverlay;
      ev.preventDefault();
    } else if (ev.code === 'F4') {
      const el = document.getElementById('validation');
      if (el.textContent) el.textContent = '';
      else showValidation();
      ev.preventDefault();
    }
  });

  window.__bench = {
    world: () => game.scenes.get('world'),
    info: () => game.scenes.get('world')?.debugInfo(),
    log,
    battles,
    validate,
    zones: ZONES,
    finishBattle: (o = 'victory') => {
      const top = game.scenes.top;
      if (top instanceof StubBattle) top.finish(o);
    },
    advanceDialogue: () => {
      const top = game.scenes.top;
      if (top instanceof StubDialogue) top.next();
    },
  };
  window.__ready = true;
  note(`booted · zone ${world.zone} · build ${world.buildMs?.toFixed(0)} ms`);
}

try {
  if (Q.get('overview') === '1') overview();
  else if (Q.get('portraits') === '1') portraits();
  else {
    boot();
    if (Q.get('validate') === '1') showValidation();
  }
} catch (err) {
  window.__showError?.(err?.stack ?? String(err));
  throw err;
}
