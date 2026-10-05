---
name: chamallaw-shadow
description: Records a non-authoritative Chamallaw decision signal beside Roster intake without changing routing. Use when comparing a configured local decision contract to roster.intake.
when_to_use: "Use when a Chamallaw decision MCP is already configured and a Roster intake should collect a no-effect shadow observation."
version: 1.3.0
domain: workflow
phase: null
preamble: true
allowed_tools: [Read, Write]
disallowed_tools: [AskUserQuestion]
human_gate: none
artifacts:
  reads: [roster/<task>/**]
  writes: [roster/<task>/chamallaw-shadow.md]
pipeline_role:
  triggered_by: human or a roster.intake operator after deterministic intake routing
  receives: task slug and configured Chamallaw contract id
  produces: immutable shadow observation; no routing decision
---

# Chamallaw Shadow Observation

Record a Chamallaw signal beside an existing deterministic Roster intake. This
skill is observation only: it must never choose a route, block an intake,
create a contract, submit an outcome, or change a Roster artifact other than
its own sidecar observation.

## Input Contract

`$ARGUMENTS` must provide exactly:

```text
task: <roster task slug>
contract_id: <positive integer>
deterministic_route: <the route Roster already selected>
```

The local `chamallaw-decision` MCP server must already be configured by the
project owner. Do not install it, modify its configuration, start it, or pass
scope/capability arguments. If it is unavailable, write a sidecar with status
`unavailable`; do not retry by changing the deterministic route.

## Operator Invocation

An operator can give an agent this instruction after `roster.intake` has
already selected its route:

```text
Use chamallaw-shadow after deterministic Roster routing.
task: <roster task slug>
contract_id: <owner-configured active contract id>
deterministic_route: <already-selected route>
Do not use Chamallaw mutation tools or alter routing.
```

The owner, not this skill, maintains the stable mapping from Roster question to
active `contract_id` and configures the read-only `chamallaw-decision` MCP.

## Steps

1. Read the task's existing Roster artifacts and extract the already-selected
   deterministic route. Treat it as authoritative for this run.
2. Call `chamallaw.server_status`. Record its `scope_kind` and capabilities;
   abort the observation if it reports any unexpected mutation capability as a
   reason to write through MCP. This skill only calls read tools.
3. Call `chamallaw.explain_decision` and `chamallaw.replay_decision` with the
   supplied `contract_id`.
4. Write `roster/<task>/chamallaw-shadow.md` using the exact template below.
   Copy only structured facts from the MCP response: contract id, assessment
   status, posterior parameters when assessed, policy verdict/binding ids, and
   verified event ids/count. Never copy raw evidence references, law snapshots,
   actor data, or untrusted submitted outcomes into the Roster sidecar.
5. State explicitly that the deterministic route was retained. Do not invoke a
   routing skill, alter a plan, or present the signal as a recommendation.

## Output Contract

```markdown
# Chamallaw shadow — <task>

## Deterministic baseline

- Route retained: `<deterministic_route>`
- Routing changed: no

## Observation

- Observed at: `<UTC RFC 3339 timestamp>`
- MCP status: `available|unavailable|error`
- Scope class: `<global|organization|project|unknown>`
- Contract: `<id>`
- Assessment: `assessed|abstained|error|unavailable`
- Posterior: `Beta(<alpha>, <beta>)|n/a`
- Policy: `<review|blocked|n/a>`
- Verified outcome count: `<integer|n/a>`
- Human review minutes: `<non-negative integer|n/a>`
- Comparison label: `<positive|negative|unknown>`

## Provenance

- Replay queried: yes|no
- Explain queried: yes|no
- Submitted/unverified outcomes used: no
- Mutation MCP tools called: no

## Comparison disposition

Observation only. Compare coverage, abstention reasons, calibration after a
predeclared period, and human cost against the deterministic baseline. This
record must not change this task's route or status.

`Comparison label` is an independently verified binary label for precisely the
target declared by this decision contract. Write `unknown` until such a label
exists; never infer one from the MCP posterior, policy, route, or a submitted
outcome. `Human review minutes` is the whole number of minutes spent reviewing
this intake after its deterministic route, or `n/a` if it was not measured.
```

## Rules

- The deterministic route always wins during shadowing, even for a high
  posterior or a `blocked` policy verdict.
- A missing contract, abstention, invalid response, or MCP outage is data:
  record it without creating a replacement contract or modifying Roster state.
- Never call `chamallaw.create_decision_draft`,
  `chamallaw.transition_decision_contract`, or
  `chamallaw.submit_decision_outcome` from this skill.
- Do not claim calibration, reliability, or an automation decision from a
  single observation. Promotion needs the predeclared comparison period and a
  human review.

## Friction Log

Append one entry at phase exit to `skills-meta/friction.jsonl`. Set
`"skill": "chamallaw-shadow"`. An unavailable MCP is `external-dep`; a missing
contract or malformed response is `evidence`.

## When to Go Back

| Condition | Action |
|---|---|
| MCP unavailable or malformed | Write `unavailable`/`error` sidecar, retain deterministic route, and stop. |
| Contract missing or not visible | Write `error` sidecar, retain deterministic route, and ask the server owner to configure the intended scope outside this skill. |
| A caller asks to act on the signal | Stop shadowing; a human must first approve a separate evaluation/promotion decision. |

## What Next

Keep collecting sidecars for the predeclared comparison period. After that
period, run `npm run report:chamallaw-shadow -- roster` to aggregate coverage,
abstentions, labels eligible for calibration, Brier score, measured human cost,
routing changes and mutation violations. A human reviews that report,
calibration and cost before any change to
deterministic Roster routing is proposed. Before the period starts, save its
dates and thresholds in `roster/chamallaw-shadow-evaluation.json`; then run
`npm run gate:chamallaw-shadow -- roster roster/chamallaw-shadow-evaluation.json`.
The gate can only say `eligible_for_human_review`; it never promotes a route.
Use `examples/chamallaw-shadow-evaluation.json` as the exact JSON shape, but
replace every date and threshold before the period begins. The example values
are deliberately non-operative defaults, not a recommendation for promotion.
