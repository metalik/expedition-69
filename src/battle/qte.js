// Pure timing judge for Expedition 69's real-time battle QTEs (SPEC §3.2, §4.3).
// DefenseTracker judges parry / dodge / jump / gradient presses against an enemy hit timeline;
// OffenseTracker judges timed presses against skill prompts. No DOM and no clocks: callers feed times (ms).

/**
 * Difficulty presets. `windowScale` scales every timing window (never the lockouts); the battle model consumes the
 * rest: `dmgTakenMult` (damage the party takes), `bossSpdMult` / `bossDmgMult` (bosses act more often and hit harder
 * — on top of dmgTakenMult) and `postBattleRecovery` (fraction of max HP everyone recovers after a battle).
 * Veteran: tighter windows, heavier blows and no recovery between fights (HP only returns through items and pennant
 * rests), while the boss levers make the bosses a real test for a strong player without walling regular fights.
 */
export const DIFFICULTY = Object.freeze({
  story: Object.freeze({
    name: 'Story', windowScale: 1.7, dmgTakenMult: 0.6, bossSpdMult: 1, bossDmgMult: 1, postBattleRecovery: 0.2,
  }),
  expeditioner: Object.freeze({
    name: 'Expeditioner', windowScale: 1.0, dmgTakenMult: 1.0, bossSpdMult: 1, bossDmgMult: 1, postBattleRecovery: 0.2,
  }),
  veteran: Object.freeze({
    name: 'Veteran', windowScale: 0.65, dmgTakenMult: 1.3, bossSpdMult: 1.5, bossDmgMult: 1.6, postBattleRecovery: 0,
  }),
});

/** Default difficulty id. */
export const DEFAULT_DIFFICULTY = 'expeditioner';

/** Base defensive windows in ms relative to impact time T: success iff T - pre <= press <= T + post. */
export const BASE_WINDOWS = Object.freeze({
  parry: Object.freeze({ pre: 110, post: 45 }),
  dodge: Object.freeze({ pre: 200, post: 70 }),
  perfectDodge: Object.freeze({ pre: 70, post: 30 }),
  jump: Object.freeze({ pre: 260, post: 60 }),
  gradient: Object.freeze({ pre: 150, post: 50 }),
});

/** Input lockout (ms) after a whiffed defensive press, per action. Never scaled by difficulty. */
export const LOCKOUT = Object.freeze({ parry: 380, dodge: 260, jump: 650, gradient: 450 });

/** Offensive QTE windows (|offset| in ms) and the anti-mash whiff lockout. */
export const OFFENSE_WINDOWS = Object.freeze({ perfect: 55, good: 130, whiffLockout: 250 });

/**
 * A press this soon (ms) after a claiming press is ignored (double-tap protection). DefenseTracker still lets such a
 * press through when it would successfully defend the next hit (valid action inside that action's window).
 */
export const DEBOUNCE_MS = 90;

/** Defensive input actions understood by DefenseTracker. */
export const DEFENSE_ACTIONS = Object.freeze(['parry', 'dodge', 'jump', 'gradient']);

/** Enemy hit types. */
export const HIT_TYPES = Object.freeze(['normal', 'unparryable', 'jump', 'gradient', 'feint']);

/** Which defensive actions avoid each hit type. */
export const VALID_DEFENSES = Object.freeze({
  normal: Object.freeze(['parry', 'dodge']),
  unparryable: Object.freeze(['dodge']),
  jump: Object.freeze(['jump']),
  gradient: Object.freeze(['gradient', 'dodge']),
  feint: Object.freeze([]),
});

/** Every possible defensive outcome. Everything except 'hit' means the hit was avoided. */
export const DEFENSE_OUTCOMES = Object.freeze(['parry', 'dodge', 'perfectDodge', 'jump', 'gradient', 'hit']);

