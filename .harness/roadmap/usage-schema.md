# Manual usage report contract, version 1

`scripts/roster-usage.cjs` imports existing aggregate observations and prints an advisory
report. Its installed equivalent is `.harness/bin/roster-usage.cjs`. The tool is a standalone
CommonJS file using only Node built-ins, including inside an ESM consumer. It does not
collect native transcripts, run provider commands, fetch prices, export or persist state.

## Invocation and input selection

```text
node roster-usage.cjs report [--project DIR ...] [--input JSONL ...]
node roster-usage.cjs --help
```

Without `--project`, use the current working directory as the project. For every selected
project, inspect only `skills-meta/cost.jsonl` and `.harness/.local/usage.jsonl`. Missing default
files are ordinary no-data. A present malformed/unreadable default is invalid. Explicit inputs
are additional files; missing, unreadable or malformed explicit inputs are invalid. Blank lines
are ignored. No recursive discovery, HOME lookup or native transcript discovery is performed.

Project directories and input file identities are canonicalized with local filesystem paths.
The same physical path reached through aliases is read once. Distinct copied files remain
distinct inputs, but repeated cumulative snapshots in them deduplicate by stream identity.
Hard-linked paths are not resolved into a shared file identity; equal snapshots still deduplicate.

With one project, explicit imports belong to that project even if stored elsewhere. With
several projects, an explicit file must be below a selected root; the longest matching root
owns it. Otherwise the report is invalid. Relative arguments resolve against the current
working directory. Distinct selected project scopes are an operator assertion of independence;
do not copy the same measured scope into two different projects.

Each file is limited to 32 MiB and the selected unique files to 128 MiB. Oversized inputs
yield generic invalid-input diagnostics. The reporter writes no output files, checkpoints,
watermarks, Git changes or configuration. JSON output goes to stdout; error data is generic.

## Normalized cumulative input

One UTF-8 JSON object per line. Required fields are `schema_version`, `runtime`, `source`,
`stream_id`, `captured_at` and `totals`. Only `model` is optional; unknown fields are invalid.

```json
{"schema_version":1,"runtime":"pi","source":"runtime-observed","stream_id":"local-opaque-scope","captured_at":"2026-11-12T09:00:00Z","model":"model-a","totals":{"input_tokens":100,"output_tokens":20,"cache_creation_tokens":null,"cache_read_tokens":0,"cost_usd":null}}
```

| Field | Contract |
|---|---|
| `schema_version` | Integer `1` |
| `runtime` | Nonempty string; recognized categories are `claude-code`, `codex`, `opencode`, `pi`, `cross-runtime`, `unknown`; unsupported labels report as `unknown` |
| `source` | `runtime-observed` or `agent-reported`; provenance assertion, not authentication |
| `stream_id` | Nonempty opaque local identity, never output |
| `captured_at` | RFC 3339 timestamp with seconds, explicit `Z`/offset and at most three fractional digits; calendar/time fields must be valid |
| `model` | Optional category; only `[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}` survives output, otherwise `unknown` |
| `totals` | Exactly the four token buckets and `cost_usd` shown above; every field must be present |

Token buckets are nonnegative safe integers or `null`; cost is a nonnegative finite USD
number or `null`. Omission is malformed, not zero. Supply the runtime's observed counters
only when their bucket semantics match this contract; use null where mapping is unavailable.
The tool does not derive tokens, add four buckets into an allegedly comparable grand token
count, authenticate provider values, estimate dollars, or report measured savings.

A stream means an independent cumulative measurement scope within a project/runtime/source.
Different IDs in that namespace assert nonoverlapping measurements; a reset starts a new
scope/ID. Keep the same ID across repeated exports of the same scope. The tool cannot verify
those producer assertions. Do not mint a new ID for every cumulative snapshot.

Snapshots are sorted by capture time. Only the latest snapshot contributes; identical
duplicates are idempotent. Conflicting same-time counters and any decrease in a known
cumulative metric invalidate the stream/report. A null reading does not erase the earlier
known value for regression detection, but a latest null remains unknown in the total.
Known model labels that vary within a stream make its whole-model attribution unknown;
the latest model cannot own all earlier cumulative usage. Input snapshots are never emitted.

## Existing ccusage cost snapshots

