import { useEffect, useState, type ReactNode } from "react";
import { MATERIALS, type Doc, type Layer, type TextLayer, type ShapeLayer, type ImageLayer, type DeviceLayer, type ClonerLayer, type GradientLayer, type CameraLayer, type Beh, type HtmlLayer, type PathLayer, type MeshLayer, type SkyLayer, type AdjustLayer } from "../../fmd/schema";
import { applyTxn, type Op } from "../../fmd/ops";
import { CATALOG, type BehSpec, type BehGroup } from "../../fmd/catalog";
import { EASE_NAMES } from "../../runtime/ease";
import { exprError } from "../../runtime/expr";
import { activeCamera, behDur, trackValue } from "../../runtime/evaluate";
import { FONT_NAMES } from "../../render/glyphs";
import { ENV_NAMES } from "../../render/env";
import { importAsset, assetUrl } from "../../assets/assets";
import { useStore, useDisplayDoc } from "../store";
import { playhead } from "../playhead";
import { setChannelOps, toggleKeyOps, ownerOf, keyIndexAt, localTime, uniqueBehId, duplicateOps, deleteOps, behColor } from "../edit";
import { Icon, NumField, ColorField, Seg, TYPE_ICON } from "./ui";

const r3 = (v: number) => Math.round(v * 1000) / 1000;

function commit(ops: Op[], intent: string) {
  const st = useStore.getState();
  st.setTransient(null);
  const r = st.commit(ops, { source: "you", intent });
  if (!r.ok) st.toast(r.errors[0], "error");
  return r.ok;
}
function preview(ops: Op[]) {
  const st = useStore.getState();
  const r = applyTxn(st.doc, ops, { source: "you", validate: false });
  if (r.ok) st.setTransient(r.doc);
}

/** Re-render on playhead moves, but only when not playing (values under the playhead). */
function usePlayheadTick() {
  const [, set] = useState(0);
  useEffect(() => playhead.subscribe(() => !playhead.isPlaying() && set((n) => n + 1)), []);
}

function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <div className="sec">
      <div className="sec-h">
        <span>{title}</span>
        {right}
      </div>
      {children}
    </div>
  );
}

/* ------------------------- keyable property row ----------------------- */
function PropRow({ doc, L, ch, label, step = 1, min, max, precision = 2, pro }: { doc: Doc; L: Layer; ch: string; label: string; step?: number; min?: number; max?: number; precision?: number; pro: boolean }) {
  const t = playhead.get();
  const local = localTime(doc, L, t);
  const value = trackValue(doc, L, ch, local);
  const track = L.keys?.[ch];
  const keyed = !!track?.length;
  const atKey = keyed && keyIndexAt(track, local, doc.comp.fps) >= 0;
  const owner = ownerOf(L, ch);
  const ops = (v: number) => setChannelOps(useStore.getState().doc, L, ch, v, playhead.get());
  return (
    <div className={`prow${pro ? "" : " nokey"}`}>
      {pro ? (
        <button
          className={`kf${keyed ? " has" : ""}${atKey ? " at" : ""}`}
          title={owner ? `Driven by the "${owner}" behavior` : keyed ? (atKey ? "Remove key at playhead" : "Add key at playhead") : "Animate: add a key at the playhead"}
          aria-label={`Keyframe ${label}`}
          disabled={!!owner && !keyed}
          onClick={() => commit(toggleKeyOps(useStore.getState().doc, L, ch, playhead.get()), `${atKey ? "Removed" : "Added"} ${ch} key on ${L.id}`)}
        >
          <svg viewBox="0 0 10 10" aria-hidden="true">
            <path d="M5 .8L9.2 5 5 9.2.8 5z" stroke="currentColor" strokeWidth="1.2" fill={atKey ? "currentColor" : "none"} />
          </svg>
        </button>
      ) : (
        <span />
      )}
      <label title={owner ? `${label} is animated by "${owner}"; this is its resting value` : label}>{label}</label>
      <div className="vals">
        <NumField
          value={value}
          step={step}
          min={min}
          max={max}
          precision={precision}
          className={`${keyed ? "keyed" : ""}${owner ? " driven" : ""}`}
          title={`${L.id} ${ch}`}
          onScrub={(v) => preview(ops(v))}
          onScrubEnd={(v) => commit(ops(v), `Set ${L.id} ${ch}`)}
          onCommit={(v) => commit(ops(v), `Set ${L.id} ${ch}`)}
        />
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="prow nokey">
      <span />
      <label>{label}</label>
      <div className="vals">{children}</div>
    </div>
  );
}

function AssetPicker({ doc, value, onChange, allowNone }: { doc: Doc; value?: string; onChange: (id: string | undefined) => void; allowNone?: string }) {
  const upload = () => {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = "image/*";
    inp.onchange = async () => {
      const f = inp.files?.[0];
      if (!f) return;
      const st = useStore.getState();
      const { id, entry } = await importAsset(f, Object.keys(st.doc.assets));
      st.commit([{ op: "set", path: `assets/${id}`, value: entry }], { source: "you", intent: `Imported ${f.name}` });
      onChange(id);
    };
    inp.click();
  };
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center", width: "100%" }}>
      {value && assetUrl(value) && <img src={assetUrl(value)} alt="" style={{ width: 28, height: 28, objectFit: "cover", borderRadius: 6, border: "1px solid var(--line2)" }} />}
      <select value={value ?? ""} onChange={(e) => onChange(e.target.value || undefined)} style={{ flex: 1 }} aria-label="Asset">
        {allowNone && <option value="">{allowNone}</option>}
        {!allowNone && !value && <option value="">Choose…</option>}
        {Object.keys(doc.assets).map((id) => (
          <option key={id} value={id}>{doc.assets[id].name ?? id}</option>
        ))}
      </select>
      <button className="btn sm" onClick={upload} title="Upload an image">
        <Icon name="upload" sm />
      </button>
    </div>
  );
}

