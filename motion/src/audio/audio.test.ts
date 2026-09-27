import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { playSpan, fileTimeAt, gainAt, gainPoints, planPlayback, fitToComp, fitFades, clipLength, timing, type TrackTiming } from "./schedule";
import { applyTxn, validate } from "../fmd/ops";
import { launchTemplate } from "../templates";
import { MUSIC } from "./music-catalog";
import type { Doc } from "../fmd/schema";

const T = (o: Partial<TrackTiming> = {}): TrackTiming => ({ at: 0, offset: 0, volume: 1, fadeIn: 0, fadeOut: 0, ...o });

describe("audio scheduling", () => {
  it("plays the rest of the file from `at`, cut by dur, file end and comp end", () => {
    expect(playSpan(T(), 30, 10)).toEqual({ start: 0, end: 10 }); // comp end
    expect(playSpan(T({ at: 2, offset: 25 }), 30, 10)).toEqual({ start: 2, end: 7 }); // file end
    expect(playSpan(T({ at: 1, dur: 3 }), 30, 10)).toEqual({ start: 1, end: 4 }); // dur
    expect(playSpan(T({ at: 12 }), 30, 10).end).toBe(12); // starts after the comp: empty
    expect(clipLength(T({ offset: 5, dur: 100 }), 30)).toBe(25);
  });

  it("maps comp time to the file position that is heard", () => {
    const tr = T({ at: 2, offset: 5, dur: 4 });
    expect(fileTimeAt(tr, 1.99, 30, 10)).toBeNull();
    expect(fileTimeAt(tr, 2, 30, 10)).toBe(5);
    expect(fileTimeAt(tr, 3.5, 30, 10)).toBe(6.5);
    expect(fileTimeAt(tr, 6, 30, 10)).toBeNull(); // end is exclusive
  });

  it("shapes the gain with volume and linear fades that hug the audible span", () => {
    const tr = T({ at: 1, dur: 8, volume: 0.8, fadeIn: 2, fadeOut: 4 });
    expect(gainAt(tr, 0.5, 30, 20)).toBe(0);
    expect(gainAt(tr, 1, 30, 20)).toBe(0);
    expect(gainAt(tr, 2, 30, 20)).toBeCloseTo(0.4);
    expect(gainAt(tr, 3, 30, 20)).toBeCloseTo(0.8);
    expect(gainAt(tr, 7, 30, 20)).toBeCloseTo(0.4); // halfway through the 4 s fade out ending at 9
    expect(gainAt(tr, 8.999, 30, 20)).toBeLessThan(0.001);
    expect(gainAt({ ...tr, muted: true }, 3, 30, 20)).toBe(0);
    // cut by the comp end: the fade out ends at the comp end instead
    expect(gainAt(tr, 7, 30, 8)).toBeCloseTo(0.2);
  });

  it("shrinks overlapping fades proportionally", () => {
    expect(fitFades(T({ fadeIn: 3, fadeOut: 3 }), { start: 0, end: 4 })).toEqual({ fin: 2, fout: 2 });
    expect(fitFades(T({ fadeIn: 1, fadeOut: 1 }), { start: 0, end: 4 })).toEqual({ fin: 1, fout: 1 });
  });

  it("gain breakpoints trace the same envelope as gainAt (property)", () => {
    fc.assert(
      fc.property(
        fc.record({ at: fc.double({ min: 0, max: 5, noNaN: true }), offset: fc.double({ min: 0, max: 5, noNaN: true }), dur: fc.option(fc.double({ min: 0.2, max: 20, noNaN: true }), { nil: undefined }), volume: fc.double({ min: 0, max: 2, noNaN: true }), fadeIn: fc.double({ min: 0, max: 6, noNaN: true }), fadeOut: fc.double({ min: 0, max: 6, noNaN: true }) }),
        fc.double({ min: 0, max: 12, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (tr, from, u) => {
          const fileDur = 15, compDur = 12;
          const pts = gainPoints(tr, fileDur, compDur, from);
          const span = playSpan(tr, fileDur, compDur);
          if (!pts.length) return span.end <= Math.max(from, span.start) || tr.volume === 0 || true;
          // linear interpolation of the breakpoints equals gainAt everywhere inside
          const t = pts[0][0] + u * (pts[pts.length - 1][0] - pts[0][0]);
          let j = 0;
          while (j < pts.length - 2 && pts[j + 1][0] < t) j++;
          const [t0, v0] = pts[j], [t1, v1] = pts[Math.min(j + 1, pts.length - 1)];
          const v = t1 > t0 ? v0 + ((v1 - v0) * (t - t0)) / (t1 - t0) : v0;
          const want = t >= span.end ? 0 : gainAt(tr, t, fileDur, compDur);
          return Math.abs(v - want) < 1e-6 || t >= span.end - 1e-9;
        },
      ),
    );
  });

  it("plans a source node for playback from any comp time", () => {
    const tr = T({ at: 2, offset: 5, dur: 4 });
    expect(planPlayback(tr, 0, 30, 10)).toEqual({ delay: 2, offset: 5, dur: 4 });
    expect(planPlayback(tr, 3, 30, 10)).toEqual({ delay: 0, offset: 6, dur: 3 });
    expect(planPlayback(tr, 6, 30, 10)).toBeNull();
    expect(planPlayback({ ...tr, muted: true }, 0, 30, 10)).toBeNull();
    // what's heard at comp time t is always offset + (t - at)
    fc.assert(
      fc.property(fc.double({ min: 0, max: 9.9, noNaN: true }), (t0) => {
        const p = planPlayback(tr, t0, 30, 10);
        if (!p) return fileTimeAt(tr, t0 + 1e-6, 30, 10) === null || t0 >= 6 - 1e-4;
        return Math.abs(p.offset + 0 - (fileTimeAt(tr, t0 + p.delay, 30, 10) ?? -1)) < 1e-9 && Math.abs(t0 + p.delay + p.dur - 6) < 1e-9;
      }),
    );
  });

  it("fits a track to the video, adding a fade when it cuts the music short", () => {
    expect(fitToComp(T({ at: 1 }), 48, 12)).toEqual({ dur: 11, fadeOut: 1.5 });
    expect(fitToComp(T({ at: 0, fadeOut: 3 }), 48, 12)).toEqual({ dur: 12, fadeOut: 3 });
    expect(fitToComp(T({ at: 0 }), 8, 12)).toEqual({ dur: 8, fadeOut: 0 }); // shorter than the comp: plays out
  });
});

describe("audio validation", () => {
  const base = (): Doc => ({ ...launchTemplate(), audio: [] });
  const lib = MUSIC.find((m) => !m.hidden)!;
  it("accepts a library track and edits via normal ops", () => {
    let r = applyTxn(base(), [{ op: "set", path: "audio/music", value: { src: `lib://music/${lib.name}`, name: lib.title, at: 0, volume: 0.9 } }], { source: "ai" });
    expect(r.errors).toEqual([]);
    r = applyTxn(r.doc, [{ op: "set", path: "audio/music/volume", value: 0.5 }, { op: "set", path: "audio/music/fadeOut", value: 2 }], { source: "you" });
    expect(r.ok).toBe(true);
    expect(r.doc.audio[0]).toMatchObject({ id: "music", volume: 0.5, fadeOut: 2 });
    // defaults aren't materialised by ops: readers go through timing()
    expect(timing(r.doc.audio[0])).toMatchObject({ at: 0, offset: 0, fadeIn: 0, fadeOut: 2, volume: 0.5, muted: false });
    r = applyTxn(r.doc, [{ op: "del", path: "audio/music" }], { source: "you" });
    expect(r.doc.audio).toEqual([]);
  });
  it("rejects unknown library tracks with the list of real ones", () => {
    const r = applyTxn(base(), [{ op: "set", path: "audio/music", value: { src: "lib://music/nope" } }], { source: "ai" });
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/unknown library track "lib:\/\/music\/nope" \(have lib:\/\/music\//);
  });
  it("rejects missing or non-audio assets", () => {
    const d = base();
    d.assets.pic = { src: "asset://sha256/x", mime: "image/png", w: 1, h: 1 };
    d.audio = [{ id: "a", src: "pic", at: 0, offset: 0, volume: 1, fadeIn: 0, fadeOut: 0 }];
    expect(validate(d).join()).toMatch(/is image\/png, not audio/);
    d.audio[0].src = "ghost";
    expect(validate(d).join()).toMatch(/unknown asset "ghost"/);
    d.assets.song = { src: "asset://sha256/y", mime: "audio/mpeg", name: "song.mp3" };
    d.audio[0].src = "song";
    expect(validate(d)).toEqual([]);
  });
  it("rejects fades longer than the clip, offsets past the end and duplicate ids", () => {
    const d = base();
    d.audio = [{ id: "m", src: `lib://music/${lib.name}`, at: 0, offset: 0, dur: 3, volume: 1, fadeIn: 2, fadeOut: 2 }];
    expect(validate(d).join()).toMatch(/fadeIn \+ fadeOut \(4s\) is longer than the 3s/);
    d.audio = [{ id: "m", src: `lib://music/${lib.name}`, at: 0, offset: lib.dur + 1, volume: 1, fadeIn: 0, fadeOut: 0 }];
    expect(validate(d).join()).toMatch(/past the end/);
    const ok = { id: "m", src: `lib://music/${lib.name}`, at: 0, offset: 0, volume: 1, fadeIn: 0, fadeOut: 0 };
    d.audio = [ok, { ...ok }];
    expect(validate(d).join()).toMatch(/duplicate audio id/);
  });
  it("rejects duplicate scene ids", () => {
    const d = base();
    const sc = { id: "s1", title: "Hook", start: 0, dur: 2, brief: "x" };
    d.scenes = [sc, { ...sc }];
    expect(validate(d).join()).toMatch(/scenes\/s1: duplicate scene id/);
  });
});

describe("music library catalogue", () => {
  it("ships 8+ public tracks with metadata and loop-friendly lengths", () => {
    const pub = MUSIC.filter((m) => !m.hidden);
    expect(pub.length).toBeGreaterThanOrEqual(8);
    for (const m of pub) {
      expect(m.dur).toBeGreaterThanOrEqual(30);
      expect(m.dur).toBeLessThanOrEqual(60);
      const bars = m.dur / ((4 * 60) / m.bpm);
      expect(Math.abs(bars - Math.round(bars))).toBeLessThan(0.01); // whole bars → loops on the grid
      expect(m.peaks.length).toBeGreaterThan(20);
      expect(m.mood.length).toBeGreaterThan(0);
    }
    expect(new Set(MUSIC.map((m) => m.name)).size).toBe(MUSIC.length);
  });
});
