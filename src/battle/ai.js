// Enemy AI for Expedition 69 battles (SPEC §3.2 "Enemy AI"): phase attack pools, cooldown and condition
// filtering (selfHpBelow / allyHpBelow / shieldsBelow / notStatus), weighted random choice and target
// selection decided at plan time (single / all / multi). Pure; randomness only via the injected rng.next().

/**
 * Weighted random pick using only rng.next().
 * @template T
 * @param {T[]} items
 * @param {(item:T)=>number} weightFn
 * @param {{next:()=>number}} rng
 * @returns {T|null}
 */
export function weightedPick(items, weightFn, rng) {
  if (!items || items.length === 0) return null;
  const weights = items.map((it) => Math.max(0, Number(weightFn(it)) || 0));
  const total = weights.reduce((s, w) => s + w, 0);
  if (total <= 0) return items[Math.min(items.length - 1, Math.floor(rng.next() * items.length))];
  let r = rng.next() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r < 0 && weights[i] > 0) return items[i];
  }
  for (let i = items.length - 1; i >= 0; i--) if (weights[i] > 0) return items[i];
  return items[items.length - 1];
}

/** Uniform pick using rng.next(). */
export function randomPick(items, rng) {
  if (!items || items.length === 0) return null;
  return items[Math.min(items.length - 1, Math.floor(rng.next() * items.length))];
}

/**
 * Attack ids of the enemy's current phase pool (phaseIndex 0 = base pool, k = phases[k-1].pool).
 * Falls back to every attack id when a pool is missing or empty.
 * @param {object} enemy combatant
 * @returns {string[]}
 */
export function phasePool(enemy) {
  const phase = enemy.phaseIndex > 0 ? enemy.phases?.[enemy.phaseIndex - 1] : null;
  const pool = phase?.pool ?? enemy.pool;
  const attacks = enemy.attacks ?? {};
  const ids = (Array.isArray(pool) && pool.length ? pool : Object.keys(attacks)).filter((id) => attacks[id]);
  return ids.length ? ids : Object.keys(attacks);
}

/**
 * Phase index an enemy should be in for an HP fraction (phases entered in order while hpFrac < hpBelow).
 * @param {{hpBelow:number}[]} phases
 * @param {number} hpFrac
 * @param {number} [current=0]
 */
export function phaseIndexForHp(phases, hpFrac, current = 0) {
  let idx = current;
  while (Array.isArray(phases) && idx < phases.length && hpFrac < (phases[idx]?.hpBelow ?? 0)) idx++;
  return idx;
}

/**
 * Cooldown check: an attack with `cooldown: N` cannot be chosen during the N turns after it was used.
 * @returns {boolean}
 */
export function attackOnCooldown(enemy, attackId) {
  const atk = enemy.attacks?.[attackId];
  const cd = atk?.cooldown ?? 0;
  const last = enemy.lastUsed?.[attackId];
  if (!(cd > 0) || last == null) return false;
  return (enemy.turnsTaken ?? 0) - last <= cd;
}

const hpFrac = (c) => (c?.stats?.maxHp ? c.hp / c.stats.maxHp : 0);

/**
 * Evaluates an EnemyAttack condition. All present keys must hold:
 * selfHpBelow (own hp fraction), allyHpBelow (any living enemy-side combatant, self included),
 * shieldsBelow (own shields), notStatus (own statuses).
 * @returns {boolean}
 */
export function conditionMet(model, enemy, condition) {
  if (!condition) return true;
  if (typeof condition.selfHpBelow === 'number' && !(hpFrac(enemy) < condition.selfHpBelow)) return false;
  if (typeof condition.allyHpBelow === 'number') {
    const allies = (model?.enemies ?? [enemy]).filter((e) => e.alive);
    if (!allies.some((a) => hpFrac(a) < condition.allyHpBelow)) return false;
  }
  if (typeof condition.shieldsBelow === 'number' && !((enemy.shields ?? 0) < condition.shieldsBelow)) return false;
  if (condition.notStatus && Array.isArray(enemy.statuses) && enemy.statuses.some((s) => s.id === condition.notStatus)) {
    return false;
  }
  return true;
}

/** Silenced enemies cannot use spell-like actions: no damaging hits, or any gradient hit. */
function isSpellLike(atk) {
  const hits = Array.isArray(atk?.hits) ? atk.hits : [];
  return hits.length === 0 || hits.every((h) => h.type === 'feint') || hits.some((h) => h.type === 'gradient');
}

/**
 * Attack ids the enemy may use right now: current phase pool filtered by cooldown, condition and silence.
 * Falls back progressively (ignore conditions, then cooldowns) so an enemy always has something to do.
 * @returns {string[]}
 */
export function availableAttacks(model, enemy) {
  const pool = phasePool(enemy);
  const silenced = Array.isArray(enemy.statuses) && enemy.statuses.some((s) => s.id === 'silence');
  const bySilence = (id) => !silenced || !isSpellLike(enemy.attacks[id]);
  let ids = pool.filter((id) => bySilence(id) && !attackOnCooldown(enemy, id) && conditionMet(model, enemy, enemy.attacks[id].condition));
  if (ids.length) return ids;
  // Conditions exist to gate special moves; fall back to the unconditioned ones first.
  ids = pool.filter((id) => bySilence(id) && !attackOnCooldown(enemy, id) && !enemy.attacks[id].condition);
  if (ids.length) return ids;
  ids = pool.filter((id) => bySilence(id) && !enemy.attacks[id].condition);
  if (ids.length) return ids;
  ids = pool.filter(bySilence);
  return ids.length ? ids : pool;
}

/**
 * Chooses targets for an attack at plan time.
 * single → one random living party member for every hit; all → every living member; multi → each hit
 * picks a random living member. Returns the union and the per-hit lists.
 * @returns {{ targetIds: string[], hitTargets: string[][] }}
 */
export function pickTargets(model, enemy, attack, rng) {
  const living = (model?.party ?? []).filter((m) => m.alive).map((m) => m.id);
  const hits = Array.isArray(attack?.hits) ? attack.hits : [];
  if (living.length === 0) return { targetIds: [], hitTargets: hits.map(() => []) };
  const mode = attack?.target ?? 'single';
  if (mode === 'all') return { targetIds: [...living], hitTargets: hits.map(() => [...living]) };
  if (mode === 'multi') {
    const hitTargets = hits.map(() => [randomPick(living, rng)]);
    const union = living.filter((id) => hitTargets.some((t) => t[0] === id));
    return { targetIds: union.length ? union : [living[0]], hitTargets };
  }
  const one = randomPick(living, rng);
  return { targetIds: [one], hitTargets: hits.map(() => [one]) };
}

/**
 * Picks the enemy's next action: weighted random over available attacks, then targets.
 * @param {object} model BattleModel (reads `party` / `enemies`)
 * @param {object} enemy enemy combatant
 * @param {{next:()=>number}} rng
 * @returns {{ attackId: string|null, targetIds: string[], hitTargets: string[][] }}
 */
export function chooseEnemyAction(model, enemy, rng) {
  const ids = availableAttacks(model, enemy);
  const attackId = weightedPick(ids, (id) => enemy.attacks[id]?.weight ?? 1, rng);
  if (!attackId) return { attackId: null, targetIds: [], hitTargets: [] };
  const { targetIds, hitTargets } = pickTargets(model, enemy, enemy.attacks[attackId], rng);
  return { attackId, targetIds, hitTargets };
}
