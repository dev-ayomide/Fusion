# Token benchmark

Measured with `o200k_base` via `npm run bench` (Claude's tokenizer differs by a few percent; the ratios hold).

| Payload | Tokens | Note |
|---|---:|---|
| Orbit promo — whole document, minified | 1,290 | 7 s, 12 layers, 1080p |
| Orbit promo — whole document, pretty | 2,320 |  |
| Orbit promo — outline() (what the model reads) | 384 |  |
| inspect(title) — one layer, minified | 87 |  |
| catalog() — full behavior catalog | 712 | fetched on demand, not in the prompt |
| First draft — all ops (agent output) | 1,351 | 17 ops build the scene from blank |
| Scoped edit — headline bounce (agent output) | 44 |  |
| Camera tweak — push-in closer (agent output) | 20 |  |
| Single field edit | 16 |  |
| Retime a layer (delta, no model arithmetic) | 17 |  |
| Template “Product launch” — minified | 953 |  |
| Template “Kinetic type” — minified | 726 |  |
| Template “Logo reveal” — minified | 585 |  |

**For comparison — Fusion today:** the agent writes one Remotion TSX file per scene, then renders it. 129 scene files in `remotion/src/scenes`: median **1,251** tokens, range 2–3,121. Any change to a scene means regenerating that file and re-rendering (30–90 s).

**Reading it honestly:** a first draft costs about the same as one Remotion scene file (1,351 vs median 1,251) — but it is the whole multi-layer 3D video, it previews instantly, and it stays editable. The large saving is in iteration: a one-field change is ~16 output tokens and a scoped behaviour swap ~44, versus regenerating a ~1,251-token file and re-rendering. Input stays small too: the model reads a 384-token outline plus only the layers in scope.
