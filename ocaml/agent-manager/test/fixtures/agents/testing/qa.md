---
name: qa
display_name: QA
description: Frontmatter verifies behavior with deterministic checks.
domain: [testing, qa]
tags: [qa, tmux, verification]
model: haiku
complexity: medium
compatible_with: [claude-code, codex]
version: 4.2.0
author: mathias
isolation: none
pipeline_role:
  triggered_by: fixture
  receives: fixture implementation
  produces: fixture QA report
  human_gate: none
---

# QA

Fixture markdown used by TA dashboard roster metadata tests.
