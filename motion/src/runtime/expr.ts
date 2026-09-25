import { fbm } from "./noise";

/**
 * Tiny expression language, interpreted from an AST (no eval).
 *   numbers, + - * / % ^, unary -, comparisons, && ||, ternary a ? b : c, parentheses
 *   functions: sin cos tan abs min max floor ceil round sqrt pow clamp lerp noise(seed,x) step smooth
 *   bound: t value base i n w h fps pi
 */
type Node =
  | { k: "num"; v: number }
  | { k: "var"; name: string }
  | { k: "un"; op: string; a: Node }
  | { k: "bin"; op: string; a: Node; b: Node }
  | { k: "tern"; c: Node; a: Node; b: Node }
  | { k: "call"; fn: string; args: Node[] };

export type ExprScope = Record<string, number>;

const FNS: Record<string, (...a: number[]) => number> = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan, abs: Math.abs, min: Math.min, max: Math.max,
  floor: Math.floor, ceil: Math.ceil, round: Math.round, sqrt: Math.sqrt, pow: Math.pow,
  clamp: (x, a, b) => Math.min(Math.max(x, a), b),
  lerp: (a, b, u) => a + (b - a) * u,
  noise: (seed, x) => fbm(seed, x),
  step: (edge, x) => (x < edge ? 0 : 1),
  smooth: (a, b, x) => {
    const u = Math.min(Math.max((x - a) / (b - a), 0), 1);
    return u * u * (3 - 2 * u);
  },
};
const VARS = new Set(["t", "value", "base", "i", "n", "w", "h", "fps", "pi"]);

export class ExprError extends Error {}

function tokenize(src: string): string[] {
  const re = /\s*(\d+\.?\d*(?:e[+-]?\d+)?|\.\d+|[A-Za-z_]\w*|&&|\|\||[<>=!]=|[-+*/%^()<>?:,!])/y;
  const out: string[] = [];
  let pos = 0;
  while (pos < src.length) {
    if (/^\s*$/.test(src.slice(pos))) break;
    re.lastIndex = pos;
    const m = re.exec(src);
    if (!m) throw new ExprError(`unexpected "${src.slice(pos).trim()[0]}" at ${pos}`);
    out.push(m[1]);
    pos = re.lastIndex;
  }
  return out;
}

export function parseExpr(src: string): Node {
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p];
  const eat = (t?: string) => {
    const v = toks[p++];
    if (t && v !== t) throw new ExprError(`expected "${t}" but found "${v ?? "end"}"`);
    return v;
  };
  const prec: Record<string, number> = { "||": 1, "&&": 2, "<": 3, ">": 3, "<=": 3, ">=": 3, "==": 3, "!=": 3, "+": 4, "-": 4, "*": 5, "/": 5, "%": 5, "^": 6 };
  function primary(): Node {
    const t = eat();
    if (t === undefined) throw new ExprError("unexpected end");
    if (t === "(") {
      const e = ternary();
      eat(")");
      return e;
    }
    if (t === "-") return { k: "un", op: "-", a: binary(5) };
    if (t === "!") return { k: "un", op: "!", a: binary(5) };
    if (/^[\d.]/.test(t)) return { k: "num", v: Number(t) };
    if (/^[A-Za-z_]/.test(t)) {
      if (peek() === "(") {
        eat("(");
        if (!FNS[t]) throw new ExprError(`unknown function ${t}()`);
        const args: Node[] = [];
        if (peek() !== ")") {
          args.push(ternary());
          while (peek() === ",") {
            eat(",");
            args.push(ternary());
          }
        }
        eat(")");
        return { k: "call", fn: t, args };
      }
      if (!VARS.has(t)) throw new ExprError(`unknown name "${t}" (use ${[...VARS].join(", ")})`);
      return { k: "var", name: t };
    }
    throw new ExprError(`unexpected "${t}"`);
  }
  function binary(min: number): Node {
    let left = primary();
    for (;;) {
      const op = peek();
      const pr = op !== undefined ? prec[op] : undefined;
      if (pr === undefined || pr < min) return left;
      eat();
      const right = binary(op === "^" ? pr : pr + 1);
      left = { k: "bin", op: op!, a: left, b: right };
    }
  }
  function ternary(): Node {
    const c = binary(1);
    if (peek() === "?") {
      eat("?");
      const a = ternary();
      eat(":");
      const b = ternary();
      return { k: "tern", c, a, b };
    }
    return c;
  }
  const n = ternary();
  if (p < toks.length) throw new ExprError(`unexpected "${toks[p]}"`);
  return n;
}

function ev(n: Node, s: ExprScope): number {
  switch (n.k) {
    case "num":
      return n.v;
    case "var":
      return n.name === "pi" ? Math.PI : s[n.name] ?? 0;
    case "un":
      return n.op === "-" ? -ev(n.a, s) : ev(n.a, s) ? 0 : 1;
    case "tern":
      return ev(n.c, s) ? ev(n.a, s) : ev(n.b, s);
    case "call":
      return FNS[n.fn](...n.args.map((a) => ev(a, s)));
    case "bin": {
      const a = ev(n.a, s), b = ev(n.b, s);
      switch (n.op) {
        case "+": return a + b;
        case "-": return a - b;
        case "*": return a * b;
        case "/": return b === 0 ? 0 : a / b;
        case "%": return b === 0 ? 0 : a % b;
        case "^": return Math.pow(a, b);
        case "<": return +(a < b);
        case ">": return +(a > b);
        case "<=": return +(a <= b);
        case ">=": return +(a >= b);
        case "==": return +(a === b);
        case "!=": return +(a !== b);
        case "&&": return a && b ? 1 : 0;
        case "||": return a || b ? 1 : 0;
      }
    }
  }
  return 0;
}

const cache = new Map<string, Node | ExprError>();
export function compileExpr(src: string): Node {
  let n = cache.get(src);
  if (!n) {
    try {
      n = parseExpr(src);
    } catch (e) {
      n = e as ExprError;
    }
    cache.set(src, n);
  }
  if (n instanceof Error) throw n;
  return n;
}

/** Evaluate; on a bad expression returns `fallback` (the frame still renders). */
export function evalExpr(src: string, scope: ExprScope, fallback: number): number {
  try {
    const v = ev(compileExpr(src), scope);
    return Number.isFinite(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

export function exprError(src: string): string | null {
  try {
    compileExpr(src);
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}
