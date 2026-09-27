import { useEffect, useRef, useState } from "react";
import type { Scene } from "../../fmd/schema";
import { useStore, useDisplayDoc } from "../store";
import { playhead } from "../playhead";
import { Icon } from "./ui";
import * as director from "../../ai/director";
import { ASPECTS, aspectOf, sceneLayerIds, sceneTotal } from "../../ai/plan";

export const CheckIcon = () => (
  <svg className="icon sm" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </svg>
);

const LENGTHS = [0, 10, 15, 20, 30, 45, 60];
const fmt = (s: number) => (Math.round(s * 10) / 10).toString();
/** A stable hue per scene index, shared with the scene band on the timeline. */
export const sceneHue = (i: number) => [262, 200, 150, 32, 330, 95, 12, 180][i % 8];

function useAutosize(ref: React.RefObject<HTMLTextAreaElement | null>, value: string, max = 400) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = Math.min(max, el.scrollHeight + 2) + "px";
  }, [ref, value, max]);
}

/** Textarea that grows with its content and commits on blur (one undo step per edit). */
function BriefField({ scene, disabled }: { scene: Scene; disabled: boolean }) {
  const [v, setV] = useState(scene.brief);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => setV(scene.brief), [scene.brief]);
  useAutosize(ref, v);
  return (
    <textarea
      ref={ref}
      className="sc-brief"
      value={v}
      rows={2}
      disabled={disabled}
      placeholder="What happens in this shot — the key visual, how it moves, how it hands off to the next…"
      aria-label={`Brief for ${scene.title}`}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v !== scene.brief && director.editScene(scene.id, { brief: v })}
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) (e.target as HTMLTextAreaElement).blur();
        if (e.key === "Escape") {
          setV(scene.brief);
          (e.target as HTMLTextAreaElement).blur();
        }
      }}
    />
  );
}

function TitleField({ scene }: { scene: Scene }) {
  const [v, setV] = useState(scene.title);
  useEffect(() => setV(scene.title), [scene.title]);
  return (
    <input
      className="sc-title"
      value={v}
      aria-label={`Title of scene ${scene.id}`}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => (v.trim() ? v !== scene.title && director.editScene(scene.id, { title: v }) : setV(scene.title))}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
    />
  );
}

function DurField({ scene }: { scene: Scene }) {
  const [v, setV] = useState(fmt(scene.dur));
  useEffect(() => setV(fmt(scene.dur)), [scene.dur]);
  const commit = () => {
    const n = Number(v);
    if (isFinite(n) && n > 0) director.editScene(scene.id, { dur: n });
    else setV(fmt(scene.dur));
  };
  return (
    <label className="sc-dur" title="Duration in seconds — later scenes move to follow">
      <input
        value={v}
        inputMode="decimal"
        aria-label={`Duration of ${scene.title}`}
        onChange={(e) => setV(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            const n = Math.max(0.5, Number(v) + (e.key === "ArrowUp" ? 0.5 : -0.5));
            setV(fmt(n));
            director.editScene(scene.id, { dur: n });
          }
        }}
      />
      s
    </label>
  );
}

type Status = "planned" | "queued" | "building" | "done";
const STATUS_LABEL: Record<Status, string> = { planned: "Planned", queued: "Queued", building: "Building", done: "Built" };

function SceneCard({ scene, index, count, status, layers }: { scene: Scene; index: number; count: number; status: Status; layers: number }) {
  const chatScene = useStore((s) => s.chatScene);
  const hue = sceneHue(index);
  const busy = status === "building";
  return (
    <article
      className={`sc-card ${status}${chatScene === scene.id ? " focus" : ""}`}
      style={{ ["--hue" as string]: hue }}
      data-testid={`scene-${scene.id}`}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("input,textarea,button")) return;
        playhead.pause();
        playhead.set(scene.start);
      }}
    >
      <header className="sc-head">
        <span className="sc-num">{String(index + 1).padStart(2, "0")}</span>
        <TitleField scene={scene} />
        <DurField scene={scene} />
      </header>
      <BriefField scene={scene} disabled={busy} />
      <footer className="sc-foot">
        <span className={`sc-status ${status}`}>
          {status === "done" ? <CheckIcon /> : <span className="sc-dot" />}
          {STATUS_LABEL[status]}
          {status === "done" && layers ? <span className="faint">· {layers} layers</span> : null}
        </span>
        <span className="sc-time mono">
          {fmt(scene.start)}–{fmt(scene.start + scene.dur)}s
        </span>
        <span className="spacer" />
        <span className="sc-actions">
          <button className="iconbtn xs" title="Move earlier" aria-label={`Move ${scene.title} earlier`} disabled={index === 0 || busy} onClick={() => director.moveScene(scene.id, -1)}>
            <Icon name="chevdown" sm className="flip" />
          </button>
          <button className="iconbtn xs" title="Move later" aria-label={`Move ${scene.title} later`} disabled={index === count - 1 || busy} onClick={() => director.moveScene(scene.id, 1)}>
            <Icon name="chevdown" sm />
          </button>
          {status === "done" && (
            <>
              <button
                className="iconbtn xs"
                title="Refine this scene in chat"
                aria-label={`Refine ${scene.title}`}
                onClick={() => {
                  const st = useStore.getState();
                  st.set("chatScene", scene.id);
                  st.setTab("assistant");
                  setTimeout(() => document.getElementById("prompt")?.focus(), 30);
                }}
              >
                <Icon name="sparkle" sm />
              </button>
              <button className="iconbtn xs" title="Rebuild from the brief" aria-label={`Rebuild ${scene.title}`} onClick={() => director.rebuildScene(scene.id)}>
                <Icon name="loop" sm />
              </button>
            </>
          )}
          <button className="iconbtn xs danger" title={layers ? "Delete the scene and its layers" : "Delete the scene"} aria-label={`Delete ${scene.title}`} disabled={busy} onClick={() => director.deleteScene(scene.id)}>
            <Icon name="trash" sm />
          </button>
        </span>
      </footer>
      {busy && <div className="sc-progress" aria-hidden="true" />}
    </article>
  );
}

