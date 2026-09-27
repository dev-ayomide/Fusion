import type { Op } from "../fmd/ops";

/** Keep only things shaped like ops (models sometimes emit strings, nulls or nested arrays). */
export function sanitizeOps(raw: unknown): Op[] {
  if (!Array.isArray(raw)) return [];
  return raw.flat().filter((o): o is Op => !!o && typeof o === "object" && typeof (o as { op?: unknown }).op === "string");
}

export interface RepairResult {
  ops: Op[];
  /** how many rejected ops the model replaced / dropped, and how many are still invalid */
  fixed: number;
  dropped: number;
  remaining: number;
}

/**
 * One repair round-trip: validate the ops, and if any are rejected send the compact validator
 * messages back to the model and splice in its corrected replacements. `check` returns an error (or
 * null) per op; `ask` sends the repair request and returns the parsed JSON reply.
 */
export async function repairOps(ops: Op[], check: (ops: Op[]) => (string | null)[], ask: (request: string) => Promise<unknown>): Promise<RepairResult> {
  const errs = check(ops);
  const bad = errs.map((e, i) => (e ? i : -1)).filter((i) => i >= 0);
  if (!bad.length) return { ops, fixed: 0, dropped: 0, remaining: 0 };
  const request = `REJECTED OPS (${bad.length} of ${ops.length}):\n${bad
    .slice(0, 40)
    .map((i) => `#${i} ${JSON.stringify(ops[i]).slice(0, 1500)}\n   error: ${errs[i]}`)
    .join("\n")}`;
  let reply: unknown;
  try {
    reply = await ask(request);
  } catch {
    return { ops, fixed: 0, dropped: 0, remaining: bad.length };
  }
  const fixes = Array.isArray((reply as { fixes?: unknown })?.fixes) ? (reply as { fixes: unknown[] }).fixes : Array.isArray(reply) ? reply : [];
  const next: (Op | null)[] = [...ops];
  let fixed = 0;
  let dropped = 0;
  for (const f of fixes) {
    if (!f || typeof f !== "object") continue;
    const i = Number((f as { i?: unknown }).i);
    if (!bad.includes(i)) continue;
    const op = (f as { op?: unknown }).op;
    if (op === null) {
      next[i] = null;
      dropped++;
    } else if (op && typeof op === "object" && typeof (op as { op?: unknown }).op === "string") {
      next[i] = op as Op;
      fixed++;
    }
  }
  const out = next.filter((o): o is Op => !!o);
  const remaining = check(out).filter(Boolean).length;
  return { ops: out, fixed, dropped, remaining };
}
