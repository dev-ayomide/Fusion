// Objective checks for generated music (we can't listen, so we measure):
//   integrated loudness (ITU-R BS.1770-4, K-weighted, gated), sample + 4× true peak,
//   per-section loudness, spectral balance by band (Welch-averaged FFT), onset/beat-grid alignment
//   and an autocorrelation tempo estimate.
//   node bench/audio-analyze.mjs file.m4a|file.wav [bpm]      (decodes through the bundled ffmpeg)
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const SR = 48000;
const db = (x) => (x > 0 ? 20 * Math.log10(x) : -Infinity);

/* ------------------------------ loudness ------------------------------ */
function kWeight(x) {
  // BS.1770 pre-filter (high shelf) + RLB high-pass, 48 kHz coefficients
  const st = [
    [1.53512485958697, -2.69169618940638, 1.19839281085285, -1.69065929318241, 0.73248077421585],
    [1, -2, 1, -1.99004745483398, 0.99007225036621],
  ];
  let y = x;
  for (const [b0, b1, b2, a1, a2] of st) {
    const out = new Float32Array(y.length);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < y.length; i++) {
      const v = b0 * y[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1; x1 = y[i]; y2 = y1; y1 = v; out[i] = v;
    }
    y = out;
  }
  return y;
}
/** Mean-square per 400 ms block (75 % overlap) of K-weighted channels, summed over channels. */
function blocks(L, R, from = 0, to = L.length) {
  const kL = kWeight(L.subarray(from, to)), kR = kWeight(R.subarray(from, to));
  const win = Math.round(0.4 * SR), hop = Math.round(0.1 * SR), out = [];
  for (let s = 0; s + win <= kL.length; s += hop) {
    let a = 0;
    for (let i = s; i < s + win; i++) a += kL[i] * kL[i] + kR[i] * kR[i];
    out.push(a / win);
  }
  return out;
}
const lufsOf = (ms) => -0.691 + 10 * Math.log10(ms);
export function integratedLufs(L, R, from, to) {
  const bl = blocks(L, R, from, to).filter((m) => lufsOf(m) > -70);
  if (!bl.length) return -Infinity;
  const rel = lufsOf(bl.reduce((a, b) => a + b, 0) / bl.length) - 10;
  const g = bl.filter((m) => lufsOf(m) > rel);
  return lufsOf(g.reduce((a, b) => a + b, 0) / g.length);
}

/* ------------------------------ peaks ------------------------------ */
const TP_TAPS = (() => {
  // 4-phase windowed-sinc interpolator, 12 taps per phase
  const phases = [];
  for (let p = 0; p < 4; p++) {
    const taps = [];
    for (let k = -6; k < 6; k++) {
      const x = k + p / 4;
      const sinc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
      const w = 0.5 + 0.5 * Math.cos((Math.PI * x) / 6.5);
      taps.push(sinc * w);
    }
    phases.push(taps);
  }
  return phases;
})();
export function peaks(L, R) {
  let sp = 0, tp = 0, clipped = 0;
  for (const ch of [L, R])
    for (let i = 6; i < ch.length - 6; i++) {
      const a = Math.abs(ch[i]);
      if (a > sp) sp = a;
      if (a >= 0.999) clipped++;
      if (a < tp * 0.5) continue; // cheap skip: true peak can't exceed ~2× nearby samples
      for (let p = 1; p < 4; p++) {
        const t = TP_TAPS[p];
        let v = 0;
        for (let k = 0; k < 12; k++) v += ch[i + k - 6] * t[k];
        if (Math.abs(v) > tp) tp = Math.abs(v);
      }
      if (a > tp) tp = a;
    }
  return { samplePeakDb: db(sp), truePeakDb: db(tp), clipped };
}

