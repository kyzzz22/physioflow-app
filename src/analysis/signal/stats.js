// Statistics and a small, dependency-free ML layer.
//
// The models here exist so the pipeline can train and predict on synthetic data
// without a round trip; BioDB's own /sensor/analysis/* endpoints are the server-side
// counterpart (see fetchBioDBAnalysis in bioDBClient.js).

/** Sample mean and sample (n-1) standard deviation. */
export function meanSd(values) {
  const clean = values.filter(v => v !== null && v !== undefined && !Number.isNaN(v));
  const n = clean.length;
  if (!n) return { n: 0, mean: null, sd: null };
  const mean = clean.reduce((sum, v) => sum + v, 0) / n;
  const variance = n > 1 ? clean.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (n - 1) : 0;
  return { n, mean, sd: Math.sqrt(variance) };
}

/** Pearson correlation; null when either series is constant or too short. */
export function pearson(xs, ys) {
  const pairs = xs.map((x, i) => [x, ys[i]])
    .filter(([x, y]) => x !== null && y !== null && x !== undefined && y !== undefined && !Number.isNaN(x) && !Number.isNaN(y));
  const n = pairs.length;
  if (n < 3) return { n, r: null };
  const mx = pairs.reduce((s, [x]) => s + x, 0) / n;
  const my = pairs.reduce((s, [, y]) => s + y, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (const [x, y] of pairs) {
    const a = x - mx;
    const b = y - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  if (dx === 0 || dy === 0) return { n, r: null };
  return { n, r: num / Math.sqrt(dx * dy) };
}

// ── incomplete beta, used for the t-distribution's two-sided p-value ──
function logGamma(z) {
  const g = [
    676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012,
    9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z);
  const x = z - 1;
  let a = 0.99999999999980993;
  const t = x + 7.5;
  for (let i = 0; i < g.length; i += 1) a += g[i] / (x + i + 1);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

function incompleteBeta(x, a, b) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  if (x < (a + 1) / (a + b + 2)) return front * betacf(x, a, b) / a;
  return 1 - Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + b * Math.log(1 - x) + a * Math.log(x)) * betacf(1 - x, b, a) / b;
}

function betacf(x, a, b) {
  const tiny = 1e-30;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - qab * x / qap;
  if (Math.abs(d) < tiny) d = tiny;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 200; m += 1) {
    const m2 = 2 * m;
    let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < tiny) d = tiny;
    c = 1 + aa / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    h *= d * c;
    aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < tiny) d = tiny;
    c = 1 + aa / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 3e-12) break;
  }
  return h;
}

/** Two-sided p-value for Student's t. */
export function tTestPValue(t, df) {
  if (!(df > 0) || !Number.isFinite(t)) return null;
  return incompleteBeta(df / (df + t * t), df / 2, 0.5);
}

/**
 * Welch's t-test — does not assume equal variances, which is the right default
 * when comparing two physiological conditions.
 */
export function welchTTest(groupA, groupB) {
  const a = meanSd(groupA);
  const b = meanSd(groupB);
  if (a.n < 2 || b.n < 2 || a.sd === null || b.sd === null) {
    return { nA: a.n, nB: b.n, meanA: a.mean, meanB: b.mean, t: null, df: null, p: null };
  }
  const se = Math.sqrt((a.sd ** 2 / a.n) + (b.sd ** 2 / b.n));
  if (se === 0) return { nA: a.n, nB: b.n, meanA: a.mean, meanB: b.mean, t: null, df: null, p: null };
  const t = (a.mean - b.mean) / se;
  const df = ((a.sd ** 2 / a.n + b.sd ** 2 / b.n) ** 2)
    / (((a.sd ** 2 / a.n) ** 2) / (a.n - 1) + ((b.sd ** 2 / b.n) ** 2) / (b.n - 1));
  return { nA: a.n, nB: b.n, meanA: a.mean, meanB: b.mean, t, df, p: tTestPValue(t, df) };
}

/** Cohen's d using the pooled standard deviation. */
export function cohensD(groupA, groupB) {
  const a = meanSd(groupA);
  const b = meanSd(groupB);
  if (a.n < 2 || b.n < 2) return null;
  const pooled = Math.sqrt((((a.n - 1) * a.sd ** 2) + ((b.n - 1) * b.sd ** 2)) / (a.n + b.n - 2));
  return pooled > 0 ? (a.mean - b.mean) / pooled : null;
}

/** Descriptive summary used by the analysis export. */
export function summarize(values) {
  const { n, mean, sd } = meanSd(values);
  return { n, mean, sd, se: sd && n ? sd / Math.sqrt(n) : null };
}

// ── models ──

/**
 * Ridge regression (ordinary least squares when alpha is 0).
 * Solved with Gauss-Jordan elimination, which is fine for the small feature
 * counts this pipeline produces and avoids a numerical dependency.
 */
export class RidgeRegression {
  constructor({ alpha = 0, fitIntercept = true } = {}) {
    this.alpha = alpha;
    this.fitIntercept = fitIntercept;
    this.coefficients = null;
    this.intercept = 0;
    this.featureNames = [];
  }

