import { compileTrialFlow } from './flowEngine.js';

export function resolveTrials(trials, rule = 'fixed', n = 0, manualOrder = [], constraints = {}) {
  const a = [...trials];
  const validRules = ['fixed', 'random', 'latin_square', 'manual'];
  const { max_consecutive_same: maxConsec = 0, no_immediate_repeat: noRepeat = false } = constraints || {};

  if (!validRules.includes(rule)) {
    console.warn(`resolveTrials: unrecognized rule "${rule}" — falling back to fixed`);
    return a;
  }

  if (rule === 'latin_square' && a.length) {
    const k = ((n % a.length) + a.length) % a.length;
    return [...a.slice(k), ...a.slice(0, k)];
  }

  if (rule === 'random') {
    let seed = (n + 1) * 2654435761;
    const nextRandom = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed; };

    const shuffle = arr => {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = nextRandom() % (i + 1);
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    };

    // Simple shuffle if no constraints
    if (!noRepeat && !maxConsec) return shuffle(a);

    // Constrained randomization: no immediate repeat of same condition,
    // and/or max consecutive trials with the same condition
    const ordered = [];
    const remaining = [...a];

    while (remaining.length > 0) {
      if (remaining.length === 1) {
        ordered.push(...remaining);
        remaining.length = 0;
        break;
      }

      let candidates = [...remaining];

      // Filter out trials that would create an immediate repeat
      if (noRepeat && ordered.length > 0) {
        const lastCondition = ordered[ordered.length - 1].condition;
        candidates = candidates.filter(t => t.condition !== lastCondition);
      }

      // Filter out trials that would exceed max consecutive same condition
      if (maxConsec > 0 && ordered.length >= maxConsec) {
        const recent = ordered.slice(-maxConsec);
        const allSame = recent.every(t => t.condition === recent[0].condition);
        if (allSame) {
          candidates = candidates.filter(t => t.condition !== recent[0].condition);
        }
      }

      // Fallback: if constraints eliminated all candidates, relax them
      if (candidates.length === 0) {
        candidates = [...remaining];
      }

      const pick = candidates[nextRandom() % candidates.length];
      ordered.push(pick);
      remaining.splice(remaining.indexOf(pick), 1);
    }

    return ordered;
  }

  if (rule === 'manual' && manualOrder.length) {
    const rank = new Map(manualOrder.map((id, index) => [id, index]));
    return a
      .map((trial, index) => ({ trial, index }))
      .sort((left, right) =>
        (rank.get(left.trial.trial_id) ?? manualOrder.length + left.index) -
        (rank.get(right.trial.trial_id) ?? manualOrder.length + right.index)
      )
      .map(item => item.trial);
  }

  return a;
}

/** Generate ITI jitter duration in milliseconds based on the configured distribution. */
export function generateItiJitter(jitterMs, distribution = 'fixed') {
  if (!jitterMs || jitterMs <= 0) return 0;
  switch (distribution) {
    case 'uniform': return Math.random() * jitterMs;
    case 'normal': {
      // Box-Muller: mean=jitterMs/2, sd=jitterMs/4 (99.7% within 0..jitterMs)
      let u = 0, v = 0;
      while (u === 0) u = Math.random();
      while (v === 0) v = Math.random();
      const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
      return Math.max(0, Math.min(jitterMs, jitterMs / 2 + z * jitterMs / 4));
    }
    case 'exponential': {
      // Exponential with mean=jitterMs/3, capped at jitterMs
      return Math.min(jitterMs, -Math.log(Math.max(1e-10, Math.random())) * jitterMs / 3);
    }
    case 'fixed':
    default: return jitterMs;
  }
}
export function flattenProtocol(p,runtime=0){const n=(runtime!=null&&typeof runtime==='object')?(runtime.order_row||0):runtime,values=(runtime!=null&&typeof runtime==='object')?runtime:{};const manualOrders=(runtime!=null&&typeof runtime==='object')?runtime.manual_orders||{}:{};return (p?.blocks||[]).flatMap((b,bi)=>resolveTrials(b?.trials||[],b.order_rule,n,manualOrders[b.block_id]||[],{max_consecutive_same:b.max_consecutive_same||0,no_immediate_repeat:b.no_immediate_repeat||false}).flatMap((t,ti)=>compileTrialFlow(t,{...values,condition:t.condition}).map((s,si)=>({block:b,block_order:bi,trial:t,trial_order:ti,step:s,step_order:si}))))}

const LOG_SCHEMA_VERSION = '1.2.0';

