"""
Replica-vs-reference quality metrics (see docs/QUALITY.md).

  python bench/quality.py <reference.mp4> <replica_dir_or_mp4> --crop x:y:w:h --period SECONDS [--fps 30]

The reference crop is one quadrant of the breakdown video; the replica is a PNG sequence
(f0000.png…) or a video of one loop. Frames are compared at 160×90, loop-aligned at t=0.

Metrics
  ssim     mean structural similarity of aligned frames (0..1, 1 = identical)
  dE       mean CIE76 colour distance between 6×6 average-colour grids (palette + layout; <10 good)
  timing   Pearson r between the two motion-energy curves (frame-to-frame change) — did things
           move at the same moments, with the same accents? (-1..1, >0.6 good)
  energy   replica motion energy / reference motion energy (1 = as lively; <0.7 = too static)
"""
import argparse, glob, json, os, subprocess, sys
import numpy as np
from PIL import Image
from skimage.metrics import structural_similarity
from skimage.color import rgb2lab

FF = os.environ.get("FFMPEG", "ffmpeg")
W, H = 160, 90


def read_video(path, crop=None, t0=0.0, dur=None, fps=30):
    vf = []
    if crop:
        x, y, w, h = crop.split(":")
        vf.append(f"crop={w}:{h}:{x}:{y}")
    vf += [f"fps={fps}", f"scale={W}:{H}:flags=area", "format=rgb24"]
    cmd = [FF, "-loglevel", "error", "-ss", str(t0)] + (["-t", str(dur)] if dur else []) + ["-i", path, "-vf", ",".join(vf), "-f", "rawvideo", "-"]
    raw = subprocess.run(cmd, capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.uint8).reshape(-1, H, W, 3).astype(np.float32) / 255.0


def read_frames(path, fps):
    if os.path.isdir(path):
        files = sorted(glob.glob(os.path.join(path, "f*.png")))
        return np.stack([np.asarray(Image.open(f).convert("RGB").resize((W, H), Image.BOX), np.float32) / 255.0 for f in files])
    return read_video(path, fps=fps)


def grid_lab(frames, n=6):
    f = frames[:, : H - H % n, : W - W % n]
    g = f.reshape(len(f), n, f.shape[1] // n, n, f.shape[2] // n, 3).mean(axis=(2, 4))
    return rgb2lab(g)


def motion(frames):
    d = np.abs(np.diff(frames, axis=0)).mean(axis=(1, 2, 3))
    return np.concatenate([[d[0]], d])


def metrics(ref, rep):
    n = min(len(ref), len(rep))
    ref, rep = ref[:n], rep[:n]
    ssim = float(np.mean([structural_similarity(a, b, channel_axis=2, data_range=1.0) for a, b in zip(ref, rep)]))
    dE = float(np.linalg.norm(grid_lab(ref) - grid_lab(rep), axis=-1).mean())
    mr, mp = motion(ref), motion(rep)
    k = np.ones(3) / 3  # light smoothing: accents within ±1 frame count as on time
    mr_s, mp_s = np.convolve(mr, k, "same"), np.convolve(mp, k, "same")
    timing = float(np.corrcoef(mr_s, mp_s)[0, 1]) if mp_s.std() > 1e-9 and mr_s.std() > 1e-9 else 0.0
    energy = float(mp.mean() / max(mr.mean(), 1e-6))
    return {"frames": n, "ssim": round(ssim, 3), "dE": round(dE, 1), "timing": round(timing, 3), "energy": round(energy, 2)}


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("reference")
    ap.add_argument("replica")
    ap.add_argument("--crop")
    ap.add_argument("--period", type=float, required=True)
    ap.add_argument("--fps", type=int, default=30)
    ap.add_argument("--label", default="")
    ap.add_argument("--baselines", action="store_true", help="also score two naive replicas for calibration")
    a = ap.parse_args()
    ref = read_video(a.reference, a.crop, 0, a.period, a.fps)
    if a.baselines:
        static = np.repeat(ref.mean(axis=0, keepdims=True), len(ref), axis=0)
        shifted = np.roll(ref, len(ref) // 2, axis=0)
        print(json.dumps({**metrics(ref, static), "label": f"{a.label} baseline: static mean frame"}))
        print(json.dumps({**metrics(ref, shifted), "label": f"{a.label} baseline: reference shifted half a loop"}))
    rep = read_frames(a.replica, a.fps)
    m = metrics(ref, rep)
    m["label"] = a.label
    print(json.dumps(m))
