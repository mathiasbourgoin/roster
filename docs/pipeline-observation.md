# Observe standalone pipeline tasks

The local `roster-pipeline` reader lists and inspects persisted task evidence as versioned JSON. It reads artifacts without running a phase, gate, hook, provider or Git command, and writes no observation state.

## Obtain the qualified source

Use Node.js 22 or later. Git is needed to obtain the source; reading observations afterward
needs only Node and the shipped local files. The commands below select an immutable qualified
revision from the public repository, rather than a moving `next` checkout. Set
`ROSTER_SOURCE_REVISION` to the full commit recorded in the public installation receipt on
[issue #111](https://github.com/mathiasbourgoin/roster/issues/111). That receipt identifies the
qualified delivered revision and its checks; an unpublished local candidate is not availability.

```sh
: "${ROSTER_SOURCE_REVISION:?Set the full published commit from the installation receipt}"
git clone --no-checkout https://github.com/mathiasbourgoin/roster.git roster-observer-source
git -C roster-observer-source fetch --no-tags origin "$ROSTER_SOURCE_REVISION"
git -C roster-observer-source checkout --detach "$ROSTER_SOURCE_REVISION"
git -C roster-observer-source rev-parse --verify HEAD
node roster-observer-source/scripts/roster-pipeline.cjs capabilities
node roster-observer-source/scripts/roster-pipeline.cjs list --root /path/to/project --limit 25
node roster-observer-source/scripts/roster-pipeline.cjs show --root /path/to/project --task example-task
```

Check that `rev-parse` prints the selected revision and `capabilities` returns
`kind: "pipeline-capabilities"` with the schema identity documented below. Keep the source
directory intact: the entry point loads its ledger validator, bounded I/O helper, schema
validator, and schema/coverage resources from that checkout. Copying only the executable is
not an installation. No `npm install`, global package or harness activation is required for
this source invocation. The source acquisition commands write their new checkout; the reader
itself does not write the observed project.

## Run from a source or installed harness

Inside the source checkout:

```sh
node scripts/roster-pipeline.cjs list --root /path/to/project --limit 25
node scripts/roster-pipeline.cjs show --root /path/to/project --task example-task --history-limit 50
node scripts/roster-pipeline.cjs capabilities
```

For a project that already has a Roster harness, its normal approved sync from the selected
source revision distributes the reader and its complete resource set. This optional sync
also requires Bash 4 or later and `jq`:

```sh
bash roster-observer-source/scripts/sync-harness.sh /path/to/project
node /path/to/project/.harness/bin/roster-pipeline.cjs list --root /path/to/project
bash roster-observer-source/scripts/sync-harness.sh /path/to/project --check
```

Sync updates the project's managed harness files and runtime projections; it is separate from
read-only observation and is not required for the direct source invocation. It does not activate
Git hooks. The installed reader is self-contained, with no `node_modules` or development-checkout
fallback. `--check` verifies the complete installed closure, including members unused by an
individual request. Obtain the full selected source revision to repair missing or stale members;
do not mix files from different revisions.

## What the evidence means

`latest_completed` describes the last recorded phase, independently of the returned history page. It does not describe current execution. History preserves source array order and exposes `event:<index>` identifiers; these are source positions, not execution attempt IDs. Missing or unusable timestamps and actor labels remain unknown. A usable actor is only a recorded skill label, without authenticated person or runtime session identity.

Each component reports its relative source, availability, reason and consumed-byte digest. `absent` means the source is missing; `invalid` distinguishes unsafe, read, oversized, parse and domain errors. Invalid optional QA or review evidence leaves other components usable. `unknown` identifies unavailable observations such as exhausted discovery. `unsupported` in the coverage catalog means this interface has no authoritative source for that family.

Current review JSON, QA state and QA Markdown are separate observations. They do not certify that gates ran, associate a current report with a particular historical event, reconstruct all past reports, or accept a task. Recognized conflicting QA verdicts are visible. Missing legacy QA counters remain null rather than receiving a gate's procedural default.

The coverage catalog identifies supported persisted/current evidence, families delegated to the separate roadmap view, and unsupported live execution, runtime session/attempt identities, complete historical reports and standalone acceptance. Consumers must discover entries by ID and check availability. An unfamiliar future entry is not evidence of support.

## Bounds and pagination

| Surface | Bound and behavior |
|---|---|
| Discovery | Incremental scan of at most 10,000 directory entries, plus one exhaustion probe; every entry counts. On exhaustion: `unknown`/`scan-limit`, no items, no continuation, unknown total. |
| Catalog | Default 25, maximum 100 tasks, sorted by safe task ID; deduplicated state/intake names. Reads only returned ledgers. |
| History | Default 50, maximum 200 events, oldest first; exact total and original positions. |
| Source | Maximum 16MiB per file with bounded consumption; symlink/nonregular/oversized sources refused. |
| Detail | Fixed nine sources: state, intake, spec, plan, implementation, review, QA state, QA Markdown and manifest. |
| Projection | Strings at most 2,000 UTF-16 units; each summary array at most 100, with source counts and truncation flags. No arbitrary nested source passthrough. |
| Response | Maximum 2MiB serialized UTF-8 JSON, including escaping. Overflow is a typed error, never partial JSON or a silently smaller page. |

Safe task IDs match `[a-z0-9]+(?:-[a-z0-9]+)*`, maximum 120 ASCII characters. Discovery recognizes `briefs/<task>-state.json` and `briefs/<task>-intake.md`; intake-only tasks remain addressable. Other source names are fixed, not a filesystem browser. Manifest lines after the first `---` are unverified declaration metadata; their targets are never opened or executed, including outside-root references.

Pass a returned catalog token as `--cursor`; pass a history token as `--history-cursor`. Tokens are bounded untrusted inputs, never authorization. Catalog tokens bind the resolved root and complete deduplicated task membership. A change to existing file bytes, an unrelated directory entry or a second recognized source for an existing task does not change that membership. New/deleted task membership requires restarting with a fresh list. History tokens bind the exact consumed ledger bytes: even a whitespace-only change requires restarting history. Page size may change. Terminal cursors are null.

Zero, negatives, fractions, overflow, numeric strings in module options, malformed CLI integers, wrong-command options and unknown options are rejected. A malformed/misbound cursor is invalid before any freshness comparison; a well-formed changed-source token is stale.

The maximum catalog page may consume100×16MiB sequentially; detail may consume9×16MiB. These are finite work bounds, not a latency guarantee. Independent file reads and directory scans are best-effort observations, without a cross-file transaction or protection against hostile concurrent ancestor replacement.

## Module and wire contract

```js
const observer = require("./scripts/roster-pipeline.cjs");
const catalog = observer.list(projectRoot, { limit: 25 });
const task = observer.show(projectRoot, "example-task", { history_limit: 50 });
const coverage = observer.capabilities();
const validLedger = observer.validateLedger(candidate, "example-task");
```

Module option names use underscores; CLI flags use hyphens. `validateLedger` is a pure source-ledger predicate with router/doctor semantics. Display suitability of actor/time fields does not strengthen canonical validity, and the stricter recovery validator is not substituted.

The current router's `jq index` predicate also accepts a nonempty contiguous array of legal
outcomes. The observer preserves that validity decision. Such a non-scalar outcome is shown
as `null` (unknown) in history and latest-completed summaries, rather than being converted
into an invented scalar result. This does not change the router or any stored ledger bytes.

Success envelopes carry integer `schema_version:1`, `kind`, UTC `generated_at`, schema identity/digest, separate root identity, stable `version`, coverage and command data. Source SHA-256 values hash consumed bytes, including malformed content; refused, absent and unreadable files have null digest. Aggregate version hashes fixed-order source/state/reason/digest tuples plus normalized request identity, including resource identity, excluding generation time. It detects change, not authentication, permission, acceptance or an atomic snapshot.

The shipped draft-07 [JSON Schema](../schema/pipeline-observation.schema.json) and [coverage catalog](../schema/pipeline-coverage.json) are versioned resources. Envelope version, JSON Schema dialect/identity and content fingerprints are separate concepts. The schema uses the existing zero-dependency assertion subset; typed properties and version are checked, while command-specific conditional-required relationships are additionally enforced by runtime construction and acceptance tests. The self-contained schema's root `$id` is identity metadata removed only for that subset interpreter; no assertion keyword is silently ignored. Compatible additive interface changes require a documented minor release; incompatible changes require a new envelope version.

The first public version 1 schema identity is
`https://github.com/mathiasbourgoin/roster/schema/pipeline-observation/v1`.
It is an opaque identifier in the maintainer's repository namespace, not a schema download
endpoint. Load the schema shipped at the pinned source revision; the reader does not resolve
the identity URL or fetch remote schema resources.

### Transition from the unpublished experimental interface

Experimental local snapshots used `https://roster.dev/schema/pipeline-observation/v1` before
public qualification. Control of that domain was not established for this interface. The first
public v1 uses the repository identity above; it does not promise a redirect or automatic
acceptance of the experimental identity. Source and installed schema companions must agree
with the runtime's identity, or the runtime reports `runtime-resource`.

Experimental consumers must update exact schema-identity checks. They must also read the
canonical finding message from `findings.items[].summary`, replacing the experimental
`description` spelling. Update the complete runtime/resource set together, discard cached
observations and content versions, and start fresh pagination when adopting this first public
v1. The identity change affects schema and aggregate content digests; it does not change the
underlying task ledger bytes or establish a new historical attempt.

CLI source-invalidity observations still return stdout JSON and exit0. Invalid requests, invalid/stale cursors, unsupported requested versions, missing/malformed runtime resources and output overflow produce bounded stderr JSON and exit2:

```json
{"schema_version":1,"kind":"error","error":{"code":"unsupported-version","message":"…"}}
```

Module calls throw typed errors with `code`. `serialize(value)` applies the exact serialized byte ceiling. Resource failures describe the installation, not a task outcome. Missing filesystem sources are not assigned an authorization diagnosis.

## Qualification

Runtime resources are checked against the interpreter's supported assertion grammar before
being accepted. Invalid type names, malformed property/item schemas, required lists and
unsupported assertion forms produce `runtime-resource`. The subset accepts object schemas,
legal scalar type names/unions, primitive/null enums, string required lists, object properties,
single-schema items and boolean `additionalProperties`. Boolean schema nodes, tuple items,
structured enums and schema-valued `additionalProperties` are not silently accepted.

The acceptance suite uses Git, Bash 4+, `jq` and the POSIX `mkfifo` utility, including a
deterministic final-component FIFO replacement check. These are test tools; the observation
runtime itself still uses only Node and its shipped local companions/resources.

`npm run test:pipeline` runs four acceptance categories, also available directly as `node scripts/pipeline-observation-check.cjs catalog|detail|contract|install` with one category per invocation. The direct runner uses 0 for passing assertions, 1 for an assertion failure and 2 for setup/execution error. Twelve spec check labels link to those four category executions; they are not twelve independent runs. The full `npm test` includes this suite.

The categories cover router/jq validity parity, scan/cursor/read/output boundaries, truthful current reports and unknown identities, instrumented absence of observation writes/subprocesses, schema/fingerprint behavior, and actual installed ESM/no-node_modules closure with missing, stale and linked members. Qualification results belong in the task's review/QA artifacts; this usage reference makes no claim that unrecorded checks passed.