// ── High-resolution timestamp helpers ──
// performance.timeOrigin = high-res time origin in ms since Unix epoch
// performance.now()     = high-res monotonic ms since timeOrigin
// Adding them = high-res wall-clock timestamp with ~5µs precision
function formatIsoHighRes(epochMs) {
  // Convert high-res epoch ms to ISO 8601 with microsecond precision
  // e.g. 1782988096376.943847 → "2026-07-02T03:37:00.943847Z"
  const msInt = Math.floor(epochMs);
  const micros = Math.round((epochMs - msInt) * 1000); // 0-999 µs
  const d = new Date(msInt);
  // ISO gives "2026-07-02T03:37:00.943Z" — append µs before the Z
  return d.toISOString().replace(/Z$/, `${String(micros).padStart(3, '0')}Z`);
  // Result: "2026-07-02T03:37:00.943847Z"
}

export function createLogger(session, initial = []) {
  const origin = performance.now();        // monotonic offset when logger was created
  const originEpoch = performance.timeOrigin; // high-res epoch at logger creation
  const events = [...initial];
  const base = Number(events.at(-1)?.elapsed_monotonic_ms || 0); // carry over from recovery

  return {
    /**
     * Append an event to the log.
     * @param {string} event_type — e.g. 'step_entered', 'media_play_started'
     * @param {object} c — context (block/trial/step IDs, condition, stimulus_id)
     * @param {object} metadata — optional metadata (status, answers, marker info)
     * @returns {object} frozen event object
     */
    append(event_type, c = {}, metadata = {}) {
      // Monotonic elapsed: monotonic, no clock skew, high-res
      const elapsed = base + performance.now() - origin; // ms, float (sub-µs precision from performance.now)

      // Wall-clock: high-resolution epoch via performance.timeOrigin + performance.now()
      // NOTE: base is intentionally NOT added — epoch is always current wall-clock time
      const epochHighRes = originEpoch + performance.now(); // ms, float

      // Fallback wall-clock: standard Date.now() (integer ms) — for backward compat
      const epochFallback = Date.now();

      const e = {
        // ── Schema ──
        schema_version: LOG_SCHEMA_VERSION,

        // ── Identity ──
        event_id: crypto.randomUUID(),
        session_id: session.session_id,
        participant_id: session.participant_id,
        protocol_id: session.protocol_id,
        protocol_version: session.protocol_version,

        // ── Hierarchy ──
        block_id: c.block_id || '',
        block_order: c.block_order ?? '',
        block_repeat: c.block_repeat ?? '',
        trial_id: c.trial_id || '',
        trial_order: c.trial_order ?? '',
        trial_repeat: c.trial_repeat ?? '',
        step_id: c.step_id || '',
        step_order: c.step_order ?? '',
        node_id: c.node_id || '',
        condition: c.condition || '',

        // ── Event type ──
        event_type,
        event_status: metadata.status || 'ok',

        // ═══════════════════════════════════════════════
        // ⏱ TIMESTAMPS (three-column time reference)
        // ═══════════════════════════════════════════════

        // ① ISO 8601 with microsecond precision — human-readable, wall-clock
        //    Format: "2026-07-02T03:37:00.123456Z"
        timestamp_iso: formatIsoHighRes(epochHighRes),

        // ② High-resolution Unix epoch (milliseconds, float)
        //    performance.timeOrigin + performance.now()
        //    Typical precision: ~0.005ms (5µs) in Chromium, ~0.001ms in Firefox
        //    Use this for aligning with physiological recording devices
        timestamp_epoch_ms: Math.round(epochHighRes * 1000) / 1000,

        // ③ Monotonic elapsed since session start (milliseconds, float)
        //    Based on performance.now() — immune to wall-clock adjustments
        //    Use this for within-session interval calculations
        elapsed_monotonic_ms: Math.round(elapsed * 1000) / 1000,

        // ── Fallback wall-clock (integer ms, for backward compatibility) ──
        timestamp_epoch_fallback: epochFallback,

        // ── Stimulus ──
        stimulus_id: c.stimulus_id || '',

        // ── Arbitrary metadata ──
        metadata,
      };

      events.push(Object.freeze(e));
      return e;
    },

    /** Return a mutable shallow copy of all events (metadata is deep-copied) */
    snapshot: () => events.map(e => ({
      ...e,
      metadata: { ...e.metadata },
    })),
  };
}

export function contextOf(x) {
  if (!x?.block || !x?.trial || !x?.step) return {
    block_id: '', block_order: 0, trial_id: '', trial_order: 0,
    step_id: '', step_order: 0, condition: '', stimulus_id: '',
  };
  return {
    block_id: x.block.block_id,
    block_order: x.block_order + 1,
    trial_id: x.trial.trial_id,
    trial_order: x.trial_order + 1,
    step_id: x.step.step_id,
    step_order: x.step_order + 1,
    condition: x.trial.condition || '',
    stimulus_id: x.step.stimulus_id || '',
  };
}
