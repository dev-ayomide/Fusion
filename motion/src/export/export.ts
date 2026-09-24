import { Output, BufferTarget, CanvasSource, Mp4OutputFormat, WebMOutputFormat, QUALITY_HIGH, QUALITY_MEDIUM, getFirstEncodableVideoCodec, type VideoCodec } from "mediabunny";
import type { Doc } from "../fmd/schema";
import { evaluate } from "../runtime/evaluate";
import { Stage } from "../render/stage";
import { preloadTextures } from "../assets/assets";
import { ensureFont, fontsReady } from "../render/glyphs";

export interface ExportOptions {
  format: "mp4" | "webm";
  height: number; // 720 | 1080 | 2160 …
  quality: "standard" | "high";
  fps?: number;
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
}
export interface ExportResult { blob: Blob; codec: VideoCodec; mime: string; ext: string; width: number; height: number; frames: number; ms: number }

const MP4_CODECS: VideoCodec[] = ["avc", "hevc", "av1", "vp9"];
const WEBM_CODECS: VideoCodec[] = ["vp9", "av1", "vp8"];

/**
 * Offline export: the preview renderer IS the export renderer. Every frame is evaluate(doc, t)
 * drawn by a fresh Stage at the target size and handed to the encoder — no screen capture,
 * no dropped frames, identical to scrubbing.
 */
export async function exportVideo(doc: Doc, opts: ExportOptions): Promise<ExportResult> {
  const t0 = performance.now();
  const fps = opts.fps ?? doc.comp.fps;
  const height = Math.round(opts.height / 2) * 2;
  const width = Math.round((height * doc.comp.w) / doc.comp.h / 2) * 2;
  const quality = opts.quality === "high" ? QUALITY_HIGH : QUALITY_MEDIUM;
  const codec = await getFirstEncodableVideoCodec(opts.format === "mp4" ? MP4_CODECS : WEBM_CODECS, { width, height, quality });
  if (!codec) throw new Error(`This browser can't encode ${opts.format.toUpperCase()} at ${width}×${height}. Try WebM or a smaller size.`);

  for (const L of doc.layers) if (L.type === "text") ensureFont(L.font ?? doc.brand.font, L.weight ?? 600);
  await fontsReady();
  await preloadTextures(Object.keys(doc.assets));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const stage = new Stage(canvas, { preserveDrawingBuffer: true });
  stage.textResolution = Math.max(1, height / doc.comp.h) * 1.5;
  stage.setSize(width, height, 1);

  const output = new Output({ format: opts.format === "mp4" ? new Mp4OutputFormat({ fastStart: "in-memory" }) : new WebMOutputFormat(), target: new BufferTarget() });
  const source = new CanvasSource(canvas, { codec, quality, keyFrameInterval: 1 });
  output.addVideoTrack(source, { frameRate: fps });
  await output.start();

  const total = Math.max(1, Math.round(doc.comp.dur * fps));
  try {
    // warm-up render so glyph and screen textures exist before frame 0 is captured
    stage.sync(doc, evaluate(doc, 0));
    stage.render();
    await new Promise((r) => setTimeout(r, 50));
    for (let i = 0; i < total; i++) {
      if (opts.signal?.aborted) throw new DOMException("Export cancelled", "AbortError");
      const t = i / fps;
      stage.sync(doc, evaluate(doc, t));
      stage.render();
      await source.add(t, 1 / fps);
      opts.onProgress?.(i + 1, total);
      if (i % 6 === 0) await new Promise((r) => setTimeout(r, 0));
    }
    await output.finalize();
  } catch (e) {
    await output.cancel().catch(() => undefined);
    stage.dispose();
    throw e;
  }
  stage.dispose();
  const buf = (output.target as BufferTarget).buffer!;
  const mime = output.format.mimeType;
  return { blob: new Blob([buf], { type: mime }), codec, mime, ext: output.format.fileExtension, width, height, frames: total, ms: performance.now() - t0 };
}

export function downloadBlob(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
}
