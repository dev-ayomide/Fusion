// Scores a showcase reel: a tiny deterministic synth (kick, clap, hats, bass, pads, plucks, risers,
// impacts, whooshes, typing ticks, reverb, sidechain) driven by a cue sheet aligned to the reel's timeline.
//   node bench/score.mjs <s01|s02> <out.wav>
// Mux: ffmpeg -i video.mp4 -i out.wav -c:v copy -c:a aac -b:a 256k -shortest final.mp4
// The mixer (instruments, buses, reverb, sidechain) is exported and reused by bench/music-library.mjs.
import fs from "node:fs";
import { fileURLToPath } from "node:url";

export const SR = 48000;
export const midi = (n) => 440 * 2 ** ((n - 69) / 12);

export function mixer(dur) {
  const N = Math.ceil(dur * SR);
  const bus = () => [new Float32Array(N), new Float32Array(N)];
  const dry = bus(), duck = bus(), send = bus();
  const side = new Float32Array(N); // sidechain gain reduction driven by kicks
  let seed = 1234567;
  const rnd = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 * 2 - 1; };

  // write a mono voice (fn(i, t) → sample) into a bus with pan and reverb send
  const voice = (t0, len, fn, { vol = 1, pan = 0, rev = 0.15, to = dry } = {}) => {
    const s0 = Math.round(t0 * SR), n = Math.round(len * SR);
    const gl = vol * Math.cos((pan + 1) * Math.PI / 4), gr = vol * Math.sin((pan + 1) * Math.PI / 4);
    for (let i = 0; i < n; i++) {
      const k = s0 + i; if (k < 0 || k >= N) continue;
      const v = fn(i, i / SR);
      to[0][k] += v * gl; to[1][k] += v * gr;
      if (rev) { send[0][k] += v * gl * rev; send[1][k] += v * gr * rev; }
    }
  };
  // RBJ biquad, coefficients recomputable per sample
  const biquad = () => {
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0, b0 = 1, b1 = 0, b2 = 0, a1 = 0, a2 = 0;
    const set = (type, f, q = 0.707) => {
      const w = 2 * Math.PI * Math.min(f, SR * 0.45) / SR, c = Math.cos(w), a = Math.sin(w) / (2 * q);
      let B0, B1, B2; const A0 = 1 + a;
      if (type === "lp") { B0 = (1 - c) / 2; B1 = 1 - c; B2 = (1 - c) / 2; }
      else if (type === "hp") { B0 = (1 + c) / 2; B1 = -(1 + c); B2 = (1 + c) / 2; }
      else { B0 = a; B1 = 0; B2 = -a; }
      b0 = B0 / A0; b1 = B1 / A0; b2 = B2 / A0; a1 = -2 * c / A0; a2 = (1 - a) / A0;
    };
    const run = (x) => { const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = x; y2 = y1; y1 = y; return y; };
    return { set, run };
  };

  const I = {
    kick(t, vol = 1) {
      let ph = 0;
      voice(t, 0.55, (i, s) => { ph += 2 * Math.PI * (44 + 120 * Math.exp(-s * 30)) / SR; return Math.sin(ph) * Math.exp(-s * 6.5) + (s < 0.004 ? rnd() * 0.5 : 0); }, { vol: vol * 1.1, rev: 0.02 });
      const s0 = Math.round(t * SR);
      for (let i = 0; i < SR * 0.4; i++) if (s0 + i < N && s0 + i >= 0) side[s0 + i] = Math.max(side[s0 + i], Math.exp(-i / SR * 9));
    },
    clap(t, vol = 1) {
      const f = biquad(); f.set("bp", 1500, 1.2);
      voice(t, 0.3, (i, s) => { const e = [0, 0.011, 0.022].reduce((a, o) => a + (s >= o ? Math.exp(-(s - o) * (o === 0.022 ? 18 : 90)) : 0), 0); return f.run(rnd()) * e * 2.2; }, { vol: vol * 0.55, pan: 0.05, rev: 0.35 });
    },
    snare(t, vol = 1) {
      const f = biquad(); f.set("hp", 1800); let ph = 0;
      voice(t, 0.22, (i, s) => { ph += 2 * Math.PI * 190 / SR; return (f.run(rnd()) * 0.8 + Math.sin(ph) * 0.5) * Math.exp(-s * 22); }, { vol: vol * 0.45, rev: 0.25 });
    },
    hat(t, vol = 1, open = false, pan = 0.25) {
      const f = biquad(); f.set("hp", 7500);
      voice(t, open ? 0.3 : 0.07, (i, s) => f.run(rnd()) * Math.exp(-s * (open ? 14 : 60)), { vol: vol * 0.28, pan, rev: 0.08 });
    },
    crash(t, vol = 1) {
      const f = biquad(); f.set("hp", 4000);
      voice(t, 2.5, (i, s) => f.run(rnd()) * Math.exp(-s * 1.8), { vol: vol * 0.3, pan: -0.2, rev: 0.4 });
    },
    bass(t, len, note, vol = 1) {
      const f = biquad(); let p1 = 0, p2 = 0; const hz = midi(note);
      voice(t, len, (i, s) => {
        if (i % 32 === 0) f.set("lp", 180 + 1400 * Math.exp(-s * 10), 1.4);
        p1 = (p1 + hz / SR) % 1; p2 = (p2 + hz * 1.006 / SR) % 1;
        const env = Math.min(1, s / 0.005) * Math.min(1, (len - s) / 0.03);
        return f.run((p1 * 2 - 1) + (p2 * 2 - 1)) * 0.5 * env + Math.sin(p1 * 2 * Math.PI) * 0.45 * env;
      }, { vol: vol * 0.55, rev: 0.02, to: duck });
    },
    pad(t, len, notes, vol = 1, cutoff = 1400) {
      notes.forEach((n, k) => {
        const f = biquad(); f.set("lp", cutoff, 0.8); const ph = [0, 0.3, 0.6], det = [0.996, 1, 1.0045], hz = midi(n);
        voice(t, len + 1.2, (i, s) => {
          let v = 0; for (let j = 0; j < 3; j++) { ph[j] = (ph[j] + hz * det[j] / SR) % 1; v += ph[j] * 2 - 1; }
          const env = Math.min(1, s / 0.7) * (s > len ? Math.exp(-(s - len) * 3) : 1);
          return f.run(v) * env * 0.16;
        }, { vol, pan: (k - 1) * 0.35, rev: 0.45, to: duck });
      });
    },
    pluck(t, note, vol = 1, pan = 0, dec = 5) {
      const f = biquad(); let p = 0; const hz = midi(note);
      voice(t, 0.8, (i, s) => {
        if (i % 16 === 0) f.set("lp", 500 + 5000 * Math.exp(-s * 18), 2);
        p = (p + hz / SR) % 1;
        return f.run((p < 0.5 ? 1 : -1) * 0.6 + (p * 2 - 1) * 0.4) * Math.exp(-s * dec) * Math.min(1, s / 0.002);
      }, { vol: vol * 0.3, pan, rev: 0.4 });
    },
    bell(t, note, vol = 1, pan = 0) {
      const hz = midi(note);
      voice(t, 2.5, (i, s) => (Math.sin(2 * Math.PI * hz * s) + 0.4 * Math.sin(2 * Math.PI * hz * 2.76 * s) * Math.exp(-s * 4)) * Math.exp(-s * 2.2) * Math.min(1, s / 0.003),
        { vol: vol * 0.12, pan, rev: 0.6 });
    },
    tick(t, vol = 1, hz = 2400) {
      const f = biquad(); f.set("bp", hz, 3);
      voice(t, 0.03, (i, s) => (f.run(rnd()) * 1.6 + Math.sin(2 * Math.PI * hz * 0.5 * s) * 0.3) * Math.exp(-s * 160), { vol: vol * 0.35, pan: rnd() * 0.3, rev: 0.05 });
    },
    riser(t0, t1, vol = 1) {
      const f = biquad(); let ph = 0; const len = t1 - t0;
      voice(t0, len, (i, s) => {
        const u = s / len;
        if (i % 64 === 0) f.set("bp", 250 * (32 ** u), 2.5);
        ph += 2 * Math.PI * (180 + 900 * u * u) / SR;
        return (f.run(rnd()) * 1.6 + Math.sin(ph) * 0.18) * u ** 1.6;
      }, { vol: vol * 0.55, rev: 0.3 });
    },
    swell(t1, len, vol = 1) { // reverse-cymbal style build that cuts dead on t1
      const f = biquad(); f.set("hp", 2500);
      voice(t1 - len, len, (i, s) => f.run(rnd()) * (s / len) ** 3, { vol: vol * 0.5, pan: 0.1, rev: 0.2 });
    },
    whoosh(t, len = 0.5, vol = 1, up = false) {
      const f = biquad();
      voice(t, len, (i, s) => {
        const u = s / len;
        if (i % 64 === 0) f.set("bp", up ? 300 * 20 ** u : 6000 * 0.05 ** u, 1.6);
        return f.run(rnd()) * Math.sin(Math.PI * u) * 1.8;
      }, { vol: vol * 0.5, pan: up ? 0.2 : -0.2, rev: 0.25 });
    },
    impact(t, vol = 1) {
      let ph = 0; const f = biquad(); f.set("lp", 900);
      voice(t, 3, (i, s) => { ph += 2 * Math.PI * (32 + 55 * Math.exp(-s * 6)) / SR; return Math.sin(ph) * Math.exp(-s * 1.6) * 1.1 + f.run(rnd()) * Math.exp(-s * 7) * 0.9; }, { vol: vol * 0.55, rev: 0.35 });
      I.crash(t, vol * 0.6);
      const s0 = Math.round(t * SR);
      for (let i = 0; i < SR * 0.7; i++) if (s0 + i < N) side[s0 + i] = Math.max(side[s0 + i], Math.exp(-i / SR * 4));
    },
    sub(t, vol = 1) { // soft heartbeat thump
      let ph = 0;
      voice(t, 0.5, (i, s) => { ph += 2 * Math.PI * (40 + 30 * Math.exp(-s * 20)) / SR; return Math.sin(ph) * Math.exp(-s * 8); }, { vol: vol * 0.7, rev: 0.1 });
    },
  };

  // freeverb-ish send: 4 combs + 2 allpasses per side
  function reverb(inp, room = 0.84, damp = 0.25) {
    const out = new Float32Array(N);
    const combs = [1557, 1617, 1491, 1422].map((d) => ({ b: new Float32Array(d), i: 0, s: 0 }));
    const aps = [556, 441].map((d) => ({ b: new Float32Array(d), i: 0 }));
    for (let k = 0; k < N; k++) {
      let y = 0;
      for (const c of combs) { const o = c.b[c.i]; c.s = o * (1 - damp) + c.s * damp; c.b[c.i] = inp[k] + c.s * room; c.i = (c.i + 1) % c.b.length; y += o; }
      for (const a of aps) { const o = a.b[a.i]; const v = -y + o; a.b[a.i] = y + o * 0.5; a.i = (a.i + 1) % a.b.length; y = v; }
      out[k] = y * 0.25;
    }
    return out;
  }

  /**
   * Sum the buses. Defaults reproduce the showcase scores exactly; the library passes
   * { normalize: false } and does loudness normalisation + limiting itself.
   */
  function render({ normalize = true, duckDepth = 0.7, drive = 1.1, room = 0.84, damp = 0.25, delay = null, headroom = 0 } = {}) {
    const rl = reverb(send[0], room, damp), rr = reverb(send[1].map((v, k) => (k > 23 ? send[1][k - 23] : 0)), room, damp);
    // optional ping-pong echo send (delay = { time, fb, mix }): fed from the reverb send, kept out of the lows
    if (delay) {
      const d = Math.round(delay.time * SR), hp = [biquad(), biquad()];
      hp[0].set("hp", 350); hp[1].set("hp", 350);
      const eL = new Float32Array(N), eR = new Float32Array(N);
      for (let k = 0; k < N; k++) {
        const inL = hp[0].run(send[0][k]), inR = hp[1].run(send[1][k]);
        const pL = k >= d ? eR[k - d] : 0, pR = k >= d ? eL[k - d] : 0;
        eL[k] = inR * 0.5 + pL * delay.fb;
        eR[k] = inL * 0.5 + pR * delay.fb;
      }
      for (let k = 0; k < N; k++) { rl[k] += eL[k] * delay.mix; rr[k] += eR[k] * delay.mix; }
    }
    const L = new Float32Array(N), R = new Float32Array(N);
    // headroom > 0: scale the bus so its raw peak sits at `headroom` before the tanh, i.e. gentle
    // saturation on transients only (the library masters loudness afterwards)
    let pre = 1;
    if (headroom) {
      let p = 0;
      for (let k = 0; k < N; k++) {
        const g = 1 - duckDepth * side[k];
        p = Math.max(p, Math.abs(dry[0][k] + duck[0][k] * g + rl[k]), Math.abs(dry[1][k] + duck[1][k] * g + rr[k]));
      }
      pre = headroom / (p || 1);
    }
    let peak = 0;
    for (let k = 0; k < N; k++) {
      const g = 1 - duckDepth * side[k];
      L[k] = Math.tanh((dry[0][k] + duck[0][k] * g + rl[k]) * pre * drive);
      R[k] = Math.tanh((dry[1][k] + duck[1][k] * g + rr[k]) * pre * drive);
      peak = Math.max(peak, Math.abs(L[k]), Math.abs(R[k]));
    }
    if (!normalize) return [L, R];
    const norm = 0.89 / (peak || 1), fade = Math.round(0.02 * SR);
    for (let k = 0; k < N; k++) { const f = k > N - fade ? (N - k) / fade : 1; L[k] *= norm * f; R[k] *= norm * f; }
    return [L, R];
  }
  return { I, render, N, voice, biquad, rnd, side, dry, duck, send };
}

