import type { Doc, Layer } from "./schema";
import { CATALOG, channelsFor } from "./catalog";

const n = (v: number) => String(Math.round(v * 100) / 100);

function layerLine(doc: Doc, l: Layer): string {
  const parts: string[] = [l.id, l.type];
  parts.push(`${n(l.in ?? 0)}–${n(l.out ?? doc.comp.dur)}`);
  if (l.type === "text") parts.push(JSON.stringify(l.text.length > 40 ? l.text.slice(0, 38) + "…" : l.text));
  if (l.pos && l.type !== "gradient") parts.push(`pos ${l.pos.map(n).join(",")}`);
  if (l.parent) parts.push(`parent ${l.parent}`);
  if (l.beh?.length) parts.push("beh " + l.beh.map((b) => `${b.id}=${b.use}@${n(b.at)}`).join(","));
  const keys = Object.entries(l.keys ?? {});
  if (keys.length) parts.push("keys " + keys.map(([c, t]) => `${c}(${t.length})`).join(","));
  if (l.type === "text" && l.anim?.length) parts.push("anim " + l.anim.map((a) => a.id).join(","));
  if (l.expr && Object.keys(l.expr).length) parts.push("expr " + Object.keys(l.expr).join(","));
  if (l.hidden) parts.push("hidden");
  return parts.join(" ");
}

/** A compact, one-line-per-layer view of the document for the model (≈10 tokens per layer). */
export function outline(doc: Doc): string {
  const c = doc.comp;
  const lines = [
    `comp ${c.w}x${c.h} ${n(c.dur)}s ${c.fps}fps bg ${c.bg}${c.cam ? " cam " + c.cam : ""}`,
    `brand font ${doc.brand.font} · ${Object.entries(doc.brand.colors).map(([k, v]) => `$${k} ${v}`).join(" ")}`,
    `style ${Object.entries(doc.style).map(([k, v]) => `${k} ${n(v)}`).join(" ")}${doc.bindings.length ? ` · ${doc.bindings.length} bindings` : ""}`,
  ];
  if (Object.keys(doc.assets).length) lines.push("assets " + Object.entries(doc.assets).map(([k, a]) => `${k}(${a.mime.split("/")[1]}${a.w ? ` ${a.w}x${a.h}` : ""})`).join(" "));
  if (doc.markers.length) lines.push("markers " + doc.markers.map((m) => `${m.id}@${n(m.t)}`).join(" "));
  for (const sc of doc.scenes) lines.push(`scene ${sc.id} ${n(sc.start)}–${n(sc.start + sc.dur)} ${JSON.stringify(sc.title)}${sc.status ? " " + sc.status : ""}: ${sc.brief.length > 90 ? sc.brief.slice(0, 88) + "…" : sc.brief}`);
  for (const a of doc.audio) lines.push(`audio ${a.id} ${a.src}${a.name ? ` ${JSON.stringify(a.name)}` : ""} @${n(a.at)}${a.dur ? ` for ${n(a.dur)}s` : ""} vol ${n(a.volume)}${a.muted ? " muted" : ""}`);
  lines.push("layers back→front:");
  for (const l of doc.layers) lines.push(layerLine(doc, l));
  return lines.join("\n");
}

/** Full JSON for the requested layers only, minified. */
export function inspect(doc: Doc, ids: string[]): string {
  return ids
    .map((id) => doc.layers.find((l) => l.id === id))
    .filter(Boolean)
    .map((l) => JSON.stringify(l))
    .join("\n");
}

/** Catalog lookup the model calls on demand instead of carrying it in the prompt. */
export function catalog(query = ""): string {
  const q = query.toLowerCase();
  return Object.values(CATALOG)
    .filter((s) => !q || s.use.toLowerCase().includes(q) || s.group.toLowerCase().includes(q) || s.desc.toLowerCase().includes(q))
    .map((s) => {
      const params = Object.entries(s.params).map(([k, p]) => `${k}=${p.default}`).join(" ");
      return `${s.use} [${s.group}, ${s.mode}] writes ${s.writes.join(",")} dur ${s.dur}${s.bounce !== undefined ? ` bounce ${s.bounce}` : ""}${params ? " " + params : ""} — ${s.desc}`;
    })
    .join("\n");
}

export function channelsHelp(type: Layer["type"]): string {
  return channelsFor(type).join(", ");
}
