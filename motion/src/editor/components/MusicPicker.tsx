import { useEffect, useMemo, useRef, useState } from "react";
import "./MusicPicker.css";
import type { AudioTrack } from "../../fmd/schema";
import { useDisplayDoc } from "../store";
import { Icon } from "./ui";
import { AUDIO_ACCEPT } from "../../assets/assets";
import { MUSIC, type MusicTrack } from "../../audio/music-catalog";
import { audioUrl, fileDuration, onAudioLoaded, peekBuffer } from "../../audio/buffers";
import { preview } from "../../audio/engine";
import { playSpan, timing } from "../../audio/schedule";
import { useMusicUI, closeMusic, focusTrack } from "../../audio/ui";
import { commitOps, displayName, fitTrack, libraryTracks, pickLibraryTrack, previewOps, removeTrack, toggleMute, uploadAudio } from "../../audio/actions";

/* ------------------------------ glyphs ------------------------------ */
export function NoteGlyph({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="mp-glyph">
      <path d="M9 18V5l11-2v13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="6.5" cy="18" r="2.6" fill="currentColor" />
      <circle cx="17.5" cy="16" r="2.6" fill="currentColor" />
    </svg>
  );
}
export function SpeakerGlyph({ muted, size = 14 }: { muted?: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="mp-glyph" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor" stroke="none" />
      {muted ? <path d="M17 9l5 6M22 9l-5 6" /> : <path d="M16.5 8.5a5 5 0 010 7M19 6a8.5 8.5 0 010 12" />}
    </svg>
  );
}

const fmtDur = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

/** Bars from a 0..99 envelope (catalogue) — crisp at any width. */
function Wave({ peaks, progress = 0, range, className }: { peaks: number[]; progress?: number; range?: [number, number]; className?: string }) {
  const n = peaks.length;
  const cls = (i: number) => {
    const u = (i + 0.5) / n;
    if (range) return u >= range[0] && u <= range[1] ? "on" : undefined;
    return u < progress ? "on" : undefined;
  };
  return (
    <svg className={`mp-wave${className ? " " + className : ""}`} viewBox={`0 0 ${n * 3} 40`} preserveAspectRatio="none" aria-hidden="true">
      {peaks.map((p, i) => {
        const h = Math.max(2, (p / 99) * 38);
        return <rect key={i} x={i * 3} y={20 - h / 2} width={2} height={h} rx={1} className={cls(i)} />;
      })}
    </svg>
  );
}
/** Downsample decoded peaks for an uploaded track's card. */
function bufferEnvelope(src: string, n = 96): number[] | null {
  const r = peekBuffer(src);
  if (!r) return null;
  const { max } = r.peaks;
  const out: number[] = [];
  let top = 0;
  for (let i = 0; i < n; i++) {
    let m = 0;
    for (let k = Math.floor((i * max.length) / n); k < Math.floor(((i + 1) * max.length) / n); k++) m = Math.max(m, max[k]);
    out.push(m);
    top = Math.max(top, m);
  }
  return out.map((v) => Math.round((v / (top || 1)) * 99));
}

