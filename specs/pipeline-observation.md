---
name: roster-spec
type: spec
status: live
feature: standalone pipeline observation
brief: briefs/pipeline-observation-intake.md
date: 2026-11-14
version: 1.0.0
---

# Spec — standalone pipeline observation

Consumers can discover and inspect bounded persisted task evidence without executing or accepting a pipeline. This contract preserves canonical ledger validity and makes incomplete coverage explicit.

## First public v1 identity and experimental transition

The stable schema identity required by FR-011 is
`https://github.com/mathiasbourgoin/roster/schema/pipeline-observation/v1`, an opaque identifier
in the maintainer's repository namespace. It is not a schema retrieval endpoint: the runtime
uses its shipped local resource and must not fetch that URL. Runtime `schema.id`, source `$id`
and installed `$id` must agree. An experimental-id resource must yield `runtime-resource`
rather than being silently accepted.

Unpublished local snapshots used `https://roster.dev/schema/pipeline-observation/v1`; control
of that domain was not established for this interface. This is an explicit transition before
the first public v1, not a rename of an already published stable identity. Experimental
consumers must update exact identity checks and the finding-message field from experimental
`description` to canonical `summary`, update the complete runtime/resources together, discard
cached observations/content versions and begin fresh pagination. No redirect or implicit
compatibility with the experimental identity is promised. Identity changes affect schema and
aggregate observation digests, not canonical ledger bytes or historical attempt identity.

## Clarifications

### Q1 — What does pagination promise if the directory changes?

**Answer:** Catalog pages are sorted lexicographically by safe canonical task identifier, deduplicating intake/state names into one task. Default page size is 25; maximum is 100. A cursor carries a versioned continuation position and fingerprint of the complete eligible-name set observed by the bounded scan. Each continuation rescans and validates that fingerprint. A changed set returns an explicit stale-cursor result and requires restarting; malformed, mismatched-version or mismatched-root cursors are invalid. No persisted server snapshot or new writer is introduced. Changing file contents without changing names may change per-task observations between pages: pagination guarantees catalog membership consistency only, not an atomic filesystem snapshot. Cursors are untrusted input, never authentication or filesystem paths.

## Q2 — How does the scan cap remain bounded and truthful?

**Answer:** Count every directory entry inspected, including unrelated names, against a 10,000-entry cap; do not first materialize or sort an unbounded directory listing. Detect exhaustion with at most one further entry. If the cap is exceeded, return an explicit incomplete/scan-limit result with no usable continuation cursor. Do not promise deterministic catalog coverage from an arbitrary filesystem enumeration prefix; the simplest permitted result contains no task items. A complete scan alone may sort eligible names and paginate them. Missing `briefs/`, unsafe directory access and scan-limit exhaustion remain distinguishable. Discovery recognizes only safe canonical `*-state.json` and `*-intake.md` names; it neither follows links nor browses arbitrary paths.

## Q3 — Which validator decides whether canonical phase history is valid?

The existing `jq index` semantics include nonempty contiguous outcome subarrays. Preserve
their canonical validity, while projecting a non-scalar outcome as null/unknown in history
and latest-completed summaries. Do not change the router or infer a scalar from an array.

**Answer:** Match the router's canonical predicate and its legal/illegal fixtures exactly for current ledgers; do not reuse recovery's stricter validity judgment. Additional keys and absent actor/time remain legal where the router permits them, nonempty history is required, and only the current phase must belong to the selected mode sequence. Do not impose ideal historical ordering. Malformed JSON, domain-invalid data, missing source and explicitly unsupported schema must have distinct observable states. Unknown extra fields do not by themselves mean an unsupported schema. Publish parity cases, including actorless events, additional keys, empty history and legal earlier phases outside the current mode sequence.

## Q4 — How are missing or unusual actor/time values represented?

**Answer:** Preserve each valid event's append position as `event:<source_index>` and distinguish its latest-completed-phase meaning from activity. Missing or unusable actor/time fields yield explicit unknown observations rather than inferred values; their presence must not strengthen the canonical validity predicate. A usable actor string is a recorded skill label, never a verified person or runtime session. No process activity, attempt identity, session identity or synthetic timestamp is inferred. History defaults to 50 events with maximum 200 per page, preserves source order and total/truncation metadata, and rejects continuation after consumed ledger bytes change.

## Q5 — What do review/QA summaries and declared artifacts prove?