/* ------------------------------ behaviors ----------------------------- */
function defaultAt(doc: Doc, L: Layer, spec: BehSpec): number {
  const [a, b] = [L.in ?? 0, L.out ?? doc.comp.dur];
  if (spec.group === "Exit") return r3(Math.max(0, b - a - spec.dur));
  return 0;
}

function conflictReason(doc: Doc, L: Layer, spec: BehSpec, ignoreId?: string): string | null {
  if (spec.types && !spec.types.includes(L.type)) return `not for ${L.type} layers`;
  if (spec.mode !== "own") return null;
  const at = defaultAt(doc, L, spec);
  for (const w of spec.writes) {
    if (L.keys?.[w]) return `${w} has keyframes`;
    for (const b of L.beh ?? []) {
      if (b.id === ignoreId) continue;
      const s = CATALOG[b.use];
      if (!s || s.mode !== "own" || !s.writes.includes(w)) continue;
      if (at < b.at + behDur(b) && b.at < at + spec.dur) return `conflicts with ${s.label}`;
    }
  }
  return null;
}

function newBeh(doc: Doc, L: Layer, spec: BehSpec, id?: string): Beh {
  const b: Beh = { id: id ?? uniqueBehId(L, spec.use), use: spec.use, at: defaultAt(doc, L, spec) };
  if (spec.mode !== "add") b.dur = spec.dur;
  if (spec.bounce !== undefined) b.bounce = spec.bounce;
  return b;
}

