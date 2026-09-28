// Fusion's free music library: original tracks written by our own deterministic synth (bench/score.mjs's
// mixer + the instruments below), so every track is CC0 with no licensing to verify.
//   node bench/music-library.mjs [name…]   → public/assets/music/<name>.mp3, manifest.json,
//                                            src/audio/music-catalog.ts, and an analysis report
// Every track is mastered the same way: integrated loudness → -14 LUFS, lookahead limiter, true peak ≤ -1 dBFS.
// Each file is a whole number of bars, so it loops on the grid. MP3 because every browser decodes it
// (Chromium builds without proprietary codecs can't decode AAC).
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mixer, midi, SR, writeWav, SCORES } from "./score.mjs";
import { analyze, integratedLufs, peaks, decode, FFMPEG, ffEnv } from "./audio-analyze.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const OUT = path.join(ROOT, "public/assets/music");
const TMP = path.join(ROOT, "out/music");
const TARGET_LUFS = -14, CEIL_DB = -1.8, MAX_TP_DB = -1.1;

/* ================================ instruments ================================ */
const blep = (t, dt) => {
  if (t < dt) { t /= dt; return t + t - t * t - 1; }
  if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
  return 0;
};
const saw = (p, dt) => 2 * p - 1 - blep(p, dt);
const sq = (p, dt) => (p < 0.5 ? 1 : -1) + blep(p, dt) - blep((p + 0.5) % 1, dt);

