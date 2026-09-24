# Measuring output quality

"Looks premium" has to be measurable, or every change is a matter of taste. We measure output quality in three
ways. Each catches failures the others miss.

1. **Reference replication.** Rebuild a professional piece in Fusion, render it, and compare it frame by frame
   against the original with objective metrics (below).
2. **A craft rubric.** A reviewer (a person, or Claude looking at contact sheets) scores eight craft dimensions
   from 1 to 5 against the reference.
3. **Performance.** Frame time for preview and export, because an editor that stutters produces worse work.

The reference is the Pear breakdown: a 2×2 grid of four looping shots from a premium app-launch ad. The
replicas are ordinary FMD documents in [`fixtures/pear/`](../fixtures/pear), written with no special-casing
in the engine.

## Objective metrics (`bench/quality.py`)

Each replica quadrant is rendered as one loop and compared with the same loop cropped out of the reference,
aligned at t = 0, at 160×90:

| metric | what it measures | reading |
|---|---|---|
| `ssim` | mean structural similarity of aligned frames | 1 = identical. It rewards the right layout at the right time. |
| `dE` | mean CIE76 ΔE between 6×6 average-colour grids | Palette and composition. Below 10 reads as "the same shot"; above 20 is a different look. |
| `timing` | Pearson r between the two motion-energy curves (mean frame-to-frame change, ±1 frame smoothing) | Did things move, cut and settle at the same moments? Above 0.6 is good. |
| `energy` | replica motion energy ÷ reference motion energy | Below 0.7 means the replica is too static; above 1.3 means it's busier than the original. |

Why these four: SSIM alone punishes a sky that is procedural rather than photographic, even when timing and
composition are right. The timing correlation is blind to looks, and `dE` is blind to motion. Together
they separate *wrong look*, *wrong layout* and *wrong rhythm*.

For calibration, the same tool scores two naive replicas: a static average frame of the reference, and the
reference itself shifted by half a loop. See the results table.

Reproduce:

```bash
# render one loop of a quadrant (PNG sequence), from the frozen render server
npx vite --config render.vite.config.ts &            # port 5181, no HMR
node bench/render-frames.mjs /fixtures/pear/q1.fmd.json out/q1 960
python bench/quality.py pear.mp4 out/q1 --crop 0:0:960:540 --period 3.3
```

## Craft rubric (1–5, against the reference)

| dimension | 5 looks like |
|---|---|
| Composition & framing | Same focal point, scale and negative space in each shot |
| Typography | Same families and contrast (clean sans plus expressive script), tight tracking, crisp at 1080p |
| Easing & timing | Expo-style ease-outs, no mid-move hitches, holds land on the beat |
| Materials & light | Foil/chrome reads as physical; highlights, reflections and shadows agree with the environment |
| Backgrounds | Sky, mountains and grass read as places, not gradients |
| Transitions | Blur-throughs, white-outs and cloud dissolves feel optical, not like crossfades |
| Finish | Motion blur on fast moves, bloom on accents, grain and vignette that unify |
| UI fidelity | Product UI is crisp, correctly laid out, and animates like a real app (typing, counters, selections) |

## Results

See the section at the end of this file, filled in by the replication run.
