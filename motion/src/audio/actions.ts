import type { AudioTrack, Doc } from "../fmd/schema";
import { applyTxn, type Op } from "../fmd/ops";
import { useStore } from "../editor/store";
import { importAudioAsset, isAudioFile } from "../assets/assets";
import { MUSIC, type MusicTrack } from "./music-catalog";
import { fileDuration, loadBuffer } from "./buffers";
import { fitToComp, timing } from "./schedule";
import { focusTrack } from "./ui";

/**
 * Soundtrack edits. Every user action is ONE store commit (one undo step); continuous controls
 * preview through the transient doc and commit once on release.
 */
const r3 = (v: number) => Math.round(v * 1000) / 1000;

export function trackById(doc: Doc, id: string | null): AudioTrack | undefined {
  return (id && doc.audio.find((a) => a.id === id)) || undefined;
}
function freshId(doc: Doc): string {
  if (!doc.audio.some((a) => a.id === "music")) return "music";
  let n = 2;
  while (doc.audio.some((a) => a.id === `music${n}`)) n++;
  return `music${n}`;
}

function commit(ops: Op[], intent: string): boolean {
  const st = useStore.getState();
  st.setTransient(null);
  const r = st.commit(ops, { source: "you", intent });
  if (!r.ok) st.toast(r.errors[0] ?? "Couldn't change the music", "error");
  return r.ok;
}

/** Live preview of an edit (slider drags): nothing is logged until `commitLive`. */
export function previewOps(ops: Op[]) {
  const st = useStore.getState();
  const r = applyTxn(st.doc, ops, { source: "you", validate: false });
  if (r.ok) st.setTransient(r.doc);
}
export const commitOps = commit;

/**
 * Put a track on the timeline: replaces `targetId`'s music (keeping where it starts and its volume)
 * or adds a new track. Fits it to the video, with a fade out when that cuts the music short.
 */
function placeTrack(extra: Op[], src: string, name: string, fileDur: number | null, targetId: string | null, intent: string): string | null {
  const doc = useStore.getState().doc;
  const prev = trackById(doc, targetId);
  const id = prev?.id ?? freshId(doc);
  const base = prev ? timing(prev) : timing({ volume: 0.9 });
  const fit = fitToComp({ ...base, offset: 0, fadeOut: 0 }, fileDur, doc.comp.dur);
  const value: Record<string, unknown> = { src, name, at: base.at, offset: 0, dur: fit.dur, volume: base.volume, fadeIn: prev ? base.fadeIn : 0, fadeOut: r3(fit.fadeOut) };
  if (prev?.muted) value.muted = true;
  const ok = commit([...extra, { op: "set", path: `audio/${id}`, value }], intent);
  if (ok) focusTrack(id);
  return ok ? id : null;
}

export function pickLibraryTrack(t: MusicTrack, targetId: string | null, asNew = false): string | null {
  const doc = useStore.getState().doc;
  const prev = trackById(doc, targetId);
  return placeTrack([], `lib://music/${t.name}`, t.title, t.dur, asNew ? null : (prev?.id ?? null), asNew || !prev ? `Added music: ${t.title}` : `Music → ${t.title}`);
}

/** Upload a file as a project asset, check it decodes, then place it. Throws a friendly message on failure. */
export async function uploadAudio(file: File, targetId: string | null): Promise<string | null> {
  if (!isAudioFile(file)) throw new Error(`${file.name} isn't an audio file (MP3, WAV, M4A, AAC, OGG or WebM).`);
  const st = useStore.getState();
  const { id, entry } = await importAudioAsset(file, Object.keys(st.doc.assets));
  const buf = await loadBuffer(id); // throws if this browser can't decode it
  const title = file.name.replace(/\.[^.]+$/, "");
  const prev = trackById(useStore.getState().doc, targetId);
  return placeTrack([{ op: "set", path: `assets/${id}`, value: entry }], id, title, buf.duration, prev?.id ?? null, prev ? `Music → ${title}` : `Added music: ${title}`);
}

export function setTrack(id: string, patch: Record<string, unknown>, intent: string) {
  const ops: Op[] = Object.entries(patch).map(([k, v]) => (v === undefined ? { op: "del", path: `audio/${id}/${k}` } : { op: "set", path: `audio/${id}/${k}`, value: v }));
  return commit(ops, intent);
}

export function fitTrack(id: string) {
  const doc = useStore.getState().doc;
  const a = trackById(doc, id);
  if (!a) return;
  const fit = fitToComp(timing(a), fileDuration(a.src), doc.comp.dur);
  setTrack(id, { dur: fit.dur, fadeOut: r3(fit.fadeOut) }, `Fit ${a.name ?? id} to the video`);
}

export function removeTrack(id: string) {
  const doc = useStore.getState().doc;
  const a = trackById(doc, id);
  if (!a) return;
  if (commit([{ op: "del", path: `audio/${id}` }], `Removed ${a.name ?? id}`)) focusTrack(null);
}

export function toggleMute(id: string) {
  const a = trackById(useStore.getState().doc, id);
  if (!a) return;
  setTrack(id, { muted: a.muted ? undefined : true }, a.muted ? `Unmuted ${a.name ?? id}` : `Muted ${a.name ?? id}`);
}

export const libraryTracks = () => MUSIC.filter((m) => !m.hidden);
export function displayName(a: AudioTrack): string {
  return a.name ?? MUSIC.find((m) => `lib://music/${m.name}` === a.src)?.title ?? a.src;
}