function Skeleton() {
  return (
    <div className="sc-skeleton" aria-live="polite">
      <div className="sc-planning">
        <span className="orb" />
        <div>
          <b>Drafting your storyboard…</b>
          <div className="faint">Every scene of the video, with timing and a brief you can edit.</div>
        </div>
      </div>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="sc-card ghost" style={{ animationDelay: `${i * 120}ms` }}>
          <div className="bar w40" />
          <div className="bar w90" />
          <div className="bar w70" />
        </div>
      ))}
    </div>
  );
}

function Settings() {
  const d = useStore((s) => s.director);
  const doc = useStore((s) => s.doc);
  const planning = d.phase === "planning";
  const building = d.phase === "building";
  const [look, setLook] = useState(d.look);
  useEffect(() => setLook(d.look), [d.look]);
  const lookRef = useRef<HTMLTextAreaElement>(null);
  useAutosize(lookRef, look, 110);
  const aspect = aspectOf(doc.comp.w, doc.comp.h);
  const total = sceneTotal(doc.scenes);
  const anyBuilt = doc.scenes.some((s) => s.status === "done");
  return (
    <div className="sb-settings">
      <div className="sb-row">
        <label className="sb-field">
          <span>Length</span>
          <select
            value={LENGTHS.includes(d.length) ? d.length : 0}
            disabled={planning}
            onChange={(e) => director.fitLength(Number(e.target.value))}
            aria-label="Video length"
          >
            {LENGTHS.map((l) => (
              <option key={l} value={l}>
                {l ? `${l}s` : total ? `${fmt(total)}s` : "Auto"}
              </option>
            ))}
          </select>
        </label>
        <div className="sb-field">
          <span>Format</span>
          <div className="seg sm" role="group" aria-label="Aspect ratio">
            {["16:9", "9:16", "1:1"].map((a) => (
              <button
                key={a}
                aria-pressed={aspect === a}
                disabled={planning || building || (anyBuilt && aspect !== a)}
                title={anyBuilt && aspect !== a ? "Built scenes are laid out for the current format" : undefined}
                onClick={() => {
                  const [w, h] = ASPECTS[a];
                  const st = useStore.getState();
                  st.setDirector({ aspect: a });
                  st.commit(
                    [
                      { op: "set", path: "comp/w", value: w },
                      { op: "set", path: "comp/h", value: h },
                    ],
                    { source: "you", intent: `Format ${a}`, preserve: true },
                  );
                }}
              >
                {a}
              </button>
            ))}
          </div>
        </div>
      </div>
      <label className="sb-look">
        <span>Look</span>
        <textarea
          ref={lookRef}
          rows={2}
          value={look}
          placeholder="Your call — or describe palette, type and mood (e.g. “midnight blue, hot orange accent, big condensed type”)"
          onChange={(e) => setLook(e.target.value)}
          onBlur={() => look !== d.look && useStore.getState().setDirector({ look })}
          aria-label="Look and palette"
        />
      </label>
    </div>
  );
}