**Answer:** Review and QA observations describe current files only; neither a current GO nor repeated ledger events proves a complete historical report archive or a report-to-event association. Missing, invalid and unsupported optional components remain separately visible without invalidating a valid ledger or its other components. Bound each input to 16 MiB using the existing safe-I/O contract, each summary string to 2,000 characters, and arrays and total serialized output with explicit numerical caps in the final schema. Truncation must be reported. Artifact declarations are bounded metadata only: do not hydrate their targets, execute them, or imply existence/validity from declaration. Candidate report/declaration shapes require an explicit supported contract; arbitrary parsed JSON is not automatically valid domain data.

## Q6 — What do fingerprints and observation time guarantee?

**Answer:** Source fingerprints describe the bytes actually consumed, not reserialized JSON, authentication or approval. Expose separate generated observation time and a stable content/change fingerprint excluding that generated time. Preserve per-source availability so absence, unreadable/invalid input and a valid empty value are distinguishable. A directory scan and independent file reads are best-effort observations; do not claim a transaction across files or atomicity from pre-read stat checks. File changes must not silently make a cursor appear to continue the same history snapshot.

## Q7 — What qualifies the installed runtime closure?

**Answer:** A fresh isolated ESM consumer with no `node_modules` must run the same read-only interface using only installed managed runtime companions and schema/coverage resources. Qualification must prove installed output contract and resource equality, detect missing/stale closure entries, and reject unsafe managed aliases through existing installation conventions. It must not resolve fallback resources from the development checkout, invoke Git/providers/hooks/gates, or mutate the observed project. The coverage manifest explicitly marks live execution, session/attempt identity and complete historical reports unsupported. Existing roadmap authority remains separate and may be referenced through its supported API.

## Blocking questions

None. Numeric summary-array and output ceilings must be frozen in the final spec before implementation; selecting those conservative bounds is delegated routine scope work. No question here requires changing the validated task boundary.

## User Stories

### US-1 (Priority: P0)
 As an authorized local observer, I want a bounded task catalog so I can discover standalone pipeline records without running their workflows. Independent test: construct a root containing valid, absent and malformed canonical artifacts, list two tasks per page, and verify deterministic pagination and no writes.

1. Given briefs/alpha-state.json and briefs/beta-intake.md, when listing limit 1, then one task and a continuation cursor are returned; resuming covers the next task.
2. Given a malformed alpha-state.json and valid beta-state.json, when listing, then alpha remains explicitly invalid and beta remains available.
3. Given excessive files, oversized input, a symlink, or unsafe task identifier, when observing, then bounded failure/omission is explicit without outside-root reads or mutation.

### US-2 (Priority: P0)
 As a task observer, I want truthful detail of recorded phases and current intake/review/QA evidence so I can distinguish durable history from unsupported runtime information. Independent test: inspect repeated review/implement events with optional actor/timestamps, current reports and missing/invalid reports, asserting source positions and explicit unknowns.

1. Given a valid full ledger with repeated review events, when reading detail with a bounded history page, then recorded order/source indices are preserved and latest completed phase is labeled accordingly.
2. Given actorless/timestampless canonical events, when observing detail, then actor/time remain unknown; no live process, session or attempt identity is inferred.
3. Given missing or malformed review/QA artifacts, when observing, then each component has an explicit availability state while the ledger and other components remain usable; current summaries never claim complete historical coverage.

### US-3 (Priority: P1)
 As an integrator, I want a versioned schema/coverage manifest and a complete portable runtime so I can consume the same supported interface from a fresh installed project. Independent test: install locally into an isolated ESM fixture with no node_modules, compare output/schema/fingerprints, and verify closure loss/drift detection.

1. Given a fresh installed ESM project, when invoking the reader, then valid JSON conforms to the published versioned schema with schema/source fingerprints and observation freshness.
2. Given unchanged source bytes, when rereading, then source fingerprint is stable; changed source bytes change it, independently of observation time.
3. Given unsupported state families or installed resource missing/drifted, when inspecting capabilities/installation, then unsupported coverage or installation failure is explicit; no fabricated coverage or hidden development-checkout dependency is allowed.


## Challenges

