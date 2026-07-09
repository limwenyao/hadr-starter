import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readPriorSnapshot, writeSnapshot, snapshotPath } from "../src/snapshots.js";
import type { SitrepModel } from "../src/types.js";

const NOW = new Date("2026-07-08T00:30:00Z");

function model(over: Partial<SitrepModel> = {}): SitrepModel {
  return {
    generatedAt: NOW.getTime(),
    surfaced: [],
    degradation: [],
    withdrawn: [],
    changeSummary: null,
    ...over,
  };
}

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "hadr-snap-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("snapshotPath", () => {
  it("names the file by the UTC date of `now`", () => {
    expect(snapshotPath(dir, NOW)).toBe(join(dir, "2026-07-08.json"));
    // 23:30 UTC is already the 9th in SGT, but the UTC date governs.
    expect(snapshotPath(dir, new Date("2026-07-08T23:30:00Z"))).toBe(
      join(dir, "2026-07-08.json"),
    );
  });
});

describe("writeSnapshot", () => {
  it("writes today's snapshot, creating the directory if needed", () => {
    const nested = join(dir, "data");
    writeSnapshot(nested, NOW, model());
    expect(existsSync(join(nested, "2026-07-08.json"))).toBe(true);
  });

  it("round-trips the model and pretty-prints for readable git diffs", () => {
    const m = model({ degradation: [{ feed: "ReliefWeb", reason: "HTTP 406" }] });
    writeSnapshot(dir, NOW, m);
    const raw = readFileSync(join(dir, "2026-07-08.json"), "utf8");
    expect(raw).toContain("\n  "); // indented
    expect(JSON.parse(raw)).toEqual(m);
  });

  it("overwrites an existing same-day snapshot (latest state wins)", () => {
    writeSnapshot(dir, NOW, model({ generatedAt: 1 }));
    writeSnapshot(dir, NOW, model({ generatedAt: 2 }));
    expect(JSON.parse(readFileSync(join(dir, "2026-07-08.json"), "utf8")).generatedAt).toBe(2);
  });

  it("writes atomically — no leftover temp file, final file is valid parseable JSON", () => {
    const m = model({ degradation: [{ feed: "GDACS", reason: "timeout" }] });
    writeSnapshot(dir, NOW, m);
    const names = readdirSync(dir);
    expect(names).toEqual(["2026-07-08.json"]); // no *.tmp* leftover
    const raw = readFileSync(join(dir, "2026-07-08.json"), "utf8");
    expect(raw).toContain("\n  "); // still pretty-printed
    expect(raw.endsWith("\n")).toBe(true); // still trailing newline
    expect(JSON.parse(raw)).toEqual(m);
  });
});

describe("readPriorSnapshot", () => {
  it("returns null when the directory does not exist (first ever run)", () => {
    expect(readPriorSnapshot(join(dir, "nope"), NOW)).toBeNull();
  });

  it("returns null when only today's snapshot exists (intraday re-run)", () => {
    writeSnapshot(dir, NOW, model());
    expect(readPriorSnapshot(dir, NOW)).toBeNull();
  });

  it("returns the most recent snapshot dated strictly before today", () => {
    writeFileSync(join(dir, "2026-07-05.json"), JSON.stringify(model({ generatedAt: 5 })));
    writeFileSync(join(dir, "2026-07-07.json"), JSON.stringify(model({ generatedAt: 7 })));
    writeSnapshot(dir, NOW, model({ generatedAt: 8 })); // today — must be ignored
    expect(readPriorSnapshot(dir, NOW)!.generatedAt).toBe(7);
  });

  it("ignores files that are not dated snapshots", () => {
    writeFileSync(join(dir, "README.md"), "not a snapshot");
    writeFileSync(join(dir, "2026-07-07.json"), JSON.stringify(model({ generatedAt: 7 })));
    expect(readPriorSnapshot(dir, NOW)!.generatedAt).toBe(7);
  });

  it("returns null (never throws) on a corrupt snapshot file", () => {
    writeFileSync(join(dir, "2026-07-07.json"), "{not json");
    expect(readPriorSnapshot(dir, NOW)).toBeNull();
  });

  it("returns null (never throws) when the prior file is valid JSON but the wrong shape", () => {
    writeFileSync(join(dir, "2026-07-07.json"), JSON.stringify({ foo: 1 }));
    expect(readPriorSnapshot(dir, NOW)).toBeNull();
  });

  it("returns null (never throws) when `surfaced` is present but not an array", () => {
    writeFileSync(
      join(dir, "2026-07-07.json"),
      JSON.stringify({ ...model({ generatedAt: 7 }), surfaced: "not-an-array" }),
    );
    expect(readPriorSnapshot(dir, NOW)).toBeNull();
  });

  it("still reads back a well-formed prior SitrepModel (existing behavior preserved)", () => {
    const m = model({ generatedAt: 7, surfaced: [], changeSummary: { new: 0, revised: 0, withdrawn: 0 } });
    writeFileSync(join(dir, "2026-07-07.json"), JSON.stringify(m));
    expect(readPriorSnapshot(dir, NOW)).toEqual(m);
  });
});
