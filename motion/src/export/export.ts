import { Output, BufferTarget, CanvasSource, AudioBufferSource, Mp4OutputFormat, WebMOutputFormat, getFirstEncodableVideoCodec, getFirstEncodableAudioCodec, type VideoCodec, type AudioCodec } from "mediabunny";
import type { Doc } from "../fmd/schema";
import { Stage } from "../render/stage";
import { evaluate } from "../runtime/evaluate";
import { htmlIdle } from "../render/html";
import { preloadTextures } from "../assets/assets";
import { ensureFont, fontsReady } from "../render/glyphs";
import { audibleTracks, mixSoundtrack, MIX_RATE } from "../audio/mix";

export interface ExportOptions {
  format: "mp4" | "webm";
  height: number; // 720 | 1080 | 2160 …
  quality: "standard" | "high";
  fps?: number;
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
}
export interface ExportResult {
  blob: Blob;
  codec: VideoCodec;
  mime: string;
  ext: string;
  width: number;
  height: number;
  frames: number;
  ms: number;
  /** the soundtrack that was muxed in, or null when the video is silent */
  audio: { codec: AudioCodec; tracks: number; sampleRate: number; bitrate: number } | null;
  /** why a doc with audio exported without it (browser can't encode audio, a file failed to decode) */
  audioNote?: string;
}

const MP4_CODECS: VideoCodec[] = ["avc", "hevc", "av1", "vp9"];
const WEBM_CODECS: VideoCodec[] = ["vp9", "av1", "vp8"];
// AAC is what every player expects in an MP4; Opus-in-MP4 is valid and a better fallback than silence
const MP4_AUDIO: AudioCodec[] = ["aac", "opus"];
const WEBM_AUDIO: AudioCodec[] = ["opus", "vorbis"];
const AUDIO_BITRATE = 192_000;

/** Pick an encodable audio codec and mix the soundtrack; never throws (a silent export beats a failed one). */
async function prepareAudio(doc: Doc, format: "mp4" | "webm"): Promise<{ buf: AudioBuffer; codec: AudioCodec } | { note: string } | null> {
  if (!audibleTracks(doc).length) return null;
  let codec: AudioCodec | null = null;
  try {
    codec = await getFirstEncodableAudioCodec(format === "mp4" ? MP4_AUDIO : WEBM_AUDIO, { numberOfChannels: 2, sampleRate: MIX_RATE, bitrate: AUDIO_BITRATE });
  } catch {
    codec = null;
  }
  if (!codec) return { note: `This browser can't encode ${format === "mp4" ? "AAC" : "Opus"} audio, so the video was exported without sound.` };
  try {
    const buf = await mixSoundtrack(doc, MIX_RATE);
    return buf ? { buf, codec } : null;
  } catch (e) {
    return { note: `The soundtrack couldn't be mixed (${(e as Error).message}), so the video was exported without sound.` };
  }
}

/** Slice [from, to) seconds of a buffer (mediabunny places consecutive buffers back to back). */
function sliceBuffer(buf: AudioBuffer, from: number, to: number): AudioBuffer {
  const a = Math.round(from * buf.sampleRate), b = Math.min(buf.length, Math.round(to * buf.sampleRate));
  const out = new AudioBuffer({ length: Math.max(1, b - a), numberOfChannels: buf.numberOfChannels, sampleRate: buf.sampleRate });
  for (let c = 0; c < buf.numberOfChannels; c++) out.copyToChannel(buf.getChannelData(c).subarray(a, b), c);
  return out;
}

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
  // explicit bits-per-pixel: motion graphics have hard edges and gradients that starve at preset bitrates
  const bitrate = Math.round(width * height * fps * (opts.quality === "high" ? 0.12 : 0.06));
  const codec = await getFirstEncodableVideoCodec(opts.format === "mp4" ? MP4_CODECS : WEBM_CODECS, { width, height, bitrate });
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
  const source = new CanvasSource(canvas, { codec, bitrate, keyFrameInterval: 1, latencyMode: "quality" } as ConstructorParameters<typeof CanvasSource>[1]);
  output.addVideoTrack(source, { frameRate: fps });
  const audio = await prepareAudio(doc, opts.format);
  let audioSrc: AudioBufferSource | null = null;
  let audioDone = 0;
  if (audio && "buf" in audio) {
    audioSrc = new AudioBufferSource({ codec: audio.codec, bitrate: AUDIO_BITRATE });
    output.addAudioTrack(audioSrc);
  }
  // feed audio in 1 s slices, a little ahead of the video, so the muxer can interleave as it goes
  const feedAudio = async (upTo: number) => {
    if (!audioSrc || !audio || !("buf" in audio)) return;
    const end = Math.min(audio.buf.duration, upTo);
    while (audioDone < end - 1e-6) {
      const next = Math.min(end, audioDone + 1);
      await audioSrc.add(sliceBuffer(audio.buf, audioDone, next));
      audioDone = next;
    }
  };
  await output.start();

  const total = Math.max(1, Math.round(doc.comp.dur * fps));
  try {
    // warm-up render so glyph and screen textures exist before frame 0 is captured
    await stage.prepare(doc, 0);
    stage.renderFrame(doc, 0);
    // after the warm-up only html cards can change asynchronously (counters re-rasterise)
    const hasHtml = doc.layers.some((l) => l.type === "html");
    await new Promise((r) => setTimeout(r, 50));
    for (let i = 0; i < total; i++) {
      if (opts.signal?.aborted) throw new DOMException("Export cancelled", "AbortError");
      const t = i / fps;
      if (hasHtml) {
        stage.sync(doc, evaluate(doc, t));
        await htmlIdle();
      }
      stage.renderFrame(doc, t);
      await source.add(t, 1 / fps);
      await feedAudio(t + 1);
      opts.onProgress?.(i + 1, total);
      if (i % 6 === 0) await new Promise((r) => setTimeout(r, 0));
    }
    await feedAudio(Infinity);
    audioSrc?.close();
    await output.finalize();
  } catch (e) {
    await output.cancel().catch(() => undefined);
    stage.dispose();
    throw e;
  }
  stage.dispose();
  const buf = (output.target as BufferTarget).buffer!;
  const mime = output.format.mimeType;
  return {
    blob: new Blob([buf], { type: mime }), codec, mime, ext: output.format.fileExtension, width, height, frames: total, ms: performance.now() - t0,
    audio: audio && "buf" in audio ? { codec: audio.codec, tracks: audibleTracks(doc).length, sampleRate: MIX_RATE, bitrate: AUDIO_BITRATE } : null,
    ...(audio && "note" in audio ? { audioNote: audio.note } : {}),
  };
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