| Challenge | Resolution |
|---|---|
| C-1 | Task grammar `[a-z0-9]+(?:-[a-z0-9]+)*`, max 120 ASCII characters. Canonical suffixes state.json/intake.md discover intake-only tasks; matching safe slugs participate regardless of entry kind, allowing explicit invalid component. Unsafe matching names count toward scan but only a bounded count is exposed, never arbitrary names. |
| C-2 | Count all directory entries; ≤10000 complete. At 10001 return availability unknown, reason scan-limit, no items/cursor and total null. Missing briefs absent; unsafe/unreadable/non-directory invalid. Empty complete scan valid total0. |
| C-3 | Reject zero/negative/fraction/noninteger/out-of-range inputs and unknown options. Catalog limit25/max100; history50/max200. Cursor max4096 ASCII chars, base64url JSON carrying kind/version/root binding/offset/source fingerprint. Root binding uses resolved absolute supplied root. Validate shape/root/kind/version before stale fingerprint. Limits may change between pages; start at oldest/source order. End cursor null. Catalog binds full eligible name set, history binds exact ledger bytes. |
| C-4 | Catalog reads ledger only per returned task, ≤100×16MiB inputs sequentially, and scans names only. Detail fixed source set: state.json, intake.md, spec.md, plan.md, impl.md, review.json, qa-state.json, qa.md, manifest.txt; ≤9×16MiB. Read via shared bounded I/O, enforce consumed-byte cap, refuse symlink/nonregular/oversized/growing input; disclose best-effort independent reads, no transaction or hostile concurrent ancestor replacement guarantee. No latency promise. |
| C-5 | Canonical ledger validity exactly router semantics even with extra schema_version. Intake/review/QA have no supported version discriminator; unknown fields do not imply unsupported versions. Unsupported applies requested API version and coverage families, not invented ledger versions. Optional source states absent/invalid/valid, unknown reserved unavailable fields; reasons distinguish read/unsafe/oversized/parse/domain. |
| C-6 | Actor usable if nonempty string, rendered first2000 UTF16 units and truncation disclosed; label only. Timestamp usable if string≤2000 and Date.parse finite; preserve source string, never chronology guarantee; invalid/missing becomes null with availability unknown. History oldest first, exact total, IDs event:index. Latest phase/outcome independent of page. |
| C-7 | Intake/phase Markdown is bounded raw text preview plus exact status marker if recognized; no structured intake parser. Current review JSON accepts object with status GO/NO-GO, optional matching task; known findings/audit arrays and numeric round/cycle must have proper types if present. QA-state uses existing shipped schema, optional matching task; missing qa counter stays null, no gate default invented. Project only status/round/cycle/date, up to100 summaries of findings/audit, known reason/summary/cross-runtime display fields using bounded scalar projection. QA Markdown separate, explicit verdict disagreement flag when recognized statuses differ. Manifest.txt lines after first `---` provide bounded declared-path metadata, never followed; other phase documents remain references/previews, no arbitrary path extraction. Current reports have no event mapping. |
| C-8 | Strings ≤2000 UTF16 units, each returned summary array≤100, per-item fixed shallow fields, no arbitrary nested source object passthrough. Source totals and truncation flags explicit. Serialized UTF8 output≤2MiB: if normal envelope exceeds, return small valid error envelope reason output-limit (no partial JSON or silent reduction). CLI errors emitted as bounded JSON stderr with exit2; source invalidity remains successful observation JSON exit0. |
| C-9 | SHA256 consumed bytes per successfully read source, including malformed/domain-invalid content; refused/unreadable/absent hash null. Aggregate content SHA256 JSON.stringify of fixed-order relative-path/state/reason/digest tuples and projected request identity, excludes generated_at. Schema digest hashes shipped schema bytes. Resolved root identity separate from per-source content hash. No authenticity/acceptance claim. |
| C-10 | Public CJS module exports list/show/capabilities and pure validator; CLI list/show/capabilities with --root, --task, --limit, --cursor, --history-limit, --history-cursor, --schema-version 1. Strict command-specific options. Envelope integer schema_version1, draft07 stable `$id`; compatible additive fields require documented minor release, incompatible version new schema_version. Full portable closure explicit in sync arrays and installation tests; all members verified by existing sync --check. Runtime requires local shipped schema/coverage and shared I/O; no development fallback. Missing/malformed resources produce JSON runtime-resource error exit2, independently from source availability. Stale bytes detected by installation check, not an invented self-authentication mechanism. |
| C-11 | Versioned coverage catalog enumerates supported current/persisted families, separately delegated roadmap API families, and unsupported live execution/session/attempt/full historical reports/accepted standalone checks. Clients inspect entries by id and availability; unknown future families are not inferred supported. No automatic success or Roster acceptance inference. |
| C-12 | Adopt separation of persisted history from live/attempt status, explicit local pagination; deliberate divergence from actual execution engines because canonical sources provide no live/run identity. Local absent means filesystem absence only, no inferred authorization diagnosis. |
| C-13 | Envelope version, schema dialect/$id and schema/content digests explicitly distinct; no OpenAPI/CloudEvents runtime dependency. Source discriminator unsupported only when canonical source contract defines one; currently none for ledger/reports. |

