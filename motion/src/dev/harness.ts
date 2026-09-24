import "../fonts";
import { TEMPLATES } from "../templates";
import { Stage } from "../render/stage";
import { fontsReady, ensureFont, onFontsChanged } from "../render/glyphs";
import { onAssetsChanged } from "../assets/assets";
import { onEnvReady } from "../render/env";
import { onHtmlReady } from "../render/html";
import type { Doc } from "../fmd/schema";

/**
 * Deterministic render harness for screenshots and perf:
 *   /harness.html?t=<template>&time=3&w=1280       a built-in template
 *   /harness.html?doc=/fixtures/x.fmd.json&time=2   any FMD file served by vite
 *   &samples=16                                     override motion-blur samples
 *   &bench=1                                        time 60 renderFrame calls → window.bench
 */
const q = new URLSearchParams(location.search);
const W = window as unknown as { ready: boolean; bench?: { ms: number; frames: number }; setTime?: (t: number) => Promise<void> };
const time = Number(q.get("time") ?? 3);
const samples = q.get("samples") ? Number(q.get("samples")) : undefined;

async function load(): Promise<Doc> {
  const src = q.get("doc");
  if (src) return (await (await fetch(src)).json()) as Doc;
  return TEMPLATES.find((t) => t.id === (q.get("t") ?? "launch"))!.make();
}

const doc = await load();
const w = Number(q.get("w") ?? 1280), h = Math.round((w * doc.comp.h) / doc.comp.w);
const canvas = document.getElementById("c") as HTMLCanvasElement;
const stage = new Stage(canvas, { preserveDrawingBuffer: true });
stage.setSize(w, h, 1);
stage.textResolution = Math.max(1, h / doc.comp.h) * 1.5;
let at = time;
const draw = () => stage.renderFrame(doc, at, { samples });
for (const L of doc.layers) if (L.type === "text") ensureFont(L.font ?? doc.brand.font, L.weight ?? 600);
onFontsChanged(draw);
onAssetsChanged(draw);
onEnvReady(draw);
onHtmlReady(draw);
W.setTime = async (t: number) => {
  at = t;
  await stage.prepare(doc, t);
  draw();
};
await fontsReady();
await stage.prepare(doc, time);
draw();
if (q.get("bench")) {
  const n = 60, t0 = performance.now();
  for (let i = 0; i < n; i++) {
    stage.renderFrame(doc, (i / n) * doc.comp.dur, { samples });
    stage.renderer.getContext().finish();
  }
  W.bench = { ms: (performance.now() - t0) / n, frames: n };
  draw();
}
setTimeout(() => (W.ready = true), 200);
