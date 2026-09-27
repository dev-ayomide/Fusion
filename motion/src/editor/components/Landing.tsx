import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import "../landing.css";
import { TEMPLATES } from "../../templates";
import { Stage } from "../../render/stage";
import { fontsReady, ensureFont } from "../../render/glyphs";
import { newProjectFromDoc } from "../persist";
import { relativeTime } from "../projects";
import { openDoc, startProject } from "../startFlow";
import { ProjectsSection, openFromLibrary, useProjects } from "./Projects";
import { CATALOG } from "../../fmd/catalog";
import { LAYER_TYPES, type Doc } from "../../fmd/schema";
import { behColor } from "../edit";
import { Icon, TYPE_ICON } from "./ui";

/* ------------------------------------------------------------------ *
 * The marketing landing page. The hero prompt and template grid are   *
 * the real product entry points; the showcase is the real renderer.   *
 * ------------------------------------------------------------------ */

function useThumbnails(): Record<string, string> {
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const canvas = document.createElement("canvas");
      const stage = new Stage(canvas, { preserveDrawingBuffer: true });
      stage.setSize(480, 270, 1);
      stage.textResolution = 1;
      const docs = TEMPLATES.map((t) => t.make());
      for (const d of docs) for (const L of d.layers) if (L.type === "text") ensureFont(L.font ?? d.brand.font, L.weight ?? 600);
      await fontsReady();
      await new Promise((r) => setTimeout(r, 150));
      const out: Record<string, string> = {};
      TEMPLATES.forEach((t, i) => {
        const d = docs[i];
        const at = t.id === "blank" ? 0 : Math.min(d.comp.dur - 0.2, 3.6);
        stage.renderFrame(d, at, { samples: 1 });
        stage.renderFrame(d, at, { samples: 1 });
        out[t.id] = canvas.toDataURL("image/jpeg", 0.85);
      });
      stage.dispose();
      if (!cancelled) setThumbs(out);
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return thumbs;
}

/** Plays a template with the real renderer; pauses while scrolled out of view. */
function LiveStage({ doc, onTime }: { doc: Doc; onTime: (t: number) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const tick = useRef(onTime);
  tick.current = onTime;
  useEffect(() => {
    const canvas = ref.current!;
    const stage = new Stage(canvas, {});
    stage.textResolution = 1.5;
    let alive = true;
    let visible = true;
    let raf = 0;
    const t0 = performance.now();
    const fit = () => {
      const r = canvas.getBoundingClientRect();
      stage.setSize(Math.max(2, r.width), Math.max(2, r.height), Math.min(2, window.devicePixelRatio || 1));
    };
    const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting));
    const ro = new ResizeObserver(fit);
    io.observe(canvas);
    ro.observe(canvas);
    for (const L of doc.layers) if (L.type === "text") ensureFont(L.font ?? doc.brand.font, L.weight ?? 600);
    (async () => {
      await fontsReady();
      if (!alive) return;
      fit();
      await stage.prepare(doc, 0);
      const loop = (now: number) => {
        if (!alive) return;
        raf = requestAnimationFrame(loop);
        if (!visible) return;
        const t = ((now - t0) / 1000) % doc.comp.dur;
        stage.renderFrame(doc, t, { samples: 1 });
        tick.current(t);
      };
      raf = requestAnimationFrame(loop);
    })();
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      stage.dispose();
    };
  }, [doc]);
  return <canvas ref={ref} className="live-canvas" />;
}

/** Tiny tokenizer for the static code samples: comments, keys, strings, numbers. */
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

const OPS_SAMPLE = `{ "op": "set", "path": "title/beh/in",
  "value": { "use": "bounceIn", "at": 0 } }
{ "op": "set", "path": "cta/fill", "value": "$accent" }
{ "op": "key", "path": "phone/keys/rot.y",
  "keys": [[0, -25], [1.2, 0, "out"]] }`;

const BRIDGE_SAMPLE = `// connect any agent to the open editor
const f = window.fusion;
f.bridge.connect("my-agent");

const [turn] = f.bridge.pending();
// turn.outline → the scene, one line per layer

await f.bridge.respond(turn.turnId, {
  message: "Word-by-word bounce, 20% bigger.",
  ops: [
    { op: "set", path: "title/beh/in",
      value: { use: "bounceIn", at: 0 } },
    { op: "set", path: "title/size", delta: 24 },
  ],
});`;

const SHOWCASE = ["launch", "kinetic", "logo"] as const;

