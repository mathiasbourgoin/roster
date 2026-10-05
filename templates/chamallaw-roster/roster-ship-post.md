---
name: chamallaw-feedback-after-ship
version: 1.0.0
event: post
skill: roster-ship
on_error: warn
description: Request evidenced Chamallaw feedback after a terminal Roster ship.
---

```yaml
steps:
  - prompt: |
      If $TASK is set and .harness/chamallaw-shadow.json exists, inspect the
      task's Chamallaw shadow sidecar and terminal ship artifacts. Only when an
      independently evidenced binary outcome and an RFC3339 observed time are
      present, invoke chamallaw-feedback with the configured contract ID. It
      may only submit evidence; it must not verify it or claim that the model
      changed. If the required evidence is absent, write a pending feedback
      sidecar/request and do not call a Chamallaw mutation tool.
    agent: tech-lead
```