function BehCard({ L, b, pro, open, onToggle }: { L: Layer; b: Beh; pro: boolean; open: boolean; onToggle: () => void }) {
  const spec = CATALOG[b.use];
  if (!spec) return <div className="warn">Unknown behavior {b.use}</div>;
  const path = `${L.id}/beh/${b.id}`;
  const set = (k: string, v: unknown, label?: string) => commit([{ op: "set", path: `${path}/${k}`, value: v }], label ?? `Set ${spec.label} ${k}`);
  const loop = spec.mode === "add";
  const [a] = [L.in ?? 0];
  const usesSpring = b.ease === undefined && (b.bounce !== undefined || spec.bounce !== undefined);
  return (
    <div className="beh-card" data-testid={`beh-${b.id}`}>
      <div className="beh-top" onClick={onToggle}>
        <span className="dotc" style={{ background: behColor(b.use) }} />
        <span className="nm">{spec.label}</span>
        <span className="faint" style={{ fontSize: 11 }}>{spec.group}</span>
        <span className="meta">
          {(a + b.at).toFixed(2)}s{loop ? " →" : ` · ${behDur(b).toFixed(2)}s`}
        </span>
        <button
          className="iconbtn"
          style={{ width: 22, height: 22 }}
          aria-label={`Remove ${spec.label}`}
          title="Remove"
          onClick={(e) => {
            e.stopPropagation();
            commit([{ op: "del", path }], `Removed ${spec.label} from ${L.id}`);
          }}
        >
          <Icon name="x" sm />
        </button>
      </div>
      {open && (
        <div className="beh-body">
          <Field label="Starts at">
            <NumField value={a + b.at} step={0.05} min={0} onCommit={(v) => set("at", r3(v - a), `Moved ${spec.label}`)} />
          </Field>
          {!loop && (
            <Field label="Duration">
              <NumField value={behDur(b)} step={0.05} min={0.05} onCommit={(v) => set("dur", r3(v))} />
            </Field>
          )}
          {!loop && (
            <Field label="Feel">
              <select
                value={usesSpring ? "spring" : b.ease ?? spec.ease}
                onChange={(e) => {
                  const v = e.target.value;
                  const ops: Op[] = v === "spring" ? [{ op: "del", path: `${path}/ease` }, { op: "set", path: `${path}/bounce`, value: b.bounce ?? 0.4 }] : [{ op: "set", path: `${path}/ease`, value: v }, ...(b.bounce !== undefined ? [{ op: "del", path: `${path}/bounce` } as Op] : [])];
                  commit(ops, `${spec.label} feel → ${v}`);
                }}
                aria-label="Easing"
              >
                <option value="spring">Spring</option>
                {EASE_NAMES.map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </Field>
          )}
          {!loop && usesSpring && (
            <Field label="Bounce">
              <input type="range" min={0} max={0.9} step={0.05} value={b.bounce ?? spec.bounce ?? 0} aria-label="Bounce" onChange={(e) => preview([{ op: "set", path: `${path}/bounce`, value: Number(e.target.value) }])} onPointerUp={(e) => set("bounce", Number((e.target as HTMLInputElement).value))} onKeyUp={(e) => set("bounce", Number((e.target as HTMLInputElement).value))} />
            </Field>
          )}
          {Object.entries(spec.params).map(([k, p]) => {
            const v = (b as Record<string, unknown>)[k] ?? p.default;
            return (
              <Field key={k} label={k}>
                {p.options ? (
                  <select value={String(v)} onChange={(e) => set(k, e.target.value)} aria-label={k}>
                    {p.options.map((o) => (
                      <option key={o}>{o}</option>
                    ))}
                  </select>
                ) : (
                  <NumField value={Number(v)} step={p.step ?? 1} min={p.min} max={p.max} precision={3} title={p.desc} onCommit={(x) => set(k, x)} />
                )}
              </Field>
            );
          })}
          {pro && spec.bake !== "never" && (
            <button className="btn sm" onClick={() => commit([{ op: "bake", path }], `Baked ${spec.label} into keys`)} title="Convert into editable keyframes">
              Bake into keyframes
            </button>
          )}
          <div className="hint">{spec.desc}</div>
        </div>
      )}
    </div>
  );
}

function AddBehavior({ doc, L, onDone }: { doc: Doc; L: Layer; onDone: () => void }) {
  const groups: BehGroup[] = L.type === "camera" ? ["Camera"] : L.type === "text" ? ["Enter", "Text", "Loop", "Exit"] : ["Enter", "Loop", "Exit"];
  return (
    <div className="addmenu">
      {groups.map((g) => (
        <div className="grp" key={g}>
          <div className="grp-h">{g}</div>
          <div className="opts">
            {Object.values(CATALOG)
              .filter((s) => s.group === g && (!s.types || s.types.includes(L.type)))
              .map((s) => {
                const why = conflictReason(doc, L, s);
                return (
                  <button
                    key={s.use}
                    className="chip"
                    disabled={!!why}
                    title={why ?? s.desc}
                    onClick={() => {
                      const b = newBeh(doc, L, s);
                      if (commit([{ op: "set", path: `${L.id}/beh/${b.id}`, value: b }], `Added ${s.label} to ${L.id}`)) onDone();
                    }}
                  >
                    <span className="dotc" style={{ width: 7, height: 7, borderRadius: 2, background: behColor(s.use) }} />
                    {s.label}
                  </button>
                );
              })}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Novice: pick an entrance / loop / exit in one click. Each slot is one behavior with a fixed id. */
function SimpleAnimation({ doc, L }: { doc: Doc; L: Layer }) {
  const slot = (groups: BehGroup[]) => (L.beh ?? []).find((b) => groups.includes(CATALOG[b.use]?.group));
  const choose = (groups: BehGroup[], use: string | null, slotId: string) => {
    const cur = slot(groups);
    const ops: Op[] = [];
    if (cur) ops.push({ op: "del", path: `${L.id}/beh/${cur.id}` });
    if (use) {
      const spec = CATALOG[use];
      const clean = { ...L, beh: (L.beh ?? []).filter((b) => b.id !== cur?.id) } as Layer;
      const why = conflictReason(doc, clean, spec);
      if (why) {
        useStore.getState().toast(`${spec.label}: ${why}`, "error");
        return;
      }
      const b = newBeh(doc, clean, spec, cur?.id ?? uniqueBehId(clean, slotId));
      if (cur && spec.group !== "Loop") b.dur = cur.dur ?? b.dur;
      ops.push({ op: "set", path: `${L.id}/beh/${b.id}`, value: b });
    }
    commit(ops, use ? `${L.id}: ${CATALOG[use].label}` : `${L.id}: no ${groups[0].toLowerCase()} animation`);
  };
  const rowFor = (title: string, groups: BehGroup[], uses: string[], slotId: string) => {
    const cur = slot(groups);
    return (
      <div className="sec" style={{ gap: 5 }}>
        <div className="hint" style={{ color: "var(--muted)" }}>{title}</div>
        <div className="big-choices">
          <button aria-pressed={!cur} onClick={() => choose(groups, null, slotId)}>None</button>
          {uses.map((u) => (
            <button key={u} aria-pressed={cur?.use === u} onClick={() => choose(groups, u, slotId)}>
              <span style={{ width: 10, height: 3, borderRadius: 2, background: behColor(u) }} />
              {CATALOG[u].label}
            </button>
          ))}
        </div>
      </div>
    );
  };
  if (L.type === "camera") return rowFor("Camera move", ["Camera"], ["dolly", "truck", "orbit", "shake"], "move");
  const enter = L.type === "text" ? ["typeUp", "bounceIn", "cascade", "rise", "fadeIn"] : ["rise", "popIn", "slideIn", "fadeIn", "flipIn"];
  const entr = slot(["Enter", "Text"]);
  return (
    <>
      {rowFor("Entrance", ["Enter", "Text"], enter, "in")}
      {entr && CATALOG[entr.use].mode !== "add" && (
        <Field label="Speed">
          <input type="range" min={0.2} max={2} step={0.05} value={2.2 - behDur(entr)} aria-label="Entrance speed" onChange={(e) => preview([{ op: "set", path: `${L.id}/beh/${entr.id}/dur`, value: r3(2.2 - Number(e.target.value)) }])} onPointerUp={(e) => commit([{ op: "set", path: `${L.id}/beh/${entr.id}/dur`, value: r3(2.2 - Number((e.target as HTMLInputElement).value)) }], `${L.id} entrance speed`)} />
        </Field>
      )}
      {rowFor("While on screen", ["Loop"], ["float", "wiggle", "pulse", "sway", "spin"], "loop")}
      {rowFor("Exit", ["Exit"], ["fadeOut", "sink"], "out")}
    </>
  );
}

/* ------------------------------- layer ------------------------------- */
function LayerInspector({ doc, L, pro }: { doc: Doc; L: Layer; pro: boolean }) {
  const [adding, setAdding] = useState(false);
  const [openBeh, setOpenBeh] = useState<string | null>(null);
  const [exprCh, setExprCh] = useState("rot.z");
  const [exprText, setExprText] = useState("");
  const id = L.id;
  const set = (k: string, v: unknown, intent?: string) => commit([{ op: "set", path: `${id}/${k}`, value: v }], intent ?? `Set ${id} ${k}`);
  const P = (ch: string, label: string, step = 1, extra: Partial<{ min: number; max: number; precision: number }> = {}) => <PropRow doc={doc} L={L} ch={ch} label={label} step={step} pro={pro} {...extra} />;
  const [textDraft, setTextDraft] = useState(L.type === "text" ? L.text : "");
  useEffect(() => {
    if (L.type === "text") setTextDraft(L.text);
  }, [L]);

  return (
    <div className="insp" data-testid="inspector">
      <div className="insp-head">
        <span className="tbadge"><Icon name={TYPE_ICON[L.type]} sm /></span>
        <input aria-label="Layer name" defaultValue={L.name ?? L.id} key={L.id + (L.name ?? "")} onBlur={(e) => e.target.value !== (L.name ?? L.id) && set("name", e.target.value, `Renamed ${id}`)} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
        <button className="iconbtn" title="Duplicate (⌘D)" aria-label="Duplicate" onClick={() => {
          const d = duplicateOps(doc, id);
          if (d && commit(d.ops, `Duplicated ${id}`)) useStore.getState().select([d.newId]);
        }}><Icon name="copy" sm /></button>
        <button className="iconbtn" title="Delete (⌫)" aria-label="Delete layer" onClick={() => commit(deleteOps(doc, [id]), `Deleted ${id}`) && useStore.getState().select([])}><Icon name="trash" sm /></button>
      </div>
      <div className="hint mono" style={{ marginTop: -8 }}>id: {id} · {L.type}</div>

      {L.type !== "gradient" && (
        <Section title="Timing">
          <Field label="Starts at">
            <NumField value={L.in ?? 0} step={0.05} min={0} onCommit={(v) => set("in", r3(v), `${id} starts at ${v}s`)} />
          </Field>
          <Field label="Ends at">
            <NumField value={L.out ?? doc.comp.dur} step={0.05} min={0.05} onCommit={(v) => set("out", r3(v), `${id} ends at ${v}s`)} />
          </Field>
        </Section>
      )}

      {!["gradient", "sky", "adjust"].includes(L.type) && (
        <Section title="Transform">
          {P("pos.x", "Position X")}
          {P("pos.y", "Position Y")}
          {pro && P("pos.z", "Depth Z", 5)}
          {L.type !== "camera" && P("scale", "Scale", 0.01, { precision: 3 })}
          {P("rot.z", "Rotation", 1)}
          {pro && P("rot.x", "Tilt X", 1)}
          {pro && P("rot.y", "Turn Y", 1)}
          {L.type !== "camera" && P("opacity", "Opacity", 0.01, { min: 0, max: 1, precision: 2 })}
          {pro && L.type !== "camera" && (
            <Field label="3D depth sort">
              <Seg value={(L.depth ?? (L.type === "device" || L.type === "cloner")) ? "on" : "off"} options={[{ v: "off", l: "Flat" }, { v: "on", l: "3D" }]} onChange={(v) => set("depth", v === "on")} />
            </Field>
          )}
          {pro && (
            <Field label="Parent">
              <select value={L.parent ?? ""} onChange={(e) => (e.target.value ? set("parent", e.target.value, `Parented ${id}`) : commit([{ op: "del", path: `${id}/parent` }], `Unparented ${id}`))} aria-label="Parent">
                <option value="">None</option>
                {doc.layers.filter((x) => x.id !== id && x.type !== "gradient" && x.type !== "camera").map((x) => (
                  <option key={x.id} value={x.id}>{x.id}</option>
                ))}
              </select>
            </Field>
          )}
        </Section>
      )}

      {L.type === "text" && (
        <Section title="Text">
          <textarea
            id="insp-text"
            aria-label="Text content"
            value={textDraft}
            rows={Math.min(5, textDraft.split("\n").length + 1)}
            onChange={(e) => {
              setTextDraft(e.target.value);
              preview([{ op: "set", path: `${id}/text`, value: e.target.value }]);
            }}
            onBlur={() => {
              const committed = useStore.getState().doc.layers.find((x) => x.id === id) as TextLayer | undefined;
              if (committed && textDraft !== committed.text) set("text", textDraft, `Edited ${id} text`);
              else useStore.getState().setTransient(null);
            }}
            onKeyDown={(e) => e.key === "Enter" && (e.metaKey || e.ctrlKey) && (e.target as HTMLTextAreaElement).blur()}
          />
          <Field label="Font">
            <select value={(L as TextLayer).font ?? doc.brand.font} onChange={(e) => set("font", e.target.value)} aria-label="Font">
              {FONT_NAMES.map((f) => (
                <option key={f} value={f}>{f.replace(" Variable", "")}</option>
              ))}
            </select>
          </Field>
          <Field label="Weight">
            <select value={(L as TextLayer).weight ?? 600} onChange={(e) => set("weight", Number(e.target.value))} aria-label="Weight">
              {[300, 400, 500, 600, 700, 800, 900].map((w) => (
                <option key={w}>{w}</option>
              ))}
            </select>
          </Field>
          {P("size", "Size", 1, { min: 4 })}
          <Field label="Colour"><ColorField doc={doc} value={(L as TextLayer).color} onChange={(v) => set("color", v)} /></Field>
          <Field label="Align">
            <Seg value={(L as TextLayer).align ?? "center"} options={[{ v: "left", l: "Left" }, { v: "center", l: "Centre" }, { v: "right", l: "Right" }]} onChange={(v) => set("align", v)} />
          </Field>
          {pro && P("tracking", "Tracking", 0.5)}
        </Section>
      )}

      {L.type === "shape" && (
        <Section title="Shape">
          <Field label="Kind">
            <Seg value={(L as ShapeLayer).shape} options={[{ v: "rect", l: "Rectangle" }, { v: "ellipse", l: "Ellipse" }]} onChange={(v) => set("shape", v)} />
          </Field>
          {P("w", "Width", 2, { min: 1 })}
          {P("h", "Height", 2, { min: 1 })}
          {(L as ShapeLayer).shape === "rect" && P("radius", "Corner radius", 1, { min: 0 })}
          <Field label="Fill"><ColorField doc={doc} value={(L as ShapeLayer).fill} onChange={(v) => set("fill", v)} /></Field>
          {pro && <Field label="Stroke"><ColorField doc={doc} value={(L as ShapeLayer).stroke} allowNone onChange={(v) => (v ? set("stroke", v) : commit([{ op: "del", path: `${id}/stroke` }], "No stroke"))} /></Field>}
        </Section>
      )}

      {L.type === "image" && (
        <Section title="Image">
          <Field label="Source"><AssetPicker doc={doc} value={(L as ImageLayer).src} onChange={(v) => v && set("src", v)} /></Field>
          {P("w", "Width", 2, { min: 1 })}
          {P("radius", "Corner radius", 1, { min: 0 })}
        </Section>
      )}

      {L.type === "device" && (
        <Section title="Device">
          <Field label="Model">
            <Seg value={(L as DeviceLayer).model} options={[{ v: "iphone", l: "iPhone" }, { v: "browser", l: "Browser" }]} onChange={(v) => set("model", v)} />
          </Field>
          <Field label="Screen">
            <AssetPicker doc={doc} value={(L as DeviceLayer).screen} allowNone="Built-in demo screen" onChange={(v) => (v ? set("screen", v, `Screen → ${v}`) : commit([{ op: "del", path: `${id}/screen` }], "Demo screen"))} />
          </Field>
          {P("w", "Width", 2, { min: 40 })}
          <Field label="Finish"><ColorField doc={doc} value={(L as DeviceLayer).color ?? "#1b1c21"} onChange={(v) => set("color", v)} /></Field>
        </Section>
      )}

      {L.type === "cloner" && <ClonerSection doc={doc} L={L as ClonerLayer} pro={pro} P={P} set={set} />}

      {L.type === "camera" && (
        <Section title="Camera">
          {P("fov", "Field of view", 1, { min: 5, max: 120 })}
          {activeCamera(doc)?.id !== id && <button className="btn sm" onClick={() => commit([{ op: "set", path: "comp/cam", value: id }], `Active camera → ${id}`)}>Make active camera</button>}
          <div className="hint">At 35° the comp frame fits at Z = 1713. Lower Z pushes in.</div>
        </Section>
      )}

      {L.type === "gradient" && (
        <Section title="Background">
          <Field label="Kind">
            <Seg value={(L as GradientLayer).kind ?? "linear"} options={[{ v: "linear", l: "Linear" }, { v: "radial", l: "Radial" }]} onChange={(v) => set("kind", v)} />
          </Field>
          {(L as GradientLayer).kind !== "radial" && P("angle", "Angle", 1)}
          {(L as GradientLayer).colors.map((c, i) => (
            <Field key={i} label={`Colour ${i + 1}`}>
              <ColorField doc={doc} value={c} onChange={(v) => v && set(`colors`, (L as GradientLayer).colors.map((x, j) => (j === i ? v : x)))} />
            </Field>
          ))}
          <div style={{ display: "flex", gap: 6 }}>
            {(L as GradientLayer).colors.length < 4 && <button className="btn sm" onClick={() => set("colors", [...(L as GradientLayer).colors, (L as GradientLayer).colors.at(-1)!])}>Add colour</button>}
            {(L as GradientLayer).colors.length > 2 && <button className="btn sm" onClick={() => set("colors", (L as GradientLayer).colors.slice(0, -1))}>Remove colour</button>}
          </div>
          {P("noise", "Film grain", 0.01, { min: 0, max: 1 })}
        </Section>
      )}

      {L.type === "html" && (
        <Section title="UI card">
          {P("w", "Width", 2, { min: 1 })}
          {P("h", "Height", 2, { min: 1 })}
          {P("radius", "Corner radius", 1, { min: 0 })}
          {Object.keys((L as HtmlLayer).vars ?? {}).map((k) => <div key={k}>{P(`vars.${k}`, `{{${k}}}`, 0.1)}</div>)}
          {pro && (
            <textarea aria-label="HTML" className="mono" rows={6} defaultValue={(L as HtmlLayer).html} key={(L as HtmlLayer).html}
              onBlur={(e) => e.target.value !== (L as HtmlLayer).html && set("html", e.target.value, `Edited ${id} markup`)} />
          )}
          <div className="hint">HTML + CSS, rasterised crisply. <span className="mono">{"{{name}}"}</span> reads a keyable number — key it for rolling counters.</div>
        </Section>
      )}

      {L.type === "path" && (
        <Section title="Stroke">
          <Field label="Colour"><ColorField doc={doc} value={(L as PathLayer).stroke ?? "#ffffff"} onChange={(v) => v && set("stroke", v)} /></Field>
          {P("width", "Width", 0.5, { min: 0.5 })}
          {P("trimStart", "Trim start", 0.01, { min: 0, max: 1 })}
          {P("trimEnd", "Trim end", 0.01, { min: 0, max: 1 })}
          {P("glow", "Glow", 0.01, { min: 0, max: 1 })}
          <div className="hint">Key Trim end 0 → 1 to draw the line on (AE: Trim Paths).</div>
        </Section>
      )}

      {L.type === "mesh" && (
        <Section title="3D object">
          <Field label="Shape">
            <select value={(L as MeshLayer).geom} onChange={(e) => set("geom", e.target.value)} aria-label="3D shape">
              {["sphere", "box", "torus", "ring", "cylinder", "capsule", "cone", "coin", "balloon", "pear", "slab"].map((g) => <option key={g}>{g}</option>)}
            </select>
          </Field>
          <Field label="Material">
            <select value={(L as MeshLayer).material ?? "plastic"} onChange={(e) => set("material", e.target.value)} aria-label="Material">
              {MATERIALS.map((m) => <option key={m}>{m}</option>)}
            </select>
          </Field>
          <Field label="Colour"><ColorField doc={doc} value={(L as MeshLayer).color ?? "#dddddd"} onChange={(v) => v && set("color", v)} /></Field>
          {(L as MeshLayer).geom !== "slab" && P("size", "Size", 2, { min: 1 })}
          <Field label="Lighting">
            <select value={doc.comp.env ?? "studio"} onChange={(e) => commit([{ op: "set", path: "comp/env", value: e.target.value }], `Lighting → ${e.target.value}`)} aria-label="Environment lighting">
              {ENV_NAMES.map((n) => <option key={n}>{n}</option>)}
            </select>
          </Field>
        </Section>
      )}

      {L.type === "sky" && (
        <Section title="Sky">
          <Field label="Zenith"><ColorField doc={doc} value={(L as SkyLayer).top ?? "#2f7fe0"} onChange={(v) => v && set("top", v)} /></Field>
          <Field label="Horizon"><ColorField doc={doc} value={(L as SkyLayer).horizon ?? "#bcdcf5"} onChange={(v) => v && set("horizon", v)} /></Field>
          {P("clouds", "Clouds", 0.01, { min: 0, max: 1 })}
          {P("sun", "Sun", 0.01, { min: 0, max: 1 })}
          {P("drift", "Cloud drift", 0.1)}
          {P("stars", "Stars", 0.01, { min: 0, max: 1 })}
          <Field label="Mountains"><Seg value={(L as SkyLayer).mountains ? "on" : "off"} options={[{ v: "off", l: "Off" }, { v: "on", l: "On" }]} onChange={(v) => set("mountains", v === "on")} /></Field>
          <Field label="Hills"><ColorField doc={doc} value={(L as SkyLayer).hills} allowNone onChange={(v) => (v ? set("hills", v) : commit([{ op: "del", path: `${id}/hills` }], "No hills"))} /></Field>
          <Field label="Grass"><ColorField doc={doc} value={(L as SkyLayer).grass} allowNone onChange={(v) => (v ? set("grass", v) : commit([{ op: "del", path: `${id}/grass` }], "No grass"))} /></Field>
        </Section>
      )}

      {L.type === "adjust" && (
        <Section title="Adjustment">
          {P("exposure", "Exposure", 0.05, { min: -4, max: 4 })}
          {P("contrast", "Contrast", 0.01, { min: -1, max: 1 })}
          {P("saturation", "Saturation", 0.01, { min: -1, max: 1 })}
          {P("fade", "Fade", 0.01, { min: 0, max: 1 })}
          <Field label="Fade to"><ColorField doc={doc} value={(L as AdjustLayer).fadeColor ?? "#ffffff"} onChange={(v) => v && set("fadeColor", v)} /></Field>
          <Field label="Cloud dissolve"><Seg value={(L as AdjustLayer).dissolve ? "on" : "off"} options={[{ v: "off", l: "Even" }, { v: "on", l: "Clouds" }]} onChange={(v) => set("dissolve", v === "on" ? 1 : 0)} /></Field>
          <div className="hint">Affects every layer below it. Key Fade for white-outs, dips to black and fog transitions.</div>
        </Section>
      )}

      {pro && !["camera", "gradient", "sky", "adjust", "group"].includes(L.type) && <EffectControls doc={doc} L={L} P={P} set={set} />}

      {L.type !== "gradient" && (
        <Section title="Animation" right={pro ? <button className="btn sm ghost" onClick={() => setAdding(!adding)} aria-expanded={adding}><Icon name="plus" sm /> Add</button> : undefined}>
          {pro ? (
            <>
              {adding && <AddBehavior doc={doc} L={L} onDone={() => setAdding(false)} />}
              {(L.beh ?? []).map((b) => (
                <BehCard key={b.id} L={L} b={b} pro={pro} open={openBeh === b.id} onToggle={() => setOpenBeh(openBeh === b.id ? null : b.id)} />
              ))}
              {!L.beh?.length && !adding && <div className="hint">No behaviors. Add one, key a property with ◆, or ask the AI.</div>}
              {L.type === "text" && (L as TextLayer).anim?.length ? <div className="hint">+ {(L as TextLayer).anim!.length} text selector{(L as TextLayer).anim!.length > 1 ? "s" : ""} (edit in JSON)</div> : null}
            </>
          ) : (
            <SimpleAnimation doc={doc} L={L} />
          )}
        </Section>
      )}

      {pro && L.type !== "gradient" && (
        <Section title="Expressions">
          {Object.entries(L.expr ?? {}).map(([ch, ex]) => (
            <div key={ch} className="prow nokey">
              <span />
              <label className="mono">{ch}</label>
              <div className="vals" style={{ gap: 4 }}>
                <input defaultValue={ex} key={ex} className="mono" style={{ fontSize: 11.5 }} aria-label={`Expression for ${ch}`} onBlur={(e) => e.target.value !== ex && (e.target.value ? set(`expr/${ch}`, e.target.value) : commit([{ op: "del", path: `${id}/expr/${ch}` }], "Removed expression"))} />
                <button className="iconbtn" style={{ width: 26, flex: "none" }} aria-label="Remove expression" onClick={() => commit([{ op: "del", path: `${id}/expr/${ch}` }], `Removed ${ch} expression`)}><Icon name="x" sm /></button>
              </div>
              {exprError(ex) && <div className="warn" style={{ gridColumn: "2 / -1" }}>{exprError(ex)}</div>}
            </div>
          ))}
          <div style={{ display: "flex", gap: 6 }}>
            <select value={exprCh} onChange={(e) => setExprCh(e.target.value)} aria-label="Channel" style={{ width: 96 }}>
              {["pos.x", "pos.y", "pos.z", "rot.x", "rot.y", "rot.z", "scale", "opacity"].map((c) => <option key={c}>{c}</option>)}
            </select>
            <input className="mono" style={{ flex: 1, fontSize: 11.5 }} placeholder="value + sin(t*3)*20" value={exprText} onChange={(e) => setExprText(e.target.value)} aria-label="New expression" />
            <button className="btn sm" disabled={!exprText || !!exprError(exprText)} onClick={() => { set(`expr/${exprCh}`, exprText, `Expression on ${exprCh}`); setExprText(""); }}>Add</button>
          </div>
          {exprText && exprError(exprText) && <div className="warn">{exprError(exprText)}</div>}
          <div className="hint">Math only: t, value, base, sin, noise(seed,x), clamp, lerp…</div>
        </Section>
      )}
    </div>
  );
}

function ClonerSection({ doc, L, pro, P, set }: { doc: Doc; L: ClonerLayer; pro: boolean; P: (ch: string, label: string, step?: number, extra?: Partial<{ min: number; max: number; precision: number }>) => ReactNode; set: (k: string, v: unknown, intent?: string) => void }) {
  const c = L.child;
  const colors = c.colors ?? [c.fill ?? "$accent"];
  const noise = L.fx?.find((f) => f.type === "noise");
  const delay = L.fx?.find((f) => f.type === "delay");
  const setFx = (id: string, v: unknown) => commit([{ op: "set", path: `${L.id}/fx/${id}`, value: v }], `Cloner ${id}`);
  return (
    <Section title="Cloner">
      <Field label="Layout">
        <Seg value={L.mode} options={[{ v: "radial", l: "Ring" }, { v: "grid", l: "Grid" }, { v: "linear", l: "Line" }]} onChange={(v) => set("mode", v)} />
      </Field>
      <Field label="Count"><NumField value={L.n} step={1} min={1} max={400} precision={0} onCommit={(v) => set("n", Math.round(v))} /></Field>
      {L.mode === "radial" ? P("r", "Radius", 2, { min: 0 }) : P("gap", "Spacing", 1, { min: 0 })}
      {L.mode === "grid" && <Field label="Columns"><NumField value={L.cols ?? Math.ceil(Math.sqrt(L.n))} step={1} min={1} precision={0} onCommit={(v) => set("cols", Math.round(v))} /></Field>}
      {P("spin", "Spin", 1)}
      <Field label="Item">
        <Seg value={c.kind} options={[{ v: "shape", l: "Shape" }, { v: "image", l: "Image" }, { v: "text", l: "Text" }]} onChange={(v) => set("child/kind", v)} />
      </Field>
      {c.kind === "shape" && (
        <Field label="Item shape">
          <Seg value={c.shape ?? "ellipse"} options={[{ v: "ellipse", l: "Circle" }, { v: "rect", l: "Square" }]} onChange={(v) => set("child/shape", v)} />
        </Field>
      )}
      {c.kind === "image" && <Field label="Item image"><AssetPicker doc={doc} value={c.src} onChange={(v) => v && set("child/src", v)} /></Field>}
      {c.kind === "text" && <Field label="Item text"><input defaultValue={c.text ?? "★"} onBlur={(e) => set("child/text", e.target.value)} aria-label="Item text" /></Field>}
      <Field label="Item size"><NumField value={c.w} step={1} min={1} onCommit={(v) => set("child/w", v)} /></Field>
      {c.kind !== "image" &&
        colors.map((col, i) => (
          <Field key={i} label={`Colour ${i + 1}`}>
            <ColorField doc={doc} value={col} onChange={(v) => v && set("child/colors", colors.map((x, j) => (j === i ? v : x)))} />
          </Field>
        ))}
      {c.kind !== "image" && (
        <div style={{ display: "flex", gap: 6 }}>
          {colors.length < 4 && <button className="btn sm" onClick={() => set("child/colors", [...colors, colors.at(-1)!])}>Add colour</button>}
          {colors.length > 1 && <button className="btn sm" onClick={() => set("child/colors", colors.slice(0, -1))}>Remove colour</button>}
        </div>
      )}
      <Field label="Reveal">
        <NumField value={L.reveal?.dur ?? 0} step={0.05} min={0} title="Seconds each item takes to pop in (0 = no reveal)" onCommit={(v) => (v > 0 ? set("reveal", { ...(L.reveal ?? {}), dur: r3(v) }) : commit([{ op: "del", path: `${L.id}/reveal` }], "No reveal"))} />
      </Field>
      <Field label="Stagger">
        <NumField value={delay?.type === "delay" ? delay.step : 0} step={0.01} min={0} precision={3} onCommit={(v) => setFx(delay?.id ?? "lag", { type: "delay", step: r3(v) })} />
      </Field>
      <Field label="Drift">
        <NumField value={noise?.type === "noise" ? noise.amp[0] : 0} step={1} min={0} title="Organic noise movement (px)" onCommit={(v) => (v > 0 ? setFx(noise?.id ?? "drift", { type: "noise", amp: [v, v, v * 2], freq: noise?.type === "noise" ? noise.freq : 0.4 }) : noise && commit([{ op: "del", path: `${L.id}/fx/${noise.id}` }], "No drift"))} />
      </Field>
      {pro && L.mode === "radial" && (
        <Field label="Orient">
          <Seg value={L.orient ? "out" : "up"} options={[{ v: "up", l: "Upright" }, { v: "out", l: "Point out" }]} onChange={(v) => set("orient", v === "out")} />
        </Field>
      )}
      {pro && (
        <Field label="Face camera">
          <Seg value={L.billboard === false ? "no" : "yes"} options={[{ v: "yes", l: "Yes" }, { v: "no", l: "No" }]} onChange={(v) => set("billboard", v === "yes")} />
        </Field>
      )}
    </Section>
  );
}

/* ------------------------------- comp -------------------------------- */
const SIZES = [
  { v: "16:9", l: "16:9", w: 1920, h: 1080 },
  { v: "9:16", l: "9:16", w: 1080, h: 1920 },
  { v: "1:1", l: "1:1", w: 1080, h: 1080 },
  { v: "4:5", l: "4:5", w: 1080, h: 1350 },
];
function CompInspector({ doc }: { doc: Doc }) {
  const [newColor, setNewColor] = useState("");
  const size = SIZES.find((s) => s.w === doc.comp.w && s.h === doc.comp.h)?.v ?? "custom";
  const set = (path: string, v: unknown, intent: string) => commit([{ op: "set", path, value: v }], intent);
  return (
    <div className="insp" data-testid="comp-inspector">
      <div className="insp-head">
        <span className="tbadge"><Icon name="frame" sm /></span>
        <b>Composition</b>
      </div>
      <div className="hint" style={{ marginTop: -8 }}>Nothing selected — these settings apply to the whole video.</div>
      <Section title="Format">
        <Field label="Aspect">
          <Seg value={size as "16:9"} options={SIZES.map((s) => ({ v: s.v as "16:9", l: s.l }))} onChange={(v) => {
            const s = SIZES.find((x) => x.v === v)!;
            commit([{ op: "set", path: "comp/w", value: s.w }, { op: "set", path: "comp/h", value: s.h }], `Aspect ${v}`);
          }} />
        </Field>
        <Field label="Duration">
          <NumField value={doc.comp.dur} step={0.5} min={0.5} max={600} onCommit={(v) => set("comp/dur", r3(v), `Duration ${v}s`)} />
        </Field>
        <Field label="Frame rate">
          <select value={doc.comp.fps} onChange={(e) => set("comp/fps", Number(e.target.value), `${e.target.value} fps`)} aria-label="Frame rate">
            {[24, 25, 30, 50, 60].map((f) => <option key={f}>{f}</option>)}
          </select>
        </Field>
        <Field label="Background"><ColorField doc={doc} value={doc.comp.bg} onChange={(v) => v && set("comp/bg", v, "Background colour")} /></Field>
      </Section>
      <Section title="Brand">
        <Field label="Font">
          <select value={doc.brand.font} onChange={(e) => set("brand/font", e.target.value, `Brand font ${e.target.value}`)} aria-label="Brand font">
            {FONT_NAMES.map((f) => <option key={f} value={f}>{f.replace(" Variable", "")}</option>)}
          </select>
        </Field>
        {Object.entries(doc.brand.colors).map(([k, c]) => (
          <div className="prow nokey" key={k}>
            <span />
            <label className="mono">${k}</label>
            <div className="vals" style={{ alignItems: "center", gap: 8 }}>
              <label className="swatch" style={{ background: c, flex: "none" }}>
                <input type="color" value={c} aria-label={`Brand colour ${k}`} onChange={(e) => set(`brand/colors/${k}`, e.target.value.toLowerCase(), `Brand ${k} → ${e.target.value}`)} />
              </label>
              <span className="mono faint" style={{ fontSize: 11 }}>{c}</span>
            </div>
          </div>
        ))}
        <div style={{ display: "flex", gap: 6 }}>
          <input placeholder="new colour name" value={newColor} onChange={(e) => setNewColor(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} style={{ flex: 1 }} aria-label="New brand colour name" />
          <button className="btn sm" disabled={!/^[a-z]/.test(newColor) || newColor in doc.brand.colors} onClick={() => { set(`brand/colors/${newColor}`, "#ffffff", `Brand colour ${newColor}`); setNewColor(""); }}>Add</button>
        </div>
        <div className="hint">Layers use brand colours by name ($accent), so changing one here re-themes the whole video.</div>
      </Section>
    </div>
  );
}

export function Inspector() {
  usePlayheadTick();
  const doc = useDisplayDoc();
  const selection = useStore((s) => s.selection);
  const mode = useStore((s) => s.mode);
  const L = selection.length === 1 ? doc.layers.find((l) => l.id === selection[0]) : undefined;
  if (selection.length > 1)
    return (
      <div className="insp">
        <b>{selection.length} layers selected</b>
        <div className="hint">Drag in the viewport to move them together, or use the timeline to retime.</div>
        <button className="btn sm danger" onClick={() => commit(deleteOps(doc, selection), `Deleted ${selection.length} layers`) && useStore.getState().select([])}>Delete all</button>
      </div>
    );
  if (!L) return <CompInspector doc={doc} />;
  return <LayerInspector key={L.id} doc={doc} L={L as Layer} pro={mode === "pro"} />;
}
export type { CameraLayer };

/* ------------------------ effect controls (AE) ------------------------ */
const SURFACE = new Set(["shape", "image", "html", "device"]);
function EffectControls({ doc, L, P, set }: { doc: Doc; L: Layer; P: (ch: string, label: string, step?: number, extra?: Partial<{ min: number; max: number; precision: number }>) => ReactNode; set: (k: string, v: unknown, intent?: string) => void }) {
  const id = L.id;
  const surf = L as Layer & { shadow?: object; glass?: object };
  const toggle = (k: "shadow" | "glass", on: boolean, value: object) => (on ? set(k, value, `${id}: ${k} on`) : commit([{ op: "del", path: `${id}/${k}` }], `${id}: ${k} off`));
  return (
    <Section title="Effects">
      {P("blur", "Gaussian blur", 0.5, { min: 0 })}
      {doc.comp.motionBlur && (
        <Field label="Motion blur">
          <Seg value={L.motionBlur === false ? "off" : "on"} options={[{ v: "on", l: "On" }, { v: "off", l: "Off" }]} onChange={(v) => set("motionBlur", v === "on", `${id}: motion blur ${v}`)} />
        </Field>
      )}
      {SURFACE.has(L.type) && (
        <>
          <Field label="Drop shadow">
            <Seg value={surf.shadow ? "on" : "off"} options={[{ v: "off", l: "Off" }, { v: "on", l: "On" }]} onChange={(v) => toggle("shadow", v === "on", { x: 0, y: -24, blur: 40, color: "#000000", opacity: 0.35 })} />
          </Field>
          {surf.shadow && (
            <>
              {P("shadow.opacity", "Shadow opacity", 0.01, { min: 0, max: 1 })}
              {P("shadow.blur", "Shadow softness", 1, { min: 0 })}
              {P("shadow.y", "Shadow distance", 1)}
            </>
          )}
          {L.type !== "device" && (
            <Field label="Frosted glass">
              <Seg value={surf.glass ? "on" : "off"} options={[{ v: "off", l: "Off" }, { v: "on", l: "On" }]} onChange={(v) => toggle("glass", v === "on", { blur: 28, tint: "#ffffff", amount: 0.18, rim: 0.5 })} />
            </Field>
          )}
          {surf.glass && (
            <>
              {P("glass.blur", "Backdrop blur", 1, { min: 0 })}
              {P("glass.amount", "Tint", 0.01, { min: 0, max: 1 })}
            </>
          )}
        </>
      )}
      <div className="hint">Motion blur needs the comp switch (timeline bar). Blur, shadow and glass are keyable.</div>
    </Section>
  );
}
