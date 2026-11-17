# Read a manual aggregate usage report

Run the usage reporter when you want to inspect already available token/cost observations.
It reads local aggregate files and prints JSON; it does not install collectors, launch tools,
scan transcripts or create a recurring reporting task.

From a Roster checkout:

```bash
node scripts/roster-usage.cjs report
```

In an installed consumer:

```bash
node .harness/bin/roster-usage.cjs report
```

The defaults are the current project's existing `skills-meta/cost.jsonl` ccusage snapshots
and optional `.harness/.local/usage.jsonl` normalized observations. Missing defaults produce
`no-data` with null totals. They do not produce a zero-cost assertion.

To select several independent projects or an existing export explicitly:

```bash
node scripts/roster-usage.cjs report --project /work/project-a --project /work/project-b
node scripts/roster-usage.cjs report --input /work/exports/usage.jsonl
```

With one selected project, explicit imports belong to it. With several projects, each import
must be below a selected root so its project scope is unambiguous. The report omits the
project names and file paths; it contains only approved category aggregates and counts.
The tool prints stdout and makes no filesystem changes. Save stdout yourself only if desired.

## Supply a normalized observation

Existing ccusage snapshots remain supported. For Codex, Claude Code, OpenCode or Pi data from
another source, manually normalize an available runtime observation/export into this JSONL
shape; the reporter does not claim to decode every native format:

```json
{"schema_version":1,"runtime":"pi","source":"runtime-observed","stream_id":"local-session-scope","captured_at":"2026-11-12T09:00:00Z","model":"model-a","totals":{"input_tokens":100,"output_tokens":20,"cache_creation_tokens":null,"cache_read_tokens":0,"cost_usd":null}}
```

Use `agent-reported` for an agent's own assertion rather than runtime metadata. Keep unknown
buckets/cost as null; do not infer them from a requested model or price estimate. Four token
buckets are reported separately because source accounting conventions may differ. Provide
only buckets whose meaning you can map. No overall token count or monetary savings is inferred.

`stream_id` is an opaque local identity for one cumulative measurement scope. Keep it stable
across repeated exports, and use separate IDs only for independent scopes or genuine resets.
The latest reading contributes once. Counter regressions and conflicting equal-time readings
make the report invalid. A missing latest bucket remains unknown even if an earlier reading
was known. These are consistency checks, not authentication of the producer.

## Interpret totals and limitations

Read `status`, `coverage`, `provenance` and `limitations` alongside the numbers:

- `ok`: complete numeric coverage for selected observations under their independence assertions.
- `partial`: unknown buckets, approximate attribution or unproven independence remain.
- `no-data`: no observations are available; null means unmeasured.
- `invalid`: malformed/unreadable input, conflicting observations or a counter regression;
  exit code `1`, combined totals null. Inspect the selected local files to diagnose the source.

Project/runtime/source/stream namespacing prevents unrelated local identifiers from colliding.
It cannot prove that two producers measured different work. Normalized observations from
competing sources in the same project/runtime are therefore kept separate. Unknown/cross-runtime
scopes also prevent blind addition to named-runtime data where coverage might overlap.

Legacy ccusage time-window snapshots preserve their existing approximate attribution.
Repeated snapshots of the same project/runtime/window deduplicate across tasks. Overlapping
or touching windows and unknown bounds produce unknown aggregate coverage. Their imported
USD figures may originate in ccusage's offline calculations; this reporter never reprices them.

Legacy and normalized observations are not combined into a purported exact total. Inspect
their separate groups, and do not add overlapping groups back together. Selecting project
roots asserts those project scopes are independent; avoid exporting the same measured work
into different projects. Full activity coverage cannot be inferred from the files selected.

The output excludes names, paths, local IDs, timestamps and transcript content. Runtime/source
labels are fixed categories; unsafe or absent model labels become unknown. Detailed shape,
numeric limits and conservative overlap rules are in
[`schema/usage-report-schema.md`](../schema/usage-report-schema.md). The existing baseline
remains documented in [ccusage metrics adoption](ccusage-metrics-adoption.md).

Installed schema reference: `.harness/roadmap/usage-schema.md` (source-relative links above apply in a Roster checkout).
