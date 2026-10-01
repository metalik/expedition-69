# Build notes from stage 1 (foundation modules)
Auto-collected reports from each foundation builder. Stage-2 builders: read the section of every module you use.

## CORE
**Files:** package.json, tools/serve.mjs, tools/cdp.mjs, src/core/engine.js, src/core/scene.js, src/core/input.js, src/core/events.js, src/core/rng.js, src/core/util.js, src/core/tween.js, src/core/save.js, src/battle/qte.js, tests/core-qte.test.mjs, tests/core-utils.test.mjs, tests/core-input.test.mjs, tests/core-scene.test.mjs, dev/core.html, dev/core.js

### Exports
ENGINE (src/core/engine.js): STAGE_W=1280, STAGE_H=720, MAX_DT=50, MAX_DPR=2, MAX_BACKING_WIDTH=3840; re-exports Scene, SceneManager. class Game({canvas, uiRoot, stageEl, fadeEl}) (defaults #game/#ui/#stage/#fade; creates #ui/#fade if missing). Fields: canvas, ctx (2d, alpha:false), uiRoot, stageEl, fadeEl, viewportEl, width, height, input, audio=null, events (Emitter: 'resize','settings','scene','visibility','error'), state=null, settings, params (URLSearchParams), time, frame, dt, fps, scenes, debug={}, errors[] ({scene,phase,message,stack,time}), scale, pixelRatio, stageRect, fading, hidden, running. Methods: registerScene(name, Cls)→this; start()→this; stop(); step(now) (one frame: input.beginFrame → top.update(dt≤50) → ctx.reset+clear → render visible stack (each in save/restore) → input.endFrame); applyBaseTransform(ctx=this.ctx); fade(outMs=300, fn, inMs=outMs)→Promise<fn result> (queued, input blocked during fade-out+fn, fn errors reported not thrown); saveSettings()→bool (validates in place, persists, re-applies bindings + audio.setVolumes, emits 'settings'); toStage(clientX,clientY); toggleFullscreen(); reportError(scene, phase, err) (logs each distinct scene|phase|message once).
SCENE (src/core/scene.js): class Scene(game){game, transparent=false, _ui=[], name}; enter(params) exit() pause() resume(result) update(dt) render(ctx); mountUI(el|htmlString)→el; unmountUI(); get isTop. class SceneManager(game): register(name,Cls), isRegistered(name), push(name,params)→Scene, pop(result)→popped Scene|undefined, replace(name,params)→Scene, reset(name,params)→Scene, get top, has(name), get(name), get stack (copy), get size, names(), visible(). Params default to {}; lifecycle hooks error-isolated via game.reportError; unknown names throw.
INPUT (src/core/input.js): ACTIONS, DEFAULT_BINDINGS (frozen, exact spec), ACTION_LABELS, PRESS_LOG_MS=3000, STICK_DEADZONE=0.25, codeLabel(code). class Input(win=window|null): enabled, pressLog [{action,t,source:'keyboard'|'gamepad'|'touch'|'virtual',seq,code}], pointer {x,y,down,pressed,released,inside,type,button,overUI,target,t}, lastDevice, events (Emitter: 'device','press','gamepad'), now, uiRoot. setBindings(map|null), get bindings, actionsFor(code), beginFrame(now), endFrame(), isDown(a), pressed(a), released(a), anyPressed(actions=ACTIONS)→action|null, pressedRepeat(a, delay=380, interval=90), consume(actions?), keyDown(code), keyPressed(code), pressesSince(t, actions?) (strictly t'>t, chronological), framePresses(actions?) (presses gathered since previous frame, each exactly once), get lastSeq, pressesAfter(seq, actions?), axis()→{x,y}, keyLabel(action, device=lastDevice), keyLabels(action, device), virtualPress(action, source='touch'), virtualRelease(action), setStageRect(rect, scale), toStage(x,y), block()/unblock()/get blocked, clear(), attach(), detach().
QTE (src/battle/qte.js, pure): DIFFICULTY, DEFAULT_DIFFICULTY, BASE_WINDOWS, LOCKOUT, OFFENSE_WINDOWS, DEBOUNCE_MS=90, DEFENSE_ACTIONS, HIT_TYPES, VALID_DEFENSES, DEFENSE_OUTCOMES, OUTCOME_LABELS; difficultyDef(id), windowScaleOf(idOrObjOrNumber), windowsFor(difficulty)→{parry,dodge,perfectDodge,jump,gradient:{pre,post}, offense:{perfect,good}} (0.1 ms rounding), normalizeHitType(t), claimZone(hitType, windows), perfectAction(hitType)→'parry'|'dodge'|'jump'|'gradient'|null, isAvoided(outcome), judgeDefense(hitType, action, offset, windows)→outcome, judgeOffense(offset, windows)→'perfect'|'good'|'miss', qteMultiplier(rating)→1.4|1.15|1.0, describeOffset(ms)→'34 ms early'|'12 ms late'|'on time'|''. class DefenseTracker({hits:[{t,type}], difficulty='expeditioner', calibration=0}): difficulty, windows, calibration, hits (normalized [{index,t,type}]), results[], claims[] ({action,t,offset,outcome,resolveAt}), pressHistory[]; press(action,t)→{accepted, claimedHit, reason:'claim'|'whiff'|'locked'|'debounce'|'ignored', offset?, outcome?, lockedUntil?, feintHit?}; update(now)→[{hitIndex,outcome,offset,action}]; get lockedUntil; isLocked(t); zoneOf(i); unclaimedResolveTime(i); get endTime; nextHitIndex(); isDone(). class OffenseTracker({prompts:[{t}], difficulty, calibration=0}): windows, prompts, results[] ({rating,offset}), claims[], pressHistory; press(t)→{accepted, claimedPrompt, reason, rating?, offset?, lockedUntil?}; update(now)→[{promptIndex,rating,offset}]; get lockedUntil; isLocked(t); unclaimedResolveTime(i); isDone(). class AttackClock(realStart=0, {scale=1, localStart=0}): setScale(scale, realNow), toLocal(realT), get scale (maps real press timestamps through hit-stop).
SAVE: SAVE_KEY, SETTINGS_KEY, DEFAULT_SETTINGS, INPUT_OFFSET_RANGE {-250..250}, storage {available, get(key,fb=null), set(key,v)→bool, remove(key)→bool}, loadSettings(), saveSettings(s)→bool, validateSettings(raw), sanitizeBindings(raw), defaultSettings(). EVENTS: Emitter {on→off fn, once→off fn, off, emit→bool, listenerCount, clear; '*' wildcard}. RNG: class RNG(seed number|string; default Date.now()) {seed, state get/set, next, int(min,max), float, chance, pick, weighted(items, weightFn=item.weight), shuffle (in place, returns arr), shuffled (copy), fork}, hashSeed(str). UTIL: clamp, clamp01, lerp, invLerp, remap, smoothstep, approach, damp(cur,target,lambda,dtMs), dist(x0,y0,x1,y1|p,q), angle(...), wrap(v,min,max|v,max), pickWeighted(items, weightFn, rand=Math.random), formatNumber(n, decimals=0), formatDuration(ms), uid(prefix='id'). TWEEN: Ease{linear,inQuad,outQuad,inOutQuad,inCubic,outCubic,inOutCubic,outBack,inBack,outElastic,outBounce,inExpo,outExpo}; Tweener{to(obj, props, ms, ease=outQuad|name, {delay,onDone,onUpdate})→handle{target,done,cancelled,finished:Promise<bool>}, update(dt), cancel(h), cancelTarget(obj), clear(), size}; Timers{after(ms,fn)→id, every(ms,fn(count); return false stops)→id, cancel, update(dt), clear, elapsed, size}; wait(timers, ms)→Promise.
CDP (tools/cdp.mjs): launch({width=1280,height=720,headless=true,port=0,chromePath,args=[],timeout=20000,gpu=false})→{page, close, port, process, userDataDir}; findChrome(), sleep(ms), KEY_CODES, CHROME_CANDIDATES. Page: consoleMessages [{type,text,time}] (incl. 'log.<level>'), errors [{message,time}], send(method,params), on('console'|'error'|rawCdpEvent, fn)→off, setViewport(w,h,dpr=1), goto(url,{waitUntil:'load'|'domcontentloaded'|'none', timeout}), reload(), eval(exprOrFn, ...args) (awaits promises, cycle-safe clone of objects), waitFor(expr, timeoutMs=5000,{interval}), screenshot(path)→abs path, keyDown(code), keyUp(code), key(code,{down,up,delay,holdMs}), press(code,{holdMs=40}), type(text), mouseMove(x,y), click(x,y,{button,holdMs,clickCount}), tap(x,y), sleep(ms). CLI: node tools/cdp.mjs <url> [--shot f] [--wait ms] [--eval expr]... [--keys "KeyE@500,Space@900:120"] [--wait-for expr] [--width --height --timeout --headful --quiet]; exit 0 ok / 1 uncaught page exception or failed --eval / 2 harness failure. SERVE (tools/serve.mjs): CLI --port (8069) --root --host (127.0.0.1) --quiet; exports DEFAULT_PORT, MIME_TYPES, createStaticServer({root,quiet}), serve({port,host,root,quiet})→{server,url,port,close}.

### Deviations / additions
- package.json "test" is `node --test "tests/**/*.test.mjs"`, not `node --test tests/`. On the installed Node 26.7 a directory argument fails ("Cannot find module .../tests"), so the glob keeps `npm test` working. It runs every builder's tests (265 pass).
- Feints (SPEC §3.2 says 'pressing into a feint is a whiff'): a press inside a feint's bait zone (the same span as a normal hit's claim zone) that is strictly closer to the feint than to the matched real hit counts as a whiff with lockout. The result carries feintHit. If the distances are equal, the real hit wins. Otherwise the literal claiming rules apply unchanged. claimZone('feint') returns that bait zone.
- An unclaimed hit resolves as 'hit' only once now − calibration > T + post, and never before T. So update(T+post) does not resolve it yet, which lets a press at exactly T+post that is fed before update() still claim. An unclaimed offensive prompt likewise resolves 'miss' once now > T + good. A claimed prompt resolves at max(T, claimTime), the same rule as defense.
- OffenseTracker ignores presses that come within 90 ms of a claiming press (the spec gives this only for defense). This stops a double tap from stealing the next prompt. Presses that land inside an already-judged prompt's good window are 'ignored' (no lockout), which follows from 'not within any prompt's window = whiff'.
- The press 'resolved' test inside DefenseTracker.press is deterministic: a claimed hit counts as resolved once t ≥ max(T, claimTime), even if update() has not run. A press while the matched hit is claimed but unresolved is 'ignored' (accepted:false). Whiffs and claims return accepted:true.
- The canvas backing store is 1280 × scale × min(dpr, 2), additionally capped at 3840 px wide (MAX_BACKING_WIDTH) so 5K screens do not draw 15-megapixel frames. The URL param ?dpr=N overrides the device pixel ratio.
- Timers resolve with the recorded offset in the adjusted domain (press t − calibration − T). lockedUntil, debounce and resolveAt use the caller's raw clock.
- Additions (no renames): Input.framePresses/pressesAfter/lastSeq/pressedRepeat/consume/keyDown/keyPressed/keyLabels/actionsFor/block/unblock/clear/toStage/detach/events; Game.step/stop/reportError/errors/toStage/toggleFullscreen/fps/dt/scale/pixelRatio/stageRect/fading/hidden; SceneManager.register/get/stack/size/names/visible; qte AttackClock, judgeDefense, perfectAction, isAvoided, describeOffset, windowScaleOf, difficultyDef, DEBOUNCE_MS, HIT_TYPES, DEFENSE_OUTCOMES, OUTCOME_LABELS; save validateSettings/sanitizeBindings/defaultSettings/INPUT_OFFSET_RANGE; RNG.shuffled/hashSeed; util clamp01/damp/formatDuration.
- Engine inline styles: #viewport becomes fixed full-window with overflow hidden and touch-action none, and gets a black background only if its computed background is transparent. The body gets margin 0 and overflow hidden. #stage is 1280×720 and scaled with left/top plus transform: scale(s). #ui gets z-index 1 and #fade gets z-index 2, which gives #ui its own stacking context. The engine sets no pointer-events on #ui.

### Tests / verification
npm test passes: 265/265 tests, including 69 CORE tests in four files.
- core-qte: 27 tests. They cover every constant, windowsFor at all three difficulties, claim zones, the hit type × action matrix at impact, and a sweep of about 32k presses (every type × action × difficulty × offset from −500 to +160 ms in 0.5 ms steps) checked against an independent model written from SPEC §3.2. Also: inclusive and +1 ms edges for every valid action at every difficulty, lockouts per action (unscaled, not extended by locked presses), debounce at 89 and 90 ms, first-claim-decides and 'ignored', resolution timing, determinism without update(), feints (including one 180 ms before a real hit), 180 ms combos (perfect, sloppy, early dodges, missed middle, mashing), unsorted hits, calibration, invalid input, isDone, OffenseTracker (edges, lockout, timing, judged-once, debounce, overlapping prompts), the helpers, and AttackClock with a tracker.
- core-utils: 15 tests. RNG against mulberry32 reference values, plus util, tween, timers, emitter, and save with a fake localStorage, no localStorage, a throwing localStorage and a throwing getter.
- core-input: 19 tests, using a fake window.
- core-scene: 8 tests.

Browser checks: I served the project with my serve.mjs on port 8101 and drove dev/core.html from a scratchpad script through tools/cdp.mjs. It passes 21/21 checks: the page boots with no uncaught errors; a real KeyE event is logged as parry + qte with high-resolution timestamps and judged 'parry'. Q dodges an unparryable, E on an unparryable is a hit, Space jumps a shockwave and F makes a gradient counter. A parry 160 ms early is a hit reported as '~160 ms early'. Pressing into a feint whiffs and locks out, and the real hit then lands. A 180 ms triplet is parried from real keys at −14/−14/−15 ms. The transparent overlay pushes, mounts its DOM, pops, and resume(result) runs with the DOM unmounted. A deliberate update error is logged once and the loop keeps running. The fade goes to black and back and runs its callback. At 1000×800 the stage letterboxes to 1000×562.5 with a 1000 px backing store. Pointer mapping works at 640×360. Autopilot virtual presses defend every hit type with 0 hits taken.

Also checked:
- The CLI path: --keys, --eval and --shot work, exit code 0.
- A throwing render() in a transparent scene is isolated and logged once; the bench still renders correctly.
- At DPR 2 the backing store is 2560×1440, capped at 3840×2160 on a 2560×1440 viewport.
- The static server gives correct MIME types, no-cache headers, 404s, 405 for POST, a 301 to the trailing slash, a directory listing, and blocks path traversal.
- Chrome processes and temp profiles are cleaned up.

I looked at screenshots of: the idle bench, an attack in progress, the feint lockout, the overlay, the letterboxed view, autopilot, DPR 2, and the render error.

Two headless Chrome quirks I found and worked around in cdp.mjs:
1. Without focus emulation, the first Escape key event flips the page to 'hidden'. The harness now enables Emulation.setFocusEmulationEnabled.
2. Page.bringToFront starves setTimeout after input on pages running a requestAnimationFrame loop, so the harness does not use it.

The plain `chrome --headless --screenshot` command writes the PNG but its process does not exit in this environment; use tools/cdp.mjs instead.

### Known gaps
- I could not test the Gamepad API on real hardware. Polling, the stick deadzone and hysteresis, and edges are unit-tested with fake navigator.getGamepads data.
- Touch was verified only through pointer events with pointerType 'touch' in unit tests and virtualPress. There was no real-device test.
- The fade timing uses setTimeout, which browsers throttle in hidden tabs. A fade started while the tab is hidden finishes late, which is harmless because the loop is paused anyway.
- Input ignores key presses while Ctrl or Cmd is held, so browser shortcuts pass through. A focused <button> plus Enter fires both a native click and the 'confirm' action; UI code must pick one. Space is preventDefault-ed, so buttons are never activated by Space.
- The ctx.reset() fallback path, used on browsers without CanvasRenderingContext2D.reset, is covered only by code review; Chrome uses reset().

### Notes for integrators
FEEDING THE QTE JUDGES (BATTLE):
1. Each frame, call `for (const p of game.input.framePresses(DEFENSE_ACTIONS)) tracker.press(p.action, toLocal(p.t))`, then `tracker.update(toLocal(game.time))`. Always press before update. framePresses returns every physical press exactly once, with its real event.timeStamp (gamepad presses carry the frame time).
2. Hit times and the times you pass in must share one clock (attack-local ms).
3. Use qte.AttackClock to map real timestamps across hit-stop: `clock = new AttackClock(attackStartReal)`, `clock.setScale(0.05, game.time)` when hit-stop starts, `clock.setScale(1, game.time)` when it ends, then `clock.toLocal(p.t)`.
4. Pass calibration: game.settings.inputOffset and difficulty: game.settings.difficulty.
5. Start the defensive animation whenever press().accepted is true (a claim or a whiff).
6. Apply damage and effects on update() results; claimed hits resolve at max(T, claimTime), unclaimed ones just after T + post.
7. press() already returns outcome and offset for instant feedback, e.g. describeOffset(offset) when settings.showTimingFeedback is on.
8. Use tracker.lockedUntil (caller clock) for a lockout indicator.
9. Autopilot 'perfect': call tracker.press(perfectAction(hit.type), hit.t) at each non-feint hit's T.
10. Offense works the same way: OffenseTracker, with input.framePresses(['qte']) mapped to press(t); multiply damage by qteMultiplier(rating).
11. DefenseTracker.endTime tells you when the whole enemy action has been judged. Feint entries in results stay null.

INPUT (UI/WORLD):
- For menus use input.pressedRepeat('down') for auto-repeat, and input.consume(action) after handling a press so another reader in the same frame does not react again.
- Escape maps to both cancel and menu.
- Space maps to confirm, jump and qte.
- keyLabel(action) follows lastDevice; listen for input.events.on('device', ...) to refresh prompts.
- On-screen touch buttons: call input.virtualPress(action) on pointerdown and virtualRelease(action) on pointerup.
- pointer.overUI tells whether a click landed on DOM UI inside #ui.
- Key events from focused text inputs, textareas and selects are ignored, except Escape.

ENGINE:
- Main.js should do: `new Game({canvas, uiRoot, stageEl, fadeEl})`, set game.audio, registerScene(...), scenes.push/reset(...), then start().
- Scenes must call game.applyBaseTransform(ctx) rather than setTransform(1,0,0,1,0,0).
- Only the top scene updates; transparent scenes render over the ones below.
- mountUI elements are removed automatically after exit().
- fade(out, fn, in) blocks input while fading out and while fn runs; calls are queued.
- game.errors and the 'error' event expose caught scene errors.
- The engine does not set window.__game; main.js should.
- After editing game.settings, call game.saveSettings(). It keeps the same object, validates it, re-applies bindings and calls audio.setVolumes(...).

SAVE: the storage helpers never throw. validateSettings keeps unknown keys, so modules may add their own settings.

TOOLING:
- `node tools/serve.mjs --port N` serves the project.
- `node tools/cdp.mjs <url> --keys ... --eval ... --shot ...` runs a headless check (exit 1 on uncaught page exceptions).
- Library use: `const {page, close} = await launch(); await page.goto(url); await page.press('KeyE'); await page.eval(...); await page.screenshot(p); await close();`. page.eval safely returns live objects.
- dev/core.html is the reference bench. Useful parameters: ?autopilot=1, ?pattern=N, ?difficulty=..., ?cal=ms. Automate it through window.__bench.state(), upcoming() and restart(delayMs, pattern).

## LOGIC
**Files:** src/battle/model.js, src/battle/damage.js, src/battle/status.js, src/battle/turnOrder.js, src/battle/ai.js, src/battle/passives.js, tests/battle-damage.test.mjs, tests/battle-turnorder.test.mjs, tests/battle-actions.test.mjs, tests/battle-enemy.test.mjs, tests/battle-passives.test.mjs, tests/battle-flow.test.mjs, tools/simulate.mjs

### Exports
model.js: class BattleModel(opts: {party, enemies, rng, difficulty='expeditioner', ambush=null, practice=false, data, boss?, tutorial=false, items?}). Properties: combatants, party, enemies, turn {number, actorId, side, skipped, acted, ended, round}, round, gradient, log, stats, items, itemsUsed, startEvents, fleeAllowed, boss, practice. Methods: get(id), gradientCharges(), living(side), peekTurnOrder(n=8), nextTurn() → {actorId, skipped, events, reason?, over?}, endTurn(id), getCommands(id), getValidTargets(id, action), beginAction(id, action) → ActionPlan|{error}, resolveHit(plan, i, rating=null), finishAction(plan), planEnemyAction(id) → EnemyPlan, resolveEnemyHit(plan, i, outcome), counterEligible(plan) → [ids], resolveCounters(plan) → [{counterId, targetId, events}], finishEnemyAction(plan), outcome(), summary(), endBattle(outcome). Also exports the rule constants (MAX_AP, START_AP, GRADIENT_MAX, GRADIENT_CHARGE, SURGE_MAX, SURGE_CONSUME_STEP, GLYPH_MAX, GLYPH_ELEMENTS, GLYPHS, STANCES, GRADIENT_GAINS, SHOT, WEAK_POINT_EFFECTS, COUNTER_ATTACK, RIPOSTE, DEFAULT_HIT_GAP, DEFAULT_WINDUP, VALID_OUTCOMES, PERFECT_DEFENSE, POST_BATTLE_RECOVERY) and scaleEnemyStats(def, level).
damage.js: computeDamage(ctx) → {amount, crit, affinity, marked}; computeHeal({healer, target, pct|power}); expectedDamage(ctx); affinityOf, stanceOf, stanceDealtMult, stanceTakenMult, effectiveAtk, mitigation, qteMultiplier(rating, perfectMult), critChance; constants BASE_CRIT_MULT, QTE_MULTIPLIERS, STANCE_MODS, STATUS_DAMAGE_MULTS, VARIANCE.
status.js: STATUS_DEFS (id, name, positive, desc, defaultTurns), STATUS_IDS, BURN_PCT, BURN_PCT_BOSS, REGEN_PCT, isStatusId, hasStatus, getStatus, statusTurns, statusIds, canReceiveStatus, applyStatus(c, id, turns?, {fresh}), removeStatus, clearStatuses, cleanseStatuses, dispelStatuses, tickStartOfTurn(c) → [{status, kind, amount}], tickEndOfTurn(c) → [expired ids].
turnOrder.js: TURN_THRESHOLD, AMBUSH_BONUS, INITIATIVE_ROLL_MAX, SPEED_MULTS, speedMultiplier, effectiveSpd, rollInitiative(c, rng, bonus), compareTurnPriority, advanceToNext(combatants), forecastTurns(combatants, n, {currentActorId}).
ai.js: chooseEnemyAction(model, enemy, rng) → {attackId, targetIds, hitTargets}; weightedPick, randomPick, phasePool, phaseIndexForHp, attackOnCooldown, conditionMet, availableAttacks, pickTargets.
passives.js: PASSIVE_DEFS, PASSIVE_IDS (all 24), describePassive, isPassiveId, normalizePassives, passiveParams, hasPassive, plus one hook per passive (startApBonus, parryApBonus, parryHealPct, perfectDodgeApBonus, counterPowerMult, basicStatusList, lowHpDealtMult, hasSecondWind, turnHealPct, critVsBrokenBonus, critDamageBonus, breakPowerMult, shotPowerMult, shotMarkChance, firstStrikeMult, gradientGainMult, glassCannonDealt/Taken, elementPowerMult, killApBonus, isStatusImmune, perfectPowerMult, startStatusList, hurtApBonus, healPowerMult) and dealtMultiplier / takenMultiplier.
tools/simulate.mjs: a CLI, plus these exports: FixtureRng, ConstRng, createFixtureData, buildPartyManual, createFixtureModel, forceTurn, runPartyAction, runEnemyAction, DEFAULT_BOT, sampleRating, sampleDefense, botAction, runBattle, simulate, formatReport, parseArgs, loadRealData.

### Deviations / additions
- Combatant ids are 'p0'..'p2' (party, fixed order) and 'e0'..'e2' (enemies, in list order). combatant.key holds the character or enemy id. summary.party[].id is the character id.
- CTB advances in exact fractional time: each step moves time to the moment the next combatant reaches 100. This is the same as infinitesimal ticks. Ties go to higher effective speed, then party first, then slot order.
- peekTurnOrder(n) always forecasts what successive nextTurn() calls will return. During a turn it does not include the current turn, so the HUD should prepend model.turn.actorId. The forecast also simulates haste/slow/chill expiring at the end of each bearer's turn.
- A skipped turn (stun or Broken) is fully processed inside nextTurn(): skip event, stun consumed, end-of-turn duration ticks, and Broken recovery. Calling endTurn() afterwards is a harmless no-op. A skipped turn grants no +1 AP.
- nextTurn() auto-ends an unfinished previous turn. If burn kills the actor at turn start, nextTurn returns {skipped:true, reason:'ko'}.
- 'Fresh' statuses: a status applied to the current actor during its own turn does not lose a turn at the end of that same turn. Example: a self-buff for 3 turns lasts 3 of the bearer's following turns.
- Crit weak point: guaranteed crit using crit multiplier 2.0 (plus the critDamage bonus). It is not ×2 on top of the normal ×1.5.
- Shield weak point: on a shielded enemy it removes 2 shields and the shot is absorbed. On an unshielded enemy it deals ×1.5 damage.
- When hit.break is missing, break = round(final hit power × 10), where final power includes the surge-consume and glyph powerMult multipliers.
- Defense gradient gains (parry +8, dodge +2, perfect dodge +4, jump +6, gradient +20) are granted once per hit, not once per target of an AoE hit. The multiplier is the highest gradientGain among the defenders.
- Per-member defense rewards (parry AP, guard bonus, parryHeal, surge) apply to every member targeted by an AoE hit. A gradient counter on an AoE hit gives a riposte from every targeted member.
- Party +2 gradient per damaging hit is counted per hit, not per target, including shots and gradient-skill hits. A counterattack gives +5 instead (not +5 and +2). A riposte gives nothing beyond the gradient counter's +20.
- Gideon's surge +1 for a landed hit is also counted per hit, not per target. Landed counters and ripostes count too.
- Added constructor option items ({id:{count,max}} or plain numbers; defaults to each item's baseMax). summary.items and summary.itemsUsed are provided for write-back; PARTY's applyBattleResult already reads itemsUsed.
- Added constructor options boss and tutorial. Flee is disallowed when boss, tutorial or practice is set. boss is inferred from ENEMIES[].boss when omitted.
- Added enemy level scaling for {id, level} entries whose level differs from the bestiary level (scaleEnemyStats). Each level adds about 12% HP, 9% ATK, 8% DEF, +1.5 SPD and 10% XP/glint, compounding.
- Duplicate enemy names get ' A' / ' B' suffixes.
- The enemy shield effect restores shields up to max(starting shields, amount).
- Silenced enemies do not choose spell-like actions: ones with no damaging hits, or with a gradient hit.
- The AI falls back step by step (drop conditions, then cooldowns) so an enemy always acts. allyHpBelow includes the enemy itself, matching the BESTIARY docs.
- On KO a party member's AP is set to 0 and Sable's stance to neutral. Revived members start at 0 AP and 0 initiative.
- Practice mode: damage events still show the computed amount, but HP floors at 1 on both sides. endBattle(outcome) was added so the scene can exit practice (it also serves the debug winBattle).
- Random-target hits (target randomEnemies, or hit.random) re-pick a living enemy if their chosen target died before the hit landed. hit.targetIds is updated.
- Skill hits default to qte:true unless the data sets qte:false.
- Hits on skills that do not target enemies are ignored (the spec says non-damage skills have hits: []). consumeGlyph also accepts glyph 'any' or '*'.
- finishAction skips post effects once the battle has already ended (for example a stance change after the killing blow).
- Extra event fields: damage.kind ('attack'|'skill'|'gradient'|'shot'|'counter'|'riposte'|'enemy'|'status'), damage.weakPoint, damage.riposte:true, damage.status (burn ticks), blocked.hitIndex, and text events with targetId for 'Second Wind!', 'Resisted' and 'Immune'.
- summary() extras: xpByMember {charId: xp}, party[].maxHp / combatantId / hpAfterRecovery (1 HP for KO'd members, then +20% max HP), stats (the spec'd fields plus goods, misses, counters, breaks, kills, shots, rounds, partyTurns, enemyTurns, damageDealt, damageTaken, healing, skillsUsed, gradientSkills, itemsUsed), items, itemsUsed, practice, boss, enemies.

### Tests / verification
All six battle test files pass under `node --test tests/battle-*.test.mjs`: 103 tests and about 563 assertions. They cover turn order, AP flow, every effect type, every passive, the three character mechanics (including Virtuoso), shields, break and recovery, weak-point shots, counters (eligible and ineligible), gradient ripostes, AoE, status ticks and expiry, stun skips, phases, practice mode, victory, defeat and flee, determinism, and a 60-battle randomized run that checks invariants. `npm test`, which uses a glob and covers every builder's tests, passes 265/265. Note that `node --test tests/` with a bare directory errors on Node 26; package.json already uses the glob, so nothing to change. Scratch checks that are not part of the suite: a 400-battle random run on the real data modules, covering every encounter with random commands and outcomes, produced 64,780 events with 0 invariant violations and 0 console warnings, and every event type except 'fled' appeared. The simulator runs cleanly with --fixtures, on real data, and with --root pointing at an empty folder; the last one prints the list of missing modules and exits with code 1.

### Known gaps
- When the target of a single-target enemy combo dies mid-combo, the remaining hits do nothing; they are not retargeted.
- planEnemyAction does not check that it is that enemy's turn. It only marks the turn as acted when it is.
- The simulator bot never uses Free Aim or pure buff/utility skills (only damage, heal and revive), so it understates what those contribute.
- The enemy level-scaling formula is my own invention. It only applies when an enemies entry passes a level that differs from the bestiary level.
- Balance, as reported by the simulator (these are PARTY/BESTIARY files, not edited). Default bot: parry 0.6, dodge 0.2, jump 0.7, gradient 0.5, perfect 0.4, good 0.4; party built with gameState autoAllocate at the highest enemy level. All 31 encounters won 100% of the time. Regular battles last 1.3–3.0 rounds on average (target 3–5) with 91–99% party HP left. Failed normal-hit damage averages 7.5–12% of max HP, inside the target. Boss heavies are roughly on target: wreck_warden.anchor_drop 25.5% average (max 41.5%), bellwether.verdict_of_bronze 27.9% (max 57%), stillkeeper.noon_verdict 35.7% (max 64%). Regular attacks above the band: sentinel.pendulum_cleave about 20–22%, hourwraith.stopped_moment about 20%, shellguard.tide_crusher 15–17%, mime.curtain_call about 16%. Bosses end too fast: Warden 5.6 rounds, Bellwether 5.5, Stillkeeper 5.5 (target 8–15). A lone boss only gets about a quarter of the turns against three party members, so bosses rarely act. Suggested fixes: roughly 1.5–2× boss HP, or more boss speed, or several actions per turn. A novice bot (parry 0.25, dodge 0.25, jump 0.4, gradient 0.2, perfect 0.1, good 0.35) still wins 100% against every boss; Stillkeeper takes 7.8 rounds and leaves 67% HP. A poor bot on Veteran (parry 0.1, dodge 0.2, jump 0.25, gradient 0.1, perfect 0.05, good 0.25) wins 100% against the Warden and 90% against the Stillkeeper, with 1.8 KOs per battle.

### Notes for integrators
Turn protocol:
1. Call `t = model.nextTurn()`. If t.over, the battle is finished. If t.skipped, animate t.events (skip / recover / ko) and loop; endTurn is optional there. Otherwise animate t.events: +1 AP, burn/regen ticks, and possibly a boss phase event.
2. Party turn: getCommands(actorId), then getValidTargets(actorId, action), then plan = beginAction(actorId, action). A result with .error means the input was rejected. Animate plan.events (AP or gradient spent, mechanic consumed). For each plan.hits[i], wait hits[i].gap ms and call resolveHit(plan, i, rating). Hits with qte:true need an OffenseTracker rating ('perfect'|'good'|'miss'; null counts as miss). Basic attacks and shots have qte:false. Then call finishAction(plan). If plan.endsTurn, call endTurn(actorId). Shots have endsTurn:false: return to the menu and allow more shots or another command.
3. Enemy turn: plan = planEnemyAction(id) (animate plan.events, e.g. a phase change). Feed plan.hits (t, type) to a DefenseTracker. For each resolved hit, call resolveEnemyHit(plan, hitIndex, outcome). Any outcome invalid for the hit type is treated as 'hit', and a gradient counter's riposte damage (sourceId = the member, riposte:true) arrives in that same call. Then resolveCounters(plan) returns [{counterId, targetId, events}]. counterEligible(plan) previews who will counter. Finish with finishEnemyAction(plan) and endTurn(id).
4. Check outcome() after each event batch.

State and events:
- Model state is already applied when events come back; the scene only animates. Read HP, AP, shields, breakValue, statuses and mechanic straight off `model.get(id)`.
- The party is model.party[0..2] ('p0'..'p2', slot order). model.enemies are 'e0'..'e2' in the order given.
- For AoE enemy hits, one outcome covers every living id in hit.targetIds. Hit targets are fixed at plan time; for 'multi' attacks each hit has its own target.
- `mechanic` events carry a copy of {type:'surge', value} / {type:'glyphs', list} / {type:'stance', value}.
- phaseIndex is 0 for a boss's base phase and k after entering phases[k-1] (Stillkeeper 'Unwound' = 1). Pass it to drawActor pose.phase.

HUD:
- Show [model.turn.actorId, ...model.peekTurnOrder(7)] during a turn.
- model.log holds readable lines for a battle log.
- model.startEvents holds battle-start AP and startStatus events.

Ending the battle:
- summary() is idempotent (drops are rolled once) and matches PARTY's applyBattleResult: xpByMember, itemsUsed, items, practice, party[].id = character id.
- Pass `items: game.state.items` to the constructor so counts are correct; the model never mutates that object.
- Use endBattle('victory'|'defeat'|'fled') for the debug winBattle and to leave practice. In practice battles HP floors at 1 and flee is disallowed.
- Pass `boss` / `tutorial` from the encounter so flee is disabled.

Data expectations:
- Enemy attack.anim may be omitted; plan.anim falls back to the first hit's anim, then 'cast'.
- Non-damaging enemy actions have hits:[] and effects. Effect targets are relative to the source: 'self', 'allies' = the source's side, 'enemies' = the other side, 'target' = the plan's targets (the default).
- Only rng.next() is used, so any seeded RNG works.

Simulator:
- `npm run sim -- --sweep` covers all encounters; `--encounter id`, `--enemies a,b --level N`, `--fixtures`, `--json`.
- Tests share fixtures and helpers exported from tools/simulate.mjs (createFixtureModel, forceTurn, runPartyAction, runEnemyAction).

## PARTY
**Files:** src/data/characters.js, src/data/skills.js, src/data/relics.js, src/data/items.js, src/data/shops.js, src/game/progression.js, src/game/gameState.js, tests/game-data.test.mjs, tests/game-progression.test.mjs, tests/game-state.test.mjs

### Exports
DATA
characters.js: CHARACTERS{gideon,nyra,sable}, PARTY_ORDER. Each entry has the spec fields: id, name, title, look, color, mechanic, shotElement, base, growth, basicAttack, gradientSkill, startingSkills, bio. Added fields: role, mechanicName, mechanicDesc.
skills.js: SKILLS has 27 skills: 8 regular + 1 gradient per character, spec schema only. Each skill also has a `short` one-liner. Helpers: skillIdsFor(owner,{includeGradient}) and skillBasePower(skillOrId).
relics.js: RELICS has exactly the 30 fixed ids. Also STARTING_RELICS, MASTERY_BATTLES=4, DUPE_GLINT{common:45,rare:90,legendary:180}, RARITY_LABELS, formatStats(stats), passiveText(passive) and relicIdsSorted().
items.js: ITEMS{tincture,tonic,draught} (each adds id and fieldUse), ITEM_ORDER, UPGRADES{tincture_shard,tonic_shard,draught_shard} (each adds id).
shops.js: SHOPS{shore_camp,thicket_camp,spire_camp}. Each is {id,name,keeper,zone,blurb,stock:[{kind,id,price,limit?}]}.

PROGRESSION (progression.js)
- Spec: xpToNext(level), derivedStats(member,{relics=RELICS}), grantXp(member,amount,{relics}) → [{level,attrPoints,sp}], echoCapacity(level), echoLoad(member,{relics}).
- Added: MAX_LEVEL=20, ATTRS, ATTR_POINTS_PER_LEVEL, MAX_CRIT=0.6, ATTR_INFO, totalXpForLevel, spForLevel, baseStats, relicStatBonus, statBreakdown.

GAME STATE (gameState.js)
- createNewGame({seed}?)
- toBattleParty(state) → PartySnapshot[]
- applyBattleResult(state, summary, {spawnId,bossId,practice}?) → {outcome,xpGained,xpByMember,glint,drops,converted,levelUps,mastered,newSkillsAvailable}
- restAtFlag(state, flagId, {zone,x,y,name}?) → {ok}
- allocateAttr(state,charId,attr,n=1), learnSkill(state,charId,skillId), equipRelic(state,charId,slot,relicId|null) (may add movedFrom), equipEcho, unequipEcho, useItemOutOfBattle(state,itemId,charId) (adds amount). All return {ok,reason?}.
- addLoot(state, loot | loot[]) → string
- buy(state,shopId,index) → {ok,reason?,description?}
- serialize, deserialize, saveGame, loadGame, hasSave, deleteSave
- Added exports: SAVE_KEY, STATE_VERSION, RELIC_SLOTS, POST_BATTLE_RECOVERY, AUTO_ALLOCATE_WEIGHTS, getMember, collectPassives(member,state?), applyPostBattleHp(state,summary), markDefeated(state,id,{boss}), grantPartyXp(state,amount), visitFlag(state,flagId,info), autoAllocate(state,charId) → {ok,allocated}, skillsFor(state,charId) or skillsFor(charId,state?), findRelicHolder, describeRelic(id,state?), relicInventory(state), echoOptions(state,charId), canUseItemOutOfBattle, shopView(state,shopId), partyMemberView(state,charId), addPlayTime(state,ms), normalizeState(raw).

### Deviations / additions
- GameState has one extra top-level field, `shops: {[shopId]: {[stockIndex]: count}}`, that tracks shop purchases. Shards are only buyable `limit` times per stock entry (default 1); otherwise shards could be bought forever.
- `state.stats` has extra counters (dodges, jumps, gradientCounters) next to the spec'd ones. `state.world.facing` defaults to 'down'.
- The applyBattleResult result has two extra fields: `xpByMember` and `converted: [{id, glint}]` (duplicate drops turned into Glint). `drops` lists only relics that are newly owned.
- applyBattleResult handles every outcome. On flee or defeat it only writes back HP, consumed items and counters (defeat also adds a death); rewards happen on victory only. Missing `outcome` is treated as victory. `summary.practice` or `opts.practice` means the call changes nothing, so training is free. It accepts a 3rd argument `{spawnId, bossId}` that marks world.defeated / world.bosses.
- applyBattleResult also writes back consumed items. It uses summary.itemsUsed as a delta; if that is missing it uses summary.items counts, and those can only lower a count, never raise it. The spec does not mention items in the battle summary, but the real BattleModel.summary() returns both fields.
- restAtFlag and visitFlag take an optional `{zone, x, y, name}` argument for the flagsVisited and lastFlag records. Without it they reuse the previous record, then the player's current position.
- The PartySnapshot mechanic is the string 'surge' | 'glyphs' | 'stance' (the model accepts a string or an object). Each passive is {id, params, source: relicId, from: 'relic'|'echo', name}. Snapshots also include title and color.
- Gradient skills are innate. They have learn {level:1, sp:0}, are never stored in member.skills, and learnSkill rejects them.
- Total crit is capped at 0.6 after relic crit is added, not only the attribute part.
- When an equipped relic or vitality point changes max HP, current HP moves by the same amount. Level-ups also add the max-HP gained to current HP.
- I spelled 'harbour' and 'armour' the British way to match the text in story.js and enemies.js.

### Tests / verification
`node --test tests/game-*.test.mjs` passes 52 of 52 tests. They cover:
- **Data:** base stats, closed-set schema validation of every skill, 8+1 skills per character with 4–7 gradient hits, balance bands, mechanic showcase checks, the 30 exact relic passives, items, shops.
- **Stat curve:** the party average with an even attribute spread is within ±15% of the §3.3 table at levels 1/5/10/15. Actual ratios: L1 1.01 / 1.00 / 0.98 / 1.01; L5 1.08 / 1.06 / 1.02 / 0.99; L10 1.00 / 0.99 / 0.99 / 1.00; L15 0.92 / 0.94 / 0.98 / 1.00.
- **Level-up math:** multi-level jumps, +2 SP at 5/10/15, level cap, HP gain.
- **Battle results:** XP to living members and half to KO'd ones, xpByMember in object and array form, glint, drops, duplicates, mastery at 4, echo capacity, echo de-dup in toBattleParty, flee/defeat/practice, item write-back.
- **World and inventory:** learn rules, relic equip/move/swap, rest, loot, shop buy and limits.
- **Saves:** serialize round-trip (deep-equal and identical string), garbage rejection, repair of corrupted saves, prototype-pollution safety, and save/load with a fake, missing or throwing localStorage.

**Browser check:** I served a scratch page (symlinked src, nothing added to the project) and screenshotted it in headless Chrome. The modules load, and with real localStorage the save round-trip and deleteSave work, with no errors.

**Integration check:** I read the real src/battle/model.js without modifying it. Its handling of mechanic strings, consumeGlyph effects (appended after the skill's own effects), stance, surge, bonusVs, ignoreShields, the snapshot shape and summary.party ids (snapshot ids), xpByMember and practice all match my data and applyBattleResult. I also ran `node tools/simulate.mjs --sweep`, which builds the party through my gameState: 100% win rate.

### Known gaps
- Fights run short in the simulator at default bot skill (40% perfect / 40% good QTEs, 60% parry). Regular fights last about 1.3–3 rounds against a 3–5 target, and bosses about 5–6 rounds (Wreck Warden 5.6, Stillkeeper 5.2) against an 8–15 target. Party stats match the §3.3 table and skill power follows the brief's bands, so this points at enemy HP (BESTIARY) or LOGIC's AP/damage tuning. Raising boss/regular HP by roughly 1.6–2× looks like the right lever.
- Nothing is sold to reset attribute points; allocation is permanent.
- Stock entries are fixed per shop. Nothing unlocks as story progress is made.
- Two failures in the full suite (tests/battle-actions.test.mjs: dispel, bonusVs) belong to LOGIC's fixture tests and do not involve my data.

### Notes for integrators
- **Battle scene:**
  - Call `toBattleParty(game.state)` for the BattleModel party and pass `game.state.items` as the model's items option.
  - On end, call `applyBattleResult(game.state, model.summary(), { spawnId, bossId })` for every outcome. It writes back HP (KO → 1 HP, then +20%) and consumed items, and skips everything for practice.
  - Its result has levelUps [{id, level, attrPoints, sp}] (one per level gained), mastered [relicId] (new Echoes to announce), newSkillsAvailable [{id, skillId}], drops (newly owned relic ids) and converted duplicates [{id, glint}].
- **World:**
  - Call `visitFlag(state, flagId, {zone, x, y, name})` when a flag is discovered, and `restAtFlag(state, flagId, {zone, x, y, name})` on Rest. restAtFlag clears world.defeated, keeps bosses and sets world.lastFlag.
  - Use `markDefeated(state, spawnId)` or `markDefeated(state, bossId, {boss:true})` if you don't route them through applyBattleResult.
  - `addLoot(state, {relic}|{shard}|{glint}|{item, count?})` returns a display string (arrays are accepted).
  - createNewGame puts the world at shore (0,0); set the real start position yourself.
- **Pause and party UI:**
  - partyMemberView(state, id) gives stats, base, bonus and a per-stat breakdown {base, growth, attrs, relics, total}, plus xpToNext, relic slots with text, echoes with a `suppressed` flag, echoLoad/echoCapacity and passives.
  - skillsFor(state, id) returns entries with status 'learned' | 'learnable' | 'locked' | 'innate', plus reason and requires[{id, name, learned}].
  - Also available: autoAllocate(state, id), relicInventory(state), echoOptions(state, id), describeRelic(id, state) (statsText, passiveText, masteryText, equippedBy, echoedBy), canUseItemOutOfBattle / useItemOutOfBattle (tincture and tonic only), ATTR_INFO for attribute tooltips, and formatStats / passiveText from relics.js.
  - equipRelic swaps when moving a relic between a character's own slots, and returns movedFrom when it takes the relic from another character.
- **Shop scene:** shopView(state, shopId) returns rows {name, desc, price, owned, soldOut, remaining, affordable, canBuy, reason}; then call buy(state, shopId, index). SHOPS[id] also carries keeper and blurb text.
- **Saves:**
  - saveGame / loadGame / hasSave / deleteSave use key 'exp69.save.v1' directly and are safe without storage. hasSave() is false for corrupt saves.
  - deserialize repairs partial saves and keeps unknown extra fields at top level and inside world, so WORLD/UI can store additional JSON there.
  - Call addPlayTime(state, dtMs) from the world loop.
- **Debug:** grantPartyXp(state, n) matches the game.debug.grantXp hook.
- **Skill data:**
  - Every skill hit has qte:true, with gaps of 270 ms or more so QTE rings never overlap.
  - Gradient skills have ap:0 and gradient:true.
  - Nyra's Aurora Palimpsest fills all 4 glyph slots, setting up Codex Unbound.
  - Sable's Crimson Requiem sets stance directly to 'virtuoso'.
  - Gideon's Thunderhead Oath leaves him at about 10 Surge, ready for Overload Verdict.
- **Colours and portraits:** character accent colours are CHARACTERS[id].color (gideon #6f9fd8, nyra #e8c872, sable #d6453d), and look ids equal the character ids.

## BESTIARY
**Files:** src/data/enemies.js, src/data/encounters.js, src/data/story.js, tests/data-enemies.test.mjs, tests/data-encounters.test.mjs, tests/data-story.test.mjs, tests/data-balance.test.mjs, tests/data-timing.test.mjs

### Exports
enemies.js: ENEMIES (13 fixed ids, SPEC §4.8 shape), ENEMY_IDS, DEFAULT_WINDUP=350, HIT_TYPES, MELEE_ANIMS, RANGED_ANIMS, ENEMY_ANIMS, ELEMENTS, STATUS_IDS, EFFECT_TYPES, WEAK_POINT_EFFECTS, ENEMY_ZONES, getEnemy(id)→def|null, getAttack(enemyId, attackId)→attack|null, phaseAt(enemy, hpFrac)→{phaseIndex, pool, statMult:{spd,atk}}, damagingHits(attack)→hits without feints.
encounters.js: ENCOUNTERS ({[id]:{id,name,enemies,zone,music,boss?,tutorial?}}), BOSS_ENCOUNTERS ({wreck_warden:'boss_wreck_warden', bellwether:'boss_bellwether', stillkeeper:'boss_stillkeeper'}), getEncounter(id)→enc|null, encountersInZone(zone,{includeBoss=false,includeTutorial=false})→enc[] in rising-difficulty order.
story.js: STORY {intro[6], ending[6], dialogues{14 required + npc_lamplighter, npc_frozen_gull, npc_cartographer, npc_apprentice, npc_quist_rumours}, journals{j1..j9:{zone,title,author,text}}, hints{17 keys}, zoneTitles{shore,thicket,spire,summit,training}, zoneSubtitles{same keys}}, REQUIRED_DIALOGUE_IDS, HINT_KEYS, JOURNAL_IDS, HINT_TOKENS, SPEAKER_NAMES, fillTokens(text, labelFor)→string, getDialogue(id)→lines ([] if unknown), speakerName(speaker)→string.

### Deviations / additions
- Additions only; no spec'd names changed. Every attack also has a top-level `anim` (its first hit's anim, or 'cast' for actions with no hits) and a one-line `desc`. Every hit always has explicit `element` and `windup` values, never left to defaults. Feints have power 0.
- Hit powers are normalized: power 1.0 is a standard hit, about 10–11% of the expected party HP at the enemy's level. Enemy atk rises with level (driftling 54 up to stillkeeper 380).
- Non-damaging casts use approach 'stay' and target 'single', except Rewind (Hour Wraith), which uses target 'all' with effect {type:'dispel', target:'target'}. Effect targets follow LOGIC's model: 'self', 'allies' (the enemy side), 'target' (the attack's party targets).
- Conditions: selfHpBelow and allyHpBelow are fractions of max HP, shieldsBelow is a shield count, notStatus is a single status id string. This matches src/battle/ai.js as currently written.
- Encounters also carry `id`, `name` and `music` ('battle'|'boss'|'final'|'training'), plus `tutorial:true` on tutorial_driftling. The summit gets 5 extra regular encounters built from spire enemies, which WORLD may use or ignore.
- Journals have an extra `author` field. STORY.zoneSubtitles is an addition, and zoneTitles also includes a 'training' key.
- I read 'bosses guaranteed rare drop' as one drop with chance 1: wreck_warden gives anvil_heart, bellwether gives warding_bell, stillkeeper gives sun_fragment. PARTY decides the actual rarity. No enemy drops the three starting relics.

### Tests / verification
`node --test tests/data-*.test.mjs` passes all 41 tests across 5 files. What they cover:
- **Schema:** the 13 fixed ids, weak point ids and effects, zones and boss flags, the closed sets (types, anims, elements, statuses, effect types, effect targets), relic ids in drops, and encounter references and counts.
- **§4.8 timeline rules:** hits sorted by t; first hit at 850+ ms for melee and 600+ ms for ranged; non-feint hits at least 170 ms apart; at most one feint, never last; duration at least last t + 400.
- **Stricter choreography rules:** wind-ups never overlap the previous hit (or the 450 ms melee approach); a feint comes 400–800 ms before the next real hit; a jump hit has 300+ ms to its neighbours and a gradient hit 350+ ms.
- **Teaching order and briefs:** each zone introduces mechanics in order, the minibosses and Stillkeeper match their briefs, and there is a minimum amount of rhythm variety.
- **Story coverage:** all required dialogues, journals and hint keys; journals 60–120 words (measured 89–111); only known hint tokens; no placeholder text.
- **Timing (data-timing):** every attack is played through CORE's real DefenseTracker on story, expeditioner and veteran. A perfect player, pressing early, on time or late, avoids every hit. Counters happen exactly when an attack allows them. A dodge-only player avoids everything except jump waves. Biting a feint whiffs, but the next hit can still be defended. Every hit resolves before the action ends. I also confirmed the judge punishes a feint only 300 ms before its follow-up, so the check has teeth.
- **Balance (data-balance):** prints a table and asserts the §3.3 targets.
  - Regular enemies: average failed hit 8.9–11.2% of HP, heaviest 10–18%.
  - Bosses: heavy hits 20.5–29.8%, and 11.2, 12.0 and 13.6 estimated rounds to kill.
  - Average battle length per zone: 3.1–3.7 rounds.
  - XP: with 12 fights per zone the party is L4.94 at the Warden, L9.99 at the Bellwether and L14.98 at the Stillkeeper (10 or 14 fights land within ±1 level).
  - Glint per fight: 59 on the shore, 117 in the thicket, 264 in the spire.

I also ran a scratch simulation (not committed) using LOGIC's real BattleModel, ai.js and qte.js with PARTY's real game state, skills, items and characters. It covered all 29 non-training encounters × 3 defense success rates (0, 50%, 80%) × 30 seeds and threw zero errors. At 50% defense, regular battles took 2.1–4.6 rounds and bosses 9.1–11.4. Bosses mostly beat a player who never defends (Bellwether wins 33%, Stillkeeper 0%) and always lose to one who defends 80% of hits. After that run I raised the driftling's HP a little (330 to 380) so the tutorial lasts longer.

### Known gaps
- Balance comes from my own analytic model (the §3.3 party table, assuming about 2.0 × atk damage per party action) plus a scratch simulation against LOGIC's and PARTY's code as it stands now. Re-tune once all modules settle and tools/simulate.mjs exists. HP and atk scale linearly, so tuning is a one-number change per enemy.
- tests/data-timing.test.mjs imports CORE's src/battle/qte.js. It skips if that module fails to load, but if qte.js changes its claiming rules later it will fail, which is on purpose: it is an integration check.
- The Stillkeeper's xp, glint and drops only arrive after the final battle, so they mostly don't matter to the player.
- WORLD may not place the summit regular encounters, since the §3.7 roster lists only the boss there. They exist so the Summit map has the option.

### Notes for integrators
BATTLE / choreography:
- Each hit gives t (impact ms from action start), type, power, element, anim and windup. Play the variant's windup pose from t − windup to t, then strike. Wind-ups never overlap the previous hit, and for melee they start at or after 450 ms, after the approach.
- Delayed "gotcha" hits have windups of 700–1100 ms. Show the windup pose for the full length, holding or looping, to sell the delay.
- A feint animates like a normal swing but never resolves. Show it stopping short.
- Jump hits use anim 'wave' (ground shockwave) or 'spin' (low sweep). 'wave' and 'nova' can appear inside melee attacks; the mannequin medley has both.
- For target 'all', one defense outcome covers the whole party. 'multi' picks a target per hit (LOGIC does this).

Phase text and dialogue:
- Phase `text` values are one-line banners, e.g. 'UNWOUND — the halo shatters…'.
- Play STORY.dialogues.stillkeeper_phase2 when the Stillkeeper's phase event fires.
- Boss speaker names ('The Wreck Warden', 'The Bellwether', 'The Stillkeeper') exactly match ENEMIES[id].name, so UI can find the right portrait by matching name to look.
- Free-name NPC speakers: 'Pellam Quist' (merchant), 'Drillmaster Hesper' (trainer), 'Lamplighter', 'Cartographer', 'Apprentice'.

UI:
- Hints contain {parry} {dodge} {jump} {gradient} {qte} {confirm} tokens. Fill them with fillTokens(text, (a) => game.input.keyLabel(a)).
- STORY.zoneTitles[zone] and zoneSubtitles[zone] are plain strings for the arrival banner.
- SPEAKER_NAMES / speakerName() map the fixed speaker ids to display names; the narrator returns ''.

WORLD:
- Boss encounters: boss_wreck_warden (shore), boss_bellwether (thicket), boss_stillkeeper (summit). The dialogue pairs are warden_pre/_post, bellwether_pre/_post and stillkeeper_pre/_post.
- Optional NPC dialogues: npc_lamplighter and npc_frozen_gull (shore), npc_cartographer (thicket), npc_apprentice (spire), npc_quist_rumours (merchant, any camp).
- merchant_greet and trainer_greet read fine on repeat visits.
- encountersInZone(zone) lists regular encounters in rising-difficulty order. tutorial_driftling carries tutorial:true.

Lore to keep consistent:
- Veyra's harbour is Brinegate (PARTY's bio for Gideon). The far shore was named after it by the first crews; intro slide 6 explains this.
- The Stillkeeper is Aurèle Vantine, the horologist who built the Sun. He stopped it at twenty to seven on the evening his daughter Lise was dying.
- Journal j2 is by the engineer who built Gideon's arc-gauntlet (Expedition 52). j9 is by Maren Arden, Sable's mother (Expedition 68), and the ending pays that off.

Training: the dummy has 3000 HP and atk 8, and relies on practice=true so it never dies.

## SPRITES
**Files:** src/render/sprites.js, src/render/looks/party.js, src/render/looks/shore.js, src/render/looks/thicket.js, src/render/looks/spire.js, src/render/looks/summit.js, src/render/looks/training.js, dev/sprites.html, dev/sprites.js

### Exports
src/render/sprites.js (all per SPEC §4.10, plus additions):
- LOOK_IDS: string[16], in the order gideon, nyra, sable, driftling, shellguard, tidecaller, wreck_warden, thornstag, mime, bloomwitch, bellwether, coghound, sentinel, hourwraith, stillkeeper, dummy
- drawActor(ctx, lookId, pose): pose = {x, y (feet), scale=1, facing=1|-1, anim='idle', variant=null, p=0, t=0, flash=0, tint=null|'#hex'|{color, amount}, alpha=1, aura=null|'red'|'gold'|'gradient'|'white', broken=false, phase=0, mechanic=null, shadow=true, seed?}
- getAnchors(lookId, pose) → {head, chest, weapon, feet, top, center, tip, cast} (world {x,y}; `tip` and `cast` are extras)
- getBounds(lookId, pose) → {x, y, w, h}
- weakPointPositions(lookId, pose) → [{id, x, y, r}]
- lookHeight(lookId) → number
- renderPortrait(lookId, size=64) → HTMLCanvasElement|null (cached)
Additions: ANIM_IDS, PARTY_VARIANTS, ENEMY_VARIANTS, AURA_COLORS, portraitDataURL(lookId, size=64) → cached data URL, getLookInfo(lookId) → {id, name, kind, rig, height, weakPoints, magic}|null, isGatherVariant(lookId, variant) → bool.
looks/*.js each export one factory taking the kit object: definePartyLooks(K), defineShoreLooks(K), defineThicketLooks(K), defineSpireLooks(K), defineSummitLooks(K), defineTrainingLooks(K) → {lookId: lookDef}.
Heights: gideon 155, nyra 148, sable 152, driftling 130, shellguard 140, tidecaller 170, wreck_warden 300, thornstag 190, mime 165, bloomwitch 185, bellwether 300, coghound 120, sentinel 215, hourwraith 200, stillkeeper 380, dummy 150.

### Deviations / additions
- Weak-point radius is the base radius (12–26) × pose.scale, so it shrinks and grows with the drawn size.
- getAnchors returns two extra keys: `tip` (weapon tip, or claw/snout tip) and `cast` (where spell light gathers and projectiles should spawn: staff nib, pearl, pistol muzzle, gauntlet, heartwood, porthole, etc.).
- pose.tint also accepts {color, amount}; pose.seed (optional) sets the per-actor animation phase offset. It defaults to one derived from pose.y and the look id, so side-by-side duplicates don't breathe in sync.
- ko behaviour: enemies collapse and dissolve (alpha fades to 0 between p 0.55 and 1, with rising motes), so at p=1 an enemy draws nothing. Party members collapse to a kneeling slump and darken slightly but stay visible (revivable).
- jump: drawActor applies the vertical arc itself (airborne p 0.2–0.86, crouch before, landing squash after); the shadow stays on the ground and shrinks with height.
- Humanoid weapons obey a floor constraint (a long blade or hammer rotates so it never passes below the ground line), so a slam contact plants the weapon on the floor.
- Enemies accept party variant ids and vice versa. Unknown variants fall back through per-look aliases (e.g. flurry→thrust, heavy→slam, shoot→bolt, gradient→nova) to the look's default variant. Unknown anims fall back to idle and unknown look ids to the dummy, each with a single console.warn.

### Tests / verification
- Node smoke test (scratch, not a project test): importing sprites.js in Node touches no DOM. For all 16 looks × 16 anims × all 22 variants × p {0, 0.5, 1} × both facings, getAnchors and getBounds return finite values, and weakPointPositions returns exactly the §3.7 ids in order with r in the 12–26 × scale range. Anchors mirror exactly between facing 1 and -1, weak points sit on the body, renderPortrait returns null without a DOM, and drawActor on a mock ctx never throws, including with aura, flash, broken and mechanic set. Result: ALL OK.
- Cross-check against the other builders' data, read-only: all 13 ENEMIES[].look ids exist; every enemy hit anim, every one of the 27 SKILLS[].anim ids and the characters' basicAttack anims are supported variants.
- Headless Chrome (port 8102, dev/sprites.html): a `--dump-dom` sweep over the grid, weak, portraits, world run/walk, fx, perf and interactive modes, plus a full contact sheet for every look (all anims and variants with red aura, broken and phase 1 on), showed no errors or warnings on the page.
- Visual review: screenshotted every look's contact sheet (basic anims and the variant windup/strike sets) and large single views, and iterated. Fixes made along the way: Nyra's layout, sleeves and staff poses; Shellguard's conch helm, crab legs and pincer; Thornstag's antlers, ear and legs; the Hour Wraith's smoke; the Stillkeeper's cape, gauntlets and phase-2 glowing cracks; giants' mitts; the Bloomwitch's petal skirt; the Coghound's key; the Sentinel's delft motif; the run cycle; KO and aim weapon angles; trail opacity; and the weapon floor constraint.
- Perf (dev ?perf=1, forced flush): with GPU raster every look is 0.05–0.66 ms per actor-frame, including flash, aura and broken composites; the only outliers are first-draw warm-up (sprite-cache build and shader compile). Software raster (`--disable-gpu`) gives 0.1–1.0 ms for regular enemies, about 2 ms for the Stillkeeper, and up to about 6 ms for the Stillkeeper with an aura.

### Known gaps
- The ≤1 ms per actor budget holds with GPU canvas (normal desktop Chrome). On a pure software rasterizer the three bosses cost 1–3 ms, and an aura composite on the Stillkeeper about 6 ms.
- Portraits are cached per size and never re-rendered. They always show the idle pose with no mechanic, and the Stillkeeper portrait shows phase 0.
- The 'spin' variant uses a 2D paper-flip (horizontal scale 1→-1→1) plus a swoosh arc. During the flip frames the weapon trail is suppressed and light direction isn't perfectly consistent.
- The Thornstag and Coghound use a shared quadruper rig, so knee/hock proportions are stylised rather than anatomical.
- The Hour Wraith's smoke and Nyra's glyph orbit are drawn fresh every frame (soft sprite blits, not cached), which is cheap but grows with glyph count.
- The ko anim for the enemy Driftling and the dummy tips or sinks the whole figure rather than posing limbs, which is intentional for those rigs.

### Notes for integrators
Coordinates and facing: pose.x/y is the feet (ground) point. Party members face right (facing 1). Draw enemies with facing -1; everything, including anchors, bounds and weak points, mirrors correctly. Use pose.scale for world maps (0.45) and big bosses at 1; lookHeight is at scale 1.

Timing contract:
- windup p goes 0→1 and ends exactly at contact. Anticipation is reached by about p 0.42, held with a tremble until 0.86, then snaps to contact, so map p = elapsed / hit.windup.
- strike p=0 is the contact pose, then follow-through to 1. recover blends from follow-through back to idle.
- hurt: p=0 is already recoiled (pair it with pose.flash). dodge peaks at about p 0.26 with an afterimage and speed lines. parry flashes the weapon at p 0.05–0.35 (about 400 ms total works well). jump airborne p 0.2–0.86. cast releases at p 0.8. shoot recoils at p=0.
- run/walk loop on pose.t (period 560 / 980 ms); p adds a phase offset.
- Loops that never finish (idle, aim, guard, victory) should just keep passing t.

Gathering variants (cast, bolt, beam, nova, wave, buff, heal, gradient, party shoot) glow at anchors.cast during windup and flash on release. Spawn projectiles/beams from getAnchors(...).cast at strike p=0; isGatherVariant() tells you which variants gather.

Effects placement: anchors.weapon is the blade focal point (hit sparks, parry clang); anchors.tip is the weapon or claw tip; chest and center are good for damage numbers and status icons; top is above the head or halo.

Telegraphs: set pose.aura per hit type during an enemy windup: 'white' normal, 'red' unparryable, 'gold' jump (adds a ground ripple), 'gradient' gradient attack. Aura draws a glowing silhouette outline plus weapon/chest glows.

Other pose inputs:
- tint (e.g. '#9fd9f0' for chill/frozen) and alpha go through the same offscreen composite.
- broken: true adds glowing cracks, dazed stars and a slump. Pass it while the enemy is Broken.
- phase: pass 1 for the Stillkeeper after its phase event (shattered orbiting halo shards, white-gold cracks).
- mechanic: pass the model's mechanic object as-is. {type:'surge', value} makes the gauntlet glow and arc more; {type:'glyphs', list} orbits up to 4 glyph runes; {type:'stance', value} tints Sable's plume and blade (assault ember, guard blue, virtuoso gold with sparkles).

KO: enemies fully vanish at ko p=1 (dissolve); party members stay kneeling. Stop drawing KO'd enemies after the anim, or keep p=1 and nothing is drawn.

Free aim: getBounds is the torso/head body box and excludes weapons; weakPointPositions follows animated parts (the Bellwether's clapper swings, the Hour Wraith's pendulum swings, and the phase-2 Stillkeeper halo point orbits), so query it every frame.

HUD: renderPortrait(id, size) returns a cached size×size canvas (party face right, enemies face left); use portraitDataURL for <img> tags. Request 2× size for hi-DPI.

Module import never touches the DOM. Drawing never throws: failures are warned once and skipped.

Dev page: dev/sprites.html with ?look=id&anim=&variant=&p=&t=&scale=&facing=&aura=&flash=&tint=&broken=1&phase=1&mech=; ?sheet=id[&set=basic|party|enemy|all][&vars=a,b][&recover=1][&cell=]; ?portraits=1; ?weak=1; ?world=1[&anim=walk]; ?fx=1; ?perf=1; &play=1 for keyboard scrubbing (arrows, V, N, Space, F, A, B, H, W, M, P). Errors render in red at the top of the page.

## FX
**Files:** src/render/effects.js, src/render/backgrounds.js, src/render/icons.js, dev/effects.html, dev/effects.js

### Exports
effects.js:
- class Effects({reducedFlashing=false, screenShake=true}). Mutable props: reducedFlashing, shakeEnabled, autoDesaturate(false).
  - update(dt, screenDt=dt); render(ctx) [world space]; renderScreen(ctx) [stage space]; clear(); getters particleCount, active.
  - burst(x,y,kind,{scale=1,color,angle,dir:±1,perfect}). Kinds: hit crit parry perfect dodge jump heal buff debuff fire ice lightning earth light dark physical break ko gradient shield counter land, plus perfectDodge glyph surge.
  - sparks(x,y,{color,count=12,speed=300,spread=2π,angle=0,life=450,gravity=600,width=4})
  - number(x,y,value,{kind:'damage'|'crit'|'heal'|'ap'|'block'|'text', affinity:'weak'|'resist'|'immune'|null, color, size})
  - text(x,y,str,{color,size=28,life=900,rise=40,font,stroke=true}) — font may be a family list or a full CSS font string.
  - ring(x,y,{r0=10,r1=80,life=400,color='#fff',width=4,squash=1,delay=0,alpha=1})
  - slash(x,y,{angle=0,length=140,color='#fff',life=220,width=10,curve=0.4,flip=false,delay=0})
  - line(x0,y0,x1,y1,{color,width=3,life=160,jagged=0,delay=0})
  - shockwave(x,y,{toX=x-600,speed=800,duration,color=jump gold,life,height=58,onArrive({x,y})})
  - projectile({from,to,duration=420,kind:'bolt'|'thorn'|'orb'|'glyph'|'bullet',color,arc=0,onArrive({x,y,kind}),impact=false,size=1}) → {cancel()}
  - screenFlash(color='#fff',life=160,alpha=0.6); shake(intensity=6,life=180); shakeOffset()→{x,y}; vignette(color,life=600,alpha=0.5)
  - desaturate(amount=1,life=0) — life>0 is a self-releasing pulse, life≤0 a persistent level; get desaturation → 0..1
  - banner(text,{sub,color=gold,life=1400,style:'impact'|'title'|'caption',y,size,slot})
- BURST_KINDS, PROJECTILE_KINDS
- drawQteRing(ctx,x,y,{progress,radius=90,color='#fff',label='',rating=null,t=0,ratingAge=160,alpha=1})
- drawDefenseCue(ctx,x,y,{progress,type,label,t,radius=70,alpha=1,groundY})
- drawTargetMarker(ctx,x,y,{t,color=gold,scale=1,alpha=1})
- drawEnemyBars(ctx,x,y,{hp,maxHp,breakValue,breakMax,shields,broken,statuses,name,width=140,id,t,boss,alpha,ghostHp}) → {w,h}; resetEnemyBars()
- applyDesaturation(ctx,amount,{x,y,w,h,tint})

backgrounds.js:
- drawBattleBackground(ctx,zoneId,t=0,{camera:{x,y,zoom},phase})
- drawTitleBackground(ctx,t=0,{parallax:{x,y}})
- prepareBattleBackground(zoneId,{phase,scale}); prepareTitleBackground({scale})
- clearBackgroundCache(); setBackgroundQuality({maxScale=1.5}); backgroundMemory()→bytes; backgroundBuildTime(zoneId,{phase,scale})
- BATTLE_ZONES, FLOOR_BAND={top:360,bottom:640}

icons.js:
- statusIcon(id,size=20), elementIcon(el,size=20), itemIcon(id,size=20), mechanicIcon(key,size=20) → cached dataURL ('' outside a browser)
- iconCanvas(kind:'status'|'element'|'item'|'mechanic', id, size=20) → HTMLCanvasElement|null
- clearIconCache()
- STATUS_ICON_IDS (12), POSITIVE_STATUSES, ELEMENT_ICON_IDS (7), ITEM_ICON_IDS (tincture, tonic, draught, tincture_shard, tonic_shard, draught_shard, shard), MECHANIC_ICON_KEYS (15)

### Deviations / additions
- No spec'd names or signatures were changed. Everything below is an addition.
- Effects.update(dt, screenDt=dt): the optional second dt drives screen-space effects (flash, shake, vignette, banners, desaturation), so BATTLE's hit-stop can freeze world particles while banners and flashes keep animating.
- Effects constructor also accepts screenShake (it sets shakeEnabled). Properties reducedFlashing, shakeEnabled and autoDesaturate can be changed at runtime. If autoDesaturate is true, renderScreen applies the desaturation itself before drawing flashes and banners.
- Added burst kinds perfectDodge, glyph and surge. dodge with opts.perfect=true plays the cool-blue perfect-dodge afterimage. opts.dir (±1) sets the direction of the attack for hit/crit/parry/counter sparks, and the direction the dodger moves for dodge/perfectDodge. opts.angle overrides dir.
- Extra options: ring gets squash (ground ripples), delay and alpha. slash gets flip and delay. line gets jagged (lightning) and delay. shockwave gets duration (overrides speed), height and onArrive. projectile gets impact (a burst kind to play on arrival) and size, and returns a {cancel()} handle. number gets size.
- banner() also accepts style ('impact' default at y≈196, 'title' big at y≈300 for VICTORY, 'caption' small at y≈84 for attack names), y, size and slot. A new banner sends the previous banner in the same slot into its exit animation.
- drawEnemyBars: (x, y) is the TOP-CENTRE of the block, and it returns {w, h}. The delayed ghost chip is tracked internally, keyed by opts.id (falls back to name). Optional t (ms clock), boss (wider, ornate), alpha, and ghostHp (explicit override). resetEnemyBars() clears the ghost memory.
- drawQteRing adds ratingAge (ms since the rating, flourish lasts ~520 ms) and alpha. drawDefenseCue adds radius, alpha and groundY (where the jump cue's floor ripple is drawn). type 'feint', or any unknown type, draws as normal.
- applyDesaturation(ctx, amount, {tint}) helper: uses the 'saturation' blend mode, no ctx.filter needed.
- Backgrounds: camera is treated as a pan offset in px from the neutral framing {x:0, y:0, zoom:1}. Each layer shifts by camera × depth (0.015–0.34), clamped to the 64/40 px overscan. zoom > 1 scales the layers slightly around the stage centre.
- Backgrounds: opts.phase can be fractional. Summit with 0 < phase < 1 cross-fades phase 1 to phase 2; phase ≥ 1 gives the Unwound variant. Other zones ignore phase.
- Backgrounds: layers are painted at min(canvas.width/1280, 1.5) pixels per logical px by default (roughly half the memory of 2x; it reads as slight depth of field behind crisp sprites). setBackgroundQuality({maxScale}) changes this. At most 2 scenes are cached.
- Background additions: prepareBattleBackground / prepareTitleBackground (pre-warm during a fade), clearBackgroundCache, backgroundMemory, backgroundBuildTime, BATTLE_ZONES, FLOOR_BAND, and drawTitleBackground's optional parallax.
- Icon dataURLs are SVG documents wrapping a 3× supersampled PNG, so the image's intrinsic size is exactly `size` CSS px but stays crisp on scaled or retina stages. iconCanvas() gives canvas users the bitmap directly (drawEnemyBars uses it for status icons). Unknown ids draw a '?' badge and warn once.
- Icon shapes are colour-blind friendly: positive statuses use round badges, negative statuses square badges, items hexagons.

### Tests / verification
Node: all three modules import with no DOM access at import time. A smoke run spawned every burst kind plus crit/undefined numbers, banners, a shockwave and a projectile, then ran 100 updates with no exceptions. Reduced flashing clamps as specified (alpha 0.15, life ≥ 380 ms, soft envelope). `node --check` passes on all five files. The spec gives FX no pure-test requirement and tests/ is not mine, so there is no test file.

Headless Chrome (fresh profile per run, port 8103) screenshots, all reviewed and iterated:
- every battle background (shore, thicket, spire, summit, summit phase 1, summit phase 0.5 cross-fade, training) and the title key art
- the shore with stand-in actors and the floor-band guide (actors read cleanly against the floor)
- the icon sheet: canvas bitmaps at 44 px plus DOM <img> dataURLs at 20 and 32 px, all rendering
- the cue sheet: QTE rings at 4 progress values plus perfect/good/miss; all 4 defense cue shapes at 2 progress values; target markers; enemy bars (shields, ghost chip, hot break, broken, boss, >6 shields collapsing to one pip plus a count)
- the composed demo on spire and on thicket (parry starburst, PARRY brush banner, caption, crit with WEAK tag, RESIST, BLOCKED, heal, +1 AP, slash, orb projectile, jump shockwave, QTE ring, jump cue, enemy bars)
- the burst gallery at 140 and 350 ms
- the banner gallery (impact, title and caption styles)
- zoomed captures at dpr=2 to inspect detail

Real Chrome (browser pane): clicked all 62 interactive buttons and all toggles programmatically; zero errors or warnings.

Performance, real GPU Chrome: about 600 live particles cost ≈0.6 ms per frame for effects update+render (JS time); backgrounds cost ≈0.08–0.15 ms per frame; layer builds take 9–35 ms at 2x. Headless software raster (pessimistic): effects 0.25 ms, background 2.5 ms per frame. Background memory per zone is 18–26 MB at a 2x backing store with the default 1.5 cap. Screenshots are in the scratchpad fx/ folder (bg_*.png, title.png, icons.png, cues.png, demo.png, bursts.png, banners.png, actors_shore.png).

### Known gaps
- Only the summit has a phase-2 variant; the other zones ignore opts.phase.
- During a summit phase cross-fade (0 < phase < 1), the whole phase-2 scene is blended over phase 1. Some phase-2 sky elements (orbiting halo shards) briefly show at partial opacity over the phase-1 platform until phase reaches 1.
- Camera parallax offsets are clamped to the overscan (64 px horizontal, 40 px vertical). Very large pans or zoom < 1 are not supported: zoom is clamped to ≥ 1 for layers.
- The clock numerals baked into the sun/dial layers use a fallback serif if Cinzel isn't loaded yet at bake time. The cache re-bakes automatically on document.fonts 'loadingdone'.
- The `dark` burst is deliberately an implosion then release: its ring and sparks come ~260 ms after the call, while the converging motes start immediately.
- Headless Chrome with --screenshot and --virtual-time-budget writes the PNG but does not exit while a page keeps a rAF loop alive. My capture script waits for the PNG and then kills that Chrome. Other builders' capture scripts will hit the same thing on any live page.
- The dev page uses stand-in silhouettes for actors; it does not import sprites.js.

### Notes for integrators
Frame recipe for BATTLE:
1. Create `fx = new Effects({reducedFlashing: settings.reducedFlashing, screenShake: settings.screenShake})`. Update fx.reducedFlashing / fx.shakeEnabled when settings change.
2. Each frame call `fx.update(dtScaledByHitstop, realDt)`.
3. Render in this order:
   - `drawBattleBackground(ctx, zone, game.time, {camera, phase})` in STAGE space, before your camera transform. camera = {x, y, zoom} as a pan offset from {0,0,1}.
   - Apply the camera plus `fx.shakeOffset()`.
   - Draw actors, then cues, target markers and enemy bars.
   - `fx.render(ctx)`.
   - Restore to stage space.
   - `applyDesaturation(ctx, fx.desaturation, {tint: PALETTE.violet})`, or set `fx.autoDesaturate = true` instead.
   - `fx.renderScreen(ctx)` for flashes, vignettes and banners.
4. During the battle transition, call `prepareBattleBackground(zone, {scale: canvas.width / 1280})`. If the Stillkeeper phase change should cross-fade, also prepare `{phase: 1}` and animate opts.phase 0→1.

Defense QTE:
- `drawDefenseCue(ctx, chest.x, chest.y, {progress: 1 - (T - now) / lead, type: hit.type, label: input.keyLabel(action), t, groundY: feet.y})`. lead ≈ the hit's windup. progress continues past 1 (up to 1.25) for the impact flare.
- Jump hits: `fx.shockwave(enemyFeet.x, partyFeet.y, {toX: target.x, duration: T - now, onArrive})`.
- Outcome mapping:
  - parry: `burst('parry', {dir: -1})`, `banner('Parry', {sub})`, optionally screenFlash(PALETTE.paleGold, 120, 0.25)
  - perfect dodge: `burst('dodge', {perfect: true, dir: -1})`
  - dodge: `burst('dodge', {dir: -1})`
  - jump: `burst('jump')`, then `burst('land')` when landing
  - gradient counter: `burst('gradient')` + `banner('Counter!', {color: PALETTE.violet})`
  - gradient attack wind-up: `desaturate(0.85, windupMs + 400)` + `vignette(PALETTE.violet, ...)`
  - unavoided hit: `burst('hit')`, then `shake(6, 180)` (heavy: 10) + `vignette(PALETTE.crimson, 500, 0.45)`

Offense:
- `drawQteRing(ctx, target.chest.x, target.chest.y, {progress: 1 - (T - now) / lead, label, t})`. After judging, keep drawing with `{rating, ratingAge: now - judgedAt}` for ~520 ms.
- Damage events: `fx.number(x, headY, e.amount, {kind: e.crit ? 'crit' : 'damage', affinity: e.affinity, color: ELEMENT_COLORS[e.element]})`, plus `burst(e.crit ? 'crit' : e.element || 'hit', {dir: 1})`.
- Other events:
  - blocked: `number(x, y, 'BLOCKED', {kind: 'block'})` + `burst('shield')`
  - heal: `number(x, y, amount, {kind: 'heal'})` + `burst('heal')`
  - AP: `number(x, y, delta, {kind: 'ap'})`
  - status: `burst('buff' / 'debuff')`
  - broken: `burst('break')` + `banner('Break!', {color: PALETTE.breakBar})` + `shake(12, 300)`
  - ko: `burst('ko', {color: enemyTint})`
  - counter: `burst('counter', {dir})` + `banner('Counter!', {color: PALETTE.crimson})`
  - attack names: `banner(name, {style: 'caption'})` (it has its own slot and won't knock out impact banners)
  - victory: `banner('Victory', {style: 'title', life: 2600})`

Placement:
- Stacked numbers at the same spot automatically lift above each other.
- Projectiles: `fx.projectile({from, to, duration: T - now, kind, arc, onArrive})`, which is timed to land on T.
- drawEnemyBars: ALWAYS pass `id: combatant.id` and `t: game.time`. The ghost chip memory is keyed by id and falls back to name, so two same-named enemies would otherwise share it. (x, y) is the top-centre; the block is ~36 px tall (~56 with statuses; boss is larger). Use width ≈ 140 for regular enemies and `boss: true, width: 300` for bosses.
- drawTargetMarker: its tip points at (x, y); place it ~10 px above the head.
- Keep actors inside FLOOR_BAND (y 360–640). Every background keeps that band low-contrast.

Title and HUD:
- Title: `drawTitleBackground(ctx, t, {parallax: {x: (pointer.x - 640) / 32, y: (pointer.y - 360) / 32}})`. The Clockwork Sun sits at (640, 282) with r = 168, the needle spire under it, and the ship at lower left. A logo reads best over the upper-middle sky or across the bottom third.
- DOM HUD: `<img src="${statusIcon(id, 20)}">` has an intrinsic size of 20×20 and stays crisp when the stage is scaled.

Dev page URLs (serve the project root):
- `dev/effects.html?bg=<zone>[&phase=1|0.5][&cam=x,y,zoom][&guide=1][&actors=1]`
- `?title=1`
- `?demo=1[&zone=spire][&at=880]`
- `?icons=1[&domimg=svg|png|none]`
- `?cues=1[&bg=zone]`
- `?bursts=1[&at=ms]`
- `?banners=1`
- `?perf=1[&zone=]`
- Extras: `&dpr=2&zoom=2&zx=&zy=` for close-ups, `&reduced=1`, `&stats=1`.
- The page shows JS errors and console.warn output in a red overlay, and exposes `window.__fx`.

## AUDIO
**Files:** src/core/audio.js, dev/audio.html, dev/audio.js

### Exports
Spec (§4.4), exactly as specified: SFX (51 names), TRACKS (12 names), class Audio { constructor(); unlock(); suspend(); resumeCtx(); setVolumes({master,sfx,music}); play(name,{pitch=1,volume=1,pan=0}={}) -> {name, stop(fadeMs)}|null; playMusic(track,{fade=800, loop}={}); stopMusic({fade=600}={}); get currentTrack }.
Added on Audio: getters available/unlocked/context; getVolumes(); duck(level, secs).
Added module exports:
- SFX_INFO {name:{cat, sharp, duck}}
- SFX_SYNTHS {name:(ctx, destinationNode, when, {pitch, reverb, rng, stats}) -> seconds} (frozen; each synth works in an OfflineAudioContext)
- SFX_LEVELS (per-SFX output trims)
- TRACK_DEFS {name:{bpm, beats, sub, chords, loop, gain, tail?, step(s,P)}}
- INSTRUMENTS {name:{poly, rv, fn(kit, midi, dur, vel)}}
- class MusicPlayer (look-ahead sequencer: start / tick / scheduleUntil / gc / note / chord / melody / drum / fadeTo / stop / disconnect)
- class Kit (layer builder: tone / noise / fm / metal / ring / click / bus / env)
- createReverb(ctx, opts) -> {input, output, disconnect}
- noiseBuffer(ctx), makeRng(seed), mtof, noteToMidi, parseChord, rootOf, bassOf, degree, voicing, parseSeq, hasWebAudio
- async renderSfx(name, {sampleRate, pitch, reverb, seed}) -> {buffer, declared, nodes}
- async renderTrack(name, seconds, {sampleRate, loop}) -> {buffer, notes, nodes, steps}
dev/audio.js also exports measure(buffer) -> {peak, rms, duration, attack, onset, silent}.

### Deviations / additions
- playMusic's `loop` option has no fixed default: when omitted it follows the track's own nature (false for 'victory' and 'gameover', true for all others). Passing loop explicitly always overrides. When a one-shot finishes, currentTrack becomes null.
- The AudioContext is created on the first unlock() (user gesture), not in the constructor, so browsers raise no autoplay warnings. The constructor also adds its own capture-phase pointerdown/keydown/touchend/mousedown listeners that call unlock() until the context is running, so audio still unlocks if main.js forgets to wire it. playMusic() called before unlock is stored as pending: currentTrack reports it and it starts on unlock.
- play() merges identical SFX triggered within 30 ms of each other (for AoE hits firing the same frame) and caps voices at 4 per name and 32 total, stealing the oldest. Dedupe and caps use wall-clock time, because some devices only update AudioContext.currentTime in coarse steps.
- Volume sliders map to gain as v squared, for a perceptually even slider. The music bus also has a 0.75 trim, and a DynamicsCompressor limiter sits on the master bus.
- Reverb: the task asked for a feedback delay network. I first built a cross-coupled Householder FDN, but it rendered differently run to run and sometimes went unstable: Chrome breaks graph cycles by inserting a one-render-quantum lag wherever its pull order happens to cut the loop, which makes a mixing matrix non-lossless. The shipped reverb is a diagonal FDN instead: 8 feed-forward early-reflection taps into 8 parallel damped comb loops, which stays stable whatever lag is inserted. It is still convolution-free and renders identically every time (verified).
- Some SFX duck the music briefly (encounter, gradient_counter, break, phase, level_up, victory, defeat, gradient_skill). Levels are in SFX_INFO[name].duck.
- The spec asked for a self-test at ?selftest=1. I added a live-facade section to it (on by default, skip with &live=0) that exercises the real Audio class on a running context.

### Tests / verification
Headless Chrome via the CORE harness (tools/cdp.mjs, which launches with --autoplay-policy=no-user-gesture-required) against a server on port 8104. The plain --virtual-time-budget screenshot command stalls on OfflineAudioContext rendering, so I drove the page over CDP instead.

?selftest=1 result: PASS. 51 SFX, 12 tracks, 0 failures, 0 warnings, 25/25 live checks passed, about 1.7 s. This run was clean 5 times in a row after the fixes; before the wall-clock change, one early run had 3 intermittent live-check failures.

- **Every SFX, rendered offline through the reverb:** none silent, none clipping. Loudest is gradient_counter at 0.896; before trimming, 7 SFX went up to 1.76. Combat hits peak 0.70–0.90, parry 0.87, UI sounds 0.13–0.26.
- **Attack:** every sharp combat, element and defense SFX reaches half its peak within 5 ms. Worst is shot at 3.13 ms; parry 0.34, hit 0.52, qte_perfect 0.36, dodge 1.38, jump 0.68. Slow attacks only appear on non-combat sounds where they're intended: telegraph_gradient 510 ms (reverse swell), chest 200 ms, flag 101 ms, menu_open 31 ms.
- **Duration to −60 dBFS:** 0.04 s (ui_move) to about 1.6 s (phase/flag); parry 1.21 s.
- **Music smoke test (2.5 s offline, incremental scheduling):** every track creates notes (7–74) and none is silent or clipping.
- **Live facade checks:** pending track before unlock, context running, pending track starts on unlock, sound in the unlocking gesture is kept, same track is a no-op, all 51 SFX play, dedupe, unknown name returns null and warns once, per-name and global voice caps, stoppable handle, crossfade switches track, new track fades in (gain 0.32 midway, 1.00 at end), previous track stops, scheduler keeps creating notes, finished voices are collected, partial setVolumes, suspend/resume, play() silent while suspended, victory is one-shot and ends with currentTrack null, explicit loop override, stopMusic clears the track.
- **Node:** importing and calling every method without WebAudio is a silent no-op (unknown names warn once). A mock-AudioContext script ran every SFX synth and scheduled two full loops of every track with no NaN/Inf automation values and no errors.
- **Longer offline renders (20–30 s):** loudness is balanced at about −25 to −29 dB RMS for exploration tracks and −22/−23 dB for battle/boss, with peaks ≤ 0.66. Offline cost is flat over duration: battle ~19 ms per second of audio (about 2% of a core), boss ~33, title ~15. Before I added voice collection, battle's cost grew from 34 to 276 ms/s as renders got longer.
- **Screenshots checked by eye:** the self-test tables with waveform thumbnails, and the interactive bench showing the inspector after a parry click with the title track playing.

### Known gaps
- Nobody has actually listened to the sounds. Sound design was judged from the metering (peak, RMS, attack, duration, waveforms) and from the synthesis design, so taste-level balance between SFX and music may need a pass by ear in the real game.
- The live-facade checks need a running AudioContext. In a normal headless run without the autoplay flag they report 'skip' (shown as a warning), not a failure.
- The dev page's plain --virtual-time-budget screenshot stalls on OfflineAudioContext rendering in headless Chrome. Use tools/cdp.mjs (real time) and wait for window.__selftest.done.
- Music CPU was measured with offline renders. Real-time audio-thread cost should be similar (about 1–3% of a core) but wasn't profiled on low-end devices.

### Notes for integrators
- **main.js:** create `game.audio = new Audio()`, then call `audio.setVolumes({ master: settings.masterVolume, sfx: settings.sfxVolume, music: settings.musicVolume })` on boot and whenever settings change. Wiring unlock() to pointerdown/keydown is still recommended; it is harmless and idempotent. The engine should call `audio.suspend()` when the page is hidden and `audio.resumeCtx()` when it becomes visible again.
- **Music:** `playMusic(ZONES[zone].music)` on zone entry, `playMusic('battle' | 'boss' | 'final', { fade: 400 })` on battle start, and `playMusic('victory')` or `playMusic('gameover')` as one-shots (they end by themselves and currentTrack becomes null). Resume zone music after the results panel. Calling playMusic with the track that's already playing is a no-op, so it's safe to call every frame.
- **Timing-critical SFX:** play them on the frame the event resolves; they start at `ctx.currentTime` with an attack under 5 ms.
  - Suggested defense mapping: `parry` / `dodge` / `perfect_dodge` / `jump` (on press), `land` (on touchdown), `gradient_counter`, `counter`, `block`, `hurt` + `hit` on an unavoided hit.
  - Telegraphs at wind-up start, not at impact: `telegraph` (normal), `telegraph_red` (unparryable), `telegraph_gold` (jump), `telegraph_gradient`. The gradient telegraph swells for about 0.6 s and cuts off sharply, so starting it about 600 ms before T peaks it at impact.
  - Offense: `qte_perfect` / `qte_good` / `qte_miss` on the rating, `hit` / `hit_heavy` / `crit` on damage, the element SFX (`fire`, `ice`, `lightning`, `earth`, `light`, `dark`) layered on elemental hits, `break` on broken, `shield_restore` on shields, `shot` for Free Aim, `whiff` on a missed press.
  - World: `swing`, `step` (try pitch 0.9–1.1 with volume 0.4–0.6), `encounter` at battle transition, `chest`, `flag`, `coin`, `level_up`.
- **play() options:** `pan` takes -1..1 (for example (x − 640) / 640 × 0.6 for stage position), and `pitch` gives variety (for example 0.95–1.05 on hits).
- **Stacking:** the same SFX name within 30 ms is merged, so AoE hits can call play() per target safely. Different names layer freely.
- **Handles:** play() returns `{ stop(fadeMs) }` or null; treat null as normal (locked, suspended or merged).
- **Adding a track:** add it to TRACK_DEFS with its chord string and a step(s, P) function. Melodies use the parseSeq notation, for example `'a4:3 b4 c5:2 | ...'` (`note:len`, `.` rest, `-` tie, `+` chord), measured in steps.

## INTEGRATION (stage 3)
All stage-2 modules were wired together and verified end to end with `tools/e2e.mjs` (see README → Testing).

### Fixes to stage-1 / stage-2 code
- **src/core/input.js**: Escape is now `preventDefault`-ed (its browser default was halving the frame rate and stalling long headless sessions). `virtualPress(action, source, t)` takes an optional event timestamp, which the battle's touch buttons now pass. The new `anyKeyPressed()` covers "press any key" gates, including unbound keys. Tests were added to `tests/core-input.test.mjs`.
- **src/ui/widgets.js**: hover focus in `MenuList`, and mouse tooltips, now follow only real pointer movement. Before this, Chrome re-dispatched hover when a dialog opened under a resting cursor, so opening the difficulty picker from the keyboard silently focused *Veteran* and a stale tooltip covered the Party tab. The any-key gate uses `input.anyKeyPressed()`.
- **src/world/worldScene.js**: `exit()` saves the party position only into the GameState it was playing. Before this, *Rise Again* on the game-over screen loaded the journal and then had the old world overwrite it with the spot where the party fell. The zone title card now fades soon after a dialogue or menu covers the world.
- **src/battle/battleScene.js**: added `debugWin()`, which ends the model and releases whatever the turn loop is waiting on, so `game.debug.winBattle()` works mid-menu. The opt-in `autopilot.dialogues` keeps the Stillkeeper's phase-2 dialogue during `commands:'auto'` runs. The shared UI toast host is no longer hidden under the battle.
- **src/battle/hud.js**: the command menu is anchored above the party cards, so the 7-entry practice menu no longer overlaps them.
- **src/data/shops.js**: the shore keeper is now Pellam Quist, the merchant who greets you in `merchant_greet`.
- **Balance (src/data/enemies.js, tests/data-balance.test.mjs, tools/simulate.mjs)**: boss HP was about doubled, following the stage-1 advice. The Wreck Warden went from 2900 to 5900, the Bellwether from 4700 to 9600 and the Stillkeeper from 6600 to 13400. In the real battle model the bosses had fallen in about 5.5 rounds, against the §3.3 target of 8–15. They now take about 9 rounds for the default bot and 11–13.5 for a novice bot, which still wins 100% of the time. The analytic rounds-to-kill estimate predicted twice the real length for bosses, because it ignores gradient skills, counters, breaks and QTE multipliers. So the boss-length assertion now simulates the real engine; `buildPartyFromGameState` is exported for this. Regular enemies are unchanged.
- **src/main.js**: added `debug.healParty(fraction)` and pass-through of `autopilot.dialogues`. The runtime favicon hack is gone.
- **index.html / favicon.svg / styles.css**: a real favicon for the game and the dev pages. A "turn your device sideways" hint now sits in the empty band under the letterboxed stage on portrait phones.
- **styles.css**: the focused "Undiscovered page" row in the Journal is now readable, with ink text on the gold stroke.
- **dev/battle.js**: removed the local Escape workaround, which is now fixed in input.js.

## QA FIXES (stage 4)
A QA pass filed findings in five buckets (FEEL, HUD, WORLD, UI, DATA); each bucket fixed its own files in parallel
against the cross-bucket contracts below, then an integration pass verified the whole tree. Display text follows
the SPEC's display-name glossary (Prism, Bravura, Expedition Pennant, Gilded Harlequin; British spelling); ids, keys,
classes, events and function names keep the original names (`gradient`, `virtuoso`, `flag`, `mime`).

### Cross-bucket contracts (all verified in the integrated tree)
- **Whiff lockout:** `hud.setDefenseLockout(untilMs, action)` (hud.js) greys the touch defence buttons, puts a red ✕
  on the one that whiffed and shows "Locked — wait". battleScene calls it on every defence whiff with the
  `performance.now()` deadline and re-sends it when hit-stop stretches the lockout.
- **Touch Back / Pause:** the HUD's Back (skill / item / Prism list, target panel), Done (Free Aim) and round Pause
  controls, and the world's Menu button, all go through `game.input.virtualPress('cancel' | 'menu', source, event.timeStamp)`
  plus `virtualRelease`. battleScene handles 'cancel' / 'menu' at every menu level and in Free Aim.
- **NPC portraits:** `npcPortrait(speakerName, size = 96)` in src/world/npcPortraits.js paints busts of the named NPCs,
  merchants and ghosts (null for unknown names). dialogue.js and shopScene.js import it lazily and fall back to the
  monogram.
- **Play time:** `installPlayClock(game)` in main.js is the only accumulator of `state.stats.playTimeMs`. It counts
  real frame time in every scene while the tab is visible and a game is loaded (never on the title), with each frame
  gap capped at 1 s. worldScene no longer adds play time.
- **Summit spawns:** `summit_e1` (summit_honor_guard) and `summit_e2` (summit_vigil) sit on the approach to the
  Stillkeeper. DATA's XP and economy tuning, and the data-balance test, count them.
- **Veteran:** qte.js `DIFFICULTY` gains `bossSpdMult`, `bossDmgMult` and `postBattleRecovery`. Veteran is now
  windows ×0.65, damage taken ×1.3, bosses ×1.6 damage and ×1.5 speed, and 0 recovery. `summary.difficulty` reaches
  `applyBattleResult`, which skips the 20% post-battle recovery on Veteran (`postBattleRecoveryFor`).
- **Combat text lanes:** effects.js lays floating numbers and texts out in lanes automatically. `opts.anchorId` on
  `number()` / `text()` stacks one combatant's texts into a column, and enemy bars fade while text covers them.

### FEEL (battleScene, choreo, freeAim, engine, audio, dev/battle)
- **Softlocks and touch:**
  - Skills is disabled, with its reason, when nothing is usable.
  - 'menu' opens pause from the list, target and Free Aim levels.
  - Free Aim taps only fire on an enemy body or weak point.
  - Touch help lines use tap wording.
- **Hidden tab:**
  - The battle clock freezes while the page is hidden.
  - The watchdogs count battle time.
  - A genuine enemy stall voids the remaining hits instead of landing them. A party stall lands the remaining hits
    unrated.
  - engine.js records `hiddenAt` and `hiddenTotal`, and the 'visibility' event carries `{at, hiddenMs}`.
- **Cues and rings:**
  - Cues are sorted with the hit about to land drawn on top. Only the primary cue is labelled.
  - Feints show a normal cue that shatters at T−250.
  - Every QTE ring uses one 480 ms lead (`QTE_RING_LEAD`).
- **Feedback:**
  - Whiff lockout feedback is always on: the 'Too early / Too late / Feint — locked' text, a draining ring, dimmed cues
    and a soft SFX.
  - Late presses are signed against the nearest hit.
  - Wrong moves get 'Can't parry — Dodge!'-style text.
- **Animation and timing:**
  - Melee contact geometry: the weapon tip bites 6–9 px into the target at T. Bystanders step aside or fade.
  - The Prism telegraph swell peaks at impact.
  - Wind-ups never start before the previous release.
  - Hit-stop ends exactly on time, with short variants inside rhythms.
  - Contact flashes play at T even before a hit is rated.
  - A Free Aim shot that crosses a phase threshold defers the phase banner and dialogue until the shot ends.
  - `_planForced` narrows the phase pools too.
  - Status, stance and skip texts use live anchors.

### HUD (hud, effects, icons, backgrounds, looks/thicket, dev/effects, dev/sprites)
- **Compact phone layout:** when `game.scale < 0.75` the HUD switches to the compact layout: 44 px menu cells, 40 px
  list rows, a details pane, and 68 px defence buttons in thumb clusters. Text is at least 11 CSS px.
- **Touch controls:** the touch Back, Done and Pause controls, a Confirm button in the target panel, and
  tap-anywhere to dismiss hints and results.
- **Combat text lanes:** automatic lanes, one column per combatant, enemy bars that fade under text, and rating-word
  slots.
- **Results:** level-ups fill the bar, flash, stamp a 'LEVEL n' ribbon and carry on. `setResultsProgress(u)` now
  returns `{leveled}`.
- **Prism and widgets:**
  - A 'Prism ready' callout and glow. Menu counters read 'N usable', 'N left' and 'N ready'.
  - New Surge, Glyph and Bravura stance widgets.
  - Legend rows show cue-shape icons (icons.js `cueIcon`).
- **Skill details:** descriptions split into rules and flavour (`splitSkillDesc`), with the disabled reason first.
- **Visual fixes:**
  - The gauge and legend no longer overlap.
  - The title ship sprite is padded, so its smoke plume is no longer clipped.
- **Background cache:** the battle background cache is keyed by zone and phase. A resize repaints at a calm moment
  (`flushBackgroundRebuilds`) instead of hitching mid-battle.

### WORLD (worldScene, worldRender, entities, tilemap, npcPortraits, maps, zones, dev/world)
- **Software-raster speed:**
  - The underlay is clipped to uncovered tiles.
  - The light layers are cached.
  - Tall sprites are pre-flipped.
  - An automatic low budget kicks in when frames stay slow (`?worldQuality=low|high`).
- **Camps are safe:** pennant, merchant, trainer and NPC radii keep roaming Gloam out (`SAFE_RADIUS`,
  `safeZones`). validateWorld errors on any patrol that reaches a camp, and nine spawns were moved. A 1.5 s encounter
  grace follows every dialogue, menu, battle and arrival.
- **Arrival and objective:** the arrival card hands over to a corner cartouche on an ink plate, which collapses to a
  compass pill. The pill re-expands when the party stands still or the objective changes (`objectiveTarget`).
- **Minimap:** distinct glyphs, an objective ring, a caption, and a legend on tap.
- **Thicket:** canopy tone-down and outlined roaming foes.
- **Touch:**
  - A Menu button (top right).
  - Touch key-bar copy and 'Tap' prompt caps.
  - Tapping a foe beside you strikes first.
- **Map changes:** the summit spawns. spire_chest_top now holds sun_fragment and the shore cove chest a tonic shard.

### UI (main, index.html, styles, README, ui/*, dev/ui)
- **Pennant rest:** resting saves immediately, and `FocusStack.clear()` deactivates the widgets it drops, so stray
  clicks during fades are ignored.
- **Game over:** `recordFall` carries the death count, play time and Bestiary into the saved journal on game over.
- **Play clock:** the single play-time accumulator (`installPlayClock`).
- **Compact menus:** `.ui-compact` with `--ui-zoom` below scale 0.72 reflows the pause, pennant, travel, shop,
  settings and modal panels for phones. Phones get a single-card Party tab.
- **Mid-battle dialogue:** it docks at the top, so the party cards stay visible.
- **Readability:** stronger dim and faint text contrast.
- **Bestiary:** it reads only `world.bestiary`, and unmet foes show as '???' silhouettes.
- **Skill tags:** glyph tag grammar.
- **Touch wording:** `touchWording()` in text.js ('Tap the Parry button').
- **Fonts:** the Google Fonts CSS no longer blocks boot (1.5 s cap).
- **Naming and docs:** the e33 display renames and attribution sentence, the README AP range and Veteran row, and
  `difficultyFacts()` in the difficulty pickers.

### DATA (qte, model, status, passives, gameState, progression, data/*, simulate, tests)
- **Debounce:** a burst press inside the 90 ms debounce may claim the next hit if it is valid and inside its window.
  The rule is checked against a 221k-case two-press reference sweep.
- **Veteran:** the boss levers and no recovery (above).
- **XP:** per-member falloff (`xpFalloff`) and an XP and glint retune counting the summit spawns.
- **Simulator:** an opt-in `--planner support` and a `--chain N` mode.
- **Relic sources:** every one of the 30 relics has a sure source before the final boss.
- **Text:**
  - Surge wording.
  - Lore and dialogue fixes: night and tide, Lise, Quist.
  - Passive wording.
  - British spelling ('Defenceless', 'Duellist', 'Defence').
  - A glossary and spelling test over more than 400 player-facing strings.

### Integration pass (verifier)
- **src/ui/pauseMenu.js:** `deviceOf` is now imported from text.js. Without it the Journal sub-tab bar threw on every
  frame, the pause menu could not close, and the e2e prologue failed.
- **src/ui/titleScene.js:** the tap that opens the "Tap to begin" gate also chose the menu entry that faded in under
  the finger. On a phone with a save this opened Settings, or worse, New Game, because the browser sends the tap's
  click after the finger lifts. That one click is now swallowed (`_swallowGateClick`, 800 ms).
- **src/world/worldScene.js:**
  - **Menu button:** on touch the enlarged Menu button's bottom edge and hit halo sat under the minimap, which was
    4 stage px too high, so a slightly low tap toggled the map legend. On touch the map now starts at 96 px and the
    button sits above it. With the compact zoom below, that gives a 72×71 CSS px tap area (a 55 px button) at
    844×390.
  - **Interaction prompt:** a prompt that would sit on the arrival card's band is now held back until the card fades.
    Before, "Rest · Driftwood Camp" covered "Recommended level 1–5". The card's geometry is now one `TITLE_CARD`
    constant.
  - **After the finale:** the journal saved by the ending now reopens at the summit pennant's camp (`_campAtPennant`).
    Before, Continue dropped the party in the arena beside the two new summit guards, which noticed and caught it
    within about 3 s.
  - **Field HUD on phones:** the field HUD was left at 5–7 CSS px on phones; this was the world part of
    phone-text-and-targets-too-small. Under `#ui.ui-compact` the corner widgets now use `zoom: var(--ui-zoom)`:
    party chips, glint, Menu, minimap with caption and legend, cartouche and toasts. The prompt, key bar and hint are
    scaled about their anchors instead, and the smallest labels grow. Nothing reads under 11 CSS px at 844×390 or
    667×375, and Menu is 55 px. The 1280×720 layout is unchanged, except that the field hint now sits above the key
    bar (bottom 132 px) instead of under it.
- **src/battle/battleScene.js:**
  - **Phase banner:** the Stillkeeper's phase banner froze half-faded behind the docked phase-2 dialogue, because the
    battle (effects included) stands still under a dialogue. The dialogue now opens once the banner has played out
    (`PHASE_BANNER_MS` = 2600; unattended autopilot runs keep the old 1.2 s beat).
  - **Hints on touch:** battle hints use text.js `touchWording` on touch, which was left over from polish-10. 'Pick a
    command and tap it', 'tap [Counter] for a Prism Counter', 'Dodge them'. Keyboard and gamepad copy is unchanged.
- **docs/SPEC.md:** marked v1.1 amendments for the rules that changed: the debounce exception, XP falloff,
  `postBattleRecovery`, and the new `DIFFICULTY` fields and values.
- **Display text:** the ending credits and README now read 'the Duellist'. The dev benches say 'Prism attack' and
  'defence'.
- **tools/e2e.mjs:**
  - **New phases:** **touch** and **difficulty**, as described in the README.
  - **New assertions:** the Lamplighter speaks with a painted bust, the play clock runs through battles, and Continue
    after the ending starts by the summit pennant.
  - **approach() fix:** `approach()` no longer repeats an instant interaction that a roaming enemy interrupted
    afterwards. A chest opens without pausing the field, so a catch right after opening it made the next attempt
    find nothing to face. This was the intermittent 'expected to face chest shore_chest_lighthouse' failure.
    Failures now report the mode, fade, stack and the thing's distance, reach and prompt.
  - **Wording:** log text says pennant.
- **Verified:**
  - **Unit tests:** npm test 279/279.
  - **Full e2e:** all seven phases pass.
  - **Combat reviewer harness, defence judging:** the judging sweep has 0 mismatches over 600 cases (200 each on
    Story, Expeditioner and Veteran).
  - **Combat reviewer harness, contact:** contact at T is a 6–9 px tip bite on every non-feint melee hit. The
    exceptions are the dummy's nova and the wave release, which are by design.
  - **Combat reviewer harness, cues:** cues are at progress 1.0 at T, labelled and drawn on top, for all 485 hit×target
    sets. Feints shatter on time.
  - **Combat reviewer harness, rings:** every ring's `ringStart` = T − 480 and its progress is 1 at T.
  - **Offence judging:** the offence sweep is clean apart from one known float-boundary artefact: a scripted press
    at exactly −130.0000000000004 ms reads as a whiff, which an inclusive ±130 window rightly rejects.