/** Player-facing names for outcomes and offensive ratings. */
export const OUTCOME_LABELS = Object.freeze({
  parry: 'Parry',
  dodge: 'Dodge',
  perfectDodge: 'Perfect Dodge',
  jump: 'Jump',
  gradient: 'Prism Counter',
  hit: 'Hit',
  perfect: 'Perfect',
  good: 'Good',
  miss: 'Miss',
});

/**
 * Actions whose windows form each hit type's claim zone (a press anywhere in the union claims the
 * hit, even with an invalid action). normal/unparryable/feint → dodge's span, jump → jump's span,
 * gradient → dodge's span (the union with gradient/parry, which both sit inside it).
 */
const ZONE_SOURCES = Object.freeze({
  normal: ['parry', 'dodge'],
  unparryable: ['parry', 'dodge'],
  jump: ['jump'],
  gradient: ['gradient', 'dodge', 'parry'],
  feint: ['parry', 'dodge'],
});

const warned = new Set();
function warnOnce(key, msg) {
  if (warned.has(key)) return;
  warned.add(key);
  if (typeof console !== 'undefined') console.warn(`[qte] ${msg}`);
}

const round1 = (x) => Math.round(x * 10) / 10;
const finiteOr = (v, fallback) => (Number.isFinite(v) ? v : fallback);

/**
 * Look up a difficulty preset (unknown ids fall back to Expeditioner).
 * @param {string} id
 * @returns {{name:string, windowScale:number, dmgTakenMult:number, bossSpdMult:number, bossDmgMult:number,
 *   postBattleRecovery:number}}
 */
export function difficultyDef(id) {
  return (typeof id === 'string' && Object.hasOwn(DIFFICULTY, id)) ? DIFFICULTY[id] : DIFFICULTY[DEFAULT_DIFFICULTY];
}

/**
 * Resolve a window scale from a difficulty id, a preset-like object `{windowScale}` or a raw number.
 * @param {string|number|{windowScale:number}} difficulty
 * @returns {number}
 */
export function windowScaleOf(difficulty) {
  if (typeof difficulty === 'number') return difficulty > 0 ? difficulty : 1;
  if (difficulty && typeof difficulty === 'object' && Number.isFinite(difficulty.windowScale) && difficulty.windowScale > 0) {
    return difficulty.windowScale;
  }
  if (typeof difficulty === 'string' && !Object.hasOwn(DIFFICULTY, difficulty)) {
    warnOnce(`diff:${difficulty}`, `unknown difficulty "${difficulty}", using ${DEFAULT_DIFFICULTY}`);
  }
  return difficultyDef(difficulty).windowScale;
}

/**
 * Timing windows for a difficulty, scaled by its windowScale (rounded to 0.1 ms so that e.g.
 * 110 × 0.65 is exactly 71.5). Lockouts are not included because they never scale.
 * @param {string|number|{windowScale:number}} [difficultyId='expeditioner']
 * @returns {{parry:{pre:number,post:number}, dodge:{pre:number,post:number}, perfectDodge:{pre:number,post:number},
 *            jump:{pre:number,post:number}, gradient:{pre:number,post:number}, offense:{perfect:number, good:number}}}
 */
export function windowsFor(difficultyId = DEFAULT_DIFFICULTY) {
  const s = windowScaleOf(difficultyId);
  const w = {};
  for (const [key, { pre, post }] of Object.entries(BASE_WINDOWS)) w[key] = { pre: round1(pre * s), post: round1(post * s) };
  w.offense = { perfect: round1(OFFENSE_WINDOWS.perfect * s), good: round1(OFFENSE_WINDOWS.good * s) };
  return w;
}

/**
 * Normalise a hit type; unknown types are treated as 'normal' (warned once).
 * @param {string} type
 * @returns {'normal'|'unparryable'|'jump'|'gradient'|'feint'}
 */
export function normalizeHitType(type) {
  if (Object.hasOwn(VALID_DEFENSES, type)) return type;
  warnOnce(`type:${type}`, `unknown hit type "${type}", treating as normal`);
  return 'normal';
}

