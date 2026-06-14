---
name: implement-plan-reminder
version: 1.1.0
event: pre
skill: roster-implement
on_error: stop
description: In Full mode (plan.md present), aborts if both implementer.md AND reviewer.md are absent; warns if only one is missing. Fast/Express (no plan.md) skip this check entirely.
---

Blocks `roster-implement` in Full mode when `/roster-plan`'s output contract was
violated (neither `briefs/<task>-implementer.md` nor `briefs/<task>-reviewer.md`
produced). In Fast/Express mode there is no plan phase so missing sub-briefs are
expected — the check is skipped entirely when `briefs/<task>-plan.md` is absent.

Detects Full mode via `briefs/<task>-plan.md` existence (written by `roster-plan`).
Aborts on both-absent (roster-plan was skipped). Warns on one-absent (partial run).

```yaml
steps:
  - log: "⏳ implement-plan-reminder: checking for plan sub-briefs..."

  - test: "[ -n \"$TASK\" ] && [ -f \"briefs/${TASK}-plan.md\" ]"
    on_false:
      - log: "✓ Fast/Express run (no plan.md) or TASK unset — skipping sub-brief check"
    on_true:
      - log: "ℹ Full mode (plan.md found) — checking implementer.md and reviewer.md"

  - test: "[ -z \"$TASK\" ] || [ ! -f \"briefs/${TASK}-plan.md\" ] || [ -f \"briefs/${TASK}-implementer.md\" ] || [ -f \"briefs/${TASK}-reviewer.md\" ]"
    on_true:
      - log: "✓ at least one sub-brief present (or non-Full-mode run)"
    on_false:
      - log: "⛔ ABORT: briefs/${TASK}-plan.md present (Full mode) but neither implementer.md nor reviewer.md found — roster-plan output contract violated. Run /roster-plan first."
      - run: "exit 1"

  - test: "[ -z \"$TASK\" ] || [ ! -f \"briefs/${TASK}-plan.md\" ] || { [ -f \"briefs/${TASK}-implementer.md\" ] && [ -f \"briefs/${TASK}-reviewer.md\" ]; }"
    on_true:
      - log: "✓ both sub-briefs present"
    on_false:
      - log: "⚠ WARN: Full mode with only one sub-brief present. If reviewer.md is absent, roster-review will infer scope from diff alone."
```
