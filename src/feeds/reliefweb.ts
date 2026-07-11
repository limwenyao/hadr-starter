import { XMLParser } from "fast-xml-parser";
import type { Event, FeedResult } from "../types.js";
import { isValidEventTime } from "../time.js";

/**
 * ReliefWeb feed (feeds/reliefweb.md). UN OCHA's curated humanitarian disasters.
 *
 * Consumed via RSS in v1 — the API needs a pre-approved `appname` that may not
 * arrive in time (ADR 0008). The fetch+parse live behind `ReliefWebSource` so the
 * approved-API implementation can drop in later by flipping one binding
 * (`reliefWebSource`) without touching the seam or the run (CLAUDE.md #7).
 *
 * RSS is country-level only: no coordinates, no severity metrics. Every curated
 * item surfaces and is HIGH priority (ADR 0004). Because there are no coordinates,
 * ReliefWeb never participates in the spatial duplicate heuristic (ADR 0007).
 */
export interface ReliefWebSource {
  readonly feed: "ReliefWeb";
  fetch(): Promise<FeedResult>;
  parse(rawPayload: unknown): Event[];
}

export const RELIEFWEB_RSS_URL = "https://reliefweb.int/disasters/rss.xml";

// Always treat <item> as an array — a single-item channel would otherwise parse
// to a bare object. Entities in text nodes are decoded by default.
const parser = new XMLParser({
  ignoreAttributes: true,
  isArray: (name) => name === "item",
});

interface RssItem {
  title?: unknown;
  link?: unknown;
  pubDate?: unknown;
  description?: unknown;
}

/** Pure XML → Event[] normaliser. Skips malformed items; never throws. */
export function parseReliefWeb(rawPayload: unknown): Event[] {
  if (typeof rawPayload !== "string" || rawPayload.length === 0) return [];

  let items: unknown;
  try {
    items = parser.parse(rawPayload)?.rss?.channel?.item;
  } catch {
    return []; // malformed XML is data, not a crash (ADR 0008)
  }
  if (!Array.isArray(items)) return [];

  const events: Event[] = [];
  for (const raw of items) {
    const event = parseItem(raw as RssItem);
    if (event) events.push(event);
  }
  return events;
}

function parseItem(item: RssItem | null): Event | undefined {
  if (!item || typeof item.link !== "string" || item.link.length === 0) {
    return undefined;
  }
  const time = parsePubDate(item.pubDate);
  if (time === undefined) return undefined;

  const title = typeof item.title === "string" ? item.title : item.link;
  const description = typeof item.description === "string" ? item.description : "";
  const glide = matchTag(description, /Glide:\s*([A-Za-z]{2}-\d{4}-\d{6}-[A-Za-z]{3})/);
  const country = matchTag(description, /Affected country:\s*([^<\n]+?)\s*(?:<|$)/);

  return {
    feed: "ReliefWeb",
    feedEventId: item.link,
    hazardType: glide ? glide.split("-")[0].toUpperCase() : "unknown",
    title,
    locationName: country ?? titlePrefix(title),
    // No coordinates and no severity metrics — country-level curation (ADR 0008).
    time,
    metrics: {},
    sourceUrl: item.link,
  };
}

/** ReliefWeb pubDate is RFC-822 with an explicit offset; Date.parse handles it. */
function parsePubDate(raw: unknown): number | undefined {
  if (typeof raw !== "string") return undefined;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) && isValidEventTime(ms) ? ms : undefined;
}

function matchTag(text: string, re: RegExp): string | undefined {
  const m = re.exec(text);
  return m ? m[1].trim() : undefined;
}

/** "Venezuela: Earthquakes - Jun 2026" → "Venezuela". */
function titlePrefix(title: string): string {
  const i = title.indexOf(":");
  return i > 0 ? title.slice(0, i).trim() : title;
}

export const rssReliefWebSource: ReliefWebSource = {
  feed: "ReliefWeb",
  parse: parseReliefWeb,
  /**
   * Thin HTTP adapter — never throws: any failure becomes a FeedResult the core
   * turns into a degradation notice (ADR 0008). Not unit-tested (no network).
   */
  async fetch(): Promise<FeedResult> {
    try {
      const res = await fetch(RELIEFWEB_RSS_URL, {
        headers: { "user-agent": "hadr-monitor (workshop build)" },
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) {
        return { feed: "ReliefWeb", status: "unavailable", error: `HTTP ${res.status}` };
      }
      return { feed: "ReliefWeb", status: "ok", rawPayload: await res.text() };
    } catch (err) {
      return { feed: "ReliefWeb", status: "unavailable", error: String(err) };
    }
  },
};

/**
 * The active ReliefWeb source. v1 = RSS; swap to the approved-`appname` API later
 * by pointing this at an `apiReliefWebSource` — the only line that changes.
 */
export const reliefWebSource: ReliefWebSource = rssReliefWebSource;