/** Preview progress for the row that's playing (rAF only while something plays). */
function usePreview() {
  const [cur, setCur] = useState(preview.current());
  const [prog, setProg] = useState(0);
  useEffect(() => preview.subscribe(() => setCur(preview.current())), []);
  useEffect(() => {
    if (!cur) return setProg(0);
    let raf = 0;
    const loop = () => {
      setProg(preview.progress());
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [cur]);
  return { cur, prog };
}

/* ------------------------------ slider ------------------------------ */
/** Range that previews live (transient doc) and commits once on release: one drag = one undo step. */
function LiveRange({ label, value, min, max, step, fmt, path, intent, testId }: { label: string; value: number; min: number; max: number; step: number; fmt: (v: number) => string; path: string; intent: (v: number) => string; testId?: string }) {
  const [v, setV] = useState(value);
  const dirty = useRef(false);
  const latest = useRef(value);
  useEffect(() => {
    if (!dirty.current) setV(value);
  }, [value]);
  const done = () => {
    if (!dirty.current) return;
    dirty.current = false;
    commitOps([{ op: "set", path, value: latest.current }], intent(latest.current));
  };
  return (
    <label className="mp-range">
      <span className="mp-range-l">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={v}
        data-testid={testId}
        onChange={(e) => {
          const nv = Number(e.target.value);
          setV(nv);
          latest.current = nv;
          dirty.current = true;
          previewOps([{ op: "set", path, value: nv }]);
        }}
        onPointerUp={done}
        onKeyUp={done}
        onBlur={done}
      />
      <output>{fmt(v)}</output>
    </label>
  );
}

/* ------------------------------ current track ------------------------------ */
function CurrentTrack({ a, compDur }: { a: AudioTrack; compDur: number }) {
  const t = timing(a);
  const lib = MUSIC.find((m) => `lib://music/${m.name}` === a.src);
  const fileDur = fileDuration(a.src);
  const span = fileDur !== null ? playSpan(t, fileDur, compDur) : null;
  const env = lib?.peaks ?? bufferEnvelope(a.src) ?? Array.from({ length: 96 }, () => 8);
  const fitted = span && Math.abs(span.end - compDur) < 0.02 && t.at === 0;
  return (
    <div className={`mp-current${t.muted ? " muted" : ""}`} data-testid="music-current">
      <div className="mp-current-h">
        <span className="mp-disc"><NoteGlyph size={15} /></span>
        <div className="mp-current-t">
          <b>{displayName(a)}</b>
          <span className="faint">
            {lib ? `${lib.bpm} BPM · ` : "Your upload · "}
            {span ? `plays ${t.at > 0 ? `from ${t.at.toFixed(1)}s ` : ""}for ${(span.end - span.start).toFixed(1)}s` : "loading…"}
            {fitted ? " · fits the video" : ""}
          </span>
        </div>
        <button className={`mp-icon${t.muted ? " on" : ""}`} onClick={() => toggleMute(a.id)} title={t.muted ? "Unmute" : "Mute"} aria-label={t.muted ? "Unmute" : "Mute"} data-testid="music-mute">
          <SpeakerGlyph muted={t.muted} />
        </button>
      </div>
      <Wave peaks={env} className="mp-current-wave" range={span && fileDur ? [t.offset / fileDur, (t.offset + span.end - span.start) / fileDur] : undefined} />
      <div className="mp-controls">
        <LiveRange label="Volume" value={t.volume} min={0} max={2} step={0.01} fmt={(v) => `${Math.round(v * 100)}%`} path={`audio/${a.id}/volume`} intent={(v) => `Music volume ${Math.round(v * 100)}%`} testId="music-volume" />
        <LiveRange label="Fade in" value={t.fadeIn} min={0} max={5} step={0.1} fmt={(v) => `${v.toFixed(1)}s`} path={`audio/${a.id}/fadeIn`} intent={(v) => `Music fade in ${v.toFixed(1)}s`} testId="music-fadein" />
        <LiveRange label="Fade out" value={t.fadeOut} min={0} max={5} step={0.1} fmt={(v) => `${v.toFixed(1)}s`} path={`audio/${a.id}/fadeOut`} intent={(v) => `Music fade out ${v.toFixed(1)}s`} testId="music-fadeout" />
      </div>
      <div className="mp-actions">
        <button className="btn sm" onClick={() => fitTrack(a.id)} data-testid="music-fit" title="Play from its start to the end of the video, fading out if the music is cut">
          <Icon name="fit" sm /> Fit to video
        </button>
        <span className="spacer" />
        <button className="btn sm mp-danger" onClick={() => removeTrack(a.id)} data-testid="music-remove">
          <Icon name="trash" sm /> Remove
        </button>
      </div>
    </div>
  );
}

/* ------------------------------ dialog ------------------------------ */
export function MusicPicker() {
  const open = useMusicUI((s) => s.open);
  if (!open) return null;
  return <PickerDialog />;
}

function PickerDialog() {
  const doc = useDisplayDoc();
  const target = useMusicUI((s) => s.target);
  const [, bump] = useState(0);
  const [mood, setMood] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [over, setOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const { cur, prog } = usePreview();
  const cur0 = doc.audio.find((a) => a.id === target) ?? doc.audio[0];
  const tracks = libraryTracks();
  const moods = useMemo(() => {
    const count = new Map<string, number>();
    for (const t of tracks) for (const m of t.mood) count.set(m, (count.get(m) ?? 0) + 1);
    // broad moods only (shared by 2+ tracks), in catalogue order
    return [...count.keys()].filter((m) => (count.get(m) ?? 0) > 1);
  }, [tracks]);
  const shown = mood ? tracks.filter((t) => t.mood.includes(mood)) : tracks;

  useEffect(() => onAudioLoaded(() => bump((n) => n + 1)), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => () => preview.stop(), []);
  const close = () => {
    preview.stop();
    closeMusic();
  };

  const togglePreview = (t: MusicTrack) => {
    const src = `lib://music/${t.name}`;
    if (cur === src) return preview.stop();
    const url = audioUrl(src);
    if (url) preview.play(src, url);
  };
  const upload = async (f: File | undefined) => {
    if (!f) return;
    setErr("");
    setBusy("upload");
    try {
      await uploadAudio(f, cur0?.id ?? null);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="scrim" onClick={(e) => e.target === e.currentTarget && close()}>
      <div className="mp-dialog" role="dialog" aria-label="Music" data-testid="music-picker">
        <div className="mp-head">
          <div>
            <h2>Music</h2>
            <p className="faint">Free tracks made for Fusion (CC0, use them anywhere) or your own file.</p>
          </div>
          <span className="spacer" />
          <button className="iconbtn" onClick={close} aria-label="Close" data-testid="music-close">
            <Icon name="x" />
          </button>
        </div>

        {doc.audio.length > 1 && (
          <div className="mp-tabs" role="tablist" aria-label="Audio tracks">
            {doc.audio.map((a) => (
              <button key={a.id} role="tab" aria-selected={cur0?.id === a.id} onClick={() => focusTrack(a.id)}>
                <NoteGlyph size={11} /> {displayName(a)}
              </button>
            ))}
          </div>
        )}
        {cur0 && <CurrentTrack a={cur0} compDur={doc.comp.dur} />}

        <div className="mp-filters" role="group" aria-label="Filter by mood">
          <button aria-pressed={mood === null} onClick={() => setMood(null)}>All</button>
          {moods.map((m) => (
            <button key={m} aria-pressed={mood === m} onClick={() => setMood(mood === m ? null : m)}>{m}</button>
          ))}
        </div>

        <div className="mp-list" data-testid="music-list">
          {shown.map((t) => {
            const src = `lib://music/${t.name}`;
            const playing = cur === src;
            const inUse = doc.audio.some((a) => a.src === src);
            const isTarget = cur0?.src === src;
            return (
              <div key={t.name} className={`mp-row${playing ? " playing" : ""}${isTarget ? " current" : ""}`} data-testid={`music-row-${t.name}`}>
                <button className="mp-play" onClick={() => togglePreview(t)} aria-label={`${playing ? "Stop" : "Preview"} ${t.title}`} data-testid={`music-preview-${t.name}`}>
                  <svg viewBox="0 0 36 36" className="mp-ring" aria-hidden="true">
                    <circle cx="18" cy="18" r="16" className="bg" />
                    {playing && <circle cx="18" cy="18" r="16" className="fg" strokeDasharray={`${prog * 100.5} 100.5`} />}
                  </svg>
                  <Icon name={playing ? "pause" : "play"} sm />
                </button>
                <div className="mp-meta">
                  <div className="mp-title">
                    <b>{t.title}</b>
                    <span className="mp-num">{t.bpm} BPM · {fmtDur(t.dur)}</span>
                  </div>
                  <div className="mp-tags">
                    {t.mood.map((m) => <span key={m}>{m}</span>)}
                  </div>
                  <div className="mp-desc faint">{t.desc}</div>
                </div>
                <Wave peaks={t.peaks} progress={playing ? prog : 0} />
                <div className="mp-row-actions">
                  {isTarget ? (
                    <span className="mp-inuse" data-testid={`music-inuse-${t.name}`}><svg width="13" height="13" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg> In use</span>
                  ) : (
                    <button className="btn sm primary" onClick={() => { preview.stop(); pickLibraryTrack(t, cur0?.id ?? null); }} data-testid={`music-use-${t.name}`}>
                      {cur0 ? "Use" : "Use track"}
                    </button>
                  )}
                  {cur0 && !inUse && (
                    <button className="mp-icon" title="Add as another track (layer it)" aria-label={`Add ${t.title} as another track`} onClick={() => { preview.stop(); pickLibraryTrack(t, null, true); }} data-testid={`music-add-${t.name}`}>
                      <Icon name="plus" sm />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div
          className={`mp-drop${over ? " over" : ""}${busy === "upload" ? " busy" : ""}`}
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            upload(e.dataTransfer.files[0]);
          }}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && fileRef.current?.click()}
          data-testid="music-upload"
        >
          <Icon name="upload" sm />
          <div>
            <b>{busy === "upload" ? "Adding your track…" : "Upload your own"}</b>
            <span className="faint">Drop an audio file here or click — MP3, WAV, M4A, AAC, OGG, WebM. It stays in this browser.</span>
          </div>
          <input ref={fileRef} type="file" accept={AUDIO_ACCEPT} hidden data-testid="music-file" onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ""; }} />
        </div>
        {err && <div className="mp-err" role="alert">{err}</div>}
      </div>
    </div>
  );
}
