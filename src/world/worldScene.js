// Top-down exploration scene for Expedition 69 (SPEC §3.6, §4.11 'world'): the party walks the painted zone
// maps, roaming Gloam notice and chase (never inside a camp's safe radius), a swing strikes first, contact starts
// battles (shatter transition), pennants / chests / journals / NPCs / merchants / the training mannequin / zone
// exits are interacted with via `confirm` (or a tap), bosses speak before they fight, and position is persisted
// into GameState for saves. The DOM HUD: zone cartouche → compact objective pill with a compass, glint, a Menu
// button for touch, the minimap (legend, objective marker), party chips, prompts and toasts.

import { Scene } from '../core/scene.js';
import { MAPS } from '../data/maps.js';
import { ZONES, zoneObjective, objectiveTarget } from '../data/zones.js';
import { ENCOUNTERS } from '../data/encounters.js';
import { ENEMIES } from '../data/enemies.js';
import { STORY } from '../data/story.js';
import { RELICS } from '../data/relics.js';
import { UPGRADES } from '../data/items.js';
import { createNewGame, addLoot, visitFlag, markDefeated } from '../game/gameState.js';
import { derivedStats } from '../game/progression.js';
import { CHARACTERS, PARTY_ORDER } from '../data/characters.js';
import { portraitDataURL } from '../render/sprites.js';
import { itemIcon } from '../render/icons.js';
import { Effects } from '../render/effects.js';
import { prepareBattleBackground } from '../render/backgrounds.js';
import { PALETTE, FONTS } from '../render/palette.js';
import { parseMap, TILE, worldToTile, entityFootprint, safeZones } from './tilemap.js';
import { WorldRenderer, Atmosphere, makeCanvas, clamp, smooth, hash2, TAU } from './worldRender.js';
import {
  PartyWalker, RoamingEnemy, BossEntity, FlagEntity, ChestEntity, JournalEntity, NpcEntity, MerchantEntity, TrainerEntity,
  ExitEntity, PropEntity, inSafe,
} from './entities.js';

const STYLE_ID = 'world-scene-style';
const VIEW_W = 1280;
const VIEW_H = 720;
const SAVE_EVERY = 400;
const TRANSITION_MS = 700;
const FIRST_FLAG_KEY = 'flag_first';
/** Encounter grace after a dialogue, shop, menu or battle closes: roaming Gloam neither notice nor touch the party. */
const GRACE_MS = 1500;
/** Zone title card: the big centred card docks into the top-left cartouche after DOCK_AT ms. */
const TITLE_LIFE = 3100;
const DOCK_AT = 2700;
/** The arrival card's brush band on the stage (centre, size): see _renderTitle. */
const TITLE_CARD = Object.freeze({ cx: VIEW_W / 2, cy: 168, w: 900, h: 150 });
/** The full objective line collapses to the compact pill after this long… */
const OBJECTIVE_FULL_MS = 8000;
/** …and comes back once the party has stood still this long. */
const OBJECTIVE_IDLE_MS = 2500;
/** Smoothed frame interval (ms) above which the world switches to its software-raster budget… */
const LOW_QUALITY_FRAME_MS = 25;
/** …once it has stayed there this long while exploring. */
const LOW_QUALITY_AFTER_MS = 2500;

/** Render budget chosen this session ('low' sticks once a slow canvas was detected; ?worldQuality= overrides). */
let sessionQuality = null;

/** Module-scoped HUD styles (uses UI's CSS custom properties with fallbacks). */
const CSS = `
.wv-hud{position:absolute;inset:0;pointer-events:none;font-family:var(--font-body,"Cormorant Garamond",Georgia,serif);color:var(--ivory,#f5eedf);transition:opacity .25s ease}
.wv-hud.wv-dim{opacity:0}
.wv-hud.wv-dim .wv-glint{opacity:1}
.wv-hud.wv-dim .wv-menu,.wv-hud.wv-dim .wv-mini{pointer-events:none}
.wv-loc{position:absolute;left:0;top:16px;transition:opacity .5s ease,transform .5s cubic-bezier(.2,.8,.3,1)}
.wv-loc.wv-hide{opacity:0;transform:translateX(-28px)}
.wv-card{position:relative;max-width:780px;padding:10px 110px 13px 30px;background:linear-gradient(90deg,rgba(16,12,10,.88) 0,rgba(16,12,10,.8) calc(100% - 120px),rgba(16,12,10,0) 100%);border-left:2px solid var(--gold,#e0b458);transition:opacity .45s ease,transform .45s ease}
.wv-zone{font-family:var(--font-title,"Cinzel",serif);font-weight:700;font-size:18px;letter-spacing:.2em;text-transform:uppercase;color:var(--pale-gold,#f3dba0);text-shadow:0 1px 3px rgba(0,0,0,.9)}
.wv-rule{width:240px;height:1px;margin:6px 0 8px;background:linear-gradient(90deg,var(--gold,#e0b458),rgba(224,180,88,0))}
.wv-obj{display:flex;align-items:center;gap:10px;font-style:italic;font-size:19px;line-height:1.25;color:var(--parchment,#e9dcc0);text-shadow:0 1px 3px rgba(0,0,0,.9)}
.wv-compass{flex:none;width:24px;height:24px}
.wv-compass svg{display:block;width:100%;height:100%}
.wv-compass .wv-needle{transform-origin:12px 12px;transition:transform .35s ease}
.wv-pill{position:absolute;left:22px;top:0;display:flex;align-items:center;gap:8px;max-width:560px;padding:5px 16px 5px 7px;border-radius:999px;white-space:nowrap;background:var(--panel,rgba(16,12,10,.84));border:1px solid rgba(224,180,88,.5);box-shadow:0 4px 14px rgba(0,0,0,.35);font-style:italic;font-size:17px;color:var(--parchment,#e9dcc0);opacity:0;transform:translateY(-6px);transition:opacity .45s ease,transform .45s ease}
.wv-pill span{overflow:hidden;text-overflow:ellipsis}
.wv-pill .wv-compass{width:22px;height:22px}
.wv-loc.wv-compact .wv-card{opacity:0;transform:translateY(-6px)}
.wv-loc.wv-compact .wv-pill{opacity:1;transform:none}
.wv-glint{position:absolute;right:86px;top:22px;display:flex;align-items:center;gap:9px;padding:6px 16px 6px 9px;border-radius:999px;background:var(--panel,rgba(16,12,10,.82));border:1px solid rgba(224,180,88,.5);box-shadow:0 4px 14px rgba(0,0,0,.35);font-family:var(--font-title,"Cinzel",serif);font-size:17px;letter-spacing:.06em;color:var(--pale-gold,#f3dba0);transition:transform .18s ease}
.wv-glint.wv-bump{transform:scale(1.12)}
.wv-glint svg{width:22px;height:22px;display:block}
.wv-menu{position:absolute;right:22px;top:14px;width:52px;height:52px;padding:0;display:grid;place-items:center;border-radius:50%;background:var(--panel,rgba(16,12,10,.84));border:1px solid rgba(224,180,88,.6);box-shadow:0 4px 14px rgba(0,0,0,.4);color:var(--pale-gold,#f3dba0);pointer-events:auto;cursor:pointer;touch-action:manipulation;-webkit-tap-highlight-color:transparent;transition:transform .12s ease,background .12s ease}
.wv-menu svg{width:26px;height:26px;display:block}
.wv-menu:hover{background:rgba(40,30,20,.92)}
.wv-menu.wv-down{transform:scale(.92);background:rgba(60,44,26,.95)}
.wv-menu::before{content:"";position:absolute;inset:-12px;border-radius:50%}
.wv-hud.wv-touch .wv-menu{width:72px;height:72px;right:18px;top:10px;z-index:1}
.wv-hud.wv-touch .wv-map{top:96px}
.wv-hud.wv-touch .wv-menu svg{width:34px;height:34px}
.wv-hud.wv-touch .wv-glint{right:104px}
.wv-party{position:absolute;left:24px;bottom:22px;display:flex;gap:10px}
.wv-chip{display:flex;align-items:center;gap:9px;min-width:168px;padding:5px 14px 5px 5px;border-radius:999px;background:var(--panel,rgba(16,12,10,.82));border:1px solid rgba(224,180,88,.38);box-shadow:0 4px 14px rgba(0,0,0,.3)}
.wv-chip img{width:42px;height:42px;border-radius:50%;flex:none}
.wv-chip .wv-col{display:flex;flex-direction:column;gap:3px;flex:1}
.wv-chip .wv-nm{display:flex;justify-content:space-between;font-family:var(--font-title,"Cinzel",serif);font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--pale-gold,#f3dba0)}
.wv-chip .wv-lv{color:var(--parchment,#e9dcc0);opacity:.75;letter-spacing:.06em}
.wv-chip .wv-bar{height:6px;border-radius:3px;background:rgba(255,255,255,.1);overflow:hidden}
.wv-chip .wv-bar i{display:block;height:100%;border-radius:3px;background:linear-gradient(90deg,#6fae55,#b7e08c);transition:width .4s ease}
.wv-chip.wv-low .wv-bar i{background:linear-gradient(90deg,#b8402c,#e0553d)}
.wv-chip .wv-hp{font-family:var(--font-title,"Cinzel",serif);font-size:11px;color:var(--parchment,#e9dcc0);opacity:.8}
.wv-chip.wv-ko{filter:grayscale(.85) brightness(.7)}
.wv-toasts{position:absolute;right:26px;top:262px;display:flex;flex-direction:column;align-items:flex-end;gap:8px}
.wv-toast{display:flex;align-items:center;gap:10px;max-width:420px;padding:8px 16px 8px 10px;background:var(--panel,rgba(16,12,10,.86));border:1px solid rgba(224,180,88,.5);border-left:3px solid var(--gold,#e0b458);border-radius:6px;font-size:19px;line-height:1.2;box-shadow:0 6px 18px rgba(0,0,0,.4);animation:wv-in .38s cubic-bezier(.2,.9,.3,1.2) both}
.wv-toast.wv-relic{border-left-color:var(--violet,#8a5cc4)}
.wv-toast.wv-out{animation:wv-out .5s ease forwards}
.wv-toast img,.wv-toast svg{width:26px;height:26px;flex:none}
.wv-toast b{font-family:var(--font-title,"Cinzel",serif);font-weight:700;font-size:13px;letter-spacing:.14em;text-transform:uppercase;color:var(--gold,#e0b458);display:block}
@keyframes wv-in{from{opacity:0;transform:translateX(40px)}to{opacity:1;transform:none}}
@keyframes wv-out{to{opacity:0;transform:translateX(30px)}}
.wv-prompt{position:absolute;left:0;top:0;display:flex;align-items:center;gap:8px;padding:4px 13px 4px 5px;white-space:nowrap;border-radius:999px;background:rgba(16,12,10,.88);border:1px solid rgba(224,180,88,.6);box-shadow:0 4px 14px rgba(0,0,0,.45);opacity:0;transform:translate(-50%,-100%) translateY(6px);transition:opacity .16s ease,transform .16s ease;pointer-events:none;cursor:pointer}
.wv-prompt.wv-on{opacity:1;transform:translate(-50%,-100%);pointer-events:auto}
.wv-prompt.wv-on.wv-veiled{opacity:0;pointer-events:none}
.wv-prompt kbd{min-width:24px;padding:2px 8px;border-radius:6px;text-align:center;font-family:var(--font-title,"Cinzel",serif);font-weight:700;font-size:12px;color:var(--ink,#15100d);background:linear-gradient(var(--pale-gold,#f3dba0),#c99a45);box-shadow:0 2px 0 #6b4a1c}
.wv-prompt .wv-verb{font-family:var(--font-title,"Cinzel",serif);font-size:14px;letter-spacing:.12em;text-transform:uppercase;color:var(--pale-gold,#f3dba0)}
.wv-prompt .wv-label{font-style:italic;font-size:16px;color:var(--parchment,#e9dcc0);opacity:.85}
.wv-hint{position:absolute;left:50%;bottom:132px;max-width:640px;padding:10px 22px;text-align:center;font-style:italic;font-size:21px;line-height:1.25;color:var(--ivory,#f5eedf);background:var(--panel,rgba(16,12,10,.84));border:1px solid rgba(224,180,88,.45);border-radius:8px;opacity:0;transform:translate(-50%,8px);transition:opacity .3s ease,transform .3s ease}
.wv-hint.wv-on{opacity:1;transform:translate(-50%,0)}
.wv-keys{position:absolute;left:50%;bottom:86px;display:flex;gap:18px;transform:translateX(-50%);padding:8px 18px;border-radius:999px;background:rgba(16,12,10,.78);border:1px solid rgba(224,180,88,.3);font-size:16px;color:var(--parchment,#e9dcc0);opacity:0;transition:opacity .6s ease;white-space:nowrap}
.wv-keys.wv-on{opacity:1}
.wv-keys kbd{font-family:var(--font-title,"Cinzel",serif);font-size:11px;padding:1px 6px;margin-right:5px;border-radius:5px;color:var(--ink,#15100d);background:var(--pale-gold,#f3dba0)}
.wv-keys .wv-kicon{display:inline-block;width:16px;height:16px;margin-right:5px;vertical-align:-3px;color:var(--pale-gold,#f3dba0)}
.wv-keys .wv-kicon svg{width:100%;height:100%;display:block}
.wv-map{position:absolute;right:26px;top:78px;display:flex;flex-direction:column;align-items:flex-end;gap:5px}
.wv-mini{display:block;border-radius:8px;border:1px solid rgba(224,180,88,.45);background:rgba(16,12,10,.55);box-shadow:0 4px 14px rgba(0,0,0,.35);pointer-events:auto;cursor:pointer;touch-action:manipulation}
.wv-mcap{display:flex;align-items:center;gap:6px;max-width:240px;padding:2px 10px 3px 8px;border-radius:999px;background:rgba(16,12,10,.78);font-family:var(--font-title,"Cinzel",serif);font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--pale-gold,#f3dba0);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.wv-mcap:empty{display:none}
.wv-mcap i{flex:none;width:9px;height:9px;border-radius:50%;border:1.5px solid var(--gold,#e0b458);box-shadow:0 0 6px rgba(255,210,122,.8)}
.wv-legend{position:absolute;right:calc(100% + 10px);top:0;display:grid;grid-template-columns:auto auto;gap:5px 9px;align-items:center;padding:10px 14px 11px 11px;border-radius:8px;background:var(--panel,rgba(16,12,10,.9));border:1px solid rgba(224,180,88,.45);box-shadow:0 6px 18px rgba(0,0,0,.45);font-size:15px;color:var(--parchment,#e9dcc0);white-space:nowrap;opacity:0;transform:translateX(8px);transition:opacity .2s ease,transform .2s ease}
.wv-legend.wv-on{opacity:1;transform:none}
.wv-legend h4{grid-column:1/-1;margin:0 0 2px;font-family:var(--font-title,"Cinzel",serif);font-size:11px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:var(--pale-gold,#f3dba0)}
.wv-legend svg{width:18px;height:18px;display:block}
/* Phones: main.js sets .ui-compact and --ui-zoom on #ui (the HUD's parent) when the stage is drawn below 0.72 of its
   size. The corner widgets are magnified like the menus (zoom scales their offsets too), the centred and
   world-anchored pills are scaled about their anchor instead, and the smallest labels grow, so no field HUD text
   reads under ~11 CSS px (844×390: stage 0.54, zoom 1.4). */
.ui-compact .wv-party,.ui-compact .wv-glint,.ui-compact .wv-menu,.ui-compact .wv-map,.ui-compact .wv-loc,.ui-compact .wv-toasts{zoom:var(--ui-zoom,1)}
.ui-compact .wv-card{max-width:600px}
.ui-compact .wv-pill{max-width:520px}
.ui-compact .wv-chip{min-width:190px}
.ui-compact .wv-chip .wv-nm{gap:10px;font-size:15px}
.ui-compact .wv-chip .wv-hp{font-size:14.5px}
.ui-compact .wv-mcap,.ui-compact .wv-legend,.ui-compact .wv-legend h4,.ui-compact .wv-toast b{font-size:14.5px}
.ui-compact .wv-mcap{max-width:330px}
.ui-compact .wv-prompt{transform-origin:50% 100%;transform:translate(-50%,-100%) translateY(6px) scale(var(--ui-zoom,1))}
.ui-compact .wv-prompt.wv-on{transform:translate(-50%,-100%) scale(var(--ui-zoom,1))}
.ui-compact .wv-prompt kbd,.ui-compact .wv-prompt .wv-verb,.ui-compact .wv-keys kbd{font-size:14.5px}
.ui-compact .wv-keys{bottom:126px;transform-origin:50% 100%;transform:translateX(-50%) scale(var(--ui-zoom,1))}
.ui-compact .wv-hint{bottom:190px;transform-origin:50% 100%;transform:translate(-50%,8px) scale(var(--ui-zoom,1))}
.ui-compact .wv-hint.wv-on{transform:translate(-50%,0) scale(var(--ui-zoom,1))}
`;

