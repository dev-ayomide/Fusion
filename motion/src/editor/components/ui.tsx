import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Doc } from "../../fmd/schema";

/* ------------------------------ icons ------------------------------ */
const P: Record<string, ReactNode> = {
  select: <path d="M5 3l6 16 2-7 7-2z" />,
  text: <path d="M5 6V4h14v2M12 4v16M9 20h6" />,
  rect: <rect x="4" y="5" width="16" height="14" rx="3" />,
  ellipse: <circle cx="12" cy="12" r="8" />,
  image: <><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="9" cy="10" r="1.6" /><path d="M21 16l-5-5-8 8" /></>,
  device: <><rect x="7" y="2.5" width="10" height="19" rx="2.5" /><path d="M10.5 5h3" /></>,
  cloner: <><circle cx="6" cy="6" r="2" /><circle cx="18" cy="6" r="2" /><circle cx="6" cy="18" r="2" /><circle cx="18" cy="18" r="2" /><circle cx="12" cy="12" r="2" /></>,
  camera: <><rect x="3" y="7" width="13" height="10" rx="2" /><path d="M16 11l5-3v8l-5-3" /></>,
  gradient: <><rect x="3" y="3" width="18" height="18" rx="3" /><path d="M3 15l12-12M9 21L21 9" /></>,
  group: <><rect x="3" y="7" width="12" height="12" rx="2" /><path d="M9 3h10a2 2 0 012 2v10" /></>,
  sparkle: <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />,
  play: <path d="M8 5l11 7-11 7z" fill="currentColor" />,
  pause: <><rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" /><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" /></>,
  undo: <path d="M9 14L4 9l5-5M4 9h11a5 5 0 010 10h-3" />,
  redo: <path d="M15 14l5-5-5-5M20 9H9a5 5 0 000 10h3" />,
  chevron: <path d="M9 6l6 6-6 6" />,
  chevdown: <path d="M6 9l6 6 6-6" />,
  eye: <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>,
  eyeoff: <><path d="M3 3l18 18M10.6 5.1A10 10 0 0122 12s-1.2 2.4-3.6 4.4M6.1 6.1C3.5 8 2 12 2 12s3.5 7 10 7c1.6 0 3-.4 4.3-1" /></>,
  trash: <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />,
  plus: <path d="M12 5v14M5 12h14" />,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  export: <path d="M12 3v12M7 8l5-5 5 5M5 21h14" />,
  help: <><circle cx="12" cy="12" r="9" /><path d="M9.5 9a2.5 2.5 0 015 .5c0 1.5-2.5 2-2.5 3.5M12 17h.01" /></>,
  split: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M12 4v16" /></>,
  frame: <rect x="3" y="5" width="18" height="14" rx="2" />,
  diamond: <path d="M12 3l9 9-9 9-9-9z" />,
  copy: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M4 16V6a2 2 0 012-2h10" /></>,
  upload: <path d="M12 16V4M7 9l5-5 5 5M4 20h16" />,
  back: <path d="M15 5l-7 7 7 7" />,
  zoomin: <><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3M8 11h6M11 8v6" /></>,
  zoomout: <><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3M8 11h6" /></>,
  fit: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />,
  loop: <path d="M17 2l4 4-4 4M3 11V9a3 3 0 013-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 01-3 3H3" />,
  graph: <path d="M3 20h18M4 17c4 0 5-10 8-10s4 10 8 10" />,
  wand: <path d="M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8L19 13M17.8 6.2L19 5M3 21l9-9M12.2 6.2L11 5" />,
};
export function Icon({ name, sm, className }: { name: keyof typeof P | string; sm?: boolean; className?: string }) {
  return (
    <svg className={`icon${sm ? " sm" : ""}${className ? " " + className : ""}`} viewBox="0 0 24 24" aria-hidden="true">
      {P[name] ?? P.frame}
    </svg>
  );
}

