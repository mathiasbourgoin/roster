---
name: chamallaw-feedback
description: Submits independently observed Roster decision evidence to Chamallaw without verifying or training it. Use only after a task outcome is known and evidenced.
when_to_use: "Use after a Roster task reaches its defined terminal outcome and an independent evidence reference is available."
version: 1.0.0
domain: workflow
phase: null
preamble: true
allowed_tools: [Read, Write]
disallowed_tools: [AskUserQuestion]
human_gate: none
artifacts:
  reads: [roster/<task>/**]
  writes: [roster/<task>/chamallaw-feedback.md]
pipeline_role:
  triggered_by: owner or post-terminal Roster hook after evidence exists
  receives: task slug, active contract id, binary outcome, evidence reference, observed time
  produces: submitted evidence only; never verification or routing
---

# Chamallaw Feedback Submission

Submit a real, independently evidenced outcome to the configured local
Chamallaw MCP. This skill records evidence as `Submitted` only. It must never
verify the outcome, claim that the posterior changed, create a contract, alter
the Roster route, or treat a route/score/policy as evidence.

## Input Contract

`$ARGUMENTS` must provide exactly:

```text
task: <roster task slug>
contract_id: <positive integer>
outcome: <true|false>
evidence_ref: <durable independent reference>
observed_at: <UTC RFC 3339 timestamp>
```

The configured `chamallaw-decision` MCP must advertise
`outcome_submission: true` in `chamallaw.server_status`. If it does not, write
a pending/error sidecar and stop. Do not enable this capability, change server
configuration, or replace missing evidence with an inference.

## Steps

1. Read `roster/<task>/chamallaw-shadow.md` and confirm its contract matches
   `contract_id`. A missing or mismatched shadow sidecar is evidence that this
   submission must stop.
2. Read the terminal Roster artifact and confirm that `outcome`, `evidence_ref`
   and `observed_at` describe an independently observed result for the
   contract's declared target.
3. Call `chamallaw.server_status`; require only the explicitly enabled
   `outcome_submission` capability.
4. Call `chamallaw.submit_decision_outcome` with the supplied contract, outcome,
   evidence reference and observed time. Use a stable idempotency key derived
   from the task slug, contract ID, outcome and durable evidence reference.
5. Write `roster/<task>/chamallaw-feedback.md` with the returned submitted
   event ID and all non-sensitive structured facts. State that verification is
   pending and that the assessment was not updated.

## Output Contract

```markdown
# Chamallaw feedback — <task>

- Contract: `<id>`
- Submission status: `submitted|pending|error`
- Submitted event id: `<integer|n/a>`
- Outcome: `<true|false|n/a>`
- Evidence ref: `<durable reference|n/a>`
- Observed at: `<UTC RFC 3339|n/a>`
- Verification: `pending`
- Posterior updated: no
- Routing changed: no
```

## Rules

- A submitted event never enters the model. Only a distinct trusted validator
  may later write `Verified` through the Chamallaw library.
- Do not submit when the outcome is inferred from agent text, a score, a policy
  verdict, the selected route, or an unverified self-report.
- Do not call any lifecycle, draft, law or verification capability.
- A missing evidence reference or unavailable server is data, not permission to
  fabricate a label.

## When to Go Back

| Condition | Action |
|---|---|
| No independently evidenced binary result | Write a pending feedback sidecar; do not submit. |
| MCP capability absent or contract mismatch | Write an error sidecar; keep the evidence for the owner and stop. |
| Caller asks to verify or train immediately | Stop; route the evidence to the distinct trusted validator. |

## What Next

The trusted validator reviews the evidence outside this skill. It may verify or
reject the submitted event through the host library. A later replay shows only
verified events; this skill must not claim that submission changed the model.