function Showcase() {
  const [id, setId] = useState<(typeof SHOWCASE)[number]>("launch");
  const doc = useMemo(() => TEMPLATES.find((t) => t.id === id)!.make(), [id]);
  const head = useRef<HTMLDivElement>(null);
  const tc = useRef<HTMLSpanElement>(null);
  const rows = doc.layers.filter((l) => l.type !== "gradient" && l.type !== "camera" && l.type !== "sky").slice(-6).reverse();
  const dur = doc.comp.dur;
  const onTime = (t: number) => {
    if (head.current) head.current.style.left = `${(t / dur) * 100}%`;
    if (tc.current) tc.current.textContent = `00:0${Math.floor(t)}:${String(Math.floor((t % 1) * doc.comp.fps)).padStart(2, "0")}`;
  };
  return (
    <div className="showcase rv">
      <div className="win">
        <div className="win-bar">
          <i /><i /><i />
          <span className="win-title">{doc.name}.fmd.json</span>
          <span className="win-pill"><Icon name="sparkle" sm /> AI connected</span>
        </div>
        <div className="win-body">
          <aside className="win-layers">
            <div className="win-h">Layers</div>
            {rows.map((l) => (
              <div key={l.id} className="win-layer">
                <Icon name={TYPE_ICON[l.type] ?? "rect"} sm />
                <span>{l.id}</span>
              </div>
            ))}
          </aside>
          <div className="win-stage">
            <LiveStage doc={doc} onTime={onTime} />
          </div>
        </div>
        <div className="win-tl">
          <div className="win-tl-bar">
            <span className="win-play"><Icon name="play" sm /></span>
            <span className="mono" ref={tc}>00:00:00</span>
            <span className="faint mono">/ 00:0{Math.round(dur)}:00</span>
          </div>
          <div className="win-tracks">
            {rows.map((l) => {
              const a = l.in ?? 0, b = l.out ?? dur;
              const beh = l.beh?.[0];
              return (
                <div key={l.id} className="win-track">
                  <span className="win-bar-pill" style={{ left: `${(a / dur) * 100}%`, width: `${((b - a) / dur) * 100}%` }}>
                    {beh && (
                      <em style={{ background: behColor(beh.use), width: `${Math.min(100, (((beh.dur ?? CATALOG[beh.use]?.dur ?? 1) as number) / (b - a)) * 100)}%` }}>
                        {CATALOG[beh.use]?.label ?? beh.use}
                      </em>
                    )}
                  </span>
                </div>
              );
            })}
            <div className="win-head" ref={head} />
          </div>
        </div>
      </div>
      <div className="show-tabs" role="tablist" aria-label="Showcase">
        {SHOWCASE.map((s) => (
          <button key={s} role="tab" aria-selected={id === s} onClick={() => setId(s)}>
            {TEMPLATES.find((t) => t.id === s)!.title}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Two sliders that really drive a tiny spring demo — the vibe-slider idea in miniature. */
function VibeDemo() {
  const [energy, setEnergy] = useState(0.6);
  const [bounce, setBounce] = useState(0.5);
  const style = { "--spd": `${1.6 - energy * 1.1}s`, "--amp": `${18 + bounce * 46}px` } as CSSProperties;
  return (
    <div className="vibe-demo">
      <div className="vibe-ball-lane" style={style}>
        <span className="vibe-ball" />
      </div>
      <label>
        Energy <input type="range" min={0} max={1} step={0.01} value={energy} onChange={(e) => setEnergy(+e.target.value)} aria-label="Demo energy" />
      </label>
      <label>
        Bounce <input type="range" min={0} max={1} step={0.01} value={bounce} onChange={(e) => setBounce(+e.target.value)} aria-label="Demo bounce" />
      </label>
    </div>
  );
}

const EXAMPLES = [
  "A launch promo for my budgeting app — phone floating in 3D",
  "Kinetic type for a podcast trailer, bold and loud",
  "A calm logo reveal with a breathing halo",
];

export function StartScreen() {
  const thumbs = useThumbnails();
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const projects = useProjects();
  const recent = projects[0];
  const root = useRef<HTMLDivElement>(null);
  const prompt = useRef<HTMLTextAreaElement>(null);

  /** Templates open as a fresh library entry, so the original stays untouched. */
  const open = (doc: Doc) => {
    newProjectFromDoc(doc);
    openDoc(doc);
  };
  const openBlank = () => openDoc(TEMPLATES.find((t) => t.id === "blank")!.make());
  const openEditor = () => (recent ? void openFromLibrary(recent.id) : openBlank());
  // the prompt drafts a storyboard of the whole video; building starts from the editor
  const begin = () => {
    if (text.trim() || files.length) void startProject(text, files);
  };
  const go = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  const toPrompt = () => {
    root.current?.scrollTo({ top: 0, behavior: "smooth" });
    setTimeout(() => prompt.current?.focus(), 450);
  };

  // scroll-reveal + compact nav, driven off the page's own scroll container
  useEffect(() => {
    const el = root.current!;
    const io = new IntersectionObserver(
      (es) => es.forEach((e) => e.isIntersecting && (e.target.classList.add("in"), io.unobserve(e.target))),
      { root: el, rootMargin: "0px 0px -8% 0px", threshold: 0.12 },
    );
    el.querySelectorAll(".rv").forEach((n) => io.observe(n));
    const onScroll = () => el.classList.toggle("scrolled", el.scrollTop > 12);
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      io.disconnect();
      el.removeEventListener("scroll", onScroll);
    };
  }, []);

  const behCount = Object.keys(CATALOG).length;

  return (
    <div className="start" data-testid="start" ref={root}>
      <nav className="lp-nav">
        <div className="lp-nav-in">
          <button className="brand" onClick={() => root.current?.scrollTo({ top: 0, behavior: "smooth" })}>
            <span className="brand-mark" /> Fusion Motion
          </button>
          <div className="lp-links">
            <button onClick={() => go("how")}>How it works</button>
            <button onClick={() => go("features")}>Features</button>
            <button onClick={() => go("developers")}>Developers</button>
            <button onClick={() => go("templates")}>Templates</button>
          </div>
          <div className="spacer" />
          <button className="btn primary lp-cta" onClick={openEditor}>
            Open editor
          </button>
        </div>
      </nav>

      {/* ---------------------------- hero ---------------------------- */}
      <header className="lp-hero">
        <button className="badge-pill" onClick={() => go("developers")}>
          <b>New</b> AI agents that edit your timeline <span className="lav">Learn more</span>
        </button>
        <h1>
          Motion graphics
          <br />
          you can talk to.
        </h1>
        <p className="lede">
          Describe the video you want. An AI builds it as a real, editable timeline — then you steer it with words, sliders, or keyframes. Every change is a diff you can keep or throw away.
        </p>
        <div className="prompt-card">
          <textarea
            ref={prompt}
            placeholder="A 6-second launch promo for my budgeting app. Dark, premium, phone floating in 3D, headline “Money, made calm.”"
            value={text}
            onChange={(e) => setText(e.target.value)}
            aria-label="Describe your video"
            onKeyDown={(e) => e.key === "Enter" && (e.metaKey || e.ctrlKey) && begin()}
          />
          <div className="prompt-row">
            <label className="attach">
              <input type="file" accept="image/*" multiple hidden onChange={(e) => setFiles([...files, ...[...(e.target.files ?? [])]])} data-testid="start-upload" />
              <Icon name="image" sm /> Add logo or screenshots
            </label>
            <div className="thumbs">
              {files.map((f, i) => (
                <img key={i} src={URL.createObjectURL(f)} alt={f.name} title={f.name} />
              ))}
            </div>
            <div className="spacer" />
            <span className="faint" style={{ fontSize: 12 }}>⌘↵</span>
            <button className="btn ai" onClick={begin} disabled={!text.trim() && !files.length} data-testid="start-create">
              <Icon name="sparkle" sm /> Create with AI
            </button>
          </div>
        </div>
        <div className="hero-examples">
          {EXAMPLES.map((e) => (
            <button key={e} className="chip" onClick={() => { setText(e); prompt.current?.focus(); }}>
              {e}
            </button>
          ))}
        </div>
        {recent && (
          <div className="resume">
            <Icon name="frame" />
            <div style={{ flex: 1, minWidth: 0 }}>
              <b>{recent.name || "Untitled"}</b>
              <div className="faint" style={{ fontSize: 12 }}>
                Last edited {relativeTime(recent.updatedAt)} · {recent.layers} layers
              </div>
            </div>
            <button className="btn sm" onClick={() => go("videos")}>All videos</button>
            <button className="btn sm primary" onClick={() => void openFromLibrary(recent.id)} data-testid="resume">Continue</button>
          </div>
        )}
        <p className="hero-fine">Free · Runs entirely in your browser · Nothing is uploaded</p>
      </header>

      <ProjectsSection onNew={toPrompt} />

      <section className="lp-sec lp-show">
        <Showcase />
      </section>

      {/* ---------------------------- numbers ---------------------------- */}
      <section className="lp-sec">
        <div className="stats rv">
          <div><b>{behCount}</b><span>motion behaviours, one click each</span></div>
          <div><b>{LAYER_TYPES.length}</b><span>layer types, from text to PBR 3D</span></div>
          <div><b>4K</b><span>MP4 &amp; WebM, rendered locally</span></div>
          <div><b>0</b><span>uploads — your work never leaves the tab</span></div>
        </div>
      </section>

      {/* ---------------------------- how it works ---------------------------- */}
      <section className="lp-sec" id="how">
        <div className="sec-head rv">
          <span className="eyebrow">Animation, accelerated</span>
          <h2>From idea to motion in seconds</h2>
          <p><b>Skip the blank canvas.</b> Start with a sentence, review what the AI changed, then fine-tune anything by hand.</p>
        </div>
        <div className="stack">
          <article className="stack-card lav" style={{ "--i": 0 } as CSSProperties}>
            <div className="stack-copy">
              <span className="mark">1 · Describe it</span>
              <p>Type what you want in plain English. The AI writes it straight into a live timeline — layers, entrances, camera moves — while you watch it play.</p>
            </div>
            <div className="stack-art">
              <div className="mock-chat">
                <div className="mock-user">Make the headline bounce in word by word</div>
                <div className="mock-agent">
                  <span className="mock-who"><Icon name="sparkle" sm /> DeepSeek</span>
                  Word-by-word bounce on the headline, 0.1s stagger.
                </div>
              </div>
            </div>
          </article>
          <article className="stack-card cyan" style={{ "--i": 1 } as CSSProperties}>
            <div className="stack-copy">
              <span className="mark">2 · Review every change</span>
              <p>Nothing lands silently. Each AI turn arrives as a readable diff — untick anything you don't like, keep the rest, undo the whole turn in one step.</p>
            </div>
            <div className="stack-art">
              <div className="mock-diff">
                <div className="mock-diff-h">3 changes · previewing live</div>
                <label><input type="checkbox" defaultChecked /> title: Bounce in animation</label>
                <label><input type="checkbox" defaultChecked /> Set title › size to 132</label>
                <label className="off"><input type="checkbox" /> Set title › color to orange</label>
                <div className="mock-diff-f"><span className="btn sm">Discard</span><span className="btn sm primary">Keep 2 of 3</span></div>
              </div>
            </div>
          </article>
          <article className="stack-card lime" style={{ "--i": 2 } as CSSProperties}>
            <div className="stack-copy">
              <span className="mark">3 · Refine &amp; ship</span>
              <p>Drop into the timeline for keyframes, easing curves and 3D — then export a crisp MP4 or WebM up to 4K, rendered frame-by-frame on your machine.</p>
            </div>
            <div className="stack-art big-num">4K</div>
          </article>
        </div>
      </section>

      {/* ---------------------------- features bento ---------------------------- */}
      <section className="lp-sec" id="features">
        <div className="sec-head flush rv">
          <span className="eyebrow">Creative range</span>
          <h2>Pro tools.<br />Zero learning curve.</h2>
          <p><b>Everything a motion designer reaches for</b>, arranged so a first-timer can make something beautiful in minutes.</p>
        </div>
        <div className="bento">
          <div className="tile rv">
            <div className="tile-art">
              <div className="mini-tl">
                {[["Rise", "var(--enter)", 8, 38], ["Type up", "var(--textc)", 30, 34], ["Pop in", "var(--enter)", 52, 26], ["Float", "var(--loop)", 44, 50]].map(([l, c, x, w]) => (
                  <div key={l as string} className="mini-row"><span style={{ left: `${x}%`, width: `${w}%`, background: c as string }}>{l}</span></div>
                ))}
                <i className="mini-head" />
              </div>
            </div>
            <h3><span className="hl">A real timeline</span></h3>
            <p>Drag bars to retime, clips to shift, edges to trim. Keyframes, Easy Ease and a proper graph editor when you want them.</p>
          </div>
          <div className="tile rv">
            <div className="tile-art"><VibeDemo /></div>
            <h3><span className="new">new</span><span className="hl">Vibe sliders</span></h3>
            <p>Energy, bounce and depth are wired to every relevant setting in your project. Drag once, and the whole video changes character.</p>
          </div>
          <div className="tile rv">
            <div className="tile-art">
              <div className="cube-scene"><div className="cube">{["f", "b", "l", "r", "t", "d"].map((s) => <i key={s} className={s} />)}</div></div>
            </div>
            <h3><span className="hl">Real 3D, not fake depth</span></h3>
            <p>Phones and browsers as extruded devices, PBR meshes under studio HDRIs, and a real camera you can dolly, truck and orbit.</p>
          </div>
          <div className="tile rv">
            <div className="tile-art">
              <div className="keys">
                {[["F9", "Easy Ease"], ["J K", "Prev / next key"], ["U", "Reveal animated"], ["⇧F3", "Graph editor"]].map(([k, l]) => (
                  <div key={k}><kbd>{k}</kbd><span>{l}</span></div>
                ))}
              </div>
            </div>
            <h3><span className="hl">After Effects muscle memory</span></h3>
            <p>The shortcuts you already know work here. Comp motion blur, adjustment layers, effect controls — all in a browser tab.</p>
          </div>
          <div className="tile wide rv">
            <div className="tile-art code-art">
              <pre><Code src={OPS_SAMPLE} /></pre>
            </div>
            <h3><span className="hl">Everything is one JSON document</span></h3>
            <p>Your whole video is plain, readable JSON — people and AI edit it through the same tiny set of operations. Diff it, version it, generate it.</p>
          </div>
        </div>
      </section>

      {/* ---------------------------- statement ---------------------------- */}
      <section className="lp-sec">
        <blockquote className="statement rv">
          The AI doesn't hand you a video you can't change. It hands you a <span className="scribble">timeline</span>.
        </blockquote>
      </section>

      {/* ---------------------------- developers ---------------------------- */}
      <section className="lp-sec" id="developers">
        <div className="dev rv">
          <div className="dev-copy">
            <span className="eyebrow dark">For developers &amp; agents</span>
            <h2>An editor your agent already understands.</h2>
            <p>Fusion Motion exposes the whole editor on <code>window.fusion</code>. Any model reads a compact outline of the scene and answers with ops — the same ops a person makes, streamed into a reviewable diff.</p>
            <ul>
              <li><Icon name="diamond" sm /> One-line-per-layer outline, about 10 tokens a layer</li>
              <li><Icon name="diamond" sm /> Scoped context — only the selected layers' JSON is sent</li>
              <li><Icon name="diamond" sm /> One AI turn is one undo step</li>
              <li><Icon name="diamond" sm /> Bring any provider — Mistral and DeepSeek built in</li>
            </ul>
          </div>
          <pre className="dev-code"><Code src={BRIDGE_SAMPLE} /></pre>
        </div>
      </section>

      {/* ---------------------------- templates ---------------------------- */}
      <section className="lp-sec" id="templates">
        <div className="sec-head rv">
          <span className="eyebrow lav">Templates</span>
          <h2>Never start from scratch</h2>
          <p><b>Every template is plain JSON</b> you can reshape with a sentence — open one and ask the AI to make it yours.</p>
        </div>
        <div className="tpl-grid">
          {TEMPLATES.map((t) => (
            <button key={t.id} className="tpl" onClick={() => open(t.make())} data-testid={`tpl-${t.id}`}>
              <div className="thumb" style={{ backgroundImage: thumbs[t.id] ? `url(${thumbs[t.id]})` : undefined }} />
              <div className="meta">
                <b>{t.title}</b>
                <span>{t.blurb}</span>
              </div>
            </button>
          ))}
        </div>
      </section>

      {/* ---------------------------- final CTA ---------------------------- */}
      <section className="lp-sec">
        <div className="final rv">
          <h2>Make something<br />that moves.</h2>
          <p>Free, in your browser, in the next thirty seconds.</p>
          <div className="final-actions">
            <button className="btn primary big" onClick={toPrompt}><Icon name="sparkle" sm /> Start with a prompt</button>
            <button className="btn big" onClick={openBlank}>Open a blank canvas</button>
          </div>
        </div>
      </section>

      <footer className="lp-foot">
        <div className="lp-foot-in">
          <div>
            <div className="brand"><span className="brand-mark" /> Fusion Motion</div>
            <p className="faint">Motion graphics you can talk to.</p>
          </div>
          <div className="foot-cols">
            <div>
              <b>Product</b>
              <button onClick={() => go("how")}>How it works</button>
              <button onClick={() => go("features")}>Features</button>
              <button onClick={() => go("templates")}>Templates</button>
            </div>
            <div>
              <b>Build</b>
              <button onClick={() => go("developers")}>Agent bridge</button>
              <button onClick={openEditor}>Open editor</button>
            </div>
          </div>
        </div>
        <div className="lp-foot-base">© 2026 Fusion Motion · Rendered with Three.js, entirely on your machine</div>
      </footer>
    </div>
  );
}
