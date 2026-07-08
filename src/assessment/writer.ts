import { spawn } from "node:child_process";
import type { SitrepModel, SurfacedEvent } from "../types.js";
import { formatUtc } from "../time.js";

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
    // JSON.stringify drops undefined-valued keys, so feed-specific metrics only
    // appear when present (magnitude for USGS, alertLevel for GDACS).
    JSON.stringify({
      id: e.feedEventId,
      feed: e.feed,
      tier: e.tier,
      hazardType: e.hazardType,
      title: e.title,
      location: e.locationName,
      timeUtc: formatUtc(e.time),
      magnitude: e.metrics.mag,
      pagerAlert: e.metrics.pagerAlert,
      alertLevel: e.metrics.alertLevel,
      sig: e.metrics.sig,
      likelyDuplicateOf: e.duplicateOf
        ? `${e.duplicateOf.feed} — ${e.duplicateOf.title}`
        : undefined,
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
  // Return a fresh object (not the input) so callers never share mutable state.
  if (model.surfaced.length === 0) return { ...model };

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
    const child = spawn("claude -p", {
      shell: true, // resolves the claude.cmd shim on Windows
      stdio: ["pipe", "pipe", "inherit"],
    });
    let stdout = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.on("error", reject);
    child.stdin.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`claude -p exited with ${code}`));
      resolve(parseAssessmentResponse(stdout));
    });
    child.stdin.end(buildAssessmentPrompt(events));
  });
