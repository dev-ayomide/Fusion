import { useState } from "react";
import { CATALOG } from "../../fmd/catalog";
import { Icon } from "./ui";

/** Plain-words description of each one-click animation, shown under the choices. */
export const ANIM_DESC: Record<string, string> = {
  fadeIn: "Gently fades in.",
  rise: "Floats up into place.",
  drop: "Drops in from above and lands with a little bounce.",
  slideIn: "Slides in from the side.",
  popIn: "Grows from nothing with a springy pop.",
  settle: "Starts large and shrinks down into place.",
  spinIn: "Spins into place.",
  flipIn: "Flips around in 3D, like turning a card.",
  typeUp: "Letters slide up one at a time.",
  cascade: "Letters tumble in one after another.",
  bounceIn: "Letters pop in one by one with a bounce.",
  typewriter: "Appears letter by letter, like typing.",
  float: "Bobs gently up and down.",
  pulse: "Softly grows and shrinks, like breathing.",
  wiggle: "Jiggles playfully.",
  sway: "Rocks side to side in 3D.",
  spin: "Keeps turning round.",
  fadeOut: "Fades away at the end.",
  sink: "Drops down and away at the end.",
  dolly: "The camera moves in closer.",
  truck: "The camera glides sideways.",
  orbit: "The camera circles around.",
  shake: "A gentle handheld wobble.",
};

const LETTERS = new Set(["typeUp", "cascade", "bounceIn", "typewriter"]);

/** A tiny looping demo of the animation: letters for per-letter text effects, a tile for the rest. */
function Demo({ use }: { use: string }) {
  if (LETTERS.has(use))
    return (
      <span className={`ad-o ad-txt k-${use}`}>
        {["A", "b", "c"].map((c, i) => (
          <span key={i} style={{ ["--i" as string]: i }}>{c}</span>
        ))}
      </span>
    );
  return <span className={`ad-o ad-sq k-${use}`} />;
}

/**
 * One row of animation choices (entrance, while on screen, exit or camera). Every option shows a
 * little demo that plays on hover, and the hovered (or chosen) one is described in words below.
 */
export function AnimChoices({ title, uses, current, onPick, testid }: { title: string; uses: string[]; current: string | null; onPick: (use: string | null) => void; testid?: string }) {
  const [hover, setHover] = useState<string | null>(null);
  const shown = hover ?? current;
  return (
    <div className="anim-row" data-testid={testid}>
      <div className="anim-row-h">
        <span>{title}</span>
        {current && (
          <button className="anim-none" onClick={() => onPick(null)} aria-label={`No ${title.toLowerCase()} animation`}>
            <Icon name="x" sm /> None
          </button>
        )}
      </div>
      <div className="anim-grid" onPointerLeave={() => setHover(null)}>
        {uses.map((u) => (
          <button
            key={u}
            aria-pressed={current === u}
            onClick={() => onPick(u)}
            onPointerEnter={() => setHover(u)}
            onFocus={() => setHover(u)}
            onBlur={() => setHover(null)}
            className={hover === u ? "hov" : undefined}
          >
            <span className="anim-demo"><Demo use={u} /></span>
            <span className="anim-name">{CATALOG[u]?.label.replace(" (3D)", "") ?? u}</span>
          </button>
        ))}
      </div>
      <div className="anim-desc">{shown ? ANIM_DESC[shown] ?? CATALOG[shown]?.desc : "None yet. Hover a choice to see it move, click to use it."}</div>
    </div>
  );
}
