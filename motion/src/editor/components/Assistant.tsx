import { useEffect, useRef, useState } from "react";
import { describeOp, applyTxn, type Op } from "../../fmd/ops";
import { useStore, type Turn } from "../store";
import { sendPrompt, respond, estTokens } from "../bridge";
import { connectProvider, disconnectProvider, PROVIDERS, type ProviderId } from "../agentProvider";
import { Icon } from "./ui";

type StyleKey = "energy" | "bounce" | "depth" | "speed";
const STYLE: { k: StyleKey; label: string; hint: string }[] = [
  { k: "energy", label: "Energy", hint: "How quickly things arrive" },
  { k: "bounce", label: "Bounce", hint: "How springy entrances feel" },
  { k: "depth", label: "Depth", hint: "How much 3D tilt and parallax" },
  { k: "speed", label: "Speed", hint: "Overall pacing" },
];

function StyleBox() {
  const doc = useStore((s) => s.transient ?? s.preview?.doc ?? s.doc);
  const mode = useStore((s) => s.mode);
  const [open, setOpen] = useState(true);
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
  return (
    <div className="style-box" data-testid="style-box">
      <div className="style-h">
        <span style={{ color: "var(--text)", fontWeight: 600 }}>Vibe</span>
        <span>
          {total ? `drives ${total} settings · no AI needed` : "no style bindings in this project"}
          {mode === "pro" && (
            <button className="btn sm ghost" style={{ marginLeft: 6 }} onClick={() => setOpen(!open)} aria-expanded={open}>
              {open ? "Hide" : "Show"}
            </button>
          )}
        </span>
      </div>
      {open &&
        STYLE.filter((s) => bound(s.k) || s.k !== "speed").map((s) => (
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
    </div>
  );
}

/** Deterministic tweaks — the second change after a draft shouldn't need another prompt. */
function QuickChips() {
  const doc = useStore((s) => s.doc);
  const nudge = (k: StyleKey, d: number, label: string) => {
    if (!doc.bindings.some((b) => b.from === `style.${k}`)) return useStore.getState().toast(`Nothing in this project is bound to ${k} yet — ask the AI instead`);
    const v = Math.max(0, Math.min(1, Math.round((doc.style[k] + d) * 100) / 100));
    useStore.getState().commit([{ op: "style", key: k, value: v }], { source: "style", intent: label });
    useStore.getState().toast(`${label} · 0 AI tokens`);
  };
  const chips: { label: string; run: () => void }[] = [
    { label: "Snappier", run: () => nudge("energy", 0.2, "Snappier") },
    { label: "Calmer", run: () => nudge("energy", -0.2, "Calmer") },
    { label: "Bouncier", run: () => nudge("bounce", 0.25, "Bouncier") },
    { label: "More 3D", run: () => nudge("depth", 0.25, "More 3D") },
    { label: "+1s longer", run: () => useStore.getState().commit([{ op: "set", path: "comp/dur", delta: 1 }], { source: "you", intent: "+1s longer" }) },
  ];
  return (
    <div className="suggest" aria-label="Quick tweaks">
      {chips.map((c) => (
        <button key={c.label} className="chip" onClick={c.run}>
          {c.label}
          <span className="z">0 tok</span>
        </button>
      ))}
    </div>
  );
}

function DiffCard({ turn }: { turn: Turn }) {
  const mode = useStore((s) => s.mode);
  const past = useStore((s) => s.past);
  const ops = turn.ops ?? [];
  const accepted = turn.accepted ?? ops.map(() => true);
  const reviewing = turn.status === "review" || turn.status === "streaming";
  const n = accepted.filter((a, i) => a && !turn.opErrors?.[i]).length;
  if (!ops.length) return null;
  return (
    <div className="diff" data-testid="diff-card">
      <div className="diff-h">
        <span>
          {ops.length} change{ops.length > 1 ? "s" : ""}
          {turn.status === "streaming" ? " · streaming" : reviewing ? " · previewing live" : ""}
        </span>
        {reviewing && ops.length > 1 && <span className="faint">untick to reject a change</span>}
      </div>
      {ops.map((op, i) => (
        <label key={i} className={`diff-op new${accepted[i] ? "" : " off"}`}>
          <input type="checkbox" checked={accepted[i]} disabled={!reviewing || turn.status === "streaming"} onChange={() => useStore.getState().togglePreviewOp(i)} aria-label={describeOp(op)} />
          <div>
            <div className="d">{describeOp(op)}</div>
            {mode === "pro" && <div className="raw">{JSON.stringify(op)}</div>}
            {turn.opErrors?.[i] && <div className="err">{turn.opErrors[i]}</div>}
          </div>
        </label>
      ))}
      <div className="diff-f">
        <span className="faint mono" style={{ fontSize: 11 }} title="Estimated tokens for this turn">
          ≈ {turn.tokens?.in ?? 0} in · {turn.tokens?.out ?? 0} out
        </span>
        <span className="spacer" />
        {turn.status === "review" && (
          <>
            <button className="btn sm" onClick={() => useStore.getState().discardPreview()}>
              Discard
            </button>
            <button className="btn sm ai" onClick={() => useStore.getState().keepPreview()} disabled={!n} data-testid="keep">
              Keep {n === ops.length ? "all" : `${n} of ${ops.length}`}
            </button>
          </>
        )}
        {turn.status === "kept" && (
          <span className="status-line ok">
            ✓ Kept
            {past.at(-1)?.id === turn.txnId && (
              <button className="btn sm ghost" onClick={() => useStore.getState().undo()}>
                Undo
              </button>
            )}
          </span>
        )}
        {turn.status === "discarded" && <span className="status-line">Discarded</span>}
      </div>
    </div>
  );
}

function TurnView({ turn }: { turn: Turn }) {
  if (turn.role === "user")
    return (
      <div className="msg-user">
        {turn.text}
        {turn.scope?.length ? <div className="scope">↳ {turn.scope.join(", ")}</div> : null}
      </div>
    );
  return (
    <div className="msg-agent" data-testid="agent-turn">
      <div className="who">
        <Icon name="sparkle" sm />
        {turn.agent ?? "AI"}
        <span className="tag">{turn.agent === "Pasted" ? "pasted ops" : "edits the document"}</span>
      </div>
      {turn.status === "waiting" && <div className="shimmer">{turn.text || "Thinking…"}</div>}
      {turn.status === "streaming" && <div className="shimmer">Writing ops…</div>}
      {turn.status !== "waiting" && turn.text && <div className="agent-text">{turn.text}</div>}
      <DiffCard turn={turn} />
      {turn.chips?.length && (turn.status === "kept" || turn.status === "review" || turn.status === "info") ? (
        <div className="chips">
          {turn.chips.map((c) => (
            <button
              key={c.label}
              className="chip"
              title={c.hint}
              onClick={() => {
                if (c.ops) {
                  const st = useStore.getState();
                  if (st.preview) st.keepPreview();
                  const r = st.commit(c.ops, { source: "ai", intent: c.label });
                  st.toast(r.ok ? `${c.label} · applied without a model call` : r.errors[0], r.ok ? "info" : "error");
                } else if (c.prompt) sendPrompt(c.prompt);
              }}
            >
              {c.label}
              {c.ops && <span className="z">0 tok</span>}
            </button>
          ))}
        </div>
      ) : null}
      {turn.context && (
        <details className="ctx">
          <summary>What the AI saw · ≈{estTokens(turn.context)} tokens (plus a cached system prompt)</summary>
          <pre>{turn.context}</pre>
        </details>
      )}
    </div>
  );
}

function PasteOps() {
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
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  return (
    <details className="paste">
      <summary>Paste ops from any AI (JSON array or one op per line)</summary>
      <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder='[{"op":"set","path":"title/size","value":140}]' aria-label="Ops to paste" />
      {err && <div className="warn">{err}</div>}
      <button className="btn sm" style={{ marginTop: 6 }} disabled={!text.trim()} onClick={run}>
        Preview ops
      </button>
    </details>
  );
}

const EXAMPLES = ["Make the headline bounce in word by word", "Add a subtitle under the headline", "Swap the palette to warm sunset colours", "Push the camera in slowly over the whole video"];

export function Assistant() {
  const turns = useStore((s) => s.turns);
  const agent = useStore((s) => s.agent);
  const selection = useStore((s) => s.selection);
  const mode = useStore((s) => s.mode);
  const [text, setText] = useState("");
  const [provider, setProvider] = useState<ProviderId>("agentrouter");
  const msgs = useRef<HTMLDivElement>(null);
  useEffect(() => {
    msgs.current?.scrollTo({ top: msgs.current.scrollHeight, behavior: "smooth" });
  }, [turns]);
  const send = (t = text) => {
    if (!t.trim()) return;
    sendPrompt(t.trim());
    setText("");
  };
  return (
    <div className="tabpanel" data-testid="assistant">
      <div className="agent-state">
        <span className={`dot${agent ? " on" : ""}`} />
        {agent ? (
          <span title="Edits arrive as reviewable ops">
            <b style={{ color: "var(--text)" }}>{agent.name}</b> connected
          </span>
        ) : (
          <span title="Requests queue until an agent connects">No AI connected</span>
        )}
        <div className="spacer" />
        {agent ? (
          <button className="btn sm ghost" onClick={disconnectProvider}>Disconnect</button>
        ) : (
          <>
            <select value={provider} onChange={(e) => setProvider(e.target.value as ProviderId)} aria-label="AI provider" style={{ height: 28, fontSize: 12, fontWeight: 550, borderRadius: 999, paddingLeft: 12, minWidth: 104 }}>
              {Object.entries(PROVIDERS).map(([id, cfg]) => (
                <option key={id} value={id}>{cfg.label}</option>
              ))}
            </select>
            <button className="btn sm ai" onClick={() => connectProvider(provider)} title={`Calls ${PROVIDERS[provider].label} for every request from now on`}>Connect</button>
          </>
        )}
      </div>
      <StyleBox />
      <div className="msgs" ref={msgs}>
        {!turns.length && (
          <div className="empty-chat">
            <h3>Describe the motion you want</h3>
            <div>The AI edits this project's JSON directly: small, reviewable changes that update the timeline live. Select a layer first to focus it on just that layer.</div>
            <div className="chips">
              {EXAMPLES.map((e) => (
                <button key={e} className="chip" onClick={() => send(e)}>
                  {e}
                </button>
              ))}
            </div>
          </div>
        )}
        {turns.map((t) => (
          <TurnView key={t.id} turn={t} />
        ))}
      </div>
      <QuickChips />
      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <div className="scope-line">
          {selection.length ? (
            <>
              Focus
              {selection.map((id) => (
                <span className="scope-pill" key={id}>
                  {id}
                  <button type="button" aria-label={`Remove ${id} from focus`} onClick={() => useStore.getState().select(selection.filter((x) => x !== id))}>
                    ×
                  </button>
                </span>
              ))}
              <span className="faint">only these layers' JSON is sent</span>
            </>
          ) : (
            <span>Whole video · the AI sees a one-line-per-layer outline</span>
          )}
        </div>
        <div className="composer-row">
          <textarea
            id="prompt"
            rows={2}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Describe a change… e.g. “make the phone spin in and the chips orbit faster”"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            aria-label="Message the AI"
          />
          <button className="btn ai" type="submit" disabled={!text.trim()} aria-label="Send">
            <Icon name="sparkle" sm /> Send
          </button>
        </div>
      </form>
      {mode === "pro" && <PasteOps />}
    </div>
  );
}
