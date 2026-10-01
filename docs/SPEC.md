# EXPEDITION 69 — Game Specification & Architecture Contract (v1)

> This document is the single source of truth for every module. Builders MUST implement
> the exact exported names, signatures and data shapes described here. If you must deviate,
> keep the spec'd API working (add, don't rename) and report the deviation.

---

## 0. Summary

**Expedition 69** is a short (≈45–75 min) browser RPG inspired by the *reactive turn-based*
combat popularised by Clair Obscur: Expedition 33. It is an **original** game: original setting,
characters, enemies, names and art. Only the *mechanics genre* is shared (turn-based commands +
real-time QTE defense: dodge / parry / jump / gradient counter, timed offensive QTEs, AP economy,
free-aim shooting at weak points, break gauges, team gradient meter, passive relics that are
"mastered" into shareable echoes, rest flags).

- Tech: HTML5 `<canvas>` (1280×720 logical) + DOM overlay for UI. Vanilla ES2022 modules. **No build
  step, no runtime dependencies, no external assets** (all art is procedural canvas drawing, all audio
  is WebAudio synthesis). Google Fonts (Cinzel, Cormorant Garamond) with serif fallback.
- Runs from a static server: `npm start` → `http://localhost:8069`.
- Input: keyboard (primary), mouse, gamepad (Standard mapping), touch (on-screen buttons).
- Persistence: `localStorage` (always wrapped in try/catch; game must work without it).

### 0.1 Premise (original)
The Clockwork Sun above the city of **Veyra** stopped 68 years ago, freezing the world in an endless
golden dusk. With it came **the Gloam** — creatures born of stilled time. Every year Veyra sends an
expedition across the Shattered Sea to the **Meridian Spire** to restart the Sun. Sixty-eight
expeditions have vanished. You lead **Expedition 69**. The journey: **Brinegate Shore** → **the Gilded
Thicket** → **the Meridian Spire** → **the Summit**, where **the Stillkeeper** holds the Sun still.
Tone: melancholic, hopeful, Belle-Époque painterly, flashes of dry humour. Previous expeditions left
journals ("Expedition 41 — day 12 …") to find.


> **Display-name glossary (v1.1).** Internal ids/keys keep the original names (`gradient`, `virtuoso`, `flag`,
> `mime`), but ALL player-facing text uses: Gradient → **Prism** (Prism gauge, Prism charges, Prism skills,
> Prism Counter, prism attacks) · Virtuoso stance → **Bravura** · Expedition Flag → **Expedition Pennant**
> ("pennant") · Gilded Mime → **Gilded Harlequin**. "Free Aim", "Break", "AP", "Parry", "Dodge", "Jump" stay.

---

## 1. File layout & ownership

| Path | Owner | Notes |
|---|---|---|
| `index.html`, `docs/SPEC.md`, `src/render/palette.js` | lead | already written |
| `package.json`, `tools/serve.mjs`, `tools/cdp.mjs` | CORE | |
| `src/core/engine.js`, `scene.js`, `input.js`, `events.js`, `rng.js`, `util.js`, `tween.js`, `save.js` | CORE | |
| `src/battle/qte.js` | CORE | pure timing judge |
| `tests/core-*.test.mjs` | CORE | |
| `src/core/audio.js`, `dev/audio.html`, `dev/audio.js` | AUDIO | |
| `src/battle/model.js`, `damage.js`, `status.js`, `turnOrder.js`, `ai.js`, `passives.js` | LOGIC | pure |
| `tests/battle-*.test.mjs`, `tools/simulate.mjs` | LOGIC | |
| `src/data/characters.js`, `skills.js`, `relics.js`, `items.js`, `shops.js` | PARTY | pure data |
| `src/game/progression.js`, `src/game/gameState.js`, `tests/game-*.test.mjs` | PARTY | pure (+ storage) |
| `src/data/enemies.js`, `encounters.js`, `story.js`, `tests/data-*.test.mjs` | BESTIARY | pure data |
| `src/render/sprites.js`, `src/render/looks/*.js`, `dev/sprites.html`, `dev/sprites.js` | SPRITES | |
| `src/render/effects.js`, `backgrounds.js`, `icons.js`, `dev/effects.html`, `dev/effects.js` | FX | |
| `src/battle/battleScene.js`, `hud.js`, `choreo.js`, `freeAim.js`, `camera.js` | BATTLE (stage 2) | |
| `src/world/*.js`, `src/data/maps.js`, `src/data/zones.js` | WORLD (stage 2) | |
| `src/main.js`, `styles.css`, `src/ui/*.js`, `README.md` | UI (stage 2) | |

Never edit files you don't own during the build phase. If you need something from another module
that the spec doesn't provide, write a small local helper in your own file and report it.

---

## 2. Conventions

- ES modules, **named exports only**. Relative imports with explicit `.js` extension.
- Every file begins with a 1–3 line header comment describing its purpose. JSDoc on public APIs.
- **Pure modules** (importable in Node 26 for tests, no DOM/window/performance/localStorage access at
  import time): `src/core/{events,rng,util,tween,save}.js`, `src/battle/{qte,model,damage,status,turnOrder,ai,passives}.js`,
  `src/data/*.js`, `src/game/*.js`. `save.js` may touch `localStorage` only inside functions, guarded.
- **Time is milliseconds everywhere.** `update(dt)` receives `dt` in ms (engine clamps to ≤ 50).
  Velocities in world code are px/s → multiply by `dt/1000`.
- Coordinates: logical stage **1280 × 720**, origin top-left, y down.
- Randomness in logic (`src/battle/*`, `src/game/*`, AI): only via an injected `RNG` instance. Rendering
  may use `Math.random`.
- IDs are `snake_case` strings. Display names are separate fields.
- Frame-loop robustness: never throw from `update`/`render` because of missing data — `console.warn`
  once and fall back.
- Canvas state: scenes must not reset the base transform with `ctx.setTransform(1,0,0,1,0,0)`. Use
  `ctx.save()/restore()`; to get back to logical stage space call `game.applyBaseTransform(ctx)`.
- Fonts: `"Cinzel", serif` (titles, numbers, labels) and `"Cormorant Garamond", Georgia, serif` (body).
  Exported as `FONTS` from `src/render/palette.js`.

---

## 3. Game design

### 3.1 Party (all three from the start, fixed order p0/p1/p2)

| id | Name | Role | Look | Mechanic | Shot element | L1 HP/ATK/DEF/SPD/CRIT |
|---|---|---|---|---|---|---|
| `gideon` | **Gideon Marchal**, the Vanguard | tank/breaker, physical+lightning | veteran harbor-watch captain, 40s, grey beard, long navy greatcoat w/ brass buttons, saber (right hand), brass **arc-gauntlet** (left arm) crackling blue-white | **Surge** 0–10 | lightning | 420 / 34 / 22 / 40 / 0.05 |
| `nyra` | **Nyra Solace**, the Glyphwright | elemental dps + healer | scholar-mage, 20s, ivory & gold robes, dark braided hair, floating tome, quill-staff that paints glowing glyphs | **Glyphs** queue ≤ 4 | light | 300 / 38 / 14 / 44 / 0.05 |
| `sable` | **Sable Arden**, the Duelist | single-target burst, high risk | young fencer, 19, crimson tailcoat, black plumed hat (white plume), rapier, flintlock at hip | **Stance** | physical | 340 / 36 / 17 / 52 / 0.12 |

Mechanics (battle-local; reset every battle):
- **Surge (Gideon)** `{type:'surge', value:0..10}`: +1 per damaging hit Gideon lands, +1 when Gideon takes
  damage, +1 per hit Gideon parries. Skills with `surge: 'consume'` multiply their power by
  `1 + 0.2 × surge` and then set surge to 0. Skill effect `{type:'surge', amount}` adds.
