---
name: tech-lead
display_name: Tech Lead
description: Frontmatter coordinates implementation and review.
domain: [management, orchestration]
tags: [team-lead, review, qa]
model: opus
complexity: high
compatible_with: [claude-code, codex]
version: 9.9.9
author: mathias
isolation: none
pipeline_role:
  triggered_by: fixture
  receives: fixture task
  produces: fixture plan
  human_gate: none
---

# Tech Lead

Fixture markdown used by TA dashboard roster metadata tests.