API resource failures, invalid requests and stale cursors return bounded typed errors, not task failure statuses. Discovery and all source accesses remain read-only and execute no shell/gates/hooks/Git/providers. No state is persisted by observation.

## Functional Requirements

- **FR-001** [US-1]: The observer MUST discover only canonical `briefs/<task>-state.json` and `briefs/<task>-intake.md` names under the supplied root. Task identifiers MUST match `[a-z0-9]+(?:-[a-z0-9]+)*` and contain at most 120 ASCII characters. It MUST deduplicate by task identifier, include intake-only tasks, and include matching safe names irrespective of entry kind so unsafe components remain observable. Unsafe matching names MUST contribute only to a bounded diagnostic count, never exposed arbitrary names. Unrelated names MUST NOT become browsable resources. (C-1)
- **FR-002** [US-1]: Discovery MUST inspect directory entries incrementally, count every entry including unrelated entries, and complete at at most 10,000 entries. It MUST inspect at most one additional entry to detect exhaustion. A 10,001-entry scan MUST return availability `unknown`, reason `scan-limit`, no items, no continuation, and `total: null`. Missing `briefs/` MUST be `absent`; unsafe, unreadable, or non-directory briefs MUST be `invalid`; a complete empty scan MUST be `valid` with total zero. Only a complete scan MAY sort eligible identifiers lexicographically and paginate. (C-2)
- **FR-003** [US-1, US-2]: Catalog limit MUST default to 25 and accept integers 1–100; history limit MUST default to 50 and accept integers 1–200. Zero, negatives, fractions, overflow, noninteger module values, malformed CLI integer encodings, out-of-range values, and unknown or command-inapplicable options MUST be rejected rather than clamped. CLI integer text MUST be parsed as the documented integer option rather than treated as a module numeric string. (C-3)
- **FR-004** [US-1, US-2]: Cursors MUST be at most 4096 ASCII characters of base64url-encoded JSON carrying kind, version, resolved absolute supplied-root binding, offset, and source fingerprint. Shape, root, kind, and version MUST be checked before freshness. Catalog continuation MUST bind the complete eligible-name membership set; unsafe matching names contribute diagnostics only. History continuation MUST bind exact consumed ledger bytes. Changed membership or changed ledger bytes respectively MUST produce a typed stale-cursor error; malformed or misbound cursors MUST produce invalid-cursor errors. Limits MAY change between pages; end continuation MUST be null. Content-only changes MUST NOT stale catalog membership; unrelated-name changes within a complete scan MUST NOT change that membership fingerprint. (C-3)
- **FR-005** [US-1, US-2]: Catalog MUST read only the ledger for each returned task, sequentially, with at most 100 inputs of 16 MiB each. Detail MUST access only the nine canonical task sources with suffixes `state.json`, `intake.md`, `spec.md`, `plan.md`, `impl.md`, `review.json`, `qa-state.json`, `qa.md`, and `manifest.txt`, each at most 16 MiB. Shared bounded safe I/O MUST enforce bytes consumed, reject symlink/nonregular/oversized sources and growth past the cap, and prevent outside-root source traversal within its documented safety contract. Observation MUST NOT write state or execute shell, phases, gates, hooks, Git, providers, or declared targets. It MUST disclose independent best-effort reads without transaction, hostile concurrent ancestor-replacement, or latency guarantees. (C-4)
- **FR-006** [US-2]: Ledger domain validity MUST match the router canonical predicate and legal/illegal fixtures exactly, including additional fields and absent actor/time, requiring nonempty history and constraining only the current phase to its selected mode sequence. It MUST NOT impose ideal historical ordering or recovery's stricter validator. Source availability MUST distinguish absent, invalid, valid, and reserved unknown/unavailable observations; invalid reasons MUST distinguish unsafe/read/oversized/parse/domain failures. Access/refusal failures precede parsing; parsing precedes domain validation. Unknown keys including `schema_version` MUST NOT alone create invalid or unsupported ledger/report versions. Unsupported interface versions and unsupported coverage MUST remain separate from source invalidity. (C-5, C-13)
- **FR-007** [US-2]: History MUST preserve original append order, beginning with the oldest event, exact total, paging/truncation metadata, and identifiers `event:<source_index>`. Latest completed phase/outcome MUST be available independently of whether its event is on the returned page. A recorded phase MUST NOT imply current activity, replayability, attempts, runtime sessions, verified people, or synthetic timestamps. A usable actor MUST be a nonempty string projected as a skill label, truncated after 2000 UTF-16 units with truncation disclosed; otherwise actor observation MUST be unknown/null. A usable timestamp MUST be a string of at most 2000 UTF-16 units for which `Date.parse` is finite, preserved verbatim; otherwise it MUST be unknown/null. Source position, never parsed chronology, MUST order events. Display usability MUST NOT strengthen ledger validity. (C-6, C-12)
- **FR-008** [US-2]: Intake and phase Markdown MUST be bounded raw-text previews/references with an exact recognized status marker when present, without inventing a structured intake model or extracting arbitrary paths. Review JSON MUST support an object with status `GO` or `NO-GO`, optional matching task, properly typed known findings/audit arrays and numeric round/cycle when present. QA-state MUST follow its existing shipped schema and optional matching task; an absent QA counter MUST remain null without executing a gate or inventing its default. Projection MUST include only bounded known status/round/cycle/date, findings/audit summaries and known reason/summary/cross-runtime scalar display fields. QA Markdown MUST remain separately attributed; differing recognized verdicts MUST expose disagreement. Missing/invalid optional components MUST NOT invalidate a valid ledger or other components. Reports MUST be current-only with no report-to-event association or aggregate success inference. (C-7)
- **FR-009** [US-2]: Only manifest lines after its first `---` MUST supply bounded declared-path metadata. Declarations, including outside-root paths, MUST NOT be read, executed, hydrated, or represented as proof of existence or validity. Current reports and repeated phase entries MUST NOT imply complete historical reports or Roster acceptance. (C-7, C-11)
- **FR-010** [US-1, US-2, US-3]: Projected strings MUST be at most 2000 UTF-16 units; each summary array MUST retain at most 100 items in source order with exact source count and truncation indicators. Items MUST have fixed shallow scalar fields, with no arbitrary nested source passthrough. Preview/declaration truncation MUST be explicit. Serialized output MUST be at most 2 MiB of UTF-8 JSON, including escaping; exactly the cap is permitted. If the ordinary envelope exceeds that cap after field projections, the observer MUST return a small valid typed `output-limit` error, without partial JSON, silent omission, or automatic page-size reduction. Requested/default page sizes MUST NOT promise success past this envelope bound. (C-8)
- **FR-011** [US-3]: The CJS module MUST export `list`, `show`, `capabilities`, and a pure validator. The CLI MUST expose `list`, `show`, `capabilities` with strictly command-specific `--root`, `--task`, `--limit`, `--cursor`, `--history-limit`, `--history-cursor`, and `--schema-version 1` inputs. Public JSON MUST have integer `schema_version: 1` and a shipped draft-07 JSON Schema with stable `$id`. Unsupported requested interface versions MUST yield typed errors. Compatible additive fields MUST require a documented minor release; incompatible changes MUST require a new envelope version. Schema dialect, schema identity, envelope version, source validity, and content fingerprints MUST remain distinct. No OpenAPI/CloudEvents dependency is required. (C-10, C-13)
- **FR-012** [US-1, US-2, US-3]: Successfully consumed source bytes MUST be hashed with SHA-256 even if malformed/domain-invalid; absent, refused, and unreadable sources MUST have null digest. Aggregate content identity MUST be SHA-256 of `JSON.stringify` of fixed-order relative-path/state/reason/digest tuples and projected request identity, excluding generated observation time. Schema fingerprint MUST hash shipped schema bytes. Observation time MUST be separately generated and represented as an ISO-8601 UTC timestamp. Root identity MUST be separate from per-source byte digests; identical bytes in different roots MUST have equal per-source digests. Fingerprints MUST indicate consumed content/change, never authentication, authorization, acceptance, or a cross-file transaction. (C-9)
- **FR-013** [US-3]: A versioned coverage catalog MUST enumerate supported persisted/current evidence, separately delegated roadmap API families, and unsupported live execution, session identity, attempt identity, complete historical reports, and accepted standalone checks. Recorded actors MUST be labeled skill labels and reports current-only. Entries MUST have identifiers and availability so clients distinguish supported-but-absent evidence from unsupported or unavailable families. Unknown future families/fields MUST NOT be inferred supported. Roadmap authority MUST remain separate. (C-11, C-12)
- **FR-014** [US-3]: Source and installed runtime MUST implement the same interface in an isolated ESM consumer with no `node_modules`, using only local managed companions and schema/coverage resources. The complete closure MUST be enumerated in sync source/target arrays and verified by existing sync `--check`, including required members unused by a particular invocation. Installation qualification MUST detect missing/stale members and unsafe managed aliases, compare resource bytes and contract output excluding observation time, and prohibit development-checkout fallback. Missing/malformed required runtime resources MUST produce bounded JSON `runtime-resource` errors independently of task validity; stale resources MUST be detected by installation checks, without invented self-authentication. (C-10)
- **FR-015** [US-1, US-2, US-3]: Invalid requests, stale cursors, output-limit, and runtime-resource failures MUST be typed bounded JSON errors; the CLI MUST emit them on stderr with exit 2. Observed source invalidity MUST remain successful observation JSON on stdout with exit 0. Errors MUST NOT masquerade as task failure statuses or filesystem absence as an authorization diagnosis. (C-2, C-3, C-8, C-10, C-12)

