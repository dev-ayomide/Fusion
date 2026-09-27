import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { deleteProject, duplicateProject, ensureThumbs, listProjects, relativeTime, renameProject, subscribeProjects, type ProjectMeta } from "../projects";
import { openProject } from "../persist";
import { useStore } from "../store";
import { Icon } from "./ui";

export function useProjects(): ProjectMeta[] {
  return useSyncExternalStore(subscribeProjects, listProjects, listProjects);
}

/** Re-render every minute so "2m ago" stays true while the page is open. */
function useMinuteTick() {
  const [, set] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => set((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);
}

export async function openFromLibrary(id: string) {
  const ok = await openProject(id);
  if (!ok) useStore.getState().toast("That video couldn't be opened — its data may have been cleared by the browser.");
}

const fmtDur = (s: number) => (s >= 60 ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}` : `${Math.round(s * 10) / 10}s`);

function ProjectCard({ p, index }: { p: ProjectMeta; index: number }) {
  const [renaming, setRenaming] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const confirmBtn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (renaming) input.current?.select();
  }, [renaming]);
  useEffect(() => {
    if (confirming) confirmBtn.current?.focus();
  }, [confirming]);

  const open = async () => {
    if (busy) return;
    setBusy(true);
    await openFromLibrary(p.id);
    setBusy(false);
  };
  const commitName = (v: string) => {
    setRenaming(false);
    if (v.trim() && v.trim() !== p.name) void renameProject(p.id, v);
  };

  return (
    <article className={`pj-card${confirming ? " confirming" : ""}`} data-testid="project-card" style={{ "--i": index } as CSSProperties}>
      <button className="pj-thumb" onClick={open} aria-label={`Open ${p.name}`} data-testid="project-open" disabled={busy}>
        {p.thumb ? <img src={p.thumb} alt="" draggable={false} /> : <span className="pj-ph" aria-hidden="true">{p.name.slice(0, 1)}</span>}
        <span className="pj-dur mono">{fmtDur(p.dur)}</span>
        <span className="pj-play" aria-hidden="true"><Icon name="play" sm /></span>
      </button>
      <div className="pj-meta">
        {renaming ? (
          <input
            ref={input}
            className="pj-rename"
            aria-label="Video name"
            defaultValue={p.name}
            maxLength={80}
            onBlur={(e) => commitName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") setRenaming(false);
            }}
          />
        ) : (
          <button className="pj-name" onClick={open} onDoubleClick={() => setRenaming(true)} title={p.name}>
            {p.name}
          </button>
        )}
        <span className="pj-time">
          Edited {relativeTime(p.updatedAt)} · {p.layers} layer{p.layers === 1 ? "" : "s"}
        </span>
      </div>
      <div className="pj-actions">
        <button className="pj-act" onClick={() => setRenaming(true)} aria-label={`Rename ${p.name}`} title="Rename" data-testid="project-rename">
          <Icon name="text" sm />
        </button>
        <button className="pj-act" onClick={() => void duplicateProject(p.id)} aria-label={`Duplicate ${p.name}`} title="Duplicate" data-testid="project-duplicate">
          <Icon name="copy" sm />
        </button>
        <button className="pj-act danger" onClick={() => setConfirming(true)} aria-label={`Delete ${p.name}`} title="Delete" data-testid="project-delete">
          <Icon name="trash" sm />
        </button>
      </div>
      {confirming && (
        <div className="pj-confirm" role="alertdialog" aria-label={`Delete ${p.name}?`} onKeyDown={(e) => e.key === "Escape" && setConfirming(false)}>
          <p>
            Delete <b>{p.name}</b>?<br />
            <span>This can’t be undone.</span>
          </p>
          <div>
            <button className="btn sm" onClick={() => setConfirming(false)}>Cancel</button>
            <button ref={confirmBtn} className="btn sm danger" onClick={() => void deleteProject(p.id)} data-testid="project-delete-confirm">
              Delete
            </button>
          </div>
        </div>
      )}
    </article>
  );
}

const PAGE = 7;

export function ProjectsSection({ onNew }: { onNew: () => void }) {
  const projects = useProjects();
  const [all, setAll] = useState(false);
  useMinuteTick();
  useEffect(() => ensureThumbs(), []);
  if (!projects.length) return null;
  const shown = all ? projects : projects.slice(0, PAGE);
  return (
    <section className="lp-sec lp-projects" id="videos" aria-labelledby="videos-h" data-testid="projects">
      <div className="sec-head flush pj-head">
        <span className="eyebrow">Library</span>
        <h2 id="videos-h">
          Your videos <span className="pj-count mono">{projects.length}</span>
        </h2>
        <p>Saved automatically in this browser. Double-click a name to rename.</p>
      </div>
      <div className="pj-grid">
        <button className="pj-new" onClick={onNew} data-testid="project-new">
          <span className="pj-new-plus" aria-hidden="true"><Icon name="plus" /></span>
          <b>New video</b>
          <span>Describe it, or start blank</span>
        </button>
        {shown.map((p, i) => (
          <ProjectCard key={p.id} p={p} index={i} />
        ))}
      </div>
      {projects.length > PAGE && (
        <button className="btn pj-more" onClick={() => setAll(!all)}>
          {all ? "Show fewer" : `Show all ${projects.length} videos`}
        </button>
      )}
    </section>
  );
}
