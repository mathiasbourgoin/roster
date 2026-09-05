---
name: qa-review-gate
version: 1.0.0
event: pre
skill: roster-qa
on_error: stop
description: Abort QA unless the review verdict is GO.
---

Blocks `roster-qa` unless `briefs/<task>-review.json` exists and its `status` is
`GO`. QA is gated on a passing review — running it on a NO-GO (or missing)
review wastes cycles and hides the real blocker.

```yaml
steps:
  - log: "⏳ qa-review-gate: checking review verdict..."

  - test: "[ -n \"$TASK\" ]"
    on_false:
      - log: "ERROR: $TASK is not set — cannot locate review verdict"
      - run: "exit 1"

  - test: "[ -f \"briefs/${TASK}-review.json\" ]"
    on_false:
      - log: "MISSING: briefs/${TASK}-review.json not found — run /roster-review first"
      - run: "exit 1"

  - test: "[ \"$(jq -r '.status' \"briefs/${TASK}-review.json\" 2>/dev/null)\" = \"GO\" ]"
    on_true:
      - log: "✓ review is GO — proceeding to QA"
    on_false:
      - log: "BLOCKED: review verdict is not GO — resolve review findings before QA"
      - run: "exit 1"

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