- **Glyphs (Nyra)** `{type:'glyphs', list:[]}` of `'fire'|'ice'|'storm'|'earth'|'light'` (FIFO, max 4, oldest
  dropped). Glyph → element: fire→fire, ice→ice, storm→lightning, earth→earth, light→light.
  Effect `{type:'glyph', add:'fire'}` pushes one. `consumeGlyph:{glyph, powerMult, effects}` removes the first
  matching glyph (if present) and applies the bonus. `consumeAllGlyphs:{extraHitPower}` removes all glyphs
  and appends **one extra hit per consumed glyph** (that glyph's element, `power = extraHitPower`) — decided in
  `beginAction`, so the hit list (and QTE count) is known up-front.
- **Stance (Sable)** `{type:'stance', value:'neutral'|'assault'|'guard'|'virtuoso'}`. Effect
  `{type:'stance', to}` applies in `finishAction` (the skill's own hits use the stance held *before*).
  Rule: `to:'assault'` while already `assault` (or `virtuoso`) → `virtuoso`. Taking damage from an enemy hit
  that was **not avoided** resets stance to `neutral`.
  Modifiers: assault dealt ×1.4 / taken ×1.2 · guard dealt ×0.85 / taken ×0.65 and +1 extra AP per parry ·
  virtuoso dealt ×2.0 / taken ×1.25.

### 3.2 Battle rules

**Layout.** Side view. Party on the left facing right; enemies on the right facing left.
Party slot feet positions (stage coords): p0 `(390,470)`, p1 `(265,565)`, p2 `(250,385)`.
Enemy slots: e0 `(905,470)`, e1 `(1045,380)`, e2 `(1050,575)`. A lone boss uses `(960,500)`.
Draw order by y.

**Turn order (CTB).** Each combatant has `initiative` (start: `rng.int(0,30) + spd`; ambush side +60).
Advance ticks: every living, non-acting combatant gains `effectiveSpd` per tick; the first to reach ≥ 100
acts, then subtracts 100. Ties → higher spd, then party first, then slot order. `effectiveSpd = spd ×
(haste 1.3) × (slow 0.7) × (chill 0.75)`. The HUD shows the forecast of the next 8 turns.

**Action Points (AP).** Party only. Max 9. Start of battle: 1 AP (+1 if `ambush:'party'`, + passives).
+1 AP at the start of each of that character's turns. Basic Attack: costs 0, grants +1 AP. Each parried hit:
+1 AP to the parrying character. Skills cost 1–7 AP. Items/Flee cost 0 AP. Free Aim shot: 1 AP each.

**Commands on a party turn.** `Attack` (basic), `Skills` (submenu), `Free Aim` (does NOT end the turn;
shoot any number of times while AP ≥ 1, then return to the menu), `Items`, `Gradient` (if ≥ 1 charge),
`Flee` (not in boss/tutorial battles; always succeeds).

**Offensive QTE (skills and gradient skills).** Each skill hit with `qte:true` shows a shrinking ring on
the target that closes at the hit time. Press `qte` (Space/Enter/E/J/A). Rating by |offset|:
`perfect ≤ 55ms`, `good ≤ 130ms`, else `miss` (windows × difficulty `windowScale`). Damage multiplier:
perfect ×1.4, good ×1.15, miss ×1.0. Basic attacks and counters have no QTE. A whiffed press (not within
any prompt's good window) locks QTE input for 250 ms (anti-mash). Each prompt is judged once (first claiming
press). Perfect grants gradient +6.

**Defensive QTE (enemy turns).** Enemy attacks are timelines of hits. Each hit has a `type`:

| type | cue colour | valid defenses | notes |
|---|---|---|---|
| `normal` | white | **parry** (E/J/RB/X) or **dodge** (Q/K/Shift/LB/B) | parry window tight, dodge wide |
| `unparryable` | red aura | **dodge** only | parry = fail |
| `jump` | gold ground wave | **jump** (Space/I/A) only | shockwaves along the floor |
| `gradient` | violet/prismatic, screen desaturates | **gradient counter** (F/L/Y) → no damage + riposte; **dodge** also avoids (no riposte) | parry/jump fail |
| `feint` | as normal | none — no impact | a bait swing; pressing into it is a whiff |

Base windows (ms relative to impact time **T**; scaled by difficulty `windowScale`):
`parry [T−110, T+45]`, `dodge [T−200, T+70]` (inner **perfect dodge** `[T−70, T+30]`),
`jump [T−260, T+60]`, `gradient [T−150, T+50]`.

Claiming rule (implemented by `DefenseTracker` in `qte.js`):
1. A defense press is matched to the **earliest unresolved non-feint hit** whose window has not closed
   (`t ≤ T + post_max(type)`).
2. If the press is inside that hit's *claim zone* `[T − pre_max(type), T + post_max(type)]` (union of the
   windows valid for that type, including invalid actions: `normal`/`unparryable` use dodge's span,
   `jump` uses jump's, `gradient` uses dodge's), it **claims** the hit. The first claiming press decides
   the outcome: if its action is valid for the type and its offset is inside that action's window → success,
   otherwise → `hit`. Later presses for an already-claimed hit are ignored.
3. A press that claims nothing is a **whiff** → all defense input is ignored for the lockout
   (`parry 380ms, dodge 260ms, jump 650ms, gradient 450ms`, not scaled by difficulty).
4. A press within 90 ms after a claiming press is ignored (debounce against double taps) — *v1.1 exception:* it
   still claims the next unresolved hit when its action is valid for that hit's type and inside that action's
   window (rapid bursts); anything else in those 90 ms returns `debounce` with no lockout.
5. Resolution time: a claimed hit resolves at `max(T, claimTime)`; an unclaimed hit resolves at `T + post`
   as `hit`. (Visual impact effects are shown at resolution.)
6. The player's defensive *animation* (parry swipe / dodge sidestep / jump) starts immediately on any
   accepted (non-locked) press, for responsiveness — the outcome only decides damage.

Outcomes: `'parry' | 'dodge' | 'perfectDodge' | 'jump' | 'gradient' | 'hit'`. For AoE hits the single
outcome applies to every targeted party member.

Gains: parry → +1 AP (that character) & gradient +8; perfect dodge → gradient +4; dodge → +2;
jump → +6; gradient counter → +20 and an immediate riposte (power 0.8, element dark) against the attacker.

**Counterattack.** If, for a given target, **every** hit of the enemy action aimed at them was resolved as
`parry` (normal hits), `jump` (jump hits) or `gradient` (gradient hits) — i.e. perfectly defended, no dodges —
that character performs an automatic counterattack after the enemy's action (power 1.5 physical, break 15,
gradient +5). Feints are ignored. Unparryable hits make a counter impossible.

**Damage formula** (`damage.js`):
```
atk        = attacker.stats.atk × (powerful 1.25) × (weakened 0.75)
mitigation = 100 / (100 + max(0, target.stats.def))
dmg = power × atk × mitigation
      × affinity(element)        // weak 1.5, resist 0.5, immune 0, default 1
      × (crit ? critMult : 1)    // critMult 1.5 (+ passive bonus); crit chance = attacker.stats.crit (+bonuses)
      × qteMult                  // 1.4 / 1.15 / 1.0
      × stanceDealt × stanceTaken
      × (target defenseless 1.25) × (target shell 0.7) × (target marked 1.5, then mark consumed)
      × passive multipliers (dealt/taken)
      × (target is party ? DIFFICULTY[d].dmgTakenMult : 1)
      × variance (rng uniform 0.95–1.05)
result = max(1, round(dmg))   (0 if immune)
```
Heals: `pct × maxHp` or `power × atk × 0.5`, × healPower passives, rounded.

**Statuses** (`status.js` exports `STATUS_DEFS`; closed id list):

| id | positive | effect | default turns |
|---|---|---|---|
| `burn` | no | at bearer's turn start lose 5% max HP (bosses 1.5%) | 3 |
| `chill` | no | speed ×0.75 | 2 |
| `mark` | no | next damaging hit taken ×1.5, then removed | 3 |
| `powerful` | yes | dealt ×1.25 (via atk) | 3 |
| `shell` | yes | taken ×0.7 | 3 |
| `haste` | yes | speed ×1.3 | 3 |
| `slow` | no | speed ×0.7 | 2 |
| `weakened` | no | dealt ×0.75 (via atk) | 2 |
| `defenseless` | no | taken ×1.25 | 2 |
| `stun` | no | skips next turn (then removed) | 1 |
| `regen` | yes | heal 8% max HP at turn start | 3 |
| `silence` | no | cannot use skills or gradient (attack/items/aim ok) | 2 |

Applying an existing status refreshes duration to max(current, new). Durations decrement at the **end of the
bearer's turn** (stun is consumed when the turn is skipped). KO clears statuses.

