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

## Read complete canonical artifacts

The additive `artifact-*` operations let an integration discover finite canonical task documents
and configured project-agent definitions, then reconstruct their complete UTF-8 bodies. They
have a separate schema from the summaries above. Check `artifact-capabilities` at the selected
immutable revision: a receipt for an earlier summary-only revision does not establish this
capability. Missing Node/executable, an old producer without the command, and incompatible
producer versions are acquisition failures the caller must distinguish; an absent process
cannot emit producer JSON.

```sh
node scripts/roster-pipeline.cjs artifact-capabilities
node scripts/roster-pipeline.cjs artifact-list --root /path/to/project --scope task --task example-task
node scripts/roster-pipeline.cjs artifact-list --root /path/to/project --scope project
```

The synchronous module exports are:

```js
const observer = require("./scripts/roster-pipeline.cjs");
const capabilities = observer.artifactCapabilities();
const catalog = observer.artifactList({
  root: projectRoot, scope: "task", task: "example-task", limit: 25, cursor: null
});
const page = observer.artifactRead({
  root: projectRoot, scope: "task", task: "example-task",
  ref: catalog.data.items[0].body.ref, pageBytes: 65536, cursor: null
});
```

Supply the admitted root, scope and exact task independently of received references. A task
list without `task` is a root catalog grant; reading still requires a concrete independently
selected task. Project operations forbid a task. A reference is a pathless description of
current bytes, not a credential or evidence of previous listing. A currently eligible reference
constructed with the correct digest is readable without a list receipt.

