// Spectrogram contact sheet (log-frequency, dB colour) for eyeballing arrangements without listening.
//   node bench/spectrogram.mjs out.png file1.mp3 [file2 …]
// Each row: one file, time → x (fixed px/s), 30 Hz–16 kHz log → y. Written with a tiny PNG encoder (zlib only).
import fs from "node:fs";
import zlib from "node:zlib";
import path from "node:path";
import { decode, SR } from "./audio-analyze.mjs";

const [out, ...files] = process.argv.slice(2);
const PXS = 16, ROWH = 120, GAP = 14, n = 2048, hop = SR / PXS;
const fft = (re, im) => {
  const N = re.length;
  for (let i = 1, j = 0; i < N; i++) { let b = N >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= N; len <<= 1) {
    const a = (-2 * Math.PI) / len, wr = Math.cos(a), wi = Math.sin(a);
    for (let i = 0; i < N; i += len) { let cr = 1, ci = 0; for (let j = 0; j < len / 2; j++) { const k = i + j + len / 2, vr = re[k] * cr - im[k] * ci, vi = re[k] * ci + im[k] * cr; re[k] = re[i + j] - vr; im[k] = im[i + j] - vi; re[i + j] += vr; im[i + j] += vi; const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t; } }
  }
};
const cmap = (v) => { // 0..1 → dark blue → magenta → orange → pale yellow
  const s = [[10, 10, 30], [60, 20, 110], [190, 40, 110], [250, 140, 40], [255, 245, 190]];
  const x = Math.max(0, Math.min(0.9999, v)) * (s.length - 1), i = Math.floor(x), f = x - i;
  return s[i].map((c, k) => Math.round(c + (s[i + 1][k] - c) * f));
};
const rows = files.map((f) => decode(f));
const W = Math.ceil(Math.max(...rows.map(([L]) => L.length / SR)) * PXS) + 2;
const H = files.length * (ROWH + GAP);
const px = Buffer.alloc(W * H * 3, 255);
rows.forEach(([L, R], r) => {
  const hann = Float32Array.from({ length: n }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n));
  const y0 = r * (ROWH + GAP) + GAP;
  for (let x = 0; x * hop + n < L.length; x++) {
    const re = new Float64Array(n), im = new Float64Array(n);
    for (let i = 0; i < n; i++) re[i] = ((L[x * hop + i] + R[x * hop + i]) / 2) * hann[i];
    fft(re, im);
    for (let y = 0; y < ROWH; y++) {
      const f = 30 * (16000 / 30) ** (1 - y / ROWH), k = Math.round((f * n) / SR);
      const mag = Math.hypot(re[k], im[k]) / (n / 4);
      const dB = 20 * Math.log10(mag + 1e-9) + 3 * Math.log2(f / 1000); // +3 dB/oct tilt so highs are visible
      const [cr, cg, cb] = cmap((dB + 80) / 70);
      const o = ((y0 + y) * W + x) * 3;
      px[o] = cr; px[o + 1] = cg; px[o + 2] = cb;
    }
  }
  // 1-second ticks along the top of each row
  for (let s = 0; s * PXS < W; s++) for (let y = y0 - 4; y < y0; y++) { const o = (y * W + s * PXS) * 3; px[o] = px[o + 1] = px[o + 2] = s % 10 ? 170 : 40; }
});
const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc = (b) => { let c = -1; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
const raw = Buffer.alloc(H * (W * 3 + 1));
for (let y = 0; y < H; y++) px.copy(raw, y * (W * 3 + 1) + 1, y * W * 3, (y + 1) * W * 3);
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
fs.writeFileSync(out, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
console.log(out, `${W}×${H}`, files.map((f) => path.basename(f)).join(" "));