function kit(m) {
  const { voice, biquad, rnd, side, I, dry, duck } = m;
  const N = m.N;
  const pump = (t, depth = 1, rate = 9) => { // write sidechain without a kick (ghost duck)
    const s0 = Math.round(t * SR);
    for (let i = 0; i < SR * 0.4; i++) if (s0 + i < N && s0 + i >= 0) side[s0 + i] = Math.max(side[s0 + i], depth * Math.exp(-i / SR * rate));
  };
  const hv = (v, a = 0.1) => v * (1 + rnd() * a); // humanised velocity
  const X = {
    ...I, hv, rnd, pump, dry,
    /** detuned polyBLEP saw stack with a filter envelope — stabs, chords, pads */
    supersaw(t, len, note, { vol = 1, pan = 0, cut = 2400, cutEnd = cut, q = 0.8, atk = 0.005, rel = 0.25, n = 5, det = 0.011, rev = 0.3, to = duck } = {}) {
      const hz = midi(note), ph = Array.from({ length: n }, () => (rnd() + 1) / 2);
      const dets = Array.from({ length: n }, (_, j) => 1 + det * (j / (n - 1 || 1) - 0.5) * 2);
      const f = biquad();
      voice(t, len + rel, (i, s) => {
        if (i % 32 === 0) f.set("lp", cut + (cutEnd - cut) * Math.min(1, s / Math.max(0.01, len)), q);
        let v = 0;
        for (let j = 0; j < n; j++) { const dt = (hz * dets[j]) / SR; ph[j] = (ph[j] + dt) % 1; v += saw(ph[j], dt); }
        const env = Math.min(1, s / atk) * (s > len ? Math.exp(-(s - len) / (rel / 4)) : 1);
        return f.run(v / Math.sqrt(n)) * env * 0.35;
      }, { vol, pan, rev, to });
    },
    /** FM electric piano (Rhodes-ish): bell-y tine on the attack, warm body, optional tape wow */
    ep(t, note, { vel = 1, len = 1.2, pan = 0, wow = 0, rev = 0.3, vol = 1, to = duck } = {}) {
      const hz = midi(note);
      let pc = 0, pm = 0, pt = 0;
      voice(t, len + 0.8, (i, s) => {
        const w = 1 + wow * Math.sin(2 * Math.PI * 0.55 * (t + s)) * 0.004;
        pc += (2 * Math.PI * hz * w) / SR; pm += (2 * Math.PI * hz * w) / SR; pt += (2 * Math.PI * hz * 14 * w) / SR;
        const idx = (0.6 + 1.6 * vel) * Math.exp(-s * 5);
        const env = Math.exp(-s * 1.1) * Math.min(1, s / 0.003) * (s > len ? Math.exp(-(s - len) * 9) : 1);
        return (Math.sin(pc + idx * Math.sin(pm)) + 0.22 * vel * Math.sin(pt) * Math.exp(-s * 40)) * env * 0.32 * vel;
      }, { vol, pan, rev, to });
    },
    /** additive piano: slightly inharmonic partials, brighter/shorter highs, soft hammer */
    piano(t, note, { vel = 1, len = 2, pan = 0, rev = 0.3, vol = 1, to = dry } = {}) {
      const hz = midi(note), P = 7, B = 0.0004;
      const ph = new Float64Array(P);
      const hf = biquad(); hf.set("bp", 2500, 1);
      voice(t, len + 1.2, (i, s) => {
        let v = 0;
        for (let k = 1; k <= P; k++) {
          const fk = hz * k * Math.sqrt(1 + B * k * k);
          if (fk > 16000) break;
          ph[k - 1] += (2 * Math.PI * fk) / SR;
          v += (Math.sin(ph[k - 1]) * Math.exp(-s * (0.9 + 0.7 * k) * (0.5 + hz / 600))) / (k * (1.3 - 0.5 * vel));
        }
        const hammer = hf.run(rnd()) * Math.exp(-s * 90) * 0.3 * vel;
        const env = Math.min(1, s / 0.002) * (s > len ? Math.exp(-(s - len) * 8) : 1);
        return (v * 0.28 + hammer) * env * vel;
      }, { vol, pan, rev, to });
    },
    /** ensemble strings: detuned saws, slow bow, vibrato, dark filter */
    strings(t, len, note, { vol = 1, pan = 0, atk = 0.5, rel = 0.9, cut = 2200, rev = 0.5, to = duck } = {}) {
      const hz = midi(note), n = 3, ph = [0.1, 0.5, 0.8], det = [0.995, 1, 1.006];
      const f = biquad(); f.set("lp", cut, 0.6);
      voice(t, len + rel * 2, (i, s) => {
        const vib = 1 + 0.003 * Math.sin(2 * Math.PI * 5.2 * s) * Math.min(1, s / 0.8);
        let v = 0;
        for (let j = 0; j < n; j++) { const dt = (hz * det[j] * vib) / SR; ph[j] = (ph[j] + dt) % 1; v += saw(ph[j], dt); }
        const env = (1 - Math.exp(-s / (atk / 3))) * (s > len ? Math.exp(-(s - len) / (rel / 3)) : 1);
        return f.run(v / n) * env * 0.3;
      }, { vol, pan, rev, to });
    },
    /** trailer "braam": saw stack whose filter blooms open then closes, distorted */
    braam(t, notes, { vol = 1, len = 3.2 } = {}) {
      notes.forEach((note, k) => {
        const hz = midi(note), ph = [0, 0.33, 0.66], det = [0.994, 1, 1.007];
        const f = biquad();
        voice(t, len, (i, s) => {
          if (i % 32 === 0) f.set("lp", 150 + 2600 * Math.min(1, s / 0.25) * Math.exp(-s * 0.9), 1.6);
          let v = 0;
          for (let j = 0; j < 3; j++) { const dt = (hz * det[j]) / SR; ph[j] = (ph[j] + dt) % 1; v += saw(ph[j], dt); }
          const env = Math.min(1, s / 0.03) * Math.exp(-s * 0.55) * Math.min(1, (len - s) / 0.4);
          return Math.tanh(f.run(v / 3) * 2.2) * env * 0.3;
        }, { vol, pan: (k - (notes.length - 1) / 2) * 0.3, rev: 0.45, to: dry });
      });
    },
    taiko(t, { vol = 1, pan = 0, pitch = 1 } = {}) {
      let ph = 0; const f = biquad(); f.set("bp", 260 * pitch, 1.2);
      voice(t, 1.2, (i, s) => {
        ph += (2 * Math.PI * (58 + 70 * Math.exp(-s * 25)) * pitch) / SR;
        return (Math.sin(ph) * Math.exp(-s * 4.5) * 1.1 + f.run(rnd()) * Math.exp(-s * 16) * 0.7) * Math.min(1, s / 0.001);
      }, { vol: vol * 0.7, pan, rev: 0.45, to: dry });
    },
    /** 808: sine with a pitch drop, optional glide to the next note, saturated */
    b808(t, len, note, { vol = 1, glide = null, glideAt = 0.7 } = {}) {
      let ph = 0; const hz = midi(note), g2 = glide !== null ? midi(glide) : hz;
      voice(t, len + 0.08, (i, s) => {
        const u = Math.min(1, Math.max(0, (s - len * glideAt) / 0.07));
        const f = (glide !== null ? hz + (g2 - hz) * u : hz) * (1 + 1.2 * Math.exp(-s * 45));
        ph += (2 * Math.PI * f) / SR;
        const env = Math.min(1, s / 0.002) * (s > len ? Math.exp(-(s - len) * 60) : 1) * (0.75 + 0.25 * Math.exp(-s * 3));
        return Math.tanh(Math.sin(ph) * 1.8) * env * 0.62;
      }, { vol, rev: 0, to: dry });
    },
    sub(t, len, note, { vol = 1, to = duck, atk = 0.004, rel = 0.008 } = {}) {
      let ph = 0; const hz = midi(note);
      voice(t, len + rel * 4, (i, s) => {
        ph += (2 * Math.PI * hz) / SR;
        const env = Math.min(1, s / atk) * (s > len ? Math.exp(-(s - len) / rel) : 1);
        return (Math.sin(ph) + 0.18 * Math.sin(2 * ph)) * env * 0.55;
      }, { vol, rev: 0, to });
    },
    /** filtered saw bass with a snappy filter envelope (synthwave / disco) */
    sawBass(t, len, note, { vol = 1, cut = 380, env = 1800, to = duck } = {}) {
      const hz = midi(note), f = biquad(); let p1 = 0, p2 = 0.5;
      voice(t, len + 0.04, (i, s) => {
        if (i % 16 === 0) f.set("lp", cut + env * Math.exp(-s * 14), 2.2);
        const dt = hz / SR; p1 = (p1 + dt) % 1; p2 = (p2 + dt * 1.004) % 1;
        const e = Math.min(1, s / 0.003) * (s > len ? Math.exp(-(s - len) * 90) : 1);
        return f.run(saw(p1, dt) * 0.6 + sq(p2, dt * 1.004) * 0.3) * e * 0.5 + Math.sin(2 * Math.PI * p1) * 0.25 * e;
      }, { vol, rev: 0.02, to });
    },
    lead(t, len, note, { vol = 1, pan = 0, from = null, cut = 3200, vibD = 0.25, rev = 0.3, kind = "saw" } = {}) {
      const hz = midi(note), h0 = from !== null ? midi(from) : hz, f = biquad(); f.set("lp", cut, 1.1);
      let p1 = 0, p2 = 0.3;
      voice(t, len + 0.2, (i, s) => {
        const glide = h0 + (hz - h0) * Math.min(1, s / 0.06);
        const vib = 1 + 0.006 * Math.sin(2 * Math.PI * 5.5 * s) * Math.min(1, Math.max(0, (s - vibD) / 0.3));
        const d1 = (glide * vib) / SR, d2 = (glide * vib * 1.005) / SR;
        p1 = (p1 + d1) % 1; p2 = (p2 + d2) % 1;
        const osc = kind === "square" ? sq(p1, d1) * 0.5 + sq(p2, d2) * 0.3 : saw(p1, d1) * 0.55 + saw(p2, d2) * 0.45;
        const env = Math.min(1, s / 0.01) * (s > len ? Math.exp(-(s - len) * 20) : 1);
        return f.run(osc) * env * 0.26;
      }, { vol, pan, rev, to: duck });
    },
    whistle(t, len, note, { vol = 1, pan = 0, from = null } = {}) {
      const hz = midi(note), h0 = from !== null ? midi(from) : hz, f = biquad(); f.set("bp", hz * 2, 3);
      let ph = 0;
      voice(t, len + 0.12, (i, s) => {
        const g = h0 + (hz - h0) * Math.min(1, s / 0.05);
        const vib = 1 + 0.008 * Math.sin(2 * Math.PI * 6 * s) * Math.min(1, s / 0.25);
        ph += (2 * Math.PI * g * vib) / SR;
        const env = Math.min(1, s / 0.02) * (s > len ? Math.exp(-(s - len) * 30) : 1);
        return (Math.sin(ph) + 0.08 * Math.sin(2 * ph) + f.run(rnd()) * 0.05) * env * 0.22;
      }, { vol, pan, rev: 0.35, to: duck });
    },
    marimba(t, note, { vel = 1, pan = 0, vol = 1, rev = 0.25 } = {}) {
      const hz = midi(note);
      voice(t, 0.9, (i, s) => {
        const a = 2 * Math.PI * hz * s;
        return (Math.sin(a) * Math.exp(-s * 5.5) + 0.35 * Math.sin(a * 3.93) * Math.exp(-s * 22) + 0.12 * Math.sin(a * 9.2) * Math.exp(-s * 60)) * Math.min(1, s / 0.001) * 0.4 * vel;
      }, { vol, pan, rev, to: duck });
    },
    glock(t, note, { vel = 1, pan = 0, vol = 1 } = {}) {
      const hz = midi(note);
      voice(t, 2, (i, s) => {
        const a = 2 * Math.PI * hz * s;
        return (Math.sin(a) + 0.35 * Math.sin(a * 2.76) * Math.exp(-s * 6) + 0.15 * Math.sin(a * 5.4) * Math.exp(-s * 12)) * Math.exp(-s * 2.6) * Math.min(1, s / 0.001) * 0.18 * vel;
      }, { vol, pan, rev: 0.45, to: dry });
    },
    blip(t, note, { vel = 1, pan = 0, dec = 18, vol = 1, rev = 0.3 } = {}) {
      const hz = midi(note);
      voice(t, 0.35, (i, s) => Math.sin(2 * Math.PI * hz * s + 1.2 * Math.sin(2 * Math.PI * hz * 2 * s) * Math.exp(-s * 30)) * Math.exp(-s * dec) * Math.min(1, s / 0.001) * 0.3 * vel, { vol, pan, rev, to: duck });
    },
    rim(t, vol = 1, pan = 0.15) {
      const f = biquad(); f.set("bp", 1900, 5);
      voice(t, 0.06, (i, s) => (f.run(rnd()) * 1.4 + Math.sin(2 * Math.PI * 520 * s) * 0.5) * Math.exp(-s * 70), { vol: vol * 0.4, pan, rev: 0.12 });
    },
    shaker(t, vol = 1, pan = -0.2) {
      const f = biquad(); f.set("hp", 6500);
      voice(t, 0.09, (i, s) => f.run(rnd()) * Math.min(1, s / 0.012) * Math.exp(-s * 45), { vol: vol * 0.22, pan, rev: 0.05 });
    },
    snap(t, vol = 1, pan = 0.1) {
      const f = biquad(); f.set("bp", 2600, 2);
      voice(t, 0.12, (i, s) => f.run(rnd()) * Math.exp(-s * 55) * 2, { vol: vol * 0.45, pan, rev: 0.3 });
    },
    /** 80s gated-reverb snare: body + a flat noise tail cut dead */
    gated(t, vol = 1) {
      const f = biquad(); f.set("bp", 1400, 0.7); let ph = 0;
      voice(t, 0.26, (i, s) => {
        ph += (2 * Math.PI * (200 + 60 * Math.exp(-s * 40))) / SR;
        const gate = s < 0.2 ? 1 : Math.max(0, 1 - (s - 0.2) / 0.02);
        return (Math.sin(ph) * Math.exp(-s * 25) * 0.7 + f.run(rnd()) * (0.35 + 0.65 * Math.exp(-s * 18)) * gate) * 0.9;
      }, { vol: vol * 0.55, rev: 0.12 });
    },
    lofiKick(t, vol = 1) {
      let ph = 0; const f = biquad(); f.set("lp", 900);
      voice(t, 0.45, (i, s) => { ph += (2 * Math.PI * (48 + 70 * Math.exp(-s * 28))) / SR; return f.run(Math.sin(ph) * Math.exp(-s * 8)) * 1.2; }, { vol, rev: 0.03 });
      pump(t, 0.5, 10);
    },
    lofiSnare(t, vol = 1) {
      const f = biquad(); f.set("bp", 1800, 0.8); const lp = biquad(); lp.set("lp", 5000); let ph = 0;
      voice(t, 0.3, (i, s) => { ph += (2 * Math.PI * 185) / SR; return lp.run(f.run(rnd()) * 1.2 + Math.sin(ph) * 0.4) * Math.exp(-s * 16); }, { vol: vol * 0.5, pan: 0.05, rev: 0.3 });
    },
    trapHat(t, vol = 1, pan = 0.2) {
      const f = biquad(); f.set("hp", 8500);
      voice(t, 0.05, (i, s) => f.run(rnd()) * Math.exp(-s * 90), { vol: vol * 0.5, pan, rev: 0.03 });
    },
    /** vinyl: dust crackle + a little hiss over [t0, t1) */
    vinyl(t0, t1, vol = 1) {
      const f = biquad(); f.set("hp", 3000); const lp = biquad(); lp.set("lp", 9000);
      voice(t0, t1 - t0, () => lp.run(f.run(rnd()) * 0.03 + (rnd() > 0.9996 ? rnd() * 0.35 : 0)), { vol, rev: 0, pan: 0 });
    },
    /** slowly breathing filtered noise (wind / air) */
    air(t0, t1, vol = 1, lo = 400, hi = 2400) {
      const f = biquad(), len = t1 - t0;
      voice(t0, len, (i, s) => {
        if (i % 64 === 0) f.set("bp", lo + (hi - lo) * (0.5 + 0.5 * Math.sin(2 * Math.PI * s / 9)), 1.5);
        return f.run(rnd()) * Math.min(1, s / 2, (len - s) / 2) * 0.5;
      }, { vol, rev: 0.6, pan: 0 });
    },
  };
  return X;
}