  fit(X, y, featureNames = []) {
    const rows = X.length;
    if (!rows) throw new Error('no training samples');
    const cols = X[0].length;
    this.featureNames = featureNames.length ? featureNames : X[0].map((_, i) => `x${i}`);
    const means = new Array(cols).fill(0);
    if (this.fitIntercept) {
      for (let j = 0; j < cols; j += 1) means[j] = X.reduce((sum, row) => sum + row[j], 0) / rows;
    }
    const yMean = this.fitIntercept ? y.reduce((sum, v) => sum + v, 0) / rows : 0;
    // Augmented normal equations: ridge penalty on the slope terms only.
    const A = Array.from({ length: cols + 1 }, () => new Array(cols + 2).fill(0));
    for (let i = 0; i < rows; i += 1) {
      const xi = X[i].map((v, j) => v - means[j]);
      const yi = y[i] - yMean;
      for (let j = 0; j <= cols; j += 1) {
        const xij = j === cols ? 1 : xi[j];
        for (let k = 0; k <= cols; k += 1) A[j][k] += xij * (k === cols ? 1 : xi[k]);
        A[j][cols + 1] += xij * yi;
      }
    }
    for (let j = 0; j < cols; j += 1) A[j][j] += this.alpha * rows;
    const solution = solveLinearSystem(A);
    this.coefficients = solution.slice(0, cols);
    this.centering = means;
    this.intercept = this.fitIntercept
      ? yMean - this.coefficients.reduce((sum, c, j) => sum + c * means[j], 0)
      : (solution[cols] || 0);
    return this;
  }

  predict(X) {
    if (!this.coefficients) throw new Error('model is not fitted');
    return X.map(row => this.intercept + this.coefficients.reduce((sum, c, j) => sum + c * row[j], 0));
  }

  /** R² on held data; 1 is perfect, 0 means no better than the mean. */
  score(X, y) {
    const predictions = this.predict(X);
    const mean = y.reduce((sum, v) => sum + v, 0) / y.length;
    const ssRes = y.reduce((sum, v, i) => sum + (v - predictions[i]) ** 2, 0);
    const ssTot = y.reduce((sum, v) => sum + (v - mean) ** 2, 0);
    return ssTot > 0 ? 1 - ssRes / ssTot : null;
  }

  toJSON() {
    return {
      type: 'ridge_regression',
      alpha: this.alpha,
      intercept: this.intercept,
      coefficients: this.coefficients,
      featureNames: this.featureNames,
    };
  }
}

/** Gauss-Jordan elimination with partial pivoting on an augmented matrix. */
function solveLinearSystem(augmented) {
  const n = augmented.length;
  const a = augmented.map(row => [...row]);
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < n; row += 1) {
      if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    }
    if (Math.abs(a[pivot][col]) < 1e-12) continue;
    [a[col], a[pivot]] = [a[pivot], a[col]];
    const divisor = a[col][col];
    for (let k = col; k <= n; k += 1) a[col][k] /= divisor;
    for (let row = 0; row < n; row += 1) {
      if (row === col) continue;
      const factor = a[row][col];
      if (factor === 0) continue;
      for (let k = col; k <= n; k += 1) a[row][k] -= factor * a[col][k];
    }
  }
  return a.map(row => row[n]);
}

/**
 * k-means with a deterministic seeded generator, so repeated runs on the same
 * data give the same labels — important when the result is written to an export.
 */
export class KMeans {
  constructor({ clusters = 3, maxIterations = 100, randomState = 42 } = {}) {
    this.clusters = clusters;
    this.maxIterations = maxIterations;
    this.randomState = randomState;
    this.centroids = null;
    this.labels = null;
  }

  fit(X) {
    const rows = X.length;
    if (!rows) throw new Error('no training samples');
    const k = Math.min(this.clusters, rows);
    const random = mulberry32(this.randomState);
    const picked = new Set();
    this.centroids = [];
    while (this.centroids.length < k) {
      const index = Math.floor(random() * rows);
      if (picked.has(index)) continue;
      picked.add(index);
      this.centroids.push([...X[index]]);
    }
    this.labels = new Array(rows).fill(0);
    for (let iteration = 0; iteration < this.maxIterations; iteration += 1) {
      let moved = false;
      for (let i = 0; i < rows; i += 1) {
        const label = nearestCentroid(X[i], this.centroids);
        if (label !== this.labels[i]) { this.labels[i] = label; moved = true; }
      }
      const sums = Array.from({ length: k }, () => ({ sum: new Array(X[0].length).fill(0), count: 0 }));
      for (let i = 0; i < rows; i += 1) {
        const label = this.labels[i];
        sums[label].count += 1;
        for (let j = 0; j < X[i].length; j += 1) sums[label].sum[j] += X[i][j];
      }
      this.centroids = sums.map(({ sum, count }) => (count ? sum.map(v => v / count) : this.centroids[0]));
      if (!moved) break;
    }
    this.inertia = X.reduce((total, row, i) => total + squaredDistance(row, this.centroids[this.labels[i]]), 0);
    return this;
  }

  predict(X) {
    if (!this.centroids) throw new Error('model is not fitted');
    return X.map(row => nearestCentroid(row, this.centroids));
  }

  toJSON() {
    return { type: 'kmeans', clusters: this.centroids?.length ?? 0, centroids: this.centroids, randomState: this.randomState };
  }
}

function nearestCentroid(point, centroids) {
  let best = 0;
  let bestDistance = Infinity;
  for (let i = 0; i < centroids.length; i += 1) {
    const distance = squaredDistance(point, centroids[i]);
    if (distance < bestDistance) { bestDistance = distance; best = i; }
  }
  return best;
}

function squaredDistance(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += (a[i] - b[i]) ** 2;
  return sum;
}

/** Seeded PRNG (mulberry32) — deterministic across runs and platforms. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Label counts, e.g. { 0: 12, 1: 8 }. */
export function labelDistribution(labels) {
  const out = {};
  for (const label of labels) out[label] = (out[label] || 0) + 1;
  return out;
}
