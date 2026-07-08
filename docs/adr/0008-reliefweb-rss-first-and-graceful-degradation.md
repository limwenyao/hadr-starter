# ADR 0008 — ReliefWeb via RSS first; graceful degradation on feed failure

- Status: Accepted
- Date: 2026-07-08

## Context

The ReliefWeb API requires a pre-approved `appname` (since 1 Nov 2025), obtained via
a form and email that may not arrive within the build window; without it the API
returns 403. Its RSS feed needs no approval but is thinner (no coordinates,
country-level only). Separately, all feeds can be down or rate-limited, and the
cardinal rule is to never fail silently or miss events.

## Decision

- **Consume ReliefWeb via RSS in v1** (no approval needed). Structure the ingestion
  so the approved-`appname` API can drop in later behind the same interface. Do not
  block the build on the approval email.
- **Graceful degradation:** if any feed is unavailable (down, rate-limited,
  unapproved), the run continues on the remaining feeds and the brief **explicitly
  states** which feed was unavailable that morning. The run never crashes and never
  silently omits a feed without saying so.
- Poll politely (feeds publish no firm rate limits); back off on errors.

## Consequences

- The build is unblocked regardless of the appname timeline.
- ReliefWeb events are country-level only in v1 → list-only, never map-pinned
  (consistent with ADR 0005/0007).
- The brief is honest about coverage gaps, preserving trust when a source fails.
- Upgrading ReliefWeb to the full API later is a localized change, not a rewrite.