/**
 * Claim zone of a hit type: the span around T in which any defensive press claims the hit
 * (union of the windows of every action that could be pressed at it).
 * For 'feint' this is the bait zone — the span in which a press is attributed to (and punished by)
 * the feint instead of the next real hit; feints never have a success window.
 * @param {string} hitType
 * @param {ReturnType<typeof windowsFor>} [windows]
 * @returns {{pre:number, post:number}}
 */
export function claimZone(hitType, windows = windowsFor()) {
  const sources = ZONE_SOURCES[normalizeHitType(hitType)];
  let pre = 0;
  let post = 0;
  for (const a of sources) {
    pre = Math.max(pre, windows[a].pre);
    post = Math.max(post, windows[a].post);
  }
  return { pre, post };
}

/**
 * The action that fully defends a hit type (what autopilot 'perfect' presses): parry for normal
 * (enables counters), dodge for unparryable, jump, gradient counter; null for feints.
 * @param {string} hitType
 * @returns {'parry'|'dodge'|'jump'|'gradient'|null}
 */
export function perfectAction(hitType) {
  switch (normalizeHitType(hitType)) {
    case 'normal': return 'parry';
    case 'unparryable': return 'dodge';
    case 'jump': return 'jump';
    case 'gradient': return 'gradient';
    default: return null;
  }
}

/** True if a defensive outcome avoided damage. */
export function isAvoided(outcome) {
  return typeof outcome === 'string' && outcome !== 'hit' && DEFENSE_OUTCOMES.includes(outcome);
}

/**
 * Judge a claiming press: success needs a valid action for the hit type AND an offset inside that
 * action's window. A successful dodge inside the inner perfect-dodge window becomes 'perfectDodge'.
 * @param {string} hitType
 * @param {string} action   one of DEFENSE_ACTIONS
 * @param {number} offset   press time − impact time (ms, calibration already applied)
 * @param {ReturnType<typeof windowsFor>} [windows]
 * @returns {'parry'|'dodge'|'perfectDodge'|'jump'|'gradient'|'hit'}
 */
export function judgeDefense(hitType, action, offset, windows = windowsFor()) {
  const type = normalizeHitType(hitType);
  if (!VALID_DEFENSES[type].includes(action) || !Number.isFinite(offset)) return 'hit';
  const w = windows[action];
  if (offset < -w.pre || offset > w.post) return 'hit';
  if (action === 'dodge') {
    const p = windows.perfectDodge;
    return (offset >= -p.pre && offset <= p.post) ? 'perfectDodge' : 'dodge';
  }
  return action;
}

/**
 * Rate an offensive press by |offset|.
 * @param {number} offset  press time − prompt time (ms)
 * @param {{perfect:number, good:number}|ReturnType<typeof windowsFor>} [windows]  offense windows or a windowsFor() result
 * @returns {'perfect'|'good'|'miss'}
 */
export function judgeOffense(offset, windows = OFFENSE_WINDOWS) {
  const w = (windows && windows.offense) ? windows.offense : (windows ?? OFFENSE_WINDOWS);
  if (!Number.isFinite(offset)) return 'miss';
  const a = Math.abs(offset);
  if (a <= w.perfect) return 'perfect';
  if (a <= w.good) return 'good';
  return 'miss';
}

/**
 * Damage multiplier for an offensive rating.
 * @param {'perfect'|'good'|'miss'|null} rating
 * @returns {number} 1.4 | 1.15 | 1.0
 */
export function qteMultiplier(rating) {
  if (rating === 'perfect') return 1.4;
  if (rating === 'good') return 1.15;
  return 1.0;
}

/**
 * Human-readable timing feedback, e.g. describeOffset(-34.2) → "34 ms early", 12 → "12 ms late".
 * @param {number|null} ms  offset (negative = early)
 * @returns {string} '' when there is no offset (unclaimed hit)
 */
export function describeOffset(ms) {
  if (!Number.isFinite(ms)) return '';
  const r = Math.round(ms);
  if (r === 0) return 'on time';
  return r < 0 ? `${-r} ms early` : `${r} ms late`;
}