**Shields.** Enemy `shields: n`. Any damaging hit (skill, attack, shot, counter) against a shielded enemy
deals 0 damage and removes 1 shield (event `shield`). Weak point effect `shield` removes 2.

**Break.** Enemy `breakMax` (regular ~100, boss 250–400). Hits add break = `hit.break ?? round(power × 10)`
(× breakPower passives; blocked-by-shield hits add none). At ≥ max → **Broken**: event `broken`, apply
`stun` (1) + `defenseless` (2), break value locked until the enemy's skipped turn passes, then resets to 0
(event `recover`).

**Weak points / Free Aim.** Enemies declare weak points by id with an `effect`:
`crit` (guaranteed crit, ×2), `break` (+40 break, ×1.5), `shield` (removes 2 shields, ×1.5).
Shot: power 0.6, element = character `shotElement`, base break 8, cannot crit except `crit` weak point.
A shot at empty space still costs 1 AP (`targetIds: []`).

**Gradient meter.** Team value 0–300 (3 charges of 100). Gains: party damaging hit +2, perfect QTE +6,
parry +8, perfect dodge +4, dodge +2, jump +6, gradient counter +20, counterattack +5 (× gradientGain
passive). Each character has one gradient skill (`gradient:true`, costs 1 charge, 0 AP, ends turn, big
QTE sequence).

**Enemy AI.** Weighted random over the current phase's attack pool, filtered by `cooldown` and
`condition`. Targets: `single` → random living party member; `all` → all living; `multi` → each hit picks a
random living member (decided at plan time). Boss **phases** switch pool at HP thresholds (event `phase`).

**Victory / defeat.** Victory when all enemies KO; defeat when all party KO. Rewards: every party member
gets full XP (KO'd members half) — *v1.1:* per enemy × `xpFalloff(memberLevel, enemyLevel)` = clamp(1 − 0.15·gap,
0.25, 1) (`XP_FALLOFF`, model.js); `summary.xp` stays the full amount. Glint (currency) and drops (relic chance
rolls) are shared.
After battle: KO'd → 1 HP, and everyone recovers 20% max HP — *v1.1:* the difficulty's `postBattleRecovery`
(0 on Veteran), read from `summary.difficulty` (`postBattleRecoveryFor`, gameState.js).

**Difficulty** (`DIFFICULTY` in `qte.js`):
`story {windowScale 1.7, dmgTakenMult 0.6}`, `expeditioner {1.0, 1.0}` (default), `veteran {0.65, 1.3}`.
*v1.1:* every difficulty also has `bossSpdMult`, `bossDmgMult` (boss speed before phase multipliers; boss hits
× dmgTakenMult × bossDmgMult) and `postBattleRecovery`: story/expeditioner 1, 1, 0.2; veteran 1.5, 1.6, 0.

**Hit-stop / feel** (battle scene): parry 70 ms, gradient counter 150 ms, perfect QTE 50 ms, crit 40 ms,
break 120 ms (battle timeScale ≈ 0.05 during hit-stop). Screen shake on unavoided hits (6 px/180 ms; heavy
10 px), break (12 px). Respect `settings.screenShake` and `settings.reducedFlashing`.

### 3.3 Progression

- Levels 1–20. `xpToNext(level) = round(60 × level^1.6)`. Level-up: +3 attribute points, +1 skill point
  (+2 at levels 5, 10, 15).
- Attributes (all start 0): `vitality`, `might`, `agility`, `defense`, `luck`.
- Derived stats (before relic bonuses):
  `maxHp = base.hp + (L−1)×growth.hp + vitality×25`, `atk = base.atk + (L−1)×growth.atk + might×3`,
  `def = base.def + (L−1)×growth.def + defense×2.5`, `spd = base.spd + (L−1)×growth.spd + agility×1.5`,
  `crit = min(0.6, base.crit + luck×0.01)`.
- Expected party averages (PARTY must hit ±15% assuming even attribute spread; BESTIARY tunes enemies to it):

| Level | HP | ATK | DEF | SPD |
|---|---|---|---|---|
| 1 | 350 | 36 | 18 | 45 |
| 5 | 700 | 58 | 32 | 52 |
| 10 | 1250 | 95 | 52 | 60 |
| 15 | 1900 | 135 | 72 | 68 |

- Zone level bands: Shore 1–5 (boss ≈ L5), Thicket 5–10 (boss ≈ L10), Spire 10–15, Stillkeeper ≈ L15–16.
- Targets: a regular battle lasts 3–5 rounds; a failed defense against a normal hit costs 8–15% of the
  target's max HP; boss heavy hits 20–35%; bosses last 8–15 rounds; a fully defended enemy turn costs 0.

### 3.4 Relics & Echoes

- Each character has **3 relic slots**. A relic grants flat stats `{hp, atk, def, spd, crit}` (any subset) and
  one passive `{id, params}` from the closed list below.
- After **4 battle victories** with a relic equipped (on anyone), it is **mastered**: its passive becomes an
  **Echo** that any character can equip at its `echoCost` (1–5). Echo capacity per character =
  `4 + level`. An echo whose relic is also equipped on the same character does not stack (ignored).
- Closed passive id list (LOGIC implements all; PARTY uses only these):

| id | params | effect |
|---|---|---|
| `startAp` | `amount` | +AP at battle start |
| `parryAp` | `amount` | extra AP when this character parries |
| `parryHeal` | `pct` | heal pct max HP per parry |
| `perfectDodgeAp` | `amount` | AP on perfect dodge |
| `counterPower` | `mult` | counterattack damage × mult |
| `basicStatus` | `status, turns, chance` | basic attack applies status to target |
| `lowHpPower` | `threshold, mult` | dealt × mult while hp/maxHp < threshold |
| `secondWind` | — | once per battle, a lethal hit leaves 1 HP |
| `turnHeal` | `pct` | heal at own turn start |
| `critVsBroken` | `bonus` | +crit chance vs broken/defenseless targets |
| `critDamage` | `bonus` | crit multiplier +bonus |
| `breakPower` | `mult` | break dealt × mult |
| `shotPower` | `mult` | free-aim damage × mult |
| `shotMark` | `chance` | shots apply `mark` |
| `firstStrike` | `mult` | first damaging hit of the battle by this character × mult |
| `gradientGain` | `mult` | gradient gained from this character's actions × mult |
| `glassCannon` | `dealt, taken` | dealt × dealt, taken × taken |
| `elementPower` | `element, mult` | dealt × mult for that element |
| `killAp` | `amount` | +AP on landing a killing blow |
| `statusImmune` | `status` | cannot receive that status |
| `perfectPower` | `mult` | perfect-QTE multiplier × mult |
| `startStatus` | `status, turns` | begin battle with status |
| `hurtAp` | `amount` | +AP when taking damage (max once per enemy action) |
| `healPower` | `mult` | heals performed × mult |

**Fixed relic ids** (PARTY writes names/descriptions/stats/echoCost/rarity/price; BESTIARY drops and WORLD
chests reference these ids only):

| id | passive | | id | passive |
|---|---|---|---|---|
| `dawn_locket` | startAp {amount:1} | | `opening_gambit` | firstStrike {mult:1.6} |
| `riposte_pin` | counterPower {mult:1.5} | | `prism_shard` | gradientGain {mult:1.3} |
| `tidal_charm` | parryHeal {pct:0.04} | | `glass_rose` | glassCannon {dealt:1.3, taken:1.3} |
| `duelists_ribbon` | parryAp {amount:1} | | `cinder_seal` | elementPower {element:'fire', mult:1.3} |
| `feather_step` | perfectDodgeAp {amount:1} | | `storm_seal` | elementPower {element:'lightning', mult:1.3} |
| `ember_edge` | basicStatus {status:'burn', turns:2, chance:0.5} | | `rime_seal` | elementPower {element:'ice', mult:1.3} |
| `frost_edge` | basicStatus {status:'chill', turns:2, chance:0.5} | | `sun_fragment` | elementPower {element:'light', mult:1.3} |
| `last_light` | lowHpPower {threshold:0.35, mult:1.35} | | `executioners_coin` | killAp {amount:2} |
| `second_wind` | secondWind {} | | `warding_bell` | statusImmune {status:'stun'} |
| `verdant_brooch` | turnHeal {pct:0.05} | | `stillwater_pearl` | statusImmune {status:'slow'} |
| `shatterglass` | critVsBroken {bonus:0.35} | | `metronome` | perfectPower {mult:1.15} |
| `keen_whetstone` | critDamage {bonus:0.3} | | `aegis_thread` | startStatus {status:'shell', turns:3} |
| `anvil_heart` | breakPower {mult:1.4} | | `quickened_gear` | startStatus {status:'haste', turns:3} |
| `marksmans_eye` | shotPower {mult:1.5} | | `thorn_wreath` | hurtAp {amount:1} |
| `hunters_mark` | shotMark {chance:0.6} | | `mending_quill` | healPower {mult:1.35} |

