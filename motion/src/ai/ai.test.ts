import { describe, it, expect, vi } from "vitest";
import { normalizeScenes, fitScenes, planEditOps, prefixSceneOps, clearSceneOps, createdIds, sceneTotal } from "./plan";
import { parseLooseJson, closeTruncated, callModel, ModelError, type ModelConfig } from "./llm";
import { repairOps, sanitizeOps } from "./repair";
import { applyTxn, validate, type Op } from "../fmd/ops";
import { blankTemplate } from "../templates";
import type { Doc } from "../fmd/schema";

const withScenes = (): Doc => {
  const d = blankTemplate();
  d.scenes = normalizeScenes([
    { title: "Night", dur: 4, brief: "aurora" },
    { title: "Drop", dur: 4, brief: "names" },
    { title: "Sun", dur: 4, brief: "machine" },
  ]);
  d.comp.dur = 12;
  return d;
};

describe("plan parsing", () => {
  it("accepts loose shapes, fixes ids, lays scenes end to end", () => {
    const s = normalizeScenes({
      scenes: [
        { name: "Open", duration: "3.5s", description: "Logo reveal" },
        { id: "bad id!", title: "Middle", seconds: 4, visual: "cards" },
        { id: "s1", title: "Dup", dur: 2, brief: "x" },
        "garbage",
      ],
    });
    expect(s.map((x) => x.id)).toEqual(["s1", "s2", "s3"]);
    expect(s.map((x) => x.start)).toEqual([0, 3.5, 7.5]);
    expect(s[0]).toMatchObject({ title: "Open", dur: 3.5, brief: "Logo reveal", status: "planned" });
    expect(s[1].brief).toBe("cards");
  });

  it("clamps silly durations and scales to a requested length", () => {
    const s = normalizeScenes([{ title: "a", dur: 0 }, { title: "b", dur: 999 }]);
    expect(s[0].dur).toBe(0.5);
    expect(s[1].dur).toBe(60);
    const fit = normalizeScenes([{ title: "a", dur: 3 }, { title: "b", dur: 3 }, { title: "c", dur: 4 }], { length: 20 });
    expect(sceneTotal(fit)).toBe(20);
    expect(fitScenes([{ dur: 1 }, { dur: 1 }], 5).map((x) => x.dur)).toEqual([2.5, 2.5]);
  });

  it("a plan of scenes is valid in the document", () => {
    const d = withScenes();
    const r = applyTxn(blankTemplate(), planEditOps(blankTemplate(), d.scenes), { source: "ai" });
    expect(r.ok).toBe(true);
    expect(r.doc.scenes).toHaveLength(3);
    expect(r.doc.comp.dur).toBe(12);
    expect(validate(r.doc)).toEqual([]);
  });
});

