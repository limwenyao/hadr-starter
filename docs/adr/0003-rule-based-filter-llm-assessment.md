# ADR 0003 — Rule-based filtering, LLM-written assessment

- Status: Accepted
- Date: 2026-07-08

## Context

Two ways to decide what is worth reporting and how to describe it: fixed
rules/thresholds (auditable, predictable, cheap, but "dumb") versus LLM judgement
(context-aware, catches nuance, but less predictable and needs guardrails). The
cardinal trust rule is **never miss a major event** (ADR 0004), which favours
deterministic recall for the *selection* step.

## Decision

Split the labour:

- **Filtering / selection is rule-based** — the conservative noise floor and the
  priority-tier rules (ADR 0004) decide *which* events surface and *what tier* they
  are. Fully deterministic and auditable.
- **Assessment is LLM-written** — for each surfaced event the LLM writes the
  narrative (*what happened, where, how bad, who is affected*): full prose for
  Critical/High, terser for Moderate. The LLM describes; it does **not** decide
  inclusion or severity tier.

## Consequences

- Which events appear (and why) is reproducible and explainable without running a
  model — important for trust and debugging.
- LLM cost is bounded to a narrative pass over already-filtered events.
- The LLM cannot cause a major event to be dropped (recall protected).
- Prompting/guardrails needed so assessments stay grounded in feed data and never
  overstate severity; hallucination risk is confined to prose, not to selection.