/* ================================ songs ================================ */
const G = (bpm, swing = 0, swingUnit = 8) => {
  const beat = 60 / bpm, unit = (4 / swingUnit) * beat; // 8ths: half a beat
  return {
    bpm, beat, bar: 4 * beat,
    /** time of bar `b`, beat `q` (fractional beats allowed); swing delays the off-beat 8ths (or 16ths) */
    t: (b, q = 0) => {
      const u = (q * beat) / unit, k = Math.round(u);
      const sw = swing && Math.abs(u - k) < 1e-6 && k % 2 === 1 ? swing * unit : 0;
      return b * 4 * beat + q * beat + sw;
    },
  };
};
const each = (n, fn) => { for (let i = 0; i < n; i++) fn(i); };

const SONGS = {
  /* ------------------------------------------------------------------ */
  drive: {
    title: "Drive", mood: ["energetic", "electro", "house"], bpm: 124, bars: 25, desc: "Driving electro house: pumping bass, supersaw stabs, a hooky lead. Launches, product reveals, sport.",
    render: { duckDepth: 0.75, delay: { time: (60 / 124) * 0.75, fb: 0.35, mix: 0.35 } },
    sections: [["intro", 0, 4], ["build", 4, 8], ["drop", 8, 16], ["break", 16, 20], ["drop 2", 20, 24], ["end", 24, 25]],
    build(X, g) {
      const CH = [[57, 61, 66], [57, 62, 66], [57, 61, 64], [56, 59, 64]], BS = [42, 38, 45, 40];
      const LEAD = [
        [[0, 73, 2], [2, 76, 1], [3, 78, 3], [6, 76, 2], [8, 73, 2], [10, 71, 2], [12, 69, 4]],
        [[0, 78, 3], [3, 76, 1], [4, 74, 2], [6, 73, 2], [8, 74, 4], [12, 69, 2], [14, 71, 2]],
        [[0, 73, 2], [2, 76, 1], [3, 78, 3], [6, 81, 2], [8, 80, 2], [10, 78, 2], [12, 76, 4]],
        [[0, 71, 2], [2, 76, 2], [4, 80, 3], [7, 78, 1], [8, 76, 4], [12, 71, 2], [14, 73, 2]],
      ];
      const t = g.t;
      each(25, (b) => {
        const c = b % 4, sec = b < 4 ? 0 : b < 8 ? 1 : b < 16 ? 2 : b < 20 ? 3 : b < 24 ? 4 : 5;
        const full = sec === 2 || sec === 4;
        if (sec === 5) return;
        // drums
        each(4, (q) => {
          if (sec !== 3 && !(b === 7 && q >= 2)) X.kick(t(b, q), X.hv(sec === 0 ? 0.85 : 1, 0.04));
          if (sec >= 1 && sec !== 3 && (q === 1 || q === 3)) X.clap(t(b, q), X.hv(0.9));
          each(4, (s) => { if (sec !== 3 || b >= 18) X.hat(t(b, q + s / 4), X.hv(s === 2 ? 0.55 : 0.28), false, s % 2 ? 0.3 : -0.1); });
          if (full) X.hat(t(b, q + 0.5), X.hv(0.7), true, 0.25);
        });
        // bass: offbeat pump, root → octave
        if (sec >= 1 && sec !== 3) each(4, (q) => { X.bass(t(b, q + 0.5), g.beat * 0.45, BS[c], X.hv(1, 0.05)); if (full && q === 3) X.bass(t(b, q + 0.75), g.beat * 0.2, BS[c] + 12, 0.7); });
        if (sec === 3) X.sub(t(b, 0), g.bar * 0.95, BS[c] - 12, { vol: 0.55 });
        // chords
        if (full) each(4, (q) => CH[c].forEach((n, k) => X.supersaw(t(b, q + 0.5), g.beat * 0.28, n, { vol: X.hv(0.55, 0.05), pan: (k - 1) * 0.5, cut: 3200, cutEnd: 1600, rel: 0.12 })));
        const padVol = sec === 0 ? 0.55 : sec === 3 ? 0.5 : 0.4;
        X.pad(t(b, 0), g.bar, CH[c], padVol, sec === 0 ? 700 + b * 150 : sec === 3 ? 1600 : 1300);
        // arp
        if (sec === 1 || sec === 3 || full) {
          const ns = [CH[c][0] + 12, CH[c][1] + 12, CH[c][2] + 12, CH[c][1] + 24];
          each(16, (s) => X.pluck(t(b, s / 4), ns[s % 4], X.hv(sec === 1 ? 0.25 + (b - 4) * 0.12 : full ? 0.35 : 0.4), s % 2 ? 0.45 : -0.45, 7));
        }
        // lead hook
        if (full || (sec === 3 && b >= 16))
          for (const [s, n, l] of LEAD[c]) {
            if (sec === 3) X.bell(t(b, s / 4), n, 0.5, 0.1);
            else X.lead(t(b, s / 4), (l * g.beat) / 4 - 0.02, n + (sec === 4 ? 12 : 0), { vol: X.hv(0.8, 0.05), pan: 0.05, cut: 3800 });
          }
      });
      // transitions
      X.riser(t(2), t(4), 0.5); X.riser(t(6), t(8), 1); X.swell(t(8), 1.5, 1); for (let q = 0; q < 4; q += q < 2 ? 0.5 : q < 3 ? 0.25 : 0.125) X.snare(t(7, q), 0.35 + q * 0.18);
      X.impact(t(8), 1); X.crash(t(12), 0.6);
      X.riser(t(18), t(20), 1); X.swell(t(20), 1.8, 1);
      for (let q = 0; q < 8; q += q < 4 ? 0.5 : q < 6 ? 0.25 : 0.125) X.snare(t(18, q), 0.3 + q * 0.09);
      X.impact(t(20), 1.1); X.crash(t(22), 0.5);
      // ending: one last chord and hit on the downbeat, decaying into the final bar
      X.kick(t(24), 1); X.impact(t(24), 0.8);
      CH[0].forEach((n, k) => X.supersaw(t(24), g.beat * 2, n, { vol: 0.7, pan: (k - 1) * 0.5, cut: 2800, cutEnd: 600, rel: 1 }));
      X.sub(t(24), g.beat * 2, BS[0] - 12, { vol: 0.9, to: X.dry });
    },
  },

  /* ------------------------------------------------------------------ */
  titan: {
    title: "Titan", mood: ["cinematic", "epic", "trailer"], bpm: 90, bars: 18, desc: "Trailer build: piano ostinato, strings, taikos and braams that hit on the downbeats. Reveals, openers.",
    render: { duckDepth: 0.35, room: 0.9, damp: 0.2 },
    sections: [["intro", 0, 4], ["rise", 4, 8], ["hit 1", 8, 12], ["hit 2", 12, 16], ["end", 16, 18]],
    build(X, g) {
      const t = g.t;
      const CH = [[50, 53, 57], [50, 53, 58], [48, 53, 57], [48, 52, 55]], RT = [38, 34, 41, 36]; // Dm Bb F C (2 bars each)
      const OST = [62, 69, 65, 69, 62, 69, 65, 70]; // D A F A … piano ostinato in 8ths
      each(16, (b) => {
        const c = Math.floor(b / 2) % 4, sec = b < 4 ? 0 : b < 8 ? 1 : b < 12 ? 2 : 3;
        each(8, (e) => {
          const n = OST[e] - 62 + CH[c][0] + 12 + (c === 3 && e % 2 ? -2 : 0);
          X.piano(t(b, e / 2), n + (sec >= 2 ? 12 : 0), { vel: X.hv(e % 2 ? 0.45 : 0.7), len: g.beat * 0.45, pan: 0.15, rev: 0.4, vol: sec === 0 ? 0.9 : 0.75 });
        });
        if (b % 2 === 0) {
          X.strings(t(b), g.bar * 2 - 0.1, RT[c] - 12 + 12, { vol: 0.9, pan: -0.1, cut: 900, atk: 1 });
          if (sec >= 1) CH[c].forEach((n, k) => X.strings(t(b), g.bar * 2 - 0.1, n + (sec >= 3 ? 12 : 0), { vol: sec === 1 ? 0.55 : 0.7, pan: (k - 1) * 0.6, atk: sec === 1 ? 1.2 : 0.4 }));
          if (sec >= 2) X.strings(t(b), g.bar * 2 - 0.1, CH[c][2] + 24, { vol: 0.35, cut: 3200, atk: 0.6 });
        }
        if (sec >= 1) each(8, (e) => X.tick(t(b, e / 2), X.hv(sec === 1 ? 0.35 : 0.5), e % 2 ? 2100 : 2600));
        if (sec === 1) { X.taiko(t(b, 0), { vol: 0.8 }); X.taiko(t(b, 2), { vol: 0.6, pitch: 1.2 }); }
        if (sec >= 2) {
          [0, 1.5, 2, 3, 3.5].forEach((q, k) => X.taiko(t(b, q), { vol: X.hv(k === 0 ? 1 : 0.6), pitch: k % 2 ? 1.3 : 1, pan: k % 2 ? 0.3 : -0.2 }));
          X.snare(t(b, 2), 0.7);
          if (sec === 3 && b % 2 === 1) each(4, (s) => X.taiko(t(b, 3 + s / 4), { vol: 0.35 + s * 0.15, pitch: 1.5 }));
        }
      });
      X.impact(t(0), 0.5); X.sub(t(0), 1.5, 26, { vol: 0.6, to: X.dry });
      X.riser(t(6), t(8), 1); X.swell(t(8), 2, 1);
      X.braam(t(8), [26, 33, 38, 41], { vol: 1 }); X.impact(t(8), 1);
      X.braam(t(12), [22, 29, 34, 38], { vol: 1 }); X.impact(t(12), 1);
      X.riser(t(14), t(16), 1.1); X.swell(t(16), 1.5, 1);
      for (let q = 0; q < 8; q += q < 4 ? 0.5 : q < 6 ? 0.25 : 0.125) X.snare(t(14, q), 0.3 + q * 0.08);
      // final: the big one, then the ostinato alone, ringing out
      X.braam(t(16), [26, 33, 38, 41, 45], { vol: 1.1, len: 4.5 }); X.impact(t(16), 1.2); X.taiko(t(16), { vol: 1.2 });
      [62, 69, 74].forEach((n, k) => X.piano(t(17, k * 0.5), n, { vel: 0.5, len: 2, rev: 0.6 }));
    },
  },

  /* ------------------------------------------------------------------ */
  lanterns: {
    title: "Paper Lanterns", mood: ["chill", "lo-fi", "warm"], bpm: 80, bars: 16, swing: 0.3, desc: "Lo-fi hip-hop: dusty Rhodes chords, lazy swung drums and vinyl crackle. Explainers, calm product tours.",
    tilt: 3.5, render: { duckDepth: 0.25, drive: 1.3, room: 0.8, damp: 0.45 },
    sections: [["intro", 0, 2], ["beat", 2, 14], ["outro", 14, 16]],
    build(X, g) {
      const t = g.t;
      const CH = [[57, 60, 64, 67], [55, 59, 62, 64], [53, 57, 60, 64], [52, 55, 59, 62]], RT = [41, 40, 38, 36]; // Fmaj9 Em7 Dm9 Cmaj9
      const MEL = [[0, 76, 1], [1, 79, 0.5], [1.5, 81, 1.5], [3, 79, 1], [4, 76, 1.5], [5.5, 74, 0.5], [6, 72, 2]];
      X.vinyl(0, t(16), 1);
      each(16, (b) => {
        const c = b % 4, sec = b < 2 ? 0 : b < 14 ? 1 : 2;
        const last = b === 15;
        // Rhodes: strummed on 1, a ghost re-hit on the "and" of 2
        CH[c].forEach((n, k) => X.ep(t(b, 0) + k * 0.012, n, { vel: X.hv(0.7), len: last ? g.bar : g.beat * 1.4, pan: (k - 1.5) * 0.25, wow: 1, vol: 0.9 }));
        if (!last) CH[c].forEach((n, k) => X.ep(t(b, 1.5) + k * 0.01, n, { vel: X.hv(0.4), len: g.beat * 0.8, pan: (k - 1.5) * 0.25, wow: 1, vol: 0.8 }));
        if (!last) X.ep(t(b, 3), CH[c][3] + 12, { vel: 0.35, len: g.beat * 0.9, pan: 0.3, wow: 1 });
        // bass
        if (sec >= 1 || b === 1) { X.sub(t(b, 0), g.beat * 1.3, RT[c], { vol: 0.9 }); if (!last) X.sub(t(b, 2.5), g.beat * 0.9, RT[c] + 7, { vol: 0.7 }); }
        // drums
        if (sec === 1) {
          X.lofiKick(t(b, 0), X.hv(1, 0.05)); X.lofiKick(t(b, 1.75), X.hv(0.6)); X.lofiKick(t(b, 2.5), X.hv(0.85));
          X.lofiSnare(t(b, 1), X.hv(0.9)); X.lofiSnare(t(b, 3), X.hv(0.95));
          if (b % 2 === 1) X.lofiSnare(t(b, 3.75), 0.25);
          each(8, (e) => X.hat(t(b, e / 2), X.hv(e % 2 ? 1 : 1.5, 0.2), false, 0.2));
          each(4, (q) => X.shaker(t(b, q + 0.5), X.hv(0.9), -0.3));
        }
        // melody on the second half, two-bar phrase
        if (b >= 6 && b < 14 && b % 2 === 0) for (const [q, n, l] of MEL) X.ep(t(b, q), n, { vel: X.hv(0.75), len: l * g.beat, pan: 0.1, wow: 1.4, rev: 0.45, to: X.dry });
      });
      X.bell(t(14), 84, 0.5, 0.2); X.bell(t(15), 79, 0.6, -0.2);
    },
  },

  /* ------------------------------------------------------------------ */
  sunrise: {
    title: "Sunrise", mood: ["uplifting", "corporate", "bright"], bpm: 110, bars: 22, desc: "Uplifting and optimistic: piano pulse, claps and a glockenspiel hook in C major. SaaS demos, onboarding, brand films.",
    render: { duckDepth: 0.45, delay: { time: (60 / 110) * 0.5, fb: 0.25, mix: 0.25 } },
    sections: [["intro", 0, 4], ["verse", 4, 12], ["chorus", 12, 20], ["outro", 20, 22]],
    build(X, g) {
      const t = g.t;
      const CH = [[60, 64, 67], [59, 62, 67], [60, 64, 69], [60, 65, 69]], RT = [36, 43, 45, 41];
      const HOOK = [
        [[0, 79, 1], [1, 76, 1], [2, 79, 1], [3, 84, 1]],
        [[0, 83, 2], [2, 86, 1], [3, 83, 1]],
        [[0, 84, 1], [1, 81, 1], [2, 76, 1], [3, 81, 1]],
        [[0, 81, 2], [2, 79, 2]],
      ];
      each(22, (b) => {
        const c = b % 4, sec = b < 4 ? 0 : b < 12 ? 1 : b < 20 ? 2 : 3;
        const end = b === 21;
        // piano 8th pulse
        if (!end) each(8, (e) => { const ns = e % 2 ? [CH[c][1], CH[c][2]] : [RT[c] + 12, CH[c][0]]; ns.forEach((n) => X.piano(t(b, e / 2), n, { vel: X.hv(e % 2 ? 0.45 : 0.62), len: g.beat * 0.45, pan: 0.1, vol: 0.85 })); });
        // pluck arpeggio
        if (sec === 0 || sec === 2) each(8, (e) => X.pluck(t(b, e / 2 + 0.25), CH[c][e % 3] + 12, X.hv(0.35), e % 2 ? 0.5 : -0.5, 8));
        if (sec >= 1 && sec <= 2) {
          each(4, (q) => { X.kick(t(b, q), X.hv(sec === 1 ? 0.75 : 0.95, 0.04)); if (sec === 2) X.hat(t(b, q + 0.5), X.hv(0.55), true, 0.2); });
          each(16, (s) => X.shaker(t(b, s / 4), X.hv(s % 2 ? 0.5 : 0.9)));
          if (b >= 8) { X.clap(t(b, 1), X.hv(0.8)); X.clap(t(b, 3), X.hv(0.85)); }
          each(8, (e) => X.bass(t(b, e / 2), g.beat * 0.42, RT[c] + (sec === 2 && e % 2 ? 12 : 0), X.hv(0.85, 0.05)));
        }
        if (sec >= 1) X.pad(t(b), g.bar, CH[c], sec === 2 ? 0.5 : 0.35, sec === 2 ? 2000 : 1200);
        if (sec === 2) {
          CH[c].forEach((n, k) => X.supersaw(t(b), g.bar - 0.05, n + 12, { vol: 0.25, pan: (k - 1) * 0.6, cut: 2600, atk: 0.08, rel: 0.2 }));
          for (const [q, n, l] of HOOK[c]) { X.glock(t(b, q), n, { vel: X.hv(1), pan: 0.15 }); X.lead(t(b, q), l * g.beat - 0.04, n - 12, { vol: 0.45, cut: 2400, kind: "square" }); }
        }
        if (sec === 3 && !end) for (const [q, n] of HOOK[c]) X.glock(t(b, q), n, { vel: 0.6 });
      });
      X.riser(t(10), t(12), 0.8); X.swell(t(12), 1.2, 0.9); X.crash(t(12), 0.8); X.crash(t(16), 0.6); X.impact(t(12), 0.5);
      for (let q = 0; q < 4; q += q < 2 ? 0.5 : 0.25) X.snare(t(11, q), 0.3 + q * 0.12);
      // resolve on C
      [36, 48, 60, 64, 67, 72].forEach((n, k) => X.piano(t(21), n, { vel: 0.8, len: g.bar, pan: (k - 2.5) * 0.12, rev: 0.5 }));
      X.glock(t(21), 84, { vel: 0.9 }); X.crash(t(21), 0.35);
    },
  },

  /* ------------------------------------------------------------------ */
  neon: {
    title: "Neon Drive", mood: ["tech", "synthwave", "retro"], bpm: 100, bars: 20, desc: "80s synthwave: pulsing octave bass, gated snares and a singing saw lead. Tech, gaming, retro-future.",
    render: { duckDepth: 0.5, room: 0.88, delay: { time: (60 / 100) * 0.75, fb: 0.4, mix: 0.4 } },
    sections: [["intro", 0, 2], ["groove", 2, 8], ["lead", 8, 16], ["lift", 16, 19], ["end", 19, 20]],
    build(X, g) {
      const t = g.t;
      const CH = [[57, 60, 64], [57, 60, 65], [55, 60, 64], [55, 59, 62]], RT = [33, 29, 36, 31]; // Am F C G
      const LEAD = [
        [[0, 76, 3], [3, 74, 1], [4, 72, 2], [6, 71, 2]],
        [[0, 72, 4], [4, 69, 2], [6, 72, 2]],
        [[0, 76, 3], [3, 79, 1], [4, 76, 2], [6, 74, 2]],
        [[0, 74, 6], [6, 71, 2]],
      ];
      each(20, (b) => {
        const c = b % 4, sec = b < 2 ? 0 : b < 8 ? 1 : b < 16 ? 2 : b < 19 ? 3 : 4;
        if (sec === 4) return;
        CH[c].forEach((n, k) => X.supersaw(t(b), g.bar - 0.05, n, { vol: sec === 0 ? 0.5 : 0.38, pan: (k - 1) * 0.6, cut: sec === 0 ? 900 + b * 400 : 1700, atk: 0.25, rel: 0.4, rev: 0.45 }));
        each(16, (s) => X.pluck(t(b, s / 4), [CH[c][0] + 12, CH[c][1] + 12, CH[c][2] + 12, CH[c][1] + 24][s % 4], X.hv(sec === 0 ? 0.3 : 0.26), s % 2 ? 0.55 : -0.55, 9));
        if (sec >= 1) {
          each(8, (e) => X.sawBass(t(b, e / 2), g.beat * 0.42, RT[c] + (e % 2 ? 12 : 0), { vol: X.hv(0.95, 0.05) }));
          X.kick(t(b, 0), 1); X.kick(t(b, 2), 0.95); if (b % 2) X.kick(t(b, 3.5), 0.6);
          X.gated(t(b, 1), X.hv(1, 0.05)); X.gated(t(b, 3), X.hv(1, 0.05));
          each(8, (e) => X.hat(t(b, e / 2), X.hv(e % 2 ? 0.6 : 0.35), false, 0.25));
        }
        if (sec >= 2) for (const [e, n, l] of LEAD[c]) X.lead(t(b, e / 2), (l * g.beat) / 2 - 0.03, n + (sec === 3 ? 12 : 0), { vol: 0.85, from: e === 0 ? null : n - 2, pan: 0.05 });
      });
      X.crash(t(2), 0.5); X.riser(t(6), t(8), 0.8); X.crash(t(8), 0.7); X.impact(t(8), 0.5);
      X.riser(t(14), t(16), 0.9); X.crash(t(16), 0.8); X.impact(t(16), 0.6);
      for (let q = 0; q < 4; q += 0.25) X.gated(t(15, q), 0.25 + q * 0.12);
      X.kick(t(19), 1); X.gated(t(19), 0.8); X.crash(t(19), 0.8);
      CH[0].forEach((n, k) => X.supersaw(t(19), g.bar * 0.7, n, { vol: 0.5, pan: (k - 1) * 0.6, cut: 1800, cutEnd: 500, rel: 0.8, rev: 0.5 }));
      X.sawBass(t(19), g.beat * 2, RT[0], { vol: 0.9 });
    },
  },

  /* ------------------------------------------------------------------ */
  hustle: {
    title: "Hustle", mood: ["energetic", "trap", "hype"], bpm: 140, bars: 28, desc: "Half-time trap: gliding 808s, rolling hats, dark bells. Hype edits, sports, fashion, bold launches.",
    render: { duckDepth: 0.2, drive: 1.2 },
    sections: [["intro", 0, 4], ["drop", 4, 16], ["break", 16, 20], ["drop 2", 20, 27], ["end", 27, 28]],
    build(X, g) {
      const t = g.t;
      const CH = [[64, 67, 71], [64, 67, 72], [64, 69, 72], [63, 66, 71]], RT = [28, 36, 33, 35]; // Em C Am B
      const BELL = [[0, 76], [0.75, 79], [1.5, 83], [2, 76], [2.75, 79], [3.25, 81], [3.5, 79]];
      each(28, (b) => {
        const c = Math.floor(b / 2) % 4, sec = b < 4 ? 0 : b < 16 ? 1 : b < 20 ? 2 : b < 27 ? 3 : 4;
        const full = sec === 1 || sec === 3;
        if (sec === 4) return;
        if (b % 2 === 0) X.pad(t(b), g.bar * 2, CH[c].map((n) => n - 12), sec === 0 ? 0.5 : 0.4, sec === 0 ? 600 + b * 200 : 1100);
        for (const [q, n] of BELL) X.bell(t(b, q), n - 64 + CH[c][0] + (b % 2 && q > 2 ? 2 : 0), X.hv(sec === 2 ? 0.9 : 0.7), q > 2 ? 0.3 : -0.3);
        if (full || sec === 2) {
          // 808 pattern: long root, pickups, a glide into the next bar
          const r = RT[c], nx = RT[Math.floor((b + 1) / 2) % 4];
          X.b808(t(b, 0), g.beat * 1.5, r, { vol: 1 }); X.kick(t(b, 0), 0.8);
          if (full) { X.b808(t(b, 1.75), g.beat * 0.5, r, { vol: 0.85 }); X.kick(t(b, 1.75), 0.5); }
          X.b808(t(b, 2.5), g.beat * 1.4, r + (b % 2 ? 7 : 0), { vol: 0.9, glide: b % 2 ? nx + 12 : null, glideAt: 0.6 });
        }
        if (full) {
          X.clap(t(b, 2), X.hv(1, 0.04)); X.snare(t(b, 2), 0.6);
          // hats: 8ths, with 16th/32nd/triplet rolls in the back half
          const roll = b % 4;
          for (let q = 0; q < 4; q += 0.5) {
            if (q >= 3 && roll === 1) { for (let r = 0; r < 4; r++) X.trapHat(t(b, q) + (r * g.beat) / 8, X.hv(0.6 + r * 0.1)); continue; }
            if (q >= 3 && roll === 3) { for (let r = 0; r < 3; r++) X.trapHat(t(b, q) + (r * g.beat) / 6, X.hv(0.7)); continue; }
            X.trapHat(t(b, q), X.hv(q % 1 ? 0.55 : 0.85), q % 1 ? 0.25 : -0.1);
            if (roll === 2 && q === 1.5) X.trapHat(t(b, q + 0.25), 0.6);
          }
          if (b % 4 === 3) X.hat(t(b, 3.5), 0.8, true, 0.3);
        }
        if (sec === 3 && b % 2 === 1) X.lead(t(b, 3), g.beat * 0.9, CH[c][2] + 12, { vol: 0.5, from: CH[c][2] + 7, kind: "square", cut: 2000 });
      });
      X.riser(t(2), t(4), 1); X.swell(t(4), 1.2, 1); X.impact(t(4), 1.1);
      X.riser(t(18), t(20), 1); X.impact(t(20), 1.1);
      for (let r = 0; r < 12; r++) X.trapHat(t(19, 2) + (r * g.beat) / 6, 0.4 + r * 0.05);
      X.b808(t(27), g.bar * 0.8, RT[0], { vol: 1 }); X.kick(t(27), 1); X.impact(t(27), 0.8); X.bell(t(27), 76, 0.8);
    },
  },

  /* ------------------------------------------------------------------ */
  float: {
    title: "Float", mood: ["chill", "ambient", "cinematic"], bpm: 60, bars: 12, desc: "Ambient pads and soft bells with no drums. Titles, typography, luxury, anything that should breathe.",
    render: { duckDepth: 0.15, room: 0.93, damp: 0.15, delay: { time: 0.75, fb: 0.45, mix: 0.45 } },
    sections: [["open", 0, 4], ["bloom", 4, 9], ["fade", 9, 12]],
    build(X, g) {
      const t = g.t;
      const CH = [[55, 59, 62, 64], [55, 57, 60, 64], [57, 60, 64, 67], [55, 60, 62, 67]], RT = [36, 33, 29, 31]; // Cmaj9 Am9 Fmaj9 Gsus
      const PENTA = [72, 74, 76, 79, 81, 84, 86, 88];
      X.air(0, t(12), 0.9);
      each(12, (b) => {
        const c = b % 4, last = b === 11;
        X.pad(t(b), g.bar * (last ? 0.7 : 1) + 0.3, CH[c], b < 2 ? 0.5 + b * 0.25 : 0.9, 700 + (b % 6) * 180);
        CH[c].forEach((n, k) => X.strings(t(b), g.bar, n + 12, { vol: b >= 4 && b < 10 ? 0.35 : 0.15, pan: (k - 1.5) * 0.5, atk: 1.6, rel: 2, cut: 3000, rev: 0.7 }));
        X.sub(t(b), g.bar * (last ? 0.7 : 1) - 0.2, RT[c], { vol: b >= 2 ? 0.55 : 0.3, atk: 0.35, rel: 0.25 });
        if (b >= 4 && b < 10) { X.sub(t(b, 0), 0.25, RT[c] + 12, { vol: 0.25 }); X.sub(t(b, 2), 0.25, RT[c] + 12, { vol: 0.2 }); }
        // sparse bell line on the beat grid (seeded, pentatonic)
        each(4, (q) => {
          if (X.rnd() > (b >= 4 && b < 10 ? 0.1 : 0.55)) return;
          const n = PENTA[Math.floor(((X.rnd() + 1) / 2) * PENTA.length) % PENTA.length];
          X.glock(t(b, q + (X.rnd() > 0.6 ? 0.5 : 0)), n, { vel: X.hv(0.55, 0.3), pan: X.rnd() * 0.6 });
        });
      });
      X.bell(t(0), 72, 0.6); X.bell(t(11), 72, 0.7); X.bell(t(11, 1), 79, 0.5, 0.3);
    },
  },

  /* ------------------------------------------------------------------ */
  circuit: {
    title: "Circuit", mood: ["tech", "minimal", "focused"], bpm: 122, bars: 24, desc: "Minimal tech house: tight kick, rolling sub, clicky rims and dubby stabs. UI walkthroughs, data, fintech.",
    render: { duckDepth: 0.6, delay: { time: (60 / 122) * 0.75, fb: 0.5, mix: 0.45 } },
    sections: [["intro", 0, 4], ["groove", 4, 8], ["main", 8, 16], ["break", 16, 20], ["main 2", 20, 24]],
    build(X, g) {
      const t = g.t;
      const BASS = [[2, 0], [3, 0], [6, 12], [7, 0], [10, 0], [11, 3], [14, 0], [15, 5]]; // 16ths, semis over G
      const BLIP = [[0, 67], [3, 70], [6, 74], [10, 77], [12, 74]];
      const STAB = [55, 58, 62, 65]; // Gm7
      each(24, (b) => {
        const sec = b < 4 ? 0 : b < 8 ? 1 : b < 16 ? 2 : b < 20 ? 3 : 4;
        const full = sec === 2 || sec === 4, root = b % 4 === 3 ? 34 : 31; // G, Bb on every 4th bar
        const lastBar = b === 23;
        if (sec !== 3) each(4, (q) => { if (!(lastBar && q > 0)) X.kick(t(b, q), X.hv(1, 0.03)); });
        each(4, (q) => X.hat(t(b, q + 0.5), X.hv(sec === 0 ? 0.7 : 0.9), full, 0.2));
        if (sec >= 1) each(16, (s) => X.shaker(t(b, s / 4), X.hv(s % 4 === 2 ? 0.8 : 0.4)));
        if (sec >= 1 && sec !== 3) for (const s of [3, 6, 11, 14]) X.rim(t(b, s / 4), X.hv(0.8), s > 8 ? 0.3 : -0.2);
        if (full) { X.clap(t(b, 1), X.hv(0.7)); X.clap(t(b, 3), X.hv(0.75)); }
        if (sec >= 1 && !lastBar) for (const [s, semi] of BASS) X.sub(t(b, s / 4), g.beat / 4 * 0.8, root + semi, { vol: X.hv(sec === 3 ? 0.6 : 0.9, 0.05) });
        if (full || sec === 3) for (const [s, n] of BLIP) X.blip(t(b, s / 4), n + (b % 2 && s === 12 ? 3 : 0), { vel: X.hv(sec === 3 ? 1.3 : 1), pan: s % 2 ? 0.4 : -0.3, dec: 12 + (b % 4) * 4 });
        if ((sec >= 2) && b % 2 === 0) STAB.forEach((n, k) => X.supersaw(t(b, 1.5), 0.09, n + 12, { vol: 0.8, pan: (k - 1.5) * 0.3, cut: 2600, rel: 0.1, rev: 0.7, n: 3 }));
        if (sec === 3) X.pad(t(b), g.bar, STAB, 0.35, 900 + (b - 16) * 300);
      });
      X.riser(t(18), t(20), 0.9); X.swell(t(20), 1.2, 0.8); X.crash(t(20), 0.5); X.crash(t(8), 0.4);
      X.sub(t(23), g.beat * 1.5, 31, { vol: 0.9 }); X.blip(t(23), 67, { vel: 0.8 }); X.blip(t(23, 0.75), 74, { vel: 0.6 });
    },
  },

  /* ------------------------------------------------------------------ */
  bubblegum: {
    title: "Bubblegum", mood: ["uplifting", "playful", "pop"], bpm: 118, bars: 24, desc: "Bouncy pop with marimba, finger snaps and a whistled hook. Consumer apps, kids, food, social.",
    render: { duckDepth: 0.4, delay: { time: (60 / 118) * 0.5, fb: 0.2, mix: 0.2 } },
    sections: [["intro", 0, 4], ["verse", 4, 8], ["hook", 8, 16], ["break", 16, 20], ["hook 2", 20, 24]],
    build(X, g) {
      const t = g.t;
      const CH = [[62, 66, 69], [59, 62, 66], [59, 62, 67], [61, 64, 69]], RT = [38, 35, 43, 45]; // D Bm G A
      const WH = [
        [[0, 78, 2], [2, 81, 1], [3, 78, 1], [4, 76, 2], [6, 74, 2]],
        [[0, 74, 1], [1, 76, 1], [2, 78, 2], [4, 81, 2], [6, 83, 2]],
        [[0, 83, 2], [2, 81, 1], [3, 79, 1], [4, 78, 2], [6, 76, 2]],
        [[0, 76, 3], [3, 78, 1], [4, 76, 2], [6, 73, 2]],
      ];
      const MAR = [0, 2, 1, 2, 0, 2, 1, 2]; // chord-tone indices per 8th
      each(24, (b) => {
        const c = b % 4, sec = b < 4 ? 0 : b < 8 ? 1 : b < 16 ? 2 : b < 20 ? 3 : 4;
        const full = sec === 2 || sec === 4, last = b === 23;
        each(8, (e) => { if (!(last && e > 0)) X.marimba(t(b, e / 2), CH[c][MAR[e]] + (e === 3 || e === 7 ? 12 : 0), { vel: X.hv(e % 2 ? 0.6 : 0.85), pan: e % 2 ? 0.35 : -0.35 }); });
        if (sec === 0 || sec === 3) { X.snap(t(b, 1), X.hv(0.9)); X.snap(t(b, 3), X.hv(0.9)); }
        if (sec >= 1 && sec !== 3 && !last) {
          X.kick(t(b, 0), 1); X.kick(t(b, 1.5), 0.7); X.kick(t(b, 2), 0.95);
          X.clap(t(b, 1), X.hv(0.85)); X.clap(t(b, 3), X.hv(0.9)); X.snap(t(b, 3.5), 0.4);
          each(8, (e) => X.hat(t(b, e / 2 + 0.25), X.hv(0.35), false, 0.3));
          each(4, (q) => { X.bass(t(b, q), g.beat * 0.3, RT[c], X.hv(0.9)); X.bass(t(b, q + 0.5), g.beat * 0.25, RT[c] + 12, X.hv(0.6)); });
        }
        if (sec === 3) X.pad(t(b), g.bar, CH[c], 0.4, 1400);
        if (full) {
          for (const [e, n, l] of WH[c]) X.whistle(t(b, e / 2), (l * g.beat) / 2 - 0.04, n, { vol: 0.95, from: e ? n + 1 : n - 2 });
          if (sec === 4) for (const [e, n] of WH[c]) X.glock(t(b, e / 2), n + 12, { vel: 0.45 });
          X.pad(t(b), g.bar, CH[c], 0.3, 1800);
        }
      });
      X.whoosh(t(7, 3), 0.5, 0.7, true); X.crash(t(8), 0.5); X.riser(t(18), t(20), 0.7); X.crash(t(20), 0.6);
      X.kick(t(23), 1); X.clap(t(23), 0.6); [62, 66, 69, 74].forEach((n, k) => X.glock(t(23, k * 0.25), n + 12, { vel: 0.7 }));
    },
  },
};

