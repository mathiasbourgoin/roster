---
name: chamallaw-shadow-after-intake
version: 1.0.0
event: post
skill: roster-intake
on_error: warn
description: Request an observation-only Chamallaw shadow after deterministic intake routing.
---

```yaml
steps:
  - prompt: |
      If $TASK is set and .harness/chamallaw-shadow.json exists, read that file
      and the completed deterministic Roster intake artifacts for $TASK. Invoke
      chamallaw-shadow with task=$TASK, its default_contract_id, and the route
      already retained by Roster. The Chamallaw signal is observation-only:
      never alter routing and never call a mutation tool. If the MCP or
      contract is unavailable, write the required unavailable/error sidecar and
      retain the deterministic route. If no deterministic route is present,
      do nothing and explain why.
    agent: tech-lead
```