/* ------------------------------ spectrum ------------------------------ */
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = (-2 * Math.PI) / len, wr = Math.cos(a), wi = Math.sin(a);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let j = 0; j < len / 2; j++) {
        const ur = re[i + j], ui = im[i + j];
        const vr = re[i + j + len / 2] * cr - im[i + j + len / 2] * ci, vi = re[i + j + len / 2] * ci + im[i + j + len / 2] * cr;
        re[i + j] = ur + vr; im[i + j] = ui + vi;
        re[i + j + len / 2] = ur - vr; im[i + j + len / 2] = ui - vi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}
export const BANDS = [["sub", 20, 60], ["bass", 60, 250], ["lowmid", 250, 2000], ["himid", 2000, 6000], ["air", 6000, 16000]];
export function bandBalance(L, R) {
  const n = 4096, hann = Float32Array.from({ length: n }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n));
  const pow = new Float64Array(n / 2);
  let frames = 0;
  for (let s = 0; s + n <= L.length; s += n) {
    const re = new Float64Array(n), im = new Float64Array(n);
    for (let i = 0; i < n; i++) re[i] = ((L[s + i] + R[s + i]) / 2) * hann[i];
    fft(re, im);
    for (let k = 0; k < n / 2; k++) pow[k] += re[k] * re[k] + im[k] * im[k];
    frames++;
  }
  const out = {};
  let total = 0;
  for (const [name, lo, hi] of BANDS) {
    let e = 0;
    for (let k = Math.ceil((lo * n) / SR); k < Math.min(n / 2, Math.floor((hi * n) / SR)); k++) e += pow[k];
    out[name] = e;
    total += e;
  }
  for (const k in out) out[k] = Math.round((1000 * out[k]) / total) / 10; // % of energy
  return out;
}

/* ------------------------------ rhythm ------------------------------ */
/** Spectral-flux onset envelope (hop ≈ 5.3 ms) and picked onset times. */
export function onsets(L, R) {
  const n = 1024, hop = 256, hann = Float32Array.from({ length: n }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n));
  let prev = new Float64Array(n / 2);
  const env = [];
  for (let s = 0; s + n <= L.length; s += hop) {
    const re = new Float64Array(n), im = new Float64Array(n);
    for (let i = 0; i < n; i++) re[i] = ((L[s + i] + R[s + i]) / 2) * hann[i];
    fft(re, im);
    const mag = new Float64Array(n / 2);
    let f = 0;
    for (let k = 1; k < n / 2; k++) {
      mag[k] = Math.log1p(100 * Math.hypot(re[k], im[k]));
      f += Math.max(0, mag[k] - prev[k]);
    }
    prev = mag;
    env.push(f);
  }
  const dt = hop / SR, W = 12;
  const picks = [];
  for (let i = W; i < env.length - W; i++) {
    let mean = 0, max = 0;
    for (let j = i - W; j <= i + W; j++) { mean += env[j]; if (j !== i) max = Math.max(max, env[j]); }
    mean /= 2 * W + 1;
    // a window "sees" an attack when it reaches ~its centre: calibrated with synthetic clicks (bench: +13 ms)
    if (env[i] > max && env[i] > mean * 1.5) {
      const t = i * dt + (n / 2 + hop / 2) / SR;
      if (!picks.length || t - picks[picks.length - 1] > 0.05) picks.push(t);
    }
  }
  return { env, dt, picks };
}
/**
 * Fraction of strong onsets within ±tol of the 16th-note grid. swing (0..1) delays the off-beat
 * 8ths (swingUnit 8) or odd 16ths (swingUnit 16) by that fraction of the unit.
 */