## Acceptance Criteria

- **AC-1**: AC-1 [US-1] — catalog happy path — Given alpha state/intake plus beta intake only, when listing one item and continuing, then identifiers are deduplicated, sorted and fully covered, beta is detail-addressable with absent ledger, and fixture bytes remain unchanged. FR-001–005.
- **AC-2**: AC-2 [US-1] — eligibility and scan boundaries — Given safe regular/linked/nonregular canonical entries, unsafe matching names, unrelated entries, missing/unreadable/unsafe/non-directory briefs and exactly 10,000 versus 10,001 entries, when listing, then safe membership and bounded diagnostics are independent, complete-empty differs from absence/error, and exhaustion returns unknown/scan-limit/no items/no cursor/null total. No links or unrelated resources are read. FR-001–002,015; C-1/C-2; EC-1.
- **AC-3**: AC-3 [US-1, US-2] — pagination validity — Given malformed/oversized/misbound cursors and all rejected limit/option cases, when listing or paging history, then invalid input is rejected before freshness. Given valid continuation, changing eligible membership stales catalog, changing only unrelated names or file bytes does not; any ledger byte change including append/whitespace stales history. Limits may change and terminal cursors are null. FR-003–004,015; C-3; EC-2/EC-3/EC-7.
- **AC-4**: AC-4 [US-2] — detail happy path — Given repeated review/implement events and current evidence, when showing bounded history, then source order and original event IDs, exact total, latest phase independent of page and current-only report provenance are preserved. Actorless/timestampless events remain valid and unknown display values are explicit. No live/attempt/session identity is fabricated. FR-006–009; C-6/C-12.
- **AC-5**: AC-5 [US-1, US-2] — input and access budgets — Given exact 16 MiB, oversized, growing, symlink, nonregular and unsafe source fixtures, when reading, then consumption remains bounded with explicit refusal reasons, catalog reads ledgers only sequentially, detail accesses only its fixed nine sources, and targets/providers/hooks/Git/gates are never invoked. Independent reads make no transaction claim. FR-005; C-4; EC-6.
- **AC-6**: AC-6 [US-2] — canonical validity and display — Given the router's legal/illegal parity fixtures, extra schema_version keys, legal earlier out-of-mode phases, empty history, malformed JSON and absent/nonstring/empty/overlong actor/time, when showing detail, then router validity is exact, parse/domain/access reasons remain distinct, unknown extra keys do not invent unsupported sources, and display usability never alters ledger validity. A 201-event ledger pages oldest first with exact source positions. FR-006–007; C-5/C-6/C-13; EC-3/EC-4.
- **AC-7**: AC-7 [US-2] — optional reports and declarations — Given supported and malformed review/QA shapes, legacy findings, absent counters, Markdown previews/verdicts, disagreeing current verdicts and manifest paths outside the root, when showing detail, then only bounded supported scalar projections appear, missing counters remain null, provenance/disagreement and per-component availability are explicit, other evidence survives invalid QA, and no declaration target is accessed or historical association/success inferred. FR-008–009; C-7/C-11; EC-5.
- **AC-8**: AC-8 [US-1, US-2, US-3] — output boundaries — Given 2001-unit emoji/escaped strings, 101-item arrays and envelopes exactly at/above 2 MiB serialized UTF-8, when observing, then fixed shallow projections obey UTF-16 limits, original totals/order/truncation remain visible, exact-cap JSON succeeds and over-cap returns a small valid output-limit error rather than partial output or silent reduction. FR-010,015; C-8; EC-6.
- **AC-9**: AC-9 [US-3] — contract happy path — Given a valid source task and capabilities request, when invoking module and CLI, then outputs validate against shipped draft-07 schema with integer version 1, stable schema identity, separate generated time and schema/content/source digests, and explicit supported/delegated/unsupported coverage. FR-011–013; C-10/C-11/C-13.
- **AC-10**: AC-10 [US-2, US-3] — fingerprint identity — Given unchanged bytes, whitespace-only ledger changes, changed reports, absent/refused/malformed sources, differing roots and observation times, when rereading, then exact byte hashes and fixed tuple composition produce the specified stable/change behavior, unread bytes have null digest, malformed consumed bytes have a digest, schema bytes have a separate digest, generated time alone does not change content identity, and history continuation responds only to its ledger bytes. FR-004,012; C-9; EC-7.
- **AC-11**: AC-11 [US-3] — version and coverage failures — Given unsupported requested interface version, unknown future coverage entries/fields and ordinary extra source fields, when validating/observing, then incompatible envelopes are rejected separately from source invalidity, future families are not inferred supported, and skill/current-only/delegated-roadmap coverage does not imply live execution, sessions, attempts, acceptance or full historical reports. Typed errors obey bounded stderr/exit2 while invalid sources use stdout/exit0. FR-006,011,013,015; C-5/C-11/C-12/C-13; EC-8.
- **AC-12**: AC-12 [US-3] — installed closure happy path and failures — Given a fresh isolated ESM consumer without node_modules, when installing locally and invoking list/show/capabilities, then all required managed runtime/resources suffice and contract/resource comparisons pass apart from generated time. Given missing, malformed, stale or linked closure members, including one unused by that invocation, then runtime-resource or installation-check failure is explicit, with no development fallback, external execution or observed-project mutation. FR-014–015; C-10; EC-8.