/* ---------------------------- number field --------------------------- */
/**
 * Number input with drag-to-scrub on its label (like AE / Figma). Emits `onScrub` continuously
 * for live preview and `onCommit` once on release or Enter, so one drag = one undo step.
 */
export function NumField({ value, onCommit, onScrub, onScrubEnd, step = 1, min, max, axis, className, title, precision = 2, id }: {
  value: number;
  onCommit: (v: number) => void;
  onScrub?: (v: number) => void;
  onScrubEnd?: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  axis?: string;
  className?: string;
  title?: string;
  precision?: number;
  id?: string;
}) {
  const fmt = (v: number) => String(Math.round(v * 10 ** precision) / 10 ** precision);
  const [text, setText] = useState(fmt(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(fmt(value));
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  const clamp = (v: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v));
  const startScrub = (e: React.PointerEvent) => {
    e.preventDefault();
    const x0 = e.clientX;
    const v0 = value;
    let v = v0;
    let moved = false;
    const move = (ev: PointerEvent) => {
      const mult = ev.shiftKey ? 10 : ev.altKey ? 0.1 : 1;
      moved = true;
      v = clamp(v0 + Math.round((ev.clientX - x0) / 2) * step * mult);
      setText(fmt(v));
      onScrub?.(v);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (moved) (onScrubEnd ?? onCommit)(v);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const commit = () => {
    const v = Number(text);
    if (Number.isFinite(v) && v !== value) onCommit(clamp(v));
    else setText(fmt(value));
  };
  return (
    <div className={`num ${className ?? ""}`} title={title}>
      <span className="ax" onPointerDown={startScrub} title="Drag to scrub (Shift ×10, Alt ×0.1)">{axis ?? "↔"}</span>
      <input
        id={id}
        aria-label={title ?? axis}
        value={text}
        inputMode="decimal"
        onFocus={(e) => {
          focused.current = true;
          e.target.select();
        }}
        onBlur={() => {
          focused.current = false;
          commit();
        }}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") {
            setText(fmt(value));
            (e.target as HTMLInputElement).blur();
          }
          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            const v = clamp(value + (e.key === "ArrowUp" ? 1 : -1) * step * (e.shiftKey ? 10 : 1));
            onCommit(v);
          }
        }}
      />
    </div>
  );
}

/* ---------------------------- colour field --------------------------- */
export function ColorField({ doc, value, onChange, allowNone }: { doc: Doc; value: string | undefined; onChange: (v: string | undefined) => void; allowNone?: boolean }) {
  const resolved = value?.startsWith("$") ? doc.brand.colors[value.slice(1)] : value;
  const custom = value && !value.startsWith("$");
  return (
    <div className="color">
      {Object.entries(doc.brand.colors).map(([k, c]) => (
        <button key={k} className={`swatch${value === "$" + k ? " sel" : ""}`} style={{ background: c }} title={`Brand: ${k} (${c})`} aria-label={`Brand color ${k}`} onClick={() => onChange("$" + k)} />
      ))}
      <label className={`swatch${custom ? " sel" : ""}`} title="Custom colour" style={{ background: custom ? resolved : "conic-gradient(#f55,#fd5,#5f8,#5cf,#85f,#f55)" }}>
        <input type="color" value={resolved ?? "#ffffff"} onChange={(e) => onChange(e.target.value.toLowerCase())} aria-label="Custom colour" />
      </label>
      {allowNone && (
        <button className="chip" onClick={() => onChange(undefined)}>
          None
        </button>
      )}
      <span className="mono faint" style={{ fontSize: 11 }}>{value ?? "none"}</span>
    </div>
  );
}

export function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: { v: T; l: string }[]; onChange: (v: T) => void; label?: string }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.v} aria-pressed={value === o.v} onClick={() => onChange(o.v)}>
          {o.l}
        </button>
      ))}
    </div>
  );
}

export const TYPE_ICON: Record<string, string> = { text: "text", shape: "rect", image: "image", device: "device", cloner: "cloner", camera: "camera", gradient: "gradient", group: "group" };
