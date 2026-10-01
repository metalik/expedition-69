// Battle HUD for Expedition 69 (DOM overlay inside game.uiRoot): turn-order timeline, party cards (portrait,
// HP, AP pips, Surge / Glyph / Stance widgets, status icons with tooltips), the team Prism gauge, command
// menu, skill / item / Prism lists with a details pane, target info (with known affinities), defense key legend,
// touch buttons (with whiff-lockout feedback), tappable Pause / Back controls, hint panels, the battle pause
// overlay, the victory results panel, the practice overlay and the free-aim bar.
// When the stage is scaled small (phones) the HUD switches to a compact layout laid out in real CSS pixels, so
// text stays ≥ 11 CSS px and touch targets ≥ 40 CSS px. Styles are injected once as <style id="bt-hud-style">.

import { portraitDataURL } from '../render/sprites.js';
import { statusIcon, elementIcon, itemIcon, mechanicIcon, cueIcon } from '../render/icons.js';
import { flushBackgroundRebuilds } from '../render/backgrounds.js';
import { STATUS_DEFS } from './status.js';

const STYLE_ID = 'bt-hud-style';

/** Below this stage scale (CSS px per logical px) the HUD uses the compact, CSS-pixel layout. */
export const COMPACT_SCALE = 0.75;

const CSS = `
.bt-hud{position:absolute;left:0;top:0;width:1280px;height:720px;pointer-events:none;transform-origin:0 0;
  font-family:var(--font-body,"Cormorant Garamond",Georgia,serif);color:var(--ivory,#f5eedf);
  user-select:none;-webkit-user-select:none;-webkit-tap-highlight-color:transparent}
.bt-hud *{box-sizing:border-box}
.bt-hud .bt-cap{font-family:var(--font-title,"Cinzel",serif);letter-spacing:.14em;text-transform:uppercase}
.bt-hud .bt-panel{position:absolute;background:linear-gradient(180deg,rgba(32,24,18,.95) 0%,rgba(14,10,8,.93) 100%);
  border:1px solid rgba(224,180,88,.52);border-radius:4px;
  box-shadow:0 12px 34px rgba(0,0,0,.5),0 0 0 1px rgba(0,0,0,.55),inset 0 1px 0 rgba(243,219,160,.14),inset 0 0 26px rgba(224,180,88,.05)}
.bt-hud .bt-panel::before{content:"";position:absolute;inset:3px;border:1px solid rgba(224,180,88,.14);border-radius:2px;pointer-events:none}
.bt-hud .bt-panel::after{content:"";position:absolute;left:50%;top:-5px;width:9px;height:9px;margin-left:-4.5px;transform:rotate(45deg);
  background:var(--gold,#e0b458);box-shadow:0 0 8px rgba(224,180,88,.7);pointer-events:none}
.bt-hud .bt-fade{opacity:0;transform:translateY(6px);transition:opacity .16s ease,transform .16s ease;visibility:hidden}
.bt-hud .bt-fade.bt-on{opacity:1;transform:none;visibility:visible}
.bt-hud .bt-key{display:inline-block;min-width:22px;padding:1px 6px 0;margin:0 2px;border:1px solid rgba(243,219,160,.65);border-bottom-width:2px;
  border-radius:4px;background:linear-gradient(180deg,rgba(60,46,34,.95),rgba(24,18,14,.95));font-family:var(--font-title,"Cinzel",serif);
  font-size:12px;font-weight:700;letter-spacing:.04em;color:var(--pale-gold,#f3dba0);text-align:center;line-height:17px;vertical-align:1px}

/* tappable controls (Pause, Back, Confirm, Done) */
.bt-hud .bt-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:30px;padding:0 12px 0 10px;border-radius:15px;cursor:pointer;
  pointer-events:auto;touch-action:none;border:1px solid rgba(243,219,160,.55);background:linear-gradient(180deg,rgba(58,44,32,.96),rgba(20,15,11,.96));
  font-family:var(--font-title,"Cinzel",serif);font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--pale-gold,#f3dba0);
  box-shadow:0 2px 8px rgba(0,0,0,.45);white-space:nowrap;transition:opacity .16s,background .1s,border-color .1s,transform .08s}
.bt-hud .bt-btn:hover{border-color:#fff3c2;background:linear-gradient(180deg,rgba(84,64,44,.98),rgba(28,20,14,.98))}
.bt-hud .bt-btn:active,.bt-hud .bt-btn.bt-press{transform:scale(.95)}
.bt-hud .bt-btn .bt-key{margin:0;min-width:0;font-size:11px;line-height:15px;padding:0 5px}
.bt-hud .bt-btn .bt-chev{font-size:17px;line-height:1;margin-top:-2px}
.bt-hud .bt-btn.bt-go{border-color:#fff3c2;background:linear-gradient(180deg,#8a6a34,#4a3418);color:#fffaf0}
.bt-hud .bt-nav{position:absolute;right:14px;top:12px;width:52px;height:52px;padding:0;border-radius:50%;gap:0;flex-direction:column}
.bt-hud .bt-nav i{display:flex;gap:5px;height:16px}
.bt-hud .bt-nav i::before,.bt-hud .bt-nav i::after{content:"";width:5px;height:16px;border-radius:1px;background:currentColor}
.bt-hud .bt-nav span{font-size:8px;letter-spacing:.14em;margin-top:3px}
.bt-hud.bt-touchdev .bt-btn{height:52px;padding:0 18px 0 14px;border-radius:26px;font-size:14px}
.bt-hud.bt-touchdev .bt-nav{width:64px;height:64px;padding:0;border-radius:50%}

/* turn order */
.bt-hud .bt-turns{left:14px;top:10px;padding:7px 14px 8px 12px;display:flex;align-items:center;gap:8px;border-radius:40px}
.bt-hud .bt-turns::after{display:none}
.bt-hud .bt-turns-label{font-size:10px;color:var(--gold,#e0b458);writing-mode:vertical-rl;transform:rotate(180deg);opacity:.85;margin-right:2px}
.bt-hud .bt-turnlist{display:flex;align-items:center;gap:7px}
.bt-hud .bt-chip{position:relative;width:38px;height:38px;border-radius:50%;flex:0 0 auto;border:2px solid var(--c,#e0b458);
  background:#1a120d;box-shadow:0 0 0 2px rgba(0,0,0,.6),0 2px 6px rgba(0,0,0,.6);transition:width .2s,height .2s}
.bt-hud .bt-chip img{width:100%;height:100%;border-radius:50%;display:block}
.bt-hud .bt-chip.bt-now{width:56px;height:56px;border-width:3px;box-shadow:0 0 0 2px rgba(0,0,0,.6),0 0 16px var(--c,#e0b458)}
.bt-hud .bt-chip.bt-now::after{content:"NOW";position:absolute;left:50%;bottom:-9px;transform:translateX(-50%);font-family:var(--font-title,"Cinzel",serif);
  font-size:9px;font-weight:700;letter-spacing:.14em;color:#1b120c;background:var(--c,#e0b458);padding:1px 5px 0;border-radius:6px}
.bt-hud .bt-chip.bt-side-e{--c:#d0584a}
.bt-hud .bt-chip.bt-stun{filter:grayscale(.7) brightness(.8)}
.bt-hud .bt-sep{width:1px;height:26px;background:linear-gradient(180deg,transparent,rgba(224,180,88,.6),transparent)}

/* party cards */
.bt-hud .bt-party{position:absolute;left:12px;bottom:8px;display:flex;gap:8px}
.bt-hud .bt-card{position:relative;width:252px;height:94px;padding:7px 10px 6px 74px;transition:transform .18s ease,border-color .18s,box-shadow .18s}
.bt-hud .bt-card.bt-active{transform:translateY(-7px);border-color:var(--gold,#e0b458);
  box-shadow:0 12px 30px rgba(0,0,0,.55),0 0 20px rgba(224,180,88,.32),inset 0 0 26px rgba(224,180,88,.08)}
.bt-hud .bt-card.bt-aimed{border-color:#9fe0ff;box-shadow:0 0 18px rgba(159,224,255,.45)}
.bt-hud .bt-card.bt-ko{filter:grayscale(.9) brightness(.62)}
.bt-hud .bt-card .bt-pt{position:absolute;left:9px;top:12px;width:58px;height:58px;border-radius:50%;border:2px solid var(--c,#e0b458);
  box-shadow:0 0 0 2px rgba(0,0,0,.6);background:#1a120d}
.bt-hud .bt-card .bt-pt img{width:100%;height:100%;border-radius:50%;display:block}
.bt-hud .bt-card .bt-kotag{position:absolute;left:14px;top:34px;width:48px;text-align:center;font-family:var(--font-title,"Cinzel",serif);
  font-weight:900;font-size:13px;letter-spacing:.12em;color:#ff9a86;text-shadow:0 1px 2px #000;display:none}
.bt-hud .bt-card.bt-ko .bt-kotag{display:block}
.bt-hud .bt-card .bt-lv{position:absolute;left:6px;bottom:6px;width:64px;text-align:center;font-family:var(--font-title,"Cinzel",serif);
  font-size:10px;letter-spacing:.1em;color:var(--parchment,#e9dcc0);opacity:.85}
.bt-hud .bt-card .bt-lv.bt-up{color:#fff3c2;opacity:1;text-shadow:0 0 8px rgba(243,219,160,.8)}
.bt-hud .bt-name{font-family:var(--font-title,"Cinzel",serif);font-weight:700;font-size:13px;letter-spacing:.1em;color:var(--pale-gold,#f3dba0);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:16px}
.bt-hud .bt-hprow{display:flex;align-items:center;gap:6px;margin-top:3px}
.bt-hud .bt-hpbar{position:relative;flex:1;height:10px;background:rgba(0,0,0,.65);border:1px solid rgba(243,219,160,.28);border-radius:2px;overflow:hidden}
.bt-hud .bt-hpghost{position:absolute;left:0;top:0;bottom:0;background:#f1e2c2;opacity:.55;transition:width .6s ease .25s}
.bt-hud .bt-hpfill{position:absolute;left:0;top:0;bottom:0;background:linear-gradient(180deg,#b6ec88,#6fae55);transition:width .18s ease}
.bt-hud .bt-hpfill.bt-mid{background:linear-gradient(180deg,#f3d86a,#c9a33a)}
.bt-hud .bt-hpfill.bt-low{background:linear-gradient(180deg,#ff8a6a,#c9442e)}
.bt-hud .bt-hpnum{font-family:var(--font-title,"Cinzel",serif);font-size:12px;font-weight:700;min-width:66px;text-align:right;letter-spacing:.02em;white-space:nowrap}
.bt-hud .bt-hpnum small{font-size:10px;opacity:.65;font-weight:500}
.bt-hud .bt-aprow{display:flex;align-items:center;gap:3px;margin-top:5px;height:12px}
.bt-hud .bt-pip{width:8px;height:8px;transform:rotate(45deg);border:1px solid rgba(243,219,160,.45);background:rgba(0,0,0,.5);margin-right:2px;flex:0 0 auto;transition:background .15s,box-shadow .15s}
.bt-hud .bt-pip.bt-full{background:linear-gradient(135deg,#fff3c2,#e0b458);border-color:#fff3c2;box-shadow:0 0 6px rgba(243,219,160,.8)}
.bt-hud .bt-pip.bt-cost{background:linear-gradient(135deg,#ffb38a,#d0584a);border-color:#ffd1b8;box-shadow:0 0 6px rgba(255,140,100,.8)}
.bt-hud .bt-apnum{font-family:var(--font-title,"Cinzel",serif);font-size:11px;font-weight:700;color:var(--pale-gold,#f3dba0);margin-left:auto;letter-spacing:.06em;white-space:nowrap}
.bt-hud .bt-apnum b{color:#ffb38a;margin-left:3px}
.bt-hud .bt-mechrow{display:flex;align-items:center;gap:6px;margin-top:5px;height:20px}
.bt-hud .bt-mech{display:flex;align-items:center;gap:5px;height:20px;pointer-events:auto}
.bt-hud .bt-mech > img{width:16px;height:16px;flex:0 0 auto}
.bt-hud .bt-mechtxt{font-family:var(--font-title,"Cinzel",serif);font-size:10px;letter-spacing:.1em;color:var(--parchment,#e9dcc0);white-space:nowrap}
/* Surge: one slanted, segmented meter with a numeric readout */
.bt-hud .bt-surge{display:flex;gap:1px;width:74px;height:10px;padding:1px;transform:skewX(-14deg);border:1px solid rgba(159,211,255,.5);
  border-radius:2px;background:rgba(6,14,24,.75);box-shadow:inset 0 0 4px rgba(0,0,0,.8)}
.bt-hud .bt-surge i{flex:1;background:rgba(111,181,255,.13);transition:background .15s,box-shadow .15s}
.bt-hud .bt-surge i.bt-full{background:linear-gradient(180deg,#f2faff,#6fb5ff 70%,#3f7fd0);box-shadow:0 0 5px rgba(140,200,255,.85)}
.bt-hud .bt-surge.bt-max{border-color:#dff1ff;box-shadow:0 0 10px rgba(159,211,255,.8);animation:bt-surgemax 1.1s ease-in-out infinite}
@keyframes bt-surgemax{50%{box-shadow:0 0 16px rgba(191,227,255,1)}}
.bt-hud .bt-surgenum{font-family:var(--font-title,"Cinzel",serif);font-size:11px;font-weight:700;color:#cfeaff;letter-spacing:.04em;white-space:nowrap}
.bt-hud .bt-surgenum small{font-size:9px;opacity:.6}
/* Glyphs: four sockets that fill left to right */
.bt-hud .bt-glyphs{display:flex;gap:3px}
.bt-hud .bt-glyph{position:relative;width:18px;height:18px;border-radius:50%;border:1px solid rgba(243,219,160,.3);background:radial-gradient(circle,rgba(0,0,0,.2),rgba(0,0,0,.55));
  display:flex;align-items:center;justify-content:center}
.bt-hud .bt-glyph::after{content:"";width:4px;height:4px;border-radius:50%;background:rgba(243,219,160,.28)}
.bt-hud .bt-glyph.bt-full{border-color:transparent;background:none}
.bt-hud .bt-glyph.bt-full::after{display:none}
.bt-hud .bt-glyph img{width:18px;height:18px}
/* Stance badge */
.bt-hud .bt-stance{display:flex;align-items:center;gap:4px;height:18px;padding:0 7px 0 2px;border-radius:10px;border:1px solid rgba(243,219,160,.35);background:rgba(0,0,0,.35)}
.bt-hud .bt-stance img{width:15px;height:15px}
.bt-hud .bt-stance.bt-assault{border-color:#ff9a5a;color:#ffc4a0}
.bt-hud .bt-stance.bt-assault .bt-mechtxt{color:#ffc4a0}
.bt-hud .bt-stance.bt-guard{border-color:#8fc8ff}
.bt-hud .bt-stance.bt-guard .bt-mechtxt{color:#cfe7ff}
.bt-hud .bt-stance.bt-virtuoso{border-color:#ffe08a;background:linear-gradient(90deg,rgba(120,30,24,.6),rgba(60,40,10,.5));box-shadow:0 0 10px rgba(255,224,138,.55)}
.bt-hud .bt-stance.bt-virtuoso .bt-mechtxt{color:#fff3c2;font-weight:700}
.bt-hud .bt-sts{position:absolute;right:10px;bottom:8px;display:flex;gap:2px}
.bt-hud .bt-st{position:relative;width:18px;height:18px;pointer-events:auto}
.bt-hud .bt-st img{width:18px;height:18px;display:block}
.bt-hud .bt-st b{position:absolute;right:-3px;bottom:-4px;font:700 9px/1 var(--font-title,"Cinzel",serif);color:#fff;text-shadow:0 0 2px #000,0 0 2px #000}

/* prism gauge */
.bt-hud .bt-gauge{left:792px;bottom:12px;width:186px;padding:9px 12px 8px;transition:border-color .3s,box-shadow .3s}
.bt-hud .bt-gauge-top{display:flex;justify-content:space-between;align-items:baseline}
.bt-hud .bt-gauge-label{font-size:11px;color:#d9b8ff}
.bt-hud .bt-gauge-count{font-family:var(--font-title,"Cinzel",serif);font-size:16px;font-weight:900;color:#f2e6ff;text-shadow:0 0 10px rgba(199,125,255,.8)}
.bt-hud .bt-segs{display:flex;gap:6px;margin-top:6px}
.bt-hud .bt-seg{position:relative;flex:1;height:16px;border:1px solid rgba(199,125,255,.45);background:rgba(0,0,0,.6);transform:skewX(-18deg);overflow:hidden}
.bt-hud .bt-seg i{position:absolute;left:0;top:0;bottom:0;background:linear-gradient(90deg,#6a3fb0,#c77dff 60%,#ffe6a8);transition:width .25s ease}
.bt-hud .bt-seg.bt-full{border-color:#f0dcff;box-shadow:0 0 12px rgba(199,125,255,.75)}
.bt-hud .bt-seg.bt-full i{animation:bt-shimmer 1.6s linear infinite}
@keyframes bt-shimmer{0%{filter:brightness(1)}50%{filter:brightness(1.35)}100%{filter:brightness(1)}}
.bt-hud .bt-gauge-hint{font-size:12px;opacity:.72;margin-top:5px;text-align:right;letter-spacing:.02em;line-height:1.1;white-space:nowrap}
.bt-hud .bt-gauge.bt-ready{border-color:rgba(214,170,255,.85);box-shadow:0 12px 34px rgba(0,0,0,.5),0 0 18px rgba(199,125,255,.45),inset 0 0 22px rgba(199,125,255,.12)}
.bt-hud .bt-gauge.bt-ready .bt-gauge-hint{opacity:1;color:#e8d2ff}
.bt-hud .bt-gauge.bt-burst{animation:bt-gburst 1.3s ease-out}
@keyframes bt-gburst{0%{box-shadow:0 0 0 rgba(199,125,255,0)}12%{box-shadow:0 0 34px 8px rgba(214,170,255,.95),inset 0 0 30px rgba(255,240,255,.5)}100%{box-shadow:0 12px 34px rgba(0,0,0,.5),0 0 18px rgba(199,125,255,.45)}}
.bt-hud .bt-gcall{position:absolute;left:50%;bottom:100%;margin-bottom:10px;transform:translate(-50%,8px);padding:3px 12px 2px;border-radius:12px;white-space:nowrap;
  font-family:var(--font-title,"Cinzel",serif);font-size:13px;font-weight:900;letter-spacing:.2em;color:#1c0f2a;
  background:linear-gradient(90deg,#ff9ad0,#ffe6a8 30%,#d9b8ff 65%,#8fd8ff);box-shadow:0 0 16px rgba(199,125,255,.9);opacity:0;pointer-events:none}
.bt-hud .bt-gcall.bt-on{animation:bt-gcall 1.9s ease-out forwards}
@keyframes bt-gcall{0%{opacity:0;transform:translate(-50%,8px) scale(.7)}12%{opacity:1;transform:translate(-50%,0) scale(1.08)}22%{transform:translate(-50%,0) scale(1)}
  78%{opacity:1;transform:translate(-50%,0)}100%{opacity:0;transform:translate(-50%,-10px)}}

/* command menu */
.bt-hud .bt-menu{left:486px;bottom:124px;width:244px;padding:10px 0 8px;pointer-events:auto}
.bt-hud .bt-mhead{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:0 14px 7px;border-bottom:1px solid rgba(224,180,88,.22);margin-bottom:5px;min-height:24px}
.bt-hud .bt-mtitle{font-size:13px;font-weight:700;color:var(--pale-gold,#f3dba0)}
.bt-hud .bt-msub{font-family:var(--font-title,"Cinzel",serif);font-size:11px;color:var(--gold,#e0b458);letter-spacing:.08em;margin-right:auto}
.bt-hud .bt-mi{position:relative;display:flex;align-items:center;gap:9px;height:36px;padding:0 12px 0 16px;cursor:pointer;transition:background .1s}
.bt-hud .bt-mi .bt-ic{width:22px;height:22px;display:flex;align-items:center;justify-content:center;font-size:16px;color:var(--gold,#e0b458);flex:0 0 auto}
.bt-hud .bt-mi .bt-ic img{width:20px;height:20px}
.bt-hud .bt-mi .bt-lbl{font-family:var(--font-title,"Cinzel",serif);font-size:15px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;flex:1;min-width:0;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bt-hud .bt-mi .bt-hint{font-family:var(--font-title,"Cinzel",serif);font-size:11px;color:var(--parchment,#e9dcc0);opacity:.75;letter-spacing:.04em;white-space:nowrap}
.bt-hud .bt-mi .bt-hint.bt-hot{opacity:1;color:#1c0f2a;font-weight:900;padding:1px 7px 0;border-radius:9px;letter-spacing:.1em;
  background:linear-gradient(90deg,#f2e0ff,#c77dff);box-shadow:0 0 10px rgba(199,125,255,.8)}
.bt-hud .bt-mi.bt-sel{background:linear-gradient(90deg,rgba(224,180,88,.34),rgba(224,180,88,.08) 70%,transparent)}
.bt-hud .bt-mi.bt-sel::before{content:"";position:absolute;left:4px;top:50%;width:0;height:0;margin-top:-5px;border-left:7px solid var(--pale-gold,#f3dba0);
  border-top:5px solid transparent;border-bottom:5px solid transparent;filter:drop-shadow(0 0 4px rgba(243,219,160,.9))}
.bt-hud .bt-mi.bt-sel .bt-lbl{color:#fffaf0;text-shadow:0 0 10px rgba(243,219,160,.45)}
.bt-hud .bt-mi.bt-prism{box-shadow:inset 0 0 0 1px rgba(214,170,255,.55);animation:bt-prismrow 1.6s ease-in-out infinite}
.bt-hud .bt-mi.bt-prism .bt-lbl{color:#f2e6ff;text-shadow:0 0 10px rgba(199,125,255,.8)}
@keyframes bt-prismrow{50%{box-shadow:inset 0 0 0 1px rgba(240,220,255,.95),inset 0 0 16px rgba(199,125,255,.35)}}
.bt-hud .bt-mi.bt-dis{opacity:.4}
.bt-hud .bt-mi.bt-dis.bt-sel{opacity:.62}
.bt-hud .bt-mreason{padding:6px 14px 0;font-size:14px;font-style:italic;color:#ffb3a0;min-height:22px;line-height:1.1}
.bt-hud .bt-mreason.bt-note{color:var(--parchment,#e9dcc0);opacity:.85}

/* lists (skills / items / prism) with a details pane */
.bt-hud .bt-list{left:486px;top:132px;width:352px;padding:10px 0 0;pointer-events:auto}
.bt-hud .bt-rows{max-height:256px;overflow:hidden}
.bt-hud .bt-row{position:relative;display:flex;align-items:center;gap:9px;height:32px;padding:0 12px 0 18px;cursor:pointer}
.bt-hud .bt-row img{width:20px;height:20px;flex:0 0 auto}
.bt-hud .bt-row .bt-rn{flex:1;min-width:0;font-size:19px;font-weight:600;line-height:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bt-hud .bt-rtag{font-family:var(--font-title,"Cinzel",serif);font-size:9px;letter-spacing:.12em;color:#d9b8ff;border:1px solid rgba(199,125,255,.5);padding:1px 4px 0;border-radius:3px;white-space:nowrap}
.bt-hud .bt-row .bt-cost{min-width:30px;height:22px;padding:0 6px;border-radius:11px;display:flex;align-items:center;justify-content:center;gap:2px;flex:0 0 auto;
  font-family:var(--font-title,"Cinzel",serif);font-weight:900;font-size:13px;color:#1b120c;background:linear-gradient(180deg,#fff3c2,#e0b458)}
.bt-hud .bt-row .bt-cost small{font-size:8px;font-weight:700;letter-spacing:.05em}
.bt-hud .bt-row .bt-cost.bt-grad{background:linear-gradient(180deg,#f2e0ff,#b07ae8)}
.bt-hud .bt-row .bt-cost.bt-count{background:rgba(0,0,0,.4);color:var(--pale-gold,#f3dba0);border:1px solid rgba(243,219,160,.45)}
.bt-hud .bt-row.bt-sel{background:linear-gradient(90deg,rgba(224,180,88,.32),rgba(224,180,88,.06) 75%,transparent)}
.bt-hud .bt-row.bt-sel::before{content:"";position:absolute;left:5px;top:50%;margin-top:-5px;border-left:7px solid var(--pale-gold,#f3dba0);
  border-top:5px solid transparent;border-bottom:5px solid transparent}
.bt-hud .bt-row.bt-dis .bt-rn,.bt-hud .bt-row.bt-dis img{opacity:.45}
.bt-hud .bt-row.bt-dis .bt-cost{filter:grayscale(1) brightness(.7)}
.bt-hud .bt-desc{margin-top:6px;padding:9px 14px 10px;border-top:1px solid rgba(224,180,88,.22);background:rgba(0,0,0,.25);
  min-height:112px;max-height:172px;overflow-y:auto;scrollbar-width:thin;scrollbar-color:rgba(224,180,88,.45) transparent}
.bt-hud .bt-desc-short{display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-family:var(--font-title,"Cinzel",serif);font-size:11px;letter-spacing:.08em;color:var(--gold,#e0b458);margin-bottom:3px}
.bt-hud .bt-desc-short .bt-rtag{display:none}
.bt-hud .bt-desc-why{font-size:14.5px;font-style:italic;font-weight:600;color:#ffb3a0;margin:1px 0 4px}
.bt-hud .bt-desc-why::before{content:"✕ ";font-style:normal;font-size:12px}
.bt-hud .bt-desc-txt{font-size:15.5px;line-height:1.22;color:var(--parchment,#e9dcc0)}
.bt-hud .bt-desc-fl{font-size:14px;line-height:1.2;font-style:italic;color:var(--parchment,#e9dcc0);opacity:.62;margin-top:5px}

/* target info */
.bt-hud .bt-target{left:486px;top:140px;width:318px;padding:10px 14px 11px;pointer-events:auto}
.bt-hud .bt-thead{display:flex;align-items:flex-start;gap:10px}
.bt-hud .bt-thead > div{flex:1;min-width:0}
.bt-hud .bt-tname{font-family:var(--font-title,"Cinzel",serif);font-size:15px;font-weight:700;letter-spacing:.1em;color:var(--pale-gold,#f3dba0)}
.bt-hud .bt-tsub{font-size:14px;opacity:.8;margin-top:1px}
.bt-hud .bt-trow{display:flex;align-items:center;gap:6px;margin-top:6px;font-size:14.5px}
.bt-hud .bt-trow .bt-tk{font-family:var(--font-title,"Cinzel",serif);font-size:10px;letter-spacing:.12em;width:52px;flex:0 0 auto;opacity:.85}
.bt-hud .bt-trow img{width:18px;height:18px}
.bt-hud .bt-weak{color:#ffae7a}.bt-hud .bt-res{color:#a8c0d8}.bt-hud .bt-imm{color:#c8c0b8}
.bt-hud .bt-tnote{font-size:14px;font-style:italic;opacity:.75;margin-top:6px}
.bt-hud .bt-tfoot{display:flex;align-items:center;justify-content:flex-end;gap:8px;margin-top:9px}
.bt-hud .bt-thelp{flex:1;min-width:0;font-size:13.5px;line-height:1.35;opacity:.78}

/* enemy-turn legend */
.bt-hud .bt-legend{right:12px;bottom:12px;padding:8px 12px 9px;display:flex;flex-direction:column;gap:4px;width:276px}
.bt-hud .bt-legend::after{display:none}
.bt-hud .bt-lg{display:flex;align-items:center;gap:7px;font-size:15px;line-height:1.15;transition:opacity .1s}
.bt-hud .bt-lg .bt-key{min-width:46px;margin:0}
.bt-hud .bt-lg img{width:20px;height:20px;flex:0 0 auto}
.bt-hud .bt-lg em{font-style:normal;opacity:.72;font-size:13.5px;margin-left:auto;white-space:nowrap}
.bt-hud .bt-legend.bt-locked .bt-lg{opacity:.35}
.bt-hud .bt-lgt{font-size:10px;color:var(--gold,#e0b458);display:flex;justify-content:space-between}
.bt-hud .bt-lgt b{color:#ff9a86;font-weight:700;opacity:0;transition:opacity .08s}
.bt-hud .bt-legend.bt-locked .bt-lgt b{opacity:1}

/* touch buttons: two thumb clusters */
.bt-hud .bt-touch{position:absolute;inset:0;pointer-events:none}
.bt-hud .bt-tcl{position:absolute;display:flex;flex-direction:column;align-items:center;gap:12px}
.bt-hud .bt-tcl.bt-l{left:14px;bottom:112px}
.bt-hud .bt-tcl.bt-r{right:14px;bottom:20px}
.bt-hud .bt-tb{position:relative;width:96px;height:96px;border-radius:50%;border:3px solid rgba(243,219,160,.7);display:flex;flex-direction:column;align-items:center;justify-content:center;
  background:radial-gradient(circle at 50% 35%,rgba(70,52,38,.95),rgba(16,12,10,.95));box-shadow:0 6px 18px rgba(0,0,0,.6);touch-action:none;pointer-events:auto;
  font-family:var(--font-title,"Cinzel",serif);font-size:14px;font-weight:700;letter-spacing:.1em;color:var(--pale-gold,#f3dba0);text-transform:uppercase;
  transition:filter .12s,transform .06s}
.bt-hud .bt-tb img{width:36px;height:36px;margin-bottom:3px}
.bt-hud .bt-tb span{font-size:30px;line-height:1;margin-bottom:3px}
.bt-hud .bt-tb.bt-press{transform:scale(.92);border-color:#fff}
.bt-hud .bt-tb.bt-parry{border-color:#ffffff}.bt-hud .bt-tb.bt-dodge{border-color:#ff8a7a}
.bt-hud .bt-tb.bt-jump{border-color:#ffcc33}.bt-hud .bt-tb.bt-gradient{border-color:#c77dff}
.bt-hud .bt-tb.bt-strike{width:128px;height:128px;border-color:#fff3c2}
.bt-hud .bt-tb::after{content:"✕";position:absolute;inset:-7px;border-radius:50%;border:3px solid #ff8a76;display:flex;align-items:center;justify-content:center;
  font-size:40px;color:#ff8a76;text-shadow:0 0 8px #000;opacity:0;pointer-events:none}
.bt-hud .bt-touch.bt-lockout .bt-tb{filter:grayscale(1) brightness(.5)}
.bt-hud .bt-touch.bt-lockout .bt-tb.bt-whiff{filter:grayscale(.6) brightness(.75)}
.bt-hud .bt-touch.bt-lockout .bt-tb.bt-whiff::after{animation:bt-whiff var(--lock-ms,380ms) linear forwards}
@keyframes bt-whiff{0%{opacity:1;transform:scale(1.12)}15%{opacity:1;transform:scale(1)}100%{opacity:0;transform:scale(.9)}}
.bt-hud .bt-tlock{position:absolute;left:50%;bottom:196px;transform:translateX(-50%);padding:4px 14px 3px;border-radius:14px;background:rgba(20,8,6,.88);
  border:1px solid rgba(255,138,118,.7);font-family:var(--font-title,"Cinzel",serif);font-size:15px;font-weight:700;letter-spacing:.14em;color:#ffb3a0;
  text-transform:uppercase;opacity:0;transition:opacity .08s;white-space:nowrap}
.bt-hud .bt-touch.bt-lockout .bt-tlock{opacity:1}

/* hint */
.bt-hud .bt-dim{position:absolute;inset:0;background:radial-gradient(ellipse at center,rgba(10,6,4,.35),rgba(10,6,4,.72));pointer-events:auto}
.bt-hud .bt-hintp{left:50%;top:44%;width:620px;margin-left:-310px;padding:18px 26px 16px;transform:translateY(-50%);pointer-events:auto;cursor:pointer}
.bt-hud .bt-hintp.bt-fade.bt-on{transform:translateY(-50%)}
.bt-hud .bt-hintp.bt-fade{transform:translateY(calc(-50% + 8px))}
.bt-hud .bt-htag{font-size:10px;color:var(--gold,#e0b458);letter-spacing:.3em}
.bt-hud .bt-htitle{font-family:var(--font-title,"Cinzel",serif);font-size:24px;font-weight:700;letter-spacing:.1em;color:var(--pale-gold,#f3dba0);margin:2px 0 8px;
  padding-bottom:8px;border-bottom:1px solid rgba(224,180,88,.3)}
.bt-hud .bt-htext{font-size:21px;line-height:1.3;color:var(--ivory,#f5eedf)}
.bt-hud .bt-htext .bt-key{font-size:13px}
.bt-hud .bt-hfoot{margin-top:14px;text-align:right;font-size:15px;opacity:.85}

/* pause */
.bt-hud .bt-pause{left:50%;top:50%;width:340px;margin-left:-170px;padding:18px 0 14px;transform:translateY(-50%);pointer-events:auto;
  background:linear-gradient(180deg,#221912 0%,#120d0a 100%)}
.bt-hud .bt-pause.bt-fade.bt-on{transform:translateY(-50%)}
.bt-hud .bt-pause.bt-fade{transform:translateY(calc(-50% + 8px))}
.bt-hud .bt-ptitle{text-align:center;font-family:var(--font-title,"Cinzel",serif);font-size:22px;letter-spacing:.24em;color:var(--pale-gold,#f3dba0);margin-bottom:4px}
.bt-hud .bt-psub{text-align:center;font-size:15px;opacity:.7;margin-bottom:10px;padding:0 20px}
.bt-hud .bt-pause .bt-mi{justify-content:center;padding:0 24px}
.bt-hud .bt-pause .bt-mi .bt-lbl{flex:0 0 auto}
.bt-hud.bt-touchdev .bt-pause .bt-mi{height:52px}

/* results */
.bt-hud .bt-results{left:50%;top:50%;width:820px;margin-left:-410px;padding:20px 30px 18px;transform:translateY(-50%);pointer-events:auto;cursor:pointer}
.bt-hud .bt-results.bt-fade.bt-on{transform:translateY(-50%)}
.bt-hud .bt-results.bt-fade{transform:translateY(calc(-50% + 10px))}
.bt-hud .bt-rtitle{text-align:center;font-family:var(--font-title,"Cinzel",serif);font-size:34px;font-weight:900;letter-spacing:.3em;color:var(--pale-gold,#f3dba0);
  text-shadow:0 0 18px rgba(224,180,88,.5)}
.bt-hud .bt-rsub{text-align:center;font-size:17px;opacity:.8;margin:2px 0 14px}
.bt-hud .bt-rmembers{display:flex;flex-direction:column;gap:10px}
.bt-hud .bt-rm{position:relative;display:flex;align-items:center;gap:14px;padding:6px 10px;border:1px solid rgba(224,180,88,.18);background:rgba(0,0,0,.25);border-radius:3px;
  transition:border-color .3s,background .3s}
.bt-hud .bt-rm.bt-leveled{border-color:rgba(243,219,160,.55);background:linear-gradient(90deg,rgba(224,180,88,.14),rgba(0,0,0,.25) 60%)}
.bt-hud .bt-rm > img{width:52px;height:52px;border-radius:50%;border:2px solid var(--c,#e0b458);flex:0 0 auto}
.bt-hud .bt-rm .bt-rmain{flex:1;min-width:0}
.bt-hud .bt-rm .bt-rtop{display:flex;align-items:baseline;gap:8px}
.bt-hud .bt-rm .bt-rtop .bt-name{flex:0 1 auto}
.bt-hud .bt-rm .bt-rlv{font-family:var(--font-title,"Cinzel",serif);font-size:13px;letter-spacing:.1em;color:var(--parchment,#e9dcc0);margin-left:auto;white-space:nowrap}
.bt-hud .bt-rm .bt-rlv b{display:inline-block;color:#fff3c2;font-size:15px}
.bt-hud .bt-rm .bt-rlv b.bt-pop{animation:bt-lvnum .5s cubic-bezier(.2,1.6,.4,1)}
@keyframes bt-lvnum{0%{transform:scale(1.9);color:#fff}100%{transform:none}}
.bt-hud .bt-xprow{display:flex;align-items:center;gap:10px;margin-top:5px}
.bt-hud .bt-xpbar{position:relative;flex:1;height:9px;background:rgba(0,0,0,.6);border:1px solid rgba(243,219,160,.28);overflow:hidden;border-radius:2px}
.bt-hud .bt-xpbar i{position:absolute;left:0;top:0;bottom:0;background:linear-gradient(90deg,#b8893b,#fff3c2);transition:width .18s linear}
.bt-hud .bt-xpbar.bt-flash{border-color:#fff3c2;box-shadow:0 0 14px rgba(255,243,194,.9)}
.bt-hud .bt-xpbar.bt-flash i{background:linear-gradient(90deg,#fff3c2,#ffffff);animation:bt-xpflash .45s ease-out}
@keyframes bt-xpflash{0%{filter:brightness(2.2)}100%{filter:brightness(1)}}
.bt-hud .bt-xpnum{font-family:var(--font-title,"Cinzel",serif);font-size:12px;letter-spacing:.04em;color:var(--parchment,#e9dcc0);opacity:.85;min-width:104px;text-align:right;white-space:nowrap}
.bt-hud .bt-rm .bt-rxp{font-family:var(--font-title,"Cinzel",serif);font-size:13px;color:var(--gold,#e0b458);min-width:84px;text-align:right;white-space:nowrap}
.bt-hud .bt-lvup{position:absolute;left:78px;top:-9px;padding:2px 12px 1px;border-radius:3px;font-family:var(--font-title,"Cinzel",serif);font-size:12px;font-weight:900;
  letter-spacing:.2em;color:#1b120c;background:linear-gradient(180deg,#fff8dc,#e0b458);box-shadow:0 0 14px rgba(243,219,160,.85);opacity:0;pointer-events:none;white-space:nowrap}
.bt-hud .bt-lvup.bt-on{animation:bt-ribbon .55s cubic-bezier(.2,1.5,.4,1) forwards}
.bt-hud .bt-lvup::before,.bt-hud .bt-lvup::after{content:"✦";position:absolute;top:50%;margin-top:-8px;font-size:13px;color:#fff3c2;text-shadow:0 0 6px #fff}
.bt-hud .bt-lvup::before{left:-14px}.bt-hud .bt-lvup::after{right:-14px}
@keyframes bt-ribbon{0%{opacity:0;transform:translateX(-18px) scale(.6)}60%{opacity:1;transform:translateX(3px) scale(1.08)}100%{opacity:1;transform:none}}
.bt-hud .bt-rm .bt-gains{display:flex;flex-wrap:wrap;gap:5px;margin-top:5px;opacity:0;transition:opacity .3s}
.bt-hud .bt-rm .bt-gains.bt-on{opacity:1}
.bt-hud .bt-rm .bt-gains:empty{display:none}
.bt-hud .bt-chipx{font-size:14px;line-height:1;padding:3px 8px 2px;border-radius:9px;border:1px solid rgba(243,219,160,.45);background:rgba(224,180,88,.12);color:#fff3c2;white-space:nowrap}
.bt-hud .bt-chipx.bt-skill{border-color:rgba(199,125,255,.6);background:rgba(199,125,255,.14);color:#f2e6ff}
.bt-hud .bt-rloot{display:flex;flex-wrap:wrap;gap:8px 18px;margin-top:14px;padding-top:12px;border-top:1px solid rgba(224,180,88,.22);font-size:17px}
.bt-hud .bt-rloot div{display:flex;align-items:center;gap:6px}
.bt-hud .bt-rloot img{width:20px;height:20px}
.bt-hud .bt-rloot b{font-family:var(--font-title,"Cinzel",serif);color:var(--pale-gold,#f3dba0);font-size:14px;letter-spacing:.06em}
.bt-hud .bt-rstats{margin-top:10px;font-size:14.5px;opacity:.72;text-align:center}
.bt-hud .bt-rfoot{margin-top:12px;text-align:right;font-size:15px;opacity:.9}
.bt-hud .bt-rfoot.bt-wait{opacity:.3}

/* toast, practice, free aim, info */
.bt-hud .bt-toast{position:absolute;left:0;right:0;top:152px;text-align:center;pointer-events:none}
.bt-hud .bt-toast span{display:inline-block;padding:6px 18px 5px;border-radius:18px;background:rgba(14,10,8,.88);border:1px solid rgba(255,160,130,.55);
  font-size:17px;font-style:italic;color:#ffd0c0;opacity:0;transform:translateY(-4px);transition:opacity .15s,transform .15s}
.bt-hud .bt-toast span.bt-on{opacity:1;transform:none}
.bt-hud .bt-practice{right:14px;top:76px;width:340px;padding:10px 14px 10px;pointer-events:auto}
.bt-hud.bt-touchdev .bt-practice{top:88px}
.bt-hud .bt-practice::after{display:none}
.bt-hud .bt-prtop{display:flex;justify-content:space-between;align-items:center}
.bt-hud .bt-prtag{font-size:12px;font-weight:700;color:var(--pale-gold,#f3dba0);letter-spacing:.24em}
.bt-hud .bt-prleave{font-size:13.5px;opacity:.8}
.bt-hud .bt-prnext{display:flex;align-items:center;gap:6px;margin-top:8px;font-size:17px}
.bt-hud .bt-prnext .bt-arrow{cursor:pointer;padding:0 6px;color:var(--gold,#e0b458);font-size:16px}
.bt-hud .bt-prnext .bt-pn{flex:1;text-align:center;font-weight:700;color:#fffaf0}
.bt-hud .bt-prdesc{font-size:14px;opacity:.72;text-align:center;min-height:17px;font-style:italic}
.bt-hud .bt-prlog{margin-top:6px;border-top:1px solid rgba(224,180,88,.2);padding-top:5px;font-size:14px;line-height:1.3}
.bt-hud .bt-prlog div{display:flex;gap:8px}
.bt-hud .bt-prlog .bt-o{font-family:var(--font-title,"Cinzel",serif);font-size:11px;letter-spacing:.06em;min-width:118px;white-space:nowrap}
.bt-hud .bt-prlog .bt-ok{color:#bfe9a0}.bt-hud .bt-prlog .bt-bad{color:#ff9a86}
.bt-hud .bt-prlog em{font-style:normal;opacity:.75;margin-left:auto;white-space:nowrap}
.bt-hud .bt-prlog .bt-pl{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bt-hud .bt-aim{left:50%;top:92px;width:600px;margin-left:-300px;padding:8px 12px 8px 16px;display:flex;align-items:center;gap:12px;pointer-events:auto}
.bt-hud .bt-aim-main{flex:1;min-width:0;text-align:center}
.bt-hud .bt-aim-top{font-family:var(--font-title,"Cinzel",serif);font-size:13px;letter-spacing:.16em;color:var(--pale-gold,#f3dba0)}
.bt-hud .bt-aim-mid{font-size:17px;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bt-hud .bt-aim-mid.bt-weakon{color:#fff3c2;text-shadow:0 0 10px rgba(243,219,160,.6)}
.bt-hud .bt-aim-bot{font-size:14px;opacity:.78;margin-top:3px;white-space:nowrap}
.bt-hud .bt-info{left:50%;top:92px;width:520px;margin-left:-260px;padding:7px 14px 6px;text-align:center;font-size:16px}
.bt-hud .bt-info::after{display:none}

/* ------------------------------------------------------------------ compact layout (phones)
   The root is sized to the stage's on-screen CSS size and counter-scaled, so every value below is a real CSS px. */
.bt-hud.bt-compact .bt-key{font-size:11px;line-height:15px;padding:1px 5px 0;min-width:18px}
.bt-hud.bt-compact .bt-btn{height:42px;padding:0 14px 0 11px;border-radius:21px;font-size:12px}
.bt-hud.bt-compact .bt-nav{right:6px;top:6px;width:44px;height:44px;padding:0;border-radius:50%}
.bt-hud.bt-compact .bt-nav i{height:13px;gap:4px}
.bt-hud.bt-compact .bt-nav i::before,.bt-hud.bt-compact .bt-nav i::after{width:4px;height:13px}
.bt-hud.bt-compact .bt-nav span{display:none}
.bt-hud.bt-compact .bt-panel::after{top:-4px;width:7px;height:7px;margin-left:-3.5px}
.bt-hud.bt-compact .bt-turns{left:6px;top:6px;padding:3px 9px 3px 6px;gap:5px}
.bt-hud.bt-compact .bt-turns-label{font-size:11px;letter-spacing:.08em}
.bt-hud.bt-compact .bt-turnlist{gap:5px}
.bt-hud.bt-compact .bt-chip{width:28px;height:28px;border-width:2px}
.bt-hud.bt-compact .bt-chip.bt-now{width:38px;height:38px}
.bt-hud.bt-compact .bt-chip.bt-now::after{font-size:11px;bottom:-8px;padding:0 4px;letter-spacing:.06em;line-height:12px}
.bt-hud.bt-compact .bt-chip.bt-far{display:none}
.bt-hud.bt-compact .bt-sep{height:20px}
.bt-hud.bt-compact .bt-party{left:6px;bottom:6px;right:176px;gap:4px}
.bt-hud.bt-compact .bt-card{flex:1 1 0;min-width:0;width:auto;height:60px;padding:4px 6px 4px 44px}
.bt-hud.bt-compact .bt-card.bt-active{transform:translateY(-4px)}
.bt-hud.bt-compact .bt-card .bt-pt{left:5px;top:5px;width:34px;height:34px}
.bt-hud.bt-compact .bt-card .bt-kotag{left:5px;top:14px;width:34px;font-size:11px;letter-spacing:.04em}
.bt-hud.bt-compact .bt-card .bt-lv{left:1px;bottom:3px;width:42px;font-size:11px;letter-spacing:0;opacity:.9}
.bt-hud.bt-compact .bt-name{font-size:12px;line-height:15px;letter-spacing:.06em;padding-right:var(--sts-w,0px)}
.bt-hud.bt-compact .bt-hprow{margin-top:2px;gap:4px}
.bt-hud.bt-compact .bt-hpbar{height:7px}
.bt-hud.bt-compact .bt-hpnum{font-size:12px;min-width:0}
.bt-hud.bt-compact .bt-hpnum small{font-size:11px}
.bt-hud.bt-compact .bt-aprow{display:inline-flex;vertical-align:middle;margin-top:4px;height:18px}
.bt-hud.bt-compact .bt-pip{display:none}
.bt-hud.bt-compact .bt-apnum{font-size:12px;margin-left:0;letter-spacing:.02em}
.bt-hud.bt-compact .bt-mechrow{display:inline-flex;vertical-align:middle;margin:4px 0 0 7px;height:18px}
.bt-hud.bt-compact .bt-mech{gap:3px;height:18px}
.bt-hud.bt-compact .bt-mech > img{width:13px;height:13px}
.bt-hud.bt-compact .bt-mechtxt{font-size:11px;letter-spacing:.03em}
.bt-hud.bt-compact .bt-surge{width:34px;height:8px}
.bt-hud.bt-compact .bt-surgenum{font-size:11px}
.bt-hud.bt-compact .bt-surgenum small{font-size:11px}
.bt-hud.bt-compact .bt-glyphs{gap:2px}
.bt-hud.bt-compact .bt-glyph,.bt-hud.bt-compact .bt-glyph img{width:14px;height:14px}
.bt-hud.bt-compact .bt-glyph::after{width:3px;height:3px}
.bt-hud.bt-compact .bt-stance{height:16px;padding:0 5px 0 1px;gap:2px}
.bt-hud.bt-compact .bt-stance img{width:13px;height:13px}
.bt-hud.bt-compact .bt-sts{right:9px;top:3px;bottom:auto;gap:7px}
.bt-hud.bt-compact .bt-st,.bt-hud.bt-compact .bt-st img{width:14px;height:14px}
.bt-hud.bt-compact .bt-st:nth-child(n+4){display:none}
.bt-hud.bt-compact .bt-st b{font-size:11px;right:-7px;top:-2px;bottom:auto}
.bt-hud.bt-compact .bt-gauge{left:auto;right:6px;bottom:6px;width:164px;height:60px;padding:5px 9px 4px}
.bt-hud.bt-compact .bt-gauge-label{font-size:11px;letter-spacing:.1em}
.bt-hud.bt-compact .bt-gauge-count{font-size:14px}
.bt-hud.bt-compact .bt-segs{gap:4px;margin-top:3px}
.bt-hud.bt-compact .bt-seg{height:11px}
.bt-hud.bt-compact .bt-gauge-hint{font-size:11px;margin-top:3px}
.bt-hud.bt-compact .bt-gcall{font-size:11px;letter-spacing:.14em;margin-bottom:6px}
.bt-hud.bt-compact .bt-menu{left:50%;bottom:74px;width:244px;margin-left:-122px;padding:6px 0 6px}
.bt-hud.bt-compact .bt-mhead{padding:0 10px 4px;margin-bottom:2px;min-height:20px;gap:8px}
.bt-hud.bt-compact .bt-mtitle{font-size:12px}
.bt-hud.bt-compact .bt-msub{font-size:12px}
.bt-hud.bt-compact .bt-menu .bt-mitems{display:grid;grid-template-columns:1fr 1fr;grid-auto-flow:column;grid-template-rows:repeat(var(--rows,3),44px)}
.bt-hud.bt-compact .bt-mi{display:grid;grid-template-columns:18px minmax(0,1fr);grid-template-rows:auto auto;align-content:center;column-gap:6px;row-gap:1px;
  height:44px;padding:0 6px 0 14px}
.bt-hud.bt-compact .bt-mi .bt-ic{grid-row:1 / span 2}
.bt-hud.bt-compact .bt-mi .bt-hint{grid-column:2;justify-self:start;line-height:13px}
.bt-hud.bt-compact .bt-mi .bt-ic{width:18px;height:18px;font-size:14px}
.bt-hud.bt-compact .bt-mi .bt-ic img{width:18px;height:18px}
.bt-hud.bt-compact .bt-mi .bt-lbl{font-size:12px;letter-spacing:.06em;line-height:14px}
.bt-hud.bt-compact .bt-pause .bt-mi{display:flex}
.bt-hud.bt-compact .bt-mi .bt-hint{font-size:11px;letter-spacing:0}
.bt-hud.bt-compact .bt-mi .bt-hint.bt-hot{padding:1px 5px 0;letter-spacing:.04em}
.bt-hud.bt-compact .bt-mi.bt-sel::before{left:3px;border-left-width:6px}
.bt-hud.bt-compact .bt-mreason{font-size:12px;padding:3px 10px 0;min-height:18px}
.bt-hud.bt-compact .bt-list{left:6px;right:6px;top:54px;width:auto;max-width:660px;margin:0 auto;padding:4px 0 0}
.bt-hud.bt-compact .bt-lbody{display:flex;align-items:flex-start}
.bt-hud.bt-compact .bt-rows{flex:1.3 1 0;min-width:0;max-height:none;display:grid;grid-template-columns:1fr 1fr;grid-auto-flow:column;
  grid-template-rows:repeat(var(--rows,4),40px);align-content:start}
.bt-hud.bt-compact .bt-row{height:40px;padding:0 5px 0 13px;gap:4px}
.bt-hud.bt-compact .bt-row img{width:16px;height:16px}
.bt-hud.bt-compact .bt-row .bt-rn{font-size:13.5px}
.bt-hud.bt-compact .bt-row .bt-rtag{display:none}
.bt-hud.bt-compact .bt-row .bt-cost{min-width:26px;height:19px;padding:0 5px;font-size:12px}
.bt-hud.bt-compact .bt-row .bt-cost small{font-size:11px}
.bt-hud.bt-compact .bt-row.bt-sel::before{left:3px}
.bt-hud.bt-compact .bt-desc{flex:1 1 0;min-width:0;margin:0 0 6px;padding:5px 9px 6px;border-top:none;border-left:1px solid rgba(224,180,88,.22);min-height:160px;max-height:none;overflow:hidden}
.bt-hud.bt-compact .bt-desc-short{font-size:11px;letter-spacing:.04em;margin-bottom:2px}
.bt-hud.bt-compact .bt-desc-short .bt-rtag{display:inline-block;font-size:11px;letter-spacing:.04em}
.bt-hud.bt-compact .bt-desc-why{font-size:13px;margin:0 0 3px}
.bt-hud.bt-compact .bt-desc-why::before{font-size:11px}
.bt-hud.bt-compact .bt-desc-txt{font-size:13px;line-height:1.2}
.bt-hud.bt-compact .bt-desc-fl{font-size:12px;margin-top:3px}
.bt-hud.bt-compact .bt-target{left:6px;top:54px;width:300px;padding:6px 9px 7px}
.bt-hud.bt-compact .bt-target.bt-allies{left:auto;right:6px}
.bt-hud.bt-compact .bt-tname{font-size:13px;letter-spacing:.06em}
.bt-hud.bt-compact .bt-tsub{font-size:12px}
.bt-hud.bt-compact .bt-trow{font-size:12px;margin-top:3px;gap:4px}
.bt-hud.bt-compact .bt-trow .bt-tk{font-size:11px;letter-spacing:.04em;width:46px}
.bt-hud.bt-compact .bt-trow img{width:14px;height:14px}
.bt-hud.bt-compact .bt-tnote{font-size:12px;margin-top:3px}
.bt-hud.bt-compact .bt-thelp{font-size:12px;margin-top:4px}
.bt-hud.bt-compact .bt-tfoot{margin-top:5px;gap:6px}
.bt-hud.bt-compact .bt-legend{right:6px;bottom:72px;width:236px;padding:5px 8px 6px;gap:2px}
.bt-hud.bt-compact .bt-lgt{font-size:11px}
.bt-hud.bt-compact .bt-lg{font-size:12px;gap:5px}
.bt-hud.bt-compact .bt-lg .bt-key{min-width:38px}
.bt-hud.bt-compact .bt-lg img{width:15px;height:15px}
.bt-hud.bt-compact .bt-lg em{font-size:11px}
.bt-hud.bt-compact .bt-tcl{gap:10px}
.bt-hud.bt-compact .bt-tcl.bt-l{left:8px;bottom:72px}
.bt-hud.bt-compact .bt-tcl.bt-r{right:8px;bottom:72px}
.bt-hud.bt-compact .bt-tb{width:68px;height:68px;border-width:2px;font-size:12px;letter-spacing:.06em}
.bt-hud.bt-compact .bt-tb img{width:26px;height:26px;margin-bottom:2px}
.bt-hud.bt-compact .bt-tb span{font-size:22px}
.bt-hud.bt-compact .bt-tb.bt-strike{width:88px;height:88px}
.bt-hud.bt-compact .bt-tb::after{font-size:28px;inset:-5px}
.bt-hud.bt-compact .bt-tlock{bottom:auto;top:58px;font-size:12px;padding:3px 10px 2px}
.bt-hud.bt-compact .bt-hintp{top:50%;width:auto;left:20px;right:20px;max-width:560px;margin:0 auto;padding:10px 16px 10px}
.bt-hud.bt-compact .bt-htag{font-size:11px;letter-spacing:.2em}
.bt-hud.bt-compact .bt-htitle{font-size:17px;margin:1px 0 5px;padding-bottom:5px}
.bt-hud.bt-compact .bt-htext{font-size:15px;line-height:1.25}
.bt-hud.bt-compact .bt-htext .bt-key{font-size:11px}
.bt-hud.bt-compact .bt-hfoot{font-size:13px;margin-top:8px}
.bt-hud.bt-compact .bt-pause{width:280px;margin-left:-140px;padding:10px 0 8px}
.bt-hud.bt-compact .bt-ptitle{font-size:17px}
.bt-hud.bt-compact .bt-psub{font-size:12px;margin-bottom:5px}
.bt-hud.bt-compact .bt-pause .bt-mi{height:44px}
.bt-hud.bt-compact .bt-results{left:10px;right:10px;width:auto;max-width:720px;margin:0 auto;padding:9px 14px 9px;max-height:calc(100% - 12px);overflow:hidden}
.bt-hud.bt-compact .bt-rtitle{font-size:21px;letter-spacing:.2em}
.bt-hud.bt-compact .bt-rsub{font-size:13px;margin:0 0 6px}
.bt-hud.bt-compact .bt-rmembers{gap:9px}
.bt-hud.bt-compact .bt-rm{gap:8px;padding:4px 8px}
.bt-hud.bt-compact .bt-rm > img{width:36px;height:36px}
.bt-hud.bt-compact .bt-rm .bt-rlv{font-size:11px}
.bt-hud.bt-compact .bt-rm .bt-rlv b{font-size:13px}
.bt-hud.bt-compact .bt-xprow{margin-top:3px;gap:6px}
.bt-hud.bt-compact .bt-xpbar{height:7px}
.bt-hud.bt-compact .bt-xpnum{font-size:11px;min-width:84px}
.bt-hud.bt-compact .bt-rm .bt-rxp{font-size:12px;min-width:62px}
.bt-hud.bt-compact .bt-lvup{left:52px;top:-8px;font-size:11px;padding:1px 9px 0;letter-spacing:.12em}
.bt-hud.bt-compact .bt-rm .bt-gains{gap:4px;margin-top:3px}
.bt-hud.bt-compact .bt-chipx{font-size:11px;padding:2px 6px 1px}
.bt-hud.bt-compact .bt-rloot{font-size:13px;margin-top:7px;padding-top:6px;gap:4px 12px}
.bt-hud.bt-compact .bt-rloot img{width:16px;height:16px}
.bt-hud.bt-compact .bt-rloot b{font-size:12px}
.bt-hud.bt-compact .bt-rstats{font-size:12px;margin-top:5px}
.bt-hud.bt-compact .bt-rfoot{font-size:13px;margin-top:5px}
.bt-hud.bt-compact .bt-toast{top:92px}
.bt-hud.bt-compact .bt-toast span{font-size:14px;padding:4px 12px 3px}
.bt-hud.bt-compact .bt-practice{right:6px;top:56px;width:204px;padding:4px 6px 5px}
.bt-hud.bt-compact .bt-prtag{font-size:11px;letter-spacing:.14em}
.bt-hud.bt-compact .bt-prleave,.bt-hud.bt-compact .bt-prdesc{display:none}
.bt-hud.bt-compact .bt-prnext{font-size:13px;margin-top:3px}
.bt-hud.bt-compact .bt-prnext .bt-arrow{font-size:14px;padding:0;width:40px;height:40px;display:flex;align-items:center;justify-content:center;pointer-events:auto}
.bt-hud.bt-compact .bt-prdesc{font-size:12px;min-height:0}
.bt-hud.bt-compact .bt-prlog{font-size:12px;margin-top:3px;padding-top:3px}
.bt-hud.bt-compact .bt-prlog .bt-o{font-size:11px;min-width:84px}
.bt-hud.bt-compact .bt-aim{top:54px;left:60px;right:60px;width:auto;max-width:600px;margin:0 auto;padding:5px 6px 5px 12px;gap:8px}
.bt-hud.bt-compact .bt-aim-top{font-size:11px;letter-spacing:.1em}
.bt-hud.bt-compact .bt-aim-mid{font-size:14px}
.bt-hud.bt-compact .bt-aim-bot{font-size:12px;white-space:normal}
.bt-hud.bt-compact .bt-info{top:8px;left:250px;right:56px;width:auto;margin:0;padding:5px 10px 4px;font-size:13px;line-height:1.2;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
`;

