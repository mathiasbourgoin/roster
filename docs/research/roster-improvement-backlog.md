# Roster improvement backlog (local, not committed)

## FUTURE — lean general pipeline skills + specialized subskill plugins
**Noted 2026-05-30 (user).** Several pipeline skills mix the general flow with
context/stack-specific content that bloats the always-loaded main file — e.g.
`roster-qa.md` carries a **TUI/tmux matrix** section; implement/qa carry language hints
(OCaml thresholds), etc.

Direction: make each pipeline skill a **lean, general main file** and push
context-specific behavior into **specialized subskill plugins / bundled references**
loaded on demand (the progressive-disclosure pattern already built for bounty-skills, and
the #4 stack-bundle mechanism). Examples to extract:
- roster-qa: TUI/tmux matrix → a `tui` subskill/bundle (activated when TUI scope detected).
- roster-implement: OCaml/`ocaml-dune-specialist` + language thresholds → stack bundles.
- check-spec-trace.sh distribution: project roster scripts into consumer harnesses (the
  #1 known-limitation) — same projection mechanism as stack bundles.

This composes with #4 (stack-specific bundles) and the bundled-reference pipeline
(sync-harness resource projection). Do as part of, or right after, #4.

## In progress (branch roster-evol/decision-memory)
- [x] #3 decision memory (ADR query/capture) — committed 297f932
- [x] #1 spec↔code↔test traceability + check-spec-trace — committed 54e9af3
- [ ] #2 entity model (kb/entities.md) + use-case flows
- [ ] #4 stack-specific skill bundles (+ fold in the lean-main/subskill direction above)
