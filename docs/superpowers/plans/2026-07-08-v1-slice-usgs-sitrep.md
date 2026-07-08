# v1 Vertical Slice (USGS → filter → assess → dashboard.html) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the pipeline end-to-end on one feed: fetch USGS earthquakes → deterministic threshold filter + priority tiers → LLM assessment → render a static `dashboard.html` → one manual run (ADR 0010).

**Architecture:** A pure core seam `buildSitrep(feedResults, priorSnapshot, now)` does all deterministic work (parse-dispatch, noise floor, tiering, sorting, degradation notices) with no network and no LLM. The assessment writer (headless `claude -p`) and the clock are injected around it. Thin adapters on either side: `fetchUsgs` (HTTP) and `renderDashboard` (HTML string out). See `docs/PRD.md` → Implementation Decisions and ADRs 0003/0004/0008.

**Tech Stack:** TypeScript on Node ≥20 (ESM, `strict`), npm, tsx (run), Vitest (test), zero runtime dependencies, `claude -p` CLI for the assessment step.

## Global Constraints

(from `CLAUDE.md`, `docs/PRD.md`, ADRs — every task implicitly includes these)

- TypeScript, ESM (`"type": "module"`), `strict: true`; run with `tsx`; test with Vitest; npm + committed lockfile.
- Tests must not hit the network, call a real model, or need a browser. Fixture-driven, through the seam.
- `buildSitrep` is pure: **no network, no LLM call**; clock injected as `now`.
- Rules decide; the LLM only describes. The LLM never decides inclusion or tier.
- Thresholds are named constants in one place (`src/thresholds.ts`): noise floor USGS M ≥ 4.5; CRITICAL = M ≥ 6.5 or PAGER `alert` ∈ {orange, red}; HIGH = M 5.5–6.4; MODERATE = M 4.5–5.4 (ADR 0004).
- Never fail silently, never crash the run: a feed failure becomes a degradation notice; an LLM failure becomes a fallback assessment line (ADR 0008).
- Vocabulary discipline: "surfaced event", "priority tier", "PAGER alert" (USGS only), "assessment" (LLM prose only) — per `CONTEXT.md`.
- `dashboard.html` at repo root is the product and **is committed** (`.gitignore` already whitelists it).
- Out of scope for this slice (later layers, ADR 0010): GDACS, ReliefWeb, the map, JSON snapshots/change detection, duplicate flagging, scheduling. `buildSitrep` still accepts `priorSnapshot` (the PRD seam contract) but ignores it this slice.
- Deviations from PRD/ADRs/CLAUDE.md are recorded in `implementation-notes.md` → Deviations.

## File Structure

```
package.json                    — scripts: test, test:watch, sitrep; devDeps only
package-lock.json               — committed
tsconfig.json                   — ES2022, NodeNext, strict, noEmit
src/types.ts                    — Event, SurfacedEvent, FeedResult, SitrepModel, Tier
src/thresholds.ts               — ADR 0004 constants (single tunable place)
src/feeds/usgs.ts               — parseUsgs (pure) + fetchUsgs (thin HTTP adapter)
src/core/triage.ts              — passesNoiseFloor, tierFor (pure rules)
src/core/buildSitrep.ts         — THE seam: FeedResult[] + priorSnapshot + now → SitrepModel
src/assessment/writer.ts        — prompt builder + response parser (pure) + claude -p spawn + fillAssessments
src/render/dashboard.ts         — renderDashboard(model) → HTML string (pure)
src/run.ts                      — orchestrator: fetch → buildSitrep → fillAssessments → write dashboard.html
test/fixtures/usgs-all-day.json — recorded-shape USGS payload covering all tier/drop cases
test/usgs-parse.test.ts
test/triage.test.ts
test/build-sitrep.test.ts
test/assessment.test.ts
test/render.test.ts
```

---

### Task 1: Project scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `test/smoke.test.ts` (deleted again in Task 2)

**Interfaces:**
- Consumes: nothing (first task).
- Produces: working `npm test` (Vitest) and `npx tsc --noEmit`; ESM project every later task builds in.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "hadr-monitor",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "sitrep": "tsx src/run.ts"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "types": ["node"]
  },
  "include": ["src", "test"]
}
```

- [ ] **Step 3: Install dev dependencies**

Run: `npm install --save-dev typescript tsx vitest @types/node`
Expected: `package-lock.json` created, `node_modules/` present (already gitignored).

- [ ] **Step 4: Write a smoke test**

Create `test/smoke.test.ts`:

```ts
import { describe, it, expect } from "vitest";

describe("toolchain", () => {
  it("runs TypeScript tests", () => {
    const x: number = 1 + 1;
    expect(x).toBe(2);
  });
});
```

- [ ] **Step 5: Run the test suite and typecheck**

Run: `npm test`
Expected: PASS — 1 test file, 1 test.

Run: `npm run typecheck`
Expected: exit 0, no output.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json tsconfig.json test/smoke.test.ts
git commit -m "chore: scaffold TypeScript/Vitest toolchain for v1 slice"
```

---

### Task 2: Types + USGS parser

**Files:**
- Create: `src/types.ts`
- Create: `src/feeds/usgs.ts` (parser half only; `fetchUsgs` arrives in Task 7)
- Create: `test/fixtures/usgs-all-day.json`
- Create: `test/usgs-parse.test.ts`
- Delete: `test/smoke.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `src/types.ts` exports: `Tier = "CRITICAL" | "HIGH" | "MODERATE"`, `FeedName = "USGS" | "GDACS" | "ReliefWeb"`, `PagerAlert = "green" | "yellow" | "orange" | "red"`, `Event`, `SurfacedEvent`, `FeedResult`, `SitrepModel` (exact shapes in Step 1).
  - `parseUsgs(rawPayload: unknown): Event[]` — pure, tolerant of malformed features (skips, never throws).

- [ ] **Step 1: Create `src/types.ts`**

```ts
/** Domain shapes — vocabulary per CONTEXT.md, seam contract per docs/PRD.md. */

export type Tier = "CRITICAL" | "HIGH" | "MODERATE";

export type FeedName = "USGS" | "GDACS" | "ReliefWeb";

export type PagerAlert = "green" | "yellow" | "orange" | "red";

/** One disaster occurrence as reported by one feed, normalised. */
export interface Event {
  feed: FeedName;
  /** The feed's own canonical id (USGS `id`) — stable identity across runs. */
  feedEventId: string;
  hazardType: string; // "EQ" for USGS
  title: string;
  locationName: string;
  /** Absent for feeds without coordinates (ReliefWeb, later slice). */
  coordinates?: { lon: number; lat: number; depthKm?: number };
  /** Event time, epoch milliseconds UTC. */
  time: number;
  metrics: {
    mag?: number;
    sig?: number;
    pagerAlert?: PagerAlert;
  };
  sourceUrl?: string;
}