function normalizeHits(hits) {
  if (!Array.isArray(hits)) return [];
  return hits.map((h, index) => {
    const t = Number(h?.t);
    if (!Number.isFinite(t)) warnOnce(`t:${h?.t}`, `hit ${index} has no finite time; using 0`);
    return { index, t: Number.isFinite(t) ? t : 0, type: normalizeHitType(h?.type ?? 'normal') };
  });
}

function byTime(a, b) {
  return a.t - b.t || a.index - b.index;
}

/**
 * Judges defensive presses against one enemy action's hit timeline (SPEC §3.2 claiming rules).
 *
 * Times: hit `t` values and the times passed to press()/update() must share one clock (typically
 * attack-local ms). `calibration` (the player's input offset) is subtracted from press times before
 * judging; lockout / debounce / resolution times are expressed on the caller's clock.
 *
 * Rules:
 *  1. A press is matched to the earliest unresolved non-feint hit whose claim zone has not closed.
 *  2. Inside that hit's claim zone it claims the hit; the first claim decides (valid action within
 *     its window → success, else 'hit'). Presses while the matched hit is claimed but not yet
 *     resolved are ignored.
 *  3. A press that claims nothing is a whiff → all defensive input locked for LOCKOUT[action].
 *     A press nearer to a feint than to the matched hit (inside the feint's bait zone) is a whiff.
 *  4. A press < DEBOUNCE_MS after a claiming press is ignored (double tap) — unless it would successfully
 *     claim the next hit (valid action inside its window), which rapid 180–200 ms bursts need.
 *  5. Claimed hits resolve at max(T, claimTime); unclaimed ones resolve as 'hit' once the zone
 *     closed (T + post, never before T).
 */
export class DefenseTracker {
  /**
   * @param {{hits:Array<{t:number, type:string}>, difficulty?:string|number|{windowScale:number}, calibration?:number}} opts
   */
  constructor({ hits = [], difficulty = DEFAULT_DIFFICULTY, calibration = 0 } = {}) {
    /** Difficulty id / descriptor this tracker was built with. */
    this.difficulty = difficulty;
    /** Scaled windows in use. */
    this.windows = windowsFor(difficulty);
    /** Calibration (ms) subtracted from press times. */
    this.calibration = finiteOr(Number(calibration), 0);
    /** Normalised hits: [{index, t, type}] in the caller's order. */
    this.hits = normalizeHits(hits);
    /** Per hit: null until resolved, then {outcome, offset, action}. Feints stay null. */
    this.results = this.hits.map(() => null);
    /** Per hit: null until claimed, then {action, t, offset, outcome, resolveAt}. */
    this.claims = this.hits.map(() => null);
    /** Every press fed to the tracker with its verdict (for debugging / feedback). */
    this.pressHistory = [];

    this._zones = this.hits.map((h) => claimZone(h.type, this.windows));
    this._real = this.hits.filter((h) => h.type !== 'feint').sort(byTime);
    this._feints = this.hits.filter((h) => h.type === 'feint').sort(byTime);
    this._lockedUntil = -Infinity;
    this._lastClaimT = null;
  }

  /** Caller-clock time until which defensive input is locked (−Infinity when never locked). */
  get lockedUntil() {
    return this._lockedUntil;
  }

  /** True if a press at time t would be rejected by the whiff lockout. */
  isLocked(t) {
    return t < this._lockedUntil;
  }

  /** The claim zone {pre, post} of hit i. */
  zoneOf(i) {
    return this._zones[i];
  }

  /**
   * Caller-clock time at which hit i resolves if nobody claims it (its claim zone closes).
   * @param {number} i
   */
  unclaimedResolveTime(i) {
    const h = this.hits[i];
    if (!h) return NaN;
    return Math.max(h.t, h.t + this._zones[i].post + this.calibration);
  }

