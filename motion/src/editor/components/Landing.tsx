import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import "../landing.css";
import { TEMPLATES } from "../../templates";
import { Stage } from "../../render/stage";
import { fontsReady, ensureFont } from "../../render/glyphs";
import { newProjectFromDoc } from "../persist";
import { relativeTime, renderDocThumb } from "../projects";
import { openDoc, startProject } from "../startFlow";
import { ProjectsSection, openFromLibrary, useProjects } from "./Projects";
import { CATALOG } from "../../fmd/catalog";
import type { Doc } from "../../fmd/schema";
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
      await new Promise((r) => setTimeout(r, 400));
      // the shared, serialised thumbnail renderer (also used by the library), one template at a time
      for (const t of TEMPLATES) {
        if (cancelled) return;
        try {
          const d = t.make();
          const url = await renderDocThumb(d, t.id === "blank" ? 0 : Math.min(d.comp.dur - 0.2, 3.6), 480, 270, 0.85);
          if (!cancelled) setThumbs((m) => ({ ...m, [t.id]: url }));
        } catch {
          /* no WebGL — cards keep their plain background */
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return thumbs;
}

/**
 * Plays a template with the real renderer. Pauses off-screen and in hidden tabs, never spends more
 * than about half the main thread on the preview, and shows a still frame on software GL.
 */
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
    let nextAt = 0;
    let still = false;
    try {
      const gl = stage.renderer.getContext();
      const info = gl.getExtension("WEBGL_debug_renderer_info");
      still = /swiftshader|llvmpipe|software|basic render/i.test(String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)));
    } catch {
      /* ignore */
    }
    const t0 = performance.now();
    const fit = () => {
      const r = canvas.getBoundingClientRect();
      stage.setSize(Math.max(2, r.width), Math.max(2, r.height), still ? 0.5 : Math.min(2, window.devicePixelRatio || 1));
    };
    const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting));
    const ro = new ResizeObserver(() => {
      fit();
      if (still && alive) stage.renderFrame(doc, Math.min(doc.comp.dur - 0.2, 3.6), { samples: 1 });
    });
    io.observe(canvas);
    ro.observe(canvas);
    for (const L of doc.layers) if (L.type === "text") ensureFont(L.font ?? doc.brand.font, L.weight ?? 600);
    (async () => {
      await fontsReady();
      if (!alive) return;
      fit();
      await stage.prepare(doc, 0);
      if (!alive) return;
      if (still) {
        const t = Math.min(doc.comp.dur - 0.2, 3.6);
        stage.renderFrame(doc, t, { samples: 1 });
        tick.current(t);
        return;
      }
      const loop = (now: number) => {
        if (!alive) return;
        raf = requestAnimationFrame(loop);
        if (!visible || document.hidden || now < nextAt) return;
        const t = ((now - t0) / 1000) % doc.comp.dur;
        const c0 = performance.now();
        stage.renderFrame(doc, t, { samples: 1 });
        nextAt = now + (performance.now() - c0);
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

/** Bar heights (%) for the music tile's waveform. */
const WAVE = [30, 55, 42, 70, 88, 60, 36, 50, 76, 94, 68, 44, 58, 82, 64, 40, 52, 72, 46, 28];

const USE_CASES = [
  "Announce our new dark mode",
  "A 15-second promo for my bakery’s new menu",
  "Show off the new checkout in our app",
  "A teaser for our podcast’s next season",
];

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
          <span className="win-title">{doc.name}</span>
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
            <button onClick={() => go("for-you")}>Who it’s for</button>
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
        <button className="badge-pill" onClick={() => go("how")}>
          <b>New</b> Make a launch video in about a minute <span className="lav">See how</span>
        </button>
        <h1>
          Motion graphics
          <br />
          you can <i>talk to.</i>
        </h1>
        <p className="lede">
          Describe the video you want and watch it come to life. Then change anything, from the words to the colours to the timing, just by asking. Don’t like a change? Undo it in one click.
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
        <p className="hero-fine">Free to try · Nothing to install · No design skills needed</p>
      </header>

      <ProjectsSection onNew={toPrompt} />

      <section className="lp-sec lp-show">
        <Showcase />
      </section>

      {/* ---------------------------- numbers ---------------------------- */}
      <section className="lp-sec">
        <div className="stats rv">
          <div><b>1 min</b><span>from one sentence to your first video</span></div>
          <div><b>{behCount}</b><span>ready-made animations, one click each</span></div>
          <div><b>4K</b><span>sharp video downloads, ready to post</span></div>
          <div><b>0</b><span>design skills needed</span></div>
        </div>
      </section>

      {/* ---------------------------- how it works ---------------------------- */}
      <section className="lp-sec" id="how">
        <div className="sec-head rv">
          <span className="eyebrow">How it works</span>
          <h2>From idea to <i>motion</i> in seconds</h2>
          <p><b>Skip the blank page.</b> Start with a sentence, check what changed, then tweak anything you like.</p>
        </div>
        <div className="stack">
          <article className="stack-card lav" style={{ "--i": 0 } as CSSProperties}>
            <div className="stack-copy">
              <span className="mark">1 · Describe it</span>
              <p>Type what you want in plain words. Fusion builds your video in front of you: the text, the motion, the camera, all of it.</p>
            </div>
            <div className="stack-art">
              <div className="mock-chat">
                <div className="mock-user">Make the headline bounce in word by word</div>
                <div className="mock-agent">
                  <span className="mock-who"><Icon name="sparkle" sm /> Fusion</span>
                  Done. Each word of the headline now bounces in, one after another.
                </div>
              </div>
            </div>
          </article>
          <article className="stack-card cyan" style={{ "--i": 1 } as CSSProperties}>
            <div className="stack-copy">
              <span className="mark">2 · Change anything</span>
              <p>Ask for changes the same way. You see every change before it’s kept, so keep what you like, skip the rest, and undo anything in one click.</p>
            </div>
            <div className="stack-art">
              <div className="mock-diff">
                <div className="mock-diff-h">3 changes · preview</div>
                <label><input type="checkbox" defaultChecked /> Headline bounces in</label>
                <label><input type="checkbox" defaultChecked /> Headline is bigger</label>
                <label className="off"><input type="checkbox" /> Headline turns orange</label>
                <div className="mock-diff-f"><span className="btn sm">Discard</span><span className="btn sm primary">Keep 2 of 3</span></div>
              </div>
            </div>
          </article>
          <article className="stack-card lime" style={{ "--i": 2 } as CSSProperties}>
            <div className="stack-copy">
              <span className="mark">3 · Download &amp; share</span>
              <p>Fine-tune by hand if you want to, then download a sharp video, up to 4K, ready for your launch post, website or pitch.</p>
            </div>
            <div className="stack-art big-num">4K</div>
          </article>
        </div>
      </section>

      {/* ---------------------------- features bento ---------------------------- */}
      <section className="lp-sec" id="features">
        <div className="sec-head flush rv">
          <span className="eyebrow">Features</span>
          <h2>Pro results.<br /><i>Zero</i> learning curve.</h2>
          <p><b>Everything you need to make something beautiful</b>, simple enough that your first video takes minutes.</p>
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
            <h3><span className="hl">Everything on one timeline</span></h3>
            <p>See every scene laid out in order. Drag to change when things happen and how long they last.</p>
          </div>
          <div className="tile rv">
            <div className="tile-art"><VibeDemo /></div>
            <h3><span className="new">new</span><span className="hl">Vibe sliders</span></h3>
            <p>Want it calmer, or more playful? Drag one slider and the whole video changes its feel.</p>
          </div>
          <div className="tile rv">
            <div className="tile-art">
              <div className="cube-scene"><div className="cube">{["f", "b", "l", "r", "t", "d"].map((s) => <i key={s} className={s} />)}</div></div>
            </div>
            <h3><span className="hl">Real 3D, built in</span></h3>
            <p>Put your app on a phone or laptop in 3D, add shiny objects, and move the camera around them.</p>
          </div>
          <div className="tile rv">
            <div className="tile-art">
              <div className="wave" aria-hidden="true">
                {WAVE.map((h, k) => <i key={k} style={{ height: `${h}%` }} />)}
              </div>
            </div>
            <h3><span className="hl">Music that fits</span></h3>
            <p>Pick a free track or upload your own. It plays in time with your video and comes with the download.</p>
          </div>
          <div className="tile wide rv">
            <div className="tile-art saved-art" aria-hidden="true">
              {TEMPLATES.filter((t) => t.id !== "blank").map((t) => (
                <div key={t.id} className="saved-card">
                  <div className="saved-thumb" style={{ backgroundImage: thumbs[t.id] ? `url(${thumbs[t.id]})` : undefined }} />
                  <b>{t.title}</b>
                  <span>Saved just now</span>
                </div>
              ))}
            </div>
            <h3><span className="hl">Your videos save themselves</span></h3>
            <p>Every video is saved as you go. Close the tab, come back later, and pick up right where you left off.</p>
          </div>
        </div>
      </section>

      {/* ---------------------------- statement ---------------------------- */}
      <section className="lp-sec">
        <blockquote className="statement rv">
          Most AI tools hand you a video you can’t change. Fusion gives you one you <span className="scribble">can</span>.
        </blockquote>
      </section>

      {/* ---------------------------- who it's for ---------------------------- */}
      <section className="lp-sec" id="for-you">
        <div className="dev rv">
          <div className="dev-copy">
            <span className="eyebrow dark">Who it’s for</span>
            <h2>For anyone with something to <i>launch</i>.</h2>
            <p>No designer, no agency, no weeks of back and forth. If you can describe it, you can make it.</p>
            <ul>
              <li><Icon name="diamond" sm /> Founders announcing a new product or feature</li>
              <li><Icon name="diamond" sm /> Marketers who need a video for every launch</li>
              <li><Icon name="diamond" sm /> Small businesses showing off what’s new</li>
              <li><Icon name="diamond" sm /> Creators making clips for social media</li>
            </ul>
          </div>
          <div className="dev-prompts" aria-label="Things people ask Fusion to make">
            {USE_CASES.map((u) => (
              <button key={u} className="dev-prompt" onClick={() => { setText(u); toPrompt(); }}>
                <span>{u}</span>
                <Icon name="chevron" sm />
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* ---------------------------- templates ---------------------------- */}
      <section className="lp-sec" id="templates">
        <div className="sec-head rv">
          <span className="eyebrow lav">Templates</span>
          <h2>Never start from <i>scratch</i></h2>
          <p><b>Start from a template</b> and make it yours with a sentence. Change the words, colours and timing in seconds.</p>
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
          <h2>Make something<br />that <i>moves.</i></h2>
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
              <button onClick={() => go("for-you")}>Who it’s for</button>
              <button onClick={() => go("templates")}>Templates</button>
            </div>
            <div>
              <b>Get started</b>
              <button onClick={toPrompt}>Start with a prompt</button>
              <button onClick={openEditor}>Open editor</button>
            </div>
          </div>
        </div>
        <div className="lp-foot-base">© 2026 Fusion Motion</div>
      </footer>
    </div>
  );
}