const GLINT_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><defs><radialGradient id="wvg" cx="35%" cy="30%" r="75%"><stop offset="0" stop-color="#fff3c2"/><stop offset=".5" stop-color="#e0b458"/><stop offset="1" stop-color="#8a5a1c"/></radialGradient></defs><circle cx="12" cy="12" r="10" fill="url(#wvg)" stroke="#6b4a1c" stroke-width="1.2"/><path d="M12 5.5l1.6 4.6 4.9.1-3.9 2.9 1.4 4.7-4-2.8-4 2.8 1.4-4.7-3.9-2.9 4.9-.1z" fill="#fff3c2" opacity=".85"/></svg>';
const RELIC_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l7 7-7 13-7-13z" fill="#b89cff" stroke="#f3dba0" stroke-width="1"/><path d="M5 9h14M12 2l-3 7 3 13 3-13z" fill="none" stroke="#f3dba0" stroke-width=".8" opacity=".8"/></svg>';
const BOOK_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5c3-1 6-1 9 1 3-2 6-2 9-1v14c-3-1-6-1-9 1-3-2-6-2-9-1z" fill="#f0e2c0" stroke="#6b4a1c" stroke-width="1"/><path d="M12 6v14" stroke="#6b4a1c"/></svg>';
const FLAG_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3v19" stroke="#e0b458" stroke-width="2"/><path d="M7 4h11l-3 4 3 4H7z" fill="#b8423a"/><circle cx="12" cy="8" r="2" fill="#e8c060"/></svg>';
const MENU_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M5 7h14M5 12h14M5 17h14"/></g><circle cx="19.5" cy="4.5" r="1.8" fill="#e0b458"/></svg>';
/** Compass whose needle (.wv-needle, pointing north at 0°) is turned toward the objective. */
const COMPASS_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10.4" fill="rgba(16,12,10,.55)" stroke="#e0b458" stroke-width="1.2"/><path d="M12 1.6v2.2M12 20.2v2.2M1.6 12h2.2M20.2 12h2.2" stroke="#e0b458" stroke-width="1" opacity=".7"/><g class="wv-needle"><path d="M12 4l3 8-3 8-3-8z" fill="#6b4a1c"/><path d="M12 4l3 8H9z" fill="#f3dba0"/></g><circle cx="12" cy="12" r="1.5" fill="#15100d"/></svg>';
/** Minimap legend glyphs (drawn the same way on the minimap canvas, see _drawMinimap). */
const LEGEND = [
  ['You', '<svg viewBox="0 0 18 18"><path d="M9 3.5l3.6 5.2H5.4z" fill="#fff"/><circle cx="9" cy="10.5" r="3.6" fill="#fff" stroke="#15100d" stroke-width="1.2"/></svg>'],
  ['Expedition Pennant', '<svg viewBox="0 0 18 18"><path d="M5.5 3v12.5" stroke="#3a2412" stroke-width="2.6"/><path d="M5.5 3v12.5" stroke="#e0b458" stroke-width="1.3"/><path d="M6 3.5h7.5l-2 2.6 2 2.6H6z" fill="#d84a3a" stroke="#3a2412" stroke-width=".8"/></svg>'],
  ['Merchant', '<svg viewBox="0 0 18 18"><circle cx="9" cy="9" r="5.6" fill="#e8c060" stroke="#4a3010" stroke-width="1.2"/><circle cx="9" cy="9" r="2.8" fill="none" stroke="#8a5a1c" stroke-width="1"/></svg>'],
  ['Guardian', '<svg viewBox="0 0 18 18"><path d="M3.8 8.4a5.2 5 0 1 1 10.4 0c0 1.8-1 2.8-2 3.3v2.3H5.8v-2.3c-1-.5-2-1.5-2-3.3z" fill="#e8483a" stroke="#2a0808" stroke-width="1.1"/><circle cx="7" cy="8.6" r="1.3" fill="#2a0808"/><circle cx="11" cy="8.6" r="1.3" fill="#2a0808"/></svg>'],
  ['The way on', '<svg viewBox="0 0 18 18"><path d="M5 3.5l7 5.5-7 5.5z" fill="#b8f0a0" stroke="#1a1020" stroke-width="1.2" stroke-linejoin="round"/></svg>'],
  ['A sealed way', '<svg viewBox="0 0 18 18"><path d="M5 3.5l7 5.5-7 5.5z" fill="#b07aff" stroke="#1a1020" stroke-width="1.2" stroke-linejoin="round"/></svg>'],
  ['Objective', '<svg viewBox="0 0 18 18"><circle cx="9" cy="9" r="6.2" fill="rgba(255,210,122,.18)" stroke="#ffd27a" stroke-width="1.8"/></svg>'],
];

/** Top-down exploration scene. */
export class WorldScene extends Scene {
  constructor(game) {
    super(game);
    this.zone = null;
    this.mode = 'idle';
    this.vt = 0;
    this._lastRender = null;
    this._pending = [];
    this.cam = { x: 0, y: 0 };
    this.debugOverlay = false;
    this.perf = { update: 0, render: 0, frames: 0 };
    this.battleToken = 0;
    this.lastBattle = null;
    this._pendingResult = null;
    this._after = null;
    this.titleCard = null;
    this.blackout = 0;
    this.transition = null;
    this._saveT = 0;
    this._stepT = 0;
    this._hintT = 0;
    this._sealedT = -Infinity;
    this._lastSaved = null;
    this._toasts = [];
    this._hud = {};
    this._hudCache = {};
    this._pointer = { active: false, x: 0, y: 0, downT: 0, downX: 0, downY: 0, target: null };
    this._flowTile = null;
    this.flow = null;
    this._camps = [];
    this._graceT = 0;
    this._idleMs = 0;
    this._loc = { mode: 'hidden', until: 0 };
    this._objText = null;
    this._legendOn = false;
    const forced = game.params?.get?.('worldQuality');
    this._autoQuality = forced !== 'low' && forced !== 'high';
    this.quality = this._autoQuality ? (sessionQuality ?? 'high') : forced;
    this._ftAvg = 1000 / 60;
    this._slowMs = 0;
  }

  // ─────────────────────────────────────────────────────────────── lifecycle

  /** @param {{zone?:string, x?:number, y?:number, arrival?:boolean}} params */
  enter(params = {}) {
    const game = this.game;
    if (!game.state) {
      console.warn('[world] no GameState — starting a fresh expedition');
      game.state = createNewGame();
    }
    this._stateRef = game.state;
    injectStyle();
    this._buildHud();
    this.fx = new Effects({ reducedFlashing: !!game.settings?.reducedFlashing, screenShake: game.settings?.screenShake !== false });
    const w = game.state.world ?? (game.state.world = {});
    let zone = typeof params.zone === 'string' && MAPS[params.zone] ? params.zone : (MAPS[w.zone] ? w.zone : 'shore');
    let x = Number.isFinite(params.x) ? params.x : undefined;
    let y = Number.isFinite(params.y) ? params.y : undefined;
    if (x === undefined && zone === w.zone && Number.isFinite(w.x) && Number.isFinite(w.y) && (w.x || w.y)) {
      x = w.x;
      y = w.y;
    }
    this._offDevice = game.input?.events?.on?.('device', () => {
      this._hudCache = {};
      this._refreshKeys();
      this._refreshMenuLabel();
    });
    this.loadZone(zone, x, y, { facing: w.facing });
    this.mode = 'play';
    this._arrive({ intro: !!params.arrival });
    game.debug = game.debug ?? {};
    game.debug.world = this;
  }

  exit() {
    // Only record our position into the expedition we were playing: a retry from the game-over screen (or a load)
    // swaps in another GameState before resetting to a fresh world, and must not inherit where the party fell.
    if (this.game.state === this._stateRef) this._savePos();
    try {
      this._offDevice?.();
    } catch {
      /* already detached */
    }
    this.renderer?.dispose();
    if (this.game.debug?.world === this) this.game.debug.world = null;
  }

  pause() {
    this._savePos();
    this._hpAtPause = this._partyHp();
    this._hud.root?.classList.add('wv-dim');
    this._setPrompt(null);
    // A dialogue or menu over the world: let the zone title card finish soon (after at least 1.6 s on screen)
    // instead of hanging above the dialogue box.
    const tc = this.titleCard;
    if (tc) tc.life = Math.min(tc.life, Math.max(tc.t, 1600) + 900);
  }

  resume(result) {
    if (this.mode !== 'battle') {
      this._hud.root?.classList.remove('wv-dim');
      // back from a dialogue, shop or menu: a moment before anything can jump the party
      this._graceT = GRACE_MS;
    }
    if (this.fx) {
      this.fx.reducedFlashing = !!this.game.settings?.reducedFlashing;
      this.fx.shakeEnabled = this.game.settings?.screenShake !== false;
    }
    this._hudCache = {};
    const game = this.game;
    // A battle result that arrived via pop() rather than onEnd()
    if (this.mode === 'battle' && result && typeof result === 'object' && result.outcome && !this._pendingResult) this._pendingResult = result;
    if (this.mode !== 'battle') {
      // rested at a flag (or healed from the menu): a little warmth over the party
      const hp = this._partyHp();
      if (this._hpAtPause !== undefined && hp > this._hpAtPause && this.party) {
        this.fx?.burst(this.party.x, this.party.y - 36, 'heal', { scale: 0.9 });
      }
      this._restoreMusic();
      // after resting at a flag: defeated regular spawns come back
      this._syncEnemies();
      // fast travel: someone moved the party in the GameState (or handed us a travel result)
      const travel = result && typeof result === 'object' ? (result.travel ?? (result.fastTravel ? result : null)) : null;
      const w = game.state?.world;
      if (travel && MAPS[travel.zone]) this._teleport(travel.zone, travel.x, travel.y);
      else if (w && this._lastSaved && (w.zone !== this._lastSaved.zone || Math.hypot((w.x ?? 0) - this._lastSaved.x, (w.y ?? 0) - this._lastSaved.y) > 0.75)) {
        if (MAPS[w.zone]) this._teleport(w.zone, w.x, w.y);
      }
    }
    if (this._after) {
      const fn = this._after;
      this._after = null;
      this._queue(fn);
    }
  }