## Edge Cases



- **EC-1 (C-1/C-2):** alpha-intake.md and alpha-state.json deduplicate; state is a symlink; unrelated names fill the directory to exactly the scan cap. Catalog completeness, task availability and unsafe-source reporting remain independent.
- **EC-2 (C-2/C-3):** a matching name is added between pages; a nonmatching name is added; a matching file changes bytes without renaming. State which changes invalidate membership continuation, and which only change observations.
- **EC-3 (C-3/C-6):** one event, zero requested history limit, last-page continuation, repeated phase/outcome events and a 201-event history. Verify the chosen order, totals, limits and source IDs without inferring attempts.
- **EC-4 (C-5/C-6):** a router-legal earlier phase outside the current mode, absent/nonstring actor/time and extra fields coexist. History remains canonically valid; display fields may be unknown. Empty history remains invalid.
- **EC-5 (C-7/C-11):** review JSON says GO while QA JSON is malformed and QA Markdown says NO-GO; old ledger review events remain. No aggregate pipeline success or historical report association may be inferred.
- **EC-6 (C-4/C-8/C-9):** valid 16 MiB input, one byte too large, a file growing during consumption, 2,001-character emoji/escaped strings, 101 summary entries and output exactly at/over 2 MiB. Each boundary has a specified valid envelope or explicit bounded failure.
- **EC-7 (C-9):** only whitespace changes in a ledger; only observation time changes; a source becomes absent; a report changes while ledger history stays unchanged. Each fingerprint and continuation has a stated outcome.
- **EC-8 (C-10/C-13):** isolated ESM consumer has no node_modules; required schema is missing or stale; a managed runtime path is a symlink; output carries an unknown envelope version. Closure and interface errors remain distinguishable from observed task corruption.

