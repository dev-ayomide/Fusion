/**
 * Token benchmark: what the model reads and writes with FMD vs. writing Remotion scene code.
 * Tokenizer: o200k_base (GPT-4o family) — a stand-in; Claude's tokenizer differs by a few percent.
 * Run: npm run bench   → prints a table and writes docs/TOKENS.md
 */
import fs from "node:fs";
import path from "node:path";
import { encode } from "gpt-tokenizer/encoding/o200k_base";
import { TEMPLATES } from "../src/templates";
import { outline, inspect, catalog } from "../src/fmd/outline";
import { applyTxn, type Op } from "../src/fmd/ops";
import "../src/runtime/evaluate";
import * as S from "../e2e/orbit-script";

const tok = (s: string) => encode(s).length;
const rows: [string, number, string][] = [];
const add = (label: string, s: string, note = "") => rows.push([label, tok(s), note]);

// the recorded session's final document, if present; otherwise rebuild it from the script
const blank = TEMPLATES.find((t) => t.id === "blank")!.make();
blank.assets = { "orbit-app": { src: "asset://sha256/0", mime: "image/png", w: 780, h: 1688 }, "orbit-logo": { src: "asset://sha256/1", mime: "image/png", w: 512, h: 512 } };
const built = applyTxn(blank, S.FIRST_OPS as Op[], { source: "ai" });
if (!built.ok) throw new Error(built.errors.join("\n"));
const orbit = built.doc;

add("Orbit promo — whole document, minified", JSON.stringify(orbit), "7 s, 12 layers, 1080p");
add("Orbit promo — whole document, pretty", JSON.stringify(orbit, null, 2));
add("Orbit promo — outline() (what the model reads)", outline(orbit));
add("inspect(title) — one layer, minified", inspect(orbit, ["title"]));
add("catalog() — full behavior catalog", catalog(), "fetched on demand, not in the prompt");
add("First draft — all ops (agent output)", JSON.stringify(S.FIRST_OPS), `${S.FIRST_OPS.length} ops build the scene from blank`);
add("Scoped edit — headline bounce (agent output)", JSON.stringify(S.SCOPED_OPS));
add("Camera tweak — push-in closer (agent output)", JSON.stringify(S.PUSH_OPS));
add("Single field edit", JSON.stringify([{ op: "set", path: "title/size", value: 140 }]));
add("Retime a layer (delta, no model arithmetic)", JSON.stringify([{ op: "set", path: "sub/in", delta: 0.3 }]));
for (const t of TEMPLATES.filter((x) => x.id !== "blank")) add(`Template “${t.title}” — minified`, JSON.stringify(t.make()));

// Fusion's current path: the agent writes a Remotion scene file per scene
const scenesDir = path.resolve("../remotion/src/scenes");
const tsx: number[] = [];
const walk = (d: string) => {
  if (!fs.existsSync(d)) return;
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (/\.tsx$/.test(f) && !/index/.test(f)) tsx.push(tok(fs.readFileSync(p, "utf8")));
  }
};
walk(scenesDir);
tsx.sort((a, b) => a - b);
const median = tsx.length ? tsx[Math.floor(tsx.length / 2)] : 0;

const lines = [
  "# Token benchmark",
  "",
  "Measured with `o200k_base` via `npm run bench` (Claude's tokenizer differs by a few percent; the ratios hold).",
  "",
  "| Payload | Tokens | Note |",
  "|---|---:|---|",
  ...rows.map(([l, n, note]) => `| ${l} | ${n.toLocaleString()} | ${note} |`),
  "",
  `**For comparison — Fusion today:** the agent writes one Remotion TSX file per scene, then renders it. ${tsx.length} scene files in \`remotion/src/scenes\`: median **${median.toLocaleString()}** tokens, range ${tsx[0]?.toLocaleString()}–${tsx.at(-1)?.toLocaleString()}. Any change to a scene means regenerating that file and re-rendering (30–90 s).`,
  "",
  `**Reading it honestly:** a first draft costs about the same as one Remotion scene file (${rows.find((r) => r[0].startsWith("First draft"))![1].toLocaleString()} vs median ${median.toLocaleString()}) — but it is the whole multi-layer 3D video, it previews instantly, and it stays editable. The large saving is in iteration: a one-field change is ~${rows.find((r) => r[0] === "Single field edit")![1]} output tokens and a scoped behaviour swap ~${rows.find((r) => r[0].startsWith("Scoped edit"))![1]}, versus regenerating a ~${median.toLocaleString()}-token file and re-rendering. Input stays small too: the model reads a ${rows.find((r) => r[0].includes("outline()"))![1]}-token outline plus only the layers in scope.`,
  "",
];
fs.writeFileSync(path.resolve("docs/TOKENS.md"), lines.join("\n"));
console.log(lines.join("\n"));