  // ─────────────────────────────────────────────────────────────── zone loading

  /**
   * Build the zone: map, renderer, entities, camera. Position in tile units (continuous); integers = tile index.
   * @param {string} zone
   * @param {number} [x]
   * @param {number} [y]
   */
  loadZone(zone, x, y, { facing } = {}) {
    const def = MAPS[zone] ?? MAPS.shore;
    if (!MAPS[zone]) zone = 'shore';
    this.renderer?.dispose();
    this.zone = zone;
    this.def = def;
    this.map = parseMap(def, zone);
    this._camps = safeZones(def).map((z) => ({ x: z.x * TILE, y: z.y * TILE, r: z.r * TILE }));
    const props = def.entities.filter((e) => e.type === 'prop');
    const pr = this.game.pixelRatio || 1;
    this.renderer = new WorldRenderer(this.map, zone, { quality: clamp(pr, 1, 1.25), props, pixelRatio: pr });
    this.renderer.lowQuality = this.quality === 'low';
    this.atmo = new Atmosphere(zone);
    this.fx?.clear();
    this._buildEntities();
    const start = this._resolveStart(x, y);
    const looks = this._partyLooks();
    this.party = new PartyWalker(looks, start.x, start.y, facing ?? 'down');
    this.party.resetTrail();
    this._flowTile = null;
    this.flow = null;
    this._snapCamera();
    const t0 = performance.now();
    this.renderer.buildAll();
    this.buildMs = performance.now() - t0;
    this._buildMinimap();
    this._restoreMusic();
    this._savePos();
    this._hudCache = {};
    this._updateHud(true);
  }

  _partyLooks() {
    const party = this.game.state?.party ?? [];
    const ids = party.map((m) => CHARACTERS[m.id]?.look ?? m.id).filter(Boolean);
    const leader = ids[0] ?? 'gideon';
    const rest = ids.slice(1);
    for (const id of PARTY_ORDER) if (rest.length < 2 && id !== leader && !rest.includes(id)) rest.push(id);
    return [leader, ...rest.slice(0, 2)];
  }

  /**
   * Feet position (px) from tile coordinates (continuous, or integers = tile index). A position that is
   * blocked, off the map or in a pocket the start can't reach snaps to the nearest reachable tile (≤ 6
   * tiles away), otherwise the map's player start is used.
   */
  _resolveStart(x, y) {
    const map = this.map;
    const player = this.def.entities.find((e) => e.type === 'player') ?? { x: 2, y: 2 };
    const fromTile = (tx, ty) => ({ x: (tx + 0.5) * TILE, y: (ty + 0.6) * TILE });
    if (Number.isFinite(x) && Number.isFinite(y)) {
      const isInt = Number.isInteger(x) && Number.isInteger(y);
      const px = isInt ? (x + 0.5) * TILE : x * TILE;
      const py = isInt ? (y + 0.6) * TILE : y * TILE;
      const mask = map.reachableFrom(player.x, player.y);
      const tx = Math.floor(px / TILE);
      const ty = Math.floor(py / TILE);
      const reachable = map.inBounds(tx, ty) && mask[ty * map.w + tx] >= 0;
      if (reachable && !map.boxBlocked(px - 10, py - 6, px + 10, py + 6, this._solids())) return { x: px, y: py };
      const near = map.inBounds(tx, ty) ? map.nearestWalkable(tx, ty, { maxDist: 6, mask }) : null;
      if (near) {
        const p = fromTile(near.x, near.y);
        if (!map.boxBlocked(p.x - 10, p.y - 6, p.x + 10, p.y + 6, this._solids())) return p;
      }
    }
    return fromTile(player.x, player.y);
  }

  _encounterInfo(def) {
    const story = this.game.state?.world?.story ?? {};
    let encId = def.encounter;
    let tutorial = !!def.tutorial;
    if (tutorial && story.tutorial_done && def.later) {
      encId = def.later;
      tutorial = false;
    }
    const enc = ENCOUNTERS[encId];
    const enemies = enc?.enemies ?? [def.id];
    const looks = enemies.map((id) => ENEMIES[id]?.look ?? id);
    return { encounterId: encId, enemies, looks, boss: !!enc?.boss, tutorial: tutorial && !!enc?.tutorial, music: enc?.music };
  }

  _buildEntities() {
    const w = this.game.state.world;
    const ents = this.def.entities;
    this.enemies = [];
    this.bosses = [];
    this.things = [];
    this.exits = [];
    this.props = [];
    for (const e of ents) {
      switch (e.type) {
        case 'enemy':
          if (!w.defeated?.[e.id]) this.enemies.push(new RoamingEnemy(e, this._encounterInfo(e)));
          break;
        case 'boss':
          if (!w.bosses?.[e.id]) this.bosses.push(new BossEntity(e, this._encounterInfo(e)));
          break;
        case 'flag':
          this.things.push(new FlagEntity(e, !!w.flagsVisited?.[e.id]));
          break;
        case 'chest':
          this.things.push(new ChestEntity(e, !!w.chests?.[e.id]));
          break;
        case 'journal':
          this.things.push(new JournalEntity(e, !!w.journals?.[e.id]));
          break;
        case 'npc':
          this.things.push(new NpcEntity(e));
          break;
        case 'merchant':
          this.things.push(new MerchantEntity(e));
          break;
        case 'trainer':
          this.things.push(new TrainerEntity(e));
          break;
        case 'exit':
          this.exits.push(new ExitEntity(e));
          break;
        case 'prop':
          this.props.push(new PropEntity(e));
          break;
        default:
          break;
      }
    }
    for (const x of this.enemies) x.alpha = 1;
    // blocking footprints (for enemies' pathing & BFS)
    this.map.blockers.clear();
    for (const e of ents) {
      if (e.type === 'boss' && w.bosses?.[e.id]) continue;
      if (e.type === 'enemy' || e.type === 'exit' || e.type === 'player') continue;
      for (const f of entityFootprint(e)) this.map.setBlocked(f.x, f.y, true);
    }
    this._refreshExits();
  }

  _refreshExits() {
    const bosses = this.game.state?.world?.bosses ?? {};
    for (const x of this.exits) {
      const req = x.def.requires?.boss;
      const open = !req || !!bosses[req];
      if (open !== x.open) x.open = open;
      if (!open) x.openT = Math.min(x.openT, 0);
    }
  }

  /** Recreate regular spawns cleared by resting (keeps living ones). */
  _syncEnemies() {
    if (!this.def || !this.game.state) return;
    const w = this.game.state.world;
    const alive = new Map(this.enemies.filter((e) => e.dying < 0).map((e) => [e.id, e]));
    const next = [];
    for (const e of this.def.entities) {
      if (e.type !== 'enemy' || w.defeated?.[e.id]) continue;
      const cur = alive.get(e.id);
      if (cur) next.push(cur);
      else {
        const en = new RoamingEnemy(e, this._encounterInfo(e));
        en.alpha = 0;
        next.push(en);
      }
    }
    // keep dissolving ones until their animation ends
    for (const e of this.enemies) if (e.dying >= 0 && !e.dead) next.push(e);
    this.enemies = next;
  }

  _solids() {
    const out = [];
    for (const t of this.things) {
      const s = t.solid;
      if (s) out.push(s);
    }
    for (const b of this.bosses) out.push(b.solid);
    for (const x of this.exits) {
      const s = x.solid;
      if (s) out.push(s);
    }
    return out;
  }

  // ─────────────────────────────────────────────────────────────── arrival & title card

  _arrive({ intro = false } = {}) {
    const zone = this.zone;
    const w = this.game.state.world;
    this._graceT = GRACE_MS; // nothing pounces the moment the party steps into a zone
    w.story = w.story ?? {};
    const key = `${zone}_arrival`;
    const first = !w.story[key];
    this._showTitle();
    if (first && STORY.dialogues?.[key]) {
      w.story[key] = true;
      this.mode = 'busy';
      this._delay(intro ? 1500 : 1300, () => this._dialogue({ id: key }, () => {
        this.mode = 'play';
        if (!w.story.world_keys_seen) this._showKeys();
      }));
    } else if (!w.story.world_keys_seen) {
      this._showKeys();
    }
  }

  _showTitle() {
    const Z = ZONES[this.zone] ?? {};
    const lr = Z.levelRange;
    this.titleCard = {
      name: Z.name ?? this.zone,
      sub: Z.subtitle ?? '',
      level: lr ? `Recommended level ${lr[0]}–${lr[1]}` : '',
      t: 0,
      life: TITLE_LIFE,
    };
    this._titleBand = null;
    // the corner cartouche waits for the card to dock
    this._setLoc('hidden');
  }

  /**
   * Zone cartouche state: 'hidden' (arrival card on screen), 'full' (name, gold rule, objective) or 'compact'
   * (a one-line objective pill with the compass).
   */
  _setLoc(mode, fullMs = OBJECTIVE_FULL_MS) {
    const L = this._loc;
    if (mode === 'full') L.until = Math.max(L.mode === 'full' ? L.until : 0, this.vt + fullMs);
    if (L.mode === mode) return;
    L.mode = mode;
    const el = this._hud.loc;
    if (!el) return;
    el.classList.toggle('wv-hide', mode === 'hidden');
    el.classList.toggle('wv-compact', mode === 'compact');
  }

  /** Show the full objective again for at least `ms` (objective changed, map opened). */
  _expandObjective(ms = OBJECTIVE_FULL_MS) {
    if (this._loc.mode !== 'hidden') this._setLoc('full', ms);
  }

  /** Arrival card → cartouche → compact pill (and back when the party stops to look around). */
  _updateLoc(dt) {
    this._idleMs = this.party?.moving ? 0 : this._idleMs + dt;
    const L = this._loc;
    if (L.mode === 'hidden') {
      if (!this.titleCard || this.titleCard.t >= DOCK_AT) this._setLoc('full');
    } else if (L.mode === 'full') {
      if (this.vt > L.until && this._idleMs < OBJECTIVE_IDLE_MS) this._setLoc('compact');
    } else if (this._idleMs > OBJECTIVE_IDLE_MS) this._setLoc('full', 1500);
  }

  // ─────────────────────────────────────────────────────────────── update

  update(dt) {
    const t0 = performance.now();
    const game = this.game;
    const state = game.state;
    if (!state || !this.map) return;

    // queued actions (only when we are on top and not mid-fade)
    if (this._pending.length && !game.fading) {
      const list = this._pending.splice(0);
      for (const it of list) {
        if (it.at !== undefined && it.at > this.vt) this._pending.push(it);
        else this._safe(it.fn);
      }
    }
    if (this._pendingResult && this.mode === 'battle') {
      const r = this._pendingResult;
      this._pendingResult = null;
      this._handleBattleResult(r);
    }

    if (this.mode === 'transition') {
      this._updateTransition(dt);
      this._perf('update', t0);
      return;
    }

    for (const t of this.things) t.update?.(dt);
    for (const x of this.exits) x.update(dt);
    this.enemies = this.enemies.filter((e) => !e.dead);

    const playing = this.mode === 'play' && !game.fading;
    const input = game.input;
    if (playing && this._graceT > 0) this._graceT = Math.max(0, this._graceT - dt);
    this._updateLoc(dt);

    if (playing && input.pressed('menu')) {
      input.consume('menu');
      this._savePos();
      game.audio?.play?.('menu_open');
      this._push('pause', {});
      this._perf('update', t0);
      return;
    }

    // movement
    let axis = { x: 0, y: 0 };
    if (playing) {
      axis = input.axis();
      const ptr = this._pointerAxis(input);
      if (Math.hypot(axis.x, axis.y) > 0.05) this._pointer.target = null;
      else if (ptr) axis = ptr;
    }
    const solids = this._solids();
    this.party.update(dt, axis, this.map, solids);
    if (playing && this.party.moving) {
      this._stepT -= dt;
      if (this._stepT <= 0) {
        this._stepT = 300;
        game.audio?.play?.('step', { pitch: 0.9 + Math.random() * 0.2, volume: 0.4 });
      }
      if (this._hud.keys?.classList.contains('wv-on') && this.vt - (this._keysShownAt ?? 0) > 5000) this._hideKeys();
    }

    // flow field toward the player for chasing enemies
    const pt = worldToTile(this.party.x, this.party.y);
    if (!this._flowTile || this._flowTile.x !== pt.x || this._flowTile.y !== pt.y) {
      this._flowTile = pt;
      this.flow = this.map.bfs(pt.x, pt.y, { maxDist: 16, diagonal: true });
    }

    // enemies
    const env = {
      map: this.map, player: this.party, flow: this.flow, frozen: !playing, playerInvuln: this.party.invuln > 0,
      safe: this._camps, playerSafe: inSafe(this._camps, this.party.x, this.party.y), grace: this._graceT > 0,
      onNotice: () => game.audio?.play?.('telegraph', { volume: 0.3, pitch: 1.4 }),
    };
    for (const e of this.enemies) {
      const hit = e.update(dt, env);
      if (hit === 'contact' && playing && this.mode === 'play') {
        const dx = e.x - this.party.x;
        const dy = e.y - this.party.y;
        const d = Math.hypot(dx, dy) || 1;
        const behind = (dx / d) * this.party.fx + (dy / d) * this.party.fy < -0.35;
        this._startEnemyBattle(e, behind ? 'enemy' : null);
        break;
      }
    }

    // bosses
    for (const b of this.bosses) {
      b.update(dt, this.party);
      if (playing && this.mode === 'play' && Math.hypot(b.x - this.party.x, b.y - this.party.y) < b.trigger) this._bossEncounter(b);
    }

    // exits
    if (playing && this.mode === 'play') this._checkExits();

    // interaction target + confirm
    const target = playing && this.mode === 'play' ? this._findTarget() : null;
    this._target = target;
    if (playing && this.mode === 'play' && input.pressed('confirm')) {
      input.consume('confirm');
      if (target) this._interact(target);
      else this._swing();
    }
    if (playing && this._pointer.tap) {
      const tap = this._pointer.tap;
      this._pointer.tap = null;
      if (this.mode === 'play') {
        const foe = this._tapFoe(tap);
        if (target && Math.hypot(tap.x - target.focus.x, tap.y - (target.focus.y - 20)) < 60) this._interact(target);
        else if (foe) {
          // tapping a foe beside the party turns toward it and swings (the ambush strike)
          this._face(foe.x - this.party.x, foe.y - this.party.y);
          this._swing();
        } else if (Math.hypot(tap.x - this.party.x, tap.y - (this.party.y - 30)) < 50) this._swing();
      }
    }

    // swing hit test during the active frames
    if (this.party.swinging && this.party.swingT > 60 && this.party.swingT < 220 && this.mode === 'play') this._swingHit();

    this.fx.update(dt);
    this._updateCamera(dt);

    this._saveT -= dt;
    if (this._saveT <= 0) {
      this._saveT = SAVE_EVERY;
      this._savePos();
    }
    this._updateHud(false);
    this._perf('update', t0);
  }