/* ================================ mastering ================================ */
function limit(L, R, ceil) {
  const n = L.length, la = Math.round(0.004 * SR), relC = 1 - Math.exp(-1 / (0.09 * SR));
  const need = new Float32Array(n);
  for (let i = 0; i < n; i++) { const a = Math.max(Math.abs(L[i]), Math.abs(R[i])); need[i] = a > ceil ? ceil / a : 1; }
  // m[i] = min(need[i..i+la]) via a monotonic deque
  const m = new Float32Array(n), dq = new Int32Array(n);
  let h = 0, tl = 0;
  for (let i = n - 1; i >= 0; i--) {
    while (tl > h && need[dq[tl - 1]] >= need[i]) tl--;
    dq[tl++] = i;
    while (dq[h] > i + la) h++;
    m[i] = need[dq[h]];
  }
  // backward box average over la keeps the gain ≤ need at every peak and ramps smoothly into it
  let acc = la, g = 1; // window starts full of virtual 1s (no reduction before the file)
  const outL = new Float32Array(n), outR = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    acc += m[i] - (i >= la ? m[i - la] : 1);
    const tgt = acc / la;
    g = tgt < g ? tgt : g + (tgt - g) * relC;
    outL[i] = Math.max(-ceil, Math.min(ceil, L[i] * g));
    outR[i] = Math.max(-ceil, Math.min(ceil, R[i] * g));
  }
  return [outL, outR];
}
/** RBJ high shelf / high-pass, run over a whole channel (the master "tilt": air up, rumble out). */
function tilt(x, shelfDb = 2, shelfHz = 5500, hpHz = 28) {
  const A = 10 ** (shelfDb / 40), w = (2 * Math.PI * shelfHz) / SR, c = Math.cos(w), al = (Math.sin(w) / 2) * Math.SQRT2, sA = Math.sqrt(A);
  const a0 = A + 1 - (A - 1) * c + 2 * sA * al;
  const sh = [A * (A + 1 + (A - 1) * c + 2 * sA * al), -2 * A * (A - 1 + (A + 1) * c), A * (A + 1 + (A - 1) * c - 2 * sA * al), 2 * (A - 1 - (A + 1) * c), A + 1 - (A - 1) * c - 2 * sA * al].map((v) => v / a0);
  const wh = (2 * Math.PI * hpHz) / SR, ch = Math.cos(wh), ah = Math.sin(wh) / (2 * 0.707), h0 = 1 + ah;
  const hp = [(1 + ch) / 2 / h0, -(1 + ch) / h0, (1 + ch) / 2 / h0, (-2 * ch) / h0, (1 - ah) / h0];
  let y = x;
  for (const [b0, b1, b2, a1, a2] of [sh, hp]) {
    const o = new Float32Array(y.length);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < y.length; i++) { const v = b0 * y[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = y[i]; y2 = y1; y1 = v; o[i] = v; }
    y = o;
  }
  return y;
}
function master(L, R, tiltDb = 2.5, ceilDb = CEIL_DB) {
  const ceil = 10 ** (ceilDb / 20);
  L = tilt(L, tiltDb); R = tilt(R, tiltDb);
  let gain = 10 ** ((TARGET_LUFS - integratedLufs(L, R)) / 20), out;
  for (let it = 0; it < 8; it++) {
    const gL = L.map((v) => v * gain), gR = R.map((v) => v * gain);
    out = limit(gL, gR, ceil);
    const err = TARGET_LUFS - integratedLufs(out[0], out[1]);
    if (Math.abs(err) < 0.05) break;
    gain *= 10 ** ((err * 1.4) / 20); // the limiter eats part of every boost: overshoot a little
  }
  // 12 ms fade-out so the loop point never clicks
  const f = Math.round(0.012 * SR), n = out[0].length;
  for (let i = 0; i < f; i++) { const k = n - 1 - i, g = i / f; out[0][k] *= g; out[1][k] *= g; }
  return out;
}