## Runnable Checks

Each check runner uses exit 0=pass, 1=acceptance assertion, ≥2=setup/execution error. These are planned commands implemented during the implementation phase.

- **CHECK-1** [AC-1]: `node scripts/pipeline-observation-check.cjs catalog` → 0 on all category assertions passing.
- **CHECK-2** [AC-2]: `node scripts/pipeline-observation-check.cjs catalog` → 0 on all category assertions passing.
- **CHECK-3** [AC-3]: `node scripts/pipeline-observation-check.cjs detail` → 0 on all category assertions passing.
- **CHECK-4** [AC-4]: `node scripts/pipeline-observation-check.cjs detail` → 0 on all category assertions passing.
- **CHECK-5** [AC-5]: `node scripts/pipeline-observation-check.cjs detail` → 0 on all category assertions passing.
- **CHECK-6** [AC-6]: `node scripts/pipeline-observation-check.cjs detail` → 0 on all category assertions passing.
- **CHECK-7** [AC-7]: `node scripts/pipeline-observation-check.cjs detail` → 0 on all category assertions passing.
- **CHECK-8** [AC-8]: `node scripts/pipeline-observation-check.cjs contract` → 0 on all category assertions passing.
- **CHECK-9** [AC-9]: `node scripts/pipeline-observation-check.cjs contract` → 0 on all category assertions passing.
- **CHECK-10** [AC-10]: `node scripts/pipeline-observation-check.cjs contract` → 0 on all category assertions passing.
- **CHECK-11** [AC-11]: `node scripts/pipeline-observation-check.cjs contract` → 0 on all category assertions passing.
- **CHECK-12** [AC-12]: `node scripts/pipeline-observation-check.cjs install` → 0 on all category assertions passing.