export function writeWav(path, [L, R]) {
  const n = L.length, buf = Buffer.alloc(44 + n * 4);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write("WAVEfmt ", 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write("data", 36); buf.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) { buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[i])) * 32767), 44 + i * 4); buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, R[i])) * 32767), 46 + i * 4); }
  fs.writeFileSync(path, buf);
}

/* A minor, i–VI–III–VII: the "anthem" progression */
const CHORDS = [[57, 60, 64], [53, 57, 60], [60, 64, 67], [55, 59, 62]];
const ROOTS = [33, 29, 36, 31];
const range = (a, b, step) => { const r = []; for (let t = a; t < b - 1e-6; t += step) r.push(+t.toFixed(4)); return r; };

// a four-on-the-floor groove over [t0, t1) with the bar grid anchored at `anchor`
function groove(I, t0, t1, anchor, { kick = 1, clap = 1, hat = 1, bass = 1, arp = 0 } = {}) {
  const beat = 0.5;
  for (const t of range(t0, t1, beat)) {
    const b = Math.round((t - anchor) / beat), bar = Math.floor(b / 4), ch = ((bar % 4) + 4) % 4;
    if (kick) I.kick(t, kick);
    if (clap && b % 2 === 1) I.clap(t, clap);
    if (hat) { I.hat(t + 0.25, hat, true); I.hat(t, hat * 0.5); }
    if (bass) { I.bass(t + 0.25, 0.22, ROOTS[ch] + 12, bass); if (b % 4 === 3) I.bass(t + 0.375, 0.1, ROOTS[ch] + 24, bass * 0.7); }
    if (arp) {
      const n = CHORDS[ch];
      [n[0] + 12, n[1] + 12, n[2] + 12, n[1] + 24].forEach((m, j) => I.pluck(t + j * 0.125, m, arp, j % 2 ? 0.4 : -0.4));
    }
  }
}
function roll(I, t0, t1, vol = 1) { // snare roll that accelerates into t1
  let t = t0, step = 0.25;
  while (t < t1 - 0.01) { I.snare(t, vol * (0.4 + 0.6 * (t - t0) / (t1 - t0))); t += step; if (t > t0 + (t1 - t0) * 0.5) step = 0.125; if (t > t0 + (t1 - t0) * 0.8) step = 0.0625; }
}
const chordAt = (t, anchor) => CHORDS[((Math.floor((t - anchor) / 2) % 4) + 4) % 4];