describe("scene id prefixing", () => {
  it("prefixes new layer ids and rewrites every reference", () => {
    const d = withScenes();
    const ops: Op[] = [
      { op: "add", id: "rig", layer: { type: "group", in: 4, out: 8 } },
      { op: "add", id: "coin", layer: { type: "mesh", geom: "coin", material: "gold", size: 100, parent: "rig" } },
      { op: "set", path: "title", value: { type: "text", text: "Hi", size: 80, in: 4.5 } },
      { op: "key", path: "coin/keys/rot.y", keys: [[0, 0], [2, 360]] },
      { op: "set", path: "title/size", value: 90 },
      { op: "ord", id: "title", after: "rig" },
      { op: "set", path: "shot/beh/s2-shake", value: { use: "shake", at: 4, dur: 4 } },
    ];
    expect(createdIds(d, ops)).toEqual(["rig", "coin", "title"]);
    const p = prefixSceneOps(d, ops, { sceneId: "s2", start: 4, end: 8 });
    expect(p.renamed).toEqual({ rig: "s2-rig", coin: "s2-coin", title: "s2-title" });
    const out = p.ops as Op[];
    expect(out[1]).toMatchObject({ op: "add", id: "s2-coin", layer: { parent: "s2-rig", in: 4, out: 8 } });
    expect(out[2]).toMatchObject({ path: "s2-title", value: { in: 4.5, out: 8 } });
    expect(out[3]).toMatchObject({ path: "s2-coin/keys/rot.y" });
    expect(out[4]).toMatchObject({ path: "s2-title/size" });
    expect(out[5]).toMatchObject({ id: "s2-title", after: "s2-rig" });
    // behaviours added to shared layers are namespaced and kept in the window
    expect(out[6]).toMatchObject({ path: "shot/beh/s2-shake", value: { use: "shake", at: 4, dur: 4 } });
    const r = applyTxn(d, out, { source: "ai" });
    expect(r.errors).toEqual([]);
    expect(r.doc.layers.map((l) => l.id)).toEqual(expect.arrayContaining(["s2-rig", "s2-coin", "s2-title"]));
  });

  it("namespaces and clamps camera behaviours written scene-relative", () => {
    const d = withScenes();
    const p = prefixSceneOps(d, [{ op: "set", path: "shot/beh/shake", value: { use: "shake", at: 0, amp: 9 } }], { sceneId: "s3", start: 8, end: 12 });
    expect(p.ops[0]).toEqual({ op: "set", path: "shot/beh/s3-shake", value: { use: "shake", at: 8, dur: 4, amp: 9 } });
  });

  it("keeps already-prefixed ids, shifts a moved scene, and drops ops on other scenes' layers", () => {
    const d = withScenes();
    d.layers.push({ id: "s1-sky", type: "gradient", colors: ["#000000", "#111111"], in: 0, out: 4 } as Doc["layers"][number]);
    const p = prefixSceneOps(
      d,
      [
        { op: "add", id: "s2-word", layer: { type: "text", text: "A", size: 50, in: 4, out: 6 } },
        { op: "del", path: "s1-sky" },
        { op: "set", path: "s1-sky/colors", value: ["#ffffff", "#000000"] },
      ],
      { sceneId: "s2", start: 5, end: 9, shift: 1, others: ["s1", "s3"] },
    );
    expect(p.renamed).toEqual({});
    expect(p.ops[0]).toMatchObject({ id: "s2-word", layer: { in: 5, out: 7 } });
    expect(p.ops[1]).toBeNull();
    expect(p.ops[2]).toBeNull();
    expect(p.dropped).toEqual(["s1-sky", "s1-sky/colors"]);
  });

  it("rebuild clears a scene's layers and its behaviours on shared layers", () => {
    const d = withScenes();
    d.layers.push({ id: "s2-a", type: "shape", shape: "rect", w: 10, h: 10, in: 4, out: 8 } as Doc["layers"][number]);
    const shot = d.layers.find((l) => l.id === "shot")!;
    shot.beh = [{ id: "s2-shake", use: "shake", at: 4, dur: 4 } as never];
    expect(clearSceneOps(d, "s2")).toEqual([
      { op: "del", path: "shot/beh/s2-shake" },
      { op: "del", path: "s2-a" },
    ]);
  });

  it("retimes built scenes when the plan changes, and deletes removed scenes' layers", () => {
    const d = withScenes();
    d.scenes[1].status = "done";
    d.layers.push({ id: "s2-a", type: "shape", shape: "rect", w: 10, h: 10, in: 4, out: 8 } as Doc["layers"][number]);
    d.layers.push({ id: "s3-b", type: "shape", shape: "rect", w: 10, h: 10, in: 8, out: 12 } as Doc["layers"][number]);
    // s1 grows by 2 s, s3 is removed
    const next = [{ ...d.scenes[0], dur: 6 }, d.scenes[1]];
    const r = applyTxn(d, planEditOps(d, next), { source: "you" });
    expect(r.ok).toBe(true);
    expect(r.doc.layers.find((l) => l.id === "s2-a")).toMatchObject({ in: 6, out: 10 });
    expect(r.doc.layers.some((l) => l.id === "s3-b")).toBe(false);
    expect(r.doc.scenes.map((s) => [s.id, s.start])).toEqual([
      ["s1", 0],
      ["s2", 6],
    ]);
    expect(r.doc.comp.dur).toBe(10);
  });
});

