// Spectrum analysis: radix-2 FFT, periodogram PSD and band powers.
//
// Implemented here rather than pulled from a dependency so the pipeline stays
// dependency-free and its numerical behaviour is covered by the project's own tests.

/** In-place iterative radix-2 Cooley-Tukey FFT. Requires a power-of-two length. */
export function fft(re, im) {
  const n = re.length;
  if (n === 0) return { re, im };
  if ((n & (n - 1)) !== 0) throw new Error(`FFT length must be a power of two, got ${n}`);

  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }

  for (let len = 2; len <= n; len <<= 1) {
    const angle = -2 * Math.PI / len;
    const wRe = Math.cos(angle);
    const wIm = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let curRe = 1;
      let curIm = 0;
      for (let k = 0; k < len / 2; k += 1) {
        const uRe = re[i + k];
        const uIm = im[i + k];
        const vRe = re[i + k + len / 2] * curRe - im[i + k + len / 2] * curIm;
        const vIm = re[i + k + len / 2] * curIm + im[i + k + len / 2] * curRe;
        re[i + k] = uRe + vRe;
        im[i + k] = uIm + vIm;
        re[i + k + len / 2] = uRe - vRe;
        im[i + k + len / 2] = uIm - vIm;
        const nextRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
      }
    }
  }
  return { re, im };
}

/** Largest power of two <= n. */
export function nextPowerOfTwoDown(n) {
  let size = 1;
  while (size * 2 <= n) size *= 2;
  return size;
}

/** Hann window of the given length. */
export function hannWindow(length) {
  return Array.from({ length }, (_, i) => 0.5 * (1 - Math.cos(2 * Math.PI * i / (length - 1 || 1))));
}

/**
 * One-sided PSD estimate (periodogram) of a real signal.
 * The signal is detrended by its mean, zero-padded or trimmed to a power of two,
 * and windowed with Hann to reduce spectral leakage.
 */
export function powerSpectralDensity(samples, sampleRateHz) {
  const size = nextPowerOfTwoDown(samples.length);
  if (size < 2 || !(sampleRateHz > 0)) return { frequencies: [], power: [], resolutionHz: null };
  const segment = samples.slice(0, size);
  const mean = segment.reduce((sum, v) => sum + v, 0) / size;
  const window = hannWindow(size);
  const re = segment.map((v, i) => (v - mean) * window[i]);
  const im = new Array(size).fill(0);
  fft(re, im);
  const half = size / 2;
  const power = new Array(half);
  const frequencies = new Array(half);
  const windowEnergy = window.reduce((sum, w) => sum + w * w, 0) || 1;
  for (let k = 0; k < half; k += 1) {
    power[k] = (re[k] * re[k] + im[k] * im[k]) / (sampleRateHz * windowEnergy);
    frequencies[k] = k * sampleRateHz / size;
  }
  return { frequencies, power, resolutionHz: sampleRateHz / size };
}

/**
 * Absolute and relative band power over [lowHz, highHz].
 * `relative` is the band's share of total power, which is what most physiology
 * indices (alpha asymmetry, LF/HF ratio) are actually defined on.
 */
export function bandPower(psd, lowHz, highHz) {
  let band = 0;
  let total = 0;
  for (let i = 0; i < psd.frequencies.length; i += 1) {
    const f = psd.frequencies[i];
    const p = psd.power[i];
    total += p;
    if (f >= lowHz && f < highHz) band += p;
  }
  return { absolute: band, relative: total > 0 ? band / total : 0, total };
}

export const EEG_BANDS = Object.freeze({
  delta: [0.5, 4],
  theta: [4, 8],
  alpha: [8, 13],
  beta: [13, 30],
  gamma: [30, 45],
});

export const HRV_BANDS = Object.freeze({
  vlf: [0.003, 0.04],
  lf: [0.04, 0.15],
  hf: [0.15, 0.4],
});

/** Power in each named band, both absolute and relative. */
export function bandPowers(psd, bands = EEG_BANDS) {
  const out = {};
  for (const [name, [low, high]] of Object.entries(bands)) out[name] = bandPower(psd, low, high);
  return out;
}

/** Dominant frequency (the bin with the most power), ignoring DC when possible. */
export function dominantFrequency(psd) {
  let bestIndex = 0;
  let best = -Infinity;
  for (let i = 1; i < psd.power.length; i += 1) {
    if (psd.power[i] > best) { best = psd.power[i]; bestIndex = i; }
  }
  return bestIndex ? psd.frequencies[bestIndex] : null;
}
