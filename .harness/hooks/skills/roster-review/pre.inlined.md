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
  - test: '[ ! -f scripts/claims-reconcile.js ] && [ ! -f .harness/bin/claims-reconcile.js ]'
    on_true:
      - log: "claims-freshness: reconciler absent - legacy path"
    on_false:
      - run: 'CLI=scripts/claims-reconcile.js; [ -f "$CLI" ] || CLI=.harness/bin/claims-reconcile.js; node "$CLI" check --root .'

  - test: '[ -z "$TASK" ] || [ ! -f "roster/${TASK}/context.manifest.json" ] || { CLI=scripts/claims-reconcile.js; [ -f "$CLI" ] || CLI=.harness/bin/claims-reconcile.js; current=$(node "$CLI" context --root . | jq -r .freshness_digest); stored=$(jq -r .freshness_digest "roster/${TASK}/context.manifest.json"); [ -n "$current" ] && [ "$current" = "$stored" ]; }'
    on_false:
      - log: "BLOCKED: task context manifest is stale"
      - run: "exit 1"
```