describe("robust JSON", () => {
  it("strips fences and prose, removes trailing commas", () => {
    expect(parseLooseJson('Sure!\n```json\n{"a":[1,2,],}\n```')).toEqual({ a: [1, 2] });
    expect(parseLooseJson('Here you go: {"message":"hi","ops":[]} hope it helps')).toEqual({ message: "hi", ops: [] });
  });
  it("salvages every complete op from a truncated reply", () => {
    const cut = '{"message":"built","ops":[{"op":"set","path":"a","value":1},{"op":"set","path":"b","value":[1,2]},{"op":"add","id":"c","layer":{"type":"te';
    const j = parseLooseJson(cut) as { ops: unknown[] };
    expect(j.ops.slice(0, 2)).toEqual([
      { op: "set", path: "a", value: 1 },
      { op: "set", path: "b", value: [1, 2] },
    ]);
    expect(closeTruncated('{"a":')).toBeNull();
    expect(() => parseLooseJson("no json here")).toThrow();
  });
  it("sanitizes op lists", () => {
    expect(sanitizeOps([{ op: "del", path: "x" }, null, "x", [{ op: "del", path: "y" }], { path: "z" }])).toEqual([
      { op: "del", path: "x" },
      { op: "del", path: "y" },
    ]);
  });
});

describe("repair loop", () => {
  const doc = withScenes();
  const check = (ops: Op[]) =>
    ops.map((op) => {
      const r = applyTxn(doc, [op], { source: "ai" });
      return r.ok ? null : r.errors[0];
    });

  it("sends the validator's messages back once and splices in the fixes", async () => {
    const ops: Op[] = [
      { op: "set", path: "bg/angle", value: 45 },
      { op: "set", path: "bg/colors", value: ["$nope", "#000000"] },
      { op: "set", path: "ghost/pos/x", value: 1 },
    ];
    const ask = vi.fn(async (req: string) => {
      expect(req).toContain("#1");
      expect(req).toContain("#2");
      expect(req).not.toContain("#0 ");
      return { fixes: [{ i: 1, op: { op: "set", path: "bg/colors", value: ["$accent", "#000000"] } }, { i: 2, op: null }] };
    });
    const r = await repairOps(ops, check, ask);
    expect(ask).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ fixed: 1, dropped: 1, remaining: 0 });
    expect(r.ops).toHaveLength(2);
    expect(check(r.ops)).toEqual([null, null]);
  });

  it("makes no call when everything is valid, and survives a failing repair call", async () => {
    const ask = vi.fn(async () => ({}));
    await repairOps([{ op: "set", path: "bg/angle", value: 10 }], check, ask);
    expect(ask).not.toHaveBeenCalled();
    const bad: Op[] = [{ op: "set", path: "ghost/x", value: 1 }];
    const r = await repairOps(bad, check, async () => {
      throw new Error("network");
    });
    expect(r).toMatchObject({ ops: bad, remaining: 1 });
  });
});