  /** Caller-clock time by which every non-feint hit is guaranteed to be resolved. */
  get endTime() {
    let end = -Infinity;
    for (const h of this._real) end = Math.max(end, this.claims[h.index]?.resolveAt ?? this.unclaimedResolveTime(h.index));
    return end;
  }

  /**
   * Index of the next non-feint hit still awaiting resolution, or -1.
   * @returns {number}
   */
  nextHitIndex() {
    for (const h of this._real) if (!this.results[h.index]) return h.index;
    return -1;
  }

  /**
   * Feed one defensive press.
   * @param {string} action  'parry'|'dodge'|'jump'|'gradient' (anything else is ignored)
   * @param {number} t       press time on the caller's clock
   * @returns {{accepted:boolean, claimedHit:number, reason:'claim'|'whiff'|'locked'|'debounce'|'ignored',
   *            offset?:number, outcome?:string, lockedUntil?:number, feintHit?:number}}
   *   accepted = the press was taken (claim or whiff) → start the defensive animation immediately.
   */
  press(action, t) {
    const verdict = this._press(action, t);
    this.pressHistory.push({ action, t, ...verdict });
    return verdict;
  }

  _press(action, t) {
    if (!DEFENSE_ACTIONS.includes(action) || !Number.isFinite(t)) {
      return { accepted: false, claimedHit: -1, reason: 'ignored' };
    }
    if (t < this._lockedUntil) {
      return { accepted: false, claimedHit: -1, reason: 'locked', lockedUntil: this._lockedUntil };
    }
    // Inside the debounce window a press may only make a *successful* claim on the next hit (a valid action inside
    // that action's window — e.g. a late parry on hit N followed 85 ms later by an early, valid parry on hit N+1 in
    // a 180 ms burst). Anything else it would do — fail a claim, whiff, bite a feint — is treated as a double tap.
    const debounced = this._lastClaimT !== null && Math.abs(t - this._lastClaimT) < DEBOUNCE_MS;
    const debounce = { accepted: false, claimedHit: -1, reason: 'debounce' };

    const adj = t - this.calibration;
    let candidate = null;
    for (const h of this._real) {
      if (this.results[h.index]) continue;
      const claim = this.claims[h.index];
      if (claim) {
        if (t >= claim.resolveAt) continue; // resolved (update() may simply not have run yet)
        // already claimed: first claim decides
        return debounced ? debounce : { accepted: false, claimedHit: -1, reason: 'ignored' };
      }
      if (adj > h.t + this._zones[h.index].post) continue; // zone closed → will resolve as 'hit'
      candidate = h;
      break;
    }

    const inZone = candidate !== null && adj >= candidate.t - this._zones[candidate.index].pre;
    if (inZone) {
      const feint = this._baitingFeint(adj, Math.abs(adj - candidate.t));
      if (feint) return debounced ? debounce : this._whiff(action, t, feint.index);
      const offset = adj - candidate.t;
      const outcome = judgeDefense(candidate.type, action, offset, this.windows);
      if (debounced && !isAvoided(outcome)) return debounce;
      const resolveAt = Math.max(candidate.t, t);
      this.claims[candidate.index] = { action, t, offset, outcome, resolveAt };
      this._lastClaimT = t;
      return { accepted: true, claimedHit: candidate.index, reason: 'claim', offset, outcome };
    }
    if (debounced) return debounce;
    const feint = this._baitingFeint(adj, Infinity);
    return this._whiff(action, t, feint ? feint.index : -1);
  }

  /** The feint whose bait zone contains adj and which is strictly nearer than `bestDistance`. */
  _baitingFeint(adj, bestDistance) {
    let found = null;
    let best = bestDistance;
    for (const f of this._feints) {
      const z = this._zones[f.index];
      if (adj < f.t - z.pre || adj > f.t + z.post) continue;
      const d = Math.abs(adj - f.t);
      if (d < best) {
        best = d;
        found = f;
      }
    }
    return found;
  }