The existing cross-runtime ccusage baseline is imported unchanged in format from
[`cost-snapshot.schema.json`](cost-snapshot.schema.json); no new Claude-only collector replaces
it. Accepted fields are its required `task`, `captured_at`, `runtime`, `join_method`, `window`,
`attribution`, `cost_mode`, `offline`, `totals`, plus optional `phases`. The importer additionally
rejects invalid dates, negative/nonfinite counters/cost and inverted windows. Its runtime enum
remains the existing legacy set; Pi observations use the normalized format above.

Legacy attribution must be `approximate`, offline must be true, and cost mode remains
`auto`, `calculate` or `display`. Imported USD figures may already reflect ccusage's offline
calculations; the reporter preserves them with source `ccusage` and a no-repricing limitation.
Optional phase aggregates are validated but never summed or output.

Legacy identity is project/runtime/window, irrespective of task names. Repeated captures of
that identity use the latest snapshot; conflicting same-time totals are invalid. Task names
and windows are never output. Windows with either bound unknown yield unknown aggregate
coverage. Within a project/runtime, overlapping or touching bounded windows are not summed;
endpoint inclusion is not assumed to be disjoint. Disjoint bounded windows may be added,
while retaining approximate attribution.

## Coverage and aggregation

Groups are keyed by format/runtime/source/sanitized-model category, never project/stream/task.
Within a known independent selection, each metric is summed only if every contributing scope
has a known value. A missing value or numeric overflow makes that metric null, not a partial
sum pretending to be complete. No-data totals are all null; explicit observed zero remains zero.

Combined coverage is unknown for mixed normalized/legacy formats, competing sources within
one project/runtime, unknown runtime attribution, or a cross-runtime scope alongside another
runtime in the same project. These sources may describe the same underlying work. Legacy
overlap/unknown bounds and invalid stream histories likewise prevent a combined sum.
The corresponding groups remain separate; callers must not sum them again to bypass a
coverage limitation. The tool has no disjointness override for mixed formats or sources.

## Output whitelist

Every report has exactly these top-level fields:

| Field | Value |
|---|---|
| `schema_version` | `1` |
| `status` | `ok`, `partial`, `no-data`, `invalid` |
| `advisory` | `true`; never a Roster phase verdict |
| `totals` | The same five nullable numeric fields as normalized input |
| `coverage` | `selection: selected-inputs-only`, numeric project/file/record/normalized-stream/legacy-window counts, and `metrics` statuses |
| `provenance` | Sorted runtime/source categories, `measurement: imported-assertions`, `pricing: not-performed` |
| `groups` | Approved category aggregates described below |
| `diagnostics` | Numeric `invalid_inputs`, `invalid_records`, `invalid_streams` only |
| `limitations` | Fixed diagnostic codes only |

Each group has `format` (`cumulative` or `legacy-window`), `runtime`, `source` (normalized
source or `ccusage`), `model`, `totals`, `coverage` and `limitations`. Group coverage contains
numeric `observations` (deduplicated scopes), `attribution` (`producer-reported` or
`approximate`) and `metrics`. Every metrics map uses the five totals keys with values
`complete` or `unknown`, relative only to selected inputs. No claim of complete project or
provider activity follows from a complete selected-input metric.

`ok` means the selected imported scopes have complete numeric coverage under declared
independence. `partial` includes unknown metrics, unproven overlap, approximate legacy data
or unknown model mapping. `no-data` means no valid observations and no invalid inputs.
`invalid` is emitted if any selected input/record/stream is invalid; combined totals are
all null and exit code is `1`. Other statuses return exit `0`. Unaffected groups can remain
visible in an invalid report, but the report must not be treated as a successful complete sum.

The report never contains project/task/stream IDs, input paths, timestamps, prompts, command
text, raw findings, input objects or raw exception messages. Only sanitized category strings,
fixed contract strings, counts and numeric totals are emitted. Diagnostic codes are:

```text
cross-source-coverage-unproven
invalid-arguments-or-unavailable-input
invalid-input-or-stream
invalid-stream-history
legacy-cost-imported-without-repricing
legacy-time-window-attribution-approximate
legacy-window-bounds-unknown
legacy-window-overlap
mixed-format-coverage-unproven
model-attribution-unknown
numeric-aggregate-overflow
producer-asserted-stream-independence
project-scopes-asserted-independent
runtime-attribution-unknown
runtime-coverage-unproven
```
