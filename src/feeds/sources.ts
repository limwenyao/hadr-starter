import type { FeedName } from "../types.js";
import { USGS_ALL_DAY_URL } from "./usgs.js";
import { GDACS_EVENTS_URL } from "./gdacs.js";
import { RELIEFWEB_RSS_URL } from "./reliefweb.js";

/** Presentation metadata for the Data Sources tab. Single tunable place. */
export interface FeedSource {
  feed: FeedName;
  description: string;
  /** Human homepage to link to. */
  homeUrl: string;
  /** Display text for the homepage link. */
  homeLabel: string;
  /** The machine endpoint we actually fetch (reused from the adapter). */
  feedUrl: string;
}

export const FEED_SOURCES: readonly FeedSource[] = [
  {
    feed: "USGS",
    description: "Real-time global earthquakes — magnitude and PAGER impact alerts.",
    homeUrl: "https://earthquake.usgs.gov",
    homeLabel: "earthquake.usgs.gov",
    feedUrl: USGS_ALL_DAY_URL,
  },
  {
    feed: "GDACS",
    description:
      "Multi-hazard disaster alerts — earthquakes, cyclones, floods, volcanoes — with colour-coded alert levels.",
    homeUrl: "https://www.gdacs.org",
    homeLabel: "gdacs.org",
    feedUrl: GDACS_EVENTS_URL,
  },
  {
    feed: "ReliefWeb",
    description: "UN OCHA humanitarian situation reports and disaster updates.",
    homeUrl: "https://reliefweb.int",
    homeLabel: "reliefweb.int",
    feedUrl: RELIEFWEB_RSS_URL,
  },
];