  _whiff(action, t, feintHit) {
    this._lockedUntil = t + LOCKOUT[action];
    const out = { accepted: true, claimedHit: -1, reason: 'whiff', lockedUntil: this._lockedUntil };
    if (feintHit >= 0) out.feintHit = feintHit;
    return out;
  }

  /**
   * Advance to `now` and return hits that became resolved, in timeline order.
   * Feed all presses with t <= now before calling update(now).
   * @param {number} now  caller-clock time
   * @returns {Array<{hitIndex:number, outcome:string, offset:number|null, action:string|null}>}
   */
  update(now) {
    const out = [];
    if (!Number.isFinite(now)) return out;
    for (const h of this._real) {
      if (this.results[h.index]) continue;
      const claim = this.claims[h.index];
      if (claim) {
        if (now >= claim.resolveAt) this._resolve(h.index, claim.outcome, claim.offset, claim.action, out);
      } else if (now >= h.t && now - this.calibration > h.t + this._zones[h.index].post) {
        this._resolve(h.index, 'hit', null, null, out);
      }
    }
    return out;
  }

  _resolve(hitIndex, outcome, offset, action, out) {
    const result = { outcome, offset, action };
    this.results[hitIndex] = result;
    out.push({ hitIndex, ...result });
  }

  /** True once every non-feint hit has been resolved. */
  isDone() {
    return this._real.every((h) => this.results[h.index] !== null);
  }
}

/**
 * Judges offensive QTE presses against skill-hit prompts.
 * A press claims the earliest unresolved, unclaimed prompt whose good window contains it
 * (rated perfect/good); a press inside no prompt's window is a whiff and locks QTE input for
 * OFFENSE_WINDOWS.whiffLockout ms; presses inside an already-claimed prompt's window, or within
 * DEBOUNCE_MS of a claim, are ignored. Claimed prompts resolve at max(T, claimTime); unclaimed
 * prompts resolve 'miss' at T + good.
 */
export class OffenseTracker {
  /**
   * @param {{prompts:Array<{t:number}>, difficulty?:string|number|{windowScale:number}, calibration?:number}} opts
   */
  constructor({ prompts = [], difficulty = DEFAULT_DIFFICULTY, calibration = 0 } = {}) {
    this.difficulty = difficulty;
    this.windows = windowsFor(difficulty).offense;
    this.calibration = finiteOr(Number(calibration), 0);
    /** Normalised prompts [{index, t}] in the caller's order. */
    this.prompts = (Array.isArray(prompts) ? prompts : []).map((p, index) => {
      const t = Number(p?.t);
      return { index, t: Number.isFinite(t) ? t : 0 };
    });
    /** Per prompt: null until resolved, then {rating, offset}. */
    this.results = this.prompts.map(() => null);
    /** Per prompt: null until claimed, then {t, offset, rating, resolveAt}. */
    this.claims = this.prompts.map(() => null);
    this.pressHistory = [];
    this._ordered = [...this.prompts].sort(byTime);
    this._lockedUntil = -Infinity;
    this._lastClaimT = null;
  }

  /** Caller-clock time until which QTE input is locked (−Infinity when never locked). */
  get lockedUntil() {
    return this._lockedUntil;
  }

  isLocked(t) {
    return t < this._lockedUntil;
  }

  /** Caller-clock time at which prompt i resolves 'miss' if never claimed. */
  unclaimedResolveTime(i) {
    const p = this.prompts[i];
    if (!p) return NaN;
    return Math.max(p.t, p.t + this.windows.good + this.calibration);
  }

  /**
   * Feed one QTE press.
   * @param {number} t  press time on the caller's clock
   * @returns {{accepted:boolean, claimedPrompt:number, reason:'claim'|'whiff'|'locked'|'debounce'|'ignored',
   *            rating?:'perfect'|'good', offset?:number, lockedUntil?:number}}
   */
  press(t) {
    const verdict = this._press(t);
    this.pressHistory.push({ t, ...verdict });
    return verdict;
  }

