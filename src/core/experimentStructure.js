// Experiment-structure support for the Protocol Graph architecture.
// Pure, deterministic helpers that bring back the legacy Block→Trial semantics
// (presentation order rules + ITI jitter) WITHOUT re-introducing a second hierarchy:
// they emit plain order/jitter data that Composer can render into existing
// logic.random / timing components and that a future runtime strategy can consume.
// All randomness is seed-injected to match Runtime V2's determinism rules.

function mulberry32(seed) {
  let state = seed >>> 0;
  return function random() {
    state = (state + 0x6D2B79F5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function constrainSequence(order, maxConsecutiveSame, noImmediateRepeat) {
  const max = noImmediateRepeat ? 1 : Math.max(1, Math.min(maxConsecutiveSame, order.length));
  const next = [...order];
  let run = 0;
  let prev = null;
  for (let i = 0; i < next.length; i++) {
    if (next[i] === prev) {
      run += 1;
      if (run > max) {
        let j = i + 1;
        while (j < next.length && next[j] === prev) j += 1;
        if (j < next.length) { [next[i], next[j]] = [next[j], next[i]]; run = 1; }
      }
    } else {
      run = 1;
      prev = next[i];
    }
  }
  return next;
}

/**
 * Compute a presentation order for a set of items.
 * @param {object} options
 * @param {string[]} options.items item identifiers
 * @param {'fixed'|'random'|'latin_square'|'manual'} [options.rule='fixed']
 * @param {number} [options.seed=1] deterministic seed (random/latin_square)
 * @param {string[]} [options.manualOrder] explicit order for 'manual'
 * @param {number} [options.maxConsecutiveSame=Infinity]
 * @param {boolean} [options.noImmediateRepeat=false]
 * @returns {{ order: string[], rule: string, seed: number, items: string[] }}
 */
export function createBlockOrder({ items = [], rule = 'fixed', seed = 1, manualOrder = [], maxConsecutiveSame = Infinity, noImmediateRepeat = false }) {
  const ids = [...items];
  const rand = mulberry32(seed);
  let order;
  if (rule === 'fixed') {
    order = [...ids];
  } else if (rule === 'latin_square') {
    const n = ids.length;
    const row = ((seed % n) + n) % n;
    order = ids.map((_, i) => ids[(i + row) % n]);
  } else if (rule === 'manual') {
    order = manualOrder.filter(id => ids.includes(id));
    for (const id of ids) if (!order.includes(id)) order.push(id);
  } else {
    order = [...ids];
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
  }
  if (noImmediateRepeat || Number.isFinite(maxConsecutiveSame)) {
    order = constrainSequence(order, Number.isFinite(maxConsecutiveSame) ? maxConsecutiveSame : Infinity, Boolean(noImmediateRepeat));
  }
  return { order, rule, seed, items: [...ids] };
}

/**
 * Compute a deterministic ITI duration from a base, a jitter range and a distribution.
 * @param {object} options
 * @param {number} options.baseMs
 * @param {number} [options.jitterMs=0]
 * @param {'fixed'|'uniform'|'normal'|'exponential'} [options.distribution='fixed']
 * @param {number} [options.seed=1]
 * @returns {{ durationMs: number, baseMs: number, jitterMs: number, distribution: string, seed: number, deltaMs: number }}
 */
export function createJitteredDuration({ baseMs, jitterMs = 0, distribution = 'fixed', seed = 1 }) {
  const rand = mulberry32(seed);
  let delta;
  if (distribution === 'uniform') {
    delta = (rand() * 2 - 1) * jitterMs;
  } else if (distribution === 'normal') {
    const u = Math.max(rand(), 0.000001);
    const v = rand();
    delta = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) * jitterMs;
  } else if (distribution === 'exponential') {
    delta = -Math.log(Math.max(rand(), 0.000001)) * jitterMs;
  } else {
    delta = 0;
  }
  const durationMs = Math.max(0, Math.round(baseMs + delta));
  return { durationMs, baseMs, jitterMs, distribution, seed, deltaMs: Math.round(delta) };
}