/** Min/max envelope of a track for the picker's mini waveform (0..255 each). */
function miniPeaks([L, R], n = 96) {
  const out = [], w = Math.floor(L.length / n);
  let max = 0;
  const raw = [];
  for (let i = 0; i < n; i++) { let a = 0; for (let k = i * w; k < (i + 1) * w; k++) a = Math.max(a, Math.abs(L[k]), Math.abs(R[k])); raw.push(a); max = Math.max(max, a); }
  for (const a of raw) out.push(Math.round((a / (max || 1)) * 99));
  return out;
}

function encode(wav, mp3) {
  execFileSync(FFMPEG, ["-loglevel", "error", "-y", "-i", wav, "-c:a", "libmp3lame", "-b:a", "192k", "-ar", "48000", "-map_metadata", "-1", "-id3v2_version", "3",
    "-metadata", "comment=CC0 - generated by Fusion Motion", "-metadata", "artist=Fusion Motion", mp3], { env: ffEnv });
}

/* ================================ main ================================ */
const only = process.argv.slice(2);
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(TMP, { recursive: true });
fs.mkdirSync(path.join(ROOT, "src/audio"), { recursive: true });
const manifestPath = path.join(OUT, "manifest.json");
const prev = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, "utf8")).tracks : [];
const tracks = [];
const report = [];

