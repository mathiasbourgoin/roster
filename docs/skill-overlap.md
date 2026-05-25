# Skill Overlap Guide

## Audit skills

Use the right audit skill for your goal:

| Goal | Skill |
|------|-------|
| Full quality + compliance sweep | `/roster-audit` (combines code-quality + spec-compliance) |
| Code structure, naming, duplication | `/code-quality-auditor` |
| Spec ACs not implemented | `/spec-compliance-auditor` |
| Vague requirements, contradictions in KB | `/ambiguity-auditor` |
| KB harness structure coherence | `/harness-validator` |

## Spec skills

| Goal | Skill |
|------|-------|
| Write spec for a NEW feature | `/roster-spec` |
| Reverse-engineer spec from EXISTING code | `/roster-spec-infer` |

## Research skills

| Goal | Skill |
|------|-------|
| Prepare research questions (blind) | `/roster-question` |
| Transform task into validated brief | `/roster-intake` |
| Execute web/codebase research | `/roster-research` |

> **Rule:** `/roster-question` → `/roster-research` → `/roster-intake` in that order. Never skip intake.
