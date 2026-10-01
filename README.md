# Expedition 69

> *The Sun has stopped. Sixty-eight expeditions have failed.*

**Expedition 69** is a short (about 45–75 minutes) browser role-playing game about the last evening that never ends.
Sixty-eight years ago the Clockwork Sun above the city of Veyra stopped at twenty to seven, and with it came the
**Gloam**: creatures of stilled time. Every year Veyra sends an expedition across the Shattered Sea to the Meridian
Spire to set the Sun moving again. None has come back. You lead the sixty-ninth:

- **Gideon Marchal**, *the Vanguard*: a harbour-watch captain with a brass arc-gauntlet that stores **Surge**.
- **Nyra Solace**, *the Glyphwright*: a scholar who paints elemental **Glyphs** and spends them in sigils.
- **Sable Arden**, *the Duellist*: a fencer whose **Stance** can climb from Assault to Bravura.

The journey runs from **Brinegate Shore** through **the Gilded Thicket** and up **the Meridian Spire** to **the Summit**.
Battles are turn-based, but every enemy swing is a real-time test: **parry, dodge, jump or counter** at the exact
moment a blow lands. Your own skills are timed strikes too.

An original game. Its combat mechanics are inspired by *Clair Obscur: Expedition 33*; all names, characters, story,
art, audio and code are original. The art is painted procedurally on `<canvas>`, the music and sound are synthesized
live with WebAudio, and the code is vanilla ES modules with no build step and no runtime dependencies. See the
[credits and attribution](#credits--attribution) below.

---

## Running the game

Requirements: a modern browser (Chrome, Edge, Firefox or Safari). You also need Node 22 or newer for the bundled
static server and the tests.

```sh
npm start            # serves the project at http://localhost:8069
```

Then open <http://localhost:8069>. Any static file server works too, for example `python3 -m http.server 8069`
from the project root. The game must be served over HTTP (not opened as `file://`) because it uses ES modules.

The Cinzel and Cormorant Garamond fonts load from Google Fonts without ever blocking the page. The game gives them
up to 1.5 s before its first frame, and starts at once in Georgia when you are offline or the font host is blocked;
fonts that arrive later still swap in. Progress and settings are saved in `localStorage`. If storage is blocked the
game still runs, but it can't save.

The first key press or click on the title screen starts the audio: browsers only allow sound after a user gesture.

---

## Controls

Prompts on screen always show the binding for the device you used last: keyboard, gamepad or touch. On a touch
screen the hints name the on-screen buttons instead ("tap the Parry button").

| Action | Keyboard | Gamepad (standard) |
|---|---|---|
| Move | Arrow keys / W A S D | D-pad / left stick |
| Confirm · interact · attack in the field | Enter / Space / Z | A |
| Back / cancel | Esc / Backspace / X | B |
| Menu (pause) | Esc / Tab | Menu (Start) |
| **Parry** | **E** / J | **RB** / X |
| **Dodge** | **Q** / K / Shift | **LB** / B |
| **Jump** | **Space** / I | **A** |
| **Prism Counter** | **F** / L | **Y** |
| Timed strike (offensive QTE) | Space / Enter / E / J | A / X / RB |
| Switch menu tabs | Q / E | LB / RB |
| Skip a cutscene or dialogue | hold Esc | hold B |

Menus also respond to the mouse (hover and click). On a touch screen:

- **Menus:** tap an entry to choose it and a tab to switch to it, and drag a long list to scroll it. Tapping the
  dimmed backdrop closes the pause menu or the shop.
- **Field:** hold anywhere on the map to walk toward that point. Tap a person, chest or pennant next to the party to
  interact, and tap the party itself to swing at a nearby foe and start the battle with an ambush. The on-screen
  **Menu** button opens the pause menu, and tapping the minimap toggles its legend.
- **Battle:** tap commands and targets. When an attack is coming, on-screen **Parry**, **Dodge**, **Jump** and
  **Counter** buttons appear (and **Strike** during your own timed hits). The **Back** and **Pause** buttons stand in
  for Esc.
- **Dialogue and cutscenes:** tap to continue, or tap **Skip**.

On a phone, play in landscape. When the stage is drawn small (a phone, or a small window), the pause, pennant, shop and
settings menus switch to a compact layout with larger text and taller rows.

---

## Combat guide

### Turns and Action Points

- Turn order is a **charge-time** system. Faster combatants act more often, and the HUD shows the next eight turns.
- Each party member has their own **AP** (max 9). You gain **+1 AP** at the start of each of your turns, **+1** for a
  Basic Attack (which costs nothing) and **+1** for every parry.
- **Skills** cost 1–6 AP. **Items** and **Flee** cost none. Using an item ends the turn.
- **Free Aim** costs 1 AP per shot and does **not** end your turn. Shoot glowing **weak points**: some guarantee a
  critical, some add heavy **break**, some strip two **shields** at once.

### Timed strikes (your turn)

Every skill hit shows a ring that shrinks onto the target. Press the strike key as it closes:

| Rating | Window (Expeditioner) | Damage |
|---|---|---|
| Perfect | within 55 ms | ×1.4 (and +6 Prism) |
| Good | within 130 ms | ×1.15 |
| Miss | anything else | ×1.0 |

Mashing doesn't work. A press that lands outside every window locks strikes out for a quarter of a second.

### Defence (enemy turns)

Enemy attacks are rhythms of hits, and each hit tells you how it may be answered:

| Cue | Hit type | Answer |
|---|---|---|
| clean white ring | normal | **Parry** (tight window, +1 AP) or **Dodge** (wide window) |
| spiked **red** ring, red aura | unparryable | **Dodge** only |
| **gold** ring with chevrons, ground wave | jump | **Jump** only |
| **violet** prism, the world turns grey | prism | **Prism Counter** (no damage plus a riposte), or Dodge to survive |
| a swing that stops short | feint | nothing: pressing into a feint whiffs |

Parry windows run from 110 ms before impact to 45 ms after. Dodges run from 200 ms before to 70 ms after, with an
inner **perfect dodge**. A press that claims nothing is a whiff and briefly locks your defence. Read the wind-up and
wait for the blow.

**Counterattacks:** if you perfectly answer *every* hit an attack aims at a character (parry, jump or Prism
Counter, with no dodges), that character strikes back automatically.

### Break, shields and statuses

- Hits fill an enemy's orange **Break** gauge. When it's full the enemy is **Broken**: it loses its next turn and
  takes 25% more damage.
- Each **shield** absorbs one whole hit. Multi-hit skills and shield weak points strip them.
- Statuses (burn, chill, mark, shell, haste, slow, weakened, defenceless, stun, regen, silence…) are shown as icons.
  Hover them for details.

### The Prism gauge

Parries, jumps, dodges, perfect strikes and counters fill the team **Prism gauge**, which holds three charges.
Each character has a **Prism skill** that costs one full charge and no AP: a long, spectacular timed sequence.

### Character mechanics

- **Surge (Gideon):** +1 for every hit he lands, every hit he takes and every hit he parries (max 10). Finishers
  marked *Consumes Surge* deal up to ×3 damage.
- **Glyphs (Nyra):** her scripts inscribe up to four elemental glyphs. Sigils consume a glyph for a strong bonus,
  and *Codex Unbound* spends them all as extra hits.
- **Stance (Sable):** Assault hits harder, Guard takes less damage and earns AP from parries, and Assault twice
  becomes **Bravura** (×2 damage). Any hit she fails to avoid drops her back to Neutral.

### Difficulty

| | Timing windows | Damage taken | Bosses | HP recovered after a battle |
|---|---|---|---|---|
| Story | ×1.7 | ×0.6 | normal | 20% |
| Expeditioner (default) | ×1.0 | ×1.0 | normal | 20% |
| Veteran | ×0.65 | ×1.3 | hit ×1.6 and are ×1.5 as fast | none |

You can change difficulty at any time in **Settings**. The same screen has **assist cues**, **timing feedback**
("24 ms early"), screen shake, reduced flashing, volumes, and an **input offset** with two calibration mini-games:
tap along with a metronome, or tap on a flashing orb. Calibrate once per setup. It accounts for display, audio and
keyboard latency.

---

## Progression

- **Levels 1–20.** Every level grants **3 attribute points** and **1 skill point** (2 SP at levels 5, 10 and 15).
- **Attributes** (pause menu → *Party*): Vitality (+25 HP), Might (+3 ATK), Agility (+1.5 SPD), Defence
  (+2.5 DEF) and Luck (+1% crit). Preview with +/− before you commit, or let *Auto-Allocate* follow each
  character's natural build.
- **Skills** (pause menu → *Skills*): each character has eight skills plus a Prism skill. Learn them with SP once
  you reach their level and have learned any prerequisites.
- **Relics** (pause menu → *Relics & Echoes*): three slots per character. Each relic gives flat stats and one
  passive. Win **four battles** with a relic equipped to **master** it. Its passive then becomes an **Echo**
  that anyone can attune at its echo cost. Each character's echo capacity is 4 + their level.
- **Items:** Amber Tincture (heal), Rousing Tonic (revive) and Clockspring Draught (+3 AP). Their charges refill at
  every **Expedition Pennant**, and shards raise their maximum.
- **Expedition Pennants:** rest (full heal, refill items, and the Gloam you've cleared returns; the journal is saved
  at once), save, open the party menu, and fast-travel between pennants you've visited.
- **Between battles** the party recovers 20% of its HP (not on Veteran).
- **Glint** buys relics and shards from the camp merchants.
- **Journals** left by earlier expeditions are waiting to be found. Read them in *Journal*, next to the
  **Bestiary**: every foe you've fought, with its weaknesses. Foes not met yet are silhouettes.
- **Records** (pause menu → *System*, and the credits) count your time on the road, battles, parries, Prism
  Counters and falls. A fall is written into the journal before *Rise Again* reloads it.

---

## Project structure

```
index.html            page shell (#viewport > #stage > canvas#game, #ui, #fade)
styles.css            global styles and the Belle-Époque component library (panels, menus, bars, key caps…)
src/main.js           boot: Game, audio, fonts, scene registry, window.__game, game.debug + URL params
src/core/             engine loop and stage scaling, scene stack, input, events, RNG, tweening, save/settings,
                      WebAudio synthesis (audio.js)
src/battle/           pure battle model (model, damage, status, turn order, AI, passives), QTE timing judge (qte.js),
                      and the battle scene (battleScene, hud, choreo, freeAim, camera)
src/world/            exploration: world scene, tile maps, entities, rendering
src/ui/               title, intro, pause, pennant, dialogue, shop, game over, ending and settings scenes;
                      widgets.js (menus, tabs, dialogs, toasts, tooltips); text.js (key-token helpers)
src/game/             game state (new game, rewards, relics, shops, saves) and progression math
src/data/             characters, skills, relics, items, shops, enemies, encounters, story, zones, maps
src/render/           procedural sprites and portraits, effects, backgrounds, icons, palette
dev/*.html            module benches: core, audio, sprites, effects, battle, world, ui
tests/                node --test suites for the pure modules
tools/                serve.mjs (static server), cdp.mjs (headless Chrome harness), simulate.mjs (battle simulator),
                      e2e.mjs (end-to-end playthrough)
docs/SPEC.md          the design and architecture contract; docs/BUILD_NOTES.md: module notes
```

Scenes talk only through the scene stack (`game.scenes.push/pop/replace/reset`), `game.state`, `game.settings`,
`game.audio` and `game.events`. The registry names are `title`, `intro`, `world`, `battle`, `pause`, `flag`,
`dialogue`, `shop`, `gameover`, `ending` and `settings`. `openDialogue(game, idOrLines)` from `src/ui/dialogue.js`
returns a Promise that resolves when the dialogue closes.

---

## Testing

```sh
npm test                                   # node --test over tests/**/*.test.mjs (the pure modules)
npm run sim -- --sweep                     # headless battle simulator over every encounter
node tools/simulate.mjs --encounter boss_wreck_warden --level 5 --battles 200
node tools/cdp.mjs "http://localhost:8069/?battle=shellguard&autopilot=1" --wait 8000 --shot out.png
```

`tools/cdp.mjs` is a zero-dependency headless-Chrome harness, usable as a CLI or a library (`launch()`,
`page.goto/eval/press/click/screenshot`). It exits non-zero on uncaught page exceptions.

### End-to-end playthrough

```sh
npm run e2e                                        # full playthrough, about 20 minutes in real time
node tools/e2e.mjs --out /tmp/exp69-e2e --warp 2   # same run with the page clock at 2× speed
node tools/e2e.mjs --phases bosses --reuse         # one phase, from the checkpoint an earlier run saved
```

`tools/e2e.mjs` serves the project on a free port and plays the real `index.html` in headless Chrome through
`tools/cdp.mjs`, in seven phases:

1. **prologue**: title gate, credits, settings, New Game and difficulty, the intro, the shore arrival, walking
   to the tutorial Driftling and winning the tutorial battle, every pause-menu tab, the first pennant (rest, save),
   the merchant, an NPC (with its painted bust), a practice bout at the mannequin, a chest, fleeing a battle, and a
   defeat, game over and **Rise Again** back to the saved pennant.
2. **zones**: Continue, then autopilot battles against the easiest and the hardest encounter of every zone (the
   play clock must run through them).
3. **bosses**: the Wreck Warden, the Bellwether and the Stillkeeper at their intended levels, each reached on foot
   through its pre-battle dialogue. The run checks that each exit opens, walks through it into the next zone, and
   asserts the Stillkeeper's phase change and its mid-battle dialogue. Then the ending, the credits and the title.
4. **epilogue**: Continue after the ending (back at the summit pennant), fast travel between pennants, Quit to
   Title, and the Training Grounds played with the keyboard and mouse.
5. **viewports**: stage fit and aspect at 1600×900, 800×600, 390×844 and 844×390 (title, world, pause, battle).
6. **touch**: an 844×390 phone with touch emulation, taps only: the title gate and Continue, the world Menu button
   and the pause menu, then a battle — Skills disabled at 0 AP and inert when tapped, Attack → target → Back, the
   skill list's Back, the Pause control, Free Aim → Done, an Attack confirmed by tapping the enemy — and finally the
   tab hidden for 9 s just before an enemy hit lands: nothing may resolve while it is away, every hit must still be
   defended afterwards and the play clock must not count the absence.
7. **difficulty**: New Game over a journal with **Veteran** picked (no post-battle recovery checked in a real
   battle), then **Story** chosen in Settings from the pause menu (20% recovery checked).

The driver walks with real arrow keys along a BFS path, presses real keys, clicks and taps, and uses `game.debug` only
for the autopilot, levelling, healing, zone jumps and starting battles (the touch phase also sets a member's AP and
fakes the page's visibility). Any page exception, scene error caught by the engine, or console error or
warning fails the run. Each phase starts from a save-game checkpoint in a fresh page, so a phase that hits a
headless-Chrome stall is retried once in a new browser (`--retries N`). The driver prints a timeline and writes
screenshots of the key moments, `timeline.txt` and the checkpoints to `--out` (default `$E2E_OUT` or
`<tmp>/exp69-e2e`). The exit code is 0 only when every phase passes.

Every module has a visual bench. For the UI it's `dev/ui.html?scene=title|intro|pause|flag|shop|dialogue|settings|gameover|ending`
(add `&tab=party|skills|relics|items|journal|system` for the pause menu). It loads a prepared mid-game state with stub
world and battle scenes, so every screen can be opened and screenshotted.

### Debug URL parameters and hooks

| Parameter | Effect |
|---|---|
| `?battle=shellguard,driftling` | new game, straight into that battle (an encounter id such as `boss_wreck_warden` also works) |
| `?zone=thicket` | new game, starting in that zone |
| `?level=8` | raise the party to that level (points auto-allocated); combines with `battle` / `zone` |
| `?autopilot=1` | perfect defence, perfect strikes and automatic commands (for headless end-to-end runs) |
| `?difficulty=story` | override the difficulty for this session |
| `?seed=69` | seed the new game's RNG |
| `?scene=ending` | open a scene directly (overlays such as `pause` open over the world) |
| `?dpr=1` | override the device-pixel ratio of the canvas |

In the console, `window.__game` is the running game, and `__game.debug` offers `startBattle(enemies, opts)`,
`gotoZone(zone, x, y)`, `grantXp(n)`, `setLevel(n)`, `healParty(fraction)`, `winBattle()`,
`setAutopilot({ defense, offense, commands, dialogues })`, `newGame({ zone, level })`, `scene(name, params)`,
`dialogue(idOrLines)`, `save()` and `stack()`. While a battle runs, `__game.debug.battle` exposes `state()` and
`upcomingHits()`; in the field, `__game.debug.world` is the world scene (`debugInfo()`, `teleport(zone, x, y)`).
Autopilot `defense` is `'perfect' | 'random' | 'none'` and `offense` `'perfect' | 'none'`. `commands: 'auto'` picks
commands itself and skips the Stillkeeper's mid-battle dialogue unless `dialogues: true`.

---

## Credits & attribution

- An original game. Its combat mechanics are inspired by *Clair Obscur: Expedition 33*; all names, characters,
  story, art, audio and code are original.
- The mechanics in question: reactive turn-based combat with real-time parry, dodge, jump and counter defence, timed
  offensive inputs, AP, free-aim weak points, break, a team gauge, and passives mastered into shareable effects.
  *Clair Obscur: Expedition 33* is a game by Sandfall Interactive; this project is unaffiliated with it.
- Typefaces: **Cinzel** by Natanael Gama and **Cormorant Garamond** by Christian Thalmann (SIL Open Font License),
  served by Google Fonts.
- All visuals are drawn procedurally with the Canvas 2D API, and all audio is synthesized with WebAudio.
