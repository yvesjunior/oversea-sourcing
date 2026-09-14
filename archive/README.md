# Archived companion pages

Three Claude artifacts that accompanied the OSI decision record, saved here
verbatim on 2026-09-13 before the published copies were removed. **Each one is
a dated snapshot and describes a state the code has left behind** — read them
as history, never as a description of the running system. The current record
is the decision record in [`README.md`](../README.md#adr-001-part-i)
and its published twin, *The OSI Decision Record*.

| File | Was | Dated | What the decision record took from it |
|---|---|---|---|
| [`2026-08-17-request-pipeline-teardown.html`](2026-08-17-request-pipeline-teardown.html) | *OSI Request Pipeline* — a code teardown at `2d95dec` proving that no AI ran anywhere, the pipeline was two `sleep()` calls and scoring ignored the criteria | 2026-08-17 | Nothing — it records what the code *was*. Every claim in it became false with E4/E5 (2026-08-16/22) and the relevance gate (2026-08-29). |
| [`2026-08-22-platform-architecture-review.html`](2026-08-22-platform-architecture-review.html) | *OSI Platform Architecture* — current-vs-target review before Phase A: runtime, component interactions, the target sourcing engine, the delta table, the queueing recommendation, build order, debts | 2026-08-22 | Part 0 (the six-service runtime, the no-broker reasoning) and, on 2026-09-13, the overload/scale-ladder table. Its target flow still shows `alibaba` and `registry-us` as discovery connectors — superseded by ADR-001 Part I §1–§2. |
| [`2026-08-29-parcours-swimlane.html`](2026-08-29-parcours-swimlane.html) | *Parcours OSI — de la demande à la livraison* — the owner-validated 16 steps as a three-lane swimlane (acheteur · OSI · tiers), described in French, with the open points per step | 2026-08-29 | The 16-step table (2026-09-07) and, on 2026-09-13, the swimlane itself, redrawn in the record's own figure style with today's build state. Its "built: steps 1–4" masthead and the relevance-gate reserve were true on the morning of 2026-08-29 and not by the evening. |

The two original ADRs these pages sat beside are in git history at `8dd740d`.
