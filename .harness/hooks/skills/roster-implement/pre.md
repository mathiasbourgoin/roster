---
name: implement-plan-reminder
version: 1.0.0
event: pre
skill: roster-implement
on_error: warn
description: Advisory check that Full-mode plan sub-briefs exist before implementation. Warns, never blocks (Fast/Express skip planning).
---

Reminds — but does **not** block — when the plan sub-briefs are absent. In Full
mode `/roster-plan` produces `briefs/<task>-implementer.md` and
`briefs/<task>-reviewer.md`; in Fast/Express mode there is no plan phase, so a
missing sub-brief is expected. This hook surfaces the situation as a warning so
a forgotten Full-mode plan is noticed, without breaking the shorter modes.

```yaml
steps:
  - log: "⏳ implement-plan-reminder: checking for plan sub-briefs..."

  - test: "[ -z \"$TASK\" ] || [ -f \"briefs/${TASK}-implementer.md\" ]"
    on_true:
      - log: "✓ implementer sub-brief present (or Fast/Express run) — proceeding"
    on_false:
      - log: "NOTE: briefs/${TASK}-implementer.md absent. Fine for Fast/Express; if this is a Full-mode task, run /roster-plan first."
```