function BuildBar() {
  const d = useStore((s) => s.director);
  const doc = useDisplayDoc();
  const agent = useStore((s) => s.agent);
  const scenes = doc.scenes;
  const built = scenes.filter((s) => s.status === "done").length;
  const remaining = scenes.length - built;
  const building = scenes.find((s) => s.status === "building");
  const idx = building ? scenes.indexOf(building) : -1;
  if (d.phase === "planning") return null;
  if (d.phase === "building")
    return (
      <div className="sb-build" data-testid="build-progress">
        <div className="sb-build-line">
          <span className="orb sm" />
          <span className="grow">
            {building ? (
              <>
                Building <b>scene {idx + 1}</b> of {scenes.length} · {building.title}
              </>
            ) : d.setupDone ? (
              "Next scene…"
            ) : (
              "Setting the look — palette, type, camera…"
            )}
          </span>
          <button className="btn sm ghost" onClick={director.pauseBuild} title="Finish the current scene, then stop">
            Pause
          </button>
        </div>
        <div className="sb-meter" role="progressbar" aria-valuemin={0} aria-valuemax={scenes.length} aria-valuenow={built}>
          {scenes.map((s, i) => (
            <span key={s.id} className={s.status ?? "planned"} style={{ flex: s.dur, ["--hue" as string]: sceneHue(i) }} />
          ))}
        </div>
        {!agent && <div className="sb-hint">Waiting for an AI to connect…</div>}
      </div>
    );
  return (
    <div className="sb-build">
      {d.phase === "paused" && d.error && <div className="sb-error">{d.error}</div>}
      {remaining > 0 ? (
        <button className="btn ai lg" data-testid="build-video" onClick={() => director.startBuild()}>
          <Icon name="sparkle" sm />
          {d.phase === "paused" ? "Resume build" : built ? `Build ${remaining} remaining scene${remaining > 1 ? "s" : ""}` : "Build video"}
          <span className="btn-sub">
            {remaining} scene{remaining > 1 ? "s" : ""} · {fmt(sceneTotal(scenes.filter((s) => s.status !== "done")))}s
          </span>
        </button>
      ) : (
        <button
          className="btn primary lg"
          onClick={() => {
            playhead.set(0);
            playhead.play();
          }}
        >
          <Icon name="play" sm /> Play the video
          <span className="btn-sub">{fmt(sceneTotal(scenes))}s</span>
        </button>
      )}
      {remaining > 0 && <div className="sb-hint">{built ? "Built scenes stay as they are." : "The look is set first, then each scene is built in order. Keep editing queued scenes while it works."}</div>}
    </div>
  );
}

function PlanFromIdea() {
  const [idea, setIdea] = useState("");
  return (
    <div className="sb-empty">
      <div className="orb lg" />
      <h3>Plan a video</h3>
      <p>Describe the idea — the AI proposes every scene with timing and a brief. You edit the storyboard, then build it scene by scene.</p>
      <textarea rows={3} value={idea} onChange={(e) => setIdea(e.target.value)} placeholder="e.g. A 20-second launch film for Orbit, a habit tracker — calm, premium, lots of depth" aria-label="Video idea" />
      <button className="btn ai" disabled={!idea.trim()} onClick={() => director.requestPlan(idea.trim())}>
        <Icon name="sparkle" sm /> Plan scenes
      </button>
    </div>
  );
}

export function Storyboard() {
  const doc = useDisplayDoc();
  const d = useStore((s) => s.director);
  const building = useStore((s) => s.building);
  const scenes = doc.scenes;
  const total = sceneTotal(scenes);
  const status = (s: Scene): Status => (s.id === building || s.status === "building" ? "building" : s.status === "done" ? "done" : d.phase === "building" && d.queue.includes(s.id) ? "queued" : "planned");
  return (
    <aside className="panel board" aria-label="Storyboard" data-testid="storyboard">
      <div className="sb-head">
        <div>
          <h2>Storyboard</h2>
          <div className="sb-meta">{scenes.length ? `${scenes.length} scenes · ${fmt(total)}s` : d.phase === "planning" ? "Planning…" : "No scenes yet"}</div>
        </div>
        {scenes.length > 0 && (
          <button
            className="btn sm ghost"
            onClick={() => director.requestPlan()}
            disabled={d.phase === "planning" || d.phase === "building" || scenes.some((s) => s.status === "done")}
            title={scenes.some((s) => s.status === "done") ? "Scenes are already built — edit or delete them instead" : "Ask the AI for a fresh plan"}
            data-testid="regenerate-plan"
          >
            <Icon name="loop" sm /> Regenerate
          </button>
        )}
      </div>
      {(scenes.length > 0 || d.phase === "planning") && <Settings />}
      <div className="sb-list scroll">
        {d.phase === "planning" && !scenes.length ? (
          <Skeleton />
        ) : !scenes.length ? (
          <PlanFromIdea />
        ) : (
          <>
            {d.phase === "planning" && <div className="sb-banner">Drafting a fresh plan…</div>}
            {scenes.map((s, i) => (
              <SceneCard key={s.id} scene={s} index={i} count={scenes.length} status={status(s)} layers={sceneLayerIds(doc, s.id).length} />
            ))}
            <button className="sb-add" onClick={() => director.addScene()} data-testid="add-scene">
              <Icon name="plus" sm /> Add scene
            </button>
          </>
        )}
      </div>
      {scenes.length > 0 && <BuildBar />}
    </aside>
  );
}