Starting relics: Gideon `riposte_pin`, Nyra `mending_quill`, Sable `opening_gambit` (equipped, owned).

### 3.5 Items & shops

Consumables with charges refilled at flags: `tincture` (heal 45% max HP, ally), `tonic` (revive at 50%,
KO'd ally), `draught` (+3 AP, ally). Starting max: tincture 4, tonic 2, draught 2. Upgrades `tincture_shard`,
`tonic_shard`, `draught_shard` (+1 max each). Using an item in battle ends the turn. Tinctures usable from the
pause menu. Currency **Glint**. Shops sell relics and shards.

### 3.6 World & exploration

Top-down tile maps (tile 40 px, camera follows the leader). Move: WASD/arrows/left stick (160 px/s, Shift
not needed). `confirm` interacts with an adjacent entity (flag, chest, NPC, merchant, journal, exit) or
otherwise swings a weapon arc (≈ 60 px ahead): hitting a roaming enemy starts the battle with
`ambush:'party'`. Touching an enemy starts it with `ambush:null`; being touched while the player's back faces
the enemy → `ambush:'enemy'`. Roaming enemies patrol near their spawn and chase within ~5 tiles.
Defeated regular spawns stay gone until you rest at a flag; bosses never respawn.
**Expedition Flags**: Rest (full heal, refill items, respawn enemies), Save, Party menu, Fast travel between
visited flags. Chests (relics, shards, glint), Journals (lore), NPCs, Merchants, the Training Mannequin
(practice battle), zone exits (gated by boss defeat).

### 3.7 Content roster (fixed ids — SPRITES and BESTIARY must match exactly)

Weak point ids are fixed here; SPRITES decides their positions, BESTIARY decides nothing about position.

| id | Name | Zone | Visual brief | Weak points (id: effect) |
|---|---|---|---|---|
| `driftling` | Driftling | shore | floating translucent teal jellyfish-lantern, glowing core, trailing ribbons | `core: crit` |
| `shellguard` | Shellguard | shore | hermit-crab knight, conch helm, one big pincer + shell shield | `conch: shield`, `eye: crit` |
| `tidecaller` | Tidecaller | shore | hooded fish-headed acolyte, coral staff topped with a pearl | `staff_pearl: break` |
| `wreck_warden` | The Wreck Warden (mini-boss) | shore | hulking barnacled brass diving-suit golem, glowing porthole helm, giant anchor on a chain | `porthole: crit`, `barnacles: break` |
| `thornstag` | Thornstag | thicket | golden-leaved stag, antlers of thorn, glowing heartwood in chest | `heartwood: crit`, `antlers: break` |
| `mime` | Gilded Mime | thicket | masked harlequin duelist, gold/ivory diamonds, ribbon-sword | `mask: crit` |
| `bloomwitch` | Bloomwitch | thicket | lady with a huge rose for a head, petal gown, thorn wand | `bloom: break` |
| `bellwether` | The Bellwether (mini-boss) | thicket | giant ram-horned figure whose head is a great bronze bell; hammer | `bell_clapper: break`, `eye: crit` |
| `coghound` | Coghound | spire | lean brass hound of gears, exposed mainspring | `mainspring: crit` |
| `sentinel` | Porcelain Sentinel | spire | tall cracked porcelain knight, clock-face shield | `clockface: shield`, `crack: break` |
| `hourwraith` | Hour Wraith | spire | spectral smoke figure made of clock hands, swinging pendulum heart | `pendulum: crit` |
| `stillkeeper` | The Stillkeeper (final boss, 2 phases) | summit | towering clockwork knight, cracked sun-halo crown, sundial glaive; phase 2 "Unwound": halo shatters into orbiting shards, cracks glow white-gold | `halo: break`, `heart_gear: crit` |
| `dummy` | Training Mannequin | training | straw & canvas mannequin on a pole with a painted target | `target: crit` |

Enemy attack animation variants (closed set, used by BESTIARY `anim`, drawn by SPRITES, choreographed by
BATTLE): melee — `slash`, `thrust`, `slam`, `bite`, `spin`, `charge`; ranged/area — `bolt` (projectile),
`wave` (ground shockwave), `beam`, `nova` (burst around targets), `cast` (generic spell, used for
non-damaging actions too).

Party skill animation ids (closed set, PARTY uses, BATTLE choreographs, SPRITES poses):
`slash`, `thrust`, `flurry`, `heavy`, `leap`, `spin`, `cast`, `buff`, `heal`, `shoot`, `gradient`.

### 3.8 Story beats (BESTIARY writes text in `story.js`, WORLD/UI/BATTLE display)

Required dialogue ids: `shore_arrival`, `flag_first`, `warden_pre`, `warden_post`, `thicket_arrival`,
`bellwether_pre`, `bellwether_post`, `spire_arrival`, `summit_arrival`, `stillkeeper_pre`,
`stillkeeper_phase2`, `stillkeeper_post`, `merchant_greet`, `trainer_greet`. Optional extra NPC dialogues
`npc_*`. Journals `j1`–`j9` (3 per zone: j1–j3 shore, j4–j6 thicket, j7–j9 spire). Intro slides and ending
slides. Tutorial hint keys: `firstTurn`, `ap`, `skills`, `qte`, `parry`, `dodge`, `jump`, `unparryable`,
`gradientHit`, `counter`, `freeAim`, `shields`, `break`, `gradientMeter`, `stances`, `glyphs`, `surge`.

---

## 4. APIs

### 4.1 Engine — `src/core/engine.js`, `src/core/scene.js` (CORE)

```js
// scene.js
export class Scene {
  constructor(game) { this.game = game; this.transparent = false; this._ui = []; }
  enter(params) {}  exit() {}  pause() {}  resume(result) {}
  update(dt) {}     render(ctx) {}
  mountUI(el)       // appends el to game.uiRoot, tracks it; returns el
  unmountUI()       // removes all mounted elements (engine calls this after exit())
}

// engine.js
export const STAGE_W = 1280, STAGE_H = 720;
export class Game {
  constructor({ canvas, uiRoot, stageEl, fadeEl })
  canvas; ctx; uiRoot; stageEl; width = 1280; height = 720;
  input;            // Input instance (created by Game)
  audio;            // assigned by main.js (Audio instance) — may be null in tests
  events;           // Emitter
  state = null;     // RPG GameState (see 4.9) or null on title
  settings;         // from loadSettings(); call game.saveSettings() after edits
  params;           // URLSearchParams(location.search)
  time;             // performance.now() at current frame
  frame;            // frame counter
  scenes;           // SceneManager
  debug = {};       // debug helpers (main.js fills)
  registerScene(name, SceneClass)
  start()           // starts rAF loop
  applyBaseTransform(ctx)   // sets transform so drawing uses logical 1280x720 coords
  fade(outMs, fn, inMs) → Promise   // fade #fade overlay to black, await fn(), fade back in
  saveSettings()
}
export class SceneManager {
  push(name, params) → Scene     // pauses current top (pause()), enters new
  pop(result)                     // exits top (exit + unmountUI), calls new top.resume(result)
  replace(name, params) → Scene   // exits top, enters new at the same level
  reset(name, params) → Scene     // exits all, enters new
  get top()
  has(name) → bool
}
```
Loop: `dt = min(now − last, 50)`; on `visibilitychange` hidden, pause the loop and `audio?.suspend()`;
on return, reset `last` (no giant dt). Per frame: `input.beginFrame(now)` → `top.update(dt)` → clear canvas →
render the stack from the lowest visible scene (a scene is visible if every scene above it is
`transparent`) → `input.endFrame()`. Stage scaling: fit 16:9 into the window (letterbox), `#stage` is
1280×720 CSS px scaled with `transform: scale(s)`; canvas backing store = `1280 × s × min(dpr, 2)`;
`input` receives the stage rect for pointer mapping. Exceptions inside scene update/render are caught,
logged once per message, and the loop continues.

### 4.2 Input — `src/core/input.js` (CORE)

Actions: `up down left right confirm cancel menu parry dodge jump gradient qte`.
Default bindings (KeyboardEvent.code / `pad:N` standard-mapping buttons):
```
up:[ArrowUp,KeyW,pad:12] down:[ArrowDown,KeyS,pad:13] left:[ArrowLeft,KeyA,pad:14] right:[ArrowRight,KeyD,pad:15]
confirm:[Enter,Space,KeyZ,pad:0]  cancel:[Escape,Backspace,KeyX,pad:1]  menu:[Escape,Tab,pad:9]
parry:[KeyE,KeyJ,pad:5,pad:2]     dodge:[KeyQ,KeyK,ShiftLeft,ShiftRight,pad:4,pad:1]
jump:[Space,KeyI,pad:0]           gradient:[KeyF,KeyL,pad:3]
qte:[Space,Enter,KeyE,KeyJ,pad:0,pad:2,pad:5]
```
```js
export const ACTIONS = [...];  export const DEFAULT_BINDINGS = {...};
export class Input {
  constructor(win = window)
  setBindings(map)                 // merge over defaults
  beginFrame(now) / endFrame()
  isDown(action) → bool
  pressed(action) → bool           // edge since last frame
  released(action) → bool
  anyPressed(actions) → action|null
  pressLog                         // [{action, t, source}] for EVERY action a physical press maps to; t = event.timeStamp (performance.now clock); keep last 3 s
  pressesSince(t, actions?) → [{action,t,source}]   // chronological
  virtualPress(action) / virtualRelease(action)       // touch buttons; t = performance.now()
  axis() → {x, y}                  // movement vector (keys or stick, deadzone 0.25), length ≤ 1
  pointer → {x, y, down, pressed, released}           // stage coords; pressed/released are edges
  setStageRect(rect, scale)
  lastDevice → 'keyboard'|'gamepad'|'touch'
  keyLabel(action) → string        // e.g. "E", "Space", "RB" for current device
  enabled = true
}
```
Ignore `e.repeat`. `preventDefault` for Space, arrows, Tab, Backspace (not when a text input is focused).
Gamepad polled in `beginFrame` (press t = `now`). Clear held keys on window blur.

### 4.3 QTE — `src/battle/qte.js` (CORE, pure)

```js
export const DIFFICULTY = { story:{name:'Story', windowScale:1.7, dmgTakenMult:0.6, bossSpdMult:1, bossDmgMult:1, postBattleRecovery:0.2}, expeditioner:{name:'Expeditioner', windowScale:1.0, dmgTakenMult:1.0, bossSpdMult:1, bossDmgMult:1, postBattleRecovery:0.2}, veteran:{name:'Veteran', windowScale:0.65, dmgTakenMult:1.3, bossSpdMult:1.5, bossDmgMult:1.6, postBattleRecovery:0} };
export const BASE_WINDOWS = { parry:{pre:110,post:45}, dodge:{pre:200,post:70}, perfectDodge:{pre:70,post:30}, jump:{pre:260,post:60}, gradient:{pre:150,post:50} };
export const LOCKOUT = { parry:380, dodge:260, jump:650, gradient:450 };
export const OFFENSE_WINDOWS = { perfect:55, good:130, whiffLockout:250 };
export const DEFENSE_ACTIONS = ['parry','dodge','jump','gradient'];
export const VALID_DEFENSES = { normal:['parry','dodge'], unparryable:['dodge'], jump:['jump'], gradient:['gradient','dodge'], feint:[] };
export function windowsFor(difficultyId) → { parry:{pre,post}, dodge, perfectDodge, jump, gradient, offense:{perfect,good} }
export function claimZone(hitType, windows) → {pre, post}

export class DefenseTracker {
  // hits: [{t, type}] in attack-local ms; calibration ms is SUBTRACTED from press times
  constructor({ hits, difficulty = 'expeditioner', calibration = 0 })
  press(action, t) → { accepted:boolean, claimedHit:number|-1, reason:'claim'|'whiff'|'locked'|'debounce'|'ignored' }
  update(now) → [{ hitIndex, outcome, offset, action }]   // newly resolved hits, in order
  get lockedUntil
  results                  // array per hit: null until resolved, then {outcome, offset, action}
  isDone()                 // all non-feint hits resolved
}
export class OffenseTracker {
  constructor({ prompts: [{t}], difficulty, calibration = 0 })
  press(t) → { accepted, claimedPrompt, reason }
  update(now) → [{ promptIndex, rating:'perfect'|'good'|'miss', offset }]  // unclaimed prompts resolve 'miss' at t + good
  results; isDone()
}
export function judgeOffense(offset, windows) → 'perfect'|'good'|'miss'
export function qteMultiplier(rating) → 1.4 | 1.15 | 1.0
```

### 4.4 Audio — `src/core/audio.js` (AUDIO)

```js
export const SFX = [ 'ui_move','ui_confirm','ui_cancel','ui_error','menu_open',
  'hit','hit_heavy','crit','whiff','parry','dodge','perfect_dodge','jump','land','hurt','block','shield_restore',
  'heal','buff','debuff','break','ko','revive','qte_perfect','qte_good','qte_miss','shot','counter',
  'telegraph','telegraph_red','telegraph_gold','telegraph_gradient','gradient_counter','gradient_ready','gradient_skill',
  'fire','ice','lightning','earth','light','dark','phase','level_up','chest','flag','step','swing','encounter',
  'victory','defeat','coin' ];
export const TRACKS = ['title','shore','thicket','spire','summit','battle','boss','final','victory','gameover','ending','training'];
export class Audio {
  constructor()                    // lazily creates AudioContext; safe if WebAudio unsupported (no-ops)
  unlock()                         // resume context on first user gesture (main.js wires pointerdown/keydown)
  suspend() / resumeCtx()
  setVolumes({ master, sfx, music })   // 0..1
  play(name, { pitch = 1, volume = 1, pan = 0 } = {})   // unknown names warn once
  playMusic(track, { fade = 800, loop = true } = {})     // crossfade; same track = no-op
  stopMusic({ fade = 600 } = {})
  get currentTrack
}
```
Every defense/offense SFX must have a sharp transient (≤ 5 ms attack) so timing feels tight. Music:
procedural loops (step sequencer with scheduled oscillators/noise), zone-appropriate, low CPU.

### 4.5 Save & settings — `src/core/save.js` (CORE)

```js
export const DEFAULT_SETTINGS = { difficulty:'expeditioner', assistCues:true, inputOffset:0, masterVolume:0.8,
  sfxVolume:0.9, musicVolume:0.55, screenShake:true, reducedFlashing:false, showTimingFeedback:false, bindings:null };
export const storage = { get(key, fallback=null), set(key, value) → bool, remove(key) };  // JSON, try/catch, no-op without localStorage
export function loadSettings() → settings (defaults merged, validated)
export function saveSettings(settings) → bool
export const SAVE_KEY = 'exp69.save.v1', SETTINGS_KEY = 'exp69.settings.v1';
```

### 4.6 Small core modules (CORE)

- `events.js`: `export class Emitter { on(evt, fn) → off(); once(evt, fn); off(evt, fn); emit(evt, ...args) }`
- `rng.js`: `export class RNG { constructor(seed); next() /*[0,1)*/; int(min,max) /*inclusive*/; float(min,max); chance(p); pick(arr); weighted(items, weightFn); shuffle(arr); fork() ; get state/set state }` (mulberry32; seed default from Date.now at call site, never inside module import).
- `util.js`: `clamp, lerp, invLerp, remap, smoothstep, approach(cur,target,delta), dist, angle, wrap, pickWeighted, formatNumber, uid(prefix)`.
- `tween.js`: `export const Ease = { linear, inQuad, outQuad, inOutQuad, inCubic, outCubic, inOutCubic, outBack, inBack, outElastic, outBounce, inExpo, outExpo }`;
  `export class Tweener { to(obj, props, ms, ease, {delay, onDone}) → handle; update(dt); cancel(handle); clear() }`;
  `export class Timers { after(ms, fn) → id; every(ms, fn) → id; cancel(id); update(dt); clear() }`;
  `export function wait(timers, ms) → Promise`.

### 4.7 Battle model — `src/battle/*` (LOGIC, pure)

```js
// model.js
export class BattleModel {
  constructor({ party, enemies, rng, difficulty = 'expeditioner', ambush = null, practice = false, data })
  // party: PartySnapshot[] (4.9). enemies: [enemyId | {id, level?}].
  // data (REQUIRED, injected — model.js must NOT import src/data/* or qte.js): { ENEMIES, SKILLS, ITEMS, CHARACTERS, DIFFICULTY }
  // The battle scene passes the real modules; tests pass fixtures. practice=true: party takes no damage (hp floor 1), enemies never die (hp floor 1), no rewards.
  combatants; party; enemies; turn; gradient /* 0..300 */; log /* [string] */;
  get(id) → Combatant
  gradientCharges() → 0..3
  peekTurnOrder(n = 8) → [combatantId]             // pure forecast, doesn't mutate
  nextTurn() → { actorId, skipped:boolean, events }  // advances CTB, start-of-turn effects; skipped if stunned/broken
  endTurn(actorId) → events

  // party
  getCommands(actorId) → { attack:{usable}, skills:[{id, name, ap, usable, reason}], freeAim:{usable}, items:[{id,name,count,usable,reason}], gradient:[{id,name,usable,reason}], flee:{usable} }
  getValidTargets(actorId, action) → [combatantId]     // action as below (without targetIds)
  beginAction(actorId, action) → ActionPlan | { error }
      // action = { kind:'attack'|'skill'|'item'|'gradient'|'shot'|'flee', id?, targetIds:[...], weakPointId? }
  resolveHit(plan, hitIndex, qteRating = null) → events
  finishAction(plan) → events                           // post effects; plan.endsTurn tells the scene whether to end the turn (false for 'shot')

  // enemy
  planEnemyAction(enemyId) → EnemyPlan
  resolveEnemyHit(plan, hitIndex, outcome) → events     // outcome applies to all plan.hits[hitIndex].targetIds
  resolveCounters(plan) → [{ counterId, targetId, events }]   // uses outcomes recorded by resolveEnemyHit; may be []
  finishEnemyAction(plan) → events

  outcome() → 'victory'|'defeat'|'fled'|null
  summary() → { outcome, xp, glint, drops:[relicId], party:[{id, hp, alive}], stats:{parries, perfectDodges, dodges, jumps, gradientCounters, perfects, hitsTaken, turns} }
}
// ActionPlan
{ actorId, kind, def /* skill/item def or synthetic */, targetIds, endsTurn, anim, element,
  hits: [{ index, targetIds:[...], power, element, qte:boolean, gap /* ms before this hit, default 380 */, break }],
  events /* immediate events e.g. AP spent */ }
// EnemyPlan
{ actorId, attack /* def */, name, anim, approach /* 'melee'|'ranged'|'stay' */, duration,
  hits: [{ index, t, type, power, element, anim, windup, targetIds:[...] }], events }
```
- `resolveEnemyHit` with a dead target → no-op for that target. `hit` outcome applies damage + hit statuses +
  mechanic changes (surge +1, stance → neutral), `parry` gives AP/gradient/surge, etc.
- Counters: `resolveCounters` returns one entry per eligible target (see 3.2) with its damage events.
- Gradient counter riposte happens inside `resolveEnemyHit` when outcome is `'gradient'` (damage events on
  the attacker).
- `damage.js`: `export function computeDamage(ctx) → {amount, crit, affinity:'weak'|'resist'|'immune'|null}`,
  `export function computeHeal(...)`. `status.js`: `export const STATUS_DEFS`, `applyStatus`, `removeStatus`,
  `hasStatus`, `tickStartOfTurn`, `tickEndOfTurn`. `turnOrder.js`: CTB helpers. `ai.js`:
  `chooseEnemyAction(model, enemy, rng) → {attackId, targetIds}`. `passives.js`: passive hook helpers.
- Events (plain objects; the scene animates them; state is already applied inside the model):
```
{type:'damage', targetId, sourceId, amount, crit, element, affinity, hpAfter, hitIndex}
{type:'blocked', targetId, sourceId}                       // shield absorbed
{type:'heal', targetId, amount, hpAfter}
{type:'defend', targetId, outcome}                         // parry/dodge/perfectDodge/jump/gradient
{type:'status', targetId, status, turns}                   {type:'statusEnd', targetId, status}
{type:'statusTick', targetId, status, amount}              // burn/regen tick (also emits damage/heal)
{type:'ap', targetId, delta, apAfter}                      {type:'gradient', value, charges, delta}
{type:'shield', targetId, delta, shieldsAfter}             {type:'break', targetId, value, max}
{type:'broken', targetId}                                  {type:'recover', targetId}
{type:'ko', targetId}                                      {type:'revive', targetId, hpAfter}
{type:'mechanic', targetId, mechanic}                      // new mechanic state object (copy)
{type:'phase', targetId, phaseIndex, text}                 {type:'skip', targetId, reason:'stun'|'broken'}
{type:'counter', sourceId, targetId}                       {type:'text', text, style:'banner'|'info'|'warn'}
{type:'fled'}
```

### 4.8 Data schemas

**characters.js** (PARTY): `export const CHARACTERS = { gideon:{ id, name, title, look, color, mechanic:'surge'|'glyphs'|'stance', shotElement, base:{hp,atk,def,spd,crit}, growth:{hp,atk,def,spd}, basicAttack:{ name, anim, element, hits:[{power, gap?}] }, gradientSkill: skillId, startingSkills:[skillIds], bio }, ... }` and `export const PARTY_ORDER = ['gideon','nyra','sable']`.

**skills.js** (PARTY): `export const SKILLS = { [id]: {
  id, owner, name, desc, ap, gradient?:true, target:'enemy'|'allEnemies'|'ally'|'allAllies'|'self'|'deadAlly'|'randomEnemies',
  element, anim, hits:[{ power, qte:true, gap?, break?, random?:true /* randomEnemies target per hit */ }],
  effects:[ Effect ], surge?:'consume', consumeGlyph?:{glyph, powerMult, effects:[Effect]}, consumeAllGlyphs?:{extraHitPower},
  bonusVs?:{ status?:id, broken?:bool, mult }, critBonus?, ignoreShields?, learn:{ level, sp, requires:[skillIds] } } }`
Effect (closed set): `{type:'status', status, turns, chance?=1, target:'target'|'self'|'allies'|'enemies'}`,
`{type:'heal', pct?|power?, target}`, `{type:'revive', pct, target:'target'}`, `{type:'ap', amount, target}`,
`{type:'cleanse', target}`, `{type:'dispel', target}`, `{type:'shieldBreak', amount}`, `{type:'break', amount}`,
`{type:'gradient', amount}`, `{type:'surge', amount}`, `{type:'glyph', add}`, `{type:'stance', to}`,
`{type:'shield', amount, target:'self'|'allies'}` (enemy only). Effects apply after all hits unless
`when:'perHit'`. Non-damage skills have `hits: []`.
Each character: 8 regular skills + 1 gradient skill; two starting skills; unlocks spread across levels
1–14; mechanics must be showcased (consume/produce surge, glyph production & consumption, stance paths to
virtuoso). Costs 1–7 AP.

**relics.js** (PARTY): `export const RELICS = { [id]: { id, name, desc, stats:{...}, passive:{id, params}, echoCost, rarity:'common'|'rare'|'legendary', price? } }` (≥ 18 relics).

**items.js** (PARTY): `export const ITEMS = { tincture:{ id, name, desc, target:'ally'|'deadAlly', effects:[Effect], baseMax }, tonic, draught }`; `export const UPGRADES = { tincture_shard:{ item:'tincture', name, desc }, ... }`.

**shops.js** (PARTY): `export const SHOPS = { shore_camp:{ name, stock:[{kind:'relic'|'shard', id, price}] }, thicket_camp, spire_camp }`.

**enemies.js** (BESTIARY): `export const ENEMIES = { [id]: {
  id, name, look, zone, level, boss?:bool, scale?:number,
  stats:{ hp, atk, def, spd, crit }, affinities:{ fire?:1.5|0.5|0, ... }, shields?:n, breakMax,
  weakPoints:[{ id, effect }], xp, glint, drops:[{ relic, chance }],
  attacks:{ [attackId]: EnemyAttack }, pool:[attackIds] /* weights inside attacks */,
  phases?:[{ hpBelow, pool:[attackIds], text, effects?:[Effect], statMult?:{spd?, atk?} }],
  statusResist?:[statusIds], bio } }`
`EnemyAttack = { id, name, target:'single'|'all'|'multi', approach:'melee'|'ranged'|'stay', weight, cooldown?, condition?:{selfHpBelow?, allyHpBelow?, shieldsBelow?, notStatus?},
  hits:[{ t, type:'normal'|'unparryable'|'jump'|'gradient'|'feint', power, element?, anim, windup?:ms (visible wind-up length, default 350), status?:{id, turns, chance} }],
  duration /* ms after t=0 until the action ends; ≥ last t + 400 */, effects?:[Effect] /* self/ally/party effects after hits */ }`
Timeline rules (validated by `tests/data-*.test.mjs`): hits sorted by `t`; melee first hit `t ≥ 850` (the scene
spends 450 ms approaching), ranged/stay first hit `t ≥ 600`; consecutive non-feint hits ≥ 170 ms apart;
feints ≤ 1 per attack and never the last hit; every non-boss enemy has ≥ 2 attacks, bosses ≥ 4 per phase;
every zone introduces its mechanics gradually (shore: normal + jump + one unparryable; thicket adds
feints/delays and the first gradient attack on the Bellwether; spire/summit mix everything). Rhythm variety
is the heart of the game: steady triplets, syncopation, long delayed swings (`windup` 700–1100 ms), rapid
bursts (180–220 ms), shockwave rolls.

**encounters.js** (BESTIARY): `export const ENCOUNTERS = { [id]: { enemies:[enemyIds], zone, boss?:bool, music? } }`
(≥ 5 per zone; boss ids `boss_wreck_warden`, `boss_bellwether`, `boss_stillkeeper`; `training_dummy`;
`tutorial_driftling` for the first fight = one driftling).

**story.js** (BESTIARY): `export const STORY = { intro:[{title?, text}], ending:[{title?, text}], dialogues:{ [id]: [{speaker, text}] }, journals:{ j1:{zone, title, text}, ... }, hints:{ [key]: text }, zoneTitles:{ shore, thicket, spire, summit } }`. Speakers: `gideon`, `nyra`, `sable`, `narrator`, or free names.

**zones.js / maps.js** (WORLD): `export const ZONES = { shore:{ name, levelRange, music, battleBg }, thicket, spire, summit, training:{...} }`;
`export const MAPS = { [zoneId]: { tiles:[strings], legend:{char:tileType}, entities:[...] } }` (see §4.11).

### 4.9 Game state — `src/game/gameState.js`, `src/game/progression.js` (PARTY)

```js
// progression.js
export function xpToNext(level)
export function derivedStats(member, { relics = RELICS } = {}) → { maxHp, atk, def, spd, crit }  // incl. relic flat bonuses
export function grantXp(member, amount) → [{ level }]      // mutates; returns level-ups (points granted)
export function echoCapacity(level); export function echoLoad(member)
// gameState.js
export function createNewGame() → GameState
export function toBattleParty(state) → PartySnapshot[]
export function applyBattleResult(state, summary) → { xpGained, glint, drops, levelUps:[{id, level, attrPoints, sp}], mastered:[relicId], newSkillsAvailable:[{id, skillId}] }
export function restAtFlag(state, flagId)                  // heal, refill items, clear defeated regular spawns, mark flag visited, set lastFlag
export function allocateAttr(state, charId, attr, n = 1) → {ok, reason?}
export function learnSkill(state, charId, skillId) → {ok, reason?}
export function equipRelic(state, charId, slot, relicId|null) → {ok, reason?}   // relic can only be on one character
export function equipEcho(state, charId, relicId) / unequipEcho(state, charId, relicId) → {ok, reason?}
export function useItemOutOfBattle(state, itemId, charId) → {ok, reason?}
export function addLoot(state, loot) → description   // loot = {relic}|{shard}|{glint}|{item}
export function buy(state, shopId, index) → {ok, reason?}
export function serialize(state) → string;  export function deserialize(str) → GameState|null (validates/migrates)
export function saveGame(state) → bool;  export function loadGame() → GameState|null;  export function hasSave() → bool;  export function deleteSave()
// (gameState.js uses globalThis.localStorage directly under key 'exp69.save.v1', guarded by try/catch — it does NOT import core/save.js)
// GameState
{ version:1, seed, party:[{ id, level, xp, attrs:{vitality,might,agility,defense,luck}, attrPoints, sp, skills:[ids], relics:[id|null,id|null,id|null], echoes:[relicIds], hp, alive:true }],
  items:{ tincture:{count,max}, tonic:{count,max}, draught:{count,max} }, relics:{ [id]:{ battles, mastered } } /* owned */,
  glint, world:{ zone, x, y /* tile coords */, facing, lastFlag:{zone, flagId, x, y}|null, defeated:{[spawnId]:true}, bosses:{[bossId]:true}, chests:{[id]:true}, journals:{[id]:true}, flagsVisited:{[flagId]:{zone,x,y,name}}, story:{[key]:true}, hintsSeen:{[key]:true} },
  stats:{ battles, victories, parries, perfectDodges, perfects, playTimeMs, deaths } }
// PartySnapshot (what BattleModel receives)
{ id, name, look, level, stats:{maxHp, atk, def, spd, crit}, hp, alive, skills:[ids], gradientSkill, passives:[{id, params, source}], mechanic, shotElement, basicAttack }
```

### 4.10 Rendering — `src/render/*`

**palette.js** (lead, done): `PALETTE`, `ELEMENT_COLORS`, `HIT_TYPE_COLORS`, `ZONE_PALETTES`, `FONTS`, `STATUS_COLORS`.

**sprites.js** (SPRITES):
```js
export const LOOK_IDS = ['gideon','nyra','sable', ...all enemy ids from §3.7];
export function drawActor(ctx, lookId, pose)
// pose: { x, y /* feet */, scale = 1, facing = 1 /* 1 faces right, -1 left */, anim = 'idle', variant = null,
//         p = 0 /* 0..1 anim progress */, t = 0 /* global ms for breathing/cloth/particles */,
//         flash = 0, tint = null, alpha = 1, aura = null /* 'red'|'gold'|'gradient'|'white' */, broken = false,
//         phase = 0 /* boss phase index */, mechanic = null /* {type,value/list} for visual flourishes */, shadow = true }
// anim ∈ idle, run, walk, windup, strike, recover, hurt, dodge, parry, jump, cast, shoot, aim, guard, ko, victory
// windup: p 0→1 ends at contact.  strike: p=0 IS the contact pose; 0→1 follow-through.  jump: p 0→1 full arc (drawActor applies the vertical offset itself).
// variant for windup/strike/recover = party skill anim id or enemy anim variant (§3.7)
export function getAnchors(lookId, pose) → { head, chest, weapon, feet, top, center }   // world {x,y}
export function getBounds(lookId, pose) → { x, y, w, h }                               // body hit box
export function weakPointPositions(lookId, pose) → [{ id, x, y, r }]                   // world coords
export function lookHeight(lookId) → px at scale 1   (party ≈ 150; regular enemies 110–220; bosses 300–380)
export function renderPortrait(lookId, size = 64) → HTMLCanvasElement (cached)       // bust, for HUD/turn order/dialogue
```
Painterly, readable silhouettes; anticipation and follow-through; enemy `windup` must visibly telegraph each
variant (a slam lifts high, a thrust pulls back, a charge crouches, bolt/beam/cast gather light, wave raises
and stamps). ≤ 1 ms per actor per frame (cache static parts in offscreen canvases). Guard against missing
`document` only inside functions (portraits need `document.createElement('canvas')`).

**effects.js** (FX):
```js
export class Effects {
  constructor({ reducedFlashing = false } = {})
  update(dt); render(ctx) /* world space */; renderScreen(ctx) /* after camera, stage space */; clear()
  burst(x, y, kind, opts)    // kind: hit,crit,parry,perfect,dodge,jump,heal,buff,debuff,fire,ice,lightning,earth,light,dark,physical,break,ko,gradient,shield,counter,land
  sparks(x, y, { color, count = 12, speed = 300, spread = Math.PI*2, angle = 0, life = 450, gravity = 600 })
  number(x, y, value, { kind:'damage'|'crit'|'heal'|'ap'|'block'|'text', affinity = null, color })  // floating combat text
  text(x, y, str, { color, size = 28, life = 900, rise = 40, font, stroke = true })
  ring(x, y, { r0 = 10, r1 = 80, life = 400, color = '#fff', width = 4 })
  slash(x, y, { angle = 0, length = 140, color = '#fff', life = 220, width = 10, curve = 0.4 })
  line(x0, y0, x1, y1, { color, width = 3, life = 160 })     // tracer
  shockwave(x, y, { toX, speed, color, life })              // ground wave travelling horizontally
  projectile({ from:{x,y}, to:{x,y}, duration, kind:'bolt'|'thorn'|'orb'|'glyph'|'bullet', color, arc = 0, onArrive })
  screenFlash(color, life = 160, alpha = 0.6)               // reduced when reducedFlashing
  shake(intensity, life); shakeOffset() → {x, y}
  vignette(color, life, alpha); desaturate(amount, life); get desaturation()   // BATTLE applies desaturation via ctx.filter or overlay
  banner(text, { sub, color, life = 1400 })                // big centred brush-stroke banner (screen space)
}
export function drawQteRing(ctx, x, y, { progress /*0 → 1 closes*/, radius = 90, color = '#fff', label = '', rating = null, t = 0 })
export function drawDefenseCue(ctx, x, y, { progress, type /* normal|unparryable|jump|gradient */, label, t })  // distinct shapes per type (colour-blind safe)
export function drawTargetMarker(ctx, x, y, { t, color })
export function drawEnemyBars(ctx, x, y, { hp, maxHp, breakValue, breakMax, shields, broken, statuses:[ids], name, width = 140 })
```
**backgrounds.js** (FX): `export function drawBattleBackground(ctx, zoneId, t, { camera })` for `shore|thicket|spire|summit|training` (+ phase-2 variant via `opts.phase`), `export function drawTitleBackground(ctx, t)`. Pre-render static layers (offscreen canvases), animate a few elements (waves, drifting petals/leaves, turning gears, the frozen sun).
**icons.js** (FX): `export function statusIcon(id, size = 20) → dataURL` / `elementIcon(el, size)` / `itemIcon(id, size)` / `mechanicIcon(key, size)` — cached procedural icons for the DOM HUD.

### 4.11 Scenes (stage 2)

Registry names & params (exact):
- `'title'` `{}` — New Game / Continue / Training / Settings / Credits.
- `'intro'` `{}` — STORY.intro slides → `scenes.reset('world', {arrival:true})`.
- `'world'` `{ zone?, x?, y?, arrival? }` — defaults from `game.state.world`.
- `'battle'` `{ encounterId?, enemies:[ids], zone, ambush:null|'party'|'enemy', boss:false, practice:false, tutorial:false, spawnId?, onEnd(result) }`
  → result `{ outcome:'victory'|'defeat'|'fled', summary, rewards /* applyBattleResult output */ }`. The battle
  scene calls `toBattleParty` at start and `applyBattleResult` on victory (and on flee/defeat only the HP
  write-back rules of 3.2), shows its own results panel, then `scenes.pop(result)` and `onEnd(result)`.
- `'pause'` `{}` (transparent) — Party (attributes), Skills, Relics & Echoes, Items, Journal, Settings, Quit to title.
- `'flag'` `{ flagId, name }` (transparent) — Rest, Party menu, Fast travel, Save, Leave.
- `'dialogue'` `{ id? , lines?, onDone? }` (transparent). Helper: `export function openDialogue(game, idOrLines) → Promise` in `src/ui/dialogue.js`.
- `'shop'` `{ shopId }` (transparent). `'gameover'` `{}`. `'ending'` `{}`. `'settings'` `{ from }` (transparent).

Map entity types (WORLD): `player`, `flag {id,name}`, `enemy {id, encounter, patrol}`, `boss {id, encounter, dialogue, postDialogue}`,
`chest {id, loot}`, `journal {id}`, `npc {id, look, dialogue}`, `merchant {id, shopId}`, `trainer`, `exit {to, toX, toY, requires?:{boss}}`, `tutorial` flag on the first enemy.

### 4.12 Debug hooks (UI implements in main.js, BATTLE honours)

`window.__game = game` always. `game.debug`: `startBattle(enemies, opts)`, `gotoZone(zone, x, y)`,
`grantXp(n)`, `winBattle()`, `setAutopilot({ defense:'perfect'|'random'|'none'|null, offense:'perfect'|'none'|null, commands:'auto'|null })`.
Autopilot (read by the battle scene from `game.debug.autopilot`): `defense:'perfect'` presses the correct
defense at each hit's impact time; `offense:'perfect'` presses each QTE prompt on time; `commands:'auto'`
picks commands automatically (use the best affordable skill, else attack). This makes headless end-to-end
runs possible. URL `?autopilot=1` enables all three; `?battle=shellguard,driftling` jumps straight into a
battle; `?zone=thicket` starts a new game in that zone.

---

## 5. Art & audio direction

- **Palette**: dusk gold, ember orange, deep teal sea, ivory, crimson, violet shadows (see `palette.js`).
  Everything feels like oil paint under a low, frozen sun: soft gradients, rim light from the right/top, long
  shadows, gentle bloom (additive circles), brush-stroke shapes for UI accents.
- **UI**: dark translucent ink panels (`rgba(16,12,10,0.82)`), thin gold filigree borders, Cinzel labels,
  Cormorant body, generous letter-spacing on headings. Big legible numbers. Keyboard-first with visible
  focus. Tooltips/descriptions for every skill/relic/status.
- **Readability of QTEs** is priority #1: every enemy hit must be readable from animation alone, with optional
  assist cues (`settings.assistCues`) and distinct cue shapes per hit type (normal = clean ring,
  unparryable = spiked red ring, jump = gold ring with upward chevrons + ground ripple, gradient = violet
  prism/diamond with screen desaturation).
- **Audio**: sharp, satisfying transients for parry (bright metallic clang), dodge (air whoosh), jump
  (spring + land), perfect (glassy chime). Music: melancholic waltz-y Belle-Époque motifs; battle loops with
  drive; boss/final with choir-like pads.

## 6. Testing & tooling

- `npm test` → `node --test tests/` (all pure modules). Each owner writes focused tests.
- `npm start` → `node tools/serve.mjs` (static server, port 8069, `--port` flag, correct MIME types incl.
  `.js`/`.mjs` as `text/javascript`, no caching).
- `tools/cdp.mjs` (CORE): zero-dependency headless-Chrome harness using the DevTools protocol over Node's
  built-in `WebSocket`. Library: `launch({ port?, headless:true, width:1280, height:720 }) → { page, close }`,
  `page.goto(url)`, `page.eval(expr)`, `page.screenshot(path)`, `page.key(code, {down/up, delay})`,
  `page.press(code)`, `page.click(x, y)`, `page.waitFor(expr, timeout)`, `page.consoleMessages` / `page.errors`.
  CLI: `node tools/cdp.mjs <url> [--shot out.png] [--wait ms] [--eval "expr"]` prints console errors and
  exits non-zero on page exceptions. Chrome: `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`
  (use `--headless=new`, a fresh `--user-data-dir` in a temp dir, `--remote-debugging-port=0` and parse
  `DevToolsActivePort`).
- `tools/simulate.mjs` (LOGIC): headless battle simulator (bots with configurable defense success rates and
  offense ratings) printing win rate, rounds, damage taken — used to tune balance.
- Dev pages (`dev/*.html`) render module showcases for visual checks via headless screenshots.

## 7. Definition of done (every module)

1. Implements the spec'd exports exactly; no console errors; no unowned files touched.
2. Pure modules have passing `node --test` tests covering the tricky rules.
3. Visual modules have a dev page that renders every look/effect and was screenshot-checked headlessly.
4. Report: files written, deviations/additions to the API, known gaps.