  _press(t) {
    if (!Number.isFinite(t)) return { accepted: false, claimedPrompt: -1, reason: 'ignored' };
    if (t < this._lockedUntil) return { accepted: false, claimedPrompt: -1, reason: 'locked', lockedUntil: this._lockedUntil };
    if (this._lastClaimT !== null && Math.abs(t - this._lastClaimT) < DEBOUNCE_MS) {
      return { accepted: false, claimedPrompt: -1, reason: 'debounce' };
    }
    const adj = t - this.calibration;
    const good = this.windows.good;
    let insideClaimed = false;
    for (const p of this._ordered) {
      if (Math.abs(adj - p.t) > good) continue;
      if (this.results[p.index] || this.claims[p.index]) {
        insideClaimed = true;
        continue;
      }
      const offset = adj - p.t;
      const rating = judgeOffense(offset, this.windows);
      this.claims[p.index] = { t, offset, rating, resolveAt: Math.max(p.t, t) };
      this._lastClaimT = t;
      return { accepted: true, claimedPrompt: p.index, reason: 'claim', rating, offset };
    }
    if (insideClaimed) return { accepted: false, claimedPrompt: -1, reason: 'ignored' };
    this._lockedUntil = t + OFFENSE_WINDOWS.whiffLockout;
    return { accepted: true, claimedPrompt: -1, reason: 'whiff', lockedUntil: this._lockedUntil };
  }

  /**
   * Advance to `now`; returns newly resolved prompts in timeline order.
   * @param {number} now
   * @returns {Array<{promptIndex:number, rating:'perfect'|'good'|'miss', offset:number|null}>}
   */
  update(now) {
    const out = [];
    if (!Number.isFinite(now)) return out;
    for (const p of this._ordered) {
      if (this.results[p.index]) continue;
      const claim = this.claims[p.index];
      if (claim) {
        if (now >= claim.resolveAt) this._resolve(p.index, claim.rating, claim.offset, out);
      } else if (now >= p.t && now - this.calibration > p.t + this.windows.good) {
        this._resolve(p.index, 'miss', null, out);
      }
    }
    return out;
  }

  _resolve(promptIndex, rating, offset, out) {
    this.results[promptIndex] = { rating, offset };
    out.push({ promptIndex, rating, offset });
  }

  /** True once every prompt has been resolved. */
  isDone() {
    return this.results.every((r) => r !== null);
  }
}

/**
 * Maps real (performance.now) timestamps onto a local timeline whose speed can change, e.g. a battle
 * clock slowed to 0.05× during hit-stop. Feed setScale() at the frame a speed change starts, then
 * convert press timestamps with toLocal() before handing them to a tracker.
 */
export class AttackClock {
  /**
   * @param {number} [realStart=0]  real time that maps to `localStart`
   * @param {{scale?:number, localStart?:number}} [opts]
   */
  constructor(realStart = 0, { scale = 1, localStart = 0 } = {}) {
    this._segs = [{ real: realStart, local: localStart, scale: Math.max(0, finiteOr(scale, 1)) }];
  }

  /** Current speed multiplier. */
  get scale() {
    return this._segs[this._segs.length - 1].scale;
  }

  /**
   * Change the speed from real time `realNow` onwards (calls must be chronological).
   * @param {number} scale
   * @param {number} realNow
   */
  setScale(scale, realNow) {
    const s = Math.max(0, finiteOr(scale, 1));
    const last = this._segs[this._segs.length - 1];
    const at = Math.max(realNow, last.real);
    if (at === last.real) {
      last.scale = s;
      return;
    }
    if (s === last.scale) return;
    this._segs.push({ real: at, local: this.toLocal(at), scale: s });
  }

  /**
   * Convert a real timestamp to local time.
   * @param {number} realT
   * @returns {number}
   */
  toLocal(realT) {
    const segs = this._segs;
    let seg = segs[0];
    for (let i = segs.length - 1; i >= 0; i--) {
      if (segs[i].real <= realT) {
        seg = segs[i];
        break;
      }
    }
    return seg.local + (realT - seg.real) * seg.scale;
  }
}