  _perf(key, t0) {
    const ms = performance.now() - t0;
    this.perf[key] = this.perf[key] * 0.92 + ms * 0.08;
  }

  _safe(fn) {
    try {
      fn();
    } catch (err) {
      this.game.reportError?.(this, 'queued action', err);
    }
  }

  _queue(fn) {
    this._pending.push({ fn });
  }

  _delay(ms, fn) {
    this._pending.push({ fn, at: this.vt + ms });
  }

  /** Push a scene, tolerating missing registrations. */
  _push(name, params) {
    try {
      this.game.scenes.push(name, params);
      return true;
    } catch (err) {
      console.warn(`[world] could not open "${name}": ${err?.message ?? err}`);
      return false;
    }
  }

  /**
   * Show a dialogue; `then` runs exactly once afterwards (from onDone or when we resume).
   * @param {{id?:string, lines?:object[]}} what
   * @param {Function} [then]
   */
  _dialogue(what, then) {
    let done = false;
    const once = () => {
      if (done) return;
      done = true;
      if (this._after === once) this._after = null;
      if (then) this._queue(then);
    };
    this._after = once;
    const ok = this._push('dialogue', { ...what, onDone: once });
    if (!ok) once();
  }

  /** A roaming foe under a tap (world px) that is close enough to strike. */
  _tapFoe(tap) {
    let best = null;
    let bestD = 46;
    for (const e of this.enemies) {
      if (e.dying >= 0 || e.alpha < 0.6) continue;
      if (Math.hypot(e.x - this.party.x, e.y - this.party.y) > 115) continue;
      const d = Math.hypot(tap.x - e.x, tap.y - (e.y - 24));
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    return best;
  }

  /** Turn the leader toward a direction (for tap strikes). */
  _face(dx, dy) {
    const d = Math.hypot(dx, dy);
    if (d < 1) return;
    const p = this.party;
    p.fx = dx / d;
    p.fy = dy / d;
    if (Math.abs(p.fx) > 0.2) p.spriteFacing = p.fx < 0 ? -1 : 1;
  }

  _pointerAxis(input) {
    const p = input.pointer;
    const P = this._pointer;
    if (!p) return null;
    const wx = p.x + this.cam.x;
    const wy = p.y + this.cam.y;
    if (p.pressed && !p.overUI && p.inside) {
      P.active = true;
      P.downT = this.vt;
      P.downX = p.x;
      P.downY = p.y;
      P.target = { x: wx, y: wy };
    }
    if (P.active && p.down) P.target = { x: wx, y: wy };
    if (P.active && (p.released || !p.down)) {
      P.active = false;
      const quick = this.vt - P.downT < 220 && Math.hypot(p.x - P.downX, p.y - P.downY) < 14;
      if (quick) {
        P.tap = { x: wx, y: wy };
        // a quick tap near the party means "act here", not "walk"
        if (Math.hypot(wx - this.party.x, wy - (this.party.y - 30)) < 90) P.target = null;
      }
    }
    if (!P.target) return null;
    const dx = P.target.x - this.party.x;
    const dy = P.target.y - this.party.y;
    const d = Math.hypot(dx, dy);
    if (d < 10) {
      P.target = null;
      return null;
    }
    if (!P.active && this.party.speed < 5 && this.vt - P.downT > 400) {
      P.target = null; // blocked while walking to a clicked point
      return null;
    }
    const k = Math.min(1, d / 40);
    return { x: (dx / d) * k, y: (dy / d) * k };
  }

  _updateCamera(dt, snap = false) {
    const map = this.map;
    const tx = this.party.x - VIEW_W / 2;
    const ty = this.party.y - 40 - VIEW_H / 2;
    const clampAxis = (v, size, view) => (size <= view ? (size - view) / 2 : clamp(v, 0, size - view));
    const cx = clampAxis(tx, map.pxW, VIEW_W);
    const cy = clampAxis(ty, map.pxH, VIEW_H);
    if (snap) {
      this.cam.x = cx;
      this.cam.y = cy;
      return;
    }
    const k = 1 - Math.exp(-dt / 110);
    this.cam.x += (cx - this.cam.x) * k;
    this.cam.y += (cy - this.cam.y) * k;
  }

  _snapCamera() {
    this._updateCamera(0, true);
  }

  _savePos() {
    const st = this.game.state;
    if (!st || !this.party || !this.zone) return;
    const w = st.world;
    w.zone = this.zone;
    w.x = Math.round((this.party.x / TILE) * 100) / 100;
    w.y = Math.round((this.party.y / TILE) * 100) / 100;
    w.facing = this.party.facingName;
    this._lastSaved = { zone: w.zone, x: w.x, y: w.y };
  }

  /**
   * After the finale the journal (saved by the ending) should not reopen in the middle of the arena, next to the
   * summit's roaming guards: the expedition makes camp at this zone's pennant instead (a safe camp).
   */
  _campAtPennant() {
    const flag = this.things.find((t) => t.type === 'flag');
    if (!this.party || !flag) return;
    // Move the party itself: every later save (this scene's exit included) records where it stands.
    const stand = this._standTile(flag);
    this.party.x = (stand.x + 0.5) * TILE;
    this.party.y = (stand.y + 0.6) * TILE;
    this.party.fx = 0;
    this.party.fy = -1;
    this.party.resetTrail();
  }

  _partyHp() {
    return (this.game.state?.party ?? []).reduce((sum, m) => sum + (m.alive === false ? 0 : Math.max(0, m.hp ?? 0)), 0);
  }

  _restoreMusic() {
    const track = ZONES[this.zone]?.music;
    if (track) this.game.audio?.playMusic?.(track, { fade: 900 });
  }

  // ─────────────────────────────────────────────────────────────── interaction

  _findTarget() {
    const p = this.party;
    const probeX = p.x + p.fx * 18;
    const probeY = p.y + p.fy * 14;
    let best = null;
    let bestD = Infinity;
    for (const t of this.things) {
      if (!t.prompt()) continue;
      const f = t.focus;
      const d = Math.hypot(p.x - f.x, p.y - f.y);
      if (d > t.reach) continue;
      const dp = Math.hypot(probeX - f.x, probeY - f.y);
      if (dp < bestD) {
        bestD = dp;
        best = t;
      }
    }
    for (const x of this.exits) {
      const [x0, y0, x1, y1] = x.rect;
      const dx = Math.max(x0 - p.x, 0, p.x - x1);
      const dy = Math.max(y0 - p.y, 0, p.y - y1);
      const d = Math.hypot(dx, dy);
      if (d < 34 && d < bestD) {
        bestD = d;
        best = x;
      }
    }
    return best;
  }

  _interact(t) {
    const audio = this.game.audio;
    this._savePos();
    switch (t.type) {
      case 'flag':
        this._useFlag(t);
        break;
      case 'chest':
        this._openChest(t);
        break;
      case 'journal':
        this._readJournal(t);
        break;
      case 'npc':
        audio?.play?.('ui_confirm', { volume: 0.6 });
        this._dialogue({ id: t.def.dialogue });
        break;
      case 'merchant':
        this._useMerchant(t);
        break;
      case 'trainer':
        this._useTrainer(t);
        break;
      case 'exit':
        if (t.open) this._travel(t);
        else this._sealedHint(t);
        break;
      default:
        break;
    }
  }

  _standTile(t) {
    const map = this.map;
    for (const [ox, oy] of [[0, 1], [-1, 0], [1, 0], [0, -1], [-1, 1], [1, 1]]) {
      if (map.isWalkable(t.tx + ox, t.ty + oy)) return { x: t.tx + ox, y: t.ty + oy };
    }
    return { x: t.tx, y: t.ty + 1 };
  }

  _useFlag(flag) {
    const w = this.game.state.world;
    w.story = w.story ?? {};
    const stand = this._standTile(flag);
    const open = () => {
      visitFlag(this.game.state, flag.id, { zone: this.zone, x: stand.x, y: stand.y, name: flag.name });
      flag.visited = true;
      this.game.audio?.play?.('flag');
      this.fx.burst(flag.x + 12, flag.y - 70, 'heal', { scale: 0.7 });
      this._push('flag', { flagId: flag.id, name: flag.name });
    };
    if (!w.story[FIRST_FLAG_KEY]) {
      w.story[FIRST_FLAG_KEY] = true;
      visitFlag(this.game.state, flag.id, { zone: this.zone, x: stand.x, y: stand.y, name: flag.name });
      flag.visited = true;
      this.game.audio?.play?.('flag');
      this._toast(`<b>Expedition Pennant</b>${esc(flag.name)}`, FLAG_SVG);
      this._dialogue({ id: FIRST_FLAG_KEY }, open);
    } else open();
  }

  _openChest(chest) {
    if (chest.opened) return;
    const st = this.game.state;
    const loot = chest.def.loot ?? { glint: 10 };
    const desc = addLoot(st, loot);
    st.world.chests = st.world.chests ?? {};
    st.world.chests[chest.id] = true;
    chest.opened = true;
    const audio = this.game.audio;
    audio?.play?.('chest');
    if (loot.glint) setTimeout(() => audio?.play?.('coin'), 220);
    this.fx.burst(chest.x, chest.y - 18, 'buff', { scale: 0.8 });
    this.fx.sparks(chest.x, chest.y - 20, { color: PALETTE.paleGold, count: 16, speed: 220, angle: -Math.PI / 2, spread: 1.6, gravity: 380 });
    if (loot.relic) {
      const r = RELICS[loot.relic];
      const dupe = /duplicate/i.test(desc);
      this._toast(`<b>${dupe ? 'Relic (duplicate)' : 'Relic found'}</b>${esc(r?.name ?? loot.relic)}${dupe ? ` <i>· ${esc(desc.split('—')[1]?.trim() ?? '')}</i>` : ''}`, RELIC_SVG, 'wv-relic');
    } else if (loot.shard) {
      const up = UPGRADES[loot.shard];
      const icon = safeIcon(loot.shard, 26);
      this._toast(`<b>${esc(up?.name ?? 'Shard')}</b>${esc(desc.split('—')[1]?.trim() ?? desc)}`, icon ? `<img src="${icon}" alt="">` : RELIC_SVG);
    } else if (loot.glint) {
      this._toast(`<b>Glint</b>+${Math.floor(loot.glint)}`, GLINT_SVG);
      this._bumpGlint();
    } else {
      this._toast(esc(desc), GLINT_SVG);
    }
    this._updateHud(true);
  }

  _readJournal(j) {
    const st = this.game.state;
    const J = STORY.journals?.[j.id];
    if (!J) return;
    const firstRead = !st.world.journals?.[j.id];
    st.world.journals = st.world.journals ?? {};
    st.world.journals[j.id] = true;
    j.read = true;
    this.game.audio?.play?.('ui_confirm', { volume: 0.7, pitch: 0.9 });
    if (firstRead) this._toast(`<b>Journal recovered</b>${esc(J.title)}`, BOOK_SVG);
    this._dialogue({ lines: journalLines(J) });
  }

  _useMerchant(m) {
    const w = this.game.state.world;
    w.story = w.story ?? {};
    const shopId = m.def.shopId;
    const greet = m.def.greet === false ? null : (m.def.greet ?? 'merchant_greet');
    const key = `greet_${shopId}`;
    const open = () => this._push('shop', { shopId });
    this.game.audio?.play?.('ui_confirm', { volume: 0.6 });
    if (greet && !w.story[key] && STORY.dialogues?.[greet] && (greet !== 'merchant_greet' || !w.story.merchant_greet)) {
      w.story[key] = true;
      if (greet === 'merchant_greet') w.story.merchant_greet = true;
      this._dialogue({ id: greet }, open);
    } else {
      w.story[key] = true;
      open();
    }
  }

  _useTrainer() {
    const w = this.game.state.world;
    w.story = w.story ?? {};
    const fight = () => this._startBattle({
      encounterId: 'training_dummy', enemies: ENCOUNTERS.training_dummy?.enemies ?? ['dummy'], zone: 'training', practice: true, ambush: null, boss: false, tutorial: false,
    });
    if (!w.story.trainer_greet) {
      w.story.trainer_greet = true;
      this._dialogue({ id: 'trainer_greet' }, fight);
    } else fight();
  }

  _sealedHint(exit) {
    const boss = exit.def.requires?.boss;
    const name = ENEMIES[boss]?.name ?? 'something';
    this._hint(`The way is sealed… ${name} still keeps its watch.`);
    this.game.audio?.play?.('ui_error', { volume: 0.5 });
  }

  _checkExits() {
    const p = this.party;
    for (const x of this.exits) {
      const [x0, y0, x1, y1] = x.rect;
      const inside = p.x > x0 + 2 && p.x < x1 - 2 && p.y > y0 + 2 && p.y < y1 - 2;
      if (x.open && inside) {
        this._travel(x);
        return;
      }
      if (!x.open) {
        const dx = Math.max(x0 - p.x, 0, p.x - x1);
        const dy = Math.max(y0 - p.y, 0, p.y - y1);
        if (Math.hypot(dx, dy) < 16 && this.vt - this._sealedT > 3500) {
          this._sealedT = this.vt;
          this._sealedHint(x);
        }
      }
    }
  }

  _travel(exit) {
    const to = exit.def.to;
    if (!MAPS[to] || this.mode !== 'play') return;
    this.mode = 'zoning';
    this._savePos();
    this._setPrompt(null);
    this.game.audio?.play?.('ui_confirm', { volume: 0.5, pitch: 0.8 });
    const go = () => {
      this.loadZone(to, exit.def.toX, exit.def.toY, { facing: exit.def.facing ?? this.party?.facingName });
    };
    const done = () => {
      this.mode = 'play';
      this._arrive();
    };
    if (typeof this.game.fade === 'function') this.game.fade(420, go, 520).then(done);
    else {
      go();
      done();
    }
  }

  /** Fast travel / debug relocation (fades). */
  _teleport(zone, x, y) {
    if (!MAPS[zone]) return;
    const sameZone = zone === this.zone;
    this.mode = 'zoning';
    const go = () => {
      if (sameZone) {
        const p = this._resolveStart(x, y);
        this.party.x = p.x;
        this.party.y = p.y;
        this.party.resetTrail();
        this._snapCamera();
        this._savePos();
      } else this.loadZone(zone, x, y);
    };
    const done = () => {
      this.mode = 'play';
      if (!sameZone) this._arrive();
    };
    if (typeof this.game.fade === 'function') this.game.fade(300, go, 400).then(done);
    else {
      go();
      done();
    }
  }

  /** Public helper (bench / debug): jump to a zone and tile. */
  teleport(zone, x, y) {
    this._teleport(zone, x, y);
  }

  _swing() {
    if (!this.party.swing()) return;
    this.game.audio?.play?.('swing', { pitch: 0.95 + Math.random() * 0.1 });
    const p = this.party;
    const ang = Math.atan2(p.fy, p.fx);
    this.fx.slash(p.x + p.fx * 30, p.y - 26 + p.fy * 22, { angle: ang + Math.PI / 2, length: 70, width: 7, life: 200, color: PALETTE.paleGold, curve: 0.55, flip: p.fx < 0 });
    this._swingDone = false;
  }

  _swingHit() {
    if (this._swingDone) return;
    const p = this.party;
    let best = null;
    let bestD = Infinity;
    for (const e of this.enemies) {
      if (e.dying >= 0 || e.alpha < 0.6) continue;
      const dx = e.x - p.x;
      const dy = e.y - p.y;
      const d = Math.hypot(dx, dy);
      if (d > 72) continue;
      const dot = d > 0 ? (dx * p.fx + dy * p.fy) / d : 1;
      if (dot < 0.25 && d > 28) continue;
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    if (best) {
      this._swingDone = true;
      this.fx.burst(best.x, best.y - 30, 'hit', { dir: p.fx < 0 ? -1 : 1, scale: 0.8 });
      this.game.audio?.play?.('hit', { volume: 0.8 });
      this._startEnemyBattle(best, 'party');
    }
  }

  // ─────────────────────────────────────────────────────────────── battles

  _startEnemyBattle(enemy, ambush) {
    const info = enemy.info;
    this._startBattle({
      encounterId: info.encounterId, enemies: info.enemies, ambush, boss: false, tutorial: !!info.tutorial, spawnId: enemy.id, music: info.music,
    });
  }

  _bossEncounter(boss) {
    if (this.mode !== 'play') return;
    this.mode = 'busy';
    this._savePos();
    this._setPrompt(null);
    this.party.vx = 0;
    this.party.vy = 0;
    this.game.audio?.play?.('telegraph_red', { volume: 0.6 });
    const go = () => this._startBattle({
      encounterId: boss.info.encounterId, enemies: boss.info.enemies, ambush: null, boss: true, tutorial: false, bossId: boss.id, music: boss.info.music,
      postDialogue: boss.def.postDialogue,
    }, true);
    if (boss.def.dialogue && STORY.dialogues?.[boss.def.dialogue]) this._dialogue({ id: boss.def.dialogue }, go);
    else go();
  }

  /**
   * Freeze, flash and shatter, then push the battle scene.
   * @param {object} opts battle params (without onEnd / zone)
   */
  _startBattle(opts, force = false) {
    if (this.mode !== 'play' && !(force && this.mode === 'busy')) return;
    this.mode = 'transition';
    this._savePos();
    this._setPrompt(null);
    this.party.vx = 0;
    this.party.vy = 0;
    const token = ++this.battleToken;
    const zoneBg = opts.zone ?? ZONES[this.zone]?.battleBg ?? this.zone;
    this.lastBattle = { ...opts, zone: zoneBg, token };
    this.game.audio?.play?.('encounter');
    this._hud.root?.classList.add('wv-dim');
    this.transition = { t: 0, token, snapshot: null, shards: null, pushed: false, cx: this.party.x - this.cam.x, cy: this.party.y - 30 - this.cam.y, prepared: false };
  }

  _updateTransition(dt) {
    const tr = this.transition;
    if (!tr) {
      this.mode = 'play';
      return;
    }
    tr.t += dt;
    if (!tr.prepared && tr.t > 30) {
      tr.prepared = true;
      try {
        prepareBattleBackground(this.lastBattle.zone, { scale: this.game.canvas.width / VIEW_W });
      } catch (err) {
        console.warn('[world] battle background prewarm failed', err);
      }
    }
    if (tr.t >= TRANSITION_MS && !tr.pushed) {
      tr.pushed = true;
      this.mode = 'battle';
      const b = this.lastBattle;
      const token = tr.token;
      const params = {
        encounterId: b.encounterId, enemies: b.enemies, zone: b.zone, ambush: b.ambush ?? null, boss: !!b.boss, practice: !!b.practice,
        tutorial: !!b.tutorial, spawnId: b.spawnId, bossId: b.bossId, music: b.music,
        onEnd: (result) => this._onBattleEnd(token, result),
      };
      if (!this._push('battle', params)) {
        this.mode = 'play';
        this.transition = null;
        this.blackout = 1;
        this._hud.root?.classList.remove('wv-dim');
      }
    }
  }

  _onBattleEnd(token, result) {
    if (token !== this.battleToken || !this.lastBattle || this.lastBattle.handled) return;
    this._pendingResult = result ?? { outcome: 'victory' };
  }

  _handleBattleResult(result) {
    const b = this.lastBattle;
    if (!b || b.handled) return;
    b.handled = true;
    this.transition = null;
    this.mode = 'play';
    this.blackout = 1;
    this._graceT = GRACE_MS;
    this._hud.root?.classList.remove('wv-dim');
    const st = this.game.state;
    const outcome = result?.outcome ?? 'victory';
    this._restoreMusic();
    this._hudCache = {};
    if (b.practice) {
      this._updateHud(true);
      return;
    }
    if (outcome === 'victory') {
      if (b.spawnId) {
        markDefeated(st, b.spawnId);
        const e = this.enemies.find((x) => x.id === b.spawnId);
        e?.kill();
        if (b.tutorial) {
          st.world.story = st.world.story ?? {};
          st.world.story.tutorial_done = true;
        }
      }
      if (b.bossId) {
        markDefeated(st, b.bossId, { boss: true });
        const boss = this.bosses.find((x) => x.id === b.bossId);
        this.bosses = this.bosses.filter((x) => x.id !== b.bossId);
        if (boss) {
          this.fx.burst(boss.x, boss.y - 60, 'ko', { scale: 1.6, color: PALETTE.paleGold });
          const fp = entityFootprint(boss.def);
          for (const f of fp) this.map.setBlocked(f.x, f.y, false);
        }
        this._refreshExits();
        const post = b.postDialogue;
        const finale = b.bossId === 'stillkeeper';
        const after = () => {
          if (finale) {
            this._campAtPennant();
            this._savePos();
            try {
              this.game.scenes.reset('ending', {});
            } catch (err) {
              console.warn('[world] ending scene unavailable', err);
            }
            return;
          }
          const ex = this.exits.find((x) => x.def.requires?.boss === b.bossId);
          if (ex) this._hint(`The way to ${ZONES[ex.def.to]?.name ?? 'the next zone'} is open.`, 4200);
        };
        this.mode = 'busy';
        this._delay(500, () => {
          if (post && STORY.dialogues?.[post]) this._dialogue({ id: post }, () => {
            this.mode = 'play';
            after();
          });
          else {
            this.mode = 'play';
            after();
          }
        });
      }
    } else if (outcome === 'fled') {
      this.party.invuln = 2000;
      const e = this.enemies.find((x) => x.id === b.spawnId);
      e?.knockBack(this.party.x, this.party.y, { map: this.map });
    } else if (outcome === 'defeat') {
      this._savePos();
      this._push('gameover', {});
    }
    this._updateHud(true);
  }

  // ─────────────────────────────────────────────────────────────── render

  render(ctx) {
    const t0 = performance.now();
    const game = this.game;
    const now = game.time;
    const rdt = this._lastRender === null ? 16 : clamp(now - this._lastRender, 0, 50);
    this._lastRender = now;
    this.vt += rdt;
    this._watchFrameTime(rdt);
    if (!this.map || !this.renderer) {
      ctx.fillStyle = PALETTE.ink;
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
      return;
    }
    const t = this.vt;
    const tr = this.transition;
    if (tr && tr.snapshot) {
      this._renderShatter(ctx, tr);
      this._perf('render', t0);
      return;
    }
    this.atmo.update(rdt);
    const pr = game.pixelRatio || 1;
    this.renderer.pixelRatio = pr;
    const shake = this.fx.shakeOffset();
    const cam = { x: Math.round((this.cam.x - shake.x) * pr) / pr, y: Math.round((this.cam.y - shake.y) * pr) / pr };
    this.renderer.drawUnderlay(ctx, cam, t);
    ctx.save();
    ctx.translate(-cam.x, -cam.y);
    this.renderer.drawGround(ctx, cam);
    this.renderer.drawWaterFx(ctx, cam, t);
    this.renderer.drawLiveFloor(ctx, cam, t);

    // y-sorted world
    const list = [];
    this.renderer.collectTall(cam, list);
    const vis = (x, y, m = 200) => x > cam.x - m && x < cam.x + VIEW_W + m && y > cam.y - 60 && y < cam.y + VIEW_H + 320;
    for (const p of this.props) if (vis(p.x, p.y, 320)) p.collect(list, t, this.party);
    for (const x of this.exits) if (vis(x.x, x.y)) x.collect(list, t);
    for (const th of this.things) if (vis(th.x, th.y)) th.collect(list, t, this.party);
    for (const b of this.bosses) if (vis(b.x, b.y, 260)) b.collect(list, t);
    for (const e of this.enemies) if (vis(e.x, e.y)) e.collect(list, t);
    this.party.collect(list, t);
    list.sort((a, b) => a.y - b.y);
    const px = this.party.x;
    const py = this.party.y;
    let occluded = false;
    for (const d of list) {
      if (d.kind === 'tall') {
        // see-through bubble: canopies just in front of (south of) the party fade so the path stays readable
        let alpha = 1;
        const dy = d.y - py;
        if (dy > 0 && dy < 175) {
          const dx = Math.abs(d.x - px);
          if (dx < 130 && dy < 160) alpha = 0.3 + 0.7 * smooth(40, 130, dx) * smooth(20, 160, dy + 40);
          const b = this.renderer.tallBounds(d);
          if (b && px > b.x0 && px < b.x1 && py - 20 > b.y0) occluded = true;
        }
        this.renderer.drawTall(ctx, d, t, alpha);
      } else if (d.kind === 'prop' && d.ref?.bounds && d.y > py) {
        const b = d.ref.bounds();
        if (b && px > b.x0 + 6 && px < b.x1 - 6 && py - 20 > b.y0 && py < d.y) occluded = true;
        d.draw(ctx);
      } else d.draw(ctx);
    }
    // x-ray: a faint silhouette of the party through whatever hides it
    if (occluded) {
      ctx.save();
      ctx.globalAlpha = 0.38;
      const again = [];
      this.party.collect(again, t);
      for (const d of again) d.draw(ctx);
      ctx.restore();
    }
    this.fx.render(ctx);
    if (this.debugOverlay) this._renderDebug(ctx, cam);
    ctx.restore();

    this.atmo.drawParticles(ctx, cam, t);
    this.atmo.drawLight(ctx, t, { reduced: !!game.settings?.reducedFlashing, low: this.quality === 'low' });
    this.fx.renderScreen(ctx);
    this._renderTitle(ctx, rdt);
    this._positionPrompt(cam);

    // battle transition: the first frame captures the scene (before the flash) for the shatter
    if (tr && !tr.snapshot) {
      this._captureSnapshot(tr);
      this._renderFlash(ctx, tr);
    }
    if (this.blackout > 0) {
      ctx.fillStyle = `rgba(0,0,0,${this.blackout})`;
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
      this.blackout = Math.max(0, this.blackout - rdt / 450);
    }
    if (this.debugOverlay) this._renderDebugScreen(ctx);
    this._perf('render', t0);
  }

  /**
   * Software-rasterised canvases (blocklisted GPUs, VMs, remote desktops) cannot keep up with the full world look:
   * after a sustained slow stretch of exploring, drop to the low budget for the rest of the session.
   */
  _watchFrameTime(rdt) {
    if (!this._autoQuality || this.quality === 'low') return;
    const g = this.game;
    if (g.hidden || g.fading || this.mode !== 'play' || !this.isTop || !rdt) {
      this._slowMs = 0;
      return;
    }
    this._ftAvg += (rdt - this._ftAvg) * 0.1;
    this._slowMs = this._ftAvg > LOW_QUALITY_FRAME_MS ? this._slowMs + rdt : 0;
    if (this._slowMs > LOW_QUALITY_AFTER_MS) this.setQuality('low');
  }

  /**
   * Choose the render budget: 'high' (full look) or 'low' (no underlay glints or canopy sway, grade folded into
   * cached light layers).
   * @param {'high'|'low'} q
   */
  setQuality(q) {
    this.quality = q === 'low' ? 'low' : 'high';
    sessionQuality = this.quality;
    if (this.renderer) this.renderer.lowQuality = this.quality === 'low';
  }

  _renderFlash(ctx, tr) {
    const k = this.game.settings?.reducedFlashing ? 0.3 : 1;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(tr.cx, tr.cy, 0, tr.cx, tr.cy, 520);
    g.addColorStop(0, `rgba(255,245,220,${0.9 * k})`);
    g.addColorStop(1, 'rgba(255,245,220,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.restore();
  }

  _captureSnapshot(tr) {
    const src = this.game.canvas;
    const c = makeCanvas(src.width, src.height);
    if (!c) return;
    c.getContext('2d').drawImage(src, 0, 0);
    tr.snapshot = c;
    tr.shards = makeShards(tr.cx, tr.cy);
  }

  _renderShatter(ctx, tr) {
    const pr = this.game.pixelRatio || 1;
    const t = tr.t;
    const crackT = 150;
    ctx.fillStyle = '#050305';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    const e = clamp((t - crackT) / (TRANSITION_MS - crackT), 0, 1);
    const ease = e * e;
    for (const s of tr.shards) {
      const k = ease;
      const ox = s.vx * k * 340;
      const oy = s.vy * k * 340 + k * k * 160;
      const rot = s.vr * k * 2.4;
      const sc = 1 + k * 0.25;
      ctx.save();
      ctx.globalAlpha = 1 - smooth(0.7, 1, e);
      ctx.translate(s.cx + ox, s.cy + oy);
      ctx.rotate(rot);
      ctx.scale(sc, sc);
      ctx.translate(-s.cx, -s.cy);
      ctx.beginPath();
      ctx.moveTo(s.pts[0], s.pts[1]);
      for (let i = 2; i < s.pts.length; i += 2) ctx.lineTo(s.pts[i], s.pts[i + 1]);
      ctx.closePath();
      ctx.clip();
      const [bx, by, bw, bh] = s.bbox;
      ctx.drawImage(tr.snapshot, bx * pr, by * pr, bw * pr, bh * pr, bx, by, bw, bh);
      if (e > 0) {
        ctx.fillStyle = `rgba(255,236,190,${0.22 * (1 - e)})`;
        ctx.fillRect(bx, by, bw, bh);
        // gilded edge on every flying shard
        ctx.strokeStyle = `rgba(243,219,160,${0.8 * (1 - e)})`;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      ctx.restore();
      if (t < crackT + 120) {
        ctx.strokeStyle = `rgba(255,248,230,${0.8 * (1 - clamp((t - crackT) / 120, 0, 1))})`;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(s.pts[0] + ox, s.pts[1] + oy);
        for (let i = 2; i < s.pts.length; i += 2) ctx.lineTo(s.pts[i] + ox, s.pts[i + 1] + oy);
        ctx.closePath();
        ctx.stroke();
      }
    }
    if (t < 180) {
      const k = this.game.settings?.reducedFlashing ? 0.2 : 0.85;
      ctx.fillStyle = `rgba(255,250,235,${k * (1 - t / 180)})`;
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    }
  }

  _renderTitle(ctx, rdt) {
    const tc = this.titleCard;
    if (!tc) return;
    tc.t += rdt;
    if (tc.t > tc.life) {
      this.titleCard = null;
      return;
    }
    if (!this._titleBand) this._titleBand = brushBand(TITLE_CARD.w, TITLE_CARD.h, this.zone);
    const t = tc.t;
    const wipe = smooth(0, 700, t);
    const fadeOut = 1 - smooth(tc.life - 900, tc.life, t);
    const textA = smooth(300, 1000, t) * fadeOut;
    const cx = TITLE_CARD.cx;
    const cy = TITLE_CARD.cy;
    ctx.save();
    ctx.globalAlpha = fadeOut;
    const band = this._titleBand;
    if (band) {
      const bw = TITLE_CARD.w;
      const bh = TITLE_CARD.h;
      ctx.save();
      ctx.beginPath();
      ctx.rect(cx - bw / 2, cy - bh / 2, bw * wipe, bh);
      ctx.clip();
      ctx.drawImage(band, cx - bw / 2, cy - bh / 2, bw, bh);
      ctx.restore();
    }
    ctx.globalAlpha = textA;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 12;
    ctx.fillStyle = PALETTE.paleGold;
    ctx.font = `700 50px ${FONTS.title}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '8px';
    const rise = (1 - smooth(300, 1100, t)) * 10;
    ctx.fillText(tc.name.toUpperCase(), cx, cy - 16 + rise);
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
    ctx.shadowBlur = 6;
    ctx.fillStyle = PALETTE.parchment;
    ctx.font = `italic 500 25px ${FONTS.body}`;
    ctx.fillText(tc.sub, cx, cy + 30 + rise * 0.6);
    if (tc.level) {
      ctx.globalAlpha = textA;
      ctx.shadowBlur = 8;
      ctx.fillStyle = PALETTE.paleGold;
      ctx.font = `700 13px ${FONTS.title}`;
      if ('letterSpacing' in ctx) ctx.letterSpacing = '4px';
      ctx.fillText(tc.level.toUpperCase(), cx, cy + 64);
      if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
    }
    // gold rules either side of the subtitle
    ctx.shadowBlur = 0;
    ctx.globalAlpha = textA * 0.9;
    ctx.strokeStyle = PALETTE.gold;
    ctx.lineWidth = 1;
    const tw = Math.min(260, ctx.measureText ? 170 : 170);
    ctx.beginPath();
    ctx.moveTo(cx - 190 - tw * wipe * 0.3, cy + 12);
    ctx.lineTo(cx - 190, cy + 12);
    ctx.moveTo(cx + 190, cy + 12);
    ctx.lineTo(cx + 190 + tw * wipe * 0.3, cy + 12);
    ctx.stroke();
    ctx.restore();
  }

  _renderDebug(ctx, cam) {
    const map = this.map;
    const x0 = Math.max(0, Math.floor(cam.x / TILE));
    const x1 = Math.min(map.w - 1, Math.floor((cam.x + VIEW_W) / TILE));
    const y0 = Math.max(0, Math.floor(cam.y / TILE));
    const y1 = Math.min(map.h - 1, Math.floor((cam.y + VIEW_H) / TILE));
    ctx.save();
    ctx.lineWidth = 1;
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const r = map.solidRect(tx, ty);
        if (r) {
          ctx.fillStyle = map.blockers.has(ty * map.w + tx) ? 'rgba(80,160,255,0.28)' : 'rgba(255,60,60,0.22)';
          ctx.fillRect(r[0], r[1], r[2] - r[0], r[3] - r[1]);
        }
        if (this.flow) {
          const d = this.flow[ty * map.w + tx];
          if (d >= 0 && d <= 5) {
            ctx.fillStyle = 'rgba(255,255,255,0.5)';
            ctx.font = '9px monospace';
            ctx.fillText(String(d), tx * TILE + 3, ty * TILE + 11);
          }
        }
      }
    }
    for (const s of this._solids()) {
      ctx.strokeStyle = 'rgba(120,200,255,0.9)';
      ctx.strokeRect(s[0], s[1], s[2] - s[0], s[3] - s[1]);
    }
    for (const z of this._camps) {
      ctx.strokeStyle = 'rgba(120,255,160,0.8)';
      ctx.setLineDash([6, 5]);
      ctx.beginPath();
      ctx.arc(z.x, z.y, z.r, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    for (const e of this.enemies) {
      ctx.strokeStyle = 'rgba(255,200,80,0.7)';
      ctx.beginPath();
      ctx.arc(e.sx, e.sy, e.patrolR, 0, TAU);
      ctx.stroke();
      ctx.strokeStyle = e.state === 'chase' ? 'rgba(255,60,60,0.9)' : 'rgba(255,120,120,0.4)';
      ctx.beginPath();
      ctx.arc(e.x, e.y, 5 * TILE, 0, TAU);
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.font = '11px monospace';
      ctx.fillText(`${e.id} ${e.state}`, e.x - 30, e.y + 16);
    }
    for (const b of this.bosses) {
      ctx.strokeStyle = 'rgba(200,120,255,0.8)';
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.trigger, 0, TAU);
      ctx.stroke();
    }
    for (const x of this.exits) {
      const [a, b2, c, d] = x.rect;
      ctx.strokeStyle = x.open ? 'rgba(120,255,140,0.9)' : 'rgba(200,120,255,0.9)';
      ctx.strokeRect(a, b2, c - a, d - b2);
    }
    const p = this.party;
    ctx.strokeStyle = '#7fff7f';
    ctx.strokeRect(p.x - 10, p.y - 6, 20, 12);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x + p.fx * 30, p.y + p.fy * 30);
    ctx.stroke();
    ctx.restore();
  }

  _renderDebugScreen(ctx) {
    const g = this.game;
    const lines = [
      `FPS ${g.fps?.toFixed?.(0) ?? '?'}  update ${this.perf.update.toFixed(2)} ms  render ${this.perf.render.toFixed(2)} ms  build ${(this.buildMs ?? 0).toFixed(0)} ms`,
      `${this.zone}  tile ${Math.floor(this.party.x / TILE)},${Math.floor(this.party.y / TILE)}  mode ${this.mode}  enemies ${this.enemies.length}`,
    ];
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(360, 86, 560, 42);
    ctx.fillStyle = '#9fffa0';
    ctx.font = '12px monospace';
    lines.forEach((l, i) => ctx.fillText(l, 368, 104 + i * 16));
    ctx.restore();
  }

  // ─────────────────────────────────────────────────────────────── HUD (DOM)

  _buildHud() {
    const root = document.createElement('div');
    root.className = 'wv-hud';
    root.innerHTML = `
      <div class="wv-loc wv-hide">
        <div class="wv-card"><div class="wv-zone"></div><div class="wv-rule"></div><div class="wv-obj"><i class="wv-compass">${COMPASS_SVG}</i><span class="wv-obj-t"></span></div></div>
        <div class="wv-pill"><i class="wv-compass">${COMPASS_SVG}</i><span class="wv-pill-t"></span></div>
      </div>
      <div class="wv-glint">${GLINT_SVG}<span class="wv-glint-n">0</span></div>
      <button class="wv-menu" type="button" tabindex="-1" aria-label="Menu">${MENU_SVG}</button>
      <div class="wv-map">
        <canvas class="wv-mini" width="200" height="130" aria-label="Map" title="Map — click for the legend"></canvas>
        <div class="wv-mcap"></div>
        <div class="wv-legend" aria-hidden="true"><h4>Map</h4>${LEGEND.map(([label, svg]) => `${svg}<span>${esc(label)}</span>`).join('')}</div>
      </div>
      <div class="wv-party"></div>
      <div class="wv-toasts"></div>
      <div class="wv-prompt" role="button"><kbd></kbd><span class="wv-verb"></span><span class="wv-label"></span></div>
      <div class="wv-hint"></div>
      <div class="wv-keys"></div>`;
    this.mountUI(root);
    const q = (sel) => root.querySelector(sel);
    this._hud = {
      root, loc: q('.wv-loc'), zone: q('.wv-zone'), obj: q('.wv-obj-t'), pill: q('.wv-pill-t'), needles: [...root.querySelectorAll('.wv-needle')],
      glint: q('.wv-glint'), glintN: q('.wv-glint-n'), menu: q('.wv-menu'), party: q('.wv-party'), toasts: q('.wv-toasts'),
      prompt: q('.wv-prompt'), kbd: q('.wv-prompt kbd'), verb: q('.wv-verb'), label: q('.wv-label'), hint: q('.wv-hint'), keys: q('.wv-keys'),
      mini: q('.wv-mini'), mcap: q('.wv-mcap'), legend: q('.wv-legend'),
    };
    this._hud.prompt.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (this._target && this.mode === 'play' && this.isTop) this._interact(this._target);
    });
    // Tapping/clicking the map toggles its legend and brings the full objective back.
    this._hud.mini.addEventListener('click', (ev) => {
      ev.stopPropagation();
      this._toggleLegend();
    });
    // On-screen Menu button (touch players have no Esc): a virtual 'menu' press the scene handles as usual.
    const menu = this._hud.menu;
    const up = () => {
      menu.classList.remove('wv-down');
      if (this._menuHeld) this.game.input?.virtualRelease?.('menu');
      this._menuHeld = false;
    };
    menu.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      menu.classList.add('wv-down');
      this._menuHeld = true;
      this.game.input?.virtualPress?.('menu', ev.pointerType === 'mouse' ? 'virtual' : 'touch', ev.timeStamp);
    });
    for (const type of ['pointerup', 'pointercancel', 'pointerleave']) menu.addEventListener(type, up);
    this._refreshMenuLabel();
  }

  /** Menu button tooltip, and a bigger thumb-sized button while the player is on touch (the stage scales down). */
  _refreshMenuLabel() {
    const menu = this._hud.menu;
    if (!menu) return;
    const input = this.game.input;
    const touch = input?.lastDevice === 'touch';
    this._hud.root?.classList.toggle('wv-touch', touch);
    const key = touch ? '' : input?.keyLabel?.('menu') ?? '';
    menu.title = key ? `Menu (${key})` : 'Menu';
  }

  _toggleLegend(on = !this._legendOn) {
    this._legendOn = !!on;
    this._hud.legend?.classList.toggle('wv-on', this._legendOn);
    this._hud.legend?.setAttribute('aria-hidden', this._legendOn ? 'false' : 'true');
    if (this._legendOn) this._expandObjective(6000);
    this.game.audio?.play?.('ui_move', { volume: 0.5 });
  }

  _updateHud(force) {
    const h = this._hud;
    if (!h.root || !this.game.state) return;
    const st = this.game.state;
    const c = this._hudCache;
    const Z = ZONES[this.zone];
    const zoneName = Z?.name ?? this.zone;
    if (force || c.zone !== zoneName) {
      c.zone = zoneName;
      h.zone.textContent = zoneName;
    }
    // objective: the full line in the cartouche, the short one in the compact pill
    const obj = zoneObjective(this.zone, st);
    if (force || c.obj !== obj) {
      c.obj = obj;
      h.obj.textContent = obj;
      h.pill.textContent = zoneObjective(this.zone, st, { short: true });
    }
    const objKey = `${this.zone}|${obj}`;
    if (this._objText !== objKey) {
      // a new objective in the same zone (a guardian fell): show it in full again
      if (this._objText?.startsWith(`${this.zone}|`)) this._expandObjective();
      this._objText = objKey;
    }
    this._updateCompass();
    const glint = String(Math.floor(st.glint ?? 0));
    if (force || c.glint !== glint) {
      c.glint = glint;
      h.glintN.textContent = glint;
    }
    // party chips
    const sig = (st.party ?? []).map((m) => `${m.id}:${m.hp}:${m.level}:${m.alive}`).join('|');
    if (force || c.party !== sig) {
      c.party = sig;
      h.party.innerHTML = (st.party ?? []).map((m) => {
        const ch = CHARACTERS[m.id];
        let max = 1;
        try {
          max = derivedStats(m).maxHp;
        } catch {
          max = m.hp || 1;
        }
        const hp = Math.max(0, Math.round(m.hp ?? max));
        const pct = clamp(hp / Math.max(1, max), 0, 1) * 100;
        const ko = m.alive === false || hp <= 0;
        const url = portraitDataURL(ch?.look ?? m.id, 84);
        return `<div class="wv-chip${ko ? ' wv-ko' : ''}${pct < 30 ? ' wv-low' : ''}">${url ? `<img src="${url}" alt="">` : ''}<div class="wv-col"><div class="wv-nm"><span>${esc(ch?.name?.split(' ')[0] ?? m.id)}</span><span class="wv-lv">Lv ${m.level}</span></div><div class="wv-bar"><i style="width:${pct.toFixed(1)}%"></i></div><div class="wv-hp">${hp} / ${max}</div></div></div>`;
      }).join('');
    }
    // prompt
    const t = this.mode === 'play' ? this._target : null;
    this._setPrompt(t);
    // minimap (20 fps: the objective ring pulses)
    if (force || (this._miniT = (this._miniT ?? 0) + 1) % 3 === 0) this._drawMinimap();
  }

  /**
   * Where the objective points (world px) with its minimap caption: the zone's guardian while it stands, then
   * the exit onward.
   * @returns {{x:number, y:number, caption:string}|null}
   */
  _objectivePoint() {
    const goal = objectiveTarget(this.zone, this.game.state);
    if (goal?.boss) {
      const b = this.bosses.find((x) => x.id === goal.boss);
      return b ? { x: b.x, y: b.y - 20, caption: `Guardian · ${ENEMIES[goal.boss]?.name ?? goal.boss}` } : null;
    }
    if (goal?.exitTo) {
      const ex = this.exits.find((x) => x.def.to === goal.exitTo);
      return ex ? { x: ex.x, y: ex.y, caption: `Onward · ${ex.def.label ?? ZONES[goal.exitTo]?.name ?? goal.exitTo}` } : null;
    }
    return null;
  }

  /** Turn the cartouche/pill compass needles toward the objective (screen directions: up = north). */
  _updateCompass() {
    const h = this._hud;
    const goal = this.party ? this._objectivePoint() : null;
    const c = this._hudCache;
    if (!goal) {
      if (c.needle !== 'off') {
        for (const n of h.needles ?? []) n.style.opacity = '0';
        c.needle = 'off';
      }
    } else {
      const deg = (Math.atan2(goal.y - (this.party.y - 30), goal.x - this.party.x) * 180) / Math.PI + 90;
      // keep the angle unwrapped so the CSS transition always turns the short way round
      const prev = this._needleDeg ?? deg;
      const next = prev + ((((deg - prev) % 360) + 540) % 360) - 180;
      if (c.needle !== 'on' || Math.abs(next - prev) > 2) {
        this._needleDeg = next;
        c.needle = 'on';
        for (const n of h.needles ?? []) {
          n.style.opacity = '';
          n.style.transform = `rotate(${next.toFixed(1)}deg)`;
        }
      }
    }
    const cap = goal?.caption ?? '';
    if (c.mcap !== cap) {
      c.mcap = cap;
      h.mcap.innerHTML = cap ? `<i></i>${esc(cap)}` : '';
    }
  }

  _setPrompt(t) {
    const h = this._hud;
    if (!h.prompt) return;
    const p = t?.prompt?.() ?? null;
    if (!p) {
      if (this._hudCache.prompt !== null) {
        h.prompt.classList.remove('wv-on');
        this._hudCache.prompt = null;
      }
      this._promptTarget = null;
      return;
    }
    const input = this.game.input;
    const cap = input.lastDevice === 'touch' ? 'Tap' : input.keyLabel('confirm');
    const key = `${p.verb}|${p.label}|${cap}`;
    if (this._hudCache.prompt !== key) {
      this._hudCache.prompt = key;
      h.kbd.textContent = cap;
      h.verb.textContent = p.verb;
      h.label.textContent = p.label ?? '';
      h.label.style.display = p.label ? '' : 'none';
      h.prompt.classList.add('wv-on');
    }
    this._promptTarget = t;
  }

  _positionPrompt(cam) {
    const t = this._promptTarget;
    const el = this._hud.prompt;
    if (!t || !el) return;
    const at = t.promptAt;
    const x = clamp(at.x - cam.x, 90, VIEW_W - 90);
    const y = clamp(at.y - cam.y, 40, VIEW_H - 20);
    el.style.left = `${x.toFixed(1)}px`;
    el.style.top = `${y.toFixed(1)}px`;
    // The zone's arrival card is painted on the canvas, under the DOM prompt: hold back a prompt that would sit on
    // the card's band (the pill is anchored by its bottom centre) until the card starts to fade.
    const tc = this.titleCard;
    const veiled = !!tc && tc.t < tc.life - 900 && Math.abs(x - TITLE_CARD.cx) < TITLE_CARD.w / 2 + 130
      && y > TITLE_CARD.cy - TITLE_CARD.h / 2 && y - 36 < TITLE_CARD.cy + TITLE_CARD.h / 2;
    if (veiled !== this._promptVeiled) {
      this._promptVeiled = veiled;
      el.classList.toggle('wv-veiled', veiled);
    }
  }

  _toast(html, icon = '', cls = '') {
    const h = this._hud;
    if (!h.toasts) return;
    const el = document.createElement('div');
    el.className = `wv-toast ${cls}`;
    el.innerHTML = `${icon}<div>${html}</div>`;
    h.toasts.appendChild(el);
    while (h.toasts.children.length > 4) h.toasts.firstChild.remove();
    setTimeout(() => el.classList.add('wv-out'), 3400);
    setTimeout(() => el.remove(), 3950);
  }

  _hint(text, ms = 3000) {
    const el = this._hud.hint;
    if (!el) return;
    el.textContent = text;
    el.classList.add('wv-on');
    clearTimeout(this._hintTimer);
    this._hintTimer = setTimeout(() => el.classList.remove('wv-on'), ms);
  }

  _bumpGlint() {
    const el = this._hud.glint;
    if (!el) return;
    el.classList.add('wv-bump');
    setTimeout(() => el.classList.remove('wv-bump'), 200);
  }

  _refreshKeys() {
    const el = this._hud.keys;
    if (!el) return;
    const input = this.game.input;
    if (input.lastDevice === 'touch') {
      // touch-native wording: there are no caps to show on a phone
      el.innerHTML = '<span>Hold to walk</span><span>Tap a prompt to interact</span><span>Tap a foe beside you to strike first</span>'
        + `<span><i class="wv-kicon">${MENU_SVG}</i>Menu</span>`;
      return;
    }
    let move;
    if (input.lastDevice === 'gamepad') move = 'Left stick';
    else {
      const dirs = ['up', 'left', 'down', 'right'];
      const letters = dirs.map((a) => input.keyLabels(a, 'keyboard').find((l) => /^[A-Z]$/.test(l)));
      const arrows = dirs.map((a) => input.keyLabel(a, 'keyboard')).join('');
      move = letters.every(Boolean) ? `${letters.join('')} / ${arrows}` : arrows;
    }
    el.innerHTML = `<span><kbd>${esc(move)}</kbd>Move</span><span><kbd>${esc(input.keyLabel('confirm'))}</kbd>Interact · swing to ambush</span><span><kbd>${esc(input.keyLabel('menu'))}</kbd>Menu</span>`;
  }

  _showKeys() {
    this._refreshKeys();
    this._hud.keys?.classList.add('wv-on');
    this._keysShownAt = this.vt;
    clearTimeout(this._keysTimer);
    this._keysTimer = setTimeout(() => this._hideKeys(), 12000);
  }

  _hideKeys() {
    this._hud.keys?.classList.remove('wv-on');
    const w = this.game.state?.world;
    if (w) {
      w.story = w.story ?? {};
      w.story.world_keys_seen = true;
    }
  }

  // ─────────────────────────────────────────────────────────────── minimap

  _buildMinimap() {
    const map = this.map;
    const el = this._hud.mini;
    if (!el) return;
    const s = Math.min(200 / map.w, 130 / map.h);
    const W = Math.round(map.w * s);
    const H = Math.round(map.h * s);
    el.width = W * 2;
    el.height = H * 2;
    el.style.width = `${W}px`;
    el.style.height = `${H}px`;
    this._miniScale = s;
    const base = makeCanvas(W * 2, H * 2);
    if (!base) return;
    const g = base.getContext('2d');
    g.scale(2 * s, 2 * s);
    const col = MINI_COLORS[this.zone] ?? MINI_COLORS.shore;
    for (let y = 0; y < map.h; y++) {
      for (let x = 0; x < map.w; x++) {
        const tt = map.typeAt(x, y);
        g.fillStyle = col[tt] ?? col.ground;
        g.fillRect(x, y, 1.02, 1.02);
      }
    }
    this._miniBase = base;
    this._drawMinimap();
  }

  _drawMinimap() {
    const el = this._hud.mini;
    if (!el || !this._miniBase || !this.party) return;
    const g = el.getContext('2d');
    const s = this._miniScale * 2;
    g.clearRect(0, 0, el.width, el.height);
    g.globalAlpha = 0.92;
    g.drawImage(this._miniBase, 0, 0);
    g.globalAlpha = 1;
    g.lineJoin = 'round';
    const P = (tx, ty) => [tx * s, ty * s];
    for (const th of this.things) {
      if (th.type === 'flag') miniPennant(g, ...P(th.tx + 0.5, th.ty + 0.5), th.visited);
      else if (th.type === 'merchant') miniCoin(g, ...P(th.tx + 0.5, th.ty + 0.5));
    }
    for (const x of this.exits) miniArrow(g, ...P(x.x / TILE, x.y / TILE), x.edge, x.open);
    for (const b of this.bosses) miniSkull(g, ...P(b.x / TILE, b.y / TILE));
    // the objective: a steady gold ring and a slow ping around it
    const goal = this._objectivePoint();
    if (goal) {
      const [gx, gy] = P(goal.x / TILE, goal.y / TILE);
      const ph = (this.vt % 1600) / 1600;
      g.strokeStyle = `rgba(255,210,122,${(0.85 * (1 - ph)).toFixed(3)})`;
      g.lineWidth = 2;
      g.beginPath();
      g.arc(gx, gy, 9 + ph * 12, 0, TAU);
      g.stroke();
      g.fillStyle = 'rgba(255,210,122,0.16)';
      g.strokeStyle = '#ffd27a';
      g.lineWidth = 2.2;
      g.beginPath();
      g.arc(gx, gy, 9 + Math.sin(this.vt * 0.006) * 1.2, 0, TAU);
      g.fill();
      g.stroke();
    }
    miniParty(g, ...P(this.party.x / TILE, this.party.y / TILE), this.party.fx, this.party.fy, this.vt);
  }

  /** Snapshot for tests / the bench. */
  debugInfo() {
    return {
      zone: this.zone,
      mode: this.mode,
      x: this.party ? this.party.x / TILE : null,
      y: this.party ? this.party.y / TILE : null,
      facing: this.party?.facingName,
      target: this._target ? { type: this._target.type, id: this._target.id } : null,
      enemies: this.enemies.map((e) => ({ id: e.id, state: e.state, x: +(e.x / TILE).toFixed(2), y: +(e.y / TILE).toFixed(2), encounter: e.info.encounterId })),
      bosses: this.bosses.map((b) => b.id),
      exits: this.exits.map((x) => ({ id: x.id, open: x.open, to: x.def.to })),
      perf: { ...this.perf },
      buildMs: this.buildMs,
      quality: this.quality,
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════ helpers

function injectStyle() {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = CSS;
  document.head.appendChild(el);
}

// ─────────────────────────────────────────────────────────── minimap glyphs (canvas px; the legend mirrors them)

/** Glyph size on the (2× backing) minimap canvas. */
const MINI_GLYPH = 1.25;

/** Draw a glyph centred on (x, y) at the minimap glyph scale. */
function glyphAt(g, x, y, draw) {
  g.save();
  g.translate(x, y);
  g.scale(MINI_GLYPH, MINI_GLYPH);
  draw(g);
  g.restore();
}

function miniPennant(g, x, y, visited) {
  glyphAt(g, x, y, () => {
    g.strokeStyle = '#3a2412';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(-3, 7);
    g.lineTo(-3, -7);
    g.stroke();
    g.strokeStyle = '#e0b458';
    g.lineWidth = 1.4;
    g.stroke();
    g.fillStyle = visited ? '#d84a3a' : '#8a7a6a';
    g.strokeStyle = '#3a2412';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(-2.4, -7);
    g.lineTo(7, -7);
    g.lineTo(4.4, -3.9);
    g.lineTo(7, -0.8);
    g.lineTo(-2.4, -0.8);
    g.closePath();
    g.fill();
    g.stroke();
  });
}

function miniCoin(g, x, y) {
  glyphAt(g, x, y, () => {
    g.fillStyle = '#e8c060';
    g.strokeStyle = '#4a3010';
    g.lineWidth = 1.4;
    g.beginPath();
    g.arc(0, 0, 5.6, 0, TAU);
    g.fill();
    g.stroke();
    g.strokeStyle = '#8a5a1c';
    g.lineWidth = 1.1;
    g.beginPath();
    g.arc(0, 0, 2.8, 0, TAU);
    g.stroke();
  });
}

function miniSkull(g, x, y) {
  glyphAt(g, x, y, () => {
    g.fillStyle = '#e8483a';
    g.strokeStyle = '#2a0808';
    g.lineWidth = 1.3;
    g.beginPath();
    g.arc(0, -1, 6, Math.PI * 0.82, Math.PI * 2.18);
    g.lineTo(3.4, 6);
    g.lineTo(-3.4, 6);
    g.closePath();
    g.fill();
    g.stroke();
    g.fillStyle = '#2a0808';
    for (const dx of [-2.3, 2.3]) {
      g.beginPath();
      g.arc(dx, -0.6, 1.5, 0, TAU);
      g.fill();
    }
  });
}

const EDGE_ANGLE = { east: 0, south: Math.PI / 2, west: Math.PI, north: -Math.PI / 2 };

function miniArrow(g, x, y, edge, open) {
  glyphAt(g, x, y, () => {
    g.rotate(EDGE_ANGLE[edge] ?? 0);
    g.fillStyle = open ? '#b8f0a0' : '#b07aff';
    g.strokeStyle = '#1a1020';
    g.lineWidth = 1.4;
    g.beginPath();
    g.moveTo(-4, -6);
    g.lineTo(5, 0);
    g.lineTo(-4, 6);
    g.closePath();
    g.fill();
    g.stroke();
  });
}

function miniParty(g, x, y, fx, fy, t) {
  glyphAt(g, x, y, () => {
    g.fillStyle = 'rgba(255,255,255,0.25)';
    g.beginPath();
    g.arc(0, 0, 6 + Math.sin(t * 0.008), 0, TAU);
    g.fill();
    const a = Math.atan2(fy, fx);
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.moveTo(Math.cos(a) * 8.5, Math.sin(a) * 8.5);
    g.lineTo(Math.cos(a + 2.2) * 4, Math.sin(a + 2.2) * 4);
    g.lineTo(Math.cos(a - 2.2) * 4, Math.sin(a - 2.2) * 4);
    g.closePath();
    g.fill();
    g.strokeStyle = '#15100d';
    g.lineWidth = 1.4;
    g.beginPath();
    g.arc(0, 0, 3.8, 0, TAU);
    g.fill();
    g.stroke();
  });
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function safeIcon(id, size) {
  try {
    return itemIcon(id, size);
  } catch {
    return '';
  }
}

/** Journal → dialogue lines (title line, then the text in readable chunks). */
export function journalLines(J) {
  const lines = [{ speaker: 'narrator', text: `“${J.title}” — ${J.author ?? 'unknown hand'}` }];
  const sentences = String(J.text).match(/[^.!?]+[.!?]+["”’']?\s*|[^.!?]+$/g) ?? [J.text];
  let cur = '';
  for (const s of sentences) {
    if (cur && (cur + s).length > 250) {
      lines.push({ speaker: 'narrator', text: cur.trim() });
      cur = '';
    }
    cur += s;
  }
  if (cur.trim()) lines.push({ speaker: 'narrator', text: cur.trim() });
  return lines;
}

/** Shards for the battle-transition shatter (stage coordinates). */
function makeShards(cx, cy) {
  const cols = 10;
  const rows = 6;
  const pts = [];
  for (let j = 0; j <= rows; j++) {
    for (let i = 0; i <= cols; i++) {
      let x = (i / cols) * VIEW_W;
      let y = (j / rows) * VIEW_H;
      if (i > 0 && i < cols) x += (hash2(i, j, 1) - 0.5) * (VIEW_W / cols) * 0.7;
      if (j > 0 && j < rows) y += (hash2(i, j, 2) - 0.5) * (VIEW_H / rows) * 0.7;
      pts.push([x, y]);
    }
  }
  const P = (i, j) => pts[j * (cols + 1) + i];
  const shards = [];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const a = P(i, j);
      const b = P(i + 1, j);
      const c = P(i + 1, j + 1);
      const d = P(i, j + 1);
      const tris = hash2(i, j, 3) < 0.5 ? [[a, b, c], [a, c, d]] : [[a, b, d], [b, c, d]];
      for (const tri of tris) {
        const mx = (tri[0][0] + tri[1][0] + tri[2][0]) / 3;
        const my = (tri[0][1] + tri[1][1] + tri[2][1]) / 3;
        const dx = mx - cx;
        const dy = my - cy;
        const dd = Math.hypot(dx, dy) || 1;
        const xs = tri.map((p) => p[0]);
        const ys = tri.map((p) => p[1]);
        const bx = Math.max(0, Math.floor(Math.min(...xs)) - 1);
        const by = Math.max(0, Math.floor(Math.min(...ys)) - 1);
        const bw = Math.min(VIEW_W - bx, Math.ceil(Math.max(...xs)) + 1 - bx);
        const bh = Math.min(VIEW_H - by, Math.ceil(Math.max(...ys)) + 1 - by);
        shards.push({
          pts: tri.flat(), cx: mx, cy: my, bbox: [bx, by, bw, bh],
          vx: (dx / dd) * (0.4 + (1 - Math.min(1, dd / 800)) * 0.8) + (hash2(i, j, 4) - 0.5) * 0.3,
          vy: (dy / dd) * (0.4 + (1 - Math.min(1, dd / 800)) * 0.8) + (hash2(i, j, 5) - 0.5) * 0.3,
          vr: (hash2(i, j, 6) - 0.5) * 1.2,
        });
      }
    }
  }
  return shards;
}

/** Ink brush-stroke band for the zone title card (pre-rendered). */
function brushBand(w, h, zone) {
  const c = makeCanvas(w * 2, h * 2);
  if (!c) return null;
  const g = c.getContext('2d');
  g.scale(2, 2);
  const R = (() => {
    let a = 1234 + (zone?.length ?? 0) * 77;
    return () => {
      a = (a * 1664525 + 1013904223) >>> 0;
      return a / 4294967296;
    };
  })();
  const cy = h / 2;
  for (let i = 0; i < 70; i++) {
    const y = cy + (R() - 0.5) * h * 0.52;
    const x0 = w * (0.04 + R() * 0.1);
    const x1 = w * (0.86 + R() * 0.1);
    const th = 4 + R() * 12;
    const a = 0.1 + R() * 0.2;
    g.fillStyle = `rgba(16,11,9,${a})`;
    g.beginPath();
    g.moveTo(x0, y);
    g.bezierCurveTo(x0 + w * 0.3, y - th, x1 - w * 0.3, y - th * 0.6, x1, y + (R() - 0.5) * 6);
    g.bezierCurveTo(x1 - w * 0.3, y + th * 0.5, x0 + w * 0.3, y + th, x0, y);
    g.fill();
  }
  // dry-brush bristle streaks at the ends
  for (let i = 0; i < 60; i++) {
    const y = cy + (R() - 0.5) * h * 0.5;
    const right = R() < 0.5;
    const x = right ? w * (0.82 + R() * 0.16) : w * (0.02 + R() * 0.12);
    g.fillStyle = `rgba(16,11,9,${0.2 + R() * 0.3})`;
    g.fillRect(x, y, 20 + R() * 50, 1 + R() * 1.6);
  }
  // gold hairlines
  g.strokeStyle = 'rgba(224,180,88,0.7)';
  g.lineWidth = 1.2;
  g.beginPath();
  g.moveTo(w * 0.18, cy - h * 0.33);
  g.quadraticCurveTo(w * 0.5, cy - h * 0.37, w * 0.82, cy - h * 0.32);
  g.moveTo(w * 0.2, cy + h * 0.34);
  g.quadraticCurveTo(w * 0.5, cy + h * 0.38, w * 0.8, cy + h * 0.33);
  g.stroke();
  return c;
}

/** Minimap colours per zone and tile type. */
const MINI_COLORS = {
  shore: { deep: '#1f5460', shallow: '#5fa8a2', wet: '#a8886a', ground: '#d8b88a', grass: '#a89a62', path: '#c9a67c', flowers: '#b89a70', planks: '#8a6a4a', bridge: '#8a6a4a', stone: '#c8b898', cliff: '#4a3c48', ruin: '#9a8a70', rock: '#6a5a60', tree: '#34504a', bush: '#6a7a50', wall: '#4a3c48' },
  thicket: { deep: '#23413a', shallow: '#4a6a50', wet: '#4a4a26', ground: '#6a5a2e', grass: '#8a8034', path: '#9a7a4c', flowers: '#9a8a3a', planks: '#8a6a4a', bridge: '#8a6a4a', stone: '#8a8468', cliff: '#5a4a30', ruin: '#7a745a', rock: '#6a5e48', tree: '#c9a43a', bush: '#9a8030', wall: '#5a4a30' },
  spire: { void: '#2a2c44', ground: '#8a6a34', stone: '#8a7c6e', path: '#6a3030', gear: '#a07a3a', bridge: '#b8893b', planks: '#b8893b', stairs: '#8a7a66', wall: '#4a3618', pillar: '#e8c16a', machine: '#6a5024', rock: '#5a4420', cliff: '#4a4038', ruin: '#4a4038' },
  summit: { void: '#20142a', ground: '#8a7a6a', stone: '#9a8878', dial: '#b89a6a', path: '#6a3030', stairs: '#8a7a66', bridge: '#b8893b', planks: '#b8893b', wall: '#4e3a30', pillar: '#e8d0a0', rock: '#5a463a', cliff: '#4e3a30', ruin: '#4e3a30' },
};