export function gridAlignment(picks, bpm, { tol = 0.025, swing = 0, swingUnit = 8 } = {}) {
  if (!picks.length) return { aligned: 0, n: 0, medianErrMs: 0 };
  const s16 = 60 / bpm / 4, per = swingUnit === 8 ? 2 : 1;
  const errs = picks.map((t) => {
    const k = Math.round(t / s16);
    let best = Infinity;
    for (const kk of [k - 2, k - 1, k, k + 1]) {
      const onUnit = kk % per === 0, odd = Math.floor(kk / per) % 2 !== 0;
      const g = kk * s16 + (swing && onUnit && odd ? swing * s16 * per : 0);
      best = Math.min(best, Math.abs(t - g));
    }
    return best;
  });
  const sorted = [...errs].sort((a, b) => a - b);
  return { aligned: errs.filter((e) => e <= tol).length / errs.length, n: errs.length, medianErrMs: Math.round(sorted[sorted.length >> 1] * 10000) / 10 };
}
/** Autocorrelation tempo in [70, 180] BPM. */
export function tempo(env, dt) {
  const mean = env.reduce((a, b) => a + b, 0) / env.length;
  const e = env.map((v) => v - mean);
  let best = 0, bestBpm = 0;
  for (let bpm = 70; bpm <= 180; bpm += 0.5) {
    const lag = 60 / bpm / dt;
    let s = 0;
    for (let i = 0; i + lag * 4 < e.length; i++) {
      const l0 = Math.floor(i + lag), f = i + lag - l0;
      s += e[i] * (e[l0] * (1 - f) + e[l0 + 1] * f);
    }
    if (s > best) { best = s; bestBpm = bpm; }
  }
  return bestBpm;
}

/* ------------------------------ report ------------------------------ */
export function analyze(L, R, { bpm, sections = [], swing = 0, swingUnit = 8 } = {}) {
  const on = onsets(L, R);
  const rep = {
    durS: Math.round((L.length / SR) * 100) / 100,
    lufs: Math.round(integratedLufs(L, R) * 10) / 10,
    ...Object.fromEntries(Object.entries(peaks(L, R)).map(([k, v]) => [k, typeof v === "number" && isFinite(v) && k !== "clipped" ? Math.round(v * 10) / 10 : v])),
    bands: bandBalance(L, R),
    tempo: tempo(on.env, on.dt),
  };
  if (bpm) rep.grid = gridAlignment(on.picks, bpm, { swing, swingUnit });
  if (sections.length)
    rep.sections = sections.map(([name, t0, t1]) => {
      const a = Math.round(t0 * SR), b = Math.min(L.length, Math.round(t1 * SR));
      let ms = 0;
      for (let i = a; i < b; i++) ms += (L[i] * L[i] + R[i] * R[i]) / 2;
      return { name, rmsDb: Math.round(db(Math.sqrt(ms / Math.max(1, b - a))) * 10) / 10, lufs: Math.round(integratedLufs(L, R, a, b) * 10) / 10 };
    });
  return rep;
}

const FF_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../node_modules/@remotion/compositor-darwin-arm64");
export const FFMPEG = process.env.FFMPEG ?? path.join(FF_DIR, "ffmpeg");
export const ffEnv = { ...process.env, DYLD_LIBRARY_PATH: FF_DIR };
/** Decode any audio file to stereo float at 48 kHz with ffmpeg (this ffmpeg build has no raw-float muxer: 16-bit WAV). */
export function decode(file) {
  const buf = execFileSync(FFMPEG, ["-loglevel", "error", "-i", file, "-f", "wav", "-c:a", "pcm_s16le", "-ac", "2", "-ar", String(SR), "-"], { env: ffEnv, maxBuffer: 1 << 30 });
  return parseWav(buf);
}
/** 16-bit stereo PCM WAV → [L, R] floats (skips any non-data chunks). */
export function parseWav(buf) {
  let o = 12;
  while (o < buf.length - 8 && buf.toString("ascii", o, o + 4) !== "data") o += 8 + buf.readUInt32LE(o + 4);
  const start = o + 8, n = Math.floor((buf.length - start) / 4), L = new Float32Array(n), R = new Float32Array(n);
  for (let i = 0; i < n; i++) { L[i] = buf.readInt16LE(start + 4 * i) / 32768; R[i] = buf.readInt16LE(start + 4 * i + 2) / 32768; }
  return [L, R];
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [file, bpm] = process.argv.slice(2);
  const [L, R] = decode(file);
  console.log(JSON.stringify(analyze(L, R, { bpm: bpm ? Number(bpm) : undefined }), null, 1));
}
