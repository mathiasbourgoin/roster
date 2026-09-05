---
name: review-claims-freshness
version: 1.0.0
event: pre
skill: roster-review
on_error: stop
description: Abort review when managed claims projections or task context are stale.
---

```yaml
steps:
  - include: shared/claims-freshness.md
```
