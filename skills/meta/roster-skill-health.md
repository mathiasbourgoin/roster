---
name: roster-skill-health
description: Periodic friction analysis — proposes new skills, deterministic tools, and adaptations.
version: 1.0.0
domain: meta
phase: null
preamble: true
friction_log: false
allowed_tools: [Read, Write, Bash, AskUserQuestion]
human_gate: after
tunables:
  health_schedule: manual
  min_entries_for_signal: 3
artifacts:
  reads:
    - skills-meta/friction.jsonl
  writes:
    - skills-meta/health-<date>.md
pipeline_role:
  triggered_by: human (periodic or after friction accumulation)
  receives: skills-meta/friction.jsonl
  produces: skills-meta/health-<date>.md with approved proposals
---

# Roster Skill Health

You analyze accumulated frictions in the project to propose systemic improvements: new skills, deterministic tools, adaptations of existing skills, or new agents.

Only propose what is justified by the data. No speculative proposals.

## Input Contract

Read `skills-meta/friction.jsonl`.

### Cold start (file absent or empty)

If `skills-meta/friction.jsonl` does not exist or is empty:

1. Create the file:
```bash
mkdir -p skills-meta
touch skills-meta/friction.jsonl
```

2. Ask the user an open question:
> "The friction log is empty — the metabolism is starting now.
>
> Are you encountering frictions in your work with AI agents on this project?
> For example:
> - analyses you do manually that could be automated?
> - repetitive workarounds you apply every time?
> - missing tools for your domain (red teaming, TUI, OCaml, ...)?
>
> Describe freely — I will structure this and add it to the log."

3. If the user describes frictions → structure them into JSONL entries and add them.
4. Produce a report `skills-meta/health-<date>.md` with proposals from these initial frictions.
5. If no frictions described → note "no initial frictions" and suggest re-running after a few cycles.

## Steps (normal run)

### 1. Parse the log

```bash
cat skills-meta/friction.jsonl
```

Extract all entries. Entries with `"frictions": []` count as clean runs (positive signal) but do not generate clusters.

### 2. Clustering by theme

Group entries by coherent theme:
- Same skill + same friction type
- Same repeated workaround
- Same `suggestion_type`
- Same functional domain

Calculate for each cluster:
- Frequency (number of occurrences)
- Affected skills
- Dominant estimated effort (small / medium / large)

### 3. Filter relevant signals

Threshold: `tunables.min_entries_for_signal` occurrences in a cluster.
Below threshold → note in the report, do not propose action.

### 4. Produce proposals

4 categories, in recommended priority order:

#### A. New skills

Signal: recurring thematic friction (≥ threshold), consistent across multiple runs.

```
**[SKILL] roster-<suggested-name>**
Signal: <N> occurrences across <affected skills>
Frictions covered: <list>
Description: <what the skill would do>
Estimated effort: small / medium / large
```

#### B. Deterministic tools (scripts, binaries)

Signal: same manual workaround repeated, `effort_estimate: small` dominant.

```
**[TOOL] scripts/<name>.sh**
Signal: <N> occurrences of workaround "<workaround>"
Proposed tool: <description>
Impact: <friction eliminated>
Effort: small (~<N>h)
```

#### C. Adaptations of existing skills

Signal: friction tied to a specific step of an identified skill.

```
**[ADAPT] roster-<skill-name> → v<X.Y+1>**
Friction: "<description>"
Adaptation: <what changes>
Impacted section: <Steps N / Rules / Input Contract>
```

#### D. New dedicated agents

Signal: `suggestion_type: "agent"` repeated, `effort_estimate: large`.

```
**[AGENT] <agent-name>**
Signal: <N> occurrences, large effort
Domain: <domain>
Role: <description>
Next step: recruiter + skill-creator
```

### 5. Report

Produce `skills-meta/health-<YYYY-MM-DD>.md`:

```markdown
# Skill Health Report — <date>

**Entries analyzed:** <N total> (<N> with frictions, <N> clean runs)
**Clusters identified:** <N>
**Proposals:** <N>

## Proposals (strong signals)

<proposals A/B/C/D>

## Weak signals (< threshold — to monitor)

<entries below threshold>

## Stability

<N> clean runs — stable skills: <list>
```

### 6. Human gate

Present the report and ask:
> "Which proposals do you approve? I will mark them APPROVED for `/roster-skill-evolve`."

## Output Contract

`skills-meta/health-<date>.md` with approved proposals marked `**APPROVED**`.

**Next:** `/roster-skill-evolve` with the report as input.

## Rules

- Never propose without ≥ `tunables.min_entries_for_signal` occurrences in a cluster
- Never invent frictions — only what is in the log
- Cold start: create the file, query the user, do not block on missing data
- Clean runs are a positive signal to name explicitly
