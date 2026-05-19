---
name: prompt-engineering
description: Modern best practices for writing agent and system prompts — structure, length, and what to avoid.
version: 1.0.0
sources:
  - https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices
  - https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
  - https://www.anthropic.com/engineering/writing-tools-for-agents
  - https://developers.openai.com/codex/prompting
  - https://developers.openai.com/codex/guides/agents-md
  - https://www.prompthub.us/blog/prompt-engineering-for-ai-agents
---

# Prompt Engineering — Best Practices

## Core Principle

Context budget is finite. Every token spent parsing instructions is a token not spent on the actual task. Start minimal; add only when observed failures demand it.

## Structure

Use labeled sections (Markdown headers or XML tags). Consistent order:
1. **Role/identity** — one sentence, "right altitude": specific enough to guide, not so narrow it breaks on edge cases
2. **Workflow** — numbered steps, active voice, concrete actions
3. **Contracts** — input (what triggers this agent, what it receives) and output (what it produces, who consumes it)
4. **Rules** — short, absolute, at the end; only constraints that cannot be inferred from the workflow

Canonical example of this structure:

```markdown
# Agent Name

One-sentence role description.

## Workflow
1. Read assignment and confirm scope.
2. Do the work.
3. Run checks: <specific command>.
4. Report findings.

## Input Contract
Triggered by: <who>.
Receives: <what format>.

## Output Contract
Produces: <what> → consumed by <who>.

## Rules
- rule that cannot be inferred from the workflow
- escalate to X if Y
```

## Length

- Lean prompts outperform bloated ones. A prompt that fits in one screen is a design constraint, not a limitation.
- Don't embed content that can be fetched just-in-time. Reference file paths or URLs; let the agent retrieve at runtime.
- Don't list exhaustive edge cases. Use 2-4 diverse canonical examples instead — they generalize better.

## Examples

Few-shot examples are worth more than long instruction paragraphs. Include them when:
- The output format is non-obvious
- The agent must distinguish between similar-looking inputs
- A failure mode keeps recurring

Keep examples diverse and canonical, not exhaustive.

## Tool Descriptions (for agents that define tools)

- One clear purpose per tool — if two tools could both handle a situation, merge or rename them
- Descriptive parameter names: `user_id` not `user`, `file_path` not `path`
- Prefer semantic values over opaque IDs in tool inputs where possible
- Include a reasoning/scratchpad block before tool-call blocks to trigger chain-of-thought

## Agent-Specific

- **Critical content first** — truncation happens; bury nothing important at the bottom
- Make pipeline position explicit: what triggers this agent, what human gate (if any) precedes/follows
- State escalation paths: what to do when stuck, what to never decide alone
- Include verification steps: how the agent confirms its output is correct (tests to run, checks to make)
- Separate planning from execution when the task is non-trivial — define a plan phase before an act phase
- For multi-step tool use: one tool call at a time, check result before proceeding (prevents cascading errors)
- Avoid hardcoded if/else logic — prefer heuristics the model can generalize from
- For long-horizon tasks: instruct the agent to maintain structured notes; don't rely on context alone

## Agent Mindset

Agents in 2026 can produce, review, and test thousands of lines of code per hour. Write prompts that expect full effort:
- **No false caution**: do not tell agents to stop early, produce partial work, or defer unnecessarily
- **No "preexisting, not our problem"**: if an agent encounters a bug or failure outside its narrow scope, it must surface it — silently ignoring it is a defect in the agent's behavior
- **Thoroughness is cheap**: instruct agents to cover the full surface, not just the happy path

---

## Antipatterns

- **Bloated preamble** — paragraphs of context before the actual instructions
- **Laundry-list rules** — 20+ bullet rules the model cannot hold in working memory; collapse into principles
- **Vague role definitions** — "You are a helpful assistant" gives no behavioral signal
- **Stuffed edge cases** — listing every exception instead of giving examples of correct behavior
- **Overlapping tool sets** — the model cannot reliably choose between two tools that cover the same ground
- **Opaque parameter names** — `data`, `input`, `value` tell the model nothing about expected content
- **Embedding large reference docs** — link/path them instead; load on demand
- **No verification steps** — an agent with no way to check its own work will silently produce wrong output
- **Mixed planning and execution** — agents that must both decide and act without a phase boundary make poor decisions under uncertainty