/** An event that passed the noise floor and carries its priority tier. */
export interface SurfacedEvent extends Event {
  tier: Tier;
  /** LLM-written narrative; filled outside the pure core (ADR 0003). */
  assessment?: string;
}

/** Raw result of one feed fetch — failures are data, not exceptions (ADR 0008). */
export type FeedResult =
  | { feed: FeedName; status: "ok"; rawPayload: unknown }
  | { feed: FeedName; status: "unavailable"; error: string };

/** The render model buildSitrep produces — the PRD's SitrepModel. */
export interface SitrepModel {
  generatedAt: number; // epoch ms, from injected `now`
  /** Sorted most-severe-first. */
  surfaced: SurfacedEvent[];
  degradation: { feed: FeedName; reason: string }[];
}
```

- [ ] **Step 2: Create the fixture `test/fixtures/usgs-all-day.json`**

Shape matches the real feed (`feeds/usgs.md`); six features cover every triage case used by later tasks:

```json
{
  "type": "FeatureCollection",
  "metadata": {
    "generated": 1783340000000,
    "title": "USGS All Earthquakes, Past Day",
    "count": 6
  },
  "features": [
    {
      "type": "Feature",
      "id": "us7000aaa1",
      "properties": {
        "mag": 7.2,
        "place": "100 km S of Suva, Fiji",
        "time": 1783300000000,
        "updated": 1783301000000,
        "alert": null,
        "status": "reviewed",
        "sig": 900,
        "type": "earthquake",
        "title": "M 7.2 - 100 km S of Suva, Fiji",
        "url": "https://earthquake.usgs.gov/earthquakes/eventpage/us7000aaa1"
      },
      "geometry": { "type": "Point", "coordinates": [178.4, -19.1, 550] }
    },
    {
      "type": "Feature",
      "id": "us7000aaa2",
      "properties": {
        "mag": 5.8,
        "place": "12 km NE of Kushiro, Japan",
        "time": 1783310000000,
        "updated": 1783311000000,
        "alert": "green",
        "status": "reviewed",
        "sig": 518,
        "type": "earthquake",
        "title": "M 5.8 - 12 km NE of Kushiro, Japan",
        "url": "https://earthquake.usgs.gov/earthquakes/eventpage/us7000aaa2"
      },
      "geometry": { "type": "Point", "coordinates": [144.5, 43.0, 45] }
    },
    {
      "type": "Feature",
      "id": "us7000aaa3",
      "properties": {
        "mag": 4.6,
        "place": "central Mid-Atlantic Ridge",
        "time": 1783320000000,
        "updated": 1783321000000,
        "alert": null,
        "status": "automatic",
        "sig": 326,
        "type": "earthquake",
        "title": "M 4.6 - central Mid-Atlantic Ridge",
        "url": "https://earthquake.usgs.gov/earthquakes/eventpage/us7000aaa3"
      },
      "geometry": { "type": "Point", "coordinates": [-20.1, 0.5, 10] }
    },
    {
      "type": "Feature",
      "id": "ci41287863",
      "properties": {
        "mag": 3.0,
        "place": "9 km NNE of Avalon, CA",
        "time": 1783330000000,
        "updated": 1783331000000,
        "alert": null,
        "status": "automatic",
        "sig": 143,
        "type": "earthquake",
        "title": "M 3.0 - 9 km NNE of Avalon, CA",
        "url": "https://earthquake.usgs.gov/earthquakes/eventpage/ci41287863"
      },
      "geometry": { "type": "Point", "coordinates": [-118.3, 33.4, 12.1] }
    },
    {
      "type": "Feature",
      "id": "us7000aaa5",
      "properties": {
        "mag": 4.8,
        "place": "2 km W of Kathmandu, Nepal",
        "time": 1783335000000,
        "updated": 1783336000000,
        "alert": "red",
        "status": "reviewed",
        "sig": 780,
        "type": "earthquake",
        "title": "M 4.8 - 2 km W of Kathmandu, Nepal",
        "url": "https://earthquake.usgs.gov/earthquakes/eventpage/us7000aaa5"
      },
      "geometry": { "type": "Point", "coordinates": [85.3, 27.7, 8] }
    },
    {
      "type": "Feature",
      "id": "us7000aaa6",
      "properties": {
        "mag": null,
        "place": "42 km SSW of Adak, Alaska",
        "time": 1783338000000,
        "updated": 1783339000000,
        "alert": null,
        "status": "automatic",
        "sig": 0,
        "type": "earthquake",
        "title": "M ? - 42 km SSW of Adak, Alaska",
        "url": "https://earthquake.usgs.gov/earthquakes/eventpage/us7000aaa6"
      },
      "geometry": { "type": "Point", "coordinates": [-176.8, 51.5, 30] }
    }
  ]
}
```

Case map (used by Tasks 3–4): `us7000aaa1` M7.2 → CRITICAL by magnitude · `us7000aaa2` M5.8 → HIGH · `us7000aaa3` M4.6 → MODERATE · `ci41287863` M3.0 → dropped · `us7000aaa5` M4.8 + PAGER red → CRITICAL by impact · `us7000aaa6` mag null → dropped.

- [ ] **Step 3: Write the failing parser test**

Create `test/usgs-parse.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseUsgs } from "../src/feeds/usgs.js";

const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/usgs-all-day.json", import.meta.url), "utf8"),
);

