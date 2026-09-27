import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent, type ReactNode } from "react";
import "../landing.css";
import { TEMPLATES } from "../../templates";
import { EXAMPLES, type Example } from "../../examples";
import { Stage } from "../../render/stage";
import { fontsReady } from "../../render/glyphs";
import { loadDocFonts, renderDocThumb, relativeTime } from "../projects";
import { newProjectFromDoc } from "../persist";
import { openDoc, startProject } from "../startFlow";
import type { Doc } from "../../fmd/schema";
import { BrandMark, Wordmark } from "./Brand";
import { ProjectsSection, openFromLibrary, useProjects } from "./Projects";
import { Icon } from "./ui";

/* ------------------------------------------------------------------ *
 * The landing page. The hero reel is the real engine playing a real   *
 * FMD document; the prompt, templates and library are the product.   *
 * ------------------------------------------------------------------ */

const reducedMotion = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** Open a fresh copy of a document as a new library entry. */
function openAsNew(doc: Doc) {
  newProjectFromDoc(doc);
  openDoc(doc);
}

const tc = (t: number, fps: number) => {
  const s = Math.floor(t);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}:${String(Math.floor((t - s) * fps)).padStart(2, "0")}`;
};

/* ------------------------------ thumbnails ------------------------------ */

function useThumbs(items: { id: string; make: () => Doc; at: (d: Doc) => number }[], w: number, h: number): Record<string, string> {
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await new Promise((r) => setTimeout(r, 400));
      for (const it of items) {
        await new Promise((r) => setTimeout(r, 30));
        if (cancelled) return;
        try {
          const d = it.make();
          const url = await renderDocThumb(d, it.at(d), w, h, 0.86);
          if (!cancelled) setThumbs((m) => ({ ...m, [it.id]: url }));
        } catch {
          /* no WebGL — cards keep their typographic fallback */
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return thumbs;
}

const TEMPLATE_ITEMS = TEMPLATES.filter((t) => t.id !== "blank").map((t) => ({ id: t.id, make: t.make, at: (d: Doc) => (t.id === "blank" ? 0 : Math.min(d.comp.dur - 0.2, 3.6)) }));
const POSTER: Record<string, number> = { "type-a-sentence": 13.2, solstice: 17.6 };
const EXAMPLE_ITEMS = EXAMPLES.map((e) => ({ id: e.id, make: e.make, at: (d: Doc) => POSTER[e.id] ?? d.comp.dur * 0.3 }));

/* ------------------------------ live reel ------------------------------ */

/**
 * Plays an FMD document with the real renderer. Pauses off-screen and in hidden tabs, caps the
 * pixel count, lowers resolution if frames run slow, and starts paused under reduced motion.
 */
function LiveReel({ reels }: { reels: Example[] }) {
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(() => !reducedMotion());
  const [ready, setReady] = useState(false);
  const doc = useMemo(() => reels[idx].make(), [reels, idx]);
  const canvas = useRef<HTMLCanvasElement>(null);
  const head = useRef<HTMLDivElement>(null);
  const clock = useRef<HTMLSpanElement>(null);
  const chapter = useRef<HTMLSpanElement>(null);
  const state = useRef({ doc, t: 0, playing, ready: false, dirty: true, stage: null as Stage | null });
  state.current.playing = playing;

  const paint = useCallback(() => {
    const s = state.current;
    const d = s.doc;
    if (head.current) head.current.style.transform = `translateX(${(s.t / d.comp.dur) * 100}cqw)`;
    if (clock.current) clock.current.textContent = tc(s.t, d.comp.fps);
    if (chapter.current) {
      const m = [...d.markers].reverse().find((k) => k.t <= s.t + 1e-3);
      const label = m?.label ?? "Opening";
      if (chapter.current.textContent !== label) chapter.current.textContent = label;
    }
  }, []);

  // one WebGL context for the page's lifetime
  useEffect(() => {
    const el = canvas.current!;
    const stage = new Stage(el, {});
    stage.textResolution = 1.25;
    state.current.stage = stage;
    let alive = true;
    let visible = true;
    let raf = 0;
    let last = performance.now();
    let nextAt = 0;
    let quality = 1;
    const fit = () => {
      const r = el.getBoundingClientRect();
      const w = Math.max(2, r.width), h = Math.max(2, r.height);
      const pr = Math.min(window.devicePixelRatio || 1, 1.5, 1500 / w) * quality;
      stage.setSize(w, h, Math.max(0.4, pr));
      state.current.dirty = true;
    };
    // software GL (no GPU): show a still frame instead of burning the main thread
    try {
      const gl = stage.renderer.getContext();
      const info = gl.getExtension("WEBGL_debug_renderer_info");
      const name = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
      if (/swiftshader|llvmpipe|software|basic render/i.test(name)) {
        quality = 0.5;
        setPlaying(false);
      }
    } catch {
      /* ignore */
    }
    const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting), { threshold: 0.01 });
    const ro = new ResizeObserver(fit);
    io.observe(el);
    ro.observe(el);
    fit();
    const loop = (now: number) => {
      if (!alive) return;
      raf = requestAnimationFrame(loop);
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const s = state.current;
      if (!visible || document.hidden || !s.ready) return;
      if (s.playing) s.t = (s.t + dt) % s.doc.comp.dur;
      else if (!s.dirty) return;
      // never spend more than ~half the main thread on the preview
      if (now < nextAt && !s.dirty) return;
      s.dirty = false;
      const t0 = performance.now();
      stage.renderFrame(s.doc, s.t, { samples: 1 });
      const cost = performance.now() - t0;
      nextAt = now + cost;
      if (s.playing && cost > 30 && quality > 0.45) {
        quality *= 0.8;
        fit();
      }
      paint();
    };
    raf = requestAnimationFrame(loop);
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      stage.dispose();
      state.current.stage = null;
    };
  }, [paint]);

  // (re)load the document: fonts, HDRI, textures, html rasters — then show it
  useEffect(() => {
    const s = state.current;
    let cancelled = false;
    s.ready = false;
    setReady(false);
    s.doc = doc;
    s.t = reducedMotion() ? (doc.markers[1]?.t ?? doc.comp.dur * 0.3) : 0;
    loadDocFonts(doc);
    (async () => {
      await fontsReady();
      if (cancelled || !s.stage) return;
      try {
        await s.stage.prepare(doc, s.t);
      } catch {
        /* render anyway */
      }
      if (cancelled) return;
      s.ready = true;
      s.dirty = true;
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [doc]);

  const seek = (t: number) => {
    const s = state.current;
    s.t = Math.max(0, Math.min(s.doc.comp.dur - 1 / s.doc.comp.fps, t));
    s.dirty = true;
    paint();
  };
  const onTrack = (e: RPointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const go = (x: number) => seek(((x - r.left) / r.width) * state.current.doc.comp.dur);
    go(e.clientX);
    e.currentTarget.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => go(ev.clientX);
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const dur = doc.comp.dur;

  return (
    <figure className="reel" aria-label="Live preview of a video made with Fusion Motion">
      <div className="reel-screen">
        <canvas ref={canvas} className="reel-canvas" />
        <div className={`reel-loading${ready ? " done" : ""}`} aria-hidden={ready}>
          <BrandMark size={28} />
          <span className="mono">Loading the engine…</span>
        </div>
        <div className="reel-badge">
          <i className={playing && ready ? "on" : ""} />
          <span className="mono">Live render · WebGL</span>
        </div>
        <div className="reel-chapter mono" aria-hidden="true">
          <span ref={chapter}>Opening</span>
        </div>
      </div>
      <figcaption className="reel-bar">
        <button className="reel-play" onClick={() => setPlaying(!playing)} aria-label={playing ? "Pause preview" : "Play preview"}>
          <Icon name={playing ? "pause" : "play"} sm />
        </button>
        <span className="reel-tc mono">
          <span ref={clock}>00:00:00</span>
          <span className="reel-tc-dur"> / {tc(dur, doc.comp.fps)}</span>
        </span>
        <div
          className="reel-track"
          role="slider"
          tabIndex={0}
          aria-label="Preview position"
          aria-valuemin={0}
          aria-valuemax={Math.round(dur)}
          aria-valuenow={Math.round(state.current.t)}
          onPointerDown={onTrack}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight") seek(state.current.t + 1);
            if (e.key === "ArrowLeft") seek(state.current.t - 1);
            if (e.key === " ") {
              e.preventDefault();
              setPlaying(!playing);
            }
          }}
        >
          <div className="reel-ruler" />
          {doc.markers.map((m) => (
            <span key={m.id} className="reel-mark" style={{ left: `${(m.t / dur) * 100}%` }} title={m.label} />
          ))}
          <div className="reel-head" ref={head} />
        </div>
      </figcaption>
      <div className="reel-foot">
        <div className="reel-tabs" role="tablist" aria-label="Showcase reels">
          {reels.map((r, i) => (
            <button key={r.id} role="tab" aria-selected={i === idx} onClick={() => setIdx(i)}>
              <span className="mono">0{i + 1}</span> {r.title}
            </button>
          ))}
        </div>
        <button className="lp-link" onClick={() => openAsNew(reels[idx].make())} data-testid="reel-open">
          Open this in the editor <span aria-hidden="true">→</span>
        </button>
      </div>
    </figure>
  );
}

/* ------------------------------ small bits ------------------------------ */

/** Tiny tokenizer for the static code sample: comments, keys, strings, numbers. */
function Code({ src }: { src: string }) {
  const out: ReactNode[] = [];
  const re = /(\/\/[^\n]*)|("(?:[^"\\]|\\.)*")(\s*:)?|\b([a-zA-Z_]\w*)(?=\s*:)|(-?\b\d+(?:\.\d+)?\b)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (m.index > last) out.push(src.slice(last, m.index));
    const k = out.length;
    if (m[1]) out.push(<span key={k} className="tok-c">{m[1]}</span>);
    else if (m[2]) out.push(<span key={k} className={m[3] ? "tok-k" : "tok-s"}>{m[2]}</span>, m[3] ?? "");
    else if (m[4]) out.push(<span key={k} className="tok-k">{m[4]}</span>);
    else out.push(<span key={k} className="tok-n">{m[5]}</span>);
    last = re.lastIndex;
  }
  out.push(src.slice(last));
  return <>{out}</>;
}

const BRIDGE_SAMPLE = `// any agent can drive the open editor
const [turn] = fusion.bridge.pending();
// turn.outline → one line per layer

