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

## Results: Pear replication (this round)

Rendered at 960×540 (one quadrant of the reference), 30 fps, 8-sample motion blur, and measured with
`bench/quality.py`. "v1" is the first full render; "final" is the best render after the iterations below.
Baselines are what a naive replica scores on the same quadrant.

| shot | what it is | SSIM v1 → final | ΔE v1 → final | timing r v1 → final | energy | baselines (static frame / half-loop shift) SSIM · ΔE |
|---|---|---|---|---|---|---|
| Q1 | pear card → kinetic type | 0.635 → **0.635** | 10.4 → **10.4** | 0.60 → **0.65** | 0.44 | 0.52 · 16.6 / 0.41 · 28.2 |
| Q2 | trade UI → Insights glass → mountains | 0.53 → **0.58** | 23.4 → **16.1** | −0.12 → **0.16** | 0.90 | 0.71 · 27.2 / 0.52 · 50.8 |
| Q3 | 3D phone + chat | 0.36 → **0.37** | 22.3 → **16.8** | 0.54 → 0.28 | 0.36 | 0.51 · 10.9 / 0.36 · 18.1 |
| Q4 | night → day, odds card, cloud dissolve | 0.33 → **0.34** | 23.0 → **19.6** | 0.21 → 0.14 | 0.52 | 0.62 · 21.3 / 0.40 · 33.2 |

How to read it:

- **Q1 is the closest replica.** It beats both baselines on every metric, and its timing correlation of 0.65
  means the card pops, the object burst, the blur-out and the type beats land on the same frames as the original.
- **Q2's timing went from uncorrelated to positive** once the shot was re-timed to beats *measured* from the
  reference's brightness curve: white UI until 2.17 s, glass card 2.3–3.65 s, mountains from 3.83 s. Its colour
  distance dropped by a third.
- **Q3 and Q4 still score below a blurry static frame on SSIM.** SSIM rewards fine structure, and ours
  is procedural (clouds, grass, mountains) where the reference is photographic. A blurred average matches
  "some sky, some grass" better than a sharp but *different* sky. Their ΔE (palette and layout) did improve
  clearly. Q3's timing got worse after I added a camera swing: it adds motion, but at different moments than the
  original.
- **Energy is under 1 everywhere except Q2.** The reference is busier: the camera never rests, the objects keep
  tumbling, and the photo backgrounds carry texture that changes every frame. This is the most consistent gap.

### What the iterations fixed (each found by looking at a side-by-side or a metric)

1. Placeholder frames: emoji rendered as black squares on the first frames. `Stage.prepare` now waits for every
   texture, so an offline frame can never contain a placeholder.
2. Selector semantics: child text layers don't inherit a parent's in-point, and write-on offsets must start at
   `−(end − start)`. Both are now documented in FMD-SPEC and used correctly in the fixtures.
3. Scale: the "Trade and Share" title was 0.6× the reference; measuring text width against the reference fixed it.
4. Sky: overcast, uniform clouds → perspective-projected cumulus lit from the sun; night clouds take the sky's colour.
5. Mountains: vertical-stripe shading → a 2D ridged heightfield whose normals are lit, with snow on flat, high faces.
6. Grass: radial stripes converging on the horizon → an isotropic ground-plane texture with patches, wind sheen and
   tapered near-camera blades.
7. Framing: Q3's camera was too low and close (the phone became a giant trapezoid); Q4's foreground was too bright
   (the reference is L≈25 at the bottom, ours was ≈50).
8. Timing: Q2 re-timed from the reference's measured brightness curve (see above).

### Remaining gaps (honest list)

| gap | why | path |
|---|---|---|
| Photographic plates (stadium, real clouds, real meadow) | No photo source was reachable from this sandbox (only npm/PyPI) | A stock-photo provider (Unsplash/Pexels) in the asset library; `image` layers already accept any photo |
| Foil balloon realism | Lathe mesh plus sine crinkles; the reference has real mylar wrinkles and seams | Normal-map crinkles, or an authored GLB balloon |
| Constant camera life | Replicas rest between beats | A "handheld drift" camera behaviour on by default for promos |
| Script write-on | We wipe each glyph left→right; the reference strokes the letterforms | Stroke-order SVG fonts or a masked path trace |
| Speed graph | Only the value graph exists | Derivative plot + influence handles |

## Performance (software GL in this sandbox; a real GPU is roughly 50–100× faster)

| measurement | value |
|---|---|
| `renderFrame`, sky-only doc, 640×360, cached sky | ~40 ms |
| `renderFrame`, Q1, 640×360, per motion-blur sample | ~140 ms |
| Sky re-render cost removed by the cache (motion-blur subframes / paused frames) | 1 draw per frame instead of 1 per sample |
| Export, 30 frames at 720p (e2e) | ~40 s |
| Offline replica render, 960×540, 8 samples, 4 in parallel | ~5 frames/min per quadrant |

Editor smoothness: during playback the viewport measures frame intervals and scales render resolution between
0.4 and 1 in 0.1 steps (text keeps full resolution). It drops to 1 motion-blur sample below 0.8 scale, and
always renders the paused frame at full quality. The playhead runs in real time: slow frames drop, they don't
slow the clock.