const jobs = [
  ...Object.entries(SONGS).map(([name, s]) => ({ name, s, kind: "library" })),
  // the two showcase reels' scores, mastered the same way so they sit at library loudness
  ...["s01", "s02", "s03"].map((k) => ({ name: `showcase-${k}`, s: { title: { s01: "Type a Sentence (score)", s02: "Solstice (score)", s03: "Everything Moves (score)" }[k], mood: ["showcase", "score"], bpm: 120, dur: SCORES[k].dur, score: k, desc: "Scored to the matching showcase reel." }, kind: "showcase" })),
];
for (const { name, s, kind } of jobs) {
  if (only.length && !only.includes(name)) { const p = prev.find((x) => x.name === name); if (p) tracks.push(p); continue; }
  const t0 = Date.now();
  let L, R, g = null;
  if (s.score) {
    const m = mixer(SCORES[s.score].dur);
    SCORES[s.score].build(m.I);
    [L, R] = m.render({ normalize: false, headroom: 1 });
  } else {
    g = G(s.bpm, s.swing ?? 0);
    const dur = s.bars * g.bar;
    const m = mixer(dur);
    const X = kit(m);
    s.build(X, g);
    [L, R] = m.render({ normalize: false, headroom: 1, ...s.render });
  }
  const raw = [L, R];
  const wav = path.join(TMP, `${name}.wav`), mp3 = path.join(OUT, `${name}.mp3`);
  // master → encode → measure the decoded mp3; MP3 adds inter-sample overshoot, so lower the ceiling until it fits
  let ceilDb = CEIL_DB, dL, dR;
  for (let it = 0; it < 4; it++) {
    [L, R] = master(raw[0], raw[1], s.tilt ?? 2.5, ceilDb);
    writeWav(wav, [L, R]);
    encode(wav, mp3);
    [dL, dR] = decode(mp3);
    const tp = peaks(dL, dR).truePeakDb;
    if (tp <= MAX_TP_DB) break;
    ceilDb -= tp - MAX_TP_DB + 0.15;
  }
  const sections = g ? s.sections.map(([nm, a, b]) => [nm, a * g.bar, b * g.bar]) : [];
  const a = analyze(dL, dR, { bpm: s.score ? undefined : s.bpm, sections, swing: s.swing ?? 0 });
  const dur = Math.round((L.length / SR) * 100) / 100;
  tracks.push({
    name, title: s.title, mood: s.mood, bpm: s.bpm, dur, file: `${name}.mp3`, bytes: fs.statSync(mp3).size, desc: s.desc,
    license: "CC0 — generated by Fusion", ...(kind === "showcase" ? { hidden: true } : {}), peaks: miniPeaks([L, R]),
  });
  report.push({ name, ...a, renderS: (Date.now() - t0) / 1000 });
  console.log(`${name.padEnd(18)} ${String(dur).padStart(6)}s  ${a.lufs} LUFS  TP ${a.truePeakDb} dBFS  tempo≈${a.tempo}  grid ${a.grid ? Math.round(a.grid.aligned * 100) + "%" : "-"}  bands ${Object.values(a.bands).join("/")}`);
}

const order = [...Object.keys(SONGS), "showcase-s01", "showcase-s02"];
tracks.sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name));
fs.writeFileSync(manifestPath, JSON.stringify({ license: "CC0 1.0 — original music generated by Fusion Motion's synth (bench/music-library.mjs). No attribution required.", tracks: tracks.map(({ peaks: _p, ...t }) => t) }, null, 1));
const ts = `// GENERATED by bench/music-library.mjs — do not edit. The bundled, royalty-free (CC0) music library.
// Files live in public/assets/music/<file>; docs reference them as lib://music/<name>.
export interface MusicTrack { name: string; title: string; mood: string[]; bpm: number; dur: number; file: string; desc: string; hidden?: boolean; peaks: number[] }
export const MUSIC: MusicTrack[] = ${JSON.stringify(tracks.map(({ bytes: _b, license: _l, ...t }) => t))};
`;
fs.writeFileSync(path.join(ROOT, "src/audio/music-catalog.ts"), ts);
fs.writeFileSync(path.join(TMP, "report.json"), JSON.stringify(report, null, 1));
console.log(`wrote ${tracks.length} tracks → ${path.relative(ROOT, OUT)}, report → out/music/report.json`);