describe("parseUsgs", () => {
  it("normalises every well-formed feature into an Event", () => {
    const events = parseUsgs(fixture);
    expect(events).toHaveLength(6);
  });

  it("maps USGS fields onto the Event shape", () => {
    const e = parseUsgs(fixture).find((e) => e.feedEventId === "us7000aaa1");
    expect(e).toBeDefined();
    expect(e).toMatchObject({
      feed: "USGS",
      feedEventId: "us7000aaa1",
      hazardType: "EQ",
      title: "M 7.2 - 100 km S of Suva, Fiji",
      locationName: "100 km S of Suva, Fiji",
      time: 1783300000000,
      sourceUrl: "https://earthquake.usgs.gov/earthquakes/eventpage/us7000aaa1",
    });
    expect(e!.coordinates).toEqual({ lon: 178.4, lat: -19.1, depthKm: 550 });
    expect(e!.metrics).toEqual({ mag: 7.2, sig: 900, pagerAlert: undefined });
  });

  it("carries the PAGER alert when present", () => {
    const e = parseUsgs(fixture).find((e) => e.feedEventId === "us7000aaa5");
    expect(e!.metrics.pagerAlert).toBe("red");
  });

  it("keeps null-magnitude events (the noise floor drops them, not the parser)", () => {
    const e = parseUsgs(fixture).find((e) => e.feedEventId === "us7000aaa6");
    expect(e).toBeDefined();
    expect(e!.metrics.mag).toBeUndefined();
  });

  it("skips malformed features instead of throwing", () => {
    const valid = fixture.features[0];
    const events = parseUsgs({ features: [{ bogus: true }, null, valid] });
    expect(events).toHaveLength(1);
    expect(events[0].feedEventId).toBe("us7000aaa1");
  });

  it("returns [] for payloads without a features array", () => {
    expect(parseUsgs({})).toEqual([]);
    expect(parseUsgs(null)).toEqual([]);
    expect(parseUsgs("not json-shaped")).toEqual([]);
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npx vitest run test/usgs-parse.test.ts`
Expected: FAIL — cannot resolve `../src/feeds/usgs.js` (module does not exist).

- [ ] **Step 5: Implement the parser**

Create `src/feeds/usgs.ts`:

```ts
import type { Event, PagerAlert } from "../types.js";

/**
 * USGS real-time earthquake feed (feeds/usgs.md). GeoJSON FeatureCollection.
 * We store the canonical `id` (not the `ids` list) as feedEventId — stable
 * per-event identity across runs (ADR 0009).
 */

const PAGER_ALERTS: readonly PagerAlert[] = ["green", "yellow", "orange", "red"];

interface UsgsFeature {
  id?: unknown;
  properties?: {
    mag?: unknown;
    place?: unknown;
    time?: unknown;
    alert?: unknown;
    sig?: unknown;
    title?: unknown;
    url?: unknown;
  } | null;
  geometry?: { coordinates?: unknown } | null;
}

/** Pure raw-payload → Event[] normaliser. Skips malformed features; never throws. */
export function parseUsgs(rawPayload: unknown): Event[] {
  const features = (rawPayload as { features?: unknown[] } | null)?.features;
  if (!Array.isArray(features)) return [];

  const events: Event[] = [];
  for (const raw of features) {
    const event = parseFeature(raw as UsgsFeature);
    if (event) events.push(event);
  }
  return events;
}

function parseFeature(feature: UsgsFeature | null): Event | undefined {
  const props = feature?.properties;
  if (!feature || typeof feature.id !== "string" || !props) return undefined;
  if (typeof props.time !== "number") return undefined;

  const place = typeof props.place === "string" ? props.place : "location unknown";
  const coords = Array.isArray(feature.geometry?.coordinates)
    ? (feature.geometry!.coordinates as unknown[])
    : undefined;

  return {
    feed: "USGS",
    feedEventId: feature.id,
    hazardType: "EQ",
    title: typeof props.title === "string" ? props.title : place,
    locationName: place,
    coordinates:
      coords && typeof coords[0] === "number" && typeof coords[1] === "number"
        ? {
            lon: coords[0],
            lat: coords[1],
            depthKm: typeof coords[2] === "number" ? coords[2] : undefined,
          }
        : undefined,
    time: props.time,
    metrics: {
      mag: typeof props.mag === "number" ? props.mag : undefined,
      sig: typeof props.sig === "number" ? props.sig : undefined,
      pagerAlert: PAGER_ALERTS.includes(props.alert as PagerAlert)
        ? (props.alert as PagerAlert)
        : undefined,
    },
    sourceUrl: typeof props.url === "string" ? props.url : undefined,
  };
}
```

- [ ] **Step 6: Run the test to verify it passes; remove the smoke test**

Run: `npx vitest run test/usgs-parse.test.ts`
Expected: PASS — 6 tests.

Delete `test/smoke.test.ts` (it has done its job).

Run: `npm test && npm run typecheck`
Expected: PASS — 1 test file (usgs-parse), 6 tests; typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add src/types.ts src/feeds/usgs.ts test/fixtures/usgs-all-day.json test/usgs-parse.test.ts
git rm test/smoke.test.ts
git commit -m "feat: domain types and USGS GeoJSON parser (fixture-tested)"
```

---

### Task 3: Thresholds + triage rules (noise floor, priority tier)

**Files:**
- Create: `src/thresholds.ts`
- Create: `src/core/triage.ts`
- Create: `test/triage.test.ts`
- Modify: `implementation-notes.md` (record one decision)

**Interfaces:**
- Consumes: `Event`, `Tier`, `PagerAlert` from `src/types.ts` (Task 2).
- Produces:
  - `src/thresholds.ts` exports: `USGS_NOISE_FLOOR_MAG = 4.5`, `USGS_HIGH_MAG = 5.5`, `USGS_CRITICAL_MAG = 6.5`, `PAGER_CRITICAL_ALERTS = ["orange", "red"]`.
  - `passesNoiseFloor(event: Event): boolean`
  - `tierFor(event: Event): Tier`

- [ ] **Step 1: Write the failing triage test**

Create `test/triage.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { passesNoiseFloor, tierFor } from "../src/core/triage.js";
import type { Event, PagerAlert } from "../src/types.js";

function usgsEvent(mag: number | undefined, pagerAlert?: PagerAlert): Event {
  return {
    feed: "USGS",
    feedEventId: `test-${mag ?? "null"}-${pagerAlert ?? "none"}`,
    hazardType: "EQ",
    title: "test quake",
    locationName: "somewhere",
    time: 1783300000000,
    metrics: { mag, pagerAlert },
  };
}

describe("passesNoiseFloor (ADR 0004: conservative/loud)", () => {
  it("surfaces USGS M >= 4.5", () => {
    expect(passesNoiseFloor(usgsEvent(4.5))).toBe(true);
    expect(passesNoiseFloor(usgsEvent(7.2))).toBe(true);
  });

  it("drops USGS M < 4.5", () => {
    expect(passesNoiseFloor(usgsEvent(4.49))).toBe(false);
    expect(passesNoiseFloor(usgsEvent(3.0))).toBe(false);
  });

  it("drops null-magnitude events without a critical PAGER alert", () => {
    expect(passesNoiseFloor(usgsEvent(undefined))).toBe(false);
  });

  it("surfaces PAGER orange/red regardless of magnitude (never miss a major event)", () => {
    expect(passesNoiseFloor(usgsEvent(4.2, "red"))).toBe(true);
    expect(passesNoiseFloor(usgsEvent(undefined, "orange"))).toBe(true);
  });

  it("does not let PAGER green/yellow bypass the magnitude floor", () => {
    expect(passesNoiseFloor(usgsEvent(4.2, "green"))).toBe(false);
    expect(passesNoiseFloor(usgsEvent(4.2, "yellow"))).toBe(false);
  });
});

describe("tierFor (ADR 0004: three-tier unified priority)", () => {
  it("CRITICAL at M >= 6.5", () => {
    expect(tierFor(usgsEvent(6.5))).toBe("CRITICAL");
    expect(tierFor(usgsEvent(7.2))).toBe("CRITICAL");
  });

  it("CRITICAL on PAGER orange/red even at mid magnitude (impact-aware)", () => {
    expect(tierFor(usgsEvent(4.8, "red"))).toBe("CRITICAL");
    expect(tierFor(usgsEvent(5.0, "orange"))).toBe("CRITICAL");
  });

  it("HIGH at M 5.5-6.4", () => {
    expect(tierFor(usgsEvent(5.5))).toBe("HIGH");
    expect(tierFor(usgsEvent(6.4))).toBe("HIGH");
  });

  it("MODERATE at M 4.5-5.4", () => {
    expect(tierFor(usgsEvent(4.5))).toBe("MODERATE");
    expect(tierFor(usgsEvent(5.4))).toBe("MODERATE");
  });

  it("PAGER green/yellow does not promote", () => {
    expect(tierFor(usgsEvent(5.8, "yellow"))).toBe("HIGH");
    expect(tierFor(usgsEvent(4.6, "green"))).toBe("MODERATE");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/triage.test.ts`
Expected: FAIL — cannot resolve `../src/core/triage.js`.

- [ ] **Step 3: Implement thresholds and triage**

Create `src/thresholds.ts`:

```ts
import type { PagerAlert } from "./types.js";

/**
 * ADR 0004 — conservative noise floor and three-tier priority.
 * The single tunable place: change values here, never inline elsewhere.
 */

/** USGS events below this magnitude are noise (unless PAGER-critical). */
export const USGS_NOISE_FLOOR_MAG = 4.5;

/** USGS M >= this (and < critical) is HIGH. */
export const USGS_HIGH_MAG = 5.5;

/** USGS M >= this is CRITICAL. */
export const USGS_CRITICAL_MAG = 6.5;

/** PAGER impact levels that promote an event to CRITICAL (impact-aware rule). */
export const PAGER_CRITICAL_ALERTS: readonly PagerAlert[] = ["orange", "red"];
```

Create `src/core/triage.ts`:

```ts
import type { Event, Tier } from "../types.js";
import {
  PAGER_CRITICAL_ALERTS,
  USGS_CRITICAL_MAG,
  USGS_HIGH_MAG,
  USGS_NOISE_FLOOR_MAG,
} from "../thresholds.js";

/** Deterministic rules only — no model in the selection path (ADR 0003). */

function isPagerCritical(event: Event): boolean {
  return (
    event.metrics.pagerAlert !== undefined &&
    PAGER_CRITICAL_ALERTS.includes(event.metrics.pagerAlert)
  );
}

/**
 * Noise floor (ADR 0004): USGS M >= 4.5. Impact-aware extension: a PAGER
 * orange/red event always surfaces regardless of magnitude — the cardinal
 * rule is never miss a major event (recorded in implementation-notes.md).
 */
export function passesNoiseFloor(event: Event): boolean {
  if (event.feed === "USGS") {
    const mag = event.metrics.mag ?? Number.NEGATIVE_INFINITY;
    return mag >= USGS_NOISE_FLOOR_MAG || isPagerCritical(event);
  }
  // GDACS / ReliefWeb land in later slices (ADR 0010).
  return false;
}

/** Priority tier (ADR 0004). Call only on events that passed the noise floor. */
export function tierFor(event: Event): Tier {
  const mag = event.metrics.mag ?? Number.NEGATIVE_INFINITY;
  if (isPagerCritical(event) || mag >= USGS_CRITICAL_MAG) return "CRITICAL";
  if (mag >= USGS_HIGH_MAG) return "HIGH";
  return "MODERATE";
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/triage.test.ts`
Expected: PASS — 10 tests.

Run: `npm test && npm run typecheck`
Expected: all PASS, typecheck clean.

- [ ] **Step 5: Record the impact-aware noise-floor decision**

In `implementation-notes.md`, under `## Decisions`, add:

```markdown
- **2026-07-08 — PAGER-critical events bypass the magnitude noise floor.**
  ADR 0004 literally reads "noise floor: USGS M ≥ 4.5" and separately "CRITICAL:
  PAGER orange/red". A PAGER-red M4.2 quake would satisfy the tier rule but fail
  the floor. Resolved in favour of the cardinal rule (never miss a major event):
  `passesNoiseFloor` surfaces any USGS event with PAGER orange/red regardless of
  magnitude. Green/yellow PAGER does not bypass the floor.
```

- [ ] **Step 6: Commit**

```bash
git add src/thresholds.ts src/core/triage.ts test/triage.test.ts implementation-notes.md
git commit -m "feat: noise floor and priority-tier rules as tested constants (ADR 0004)"
```

---

### Task 4: The core seam — `buildSitrep`

**Files:**
- Create: `src/core/buildSitrep.ts`
- Create: `test/build-sitrep.test.ts`

**Interfaces:**
- Consumes: `parseUsgs` (Task 2), `passesNoiseFloor` / `tierFor` (Task 3), types (Task 2).
- Produces: `buildSitrep(feedResults: FeedResult[], priorSnapshot: SitrepModel | null, now: Date): SitrepModel` — pure; no network, no LLM, clock injected. `surfaced` sorted most-severe-first (tier, then magnitude desc). `priorSnapshot` accepted but unused this slice (change detection lands with snapshots, ADR 0010).

- [ ] **Step 1: Write the failing seam test**

Create `test/build-sitrep.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { buildSitrep } from "../src/core/buildSitrep.js";
import type { FeedResult } from "../src/types.js";

const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/usgs-all-day.json", import.meta.url), "utf8"),
);

const NOW = new Date("2026-07-08T00:30:00Z");

const usgsOk: FeedResult = { feed: "USGS", status: "ok", rawPayload: fixture };
const usgsDown: FeedResult = {
  feed: "USGS",
  status: "unavailable",
  error: "HTTP 503",
};

describe("buildSitrep (the seam — pure, deterministic)", () => {
  it("surfaces only events at or above the noise floor", () => {
    const model = buildSitrep([usgsOk], null, NOW);
    const ids = model.surfaced.map((e) => e.feedEventId);
    // fixture case map: aaa1 M7.2, aaa2 M5.8, aaa3 M4.6, aaa5 M4.8+PAGER red
    expect(ids).toHaveLength(4);
    expect(ids).not.toContain("ci41287863"); // M3.0 — noise
    expect(ids).not.toContain("us7000aaa6"); // mag null — noise
  });

  it("assigns priority tiers per ADR 0004", () => {
    const model = buildSitrep([usgsOk], null, NOW);
    const tierOf = (id: string) =>
      model.surfaced.find((e) => e.feedEventId === id)?.tier;
    expect(tierOf("us7000aaa1")).toBe("CRITICAL"); // M7.2
    expect(tierOf("us7000aaa5")).toBe("CRITICAL"); // M4.8 + PAGER red
    expect(tierOf("us7000aaa2")).toBe("HIGH"); // M5.8
    expect(tierOf("us7000aaa3")).toBe("MODERATE"); // M4.6
  });

  it("sorts most-severe-first: tier order, then magnitude descending", () => {
    const model = buildSitrep([usgsOk], null, NOW);
    expect(model.surfaced.map((e) => e.feedEventId)).toEqual([
      "us7000aaa1", // CRITICAL M7.2
      "us7000aaa5", // CRITICAL M4.8 (PAGER)
      "us7000aaa2", // HIGH M5.8
      "us7000aaa3", // MODERATE M4.6
    ]);
  });

  it("turns an unavailable feed into a degradation notice, never a throw", () => {
    const model = buildSitrep([usgsDown], null, NOW);
    expect(model.surfaced).toEqual([]);
    expect(model.degradation).toEqual([{ feed: "USGS", reason: "HTTP 503" }]);
  });

  it("reports no degradation when all feeds are ok", () => {
    const model = buildSitrep([usgsOk], null, NOW);
    expect(model.degradation).toEqual([]);
  });

  it("stamps generatedAt from the injected clock", () => {
    const model = buildSitrep([usgsOk], null, NOW);
    expect(model.generatedAt).toBe(NOW.getTime());
  });

  it("accepts a null prior snapshot (first run)", () => {
    expect(() => buildSitrep([usgsOk], null, NOW)).not.toThrow();
  });

  it("does not attach assessments (the LLM writes those outside the core)", () => {
    const model = buildSitrep([usgsOk], null, NOW);
    for (const e of model.surfaced) expect(e.assessment).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/build-sitrep.test.ts`
Expected: FAIL — cannot resolve `../src/core/buildSitrep.js`.

- [ ] **Step 3: Implement `buildSitrep`**

Create `src/core/buildSitrep.ts`:

```ts
import type {
  Event,
  FeedResult,
  SitrepModel,
  SurfacedEvent,
  Tier,
} from "../types.js";
import { parseUsgs } from "../feeds/usgs.js";
import { passesNoiseFloor, tierFor } from "./triage.js";

const TIER_ORDER: Record<Tier, number> = { CRITICAL: 0, HIGH: 1, MODERATE: 2 };

/**
 * THE seam (docs/PRD.md → Implementation Decisions). Pure and deterministic:
 * no network, no LLM, no ambient clock. Feed failures arrive as data and leave
 * as degradation notices (ADR 0008). priorSnapshot is part of the contract but
 * unused this slice — change detection lands with snapshots (ADR 0010).
 */
export function buildSitrep(
  feedResults: FeedResult[],
  priorSnapshot: SitrepModel | null,
  now: Date,
): SitrepModel {
  void priorSnapshot; // reserved for change detection (later slice)

  const degradation = feedResults
    .filter((r) => r.status === "unavailable")
    .map((r) => ({ feed: r.feed, reason: r.error }));

  const events: Event[] = feedResults
    .filter((r) => r.status === "ok")
    .flatMap((r) => (r.feed === "USGS" ? parseUsgs(r.rawPayload) : []));

  const surfaced: SurfacedEvent[] = events
    .filter(passesNoiseFloor)
    .map((e) => ({ ...e, tier: tierFor(e) }))
    .sort(
      (a, b) =>
        TIER_ORDER[a.tier] - TIER_ORDER[b.tier] ||
        (b.metrics.mag ?? 0) - (a.metrics.mag ?? 0),
    );

  return { generatedAt: now.getTime(), surfaced, degradation };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/build-sitrep.test.ts`
Expected: PASS — 8 tests.

Run: `npm test && npm run typecheck`
Expected: all PASS, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/core/buildSitrep.ts test/build-sitrep.test.ts
git commit -m "feat: buildSitrep core seam - pure filter/tier/sort/degradation (ADR 0003)"
```

---

### Task 5: Assessment writer (LLM step, injected)

**Files:**
- Create: `src/assessment/writer.ts`
- Create: `test/assessment.test.ts`

**Interfaces:**
- Consumes: `SurfacedEvent`, `SitrepModel` from `src/types.ts`.
- Produces:
  - `type AssessmentWriter = (events: SurfacedEvent[]) => Promise<Map<string, string>>` (keyed by `feedEventId`).
  - `buildAssessmentPrompt(events: SurfacedEvent[]): string` — pure.
  - `parseAssessmentResponse(text: string): Map<string, string>` — pure, tolerant of prose around the JSON.
  - `FALLBACK_ASSESSMENT: string` — used whenever the writer fails or omits an event.
  - `fillAssessments(model: SitrepModel, writer: AssessmentWriter): Promise<SitrepModel>` — never throws; degrades to fallback text.
  - `claudeCliWriter: AssessmentWriter` — spawns `claude -p` (prompt via stdin). Not unit-tested (thin adapter, exercised by the manual run in Task 7).

- [ ] **Step 1: Write the failing assessment tests (pure parts only)**

Create `test/assessment.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import {
  buildAssessmentPrompt,
  parseAssessmentResponse,
  fillAssessments,
  FALLBACK_ASSESSMENT,
  type AssessmentWriter,
} from "../src/assessment/writer.js";
import type { SitrepModel, SurfacedEvent } from "../src/types.js";

function surfaced(id: string, tier: SurfacedEvent["tier"], mag: number): SurfacedEvent {
  return {
    feed: "USGS",
    feedEventId: id,
    hazardType: "EQ",
    title: `M ${mag} - test quake ${id}`,
    locationName: "near Testville",
    time: 1783300000000,
    metrics: { mag },
    tier,
  };
}

function model(events: SurfacedEvent[]): SitrepModel {
  return { generatedAt: 1783310000000, surfaced: events, degradation: [] };
}

describe("buildAssessmentPrompt", () => {
  const events = [surfaced("id-a", "CRITICAL", 7.2), surfaced("id-b", "MODERATE", 4.6)];
  const prompt = buildAssessmentPrompt(events);

  it("includes each event's id, tier, and key metrics", () => {
    expect(prompt).toContain("id-a");
    expect(prompt).toContain("id-b");
    expect(prompt).toContain("CRITICAL");
    expect(prompt).toContain("7.2");
    expect(prompt).toContain("near Testville");
  });

  it("instructs grounding and JSON-array output", () => {
    expect(prompt.toLowerCase()).toContain("only the data provided");
    expect(prompt.toLowerCase()).toContain("json array");
  });
});

describe("parseAssessmentResponse", () => {
  it("parses a clean JSON array", () => {
    const map = parseAssessmentResponse(
      '[{"id":"id-a","assessment":"A strong quake."}]',
    );
    expect(map.get("id-a")).toBe("A strong quake.");
  });

  it("extracts the JSON array even when wrapped in prose or fences", () => {
    const map = parseAssessmentResponse(
      'Here you go:\n```json\n[{"id":"id-a","assessment":"Text."}]\n```\nDone.',
    );
    expect(map.get("id-a")).toBe("Text.");
  });

  it("ignores malformed entries and keeps valid ones", () => {
    const map = parseAssessmentResponse(
      '[{"id":"id-a","assessment":"Ok."},{"nope":true},{"id":"id-b"}]',
    );
    expect(map.size).toBe(1);
    expect(map.get("id-a")).toBe("Ok.");
  });

  it("returns an empty map when no JSON array is found", () => {
    expect(parseAssessmentResponse("Sorry, I cannot help.").size).toBe(0);
  });
});

describe("fillAssessments (never crash the run — ADR 0008 spirit)", () => {
  it("attaches assessments returned by the writer", async () => {
    const writer: AssessmentWriter = async () =>
      new Map([["id-a", "Narrative for A."]]);
    const out = await fillAssessments(model([surfaced("id-a", "HIGH", 5.8)]), writer);
    expect(out.surfaced[0].assessment).toBe("Narrative for A.");
  });

  it("falls back per-event when the writer omits an id", async () => {
    const writer: AssessmentWriter = async () =>
      new Map([["id-a", "Narrative for A."]]);
    const out = await fillAssessments(
      model([surfaced("id-a", "HIGH", 5.8), surfaced("id-b", "MODERATE", 4.6)]),
      writer,
    );
    expect(out.surfaced[1].assessment).toBe(FALLBACK_ASSESSMENT);
  });

  it("falls back for every event when the writer throws", async () => {
    const writer: AssessmentWriter = async () => {
      throw new Error("claude -p exited 1");
    };
    const out = await fillAssessments(model([surfaced("id-a", "HIGH", 5.8)]), writer);
    expect(out.surfaced[0].assessment).toBe(FALLBACK_ASSESSMENT);
  });

  it("does not call the writer when nothing surfaced", async () => {
    const writer = vi.fn<AssessmentWriter>();
    const out = await fillAssessments(model([]), writer);
    expect(writer).not.toHaveBeenCalled();
    expect(out.surfaced).toEqual([]);
  });

  it("does not mutate the input model", async () => {
    const input = model([surfaced("id-a", "HIGH", 5.8)]);
    await fillAssessments(input, async () => new Map([["id-a", "X"]]));
    expect(input.surfaced[0].assessment).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/assessment.test.ts`
Expected: FAIL — cannot resolve `../src/assessment/writer.js`.

- [ ] **Step 3: Implement the writer module**

Create `src/assessment/writer.ts`:

```ts
import { spawn } from "node:child_process";
import type { SitrepModel, SurfacedEvent } from "../types.js";

/**
 * The LLM step (ADR 0003): writes the assessment narrative for surfaced
 * events. It describes; it never decides inclusion or tier. Injected into the
 * run so the core seam stays pure and tests never call a model.
 */
export type AssessmentWriter = (
  events: SurfacedEvent[],
) => Promise<Map<string, string>>; // feedEventId → assessment prose

export const FALLBACK_ASSESSMENT =
  "Assessment unavailable this run — the metrics above are authoritative.";

/** Pure. One batched prompt for all surfaced events (keeps token use modest). */
export function buildAssessmentPrompt(events: SurfacedEvent[]): string {
  const eventLines = events.map((e) =>
    JSON.stringify({
      id: e.feedEventId,
      tier: e.tier,
      title: e.title,
      location: e.locationName,
      timeUtc: new Date(e.time).toISOString(),
      magnitude: e.metrics.mag,
      pagerAlert: e.metrics.pagerAlert,
      sig: e.metrics.sig,
    }),
  );

  return [
    "You are writing the assessment narratives for a HADR (humanitarian",
    "assistance & disaster response) morning situation report.",
    "",
    "For each event below, write what happened, where, how bad, and who is",
    "affected — using ONLY the data provided. Do not invent casualty figures,",
    "damage reports, or place details that are not in the data. Never overstate",
    "severity. CRITICAL and HIGH events get 2-3 sentences; MODERATE events get",
    "exactly 1 terse sentence.",
    "",
    "Events (one JSON object per line):",
    ...eventLines,
    "",
    "Reply with ONLY a JSON array, no other text, in this exact shape:",
    '[{"id": "<event id>", "assessment": "<narrative>"}]',
  ].join("\n");
}

/** Pure. Tolerates prose/code-fences around the array; skips malformed entries. */
export function parseAssessmentResponse(text: string): Map<string, string> {
  const assessments = new Map<string, string>();
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end <= start) return assessments;

  let entries: unknown;
  try {
    entries = JSON.parse(text.slice(start, end + 1));
  } catch {
    return assessments;
  }
  if (!Array.isArray(entries)) return assessments;

  for (const entry of entries) {
    const { id, assessment } = (entry ?? {}) as { id?: unknown; assessment?: unknown };
    if (typeof id === "string" && typeof assessment === "string") {
      assessments.set(id, assessment);
    }
  }
  return assessments;
}

/**
 * Attach assessments to a SitrepModel. Never throws: a writer failure or an
 * omitted event degrades to FALLBACK_ASSESSMENT — an LLM problem must not
 * cost the duty officer the brief (never fail silently, never crash).
 */
export async function fillAssessments(
  model: SitrepModel,
  writer: AssessmentWriter,
): Promise<SitrepModel> {
  if (model.surfaced.length === 0) return model;

  let assessments = new Map<string, string>();
  try {
    assessments = await writer(model.surfaced);
  } catch (err) {
    console.error(`assessment writer failed: ${String(err)}`);
  }

  return {
    ...model,
    surfaced: model.surfaced.map((e) => ({
      ...e,
      assessment: assessments.get(e.feedEventId) ?? FALLBACK_ASSESSMENT,
    })),
  };
}

/**
 * Production writer: headless Claude via `claude -p` (CLAUDE.md tooling).
 * Prompt goes over stdin to avoid shell-quoting issues. Thin adapter — not
 * unit-tested; exercised by the manual run.
 */
export const claudeCliWriter: AssessmentWriter = (events) =>
  new Promise((resolve, reject) => {
    const child = spawn("claude", ["-p"], {
      shell: true, // resolves claude.cmd shim on Windows
      stdio: ["pipe", "pipe", "inherit"],
    });
    let stdout = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`claude -p exited with ${code}`));
      resolve(parseAssessmentResponse(stdout));
    });
    child.stdin.end(buildAssessmentPrompt(events));
  });
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/assessment.test.ts`
Expected: PASS — 11 tests.

Run: `npm test && npm run typecheck`
Expected: all PASS, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/assessment/writer.ts test/assessment.test.ts
git commit -m "feat: injected assessment writer - prompt/parse tested, claude -p adapter, fallback on failure"
```

---

### Task 6: Renderer — `dashboard.html` (priority view)

**Files:**
- Create: `src/render/dashboard.ts`
- Create: `test/render.test.ts`

**Interfaces:**
- Consumes: `SitrepModel`, `SurfacedEvent`, `Tier` from `src/types.ts`.
- Produces: `renderDashboard(model: SitrepModel): string` — pure; complete HTML document. Priority view only this slice (ranked tier sections, colour-coded, detail cards); the map is a later layer (ADR 0010). Must HTML-escape all feed-derived text.

- [ ] **Step 1: Write the failing renderer test**

Create `test/render.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { renderDashboard } from "../src/render/dashboard.js";
import type { SitrepModel, SurfacedEvent } from "../src/types.js";

function surfaced(over: Partial<SurfacedEvent>): SurfacedEvent {
  return {
    feed: "USGS",
    feedEventId: "id-x",
    hazardType: "EQ",
    title: "M 5.8 - test quake",
    locationName: "near Testville",
    time: Date.UTC(2026, 6, 8, 0, 15),
    metrics: { mag: 5.8 },
    tier: "HIGH",
    assessment: "A strong quake near Testville.",
    ...over,
  };
}

function model(over: Partial<SitrepModel>): SitrepModel {
  return {
    generatedAt: Date.UTC(2026, 6, 8, 0, 30),
    surfaced: [],
    degradation: [],
    ...over,
  };
}

describe("renderDashboard (priority view — ADR 0005, map is a later slice)", () => {
  it("orders tier sections most-severe-first", () => {
    const html = renderDashboard(
      model({
        surfaced: [
          surfaced({ feedEventId: "c", tier: "CRITICAL", title: "crit quake" }),
          surfaced({ feedEventId: "h", tier: "HIGH", title: "high quake" }),
          surfaced({ feedEventId: "m", tier: "MODERATE", title: "mod quake" }),
        ],
      }),
    );
    const critical = html.indexOf("crit quake");
    const high = html.indexOf("high quake");
    const moderate = html.indexOf("mod quake");
    expect(critical).toBeGreaterThan(-1);
    expect(critical).toBeLessThan(high);
    expect(high).toBeLessThan(moderate);
  });

  it("renders the detail card: feed, tier, location, metrics, assessment", () => {
    const html = renderDashboard(
      model({
        surfaced: [surfaced({ metrics: { mag: 5.8, pagerAlert: "yellow" } })],
      }),
    );
    expect(html).toContain("USGS");
    expect(html).toContain("HIGH");
    expect(html).toContain("near Testville");
    expect(html).toContain("M 5.8");
    expect(html).toContain("PAGER yellow");
    expect(html).toContain("A strong quake near Testville.");
  });

  it("shows the generated-at timestamp (UTC)", () => {
    const html = renderDashboard(model({}));
    expect(html).toContain("2026-07-08T00:30:00.000Z");
  });

  it("states explicitly when a feed was unavailable (ADR 0008)", () => {
    const html = renderDashboard(
      model({ degradation: [{ feed: "USGS", reason: "HTTP 503" }] }),
    );
    expect(html).toContain("USGS feed unavailable");
    expect(html).toContain("HTTP 503");
  });

  it("shows a quiet-morning message when nothing surfaced", () => {
    const html = renderDashboard(model({}));
    expect(html).toContain("No surfaced events");
  });

  it("escapes feed-derived text (no HTML injection from feed data)", () => {
    const html = renderDashboard(
      model({
        surfaced: [
          surfaced({
            title: '<script>alert("x")</script>',
            assessment: "safe & sound",
          }),
        ],
      }),
    );
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("safe &amp; sound");
  });

  it("omits empty tier sections", () => {
    const html = renderDashboard(
      model({ surfaced: [surfaced({ tier: "CRITICAL" })] }),
    );
    expect(html).not.toContain("MODERATE");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/render.test.ts`
Expected: FAIL — cannot resolve `../src/render/dashboard.js`.

- [ ] **Step 3: Implement the renderer**

Create `src/render/dashboard.ts`:

```ts
import type { SitrepModel, SurfacedEvent, Tier } from "../types.js";

/**
 * Priority view of the daily brief (ADR 0005): ranked tier sections,
 * colour-coded, detail card per surfaced event. Static HTML, no JS needed
 * yet — the interactive map/spatial view is a later slice (ADR 0010).
 * All feed-derived text is escaped: feeds are untrusted input.
 */

const TIERS: readonly Tier[] = ["CRITICAL", "HIGH", "MODERATE"];

const TIER_META: Record<Tier, { emoji: string; colour: string }> = {
  CRITICAL: { emoji: "\u{1F534}", colour: "#c0392b" },
  HIGH: { emoji: "\u{1F7E0}", colour: "#e67e22" },
  MODERATE: { emoji: "\u{1F7E1}", colour: "#b7950b" },
};

function esc(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function metricBadges(event: SurfacedEvent): string {
  const badges: string[] = [];
  if (event.metrics.mag !== undefined) badges.push(`M ${event.metrics.mag}`);
  if (event.metrics.pagerAlert) badges.push(`PAGER ${event.metrics.pagerAlert}`);
  if (event.metrics.sig !== undefined) badges.push(`sig ${event.metrics.sig}`);
  return badges.map((b) => `<span class="metric">${esc(b)}</span>`).join(" ");
}

function detailCard(event: SurfacedEvent): string {
  const link = event.sourceUrl
    ? `<a href="${esc(event.sourceUrl)}" rel="noopener">source</a>`
    : "";
  return `
    <article class="card tier-${event.tier}">
      <header>
        <span class="feed">${esc(event.feed)}</span>
        <span class="tier">${esc(event.tier)}</span>
        <strong>${esc(event.title)}</strong>
      </header>
      <p class="meta">
        ${esc(event.locationName)} ·
        ${esc(new Date(event.time).toISOString())} ·
        ${metricBadges(event)} ${link}
      </p>
      <p class="assessment">${esc(event.assessment ?? "")}</p>
    </article>`;
}

function tierSection(tier: Tier, events: SurfacedEvent[]): string {
  if (events.length === 0) return "";
  const { emoji, colour } = TIER_META[tier];
  return `
  <section class="tier-section" style="border-left: 6px solid ${colour}">
    <h2>${emoji} ${tier} (${events.length})</h2>
    ${events.map(detailCard).join("\n")}
  </section>`;
}

function degradationNotices(model: SitrepModel): string {
  if (model.degradation.length === 0) return "";
  const items = model.degradation
    .map(
      (d) =>
        `<li><strong>${esc(d.feed)} feed unavailable</strong> this run — ${esc(d.reason)}. Events from this feed are missing below.</li>`,
    )
    .join("\n");
  return `<aside class="degradation"><ul>${items}</ul></aside>`;
}

export function renderDashboard(model: SitrepModel): string {
  const body =
    model.surfaced.length === 0
      ? `<p class="quiet">No surfaced events this run — a quiet morning.</p>`
      : TIERS.map((tier) =>
          tierSection(tier, model.surfaced.filter((e) => e.tier === tier)),
        ).join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>HADR Monitor — Situation Report</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 60rem; margin: 2rem auto; padding: 0 1rem; color: #1c2833; }
  h1 { margin-bottom: 0.25rem; }
  .generated { color: #566573; margin-top: 0; }
  .degradation { background: #fdecea; border: 1px solid #c0392b; border-radius: 6px; padding: 0.5rem 1rem; margin: 1rem 0; }
  .tier-section { margin: 1.5rem 0; padding: 0.25rem 1rem; background: #fbfcfc; border-radius: 4px; }
  .card { border-bottom: 1px solid #e5e8e8; padding: 0.75rem 0; }
  .card:last-child { border-bottom: none; }
  .feed, .tier { font-size: 0.75rem; font-weight: 700; letter-spacing: 0.05em; padding: 0.1rem 0.4rem; border-radius: 3px; background: #eaecee; margin-right: 0.5rem; }
  .tier-CRITICAL .tier { background: #c0392b; color: #fff; }
  .tier-HIGH .tier { background: #e67e22; color: #fff; }
  .tier-MODERATE .tier { background: #b7950b; color: #fff; }
  .meta { color: #566573; font-size: 0.9rem; }
  .metric { background: #eaecee; border-radius: 3px; padding: 0 0.3rem; }
  .assessment { margin: 0.25rem 0 0; }
  .quiet { color: #566573; font-style: italic; }
</style>
</head>
<body>
<h1>HADR Monitor — Situation Report</h1>
<p class="generated">Generated ${esc(new Date(model.generatedAt).toISOString())} · feeds: USGS (GDACS and ReliefWeb land in later slices)</p>
${degradationNotices(model)}
${body}
</body>
</html>`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/render.test.ts`
Expected: PASS — 7 tests.

Run: `npm test && npm run typecheck`
Expected: all PASS (usgs-parse 6, triage 10, build-sitrep 8, assessment 11, render 7), typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/render/dashboard.ts test/render.test.ts
git commit -m "feat: render priority-view dashboard.html with degradation notices (ADR 0005)"
```

---

### Task 7: Run script, fetch adapter, and the manual run

**Files:**
- Modify: `src/feeds/usgs.ts` (add `fetchUsgs`)
- Create: `src/run.ts`
- Create: `dashboard.html` (generated by the run, committed — the product)
- Modify: `implementation-notes.md` (record the run)

**Interfaces:**
- Consumes: everything above — `fetchUsgs` (new), `buildSitrep` (Task 4), `fillAssessments` + `claudeCliWriter` (Task 5), `renderDashboard` (Task 6).
- Produces: `npm run sitrep` — one manual run of the whole slice; `fetchUsgs(): Promise<FeedResult>` (never throws; failures become `status: "unavailable"`).

- [ ] **Step 1: Add `fetchUsgs` to `src/feeds/usgs.ts`**

Append to the file (below `parseFeature`):

```ts
const USGS_ALL_DAY_URL =
  "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson";

/**
 * Thin HTTP adapter — the only networked USGS code. Never throws: any
 * failure becomes a FeedResult the core turns into a degradation notice
 * (ADR 0008). Not unit-tested (no network in tests); exercised by the run.
 */
export async function fetchUsgs(): Promise<FeedResult> {
  try {
    const res = await fetch(USGS_ALL_DAY_URL, {
      headers: { "user-agent": "hadr-monitor (workshop build)" },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      return { feed: "USGS", status: "unavailable", error: `HTTP ${res.status}` };
    }
    return { feed: "USGS", status: "ok", rawPayload: await res.json() };
  } catch (err) {
    return { feed: "USGS", status: "unavailable", error: String(err) };
  }
}
```

And extend the type import at the top of the file:

```ts
import type { Event, FeedResult, PagerAlert } from "../types.js";
```

- [ ] **Step 2: Create `src/run.ts`**

```ts
import { writeFileSync } from "node:fs";
import { fetchUsgs } from "./feeds/usgs.js";
import { buildSitrep } from "./core/buildSitrep.js";
import { claudeCliWriter, fillAssessments } from "./assessment/writer.js";
import { renderDashboard } from "./render/dashboard.js";

/**
 * One run of the agent (v1 slice): pull → filter → assess → render.
 * Snapshots and scheduling land in later slices (ADR 0010).
 */
const usgs = await fetchUsgs();
const model = buildSitrep([usgs], null, new Date());

console.log(
  `surfaced ${model.surfaced.length} event(s)` +
    (model.degradation.length
      ? `; feeds unavailable: ${model.degradation.map((d) => d.feed).join(", ")}`
      : ""),
);

const assessed = await fillAssessments(model, claudeCliWriter);
writeFileSync("dashboard.html", renderDashboard(assessed), "utf8");
console.log("wrote dashboard.html");
```

- [ ] **Step 3: Full test suite and typecheck still green**

Run: `npm test && npm run typecheck`
Expected: all 42 tests PASS, typecheck clean. (No new tests: `fetchUsgs` and `run.ts` are thin networked/orchestration adapters — the seam already covers the logic.)

- [ ] **Step 4: The manual run (the slice's definition of done)**

Run: `npm run sitrep`
Expected output shape:

```
surfaced N event(s)
wrote dashboard.html
```

(N varies with the day's real seismicity; the LLM step takes ~30–90s.)

Then open `dashboard.html` in a browser and verify by eye:
- tier sections ordered CRITICAL → HIGH → MODERATE, colour-coded;
- each card shows feed badge, tier badge, title, place, M/PAGER metrics, an assessment narrative;
- the generated-at timestamp is current.

If USGS happens to be unreachable, the page must instead show the "USGS feed unavailable" degradation notice — that is also a passing run (never fail silently).

- [ ] **Step 5: Record the run in `implementation-notes.md`**

Under `## Decisions`, add:

```markdown
- **2026-07-08 — v1 slice complete: first manual run.** `npm run sitrep`
  fetched live USGS data, filtered/tiered deterministically, wrote assessments
  via `claude -p`, and rendered `dashboard.html` (priority view only; map,
  other feeds, snapshots, and scheduling are later slices per ADR 0010).
```

- [ ] **Step 6: Commit the slice**

```bash
git add src/feeds/usgs.ts src/run.ts dashboard.html implementation-notes.md
git commit -m "feat: run script + USGS fetch adapter; first manual sitrep run (v1 slice complete)"
```

---

## Self-Review (done at planning time)

1. **Spec coverage** — ADR 0010 slice = USGS ✓ (Tasks 2, 7) → threshold filter ✓ (Task 3) → LLM assessment ✓ (Task 5) → render dashboard.html ✓ (Task 6) → one manual run ✓ (Task 7). Seam contract from `docs/PRD.md` ✓ (Task 4, including `priorSnapshot` accepted-but-unused). Graceful degradation ✓ (Tasks 4, 6, 7). Out-of-slice items (map, GDACS/ReliefWeb, snapshots, scheduling) deliberately absent and noted.
2. **Placeholder scan** — every code step contains complete code; no TBDs.
3. **Type consistency** — `FeedResult`/`SitrepModel`/`SurfacedEvent` defined once in Task 2 and imported everywhere; `parseUsgs`/`fetchUsgs` names consistent across Tasks 2/4/7; `AssessmentWriter` map keyed by `feedEventId` in both Task 5 code and Task 4's no-assessment test.