describe("Claude transport (mocked fetch)", () => {
  const cfg: ModelConfig = { id: "anthropic", label: "Claude Opus 5.5", wire: "anthropic", endpoint: "/api/anthropic/v1/messages", model: "claude-opus-5-5", maxTokens: 64000 };
  const sse = (events: object[]) => {
    const text = events.map((e) => `event: ${(e as { type: string }).type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
    const bytes = new TextEncoder().encode(text);
    // deliver in awkward chunks to exercise the SSE buffer
    return new Response(
      new ReadableStream({
        start(c) {
          for (let i = 0; i < bytes.length; i += 37) c.enqueue(bytes.slice(i, i + 37));
          c.close();
        },
      }),
      { status: 200, headers: { "content-type": "text/event-stream" } },
    );
  };

  it("sends a valid Messages API request and assembles the streamed text", async () => {
    const f = vi.fn(async (_url: string, _init: RequestInit) =>
      sse([
        { type: "message_start", message: { usage: { input_tokens: 10, cache_read_input_tokens: 4000 } } },
        { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } },
        { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "" } },
        { type: "content_block_stop", index: 0 },
        { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } },
        { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: '{"message":"ok",' } },
        { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: '"ops":[]}' } },
        { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 321 } },
        { type: "message_stop" },
      ]),
    );
    const r = await callModel(cfg, { system: "SYS", user: "hello", maxTokens: 64000, effort: "medium" }, f as unknown as typeof fetch);
    expect(r).toEqual({ text: '{"message":"ok","ops":[]}', truncated: false, usage: { in: 4010, out: 321 } });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("/api/anthropic/v1/messages");
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      model: "claude-opus-5-5",
      max_tokens: 64000,
      stream: true,
      output_config: { effort: "medium" },
      system: [{ type: "text", text: "SYS", cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: "hello" }],
    });
    // Opus 5.5: no sampling params, no disabled thinking, no key in the browser
    expect(body.temperature).toBeUndefined();
    expect(body.thinking).toBeUndefined();
    expect(JSON.stringify(init.headers)).not.toMatch(/x-api-key|authorization/i);
  });

  it("reports truncation, refusals and stream errors", async () => {
    const trunc = await callModel(cfg, { system: "", user: "" }, (async () => sse([{ type: "content_block_delta", delta: { type: "text_delta", text: "{" } }, { type: "message_delta", delta: { stop_reason: "max_tokens" } }])) as unknown as typeof fetch);
    expect(trunc.truncated).toBe(true);
    await expect(callModel(cfg, { system: "", user: "" }, (async () => sse([{ type: "message_delta", delta: { stop_reason: "refusal" } }])) as unknown as typeof fetch)).rejects.toThrow(/declined/);
    await expect(callModel(cfg, { system: "", user: "" }, (async () => new Response('{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}', { status: 401 })) as unknown as typeof fetch)).rejects.toThrow(/401.*invalid x-api-key.*motion\/\.env/);
  });

  it("retries overloads", async () => {
    let n = 0;
    const f = async () => (n++ === 0 ? new Response("overloaded", { status: 529 }) : sse([{ type: "content_block_delta", delta: { type: "text_delta", text: "{}" } }]));
    vi.useFakeTimers();
    const p = callModel(cfg, { system: "", user: "" }, f as unknown as typeof fetch);
    await vi.runAllTimersAsync();
    expect((await p).text).toBe("{}");
    vi.useRealTimers();
  });
});

describe("web pages where an API reply should be", () => {
  const ds: ModelConfig = { id: "agentrouter", label: "DeepSeek", wire: "openai", endpoint: "/api/agentrouter/chat/completions", model: "m", maxTokens: 100 };
  const claude: ModelConfig = { id: "anthropic", label: "Claude", wire: "anthropic", endpoint: "/api/anthropic/v1/messages", model: "m", maxTokens: 100 };
  const html = "<!doctype html>\n<html><body>challenge</body></html>";
  const catchErr = (p: Promise<unknown>) => p.then(() => null, (e) => e as ModelError);

  it("a 200 web page is a readable, blocked error, never 'Unexpected token <'", async () => {
    const e = await catchErr(callModel(ds, { system: "", user: "" }, (async () => new Response(html, { status: 200, headers: { "content-type": "text/html" } })) as unknown as typeof fetch));
    expect(e).toBeInstanceOf(ModelError);
    expect(e!.blocked).toBe(true);
    expect(e!.message).not.toMatch(/Unexpected token/);
    expect(e!.message).toMatch(/web page/);
    const c = await catchErr(callModel(claude, { system: "", user: "" }, (async () => new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } })) as unknown as typeof fetch));
    expect(c!.blocked).toBe(true);
  });

  it("the proxy's upstream_blocked answer is a blocked error with its message", async () => {
    const body = JSON.stringify({ error: { type: "upstream_blocked", message: "AgentRouter's firewall blocked this server and answered with a web page instead of its API." } });
    const e = await catchErr(callModel(ds, { system: "", user: "" }, (async () => new Response(body, { status: 502 })) as unknown as typeof fetch));
    expect(e!.blocked).toBe(true);
    expect(e!.message).toMatch(/DeepSeek: AgentRouter's firewall blocked this server/);
  });

  it("ordinary errors are not marked blocked", async () => {
    const e = await catchErr(callModel(ds, { system: "", user: "" }, (async () => new Response('{"error":{"message":"bad key"}}', { status: 401 })) as unknown as typeof fetch));
    expect(e!.blocked).toBe(false);
  });
});
