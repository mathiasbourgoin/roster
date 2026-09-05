---
name: intake-claims-freshness
version: 1.0.0
event: pre
skill: roster-intake
on_error: stop
description: Abort intake when managed claims projections or existing task context are stale.
---

```yaml
steps:
  - include: shared/claims-freshness.md
```