## Claims Metadata

```claims
{"record":"claims-header","schema_version":1,"namespace":"pipeline-observation","spec_lifecycle":"draft"}
{"record":"requirement","id":"FR-001","lifecycle":"draft","external_sources":[],"depends_on":[]}
{"record":"requirement","id":"FR-002","lifecycle":"draft","external_sources":[],"depends_on":[]}
{"record":"requirement","id":"FR-003","lifecycle":"draft","external_sources":[],"depends_on":[]}
{"record":"requirement","id":"FR-004","lifecycle":"draft","external_sources":[],"depends_on":[]}
{"record":"requirement","id":"FR-005","lifecycle":"draft","external_sources":[],"depends_on":[]}
{"record":"requirement","id":"FR-006","lifecycle":"draft","external_sources":[],"depends_on":[]}
{"record":"requirement","id":"FR-007","lifecycle":"draft","external_sources":[],"depends_on":[]}
{"record":"requirement","id":"FR-008","lifecycle":"draft","external_sources":[],"depends_on":[]}
{"record":"requirement","id":"FR-009","lifecycle":"draft","external_sources":[],"depends_on":[]}
{"record":"requirement","id":"FR-010","lifecycle":"draft","external_sources":[],"depends_on":[]}
{"record":"requirement","id":"FR-011","lifecycle":"draft","external_sources":[],"depends_on":[]}
{"record":"requirement","id":"FR-012","lifecycle":"draft","external_sources":[],"depends_on":[]}
{"record":"requirement","id":"FR-013","lifecycle":"draft","external_sources":[],"depends_on":[]}
{"record":"requirement","id":"FR-014","lifecycle":"draft","external_sources":[],"depends_on":[]}
{"record":"requirement","id":"FR-015","lifecycle":"draft","external_sources":[],"depends_on":[]}
{"record":"acceptance-criterion","id":"AC-1","for":["FR-001","FR-002","FR-003","FR-004","FR-005"]}
{"record":"acceptance-criterion","id":"AC-2","for":["FR-001","FR-002","FR-015"]}
{"record":"acceptance-criterion","id":"AC-3","for":["FR-003","FR-004","FR-015"]}
{"record":"acceptance-criterion","id":"AC-4","for":["FR-006","FR-007","FR-008","FR-009"]}
{"record":"acceptance-criterion","id":"AC-5","for":["FR-005"]}
{"record":"acceptance-criterion","id":"AC-6","for":["FR-006","FR-007"]}
{"record":"acceptance-criterion","id":"AC-7","for":["FR-008","FR-009"]}
{"record":"acceptance-criterion","id":"AC-8","for":["FR-010","FR-015"]}
{"record":"acceptance-criterion","id":"AC-9","for":["FR-011","FR-012","FR-013"]}
{"record":"acceptance-criterion","id":"AC-10","for":["FR-004","FR-012"]}
{"record":"acceptance-criterion","id":"AC-11","for":["FR-006","FR-011","FR-013","FR-015"]}
{"record":"acceptance-criterion","id":"AC-12","for":["FR-014","FR-015"]}
{"record":"check","id":"CHECK-1","for":["AC-1"]}
{"record":"check","id":"CHECK-2","for":["AC-2"]}
{"record":"check","id":"CHECK-3","for":["AC-3"]}
{"record":"check","id":"CHECK-4","for":["AC-4"]}
{"record":"check","id":"CHECK-5","for":["AC-5"]}
{"record":"check","id":"CHECK-6","for":["AC-6"]}
{"record":"check","id":"CHECK-7","for":["AC-7"]}
{"record":"check","id":"CHECK-8","for":["AC-8"]}
{"record":"check","id":"CHECK-9","for":["AC-9"]}
{"record":"check","id":"CHECK-10","for":["AC-10"]}
{"record":"check","id":"CHECK-11","for":["AC-11"]}
{"record":"check","id":"CHECK-12","for":["AC-12"]}
```

## Entities

- `PipelineObservation`: versioned read-only projection of persisted standalone task sources, with bounded evidence and explicit availability.
- `CoverageManifest`: versioned catalog of supported, delegated and unsupported observation families; never a grant of execution authority.

## Validation

Delegated coordinator validation under owner authorization, 2026-11-14; not personal owner review. Independent spec researcher, clarifier, challenger and formalizer ran as separate fresh native-runtime roles in sequential waves. All 13 challenges resolved, 3 stories, 15 requirements, 12 AC/check pairs. Cross-spec entity scan found no conflicting PipelineObservation/CoverageManifest definition.