function injectStyle(doc) {
  if (!doc) return;
  let el = doc.getElementById(STYLE_ID);
  if (!el) {
    el = doc.createElement('style');
    el.id = STYLE_ID;
    (doc.head ?? doc.documentElement).appendChild(el);
  }
  if (el.textContent !== CSS) el.textContent = CSS;
}

function h(tag, cls, text) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined && text !== null) el.textContent = text;
  return el;
}

function img(src, alt = '') {
  const el = document.createElement('img');
  if (src) el.src = src;
  el.alt = alt;
  el.draggable = false;
  return el;
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const perfNow = () => globalThis.performance?.now?.() ?? Date.now();

/** Replace [[action]] markers in a string with key caps (HTML-escaped). */
export function keyCaps(text, labelFor) {
  return esc(text).replace(/\[\[([a-z]+)\]\]/g, (_, a) => `<span class="bt-key">${esc(labelFor(a))}</span>`);
}

/**
 * Touch version of a " · "-separated instruction line: drops the segments that only explain keys
 * ("[[up]][[down]] choose"), keeps the rest. Returns '' when nothing is left.
 */
function stripKeySegments(text) {
  return String(text ?? '').split(' · ').filter((seg) => !/\[\[[a-z]+\]\]/.test(seg)).join(' · ').trim();
}

/**
 * Split a skill description into its rules and its flavour: the rules start at the first sentence that reads
 * like a cost line ("2 AP · …", "1 Prism charge · …"). Flavour-only or rules-only text comes back as rules.
 * @param {string} desc
 * @returns {{rules:string, flavour:string}}
 */
export function splitSkillDesc(desc) {
  const s = String(desc ?? '').trim();
  const m = /(^|[.!?…]["”’]?\s+)(\d+\s+(?:AP|[A-Za-z]+\s+charges?)\s+·)/.exec(s);
  if (!m || (m.index === 0 && !m[1])) return { rules: s, flavour: '' };
  const at = m.index + m[1].length;
  return { rules: s.slice(at).trim(), flavour: s.slice(0, at).trim() };
}

const STANCE_NAMES = { neutral: 'Neutral', assault: 'Assault', guard: 'Guard', virtuoso: 'Bravura' };
const STANCE_TIPS = {
  neutral: 'Neutral stance.',
  assault: 'Assault: dealt ×1.4, taken ×1.2. Assault again → Bravura.',
  guard: 'Guard: dealt ×0.85, taken ×0.65, +1 extra AP per parry.',
  virtuoso: 'Bravura: dealt ×2.0, taken ×1.25. Any hit you fail to avoid drops you back to Neutral.',
};
const GLYPH_NAMES = { fire: 'Fire', ice: 'Ice', storm: 'Storm', earth: 'Earth', light: 'Light' };

/** Defense touch buttons: [action, label, cue type shown as the icon, css class, cluster]. */
const DEFENSE_BUTTONS = [
  ['jump', 'Jump', 'jump', 'bt-jump', 'l'],
  ['dodge', 'Dodge', 'unparryable', 'bt-dodge', 'l'],
  ['gradient', 'Counter', 'gradient', 'bt-gradient', 'r'],
  ['parry', 'Parry', 'normal', 'bt-parry', 'r'],
];

/** Defense legend rows: [action, name, cue type, what it answers]. */
const LEGEND_ROWS = [
  ['parry', 'Parry', 'normal', 'white ring · +1 AP'],
  ['dodge', 'Dodge', 'unparryable', 'white · red · violet'],
  ['jump', 'Jump', 'jump', 'gold ring · wave'],
  ['gradient', 'Counter', 'gradient', 'violet · riposte'],
];

/**
 * The battle HUD. Build once per battle; call the sync* methods each frame (they diff before touching the
 * DOM) and the show/hide methods when the scene's state changes.
 */
export class BattleHud {
  /**
   * @param {object} game
   * @param {object} handlers {onMenuClick, onMenuHover, onListClick, onListHover, onHintClose, onPauseClick,
   *   onPauseHover, onResultsClose, onTouch(action, down, stamp), onPracticeCycle(dir)}
   */
  constructor(game, handlers = {}) {
    this.game = game;
    this.on = handlers;
    this.labelFor = (a) => game.input?.keyLabel?.(a) ?? a;
    injectStyle(document);
    const root = h('div', 'bt-hud');
    this.root = root;
    root.setAttribute('aria-label', 'Battle HUD');
    this._cache = new Map();
    this._timers = new Set();
    this._levelOverride = {};
    this._gaugeValue = 0;

    // Turn order.
    this.turns = h('div', 'bt-panel bt-turns');
    this.turns.append(h('div', 'bt-turns-label bt-cap', 'Turn'));
    this.turnList = h('div', 'bt-turnlist');
    this.turns.append(this.turnList);

    // Party.
    this.party = h('div', 'bt-party');
    this.cards = new Map();

    // Prism gauge.
    this.gauge = h('div', 'bt-panel bt-gauge');
    const gt = h('div', 'bt-gauge-top');
    gt.append(h('div', 'bt-gauge-label bt-cap', 'Prism'));
    this.gaugeCount = h('div', 'bt-gauge-count', '0%');
    gt.append(this.gaugeCount);
    this.gauge.append(gt);
    const segs = h('div', 'bt-segs');
    this.segs = [0, 1, 2].map(() => {
      const s = h('div', 'bt-seg');
      const fill = h('i');
      s.append(fill);
      segs.append(s);
      return { s, fill };
    });
    this.gauge.append(segs);
    this.gaugeHint = h('div', 'bt-gauge-hint', '');
    this.gaugeCall = h('div', 'bt-gcall', 'Prism ready');
    this.gauge.append(this.gaugeHint, this.gaugeCall);
    this.gauge.title = 'Team Prism gauge: parries, jumps, dodges and perfect timed hits fill it. Each full charge fires a Prism skill for 0 AP.';

    // Command menu.
    this.menu = h('div', 'bt-panel bt-menu bt-fade');
    this.menuHead = h('div', 'bt-mhead');
    this.menuTitle = h('div', 'bt-mtitle bt-cap');
    this.menuSub = h('div', 'bt-msub');
    this.menuHead.append(this.menuTitle, this.menuSub);
    this.menuItems = h('div', 'bt-mitems');
    this.menuReason = h('div', 'bt-mreason');
    this.menu.append(this.menuHead, this.menuItems, this.menuReason);

    // List + details pane.
    this.list = h('div', 'bt-panel bt-list bt-fade');
    this.listHead = h('div', 'bt-mhead');
    this.listTitle = h('div', 'bt-mtitle bt-cap');
    this.listSub = h('div', 'bt-msub');
    this.listBack = this._button('bt-back', 'cancel');
    this.listHead.append(this.listTitle, this.listSub, this.listBack);
    this.listBody = h('div', 'bt-lbody');
    this.listRows = h('div', 'bt-rows');
    this.listDesc = h('div', 'bt-desc');
    this.listBody.append(this.listRows, this.listDesc);
    this.list.append(this.listHead, this.listBody);

    // Target.
    this.target = h('div', 'bt-panel bt-target bt-fade');

    // Legend.
    this.legend = h('div', 'bt-panel bt-legend bt-fade');

    // Touch buttons (two thumb clusters) + whiff lockout caption.
    this.touch = h('div', 'bt-touch');
    this.touch.style.display = 'none';

    // Free aim / info bars.
    this.aim = h('div', 'bt-panel bt-aim bt-fade');
    this.aimMain = h('div', 'bt-aim-main');
    this.aimDone = this._button('bt-done', 'cancel');
    this.aim.append(this.aimMain, this.aimDone);
    this.info = h('div', 'bt-panel bt-info bt-fade');

    // Practice.
    this.practice = h('div', 'bt-panel bt-practice bt-fade');

    // Toast.
    this.toastBox = h('div', 'bt-toast');
    this.toastSpan = h('span');
    this.toastBox.append(this.toastSpan);

    // Pause (tappable; shown with the command menu, where the menu action opens the battle pause).
    this.nav = this._button('bt-nav bt-fade', 'menu');
    this.nav.title = 'Pause';
    this.nav.setAttribute('aria-label', 'Pause');
    this.nav.innerHTML = '<i></i><span>Pause</span>';

    // Modal layers.
    this.dim = h('div', 'bt-dim bt-fade');
    this.hint = h('div', 'bt-panel bt-hintp bt-fade');
    this.pause = h('div', 'bt-panel bt-pause bt-fade');
    this.results = h('div', 'bt-panel bt-results bt-fade');

    // The practice panel sits under the menus: on a small screen the command list must win where they meet.
    root.append(this.turns, this.party, this.gauge, this.practice, this.menu, this.list, this.target, this.legend, this.touch, this.aim,
      this.info, this.toastBox, this.nav, this.dim, this.hint, this.pause, this.results);

    this.hint.addEventListener('pointerdown', () => this.on.onHintClose?.());
    this.results.addEventListener('pointerdown', () => this.on.onResultsClose?.());
    // Tap anywhere to dismiss a hint (or finish the results); the pause panel needs an explicit choice.
    this.dim.addEventListener('pointerdown', () => {
      if (this.hint.classList.contains('bt-on')) this.on.onHintClose?.();
      else if (this._resultsOn) this.on.onResultsClose?.();
    });

    this._offDevice = game.input?.events?.on?.('device', () => this.refreshLabels()) ?? null;
    this._offResize = game.events?.on?.('resize', () => this._applyLayout()) ?? null;
    this._legendLocked = false;
    this._toastTimer = null;
    this._applyLayout();
    this._applyDevice();
    this._renderButtons();
  }

  /**
   * Hover that only reacts to real pointer movement. Browsers send synthetic moves when layout shifts under a
   * resting cursor; acting on those can feed back (hover → content change → reflow → hover …).
   */
  _hover(el, fn) {
    el.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch') return;
      const last = this._hoverXY;
      if (last && Math.abs(last.x - e.clientX) < 1 && Math.abs(last.y - e.clientY) < 1) return;
      this._hoverXY = { x: e.clientX, y: e.clientY };
      fn();
    });
  }

  /** Mount into the scene's UI root (removed automatically on scene exit). */
  mount(scene) {
    scene.mountUI(this.root);
  }

  destroy() {
    try { this._offDevice?.(); } catch { /* ignore */ }
    try { this._offResize?.(); } catch { /* ignore */ }
    clearTimeout(this._toastTimer);
    clearTimeout(this._lockTimer);
    for (const t of this._timers) clearTimeout(t);
    this._timers.clear();
  }

  _later(fn, ms) {
    const t = setTimeout(() => {
      this._timers.delete(t);
      fn();
    }, Math.max(0, ms));
    this._timers.add(t);
    return t;
  }

  _changed(key, value) {
    if (this._cache.get(key) === value) return false;
    this._cache.set(key, value);
    return true;
  }

  _show(el, on) {
    el.classList.toggle('bt-on', !!on);
  }

  // ---------------------------------------------------------------- layout / device

  /** Compact layout when the stage is scaled small: the root is sized in real CSS px and counter-scaled. */
  _applyLayout() {
    const s = Number(this.game.scale) || 1;
    const compact = s < COMPACT_SCALE;
    this.compact = compact;
    this.root.classList.toggle('bt-compact', compact);
    const st = this.root.style;
    if (compact) {
      st.width = `${(1280 * s).toFixed(2)}px`;
      st.height = `${(720 * s).toFixed(2)}px`;
      st.transform = `scale(${1 / s})`;
    } else {
      st.width = '';
      st.height = '';
      st.transform = '';
    }
  }

  /** True when the player is (or is most likely) using touch. */
  isTouch() {
    const input = this.game.input;
    if (input?.lastDevice === 'touch') return true;
    if (input?.lastDevice === 'gamepad') return false;
    try {
      return !!globalThis.matchMedia?.('(pointer: coarse)')?.matches && !globalThis.matchMedia?.('(pointer: fine)')?.matches;
    } catch {
      return false;
    }
  }

  _applyDevice() {
    this.touchUi = this.isTouch();
    this.root.classList.toggle('bt-touchdev', this.touchUi);
  }

  /** A tappable control that presses an input action (tap = press + release). */
  _button(cls, action) {
    const b = h('div', `bt-btn ${cls}`);
    b.setAttribute('role', 'button');
    b.dataset.action = action;
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this._virtualTap(action, e);
    });
    return b;
  }

  /** Press + release an input action for an on-screen control, stamped with the pointer event's time. */
  _virtualTap(action, e) {
    const input = this.game.input;
    if (!input?.virtualPress) return;
    const touch = e?.pointerType === 'touch' || e?.pointerType === 'pen';
    const now = perfNow();
    const ts = e?.timeStamp;
    const stamp = Number.isFinite(ts) && ts > 0 && ts <= now && now - ts < 1000 ? ts : undefined;
    input.virtualPress(action, touch ? 'touch' : 'virtual', stamp);
    input.virtualRelease?.(action);
  }

  /** Labels of the Back / Done / Pause controls for the current device. */
  _renderButtons() {
    const L = this.labelFor;
    const keyed = (word) => (this.touchUi ? `<span class="bt-chev">‹</span>${word}` : `<span class="bt-key">${esc(L('cancel'))}</span>${word}`);
    this.listBack.innerHTML = keyed('Back');
    this.aimDone.innerHTML = this.touchUi ? 'Done' : `<span class="bt-key">${esc(L('cancel'))}</span>Done`;
    this.nav.title = this.touchUi ? 'Pause' : `Pause (${L('menu')})`;
  }

  // ---------------------------------------------------------------- persistent widgets

  /**
   * Turn-order timeline.
   * @param {string[]} ids current actor first
   * @param {object} model
   */
  syncTurnOrder(ids, model) {
    const key = ids.map((id) => {
      const c = model.get(id);
      return `${id}:${c?.alive ? 1 : 0}:${c?.broken || c?.statuses?.some((s) => s.id === 'stun') ? 1 : 0}`;
    }).join('|');
    if (!this._changed('turns', key)) return;
    this.turnList.textContent = '';
    ids.forEach((id, i) => {
      const c = model.get(id);
      if (!c) return;
      if (i === 1) this.turnList.append(h('div', 'bt-sep'));
      const chip = h('div', `bt-chip ${c.side === 'enemy' ? 'bt-side-e' : 'bt-side-p'}${i === 0 ? ' bt-now' : ''}${i >= 6 ? ' bt-far' : ''}`);
      if (c.side === 'party') chip.style.setProperty('--c', c.color || '#e0b458');
      if (c.broken || c.statuses?.some((s) => s.id === 'stun')) chip.classList.add('bt-stun');
      chip.title = `${c.name}${i === 0 ? ' — acting now' : ''}`;
      chip.append(img(portraitDataURL(c.look, 112), c.name));
      this.turnList.append(chip);
    });
  }

  /**
   * Party cards.
   * @param {object} model
   * @param {{activeId?:string|null, aimedIds?:string[], costAp?:number, levels?:Record<string,number>}} [o]
   */
  syncParty(model, { activeId = null, aimedIds = [], costAp = 0, levels = {} } = {}) {
    for (const c of model.party) {
      let card = this.cards.get(c.id);
      if (!card) {
        card = this._buildCard(c);
        this.cards.set(c.id, card);
        this.party.append(card.el);
      }
      const active = c.id === activeId;
      const level = levels[c.key] ?? this._levelOverride[c.key] ?? c.level;
      const st = (c.statuses ?? []).map((s) => `${s.id}${s.turns}`).join(',');
      const mech = c.mechanic ? JSON.stringify(c.mechanic) : '';
      const key = `${c.hp}/${c.stats.maxHp}|${c.ap}|${c.alive}|${active}|${aimedIds.includes(c.id)}|${st}|${mech}|${active ? costAp : 0}|${level}`;
      if (!this._changed(`card:${c.id}`, key)) continue;
      const pct = Math.max(0, Math.min(1, c.hp / Math.max(1, c.stats.maxHp)));
      card.el.classList.toggle('bt-active', active);
      card.el.classList.toggle('bt-ko', !c.alive);
      card.el.classList.toggle('bt-aimed', aimedIds.includes(c.id));
      card.fill.style.width = `${(pct * 100).toFixed(1)}%`;
      card.fill.classList.toggle('bt-mid', pct <= 0.5 && pct > 0.25);
      card.fill.classList.toggle('bt-low', pct <= 0.25);
      if (pct < card.lastPct) card.ghost.style.width = `${(pct * 100).toFixed(1)}%`;
      else {
        card.ghost.style.transition = 'none';
        card.ghost.style.width = `${(pct * 100).toFixed(1)}%`;
        void card.ghost.offsetWidth;
        card.ghost.style.transition = '';
      }
      card.lastPct = pct;
      card.hpnum.innerHTML = `${Math.round(c.hp)}<small> / ${c.stats.maxHp}</small>`;
      card.lv.textContent = `Lv ${level}`;
      card.lv.classList.toggle('bt-up', level > c.level);
      const cost = active ? Math.max(0, Math.min(c.ap, costAp)) : 0;
      card.pips.forEach((p, i) => {
        p.classList.toggle('bt-full', i < c.ap - cost);
        p.classList.toggle('bt-cost', i >= c.ap - cost && i < c.ap);
      });
      card.apnum.innerHTML = cost > 0 ? `${c.ap} AP<b>−${cost}</b>` : `${c.ap} AP`;
      this._renderMechanic(card.mech, c.mechanic);
      this._renderStatuses(card.sts, c.statuses ?? []);
      card.el.style.setProperty('--sts-w', `${Math.min(3, (c.statuses ?? []).length) * 21}px`);
    }
  }

  _buildCard(c) {
    const el = h('div', 'bt-panel bt-card');
    el.style.setProperty('--c', c.color || '#e0b458');
    const pt = h('div', 'bt-pt');
    pt.append(img(portraitDataURL(c.look, 116), c.name));
    const kotag = h('div', 'bt-kotag', 'KO');
    const lv = h('div', 'bt-lv', `Lv ${c.level}`);
    const name = h('div', 'bt-name', c.name.split(' ')[0]);
    name.title = c.name;
    const hprow = h('div', 'bt-hprow');
    const bar = h('div', 'bt-hpbar');
    const ghost = h('i', 'bt-hpghost');
    const fill = h('i', 'bt-hpfill');
    bar.append(ghost, fill);
    const hpnum = h('div', 'bt-hpnum');
    hprow.append(bar, hpnum);
    const aprow = h('div', 'bt-aprow');
    aprow.title = 'Action Points (max 9): +1 each turn, +1 per Attack, +1 per parry.';
    const pips = [];
    for (let i = 0; i < 9; i++) {
      const p = h('i', 'bt-pip');
      pips.push(p);
      aprow.append(p);
    }
    const apnum = h('div', 'bt-apnum', '0 AP');
    aprow.append(apnum);
    const mechrow = h('div', 'bt-mechrow');
    const mech = h('div', 'bt-mech');
    const sts = h('div', 'bt-sts');
    mechrow.append(mech);
    el.append(pt, kotag, lv, name, hprow, aprow, mechrow, sts);
    return { el, key: c.key, fill, ghost, hpnum, pips, apnum, mech, sts, lv, lastPct: 1 };
  }

  _renderMechanic(el, m) {
    el.textContent = '';
    el.removeAttribute('title');
    if (!m) return;
    if (m.type === 'surge') {
      const v = Math.max(0, Math.min(10, Math.round(m.value ?? 0)));
      el.title = `Surge ${v}/10 — builds when Gideon lands hits, takes hits or parries. Finishers consume it for ×(1 + 0.2 × Surge).`;
      const bar = h('div', `bt-surge${v >= 10 ? ' bt-max' : ''}`);
      for (let i = 0; i < 10; i++) bar.append(h('i', i < v ? 'bt-full' : ''));
      const num = h('span', 'bt-surgenum');
      num.innerHTML = `${v}<small>/10</small>`;
      el.append(img(mechanicIcon('surge', 18), 'Surge'), bar, num);
    } else if (m.type === 'glyphs') {
      const list = m.list ?? [];
      el.title = `Glyphs ${list.length}/4: ${list.length ? list.map((g) => GLYPH_NAMES[g] ?? g).join(', ') : 'none yet'} — Nyra's scripts inscribe them; sigils consume them.`;
      const box = h('div', 'bt-glyphs');
      for (let i = 0; i < 4; i++) {
        const g = list[i];
        const slot = h('div', `bt-glyph${g ? ' bt-full' : ''}`);
        if (g) slot.append(img(mechanicIcon(`glyph_${g}`, 18), GLYPH_NAMES[g] ?? g));
        box.append(slot);
      }
      el.append(box);
    } else if (m.type === 'stance') {
      const v = STANCE_NAMES[m.value] ? m.value : 'neutral';
      const badge = h('div', `bt-stance bt-${v}`);
      badge.title = STANCE_TIPS[v];
      badge.append(img(mechanicIcon(`stance_${v}`, 18), ''), h('span', 'bt-mechtxt', STANCE_NAMES[v]));
      el.append(badge);
    }
  }

  _renderStatuses(el, statuses) {
    el.textContent = '';
    for (const s of statuses.slice(0, 6)) {
      const d = STATUS_DEFS[s.id];
      const box = h('div', 'bt-st');
      box.title = `${d?.name ?? s.id} (${s.turns} turn${s.turns === 1 ? '' : 's'}) — ${d?.desc ?? ''}`;
      box.append(img(statusIcon(s.id, 18), d?.name ?? s.id));
      box.append(h('b', null, String(s.turns)));
      el.append(box);
    }
  }

  /** Prism gauge (value 0..300). A newly filled charge gets a callout and a glow. */
  syncGradient(value, { flash = false } = {}) {
    const v = Math.max(0, Math.min(300, Math.round(Number(value) || 0)));
    const prev = this._gaugeValue;
    this._gaugeValue = v;
    if (!this._changed('gauge', `${v}|${flash}`)) return;
    const charges = Math.floor(v / 100);
    this.segs.forEach(({ s, fill }, i) => {
      const f = Math.max(0, Math.min(1, (v - i * 100) / 100));
      fill.style.width = `${(f * 100).toFixed(1)}%`;
      s.classList.toggle('bt-full', f >= 1);
    });
    this.gaugeCount.textContent = charges > 0 ? `×${charges}` : `${v % 100}%`;
    this.gaugeHint.textContent = charges > 0 ? `${charges} charge${charges > 1 ? 's' : ''} ready` : 'Defend well to charge';
    this.gauge.classList.toggle('bt-ready', charges > 0);
    if (charges > Math.floor(prev / 100) && this._gaugeSynced) this._prismReady(charges);
    this._gaugeSynced = true;
  }

  /** "Prism ready" callout: a ribbon over the gauge and a burst of glow (the scene plays gradient_ready). */
  _prismReady(charges) {
    this.gaugeCall.textContent = charges > 1 ? `Prism ×${charges} ready` : 'Prism ready';
    for (const el of [this.gauge, this.gaugeCall]) {
      el.classList.remove(el === this.gauge ? 'bt-burst' : 'bt-on');
      void el.offsetWidth;
      el.classList.add(el === this.gauge ? 'bt-burst' : 'bt-on');
    }
  }

  /** Show / hide the persistent widgets (turn order, cards, gauge). */
  showFrame(on) {
    const d = on ? '' : 'none';
    this.turns.style.display = d;
    this.party.style.display = d;
    this.gauge.style.display = d;
  }

  // ---------------------------------------------------------------- command menu

  /** Counter text of a root command, reworded so it says what it counts. */
  _menuHint(it) {
    const hint = it.hint == null ? '' : String(it.hint);
    if (it.id === 'skills') {
      const m = /^(\d+)\s*\/\s*(\d+)$/.exec(hint);
      if (m) return Number(m[1]) > 0 ? `${m[1]} usable` : 'none usable';
    } else if (it.id === 'items') {
      if (/^\d+$/.test(hint)) return `${hint} left`;
    } else if (it.id === 'gradient') {
      const c = Math.floor(this._gaugeValue / 100);
      return c > 0 ? `${c} ready` : `${this._gaugeValue % 100}%`;
    }
    return hint;
  }

  /**
   * @param {{title:string, sub?:string, items:Array<{id,label,icon?,iconSrc?,hint?,disabled?,reason?,note?}>, index:number}} o
   */
  showMenu({ title, sub = '', items, index }) {
    this.menuTitle.textContent = title;
    this.menuSub.textContent = sub;
    this.menuItems.textContent = '';
    this.menuItems.style.setProperty('--rows', String(Math.max(1, Math.ceil(items.length / 2))));
    this._menuItems = items;
    items.forEach((it, i) => {
      const prism = it.id === 'gradient' && !it.disabled;
      const row = h('div', `bt-mi${it.disabled ? ' bt-dis' : ''}${prism ? ' bt-prism' : ''}`);
      const ic = h('div', 'bt-ic');
      if (it.iconSrc) ic.append(img(it.iconSrc));
      else ic.textContent = it.icon ?? '◆';
      row.append(ic, h('div', 'bt-lbl', it.label));
      const hint = this._menuHint(it);
      if (hint) row.append(h('div', `bt-hint${prism ? ' bt-hot' : ''}`, hint));
      if (it.reason && it.disabled) row.title = it.reason;
      this._hover(row, () => this.on.onMenuHover?.(i));
      row.addEventListener('pointerdown', () => this.on.onMenuClick?.(i));
      this.menuItems.append(row);
    });
    this.setMenuIndex(index);
    this._show(this.menu, true);
    this._show(this.nav, true);
    // A command menu is a calm moment: let background layers left at an old scale by a resize repaint now.
    clearTimeout(this._bgFlush);
    this._bgFlush = this._later(() => flushBackgroundRebuilds(), 240);
  }

  setMenuIndex(index) {
    const rows = [...this.menuItems.children];
    rows.forEach((r, i) => r.classList.toggle('bt-sel', i === index));
    const it = this._menuItems?.[index];
    const why = it?.disabled && it.reason;
    this.menuReason.textContent = why ? it.reason : it?.note ?? '';
    this.menuReason.classList.toggle('bt-note', !why);
  }

  hideMenu() {
    this._show(this.menu, false);
    this._show(this.nav, false);
  }

  // ---------------------------------------------------------------- lists

  /**
   * @param {{title:string, sub?:string, rows:Array<{id,name,iconSrc?,cost?,costKind?,tag?,short?,desc?,disabled?,reason?}>, index:number}} o
   */
  showList({ title, sub = '', rows, index }) {
    this.listTitle.textContent = title;
    this.listSub.textContent = sub;
    this.listRows.textContent = '';
    this.listRows.style.setProperty('--rows', String(Math.max(1, Math.ceil(rows.length / 2))));
    this._listRows = rows;
    rows.forEach((r, i) => {
      const row = h('div', `bt-row${r.disabled ? ' bt-dis' : ''}`);
      if (r.iconSrc) row.append(img(r.iconSrc));
      row.append(h('div', 'bt-rn', r.name));
      if (r.tag) row.append(h('div', 'bt-rtag', r.tag));
      if (r.cost !== undefined && r.cost !== null) {
        const c = h('div', `bt-cost${r.costKind === 'charge' ? ' bt-grad' : r.costKind === 'count' ? ' bt-count' : ''}`);
        c.innerHTML = r.costKind === 'count' ? `×${esc(r.cost)}` : `${esc(r.cost)}<small>${r.costKind === 'charge' ? '◆' : 'AP'}</small>`;
        if (r.costKind === 'charge') c.title = `${r.cost} Prism charge${Number(r.cost) === 1 ? '' : 's'}`;
        row.append(c);
      }
      this._hover(row, () => this.on.onListHover?.(i));
      row.addEventListener('pointerdown', () => this.on.onListClick?.(i));
      this.listRows.append(row);
    });
    this.setListIndex(index);
    this._show(this.list, true);
  }

  setListIndex(index) {
    const rows = [...this.listRows.children];
    rows.forEach((r, i) => r.classList.toggle('bt-sel', i === index));
    // Keep the selection visible when the list is long.
    const sel = rows[index];
    if (sel && !this.compact) {
      const top = sel.offsetTop - this.listRows.offsetTop;
      const box = this.listRows;
      if (top < box.scrollTop) box.scrollTop = top;
      else if (top + sel.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTop = top + sel.offsetHeight - box.clientHeight;
    }
    const r = this._listRows?.[index];
    const d = this.listDesc;
    d.textContent = '';
    d.scrollTop = 0;
    if (!r) return;
    // Details pane: cost line, why it is unavailable (never clipped: it comes first), the rules, then flavour.
    if (r.short || r.tag) {
      const short = h('div', 'bt-desc-short', r.short || '');
      if (r.tag) short.append(h('span', 'bt-rtag', r.tag));
      d.append(short);
    }
    if (r.disabled && r.reason) d.append(h('div', 'bt-desc-why', r.reason));
    const { rules, flavour } = splitSkillDesc(r.desc ?? '');
    d.append(h('div', 'bt-desc-txt', rules));
    if (flavour) d.append(h('div', 'bt-desc-fl', flavour));
  }

  hideList() {
    this._show(this.list, false);
  }

  // ---------------------------------------------------------------- target

  /**
   * @param {{name, sub?, hp, maxHp, shields?, breakValue?, breakMax?, broken?, statuses?, affinities?:{weak:string[],resist:string[],immune:string[]}|null,
   *   known?:boolean, side:'enemy'|'party', help?:string, multi?:string}} t
   */
  showTarget(t) {
    this._lastTarget = t;
    const el = this.target;
    el.textContent = '';
    const head = h('div', 'bt-thead');
    const titles = h('div');
    titles.append(h('div', 'bt-tname', t.multi ?? t.name));
    if (t.sub) titles.append(h('div', 'bt-tsub', t.sub));
    head.append(titles);
    el.append(head);
    if (!t.multi) {
      const row = h('div', 'bt-trow');
      row.append(h('div', 'bt-tk bt-cap', 'HP'));
      const bar = h('div', 'bt-hpbar');
      const fill = h('i', 'bt-hpfill');
      const pct = Math.max(0, Math.min(1, t.hp / Math.max(1, t.maxHp)));
      fill.style.width = `${pct * 100}%`;
      if (pct <= 0.25) fill.classList.add('bt-low');
      else if (pct <= 0.5) fill.classList.add('bt-mid');
      bar.append(fill);
      bar.style.flex = '1';
      const num = h('div', 'bt-hpnum');
      num.innerHTML = `${Math.round(t.hp)}<small> / ${t.maxHp}</small>`;
      row.append(bar, num);
      el.append(row);
      if (t.side === 'enemy') {
        const extra = [];
        if (t.shields) extra.push(`${t.shields} shield${t.shields > 1 ? 's' : ''}`);
        if (t.breakMax) extra.push(t.broken ? 'BROKEN' : `Break ${Math.round(t.breakValue)}/${t.breakMax}`);
        if (extra.length) {
          const r2 = h('div', 'bt-trow');
          r2.append(h('div', 'bt-tk bt-cap', 'Guard'), h('div', null, extra.join(' · ')));
          el.append(r2);
        }
        if (t.affinities) {
          const a = t.affinities;
          const addRow = (label, cls, list) => {
            if (!list.length) return;
            const r = h('div', `bt-trow ${cls}`);
            r.append(h('div', 'bt-tk bt-cap', label));
            for (const e of list) {
              const im = img(elementIcon(e, 18), e);
              im.title = e;
              r.append(im);
            }
            r.append(h('span', null, list.map((e) => e[0].toUpperCase() + e.slice(1)).join(', ')));
            el.append(r);
          };
          addRow('Weak', 'bt-weak', a.weak);
          addRow('Resist', 'bt-res', a.resist);
          addRow('Immune', 'bt-imm', a.immune);
          if (!a.weak.length && !a.resist.length && !a.immune.length && t.known) el.append(h('div', 'bt-tnote', 'No elemental weaknesses.'));
        }
        if (!t.known) el.append(h('div', 'bt-tnote', 'Affinities unknown — fight one to learn them.'));
      }
      if (t.statuses?.length) {
        const r3 = h('div', 'bt-trow');
        r3.append(h('div', 'bt-tk bt-cap', 'Status'));
        for (const s of t.statuses) {
          const d = STATUS_DEFS[s.id];
          const im = img(statusIcon(s.id, 18), d?.name ?? s.id);
          im.title = `${d?.name ?? s.id} (${s.turns}) — ${d?.desc ?? ''}`;
          r3.append(im);
        }
        el.append(r3);
      }
    }
    // The Back control carries the cancel key, so the help line drops its own "[[cancel]] back" segment.
    const help = this.touchUi
      ? (t.multi ? 'Tap Confirm, or any highlighted target.' : 'Tap a target to use it on them.')
      : String(t.help ?? '').split(' · ').filter((seg) => !/\[\[cancel\]\]/.test(seg)).join(' · ');
    const foot = h('div', 'bt-tfoot');
    if (help) {
      const hp = h('div', 'bt-thelp');
      hp.innerHTML = keyCaps(help, this.labelFor);
      foot.append(hp);
    }
    const back = this._button('bt-back', 'cancel');
    back.innerHTML = this.touchUi ? '<span class="bt-chev">‹</span>Back' : `<span class="bt-key">${esc(this.labelFor('cancel'))}</span>Back`;
    foot.append(back);
    if (this.touchUi) {
      const ok = this._button('bt-go', 'confirm');
      ok.textContent = 'Confirm';
      foot.append(ok);
    }
    el.append(foot);
    el.classList.toggle('bt-allies', t.side === 'party');
    this._show(el, true);
  }

  hideTarget() {
    this._lastTarget = null;
    this._show(this.target, false);
  }

  // ---------------------------------------------------------------- enemy turn

  /** Defense legend on/off (rebuilt with current key labels). */
  showLegend(on) {
    if (on && !this._legendBuilt) this._buildLegend();
    this._show(this.legend, on);
  }

  _buildLegend() {
    const L = this.labelFor;
    const rows = LEGEND_ROWS.map(([action, name, cue, what]) => `<div class="bt-lg" data-action="${action}"><span class="bt-key">${esc(L(action))}</span>`
      + `<img src="${cueIcon(cue, 20)}" alt="">${name}<em>${what}</em></div>`).join('');
    this.legend.innerHTML = `<div class="bt-lgt bt-cap"><span>Defend</span><b>Locked — wait</b></div>${rows}`;
    this.legend.title = 'Each cue shape has one answer: clean white ring → Parry (or Dodge) · spiked red ring → Dodge only · gold ring and ground wave → Jump · violet prism → Prism Counter (or Dodge).';
    this._legendBuilt = true;
  }

  setLegendLocked(on) {
    if (this._legendLocked === on) return;
    this._legendLocked = on;
    this.legend.classList.toggle('bt-locked', on);
  }

  /**
   * Grey out the defense buttons during a whiff lockout: a press that claims no hit blocks defense input for a
   * moment (the scene marks the cue ring itself).
   * @param {number} untilMs performance.now() time the lockout ends
   * @param {string} [action] the defense action that whiffed (its button gets a red ✕)
   */
  setDefenseLockout(untilMs, action) {
    const ms = Number(untilMs) - perfNow();
    if (!(ms > 0)) return;
    clearTimeout(this._lockTimer);
    const t = this.touch;
    // The scene re-sends the deadline when hit-stop stretches a lockout: only a new lockout restarts the flash.
    const fresh = !t.classList.contains('bt-lockout') || this._lockAction !== action;
    this._lockAction = action;
    if (fresh) {
      t.style.setProperty('--lock-ms', `${Math.round(ms)}ms`);
      t.classList.remove('bt-lockout');
      for (const b of t.querySelectorAll('.bt-tb')) b.classList.toggle('bt-whiff', b.dataset.action === action);
      void t.offsetWidth;
      t.classList.add('bt-lockout');
    }
    this._lockTimer = setTimeout(() => this._clearLockout(), ms);
  }

  _clearLockout() {
    clearTimeout(this._lockTimer);
    this._lockTimer = null;
    this._lockAction = null;
    this.touch.classList.remove('bt-lockout');
    for (const b of this.touch.querySelectorAll('.bt-whiff')) b.classList.remove('bt-whiff');
  }

  /**
   * Touch buttons: null | 'defense' | 'qte'.
   * @param {string|null} kind
   */
  showTouch(kind) {
    if (this._touchKind === kind) return;
    this._touchKind = kind;
    this._clearLockout();
    this.touch.textContent = '';
    if (!kind) {
      this.touch.style.display = 'none';
      this.legend.style.display = '';
      return;
    }
    this.touch.style.display = '';
    // Touch players get the big buttons instead of the key legend.
    this.legend.style.display = 'none';
    const left = h('div', 'bt-tcl bt-l');
    const right = h('div', 'bt-tcl bt-r');
    const defs = kind === 'qte' ? [['qte', 'Strike', null, 'bt-strike', 'r']] : DEFENSE_BUTTONS;
    for (const [action, label, cue, cls, side] of defs) {
      const b = h('div', `bt-tb ${cls}`);
      b.dataset.action = action;
      b.setAttribute('role', 'button');
      b.setAttribute('aria-label', label);
      if (cue) b.append(img(cueIcon(cue, 36), ''));
      else b.append(h('span', null, '✦'));
      b.append(document.createTextNode(label));
      const down = (e) => { e.preventDefault(); b.classList.add('bt-press'); this.on.onTouch?.(action, true, e.timeStamp); };
      const up = (e) => { e.preventDefault(); if (!b.classList.contains('bt-press')) return; b.classList.remove('bt-press'); this.on.onTouch?.(action, false); };
      b.addEventListener('pointerdown', down);
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
      b.addEventListener('pointerleave', up);
      (side === 'l' ? left : right).append(b);
    }
    const lock = h('div', 'bt-tlock', 'Locked — wait');
    this.touch.append(left, right, lock);
  }

  // ---------------------------------------------------------------- info bars

  /** Free aim status bar (null hides). */
  setFreeAim(s) {
    if (!s) {
      this._show(this.aim, false);
      this._cache.delete('aim');
      return;
    }
    const key = `${s.name}|${s.ap}|${s.aimText}|${s.onWeak}|${this.touchUi}`;
    if (this._changed('aim', key)) {
      const L = this.labelFor;
      const how = this.touchUi
        ? 'Tap an enemy or weak point to fire (1 AP) — shots don\'t end your turn'
        : `Aim · <span class="bt-key">${esc(L('confirm'))}</span> or click to fire (1 AP) — shots don't end your turn`;
      this.aimMain.innerHTML = `<div class="bt-aim-top bt-cap">Free Aim · ${esc(s.name)} · <b>${s.ap}</b> AP</div>
        <div class="bt-aim-mid${s.onWeak ? ' bt-weakon' : ''}">${esc(s.aimText)}</div>
        <div class="bt-aim-bot">${how}</div>`;
    }
    this._show(this.aim, true);
  }

  /** One-line instruction bar under the turn order (null hides). On touch, key-only segments are dropped. */
  setInfo(text) {
    this._lastInfo = text || null;
    const shown = text && this.touchUi ? stripKeySegments(text) : text;
    if (!shown) {
      this._show(this.info, false);
      return;
    }
    if (this._changed('info', shown)) this.info.innerHTML = keyCaps(shown, this.labelFor);
    this._show(this.info, true);
  }

  /** Short-lived notice. */
  toast(text, ms = 1300) {
    this.toastSpan.textContent = text;
    this.toastSpan.classList.add('bt-on');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => this.toastSpan.classList.remove('bt-on'), ms);
  }

  // ---------------------------------------------------------------- practice

  /**
   * Practice overlay (null hides).
   * @param {{attackName:string, attackDesc?:string, log:Array<{label:string, outcome:string, ok:boolean, timing:string}>, canCycle:boolean}|null} p
   */
  setPractice(p) {
    if (!p) {
      this._show(this.practice, false);
      return;
    }
    const key = JSON.stringify(p);
    if (this._changed('practice', key)) {
      const L = this.labelFor;
      const touch = this.touchUi;
      const log = p.log.length
        ? p.log.map((r) => `<div><span class="bt-o ${r.ok ? 'bt-ok' : 'bt-bad'}">${esc(r.outcome)}</span><span class="bt-pl">${esc(r.label)}</span><em>${esc(r.timing)}</em></div>`).join('')
        : '<div style="opacity:.6;font-style:italic">Your timing on the last attack appears here.</div>';
      const leave = touch ? 'Tap <b>Leave</b> in the menu to end' : `<span class="bt-key">${esc(L('cancel'))}</span> to leave`;
      const cycle = touch ? "Mannequin's next attack · tap ◀ ▶" : `Mannequin's next attack · <span class="bt-key">${esc(L('left'))}</span><span class="bt-key">${esc(L('right'))}</span>`;
      this.practice.innerHTML = `<div class="bt-prtop"><span class="bt-prtag bt-cap">Practice</span><span class="bt-prleave">${leave}</span></div>
        <div class="bt-prnext"><span class="bt-arrow" data-d="-1">◀</span><span class="bt-pn">${esc(p.attackName)}</span><span class="bt-arrow" data-d="1">▶</span></div>
        <div class="bt-prdesc">${p.canCycle ? cycle : ''}</div>
        ${p.attackDesc ? `<div class="bt-prdesc">${esc(p.attackDesc)}</div>` : ''}
        <div class="bt-prlog">${log}</div>`;
      for (const a of this.practice.querySelectorAll('.bt-arrow')) {
        a.addEventListener('pointerdown', () => this.on.onPracticeCycle?.(Number(a.dataset.d)));
      }
    }
    this._show(this.practice, true);
  }

  // ---------------------------------------------------------------- modals

  /** @param {{tag?:string, title:string, html:string, foot?:string}} o */
  showHint({ tag = 'Field Notes', title, html, foot }) {
    const L = this.labelFor;
    const dflt = this.touchUi ? 'Tap anywhere to continue' : `<span class="bt-key">${esc(L('confirm'))}</span> Got it`;
    this.hint.innerHTML = `<div class="bt-htag bt-cap">${esc(tag)}</div><div class="bt-htitle">${esc(title)}</div>
      <div class="bt-htext">${html}</div><div class="bt-hfoot">${foot ?? dflt}</div>`;
    this._show(this.dim, true);
    this._show(this.hint, true);
  }

  hideHint() {
    this._show(this.hint, false);
    if (!this._pauseOn && !this._resultsOn) this._show(this.dim, false);
  }

  /** @param {{title:string, sub?:string, items:Array<{label:string, disabled?:boolean}>, index:number}} o */
  showPause({ title = 'Paused', sub = '', items, index }) {
    this._pauseOn = true;
    this.pause.innerHTML = '';
    this.pause.append(h('div', 'bt-ptitle', title));
    if (sub) this.pause.append(h('div', 'bt-psub', sub));
    const box = h('div');
    items.forEach((it, i) => {
      const row = h('div', `bt-mi${it.disabled ? ' bt-dis' : ''}`);
      row.append(h('div', 'bt-lbl', it.label));
      this._hover(row, () => this.on.onPauseHover?.(i));
      row.addEventListener('pointerdown', () => this.on.onPauseClick?.(i));
      box.append(row);
    });
    this.pause.append(box);
    this._pauseRows = [...box.children];
    this.setPauseIndex(index);
    this._show(this.dim, true);
    this._show(this.pause, true);
    this._later(() => flushBackgroundRebuilds({ max: 2 }), 200);
  }

  setPauseIndex(index) {
    (this._pauseRows ?? []).forEach((r, i) => r.classList.toggle('bt-sel', i === index));
  }

  hidePause() {
    this._pauseOn = false;
    this._show(this.pause, false);
    this._show(this.dim, false);
  }

  /**
   * Victory results.
   * @param {{title:string, sub:string, members:Array<{id, name, look, color, level0, xp0, gained, gains:string,
   *   needFor:(level:number)=>number, maxLevel:number}>, loot:Array<{iconSrc?:string, html:string}>, stats:string}} r
   */
  showResults(r) {
    this._resultsOn = true;
    const el = this.results;
    el.innerHTML = '';
    el.append(h('div', 'bt-rtitle', r.title));
    el.append(h('div', 'bt-rsub', r.sub));
    const box = h('div', 'bt-rmembers');
    this._resultRows = [];
    for (const m of r.members) {
      const row = h('div', 'bt-rm');
      row.style.setProperty('--c', m.color || '#e0b458');
      row.append(img(portraitDataURL(m.look, 104), m.name));
      const main = h('div', 'bt-rmain');
      const top = h('div', 'bt-rtop');
      const nm = h('div', 'bt-name', m.name);
      const lv = h('div', 'bt-rlv');
      lv.innerHTML = `Lv <b>${m.level0}</b>`;
      top.append(nm, lv);
      const xprow = h('div', 'bt-xprow');
      const bar = h('div', 'bt-xpbar');
      const fill = h('i');
      bar.append(fill);
      const xpnum = h('div', 'bt-xpnum');
      xprow.append(bar, xpnum);
      const gains = h('div', 'bt-gains');
      // "Level n" is stamped by the ribbon; the chips carry what the level brought.
      for (const g of String(m.gains || '').split(' · ').filter((x) => x && !/^Level \d+$/.test(x))) {
        gains.append(h('span', `bt-chipx${/skill/i.test(g) ? ' bt-skill' : ''}`, g));
      }
      main.append(top, xprow, gains);
      const xp = h('div', 'bt-rxp', `+${m.gained} XP`);
      const lvup = h('div', 'bt-lvup');
      row.append(main, xp, lvup);
      box.append(row);
      this._resultRows.push({ m, row, bar, fill, lv, lvup, gains, xpnum, shown: m.level0, holdUntil: 0, lastPct: -1 });
    }
    el.append(box);
    if (r.loot.length) {
      const loot = h('div', 'bt-rloot');
      for (const l of r.loot) {
        const d = h('div');
        if (l.iconSrc) d.append(img(l.iconSrc));
        const s = h('span');
        s.innerHTML = l.html;
        d.append(s);
        loot.append(d);
      }
      el.append(loot);
    }
    if (r.stats) el.append(h('div', 'bt-rstats', r.stats));
    this.resultsFoot = h('div', 'bt-rfoot bt-wait');
    this.resultsFoot.innerHTML = this.touchUi ? 'Tap to continue' : `<span class="bt-key">${esc(this.labelFor('confirm'))}</span> Continue`;
    el.append(this.resultsFoot);
    this.setResultsProgress(0);
    this._show(this.dim, true);
    this._show(el, true);
  }

  /**
   * Animate the XP bars (u 0..1 of the fill animation). A bar that reaches a level threshold fills to 100%,
   * flashes and stamps a "LEVEL n" ribbon, holds briefly, then carries on from 0 inside the new level.
   * @param {number} u
   * @returns {{leveled:string[]}} ids of members whose bar crossed a level threshold on this call
   */
  setResultsProgress(u) {
    const HOLD = 520;
    const now = perfNow();
    this._resultsU = Math.max(0, Math.min(1, Number(u) || 0));
    const leveled = [];
    let wake = Infinity;
    for (const row of this._resultRows ?? []) {
      const m = row.m;
      // Walk from (level0, xp0) forward by u × gained XP through the level thresholds.
      let level = m.level0;
      let xp = m.xp0;
      let left = m.gained * this._resultsU;
      let need = m.needFor(level);
      let guard = 0;
      while (left > 0 && need > 0 && guard++ < 30) {
        const room = need - xp;
        if (left >= room && level < m.maxLevel) {
          left -= room;
          level += 1;
          xp = 0;
          need = m.needFor(level);
        } else {
          xp += left;
          left = 0;
        }
      }
      if (now < row.holdUntil) {
        wake = Math.min(wake, row.holdUntil);
        continue; // the bar sits full while the level-up flourish plays
      }
      if (level > row.shown) {
        // Threshold crossed: show this level-up (one at a time if several were gained).
        row.shown += 1;
        row.holdUntil = now + HOLD;
        wake = Math.min(wake, row.holdUntil);
        leveled.push(m.id);
        this._setBar(row, 1, false);
        row.bar.classList.remove('bt-flash');
        void row.bar.offsetWidth;
        row.bar.classList.add('bt-flash');
        row.lvup.textContent = `Level ${row.shown}`;
        row.lvup.classList.remove('bt-on');
        void row.lvup.offsetWidth;
        row.lvup.classList.add('bt-on');
        row.row.classList.add('bt-leveled');
        row.lv.innerHTML = `Lv <b class="bt-pop">${row.shown}</b>`;
        row.gains.classList.add('bt-on');
        const needShown = m.needFor(row.shown - 1);
        row.xpnum.textContent = needShown > 0 ? `XP ${needShown} / ${needShown}` : 'MAX';
        continue;
      }
      row.bar.classList.remove('bt-flash');
      const pct = need > 0 ? Math.max(0, Math.min(1, xp / need)) : 1;
      this._setBar(row, pct, row.lastPct > pct + 0.02);
      row.xpnum.textContent = need > 0 ? `XP ${Math.floor(xp)} / ${need}` : 'MAX LEVEL';
      if (this._resultsU >= 1) {
        row.gains.classList.add('bt-on');
        if (row.shown > m.level0) this._settleLevel(m.id, row.shown);
      }
    }
    // The scene stops calling once u reaches 1: finish any flourish that is still holding by ourselves.
    clearTimeout(this._resultsWake);
    if (wake < Infinity) this._resultsWake = this._later(() => this.setResultsProgress(this._resultsU), wake - now + 16);
    return { leveled };
  }

  _setBar(row, pct, instant) {
    if (instant) {
      row.fill.style.transition = 'none';
      row.fill.style.width = '0%';
      void row.fill.offsetWidth;
      row.fill.style.transition = '';
    }
    row.fill.style.width = `${(pct * 100).toFixed(1)}%`;
    row.lastPct = pct;
  }

  /** Show the new level on the party card under the results panel too. */
  _settleLevel(key, level) {
    if (this._levelOverride[key] === level) return;
    this._levelOverride[key] = level;
    for (const card of this.cards.values()) {
      if (card.key !== key) continue;
      card.lv.textContent = `Lv ${level}`;
      card.lv.classList.add('bt-up');
    }
  }

  setResultsReady(on) {
    this.resultsFoot?.classList.toggle('bt-wait', !on);
  }

  hideResults() {
    this._resultsOn = false;
    clearTimeout(this._resultsWake);
    this._show(this.results, false);
    this._show(this.dim, false);
  }

  /** Rebuild key-label / device dependent text (after a device switch or returning from settings). */
  refreshLabels() {
    const wasTouch = this.touchUi;
    this._applyDevice();
    this._applyLayout();
    this._renderButtons();
    this._legendBuilt = false;
    if (this.legend.classList.contains('bt-on')) this._buildLegend();
    this._cache.delete('aim');
    this._cache.delete('practice');
    this._cache.delete('info');
    if (wasTouch !== this.touchUi) {
      if (this._lastTarget && this.target.classList.contains('bt-on')) this.showTarget(this._lastTarget);
      if (this.info.classList.contains('bt-on') || this._lastInfo) this.setInfo(this._lastInfo);
    }
  }
}

/** Icon data URLs used by the scene's menus. */
export const HUD_ICONS = {
  element: (el) => elementIcon(el, 20),
  item: (id) => itemIcon(id, 22),
  mechanic: (k) => mechanicIcon(k, 20),
  status: (id) => statusIcon(id, 18),
  cue: (type) => cueIcon(type, 20),
};