fusion.bridge.respond(turn.turnId, {
  message: "Word-by-word bounce, 20% bigger.",
  ops: [
    { op: "set", path: "title/beh/in",
      value: { use: "bounceIn", at: 0 } },
    { op: "set", path: "title/size", delta: 24 },
  ],
});`;

const PROMPTS = [
  "A 15-second launch film for a budgeting app — phone floating in chrome 3D, headline “Money, made calm.”",
  "Kinetic-type trailer for a podcast called Loud Minds. Bold, loud, orange and black.",
  "Year in review: a revenue line that draws itself, glass stat cards, a calm finish.",
];
const PROMPT_LABELS = ["Launch film", "Podcast trailer", "Year in review"];

const STEPS: { tc: string; title: string; body: string; art: ReactNode }[] = [
  {
    tc: "00:00",
    title: "Describe",
    body: "Say what it’s for, the mood and the words on screen. Drop in a logo or screenshots.",
    art: (
      <div className="art-prompt">
        <span>A launch film for Orbit, calm and premium</span>
        <i />
      </div>
    ),
  },
  {
    tc: "00:02",
    title: "Plan",
    body: "The AI breaks the idea into scenes — hook, hero, proof, sign-off — with timings you can see.",
    art: (
      <div className="art-scenes">
        {[["Hook", 22], ["Hero", 34], ["Proof", 26], ["Close", 20]].map(([l, w]) => (
          <span key={l} style={{ flexGrow: w as number }}>{l}</span>
        ))}
      </div>
    ),
  },
  {
    tc: "00:05",
    title: "Build",
    body: "Each scene becomes real layers, behaviours and keyframes on a timeline. Nothing is a flat render.",
    art: (
      <div className="art-tl">
        {[[4, 46, "a"], [18, 52, "b"], [36, 40, "c"], [10, 72, "d"]].map(([x, w, c], i) => (
          <div key={i}><span className={`c-${c}`} style={{ left: `${x}%`, width: `${w}%` }} /></div>
        ))}
      </div>
    ),
  },
  {
    tc: "00:09",
    title: "Refine",
    body: "Ask for changes in chat and review each as a diff — or drag a vibe slider, or keyframe by hand.",
    art: (
      <div className="art-refine">
        <div><b>+</b> title › bounce in, 0.08s stagger</div>
        <div><b>~</b> phone › rot.y −18° → 12°</div>
        <div className="art-slider"><span>Energy</span><i><em /></i></div>
      </div>
    ),
  },
  {
    tc: "00:14",
    title: "Export",
    body: "Render an MP4 or WebM up to 4K, frame by frame, right here in the browser.",
    art: (
      <div className="art-export">
        <span className="mono">MP4 · 1080p · 30 fps</span>
        <i><em /></i>
      </div>
    ),
  },
];

const ENGINE: { title: string; body: string }[] = [
  { title: "Real 3D, lit like a studio", body: "Chrome, glass, gold and clay meshes under HDRI lighting; phones and browsers as extruded devices; a camera you can dolly and orbit." },
  { title: "Kinetic typography", body: "Per-letter and per-word behaviours, range selectors, write-ons, mixed fonts in one line, rolling numbers." },
  { title: "Charts that draw themselves", body: "Lines with trim paths and glow, filled areas, counters bound to keyframes — data that performs." },
  { title: "Glass UI, in real HTML", body: "Cards built from HTML and CSS, frosted glass, soft shadows and clip masks — product UI that looks like product UI." },
  { title: "A cinematic finish", body: "Temporal motion blur, bloom, grade, vignette and grain; procedural skies, clouds and mountains." },
  { title: "Export where you work", body: "MP4 or WebM at 720p, 1080p or 4K, encoded with WebCodecs by the same renderer you preview with." },
];

const EDIT_WAYS = ["Chat with review", "Vibe sliders", "Presets", "Keyframes", "Graph editor", "After Effects shortcuts", "JSON"];

/* ------------------------------ page ------------------------------ */

export function StartScreen() {
  const projects = useProjects();
  const tplThumbs = useThumbs(TEMPLATE_ITEMS, 480, 270);
  const exThumbs = useThumbs(EXAMPLE_ITEMS, 720, 405);
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const previews = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews]);
  const root = useRef<HTMLDivElement>(null);
  const prompt = useRef<HTMLTextAreaElement>(null);
  const recent = projects[0];

  const openBlank = () => openDoc(TEMPLATES.find((t) => t.id === "blank")!.make());
  const begin = () => {
    if (text.trim() || files.length) void startProject(text, files);
  };
  const go = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  const toPrompt = () => {
    root.current?.scrollTo({ top: 0, behavior: "smooth" });
    setTimeout(() => prompt.current?.focus({ preventScroll: true }), 420);
  };

  // scroll reveal + nav state, off the page's own scroll container
  useEffect(() => {
    const el = root.current!;
    const io = new IntersectionObserver(
      (es) => es.forEach((e) => e.isIntersecting && (e.target.classList.add("in"), io.unobserve(e.target))),
      { root: el, rootMargin: "0px 0px -6% 0px", threshold: 0.08 },
    );
    const watch = () => el.querySelectorAll(".rv:not(.in)").forEach((n) => io.observe(n));
    watch();
    const mo = new MutationObserver(watch);
    mo.observe(el, { childList: true, subtree: true });
    const onScroll = () => el.classList.toggle("scrolled", el.scrollTop > 8);
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      io.disconnect();
      mo.disconnect();
      el.removeEventListener("scroll", onScroll);
    };
  }, []);

  return (
    <div className="start lp" data-testid="start" ref={root}>
      <div className="lp-grain" aria-hidden="true" />
      <nav className="lp-nav" aria-label="Main">
        <div className="lp-nav-in">
          <button className="lp-brand" onClick={() => root.current?.scrollTo({ top: 0, behavior: "smooth" })} aria-label="Fusion Motion — back to top">
            <Wordmark />
          </button>
          <div className="lp-links">
            {projects.length > 0 && <button onClick={() => go("videos")}>Your videos</button>}
            <button onClick={() => go("how")}>How it works</button>
            <button onClick={() => go("examples")}>Examples</button>
            <button onClick={() => go("engine")}>Engine</button>
          </div>
          <div className="lp-nav-end">
            <button className="lp-btn ghost" onClick={recent ? () => void openFromLibrary(recent.id) : openBlank}>
              Open editor
            </button>
          </div>
        </div>
      </nav>

      {/* ---------------------------- hero ---------------------------- */}
      <header className="lp-hero">
        <div className="lp-hero-copy">
          <p className="lp-kicker in-1">AI motion design, in your browser</p>
          <h1 className="in-2">
            <span className="nw">Describe a video.</span>
            <br />
            <span className="nw">Then <em>direct</em> it.</span>
          </h1>
          <p className="lp-lede in-3">
            Fusion Motion plans your idea scene by scene and builds it as a real, editable motion timeline — 3D, kinetic type, charts, glass UI. Refine it by chat, sliders or keyframes, then export an MP4 without leaving the tab.
          </p>

          <div className="lp-prompt in-4">
            <textarea
              id="lp-prompt"
              ref={prompt}
              rows={3}
              placeholder="A 10-second launch film for my budgeting app. Dark and premium, phone floating in 3D, headline “Money, made calm.”"
              value={text}
              onChange={(e) => setText(e.target.value)}
              aria-label="Describe your video"
              onKeyDown={(e) => e.key === "Enter" && (e.metaKey || e.ctrlKey) && begin()}
            />
            <div className="lp-prompt-row">
              <label className="lp-attach">
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="sr-only"
                  onChange={(e) => {
                    setFiles([...files, ...[...(e.target.files ?? [])]]);
                    e.target.value = "";
                  }}
                  data-testid="start-upload"
                />
                <Icon name="image" sm /> <span>Add logo or screenshots</span>
              </label>
              {files.length > 0 && (
                <div className="lp-files">
                  {files.map((f, i) => (
                    <span key={i} className="lp-file">
                      <img src={previews[i]} alt={f.name} title={f.name} />
                      <button onClick={() => setFiles(files.filter((_, j) => j !== i))} aria-label={`Remove ${f.name}`}>
                        <Icon name="x" sm />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <span className="lp-spacer" />
              <kbd className="lp-kbd" aria-hidden="true">⌘ ↵</kbd>
              <button className="lp-btn primary" onClick={begin} disabled={!text.trim() && !files.length} data-testid="start-create">
                Create video <span aria-hidden="true">→</span>
              </button>
            </div>
          </div>

          <div className="lp-try in-5" aria-label="Example prompts">
            <span className="mono">Try</span>
            {PROMPTS.map((p, i) => (
              <button key={p} className="lp-chip" title={p} onClick={() => { setText(p); prompt.current?.focus(); }}>
                {PROMPT_LABELS[i]}
              </button>
            ))}
          </div>

          {recent && (
            <div className="lp-resume in-5">
              <span className="lp-resume-thumb" style={{ backgroundImage: recent.thumb ? `url(${recent.thumb})` : undefined }} aria-hidden="true" />
              <div className="lp-resume-text">
                <span className="mono">Continue</span>
                <b title={recent.name}>{recent.name}</b>
                <span>edited {relativeTime(recent.updatedAt)}</span>
              </div>
              <button className="lp-btn sm" onClick={() => void openFromLibrary(recent.id)} data-testid="resume">
                Open <span aria-hidden="true">→</span>
              </button>
            </div>
          )}
        </div>

        <div className="lp-hero-reel in-3">
          <LiveReel reels={EXAMPLES} />
        </div>
      </header>

      <ProjectsSection onNew={toPrompt} />

      {/* ---------------------------- how it works ---------------------------- */}
      <section className="lp-sec" id="how" aria-labelledby="how-h">
        <div className="lp-sec-head rv">
          <span className="lp-kicker">How it works</span>
          <h2 id="how-h">One sentence in. <em>A timeline</em> out.</h2>
          <p>The AI doesn’t hand you a video you can’t change. It hands you the layers, the keyframes and the camera — and stays on call while you direct.</p>
        </div>
        <ol className="lp-steps">
          {STEPS.map((s, i) => (
            <li key={s.title} className="lp-step rv" style={{ "--i": i } as CSSProperties}>
              <span className="lp-step-tc mono">{s.tc}</span>
              <div className="lp-step-art" aria-hidden="true">{s.art}</div>
              <h3>{s.title}</h3>
              <p>{s.body}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* ---------------------------- examples + templates ---------------------------- */}
      <section className="lp-sec" id="examples" aria-labelledby="ex-h">
        <div className="lp-sec-head rv">
          <span className="lp-kicker">Examples</span>
          <h2 id="ex-h">Start from something that <em>already moves</em>.</h2>
          <p>Two full reels made in Fusion Motion. Open a copy and take it apart — every layer, key and camera move is yours to change.</p>
        </div>
        <div className="lp-examples">
          {EXAMPLES.map((e, i) => (
            <button key={e.id} className="lp-ex rv" onClick={() => openAsNew(e.make())} data-testid={`example-${e.id}`} style={{ "--i": i } as CSSProperties}>
              <span className="lp-ex-thumb" style={{ backgroundImage: exThumbs[e.id] ? `url(${exThumbs[e.id]})` : undefined }}>
                <span className="lp-ex-open">Open a copy <span aria-hidden="true">→</span></span>
              </span>
              <span className="lp-ex-meta">
                <span className="mono lp-ex-n">0{i + 1}</span>
                <span>
                  <b>{e.title}</b>
                  <span className="lp-ex-blurb">{e.blurb}</span>
                  <span className="lp-tags">{e.tags.map((t) => <span key={t}>{t}</span>)}</span>
                </span>
              </span>
            </button>
          ))}
        </div>

        <div className="lp-sub rv" id="templates">
          <h3>Templates</h3>
          <p>Short, focused starting points. Ask the AI to make one yours.</p>
        </div>
        <div className="lp-tpls">
          {TEMPLATES.map((t, i) => (
            <button key={t.id} className="tpl rv" onClick={() => openAsNew(t.make())} data-testid={`tpl-${t.id}`} style={{ "--i": i } as CSSProperties}>
              <span className={`thumb${t.id === "blank" ? " blank" : ""}`} style={{ backgroundImage: tplThumbs[t.id] ? `url(${tplThumbs[t.id]})` : undefined }}>
                {t.id === "blank" && <Icon name="plus" />}
              </span>
              <span className="meta">
                <b>{t.title}</b>
                <span>{t.blurb}</span>
              </span>
            </button>
          ))}
        </div>
      </section>

      {/* ---------------------------- engine ---------------------------- */}
      <section className="lp-sec" id="engine" aria-labelledby="engine-h">
        <div className="lp-sec-head rv">
          <span className="lp-kicker">The engine</span>
          <h2 id="engine-h">A real motion engine, <em>not a slideshow</em>.</h2>
          <p>Everything the reel above does is a feature you can reach — by asking for it, or by hand.</p>
        </div>
        <div className="lp-spec">
          {ENGINE.map((f, i) => (
            <div key={f.title} className="lp-spec-item rv" style={{ "--i": i % 3 } as CSSProperties}>
              <span className="lp-spec-k mono" aria-hidden="true">{String(i + 1).padStart(2, "0")}</span>
              <h3>{f.title}</h3>
              <p>{f.body}</p>
            </div>
          ))}
        </div>
        <div className="lp-ways rv">
          <span className="mono">Edit your way</span>
          <ul>{EDIT_WAYS.map((w) => <li key={w}>{w}</li>)}</ul>
        </div>
      </section>

      {/* ---------------------------- agents ---------------------------- */}
      <section className="lp-sec" id="agents" aria-labelledby="agents-h">
        <div className="lp-agents rv">
          <div className="lp-agents-copy">
            <span className="lp-kicker">Open to agents</span>
            <h2 id="agents-h">The same edits, whether you or a model makes them.</h2>
            <p>A whole video is one readable JSON document. Models read a compact outline — about ten tokens a layer — and answer with small operations that land as a reviewable diff. One AI turn is one undo.</p>
            <ul>
              <li>Mistral and DeepSeek built in; any agent via <code>window.fusion</code></li>
              <li>Scoped context: only the selected layers are sent</li>
              <li>Every change validated, reversible and yours to reject</li>
            </ul>
          </div>
          <pre className="lp-code" aria-label="Agent bridge example"><Code src={BRIDGE_SAMPLE} /></pre>
        </div>
      </section>

      {/* ---------------------------- final call ---------------------------- */}
      <section className="lp-sec lp-final-wrap">
        <div className="lp-final rv">
          <BrandMark size={44} />
          <h2>Your next video starts with a <em>sentence</em>.</h2>
          <div className="lp-final-actions">
            <button className="lp-btn primary lg" onClick={toPrompt}>Write it now <span aria-hidden="true">→</span></button>
            <button className="lp-btn ghost lg" onClick={openBlank}>Open a blank canvas</button>
          </div>
        </div>
      </section>

      <footer className="lp-foot">
        <Wordmark />
        <span>Rendering and export happen on your machine, with Three.js and WebCodecs.</span>
        <span className="mono">© 2026</span>
      </footer>
    </div>
  );
}
