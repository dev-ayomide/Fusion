import { useEffect, useRef, useState } from "react";
import { devMode } from "../devMode";
import { describeOp, applyTxn, type Op } from "../../fmd/ops";
import { useStore, type Turn } from "../store";
import { sendPrompt, respond, estTokens } from "../bridge";
import { connectProvider, disconnectProvider, checkProviders, PROVIDERS, PROVIDER_ORDER, type ProviderId } from "../agentProvider";
import * as director from "../../ai/director";
import { planSummary } from "../../ai/plan";
import { Icon } from "./ui";
import { CheckIcon } from "./ScenePlan";

type StyleKey = "energy" | "bounce" | "depth" | "speed";
const STYLE: { k: StyleKey; label: string; hint: string }[] = [
  { k: "energy", label: "Energy", hint: "How quickly things arrive" },
  { k: "bounce", label: "Bounce", hint: "How springy entrances feel" },
  { k: "depth", label: "Depth", hint: "How much 3D tilt and parallax" },
  { k: "speed", label: "Speed", hint: "Overall pacing" },
];


/* ------------------------------ provider pill ------------------------------ */

function ProviderPill() {
  const agent = useStore((s) => s.agent);
  const providers = useStore((s) => s.providers);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    void checkProviders();
    const off = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("mousedown", off);
    return () => window.removeEventListener("mousedown", off);
  }, [open]);
  return (
    <div className="pp" ref={ref}>
      <button className={`pp-btn${agent ? " on" : ""}`} onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open} data-testid="provider-pill" title={agent ? `${agent.name} answers your requests` : "Connect an AI"}>
        <span className={`dot${agent ? " on" : ""}`} />
        <span className="pp-name">{agent ? agent.name : providers === null ? "Connecting…" : "No AI connected"}</span>
        <Icon name="chevdown" sm />
      </button>
      {open && (
        <div className="pp-menu" role="menu">
          <div className="pp-cap">Model</div>
          {PROVIDER_ORDER.map((id: ProviderId) => {
            const p = PROVIDERS[id];
            const has = !!providers?.[id];
            const on = agent?.provider === id;
            return (
              <button
                key={id}
                role="menuitemradio"
                aria-checked={on}
                className={`pp-item${on ? " on" : ""}`}
                disabled={!has}
                onClick={() => {
                  connectProvider(id);
                  setOpen(false);
                }}
              >
                <span className="pp-item-main">
                  <b>{p.label}</b>
                  {!has && <span>Not set up</span>}
                </span>
                {on && <CheckIcon />}
              </button>
            );
          })}
          {agent && !agent.provider && (
            <div className="pp-item on static">
              <span className="pp-item-main">
                <b>{agent.name}</b>
              </span>
              <CheckIcon />
            </div>
          )}
          {agent && (
            <button
              className="pp-item muted"
              onClick={() => {
                disconnectProvider();
                setOpen(false);
              }}
            >
              Disconnect
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Friendly setup card when no provider has a key and no agent is connected. */
function SetupHint() {
  const agent = useStore((s) => s.agent);
  const providers = useStore((s) => s.providers);
  if (agent || !providers || Object.values(providers).some(Boolean)) return null;
  return (
    <div className="setup-hint" data-testid="ai-setup-hint">
      <b>The assistant isn’t switched on yet</b>
      <p>You can still build and edit your video by hand: add text, shapes and images from the toolbar, drag them into place, and pick animations in the Edit tab.</p>
    </div>
  );
}

/* ---------------------------------- vibe ---------------------------------- */

function VibeDrawer() {
  const doc = useStore((s) => s.transient ?? s.preview?.doc ?? s.doc);
  const bound = (k: StyleKey) => doc.bindings.filter((b) => b.from === `style.${k}`).length;
  const total = doc.bindings.length;
  const live = (k: StyleKey, v: number) => {
    const st = useStore.getState();
    const r = applyTxn(st.doc, [{ op: "style", key: k, value: v }], { source: "style", validate: false });
    if (r.ok) st.setTransient(r.doc);
  };
  const done = (k: StyleKey, v: number) => {
    const st = useStore.getState();
    st.setTransient(null);
    st.commit([{ op: "style", key: k, value: v }], { source: "style", intent: `${k[0].toUpperCase() + k.slice(1)} → ${Math.round(v * 100)}` });
  };
  const nudge = (k: StyleKey, d: number, label: string) => {
    const st = useStore.getState();
    if (!st.doc.bindings.some((b) => b.from === `style.${k}`)) return st.toast(`This video doesn’t use ${k} yet. Ask the assistant to add some.`);
    const v = Math.max(0, Math.min(1, Math.round((st.doc.style[k] + d) * 100) / 100));
    st.commit([{ op: "style", key: k, value: v }], { source: "style", intent: label });
    st.toast(label);
  };
  const tweaks: { label: string; run: () => void }[] = [
    { label: "Snappier", run: () => nudge("energy", 0.2, "Snappier") },
    { label: "Calmer", run: () => nudge("energy", -0.2, "Calmer") },
    { label: "Bouncier", run: () => nudge("bounce", 0.25, "Bouncier") },
    { label: "More 3D", run: () => nudge("depth", 0.25, "More 3D") },
    { label: "+1s", run: () => useStore.getState().commit([{ op: "set", path: "comp/dur", delta: 1 }], { source: "you", intent: "+1s longer" }) },
  ];
  return (
    <div className="vibe" data-testid="style-box">
      <div className="vibe-cap">{total ? "Drag to change the feel of the whole video" : "These light up once the assistant builds your video"}</div>
      {STYLE.filter((s) => bound(s.k) || s.k !== "speed").map((s) => (
        <div className="style-row" key={s.k} title={s.hint}>
          <label htmlFor={`style-${s.k}`}>{s.label}</label>
          <input
            id={`style-${s.k}`}
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={doc.style[s.k]}
            disabled={!bound(s.k)}
            onChange={(e) => live(s.k, Number(e.target.value))}
            onPointerUp={(e) => done(s.k, Number((e.target as HTMLInputElement).value))}
            onKeyUp={(e) => done(s.k, Number((e.target as HTMLInputElement).value))}
          />
          <output>{Math.round(doc.style[s.k] * 100)}</output>
        </div>
      ))}
      <div className="vibe-tweaks" aria-label="Quick tweaks">
        {tweaks.map((c) => (
          <button key={c.label} className="tweak" onClick={c.run}>
            {c.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/* --------------------------------- changes -------------------------------- */

function Changes({ turn }: { turn: Turn }) {
  const lastTxn = useStore((s) => s.past.at(-1)?.id);
  const [open, setOpen] = useState(false);
  const ops = turn.ops ?? [];
  if (!ops.length) return null;
  const accepted = turn.accepted ?? ops.map(() => true);
  const reviewing = turn.status === "review" || turn.status === "streaming";
  const errs = turn.opErrors?.filter(Boolean).length ?? 0;
  const n = accepted.filter((a, i) => a && !turn.opErrors?.[i]).length;
  const build = turn.kind === "scene" || turn.kind === "setup";
  const added = ops.filter((o) => o.op === "add" || (o.op === "set" && !o.path.includes("/") && typeof o.value === "object" && o.value && "type" in (o.value as object))).length;
  const label =
    turn.status === "streaming"
      ? `Writing ${ops.length} change${ops.length > 1 ? "s" : ""}…`
      : build && added
        ? `${added} layer${added > 1 ? "s" : ""} · ${ops.length} changes`
        : `${ops.length} change${ops.length > 1 ? "s" : ""}`;
  return (
    <div className={`changes${open ? " open" : ""}`} data-testid="diff-card">
      <div className="ch-line">
        <span className={`ch-icon ${turn.status}`}>{turn.status === "kept" ? <CheckIcon /> : turn.status === "streaming" ? <span className="spin" /> : <Icon name="diamond" sm />}</span>
        <span className="ch-label">
          {label}
          {errs > 0 && turn.status !== "streaming" && <span className="ch-err"> · {errs} skipped</span>}
          {turn.status === "review" && <span className="faint"> · previewing</span>}
          {turn.status === "discarded" && <span className="faint"> · discarded</span>}
        </span>
        <button className="ch-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? "Hide" : reviewing && !build ? "Review changes" : "Details"}
          <Icon name="chevdown" sm className={open ? "flip" : ""} />
        </button>
      </div>
      {open && (
        <div className="ch-body">
          <ol className="ch-ops">
            {ops.map((op, i) => (
              <li key={i} className={`diff-op${accepted[i] ? "" : " off"}${turn.opErrors?.[i] ? " bad" : ""}`}>
                <label>
                  <input type="checkbox" checked={accepted[i]} disabled={turn.status !== "review"} onChange={() => useStore.getState().togglePreviewOp(i)} aria-label={describeOp(op)} />
                  <span className="d">{describeOp(op)}</span>
                </label>
                {turn.opErrors?.[i] && <div className="err">{turn.opErrors[i]}</div>}
              </li>
            ))}
          </ol>
        </div>
      )}
      {turn.status === "review" && (
        <div className="ch-actions">
          <button className="btn sm ghost" onClick={() => useStore.getState().discardPreview()}>
            Discard
          </button>
          <button className="btn sm ai" onClick={() => useStore.getState().keepPreview()} disabled={!n} data-testid="keep">
            Keep {n === ops.length ? "all" : `${n} of ${ops.length}`}
          </button>
        </div>
      )}
      {turn.status === "kept" && lastTxn === turn.txnId && (
        <div className="ch-actions subtle">
          <span className="faint">{build ? "One undo step" : "Kept"}</span>
          <button className="btn sm ghost" onClick={() => useStore.getState().undo()}>
            <Icon name="undo" sm /> Undo
          </button>
        </div>
      )}
      {turn.status === "kept" && lastTxn !== turn.txnId && !build && <span className="sr">Kept</span>}
    </div>
  );
}

function PlanCard({ turn }: { turn: Turn }) {
  const scenes = useStore((s) => s.doc.scenes);
  if (turn.status !== "kept" || !scenes.length) return null;
  return (
    <div className="plan-card">
      <div className="plan-card-h">
        <b>Storyboard ready</b>
        <span className="faint">{planSummary(scenes)}</span>
      </div>
      <ol>
        {scenes.slice(0, 8).map((s) => (
          <li key={s.id}>
            <span>{s.title}</span>
            <span className="mono faint">{Math.round(s.dur * 10) / 10}s</span>
          </li>
        ))}
      </ol>
      <div className="faint plan-card-f">Edit any scene on the storyboard, then press Build.</div>
    </div>
  );
}

function Waiting({ turn }: { turn: Turn }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const secs = Math.max(0, Math.round((Date.now() - turn.ts) / 1000));
  const what =
    turn.kind === "plan" ? "Planning every scene" : turn.kind === "setup" ? "Setting the look — palette, type, camera" : turn.kind === "scene" ? `Designing ${turn.title?.split(" · ")[1] ?? "the scene"}` : turn.status === "streaming" ? "Applying changes" : "Thinking";
  if (turn.text && !turn.agent) return <div className="notice">{turn.text}</div>;
  return (
    <div className="waiting">
      <span className="shimmer">{what}…</span>
      {secs >= 3 && <span className="faint mono">{secs}s</span>}
    </div>
  );
}

function TurnView({ turn, latest }: { turn: Turn; latest: boolean }) {
  const chatScene = useStore((s) => s.doc.scenes.find((x) => x.id === turn.sceneId));
  if (turn.role === "user")
    return (
      <div className="msg-user">
        {turn.sceneId && chatScene && <div className="scope">↳ {chatScene.title}</div>}
        {turn.text}
        {turn.scope?.length ? <div className="scope">↳ {turn.scope.join(", ")}</div> : null}
      </div>
    );
  const retry = () => {
    if (turn.kind === "plan") director.requestPlan();
    else if (turn.kind === "scene" || turn.kind === "setup") director.startBuild();
    else {
      const st = useStore.getState();
      const u = st.turns[st.turns.indexOf(turn) - 1];
      if (u?.text) sendPrompt(u.text, { sceneId: turn.sceneId ?? null });
    }
  };
  return (
    <div className={`msg-agent ${turn.kind ?? "edit"}`} data-testid="agent-turn">
      <div className="who">
        <span className="avatar" aria-hidden="true" />
        <span className="who-name">{turn.agent === "Pasted" ? "Pasted ops" : turn.agent ?? "AI"}</span>
        {turn.title && <span className="tag">{turn.title}</span>}
      </div>
      {(turn.status === "waiting" || (turn.status === "streaming" && !turn.text)) && <Waiting turn={turn} />}
      {turn.status !== "waiting" && turn.text && <div className={`agent-text${turn.status === "error" ? " error" : ""}`}>{turn.text}</div>}
      {turn.status === "error" && (
        <button className="btn sm" onClick={retry}>
          <Icon name="loop" sm /> Try again
        </button>
      )}
      {turn.kind === "plan" ? <PlanCard turn={turn} /> : <Changes turn={turn} />}
      {latest && turn.chips?.length && (turn.status === "kept" || turn.status === "review" || turn.status === "info") ? (
        <div className="followups">
          {turn.chips.slice(0, 3).map((c) => (
            <button
              key={c.label}
              className="followup"
              title={c.hint ?? (c.ops ? "Applies instantly — no AI call" : c.prompt)}
              onClick={() => {
                if (c.ops) {
                  const st = useStore.getState();
                  if (st.preview) st.keepPreview();
                  const r = st.commit(c.ops, { source: "ai", intent: c.label });
                  st.toast(r.ok ? `${c.label} · applied without an AI call` : r.errors[0], r.ok ? "info" : "error");
                } else if (c.prompt) sendPrompt(c.prompt);
              }}
            >
              {c.label}
              <Icon name="chevron" sm />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function PasteOps({ onDone }: { onDone: () => void }) {
  const [text, setText] = useState("");
  const [err, setErr] = useState("");
  const run = async () => {
    try {
      const t = text.trim();
      const ops: Op[] = t.startsWith("[") ? JSON.parse(t) : t.split("\n").filter(Boolean).map((l) => JSON.parse(l));
      const st = useStore.getState();
      st.addTurn({ role: "user", text: `Pasted ${ops.length} op${ops.length > 1 ? "s" : ""}` });
      const id = st.addTurn({ role: "agent", agent: "Pasted", text: "", status: "streaming", tokens: { in: 0, out: estTokens(t) } });
      await respond(id, { message: "Review the pasted changes below.", ops, delayMs: 60 });
      setText("");
      setErr("");
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  return (
    <div className="paste">
      <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder='[{"op":"set","path":"title/size","value":140}]' aria-label="Ops to paste" />
      {err && <div className="warn">{err}</div>}
      <div className="paste-f">
        <span className="faint">A JSON array, or one op per line</span>
        <button className="btn sm" disabled={!text.trim()} onClick={run}>
          Preview ops
        </button>
      </div>
    </div>
  );
}

const EXAMPLES = ["Make the headline bounce in word by word", "Swap the palette to warm sunset colours", "Push the camera in slowly over the whole video"];

export function Assistant() {
  const turns = useStore((s) => s.turns);
  const selection = useStore((s) => s.selection);
  const chatSceneId = useStore((s) => s.chatScene);
  const chatScene = useStore((s) => s.doc.scenes.find((x) => x.id === s.chatScene));
  const hasScenes = useStore((s) => s.doc.scenes.length > 0);
  const [text, setText] = useState("");
  const [vibe, setVibe] = useState(false);
  const [paste, setPaste] = useState(false);
  const dev = devMode();
  const msgs = useRef<HTMLDivElement>(null);
  useEffect(() => {
    msgs.current?.scrollTo({ top: msgs.current.scrollHeight, behavior: "smooth" });
  }, [turns]);
  useEffect(() => {
    if (chatSceneId && !chatScene) useStore.getState().set("chatScene", null);
  }, [chatSceneId, chatScene]);
  const send = (t = text) => {
    if (!t.trim()) return;
    sendPrompt(t.trim());
    setText("");
  };
  const lastAgent = [...turns].reverse().find((t) => t.role === "agent")?.id;
  return (
    <div className="tabpanel assistant" data-testid="assistant">
      <div className="asst-head">
        <ProviderPill />
        <span className="spacer" />
        <button className={`vibe-btn${vibe ? " on" : ""}`} onClick={() => setVibe(!vibe)} aria-expanded={vibe} title="Change the feel of the whole video">
          <svg className="icon sm" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
            <circle cx="16" cy="7" r="2" />
            <circle cx="10" cy="17" r="2" />
          </svg>
          Vibe
          <Icon name="chevdown" sm className={vibe ? "flip" : ""} />
        </button>
      </div>
      {vibe && <VibeDrawer />}
      <div className="msgs" ref={msgs}>
        <SetupHint />
        {!turns.length && (
          <div className="empty-chat">
            <span className="orb lg" />
            <h3>What should it do?</h3>
            <p>Ask for any change in plain words. You’ll see it before it’s kept, and you can undo it anytime. Click something in the video first to change just that.</p>
            <div className="examples">
              {EXAMPLES.map((e) => (
                <button key={e} className="example" onClick={() => send(e)}>
                  {e}
                  <Icon name="chevron" sm />
                </button>
              ))}
            </div>
          </div>
        )}
        {turns.map((t) => (
          <TurnView key={t.id} turn={t} latest={t.id === lastAgent} />
        ))}
      </div>
      {paste && dev && <PasteOps onDone={() => setPaste(false)} />}
      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        {(selection.length > 0 || chatScene) && (
          <div className="scope-line">
            {chatScene && !selection.length ? (
              <span className="scope-pill scene">
                Scene · {chatScene.title}
                <button type="button" aria-label="Stop refining this scene" onClick={() => useStore.getState().set("chatScene", null)}>
                  ×
                </button>
              </span>
            ) : (
              selection.map((id) => (
                <span className="scope-pill" key={id}>
                  {id}
                  <button type="button" aria-label={`Remove ${id} from focus`} onClick={() => useStore.getState().select(selection.filter((x) => x !== id))}>
                    ×
                  </button>
                </span>
              ))
            )}
          </div>
        )}
        <textarea
          id="prompt"
          rows={2}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={chatScene ? `Refine “${chatScene.title}”…` : hasScenes ? "Ask for a change — e.g. “make scene 2 punchier”" : "Describe a change…"}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          aria-label="Message the AI"
        />
        <div className="composer-row">
          {dev ? (
            <button type="button" className="linkbtn" onClick={() => setPaste(!paste)} aria-expanded={paste}>
              Paste ops from any AI
            </button>
          ) : (
            <span className="faint hint-keys">↵ send · ⇧↵ new line</span>
          )}
          <span className="spacer" />
          <button className="send" type="submit" disabled={!text.trim()} aria-label="Send">
            <svg className="icon sm" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 19V5M6 11l6-6 6 6" />
            </svg>
          </button>
        </div>
      </form>
    </div>
  );
}