const SCORES = {
  /* ---- 03 EVERYTHING MOVES: 120 BPM; spark 0–4, kinetic 4–8, dimension 8–12, worlds 12–16, finale 16–21 */
  s03: { dur: 21, build(I) {
    // spark: a low pad, a heartbeat on the beat, the prompt typing, everything winding up into the flash
    I.pad(0, 2, CHORDS[0].map((n) => n - 12), 0.9, 800); I.pad(2, 2, CHORDS[3].map((n) => n - 12), 0.9, 1100);
    for (const t of range(0.5, 3.6, 0.5)) I.sub(t, 0.55 + t * 0.1);
    for (let i = 0; i < 28; i++) I.tick(0.5 + i * 0.05, 0.5, 3000);
    [76, 81, 84, 88].forEach((n, i) => I.bell(1.0 + i * 0.25, n, 0.5, (i - 1.5) * 0.3));
    for (let i = 0; i < 40; i++) I.tick(2.6 + i * 0.03, 0.3 + i * 0.01, 1800);
    I.riser(1.8, 4.0, 1.1); I.swell(4.0, 1.4, 1); roll(I, 3.0, 4.0, 0.9);
    // kinetic: one hit per word, a 16th-note stutter, the tunnel
    I.impact(4.0, 1.1);
    [4.0, 4.5, 5.0, 5.5].forEach((t, i) => { I.kick(t, 1); I.clap(t, 0.7); I.whoosh(t - 0.08, 0.22, 0.7, true); I.bass(t, 0.4, [33, 29, 36, 31][i] + 12, 1); });
    I.impact(6.0, 0.9); I.kick(6.0, 1); I.bass(6.0, 0.9, 33 + 12, 1); I.pad(6.0, 0.5, CHORDS[0], 0.7, 2600);
    for (let i = 0; i < 8; i++) { const t = 6.5 + i * 0.125; I.snare(t, 0.7); I.pluck(t, 69 + [0, 7, 12, 3, 15, 10, 19, 24][i], 0.8, (i % 2 ? 0.4 : -0.4), 14); if (i % 2 === 0) I.kick(t, 0.8); }
    I.whoosh(7.45, 0.55, 1.1, true); roll(I, 7.5, 8.0, 1); I.riser(7.2, 8.0, 0.8);
    // dimension: the groove proper, arps, a whoosh as the torus hits the lens
    I.impact(8.0, 1.1);
    groove(I, 8, 12, 8, { arp: 0.8 });
    for (const t of [8, 10]) I.pad(t, 2, chordAt(t, 8), 0.6);
    [8.5, 9.0, 9.5, 10.0].forEach((t, i) => I.bell(t, [81, 84, 88, 93][i], 0.5, (i - 1.5) * 0.4));
    I.whoosh(11.5, 0.5, 1.2, true); I.swell(12.0, 0.8, 0.8);
    // worlds: breakdown at night, bells for the aurora; dawn brings a light pulse under the app
    I.impact(12.0, 0.8);
    for (const t of [12, 13]) I.pad(t, 1, chordAt(t, 12).map((n) => n + 12), 0.7, 2200);
    for (const t of range(12.25, 14, 0.25)) I.bell(t, [76, 79, 81, 84, 88, 84, 81][Math.round((t - 12.25) * 4) % 7], 0.35, Math.sin(t * 3) * 0.5);
    I.whoosh(13.75, 0.5, 0.9, true); I.swell(14.0, 0.8, 0.7);
    groove(I, 14, 16, 14, { kick: 0.6, clap: 0.4, bass: 0.7, hat: 0.5, arp: 0.55 });
    I.pad(14, 2, chordAt(14, 14).map((n) => n + 12), 0.5, 2000);
    for (let i = 0; i < 25; i++) I.tick(14.45 + i * 0.03, 0.4, 2800);
    for (let i = 0; i < 50; i++) I.tick(15.1 + i * 0.022, 0.25, 2200);
    I.riser(15.0, 16.0, 0.9); roll(I, 15.5, 16.0, 0.8);
    // finale: the vortex spins up, cuts dead on the collapse, one sentence typed in silence, the last hit
    I.impact(16.0, 1.1);
    groove(I, 16, 17.5, 16, { arp: 0.7 });
    I.riser(16.2, 17.5, 1.2); I.swell(17.5, 1.3, 1);
    I.sub(17.5, 1); I.pad(17.5, 2, [45, 52, 57], 0.35, 600);
    for (let i = 0; i < 45; i++) I.tick(17.65 + i * 0.035, 0.5, 2600 + (i % 3) * 300);
    I.riser(18.6, 19.5, 0.7); I.swell(19.5, 0.9, 0.9);
    I.impact(19.5, 1.2); I.kick(19.5, 1); I.bass(19.5, 1.2, 33 + 12, 0.9);
    I.pad(19.5, 1.5, CHORDS[0], 0.8, 1800); I.bell(19.5, 81, 1); I.bell(19.5, 88, 0.7, 0.3); I.bell(19.75, 93, 0.5, -0.3);
  } },
  /* ---- 02 SOLSTICE: 120 BPM from t=0; night 0–4, drop 4–8, sun 8–12, dawn 12–16, finale 16–21 */
  s02: { dur: 21, build(I) {
    I.pad(0, 2, CHORDS[0].map((n) => n - 12), 0.9, 900); I.pad(2, 2, CHORDS[1].map((n) => n - 12), 0.9, 1100);
    for (const t of [0.5, 1.5, 2.5]) I.sub(t, 0.7);
    for (let i = 0; i < 27; i++) I.tick(0.3 + i * 0.03, 0.5, 3200);
    ["E5", "A5", "C6", "E6"].forEach((_, i) => I.bell(1.0 + i * 0.25, [76, 81, 84, 88][i], 0.6, (i - 1.5) * 0.3));
    for (let i = 0; i < 26; i++) I.tick(2.2 + i * 0.035, 0.35, 1800);
    I.riser(2.0, 4.0, 1); I.swell(4.0, 1.6, 1); roll(I, 3.0, 4.0, 0.8);
    I.impact(4.0, 1);
    groove(I, 4, 8, 4, { arp: 0 });
    for (const t of range(4, 8, 0.5)) I.whoosh(t - 0.06, 0.22, 0.5, true);
    I.pad(4, 4, CHORDS[0], 0.5); roll(I, 7.5, 8.0, 0.9); I.riser(6.5, 8, 0.6);
    I.impact(8.0, 1);
    groove(I, 8, 12, 8, { arp: 0.8 });
    for (const t of [8, 10]) I.pad(t, 2, chordAt(t, 8), 0.6);
    I.whoosh(11.72, 0.6, 1);
    // dawn: breakdown, no kick, the pass flips in, stats pop on the beat
    I.impact(12.0, 0.6);
    for (const t of [12, 14]) I.pad(t, 2, chordAt(t, 12).map((n) => n + 12), 0.7, 2200);
    groove(I, 12, 16, 12, { kick: 0, clap: 0, bass: 0, hat: 0.5, arp: 0.5 });
    I.whoosh(12.25, 0.6, 0.8, true);
    [13.5, 14.0, 14.5].forEach((t, i) => { I.kick(t, 0.8); I.bell(t, [76, 81, 84][i], 0.8); });
    for (const t of range(12.3, 14.5, 0.06)) I.tick(t, 0.18, 2600);
    I.riser(14.2, 16, 1); roll(I, 15.0, 16.0, 1); I.swell(16, 1.2, 0.8);
    // finale: the sun rises, the logo lands, one last hit
    I.impact(16.0, 1.1);
    I.whoosh(16.0, 1.4, 1, true);
    groove(I, 16, 20, 16, { arp: 0.7 });
    for (const t of [16, 18]) I.pad(t, 2, chordAt(t, 16), 0.6);
    I.bell(16.9, 81, 1); I.bell(16.9, 88, 0.7, 0.3);
    for (let i = 0; i < 60; i++) I.tick(18 + i * 0.022, 0.25, 2200);
    I.impact(20.0, 1.2); I.pad(20, 0.6, CHORDS[0].map((n) => n - 12), 0.8, 700);
  } },

  /* ---- 01 "Type a sentence": spark 0–2.4, type 2.4–5.6, 3D 5.6–10, product 10–14.35, finale 14.35–18.6 */
  s01: { dur: 18.6, build(I) {
    I.pad(0, 2.4, [45, 52, 57], 0.8, 700);
    for (const t of range(0.4, 2.0, 0.4)) I.sub(t, 0.8);
    for (let i = 0; i < 24; i++) I.tick(0.45 + i * 0.045, 0.55, 3000);
    I.riser(0.9, 2.38, 1.1); I.swell(2.4, 1.2, 0.9);
    I.impact(2.4, 1.1);
    [2.85, 3.3, 3.98, 4.45].forEach((t, i) => { I.kick(t, 1); I.clap(t, 0.8); I.whoosh(t - 0.1, 0.25, 0.8, true); I.bass(t, 0.35, [33, 36, 29, 31][i] + 12, 1); });
    for (let i = 0; i < 9; i++) I.pluck(3.3 + i * 0.025, 69 + [0, 3, 7, 12, 15, 19, 24, 19, 15][i], 0.5, (i - 4) * 0.1);
    for (let i = 0; i < 7; i++) I.tick(4.45 + i * 0.035, 0.6, 1600);
    I.riser(4.6, 5.55, 0.8); I.swell(5.6, 0.9, 1);
    I.impact(5.6, 1.2);
    groove(I, 5.6, 9.6, 5.6, { arp: 0.6 });
    for (const t of [5.6, 7.6]) I.pad(t, 2, chordAt(t, 5.6), 0.6);
    I.whoosh(9.35, 0.7, 1.2, true); roll(I, 9.1, 9.85, 0.8);
    I.impact(10.0, 0.9);
    // product: a lighter pulse under the typing and the ops
    groove(I, 10.0, 14.0, 10.0, { kick: 0.55, clap: 0, bass: 0.6, hat: 0.4 });
    for (const t of [10, 12]) I.pad(t, 2, chordAt(t, 10).map((n) => n + 12), 0.45, 2000);
    for (let i = 0; i < 42; i++) I.tick(10.45 + i * 0.028, 0.5, 2800);
    I.whoosh(11.7, 0.5, 0.8, true);
    for (let i = 0; i < 5; i++) I.pluck(11.85 + i * 0.32, [76, 79, 81, 84, 88][i], 0.8, (i - 2) * 0.25);
    I.sub(12.3, 1); I.sub(12.45, 0.6);
    I.riser(12.55, 13.65, 0.35);
    for (const t of range(12.9, 14.1, 0.05)) I.tick(t, 0.2, 2000);
    I.riser(13.6, 14.33, 0.8); I.swell(14.35, 0.7, 0.8);
    I.impact(14.35, 1);
    for (const t of [14.35, 16.35]) I.pad(t, 2, chordAt(t, 14.35), 0.7, 1600);
    groove(I, 14.35, 18.35, 14.35, { kick: 0.7, clap: 0.5, bass: 0.8, arp: 0.45 });
    I.bell(14.85, 81, 1); I.bell(14.85, 88, 0.6, 0.3);
    for (let i = 0; i < 27; i++) I.tick(15.85 + i * 0.045, 0.4, 2600);
    I.impact(18.1, 0.6);
  } },
};

export { SCORES };

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [which, outPath] = process.argv.slice(2);
  const sc = SCORES[which];
  if (!sc) { console.error(`usage: node bench/score.mjs <${Object.keys(SCORES).join("|")}> out.wav`); process.exit(1); }
  const m = mixer(sc.dur);
  sc.build(m.I);
  writeWav(outPath, m.render());
  console.log(outPath, sc.dur + "s");
}