Each success has exactly `schema_version`, `kind`, `schema`, `source` and `data`.
`schema_version` is 1; `schema.id` is
`https://github.com/mathiasbourgoin/roster/schema/artifact-observation/v1` and `schema.digest`
is the raw schema SHA256. `source` is null for capabilities, otherwise `{id,scope,task}`.
Kinds are `artifact-capabilities`, `artifact-list` and `artifact-page`. The exact field/type
reference is [the artifact specification](../specs/public-artifact-reading.md#normative-contract)
and [the offline schema](../schema/artifact-observation.schema.json).

### Eligible resources and catalog meaning

Task discovery scans `briefs/` and `specs/` together. Each safe task contributes all fourteen
slots below, including absent bodies. The task ID/name grammar is the same safe ASCII grammar
used above. Ordering is ASCII task ID, then this fixed kind order; a catalog page counts slots,
not tasks. A filename can identify two canonical slots: `sample-qa-state.json` is both the
QA state of `sample` and the ledger of `sample-qa`. Both identities remain independently bound.

| Kind | Canonical resource for task T |
|---|---|
| spec | `specs/T.md` |
| intake | `briefs/T-intake.md` |
| spec-result | `briefs/T-spec.md` |
| plan | `briefs/T-plan.md` |
| plan-data | `briefs/T-plan.json` |
| implementer-brief | `briefs/T-implementer.md` |
| reviewer-brief | `briefs/T-reviewer.md` |
| qa-scope | `briefs/T-qa-scope.md` |
| implementation | `briefs/T-impl.md` |
| review | `briefs/T-review.json` |
| qa-state | `briefs/T-qa-state.json` |
| qa | `briefs/T-qa.md` |
| ledger | `briefs/T-state.json` |
| manifest | `briefs/T-manifest.txt` |

`spec` is the complete canonical specification; `spec-result` is the distinct phase-result
brief. A summary or completion marker never substitutes for a full document. An exact task
without any canonical filename is absent with unknown total. An existing empty directory
catalog has known total zero; both directories missing means absent inventory. An unsafe
required directory or exhausted combined scan budget aborts the operation without partial
membership.

Project inventory admits only a duplicate-free JSON object at `.harness/harness.json` with
object `layers` and array `layers.agents`. Unique safe declaration names select only
`.harness/agents/NAME.md`. Optional source, path, runtime and version metadata cannot select
another file or grant execution. Every occurrence of a duplicate name is excluded; invalid
entries retain their original array indices and exact excluded count. The intended definition
total is null if exclusions leave membership unresolved. Missing definition bodies and invalid
optional metadata retain known identities. Definitions sort by ASCII name.

The manifest body is separate in `data.context.project_manifest`, never counted as a definition.
Absent/invalid manifests have unknown definition totals; a valid empty agents array has known
zero. A safe raw malformed manifest remains readable through its context item. Generated runtime
extras, global agents, historical report bodies and arbitrary manifest targets are unsupported.
Roadmap persisted observations and legacy phase history remain separately delegated. The
versioned coverage entries distinguish these categories from a supported absent/invalid body.

### Preserve bytes and detect stale continuations

A valid `body` has `{availability:"valid",reason:null,sha256,total_bytes,ref}`. Empty files are
valid. Every nonvalid body has null digest, length and reference; missing is absent/not-found,
while unsafe, nonregular, symlinked, hardlinked, oversized or invalid-UTF8 sources are invalid.
Individual catalog faults stay on that item. Root, required manifest/resource and operation
budget faults abort the operation.

`artifact-read --root ROOT --scope task --task T --ref REF` accepts optional `--page-bytes N`
and `--cursor TOKEN`; project reads use `--scope project` without `--task`. Page data is exactly
`{ref,sha256,total_bytes,range:{start,end},text,next_cursor,eof}` with half-open byte ranges.
Reconstruct a full document only by joining contiguous ranges from zero through `total_bytes`
under one reference/digest. `eof` alone does not establish possession of earlier bytes.

Pages preserve BOM, CR/LF, NUL and Unicode spelling without normalization. Decoding is strict
UTF-8; replacement decoding and binary fallback are unsupported. Each page ends at the largest
complete codepoint boundary fitting the byte limit. Page size may change during continuation;
a valid in-range forged offset is also allowed because cursors are not credentials. An empty
supplied cursor is invalid; only omitted/null means absent. At EOF a requested terminal cursor
returns an empty `N..N` page.

References and cursors use canonical unpadded base64url JSON with sorted keys. All SHA-valued
members must be primitive lowercase 64-hex strings; arrays and other JSON types refuse before
artifact bytes are consumed. Duplicate/extra
keys, alternate ordering/escaping/numbers, whitespace, padding, invalid encoding, oversized
inputs and unsupported versions refuse. Source identity hashes the resolved root, scope and
task without Unicode normalization. Relative equivalent roots share identity; symlink roots
and ancestors refuse. A reference cannot widen that binding.

Each read rechecks current canonical eligibility and raw body digest. A missing/changed body
or removed project name yields `stale_reference`. Project manifest byte edits stale list
cursors while an unchanged still-eligible definition reference remains readable. List cursors
bind ordered membership, presence/type classes, manifest digest, invalid indices and resource
identity, rather than unrelated body contents. Content-only edits do not claim an atomic
catalog revision. Descriptor/path/stat checks refuse detected mutation/replacement; they do
not guarantee cross-file transactions or protection against undetectable hostile races.

### Observe metadata without accepting its claims

Metadata keeps nullable `declaration`, `definition` and `reported` groups separate, with
availability, bounded issues and explicit truncation. Declaration values remain observable
when the definition body is missing. Differing declaration/definition versions are attributed
independently. A mismatching definition name becomes null with `name-mismatch`; canonical
identity and safe body remain readable.

Definitions require name, display name, description, model, domain/tags/compatibility arrays
and complexity. Optional configuration fields are typed without defaults. Definition versions use complete SemVer 2
grammar before summary clipping, including nonempty identifiers and no leading zeros in numeric
prerelease identifiers. Declaration versions remain separately attributed strings. Task reports expose
only reported task/status/date and nonnegative safe-integer round/cycle. Foreign task identity
or contradictory explicit status declarations null the affected field with an issue. A wrong-type
frontmatter status stays null even when a later status marker is well typed. A plausible
well-typed status is still only a reported string: no acceptance, count verification, permission,
command or session identity follows. Every item has invariant
`use:{availability:"unknown",reason:"not-observed",session:null}`.

Markdown metadata comes only from the first leading `---` block after optional BOM, using LF
or CRLF. Later blocks remain inert body text. The bundled maintained YAML AST reader rejects
actual anchors, aliases, tags, plain merge syntax, duplicate decoded keys, non-string map keys
and non-JSON/nonfinite values before conversion. Quoted/block literals containing `*` or `!`
and quoted literal `"<<"` keys remain ordinary text. JSON resources additionally require complete
strict JSON grammar; YAML superset syntax is not accepted as JSON. Escaped equivalent JSON
keys are duplicates. Ill-formed decoded strings null the affected field; their unchanged ASCII
escape bytes remain in the safe full body. Invalid syntax never salvages partial parsed
fields or denies an independently safe inert body.

### Bounds and fixed errors

| Surface | Artifact namespace limit |
|---|---|
| Source / serialized response | 16MiB per body / 2MiB UTF-8 JSON |
| Body page | 4..131072 bytes; default 65536 |
| Catalog page | 1..100 slots; default 25 |
| Discovery / physical consumption | 10000 combined directory entries / 32MiB per operation |
| Reference / cursor | 4096 / 8192 bytes |
| Frontmatter | 65536 input bytes |
| Decoded input | Root depth 0; depth at most 32; at most 100000 values including root |
| Project declarations | 10000 |
| Metadata output | Depth 8; 1000 values; 64 map keys; 100 array items |
| Metadata strings / displayed issues or invalid entries | 2000 scalar-aligned UTF-16 units / 100 |

Output depth/node accounting includes the entire metadata object, its field groups and issues,
with root depth zero. Clipped nested fields stay explicitly nullable with limit issues.

Source/frontmatter byte bounds precede parsing. Depth/node limits are **postparse admission**,
not a preparse CPU/heap sandbox. All parser exceptions, including stack errors, invalidate
metadata while retaining an independently safe body. Bounded pathological fixtures are checked
under process deadlines; those checks do not establish a universal latency or heap guarantee.
Physical artifact/configuration reads count each consumption; reused buffers and runtime/schema
resources do not. A maximum 16MiB manifest plus 16MiB definition is retrievable within 32MiB.
Smaller pages cannot repair unsafe sources, required inventory faults or missing resources.

Module failures synchronously throw the exported `ObservationError`. CLI failures write only
closed `{schema_version:1,kind:"error",error:{code,message}}` to stderr, with empty stdout and
exit 2. Messages are the fixed code with underscores replaced by spaces. Codes are
`invalid_request`, `invalid_reference`, `invalid_cursor`, `stale_reference`, `stale_cursor`,
`unsafe_source`, `oversized_source`, `invalid_utf8`, `runtime_resource`, `output_limit` and
`read_failed`. Option/token shape checks precede independent binding checks, then resources/root/
eligibility, safe consumption, reference digest and cursor freshness/range checks. A stale
reference wins over a wrong cursor fingerprint. No output overflow emits partial JSON.

### Portable resources and verification

New operations lazily validate a finite fifteen-member runtime union. The legacy seven members
remain sufficient for `list`, `show` and `capabilities`. Added members are the artifact reader,
metadata adapter, bundled `yaml-2.9.1.cjs`, its ISC license/provenance, artifact schema, coverage
and distribution manifest. Source-to-installed mappings are fixed in the implementation and
[finite integrity descriptor](../scripts/artifact-observation.manifest.json); the descriptor
does not authorize following arbitrary paths. It lists the fourteen other members, never a
self-hash. Its closed structure and generated serialization are checked. Resource fingerprints
include all fifteen sorted logical installed paths and raw SHA256s, including the manifest raw
SHA256, and stay identical across source/installed layout. These hashes describe bytes; they
do not authenticate their publisher or certify semantic truth.

The existing official sync distributes these exact resources; `--check` detects missing,
stale and symlinked projections. A relocated ESM consumer needs no `node_modules`. Parser builds
use exact dev-only `yaml@2.9.1` and locked `esbuild@0.25.6`; no consumer package install is needed.
Build settings and actual input/bundle/license hashes are in the shipped provenance. To rebuild
or verify reproducibility after an authorized source change:

```sh
npm ci
npm run build:artifact-parser
npm run check:artifact-parser
npm run test:pipeline
node scripts/artifact-observation-check.cjs --all
node scripts/artifact-observation-check.cjs --case AC-24
```

Every AC-1..38 selector runs independently: 0 means assertions pass, 1 means a contract assertion
or validly set up producer crash/hang, and 2 or greater means setup is unavailable. The checks
exercise the public module/CLI and real relocated closure, not a replacement reader. Local
checks do not establish publication, CI success or downstream acceptance; consume a revision
only after its actual qualification receipt is available.
