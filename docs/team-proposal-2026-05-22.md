# Team Proposal 2026-05-22: TA Agent Manager Roster

## Context

TA is now an OCaml/MIAOU/tmux product inside `agent-roster`. The next product
goal is not more dashboard rendering; it is a Herdr-level operational TUI where
starting a Codex `tech-lead` is a two-selection workflow, agents can connect to
other agents, and only privileged roster actors can create or install new
agents.

The current local runtime surfaces are not good enough for that:

- No canonical `.harness/harness.json` exists.
- `.opencode/agents/` has a generic `implementer`, `reviewer`, `qa`,
  `architect`, `recruiter`, and `tech-lead`.
- `.claude/agents/` only has an older `tech-lead` (`1.5.0`) while the roster
  source has `tech-lead` `1.9.0`.
- The source roster has OCaml-specific agents that are not installed in the
  runtime team.
- There is no terminal-product/TUI reviewer role, even though the next TA work
  needs Herdr comparison, screenshot/tmux capture review, and workflow
  simplicity checks.

## Proposed Team

### Lead

- **Recommended:** `tech-lead` (source `agents/management/tech-lead.md`,
  score 26) — owns the infinite roadmap loop, merge gates, review/QA routing,
  and privileged decisions about agent creation.
- Alternative: no lead — rejected. The recruiter requires a lead slot before
  any useful team can function.

### Planning

- **Recommended:** `planner` (source `agents/management/planner.md`, score 24)
  — turns the validated roadmap brief into compressed sub-briefs for
  implementers, reviewers, QA, and specialists.
- Alternative: `tech-lead` only — acceptable for tiny loops, but worse for the
  large TA build because it mixes research context with execution packaging.

### Implementation

- **Recommended:** `ocaml-implementer`
  (source `agents/backend/ocaml-implementer.md`, score 27) — primary TA
  implementation agent for OCaml, dune, Result-style errors, strong typing, and
  small-file discipline.
- Alternative: generic `implementer` (score 22) — keep as a fallback for
  TypeScript/roster-script work, not as the TA default implementer.

### OCaml/Dune Specialist

- **Recommended:** `ocaml-dune-specialist`
  (source `agents/specialist/ocaml-dune-specialist.md`, score 27) — on-demand
  specialist for opam switch issues, dune libraries, `.mli` boundaries, opam
  metadata, MIAOU package wiring, and local-switch failures.
- Alternative: `architect` (score 21) — can review structure but is not a
  build/package specialist.

### Review

- **Recommended:** `reviewer` (source `agents/testing/reviewer.md`, score 24)
  — correctness/security/regression review for each implementation loop.
- Alternative: `architect` only — rejected for merge review because it
  underweights behavior regressions.

### QA

- **Recommended:** `qa` (source `agents/testing/qa.md`, score 24) — runs local
  switch build/test/format plus tmux Matrix TUI smoke. For TA work, its tunables
  should require real tmux execution when UI/runtime behavior changes.
- Alternative: implementer self-test only — rejected for TUI work because the
  previous regressions were caught by independent review/QA.

### Architecture

- **Recommended:** `architect` (source `agents/management/architect.md`, score
  24) — checks file size, boundaries, duplication, typed design, and whether
  TA’s abstractions are becoming accidental complexity.
- Alternative: reviewer only — acceptable for narrow bug fixes, but weaker for
  TA’s long-running architecture.

### Harness And Agent-Creation Governance

- **Recommended:** `harness-builder`
  (source `agents/management/harness-builder.md`, score 25) — builds the
  canonical `.harness`, projects to `.opencode`, `.claude`, and Codex surfaces,
  and enforces that generated runtime files are projections.
- Alternative: `recruiter` runtime agent only — useful for proposals, but not
  enough to own harness projection and coherence.

### Tooling And MCP Gate

- **Recommended:** `mcp-vetter` (source `agents/security/mcp-vetter.md`, score
  24) — gates MCP servers and socket/API additions before TA allows agents to
  read/write other sessions through tools.
- Alternative: `tool-provisioner` (score 23) — useful for discovery, but MCP
  safety is the higher-risk near-term gate.

### Terminal Product / TUI Review

- **Recommended:** create a new `terminal-ux-reviewer` agent (gap; no existing
  source fits cleanly) — owns Herdr comparison, terminal screenshots/tmux
  captures, keyboard/mouse workflow checks, narrow terminal usability, empty
  states, and the “two selections to start a tech-lead” acceptance bar.
- Alternatives:
  - `qa` (score 19 for this role) — can execute smokes, but does not own product
    simplicity or interaction critique.
  - `architect` (score 18 for this role) — can detect complexity, but does not
    own terminal UX evidence.

## Pipeline Topology

```text
human
  -> tech-lead
  -> planner for large/ambitious loops
  -> ocaml-implementer or generic implementer
  -> reviewer + architect + terminal-ux-reviewer as applicable
  -> qa
  -> tech-lead merge decision
  -> human approval for harness/team changes
```

For TA TUI loops:

```text
tech-lead
  -> planner
  -> ocaml-implementer
  -> reviewer
  -> terminal-ux-reviewer
  -> qa with tmux Matrix evidence
  -> tech-lead commits/pushes only after gates pass
```

For new agent creation:

```text
human request or tech-lead detects gap
  -> recruiter proposal
  -> terminal-ux-reviewer / architect if product-facing
  -> harness-builder draft wiring
  -> human validation
  -> harness-builder writes .harness and projections
```

Only `tech-lead`, `recruiter`, and `harness-builder` should have authority to
create or install agents. Other agents may request a new agent but must not
write or project one directly.

## Required Changes

1. Bootstrap canonical `.harness/` for this repository using a TA-specific
   developer profile.
2. Install/update the selected team in `.harness/agents/`.
3. Project runtime surfaces to `.opencode/agents/`, `.claude/agents/`, and
   Codex-compatible surfaces.
4. Replace generic TA routing so OCaml work defaults to `ocaml-implementer`.
5. Add `terminal-ux-reviewer` as a new source roster agent before installing it
   locally.
6. Update `AGENTS.md` because it is stale: it lists 22 agents while the source
   tree currently has 25.
7. Add TA-specific QA requirements: local opam switch, `dune build @all
   @install`, `dune runtest`, `dune test`, `ocamlformat --check`, opam lint,
   and tmux Matrix smoke for TUI/runtime work.

## Dependencies

| Dependency | Needed By | Status | Decision |
| --- | --- | --- | --- |
| `opam` local switch | TA implementation and QA | present in `ocaml/agent-manager/_opam` | keep |
| `tmux` | TA runtime and TUI QA | present in recent QA | keep |
| `miaou-tui` | TA TUI | present in local switch | keep |
| Herdr comparison | terminal UX review | temporary `/tmp` install was validated | use docs/screenshots or temporary install, not permanent install |
| MCP candidates | future inter-agent read/write tools | not selected | require `mcp-vetter` before install |

## Validation Questions

1. Which agent becomes the default implementation agent for TA OCaml work?
2. Which role is missing today and must be created before the roster can enforce
   Herdr-level TUI quality?
3. Should ordinary implementation/QA agents be allowed to create or install new
   agents directly?
4. Confirm the intended harness direction: should this repository get a
   canonical `.harness/` and treat `.opencode`/`.claude` as generated
   projections?
