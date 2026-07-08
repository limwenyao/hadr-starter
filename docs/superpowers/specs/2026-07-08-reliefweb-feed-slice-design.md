# ReliefWeb (RSS) feed slice — design

- Date: 2026-07-08
- Status: Approved (brainstorming)
- Slice: third v1-breadth feed (ADR 0010 order: GDACS ✓ → **ReliefWeb** → map →
  snapshots → schedule)

## Goal

Add ReliefWeb as a third feed behind the `buildSitrep` seam, consumed via **RSS**
in v1 (no `appname` approval needed — ADR 0008), structured so the approved-API
implementation can drop in later behind the same interface (CLAUDE.md #7).

## Non-goals

- No ReliefWeb API client (deferred until the `appname` is approved — ADR 0008).
- No GLIDE-based cross-feed correlation (ADR 0007 defers full correlation; USGS and
  GDACS do not expose GLIDE).
- No coordinates / map pins (ReliefWeb is country-level — ADR 0005/0008).

## Swappable interface (CLAUDE.md #7 / ADR 0008)

`src/feeds/reliefweb.ts`:

```ts
export interface ReliefWebSource {
  readonly feed: "ReliefWeb";
  fetch(): Promise<FeedResult>;
  parse(rawPayload: unknown): Event[];
}
```

- `rssReliefWebSource: ReliefWebSource` — the v1 RSS implementation.
- `export const reliefWebSource = rssReliefWebSource;` — the single active binding.
  `run.ts` calls `reliefWebSource.fetch()`; `buildSitrep` uses `reliefWebSource.parse`.
  Swapping to the API later = add `apiReliefWebSource` and flip this one binding.

## Adapter / parse

- `fetch()` — thin HTTP against `https://reliefweb.int/disasters/rss.xml`, 30s
  timeout, polite user-agent; `rawPayload` is the response **XML text**
  (`await res.text()`); any failure → `{ feed: "ReliefWeb", status: "unavailable",
  error }` (ADR 0008). Not unit-tested (no network in tests).
- `parse(xml)` — pure, fixture-tested. Uses `fast-xml-parser` (with
  `isArray` forcing `item` to always be an array) to read `rss.channel.item[]`,
  maps each to an `Event`, skips malformed, never throws.

Field mapping (RSS `<item>` → `Event`):

| Event field    | Source                                                        |
|----------------|---------------------------------------------------------------|
| `feed`         | `"ReliefWeb"`                                                 |
| `feedEventId`  | `<link>` — stable per-disaster URL                            |
| `hazardType`   | GLIDE prefix (`EQ-2026-000093-VEN` → `EQ`); else `"unknown"`  |
| `title`        | `<title>`                                                     |
| `locationName` | "Affected country" tag from description; else title before `:`|
| `coordinates`  | undefined (country-level — ADR 0008)                          |
| `time`         | `<pubDate>` (RFC-822 with offset) → epoch ms, via `isValidEventTime` |
| `metrics`      | all undefined (ReliefWeb carries no severity metric)          |
| `sourceUrl`    | `<link>`                                                      |

The `description` is HTML-with-entities; `fast-xml-parser` decodes entities, and we
string-scan the decoded text for the `Affected country:` and `Glide:` tags.

## Rules (ADR 0004 verbatim) — `src/core/triage.ts`

- `passesNoiseFloor`: ReliefWeb → **all items surface** (human-curated).
- `tierFor`: ReliefWeb → **HIGH** (no magnitude; presence alone warrants prominence).

## Duplicate flagging

`flagDuplicates` is reused **unchanged**. ReliefWeb has no coordinates, so the
haversine predicate never matches it → ReliefWeb never dedups in v1. Consistent with
ADR 0007 (GLIDE-based correlation deferred). Documented, not coded.

## Wiring & render

- `src/run.ts`: add `reliefWebSource.fetch()` to the concurrent `Promise.all`.
- `src/core/buildSitrep.ts`: add `ReliefWeb: reliefWebSource.parse` to `PARSERS`.
- `src/render/dashboard.ts`: no card change needed (a metric-less, coordinate-less
  event already renders — empty `metricBadges`). Update the "feeds:" line to list all
  three feeds.

## Testing (offline, fixture-driven — CLAUDE.md test rules)

- `test/fixtures/reliefweb-disasters.xml` + `test/reliefweb-parse.test.ts`: item
  count; field mapping; GLIDE → hazardType; country extraction; entity decoding;
  RFC-822 `pubDate` → UTC; single-item (object, not array) handled; malformed-item
  skip; non-XML / empty → `[]`.
- `test/build-sitrep.test.ts`: ReliefWeb all-surface + HIGH tier; a ReliefWeb item
  co-located and simultaneous with a USGS quake is **not** flagged duplicate (no
  coordinates).
- `test/render.test.ts`: a ReliefWeb card renders (HIGH, source link, no metric
  badges).

## Judgment calls (locked) → recorded in `implementation-notes.md`

1. **`fast-xml-parser` added** — the repo's first runtime dependency; chosen for
   robust XML (CDATA/entities/malformed) over a fragile hand-rolled parser.
2. **`feedEventId = <link>`** — the stable per-disaster identity.
3. **ReliefWeb does not participate in duplicate flagging** (no coordinates) — a v1
   limitation per ADR 0007.
4. **Description prose is not fed to the assessment prompt** — parity with the other
   feeds; title + location drive the narrative. Prompt-injection remains the accepted
   v1 risk.

No new ADR (0004/0007/0008 cover the decisions).
