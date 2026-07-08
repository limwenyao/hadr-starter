# ADR 0002 — Run on GitHub Actions cron, daily at 08:30 SGT

- Status: Accepted
- Date: 2026-07-08

## Context

The agent must run unattended on a schedule (ADR 0001) and publish once daily at
08:30 Singapore time. Options considered: a hosted always-on scheduler/server, a
local machine cron, or CI-based cron. The repository already contains `.github/`
and the workshop expects `@claude` PR review via the GitHub app.

## Decision

Run the agent as a **GitHub Actions scheduled workflow (cron)**, firing once daily
timed to **08:30 SGT** (UTC+8; cron expressed in UTC). Secrets (e.g. LLM API key,
future ReliefWeb appname) live in repository/organisation secrets.

## Consequences

- Free, reliable, no server to operate; runs even when no one is online.
- GitHub Actions cron is best-effort and may start a few minutes late — acceptable
  for a morning brief.
- The workflow commits its output and snapshots back to the repo (see ADR 0006),
  giving a git-history audit trail.
- Note: GitHub disables scheduled workflows on repos with no recent activity — must
  be considered for long-idle periods.
