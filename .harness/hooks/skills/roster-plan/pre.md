---
name: plan-claims-freshness
version: 1.0.0
event: pre
skill: roster-plan
on_error: stop
description: Abort planning when managed claims projections or task context are stale.
---

```yaml
steps:
  - include: shared/claims-freshness.md
```
