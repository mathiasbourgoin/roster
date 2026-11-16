---
name: public-artifact-reading
type: spec
status: live
feature: Complete bounded canonical artifact observation
brief: briefs/public-artifact-reading-intake.md
date: 2026-11-16
version: 1.0.0
---

# Spec — Complete bounded canonical artifact observation

**Status: VALIDATED**

The additive public reader discovers finite canonical task artifacts and configured project-agent definitions and returns complete UTF-8 content through bounded pages. Persisted agent-maintained content is untrusted observation. Source/digest identity identifies selected bytes, not semantic truth, permission or live use. Existing public summary interfaces remain independent.

## Clarifications

- Canonical specs differ from phase completion markers and previews.
- Eligibility is finite; declared paths, generated/global definitions and arbitrary history do not widen it.
- Task/project grants are independently trusted caller inputs.
- Inert body availability is independent of invalid metadata.
- Configuration never proves execution or session association.
- New resources/operations are additive and preserve old semantics.
- Continuity and bounds are explicit without atomic cross-file or hostile-filesystem guarantees.
- Unsupported/delegated categories remain explicit rather than inferred from absence.

## User Stories

### US-1: Discover and read canonical task artifacts (Priority: P0)

As an integration developer, I want task-scoped public discovery and complete canonical document reading so that I can inspect actual specifications and reports without private filename scraping or preview substitution.

**Why this priority:** the existing public projection exposes only bounded content and a spec completion marker; this story provides the missing core artifact boundary.
**Scope:** task artifacts only; no project-agent or arbitrary historical/evidence target expansion.
**Independent Test:** populate only canonical task fixtures in an isolated root and exercise the actual public task catalog/read operations, without a harness or agent inventory.
**Acceptance Scenarios:**
1. **Given** task build-cache has specs/build-cache.md containing CANONICAL plus UTF-8 text beyond2000 units and briefs/build-cache-spec.md containing MARKER-ONLY, **When** the task catalog and full reads are requested, **Then** spec and spec-result are distinct identities and complete canonical spec bytes match the full source rather than the marker/preview.
2. **Given** only specs/spec-only.md exists for spec-only and an unrelated manifest declaration names ../private.txt, **When** new task discovery runs, **Then** spec-only is discoverable under the finite rules and the declaration cannot create a readable reference; legacy list behavior remains unchanged.
3. **Given** an eligible current review contains malformed JSON but valid bounded UTF-8, **When** it is listed/read, **Then** its inert full text remains readable with invalid structured metadata and no accepted-verdict inference; unavailable bodies instead carry null hash/size/ref.
4. **Given** one source is symlinked, nonregular, hardlinked, oversized or invalid UTF-8, **When** its new read is attempted, **Then** the typed boundary refuses source bytes without path/content leakage or a truncated complete result.

### US-2: Inspect project-configured agent definitions honestly (Priority: P0)

As a project maintainer, I want explicit project-scoped configuration inventory and full canonical agent definitions so that I can understand roles/instructions/configuration while distinguishing availability from observed use.

**Why this priority:** specialized project agents are an explicit product requirement and differ from a library catalog or generated runtime file.
**Scope:** canonical manifest/declarations only; no global inventory, generated-flat-file attribution, launch/assignment API or inferred session join.
**Independent Test:** populate a project harness manifest and canonical definitions with no standalone task artifacts; exercise actual public project inventory/read operations independently.
**Acceptance Scenarios:**
1. **Given** a valid project manifest declares reviewer with role project-review and canonical .harness/agents/reviewer.md includes full instructions, **When** explicit project inventory/read runs, **Then** canonical identity, declared role/configuration and full text are returned, use remains unobserved/sessionnull, and an extra generated runtime agent does not enter the inventory.
2. **Given** the manifest is absent, invalid, or valid with an empty agents array in three independent fixtures, **When** project inventory runs, **Then** outcomes distinguish absent/invalid with totalnull from admissible empty with known0; none claims zero live agents.
3. **Given** an admissible manifest has one uniquely identified valid definition, one missing definition and an unsafe/duplicate entry, **When** inventory runs, **Then** the valid entry survives, missing-body metadata remains distinct, bad identity gets no ref and invalid_entries has exact coverage/truncation with no fabricated complete count.
4. **Given** an eligible definition has malformed/wrong-type/contradictory frontmatter but its regular body is bounded valid UTF-8, **When** it is inspected, **Then** leaf metadata becomes invalid/unknown with reasons while full inert body remains readable; metadata cannot supply a path/scope/ref or action grant.
5. **Given** a model/provider/assignee label matches a consumer session name and instructions contain command-like text, **When** the definition is read, **Then** no live/mobilized/authenticated-session/permission assertion or command effect is invented; configured data remains attributed.

### US-3: Preserve bounded continuity, scope and existing public compatibility (Priority: P0)

As a public API consumer, I want exact trusted scope, stable byte continuity and typed isolated failures so that malformed data or optional-reader failure cannot corrupt another context or redefine existing observations.

**Why this priority:** refs/digests are not authorization, pages must not mix versions, and current consumers must keep their existing interface contract.
**Scope:** public artifact and legacy compatibility boundary only; consumer browser/session combined acceptance remains in its separately gated consumer scope.
**Independent Test:** use known fixture reference/digest inputs with independently supplied trusted binding plus legacy public fixtures, without relying on discovery or agent parsing as the asserted behavior.
**Acceptance Scenarios:**
1. **Given** a valid body with multibyte codepoints/BOM/newlines spans several pages, **When** reads use the approved <=128KiB page bound and the same trusted source/task, **Then** each page is complete JSON/codepoint-aligned and contiguous reassembly0..N matches the exact raw-byte digest; eof on the last page alone does not claim possession of earlier bytes.
2. **Given** a caller is bound to task build-cache, **When** it receives a crafted project-scope or other-task REF with recomputed hash/fingerprint, **Then** read refuses against independently configured scope/task before artifact bytes are read; a ref cannot select its own grant.
3. **Given** a source body or relevant inventory membership/manifest changes after a page, **When** the old corresponding cursor/ref is continued, **Then** the relevant stale result refuses rather than mixing bytes or retargeting; unrelated body content does not fabricate cross-file atomicity.
4. **Given** scan/content/output bounds, malformed tokens or required source/resource failures occur, **When** the public operation runs, **Then** a closed typed error contains no partial JSON/data authority; lowering page size is not represented as a universal repair for invalid inventory or resources.
5. **Given** existing legacy list/show/capabilities fixtures and a relocated complete new public runtime/resource closure, **When** old and new public entrypoints run, **Then** old schema/preview/nullability/inert-reference outputs retain their contract, new operations use their separate versioned namespace, and missing new capabilities/resources remain typed rather than making Roster mandatory for independent consumers.


## Challenges

| ID | Story | Challenge | Resolution |
|---|---|---|---|
| C-1 | US-1, US-3 | Q1 discovery and Q2 list item identity disagree in granularity. Discovery is a union of task IDs, but items are artifacts and every task artifact id is the same task ID. Does a root catalog enumerate tasks or every finite artifact slot, including absent slots? What are its exact total, stable ordering, unique item identity and cursor-offset unit? US-1 scenario 2 cannot decide its expected cardinality. | Items are artifact slots, not task rows. Unique identity is (scope,task,kind,id). Task scopes sort task IDs ASCII then the fixed kind order; project scopes sort safe manifest names ASCII. Cursor offset is item index, independent of page size. Project manifest body is separate context, not included in definition total. |
| C-2 | US-1 | Q1 includes discovery only from state/intake/spec names although plan, review and other canonical kinds are eligible. Is a task with only a canonical review deliberately undiscoverable while an explicit task request can read it? Which absent artifact slots must an exact task list return, and when is a task inventory absent rather than valid with missing bodies? The current “same typed availability distinction” does not answer this. | Discover tasks from ALL finite canonical task-kind filenames, including review-only, plan-data and role-brief-only. Exact task lists have all fixed slots when at least one canonical resource exists; missing body slots are explicit. No discovered exact task gives absent inventory, not fabricated empty membership. Legacy list discovery remains unchanged. |
| C-3 | US-1, US-3 | Q1 gives a 10,000-entry scan ceiling while discovery now spans briefs and specs. Is the ceiling combined, per directory or per operation, and do rejected names count? How do absent, unreadable, symlinked or nonregular briefs/specs directories affect discovery independently? Existing one-directory semantics do not determine the new union. | One combined10,000-entry scan budget covers briefs and specs and every encountered entry, including rejected names. Missing one directory is an empty contribution; both missing gives absent inventory. Unsafe/nonregular/unreadable required scan directory fails that operation, not independent project/Git/session data. No partial guessed scan membership. |
| C-4 | US-2 | Q1/Q2 require an “admissible” manifest without freezing which harness-schema requirements govern inventory admission. Does one wrong optional runtime/project field invalidate inventory, or only the required agent container? What happens when layers or agents is missing, agents is wrong-type, or one entry is a scalar? US-2 scenarios 2/3 require distinct outcomes but cannot identify the boundary. | Project admission uses a syntactically valid duplicate-free JSON object with object layers and array layers.agents, within structural limits. Missing manifest is absent; missing/wrong required containers or malformed JSON is invalid. Unrelated optional runtime/project leaf values do not decide admission. Safe raw manifest body remains independently readable through catalog context when inventory invalid. |
| C-5 | US-2 | Q1/Q3 exclude unsafe/duplicate names while retaining unique valid entries. Are all occurrences of a duplicate excluded, or can any occurrence remain? Are equality and source_index defined before or after filtering? Why is membership total uncertain when every entry was fully scanned and every excluded index is known? Specify precisely when total is null versus an exact count. | All occurrences of a duplicated canonical name are excluded; indices refer to original agents array before filtering. Unsafe/scalar/missing-identity entries likewise produce invalid_entries. Definition total is null when unidentifiable/duplicate declarations leave intended membership unresolved; invalid_entries.total is the exact count of excluded source indices. Missing bodies/invalid leaf metadata do not invalidate known identity membership. Valid empty agents array alone gives known0 definitions. |
| C-6 | US-2 | Q1 eligibility mentions only safe manifest names, while source/source_id/version and runtime enablement are independent configuration facts in the supplement. Is a safe named entry eligible when source is unknown, required declaration metadata is missing, or the selected runtime is disabled? Distinguish malformed identity/admission from invalid leaf configuration; otherwise frontmatter independence does not settle declaration-level eligibility. | A unique safe name admits its fixed canonical definition path even if optional source/version/runtime metadata is invalid or a runtime is disabled. Those are configuration observations, not permissions/execution. Missing/invalid identity never selects a file; optional metadata cannot retarget it. |
| C-7 | US-2 | Q2's single metadata.fields object can contain both manifest and definition fields named name, version and tunables. Their observed values can legitimately differ (supplement: installed implementer 1.3.0 versus catalog 1.4.0). Which source owns each field, what is retained on disagreement, and which comparison actually makes metadata invalid? Q3's “inconsistent declared ... version/count/status” lacks an authoritative comparator. | Separate fields.declaration and fields.definition attribution; never overwrite one from the other. Different installed/definition/catalog versions are retained as reported values, not automatically false. A definition name mismatch nulls its parsed name with a name-mismatch issue but cannot change canonical identity or deny a safe inert body. |
| C-8 | US-2 | Q2 references “existing ... published schemas” rather than a frozen field/type/optionality enumeration. Which exact frontmatter fields, nested types, defaults, allowed extensions and issue semantics are in public v1? Which metadata is available for task review/ledger/manifest bodies? US-1 scenario 3 and US-2 scenario 4 cannot test an undefined fields vocabulary. | Freeze declaration fields name/source/version/role/tunables and the agent-schema frontmatter whitelist in the supplement below. Non-agent metadata exposes only attributed reported task/status/round/cycle/date with nullable typed values; no computed workflow acceptance or count truth. Full original bodies remain readable. |
| C-9 | US-2, US-3 | Q2 bounds scalar summaries but does not bound metadata nesting, field counts, arrays, issue counts or tunables. Can a sub-16MiB manifest with deeply nested YAML/JSON or large metadata arrays force unbounded parsing/output work before output_limit? “All strings/tokens/arrays are bounded” supplies no implementable bounds or truncation location/meaning for these structures. | Metadata frontmatter max64KiB; decoded input admission depth32/nodes100000, returned metadata trees depth8/nodes1000/mapkeys64/arrayitems100/text2000 UTF16 units without surrogate splitting. Issues are a bounded summary with exact total/truncated; extra metadata does not silently become authority. Bodies retain16MiB/128KiB limits. |
| C-10 | US-2 | US-2 scenario 4 requires malformed frontmatter to preserve safe inert body readability, but no parsing language/subset, duplicate-key treatment, alias/tag semantics or delimiter rules are specified. What is metadata availability for absent frontmatter, unsupported YAML features, repeated blocks and syntactically valid wrong-type roots? Canonical body bytes cannot decide these metadata outcomes. | Only first leading frontmatter block (optional BOM, --- delimiter, LF/CRLF) is metadata; later blocks are body. Reuse maintained existing parser/code in safe JSON-compatible scalar/map/sequence mode. Reject duplicate keys, anchors/aliases/merge/custom tags/executable or non-JSON object types as metadata invalid; absent/oversized/unterminated/wrong-root frontmatter is explicit invalid metadata, never body loss. No new general YAML engine. |
| C-11 | US-1, US-2, US-3 | Q2 calls list body availability “not valid” without enumerating body/metadata availability values or reasons. Q3 says unsafe/invalid-UTF8 bodies are item observations, while its first row says unsafe-source/bounds failures fail the appropriate operation/source. Which failures isolate an item and which abort the entire list? What exactly does direct read return for a never-existing body versus a previously referenced removed one? | Body enum valid/absent/invalid; metadata valid/invalid/unknown. List individual-source absence/unsafe/UTF8/oversize faults become body observations with null hash/length/ref; unsafe root/required inventory/resource/budget failures abort the proper operation. A read has a required digest REF: current missing or changed eligible body is stale_reference, without asserting prior issuance. Missing raw-source discovery is observed by list. |
| C-12 | US-3 | Q2 requires trusted root/scope/task supplied independently of REF. The CLI can validate equality but cannot establish the caller's external grant. What are the precise library preconditions versus guaranteed checks for CLI and module use, and what trusted binding does a root-catalog task list receive when task is omitted? Otherwise US-3 scenario 2 can pass by deriving its expected task from the same untrusted request it asserts is independently bound. | External trusted caller supplies configured root/scope/task; library guarantees input/equality/canonical-eligibility checks, not external authentication. Root-catalog list is explicit scope task/tasknull grant; configured task sources always pass T. Each emitted task REF binds its concrete T. Read requires that independently trusted concrete task or explicit project binding. |
| C-13 | US-3 | Q2 source identity uses resolvedRoot and canonical JSON without defining resolution/canonicalization. Do relative roots, symlinked root aliases, trailing separators and nonexistent roots identify the same source or refuse? Which root safety checks precede identity generation, and may an unsafe root reach inventory scanning? The existing source contexts acknowledge ancestor-replacement limits; do not infer a stronger sandbox from a hash. | Resolve trusted ROOT with path.resolve at call admission, remove only filesystem trailing separators; do not Unicode-normalize names. Relative equivalent roots map identically. Reject symlink ancestors/final root and non-directory roots before scanning; nonexistent/unreadable root is read_failed. No stronger hostile-ancestor sandbox than documented detectable checks is promised. |
| C-14 | US-1, US-3 | REF is publicly forgeable and is not a credential, yet US-3 only challenges foreign-scope forgery. Is a recomputed same-scope REF for an eligible current body readable without a prior list receipt? If so, which exact facts besides safe canonical eligibility are verified, and what does “source ... continuity” claim about issuance/custody? A matching digest does not prove the reference was produced by this reader or that its claims are true. | An eligible current same-scope REF with independently verified exact current digest may be constructed without prior listing and read. It is not a bearer/issuance/custody proof. Unsafe/mismatched scope/kind/ID and current ineligibility never gain a read from recomputed hashes. |
| C-15 | US-3 | Q2 requires canonical base64url JSON but does not freeze JSON canonicalization or token rejection rules: duplicate keys, extra keys, key order, padding, noncanonical numbers, invalid UTF-8, escaped versus literal strings and oversized decoded tokens. Is canonicality a property of bytes or parsed values? Exactly which invalid_reference/invalid_cursor/invalid_request outcomes follow? | Canonical tokens are unpadded base64url of strict UTF8 compact JSON with recursively ASCII-sorted keys and safe integers. Parse, validate exact keys/types, canonical reserialize/reencode and demand exact byte equality; this rejects duplicates, reordered/extra keys, whitespace, padding, noncanonical numbers/escaping, invalidUTF8 and oversized tokens. Empty supplied cursor is invalid_cursor; only omitted/null is absent. |
| C-16 | US-3 | The cursor has no scope/task/ref fields beyond source_id and a “fingerprint” described as “exact REF/raw-content digest identity.” What exact tuple is hashed for a read cursor? Two eligible artifacts can have identical bytes, and a list cursor can otherwise share a source. Can cursors be replayed across kinds, IDs or operations with equal hashes? Define the binding before claiming continuity. | Read cursor fingerprint hashes [artifact-read/v1,sourceID,scope,task,kind,id,bodySHA256,totalBytes,artifactResourceFingerprint]; list fingerprints include operation/source/filter and complete inventory identity. Therefore equal-byte different artifacts and list/read cursors cannot interchange. |
| C-17 | US-1, US-2, US-3 | The list fingerprint binds “complete admissible inventory membership,” but membership is undefined: task IDs, artifact slots, currently present files, valid bodies, invalid-entry indices or metadata state? Does creating a missing definition body or removing a canonical report invalidate pagination? US-3 scenario 3 cannot distinguish relevant membership changes from permitted unrelated content changes. | List fingerprint covers ordered task/kind slots or canonical project names, all eligible filename presence/file-type classes, project manifest raw digest, invalid identity indices and new public resource identity; no unrelated body digests. Creating/removing canonical bodies changes presence and stales list cursors; content-only change stales selected body refs, not a fabricated atomic whole-catalog snapshot. |
| C-18 | US-2, US-3 | Every project read must revalidate current eligibility, but Q2 does not define whether an old REF becomes stale after any manifest-byte change, only a membership change, or only loss of its own eligibility. A role edit can stale list cursors while leaving the same definition bytes and safe name. What source revision is visible in the read response in that case? List fingerprint and body REF are separate, and no atomic snapshot is promised. | Manifest-byte change stales a project list cursor. A body REF stays usable if its independently bound safe name remains currently eligible and body digest unchanged; every page rechecks that eligibility. No atomic configuration/body transaction is claimed. Loss of eligibility returns stale_reference, even if bytes still exist. |
| C-19 | US-3 | Read offset is a UTF-8 boundary, but permitted offset range, offset beyond EOF, cursor at EOF, forged in-range offset and changes to page-bytes across continuation are unspecified. Can a caller request a terminal cursor directly, and exactly what does eof mean then? US-3 scenario 1 properly denies prior-byte possession but still lacks deterministic request/result rules. | Offsets are safe integers0..N inclusive on codepoint boundaries. BeyondEOF/negative/mid-codepoint cursor is invalid_cursor. A forged valid in-range cursor is allowed because it is not a credential; it establishes only returned range, not earlier possession. AtEOF returns empty rangeN..N/eoftrue. Page size may change across continuation without changing identity. |
| C-20 | US-3 | “Permitted4..128KiB UTF-8 bytes” is ambiguous between minimum 4 bytes and minimum 4KiB; CLI number units and integer grammar are also unspecified. The maximum page can end inside a four-byte codepoint. What range/progress invariant applies when the bound cannot contain the next codepoint? Empty content and exact multibyte boundaries need unambiguous byte limits. | Page units are integer BYTES: decimal CLI integers4..131072, default65536. For offset<N, return the largest UTF8 boundary <=min(N,offset+limit) and >offset; minimum4 guarantees progress for a four-byte scalar. No suffix skipping or split sequence. |
| C-21 | US-3 | Q2 promises exact raw UTF-8 preservation including BOM, while strings are transported through JSON. Which UTF-8 validity policy applies to overlong encodings, surrogate encodings, NUL, lone continuation bytes and noncharacters, and are metadata truncations permitted to split UTF-16 surrogate pairs into lone JSON surrogates? The old slice behavior is not complete-content decoding semantics. | Strict UTF8 rejects overlong, surrogate and invalid continuation encodings; preserve valid BOM, CR/LF, NUL and Unicode noncharacters as exact text bytes. No NFC/newline normalization. Metadata summaries clip only at valid UTF16 scalar boundaries, with explicit truncation; full body never clips. |
| C-22 | US-3 | Q2 caps “bytes actually consumed” at 32MiB but every read must revalidate eligibility and full selected-body digest. A 16MiB manifest plus a 16MiB definition is exactly at budget before other inventory/digest work; repeated reads may consume the same bytes again. What is counted once versus repeatedly, what early over-limit invariant applies, and is every advertised individually eligible maximum-size body actually retrievable in its required context? | 32MiB counts actual artifact/configuration bytes consumed per operation, not hashing the same in-memory buffer again, runtime code or schema loading. Read each necessary manifest/body once per call, reuse admitted buffer/descriptors for hash/metadata/page, and use metadata/stat rechecks without mandatory full rereads. Thus a16MiB manifest+16MiB body remains representable. Every physical reread would count again; cap before data reads. Smaller list limit cannot fix whole-inventory/manifest/scan/resource failures. |
| C-23 | US-1, US-3 | Q2 inventory fingerprint work excludes unrelated body digests, yet selected body digests are required when refs are emitted. What happens if a file changes while it is being consumed without changing size, or the manifest changes between eligibility validation and body open? “Any content change ... refuses” is stronger than an unqualified best-effort filesystem observation can demonstrate. Which within-call consistency claim and detectable change classes are actually required? | Required detectable guards compare descriptor/path identity and available before/after stat size/mtime/ctime plus content digest and manifest eligibility. Refuse detected within-call replacement/mutation rather than issue a stable ref. Hash identifies consumed bytes, not proof of no possible undetected hostile concurrent mutation/cross-file atomicity. Preserve documented ancestor-race limitation; no new sandbox claim. |
| C-24 | US-3 | Errors are “closed” with fixed bounded messages, but no error precedence is frozen. A foreign-scope REF with invalid encoding, stale digest and unsafe current source can satisfy several error conditions. Which checks must occur before artifact opens, and which outcome dominates after continuity/eligibility/resource failure? This affects both absence leakage and deterministic tests without implying an authorization grant. | Order: validate option/token shapes; compare independently trusted scope/source/task/kind; validate required runtime/resources and root/canonical eligibility; safely consume/check descriptor/source; compare REF/current digest then cursor fingerprint/range. Malformed token wins before artifact opens; REF/current mismatch is stale_reference, otherwise wrong cursor fingerprint is stale_cursor. Unsafe sources never emit data; unobservable low-level faults become fixed read_failed, not raw diagnostics. |
| C-25 | US-3 | Q2 gives CLI error channels/exit2 but only names three new module exports. What are the exact module signatures, default values, serialization responsibility and thrown/returned error contract? The source context's existing ObservationError/serialize behavior cannot automatically be assumed for the new namespace. | artifactCapabilities(), artifactList({root,scope,task=null,limit=25,cursor=null}), artifactRead({root,scope,task,ref,pageBytes=65536,cursor=null}) are synchronous and return new envelopes, enforcing2MiB serialized bound before return. Throw exported ObservationError with fixed new codes/messages; CLI serializes through bounded serialize then emits stdout success/stderr error exit2. Unknown/extra module options rejected. |
| C-26 | US-3 | The new schema identity is specified, but capabilities data lacks an exact field shape and public resource digest/closure composition is not frozen. Which schemas/coverage/parser companions must be distributed and validated offline, and what establishes schema.digest for list and page? The narrow existing schema compiler cannot be presumed to enforce every stated conditional relationship. US-3 scenario 5 cannot assert relocated closure completeness until these normative resources are identified. | Capabilities data has exact limits/coverage/reference_version1/cursor_version1 shape. New offline resources are schema/artifact-observation.schema.json and schema/artifact-coverage.json plus the reader/metadata-parser companions declared by actual validated plan/distribution manifest. schema.digest is raw new observation schema SHA256; resourceFingerprint binds all declared new resources/companions. Basic supported schema grammar plus explicit runtime conditional/range checks, never richer-schema or semantic-truth claims. New source/installed relocatable closure tests must freeze actual members before implementation is accepted. |
| C-27 | US-3 | Q3 promises typed unavailable/unsupported for missing/incompatible runtime, but the closed producer error codes include neither unavailable nor unsupported, and a missing executable cannot emit producer JSON at all. Which states belong to this library and which are external acquisition/consumer classifications? Capability version negotiation and missing new operation behavior are not specified by the “existing operation convention.” | Producer emits only its defined new operation errors; missing executable/Node, unsupported command in old producer and version incompatibility are caller acquisition classifications, not impossible producer JSON. New resource incompatibility is runtime_resource. No lifecycle negotiation: new namespace schema/version1/capabilities are explicit; incompatible token version rejects. |
| C-28 | US-1, US-3 | Prior art Public Roster 757 deliberately returns nine brief projections, 2,000-unit/100-item summaries, null terminal tokens and inert manifest references; stories assume a new permanent spec identity, root-discovered specs and complete byte content—justify divergence or adopt the prior behavior explicitly. Which legacy observable guarantees must remain identical when new parser/resources are missing, and can artifact-resource installation failure disable old list/show/capabilities? “Unchanged” and a shared entrypoint are insufficient acceptance detail. | Local Roster summary prior art is preserved verbatim in old operations; a separately disclosed new full-content namespace serves the added requirement. Test new-only companion/schema/resource absence independently: new operations fail runtime_resource while all old required resources still let old operations work. No eager new-reader load for old ops. Compare defined semantic fields, current schema IDs/nullability/inert behavior and frozen fixture time; validate dynamic version/time/hash identity rather than demand impossible literal equality across code revisions. |
| C-29 | US-1, US-3 | Prior art MCP 2026-07-28 Resources uses URI identities, allows multiple text/binary contents and missing-resource errors, and supplies no universal complete-content cursor guarantee; stories assume a finite local string REF and one exact UTF-8 body—justify divergence or adopt the relevant resource semantics. Is binary content explicitly unsupported, and how are missing bodies distinguished from an empty valid text body? This challenges the semantic claim, not the chosen CLI transport. | MCP URI/multi-content/binary resource behavior belongs to that protocol. This local CLI intentionally supports one finite canonical UTF8 document, explicit empty versus absent body and bounded byte continuity. Binary bodies are unsupported/invalidUTF8, not silently decoded. This divergence is required by accepted bounded local public-reader scope, not a claim of MCP equivalence. |
| C-30 | US-3 | Prior art MCP 2026-07-28 Pagination uses opaque list cursors, server-selected sizes and valid empty-string cursors; stories assume canonical base64url tokens, caller byte sizes and read-content continuation—justify divergence or adopt the applicable behavior. Are tokens externally opaque despite their specified structure, and is an empty cursor absent, malformed or valid? List completion must not imply document-content completion. | Local canonical tokens and caller byte limits are not MCP list cursors. Tokens remain externally opaque/noncredential despite documented validation grammar; empty supplied cursor is malformed. Local eof/nextcursor only describes returned inventory/page, not all document possession. |
| C-31 | US-1, US-2 | Prior art MCP 2026-07-28 Tools permits resource links absent from resources/list; stories assume finite canonical eligibility and current manifest membership before reads—justify divergence or adopt that behavior. Does absence from a paged/partial local list by itself prove ineligibility, especially for exact task reads? Do not silently turn local inert declarations into MCP links or widen the whitelist. | MCP tool links may be unlisted, but local manifest declarations remain inert. Not appearing in a partial page does not prove ineligibility; exact same-scope canonical eligibility is checked independently at read, not by requiring a prior list receipt. No MCP link semantics/import or whitelist widening. |
| C-32 | US-3 | Prior art MCP 2026-07-28 Discovery/Versioning separates capability/version negotiation and treats server identity as unverified; MCP 2025-11-25 instead uses initialize and different subscription methods. Stories assume local artifact-capabilities and schema_version1 without a negotiated lifecycle—justify divergence or adopt only the relevant semantics, retaining revision labels. What exact compatibility/version refusal does this local extension promise without importing either MCP lifecycle or treating schema/source hashes as authentication? | Keep MCP2026/2025 version distinctions documentary; this extension has no MCP handshake/transport negotiation. New local schema/version and fixed error/capability acquisition rules suffice; identities/digests do not authenticate server/agent truth. |
| C-33 | US-2, US-3 | The supplement distinguishes configured definitions, generated runtime extras, library catalog, persisted roadmap assignments and explicit Mesh participation. US-2 demands honest use reporting but Q2 only says use “defaults” to unknown. Is unknown/session:null invariant for this reader, or can some input populate use, and from which finite public evidence contract? Otherwise future implementations can invent a join under an undefined exception to “defaults.” | For this reader use is invariant {availability:unknown,reason:not-observed,session:null}. Never fill it from manifest/runtime labels or adjacent assignments. Roadmap persisted assignment evidence remains separately delegated/attributed, and exact Mesh joins belong to an explicit separate consumer evidence contract. |
| C-34 | US-1, US-2, US-3 | The intake requires explicit supported/delegated/unsupported coverage and distinguishes absent capability from absent/invalid definitions. Q2 capabilities promises finite kinds but does not freeze the category/status/reason vocabulary for unsupported history/evidence, generated/global agents, roadmap evidence and unobserved use. Can a consumer distinguish unsupported category from a supported category with no artifact without probing guessed refs? | Freeze supported task-artifacts/project-agent-definitions/manifest-body and metadata; delegated roadmap-persisted-observations/legacy-phase-history; unsupported arbitrary manifest targets, historical-report bodies, generated/global project inventory, live execution/authenticated session joins. Category unsupported differs from supported body absent/invalid and missing external capability/runtime. |
| C-35 | US-1, US-3 | A safe canonical path can contain another task's declared title/task_id, false verdicts or command-like content. US-1 only tests malformed JSON, while Q3 mentions wrong count/status and prohibits truth inference. Which structured domain failures invalidate metadata, which retain attributed reported fields, and is a valid workflow verdict ever projected without its “reported” status? The body digest only identifies bytes; canonical placement cannot certify task attribution asserted inside them.  | Canonical placement/digest only identifies chosen bytes. Task/report metadata is explicitly reported, not accepted; wrong/foreign declared task or contradictory status markers null the affected field with issue, never retarget. Numeric round/cycle must be nonnegative safe integers; invalid values unknown. No reported count summary is synthesized as verified truth; full bodies preserve declarations inertly. Plausible false but well-typed claims stay attributed, not vouched for. |

## Functional Requirements

- **FR-001** [US-1]: Task discovery MUST include every safe task ID having any filename in Matrix T. (US-1; C-2)
- **FR-002** [US-1]: Each discovered task MUST contribute all 14 Matrix T artifact slots, including absent bodies. (US-1; C-1/C-2)
- **FR-003** [US-1]: Catalog items MUST have unique identity `(scope,task,kind,id)`. (US-1; C-1)
- **FR-004** [US-1]: Task catalog ordering MUST be ASCII task ID order followed by Matrix T order. (US-1; C-1)
- **FR-005** [US-1]: Exact-task catalog absence MUST be distinguished from a valid empty root catalog according to Table A. (US-1; C-2)
- **FR-006** [US-1]: Task scans MUST apply a single 10000-entry ceiling across briefs and specs, counting rejected entries. (US-1; C-3)
- **FR-007** [US-1]: Task directory admission MUST follow Table A without returning guessed partial membership. (US-1; C-3)
- **FR-008** [US-1]: Task references MUST resolve only through Matrix T using safe IDs, independent of manifest targets. (US-1; C-14/C-31)
- **FR-009** [US-1]: A complete canonical spec MUST retain identity distinct from its spec-result marker. (US-1; story scenario 1)
- **FR-010** [US-1]: Catalog body observations MUST follow Table B independently of metadata validity. (US-1; C-11)
- **FR-011** [US-1]: Task structured metadata MUST use only the source-attributed reported group in Table M. (US-1; C-8/C-35)
- **FR-012** [US-1]: Foreign declared task identity or contradictory status markers MUST null the affected reported field with an issue. (US-1; C-35)
- **FR-013** [US-1]: Reported round/cycle MUST be null with an issue unless nonnegative safe integers. (US-1; C-35)
- **FR-014** [US-1]: Reported claims MUST NOT become verified counts, workflow acceptance, commands or permission. (US-1; C-35)
- **FR-015** [US-2]: Project inventory admission MUST follow Table A's required manifest structure. (US-2; C-4)
- **FR-016** [US-2]: Project definition eligibility MUST require a unique safe canonical manifest name, independent of optional metadata and runtime enablement. (US-2; C-6)
- **FR-017** [US-2]: Every occurrence of a duplicated name and every unsafe/scalar/missing-identity entry MUST be excluded from definition membership. (US-2; C-5)
- **FR-018** [US-2]: Invalid-entry observations MUST preserve original array indices and exact excluded-index count with bounded explicit truncation. (US-2; C-5)
- **FR-019** [US-2]: Definition total MUST be null when excluded declarations leave intended membership unresolved. (US-2; C-5)
- **FR-020** [US-2]: Known definition membership MUST survive missing bodies and invalid leaf metadata. (US-2; C-5/C-6)
- **FR-021** [US-2]: Project definitions MUST be ordered by ASCII canonical name. (US-2; C-1)
- **FR-022** [US-2]: Project manifest body MUST be exposed separately through `context.project_manifest` without contributing to definition total. (US-2; C-1/C-4; EC-5)
- **FR-023** [US-2]: Invalid required inventory structure MUST NOT authorize any definition read. (US-2; C-4)
- **FR-024** [US-2]: Definition reads MUST resolve only `.harness/agents/A.md` for currently eligible A. (US-2; C-6/C-31)
- **FR-025** [US-2]: Metadata MUST retain declaration and definition values in separate nullable groups defined by Table M. (US-2; C-7/C-8)
- **FR-026** [US-2]: A definition-name mismatch MUST null its parsed name with `name-mismatch` while preserving canonical identity and safe inert body. (US-2; C-7)
- **FR-027** [US-2]: Separately sourced differing version values MUST remain attributed without automatic invalidation. (US-2; C-7)
- **FR-028** [US-2]: Metadata MUST apply Table M's field types, required-field issues and optional-null behavior without injected defaults. (US-2; C-8)
- **FR-029** [US-2]: Metadata extraction MUST accept only the first leading frontmatter block under Table F. (US-2; C-10)
- **FR-030** [US-2]: Invalid or unsupported frontmatter MUST produce invalid metadata without denying an independently valid inert body. (US-2; C-10)
- **FR-031** [US-2]: Metadata admission and summaries MUST obey Table L's structural and output bounds with explicit issues/truncation. (US-2; C-9)
- **FR-032** [US-2]: Decoded metadata strings MUST null an ill-formed affected field with an issue rather than emit an unpaired UTF-16 surrogate. (US-2; C-21; approved additional clarification)
- **FR-033** [US-2]: Metadata string clipping MUST preserve scalar boundaries and explicitly report truncation. (US-2; C-9/C-21)
- **FR-034** [US-2]: Every item use value MUST equal `{availability:"unknown",reason:"not-observed",session:null}`. (US-2; C-33)
- **FR-035** [US-2]: Definition/configuration content MUST NOT establish mobilization, execution, live identity, permission or authenticated session association. (US-2; C-33)
- **FR-036** [US-3]: The public CLI and synchronous module API MUST expose Table W's additive operations and signatures. (US-3; C-25)
- **FR-037** [US-3]: Invalid, extra, repeated or out-of-range request options MUST be rejected as invalid_request. (US-3; C-25; proposal Q2)
- **FR-038** [US-3]: Every success MUST conform to Table W's closed versioned envelopes. (US-3; C-25/C-26)
- **FR-039** [US-3]: Capability observations MUST disclose Table L limits and Table C coverage. (US-3; C-26/C-34)
- **FR-040** [US-3]: Trusted root/scope/task MUST be supplied independently of REF as the caller precondition in Table S. (US-3; C-12)
- **FR-041** [US-3]: Reads MUST enforce independent binding equality before consuming artifact bytes. (US-3; C-12/C-24)
- **FR-042** [US-3]: Source identity MUST follow Table S's root normalization and source digest rule. (US-3; C-13)
- **FR-043** [US-3]: Unsafe root ancestors/final root or non-directory roots MUST be refused before scanning. (US-3; C-13)
- **FR-044** [US-3]: A currently eligible same-scope REF with current digest MUST be readable without a prior list receipt. (US-3; C-14/C-31)
- **FR-045** [US-3]: Tokens MUST conform byte-for-byte to Table K's canonical grammar. (US-3; C-15)
- **FR-046** [US-3]: Malformed REF/cursor tokens MUST be refused with their corresponding invalid_reference/invalid_cursor code. (US-3; C-15)
- **FR-047** [US-3]: Read cursors MUST bind every component of Table K's read fingerprint. (US-3; C-16)
- **FR-048** [US-3]: List cursors MUST bind Table K's complete inventory identity rather than unrelated body content. (US-3; C-17)
- **FR-049** [US-3]: Every body page MUST revalidate current canonical eligibility and selected raw-byte digest. (US-3; C-18)
- **FR-050** [US-3]: Changed/removed body or lost eligibility MUST refuse the REF as stale_reference. (US-3; C-11/C-18)
- **FR-051** [US-3]: A manifest-byte edit MUST stale the project list cursor while allowing an unchanged still-eligible body REF. (US-3; C-18)
- **FR-052** [US-3]: Page ranges MUST satisfy Table P's byte-offset and progress rules. (US-3; C-19/C-20)
- **FR-053** [US-3]: Strict UTF-8 body decoding MUST follow Table P without normalization or replacement. (US-3; C-21/C-29)
- **FR-054** [US-3]: Full-artifact completeness MUST require contiguous `0..total_bytes` reassembly under one REF/digest. (US-3; C-19/C-30)
- **FR-055** [US-3]: Terminal page/list flags MUST NOT assert possession of earlier body bytes. (US-3; C-30)
- **FR-056** [US-3]: Actual artifact/configuration bytes consumed MUST stay within Table L's per-operation budget. (US-3; C-22)
- **FR-057** [US-3]: An admitted 16MiB manifest plus 16MiB body MUST remain retrievable within the 32MiB consumption budget. (US-3; C-22)
- **FR-058** [US-3]: Detectable within-call replacement/mutation MUST refuse a stable result under Table G. (US-3; C-23)
- **FR-059** [US-3]: References and digests MUST NOT assert issuance, custody, external authorization, semantic truth, cross-file atomicity or an undetectable-race guarantee. (US-3; C-14/C-23/C-32)
- **FR-060** [US-3]: Operation failures MUST follow Table E's precedence and closed bounded error contract. (US-3; C-24/C-25)
- **FR-061** [US-3]: Required new resources MUST be validated offline under Table R for new operations. (US-3; C-26)
- **FR-062** [US-3]: Runtime resource failure MUST be isolated from legacy operations when their own resources remain complete. (US-3; C-28)
- **FR-063** [US-3]: Existing list/show/capabilities MUST retain Table H's compatibility contract. (US-3; C-28)
- **FR-064** [US-3]: Missing executable/Node, absent new command and incompatible external producer MUST be classified at acquisition rather than fabricated as producer JSON. (US-3; C-27)
- **FR-065** [US-3]: New resource incompatibility MUST produce runtime_resource. (US-3; C-27)
- **FR-066** [US-3]: The extension MUST NOT import an MCP lifecycle, resource-link authorization or binary/multi-content contract. (US-3; C-29/C-31/C-32)
- **FR-067** [US-3]: Capability coverage MUST distinguish unsupported category, absent/invalid supported body and missing external capability. (US-3; C-34)
- **FR-068** [US-3]: Output-limit failure MUST return a closed error rather than partial JSON or fabricated partial success. (US-3; C-22/C-24)

## Normative Contract


### Matrix T — fixed task kind order and canonical resources

Task ID T and project name A match `^[a-z0-9]+(?:-[a-z0-9]+)*$`, length 1..120. No arbitrary role suffixes, `.tmp`, archive or manifest target is eligible.

| Order | Kind | Resource |
|---|---|---|
| 1 | spec | specs/T.md |
| 2 | intake | briefs/T-intake.md |
| 3 | spec-result | briefs/T-spec.md |
| 4 | plan | briefs/T-plan.md |
| 5 | plan-data | briefs/T-plan.json |
| 6 | implementer-brief | briefs/T-implementer.md |
| 7 | reviewer-brief | briefs/T-reviewer.md |
| 8 | qa-scope | briefs/T-qa-scope.md |
| 9 | implementation | briefs/T-impl.md |
| 10 | review | briefs/T-review.json |
| 11 | qa-state | briefs/T-qa-state.json |
| 12 | qa | briefs/T-qa.md |
| 13 | ledger | briefs/T-state.json |
| 14 | manifest | briefs/T-manifest.txt |

### Table A — inventory admission and totals

Availability reasons are null/manifest-absent/manifest-invalid/task-absent/directories-absent. Missing project manifest and all task scopes have context.project_manifest null; a readable invalid project manifest has a descriptor with valid body.

| Condition | Observation |
|---|---|
| Exact T with any canonical filename | valid; 14 slots; total 14 |
| Exact T with no canonical filename | absent; total null; items []; next_cursor null |
| Root discovery; directory exists, no task | valid; total 0 |
| One canonical task directory missing | Empty contribution from that directory |
| Both canonical task directories missing | absent; total null |
| Required directory unsafe/nonregular/unreadable or combined scan ceiling exceeded | Operation error; no partial catalog |
| Project manifest absent | absent/manifest-absent; total null; items []; next_cursor null; no manifest body REF |
| Manifest malformed/duplicate-key JSON, wrong root/layers/agents type, missing required containers or excessive source structure | invalid/manifest-invalid; total null; items []; next_cursor null; safe raw manifest may remain in context |
| Admissible manifest | JSON object with object layers and array layers.agents; unrelated optional leaves do not affect membership |
| Valid empty agents array | valid; total 0; items []; context manifest is separate |
| Valid array containing excluded identities | Retain unique safe identities; definition total null; exact excluded source-index total |

### Table B — independent body observation

`body={availability,reason,sha256,total_bytes,ref}`. Availability is valid/absent/invalid. Valid includes an empty file and has lowercase 64-hex digest, nonnegative bounded byte length and REF. Every nonvalid body has exactly null digest/length/ref. Missing bodies are absent; unsafe/symlink/nonregular/hardlinked/oversize/invalid-UTF8 bodies are invalid. Valid body reason is null; absent reason is not-found; invalid reasons are unsafe-source/oversized-source/invalid-utf8/read-failed/source-changed. Detected source change is invalid/source-changed on a list item and stale_reference on direct read. Individual catalog faults stay item observations; unsafe root, required inventory/resource and budget faults abort that operation. Direct read of a missing eligible body, including one never listed, is stale_reference; a readable REF does not prove earlier issuance. Metadata invalidity does not change safe body availability.

### Table M — source-separated metadata

`metadata={availability,fields:{declaration,definition,reported},issues:{items:[{field,reason}],total,truncated},truncated}`; availability is valid/invalid/unknown. Issue reasons are missing/wrong-type/name-mismatch/task-mismatch/contradictory/parse/unsupported-yaml/limit/ill-formed-string. Irrelevant groups are null. Each relevant group's listed fields is present and nullable. Unknown extensions remain only in inert full text. Required missing/wrong fields produce issues; optional absence is null without an issue/default. Wrong fields are null/invalid or unknown with reasons. All nested values are JSON-safe finite primitives/maps/sequences; no executable/non-JSON object values.

| Group | Fields and type constraints |
|---|---|
| declaration | name/source/version/role: strings; tunables: map. Canonical identity admission depends on name only; bad leaf metadata does not revoke it. |
| definition required | name/display_name/description/model: strings; domain/tags/compatible_with: string arrays; complexity: low/medium/high |
| definition optional | version: semver string; author/source: strings (source URL); pipeline_role: map of string triggered_by/receives/produces and human_gate leading before/after/both/none optionally followed by ` — ` annotation; tunables: JSON-safe map; requires: array of strings or tool objects (name string, type mcp/builtin/cli, optional install/check strings and optional boolean); runtime_hints: runtime maps with model strings; entrypoints: runtime maps with type (claude-code agent/command/rule/hook, codex agent/skill/cli/agents-md); isolation worktree/none; overlay personal; replaces string array |
| reported | task/status/date: nullable strings; status only an inert attributed string declaration, never acceptance; round/cycle: nonnegative safe integers. Foreign task/contradictory status nulls affected field with issue. No count/duration/live field. |

SemVer here means the complete SemVer 2 grammar: numeric core identifiers have no leading zero except zero itself; prerelease and build identifiers are nonempty dot-separated ASCII alphanumeric/hyphen identifiers; numeric prerelease identifiers have no leading zero except zero itself. Build numeric identifiers may have leading zero. For example, `1.2.3`, `0.0.0-0` and `1.2.3-rc.0+build.01` are valid; `1.2.3-01`, `1.2.3-.`, `1.2.3-a..b` and `1.2.3+.` are invalid. Invalid optional definition.version is null with a version/wrong-type issue and invalid metadata, while an independently safe full body stays readable. Absent optional version stays null without an issue. These examples clarify FR-028 and AC-11.

Distinct versions are not reconciled. A raw ASCII JSON surrogate escape may remain in full-body bytes while its decoded ill-formed metadata field becomes null with an issue.

### Table F — metadata frontmatter language

Only the first leading block after optional BOM, with `---` delimiters and LF/CRLF, is metadata. Later blocks remain body text. A safe JSON-compatible YAML scalar/map/sequence subset is admitted; the metadata root must be an object. Duplicate keys, anchors, aliases, merges, custom tags, executable or non-JSON objects are invalid metadata. Missing/unterminated/oversized frontmatter is invalid metadata. This contract requires no new general YAML engine; maintained parser reuse is a planning constraint rather than permission to widen the language.

### Table L — public limits

| Limit | Value |
|---|---|
| source_bytes | 16777216 |
| response_bytes (serialized UTF-8) | 2097152 |
| page_bytes | min 4; default 65536; max 131072 |
| catalog_items | min 1; default 25; max 100 |
| scan_entries | 10000 combined |
| catalog_bytes actually consumed | 33554432 per operation |
| ref_bytes / cursor_bytes | 4096 / 8192 |
| frontmatter input bytes | 65536 |
| decoded source depth / nodes | 32 / 100000 |
| project agent declarations | 10000 |
| output metadata depth / nodes | 8 / 1000 |
| output map keys / array items | 64 / 100 |
| metadata string UTF-16 units | 2000, scalar aligned |
| metadata issues / invalid_entries displayed | 100 each; exact total and truncated |

Actual artifact/configuration byte reads count each physical consumption, including repeated reads; hashing an admitted buffer again, runtime code and schema loading do not count. Admission must avoid unnecessary full rereads so the maximum manifest/body pair fits exactly. Lowering list/page size does not repair whole-inventory, required manifest, scan, resource or unsafe-source failures. Metadata clipping cannot silently truncate full text.

### Table W — operations and closed envelopes

| CLI | Synchronous module |
|---|---|
| artifact-capabilities | artifactCapabilities() |
| artifact-list --root ROOT --scope task\|project [--task T] [--limit N] [--cursor TOKEN] | artifactList({root,scope,task=null,limit=25,cursor=null}) |
| artifact-read --root ROOT --scope task\|project [--task T] --ref REF [--page-bytes N] [--cursor TOKEN] | artifactRead({root,scope,task,ref,pageBytes=65536,cursor=null}) |

Success exactly `{schema_version:1,kind,schema:{id,digest},source,data}`; ID `https://github.com/mathiasbourgoin/roster/schema/artifact-observation/v1`; kind artifact-capabilities/artifact-list/artifact-page. Capabilities source null, otherwise `{id,scope,task}`. Module returns bounded envelopes, throws exported ObservationError on defined failures; CLI uses bounded serialize, stdout success and stderr error/exit 2.

| Data | Exact shape |
|---|---|
| capabilities | {limits,coverage,reference_version:1,cursor_version:1} |
| list | {availability:{status,reason},items,total,next_cursor,invalid_entries:{items:[{source_index,reason}],total,truncated},context:{project_manifest}} |
| item | {id,kind,scope,task,format,body,metadata,use} |
| page | {ref,sha256,total_bytes,range:{start,end},text,next_cursor,eof} |

Task context.project_manifest is null. Project context is ArtifactItem or null, with agent-manifest kind, harness ID and independently canonical `.harness/harness.json` body. Definition items have agent-definition kind and canonical name ID. Task items use T as ID. Root-catalog envelope/cursor source.task is null, but each task body REF source_id is recomputed for its concrete T; task-null never authorizes a read. Catalog offsets are item indices independent of page size; context is never counted.

### Table S — trusted source binding

The external caller supplies its admitted ROOT/scope/task; the library validates equality and canonical eligibility, not caller authentication. Scope task with omitted task is an explicit root-catalog grant for lists only; emitted refs bind concrete T. Task reads require independently trusted exact T. Project requests forbid task and bind task null. Resolve ROOT with path.resolve at admission, removing only filesystem trailing separators and preserving Unicode spelling. Equivalent relative roots share identity. Reject symlink ancestors/final root and non-directory roots before scan; nonexistent/unreadable root is read_failed. Source id is SHA256 of canonical JSON `["artifact-source/v1",resolvedRoot,scope,taskOrNull]`. A REF cannot select or widen the grant.

### Table K — tokens and continuity

| Token | Exact keys |
|---|---|
| REF | v:1,source_id,scope,task,kind,id,sha256 |
| cursor | v:1,operation,source_id,fingerprint,offset |

Tokens are externally opaque noncredentials: unpadded base64url of strict UTF-8 compact JSON, recursively ASCII-sorted keys and safe integers. Exact parse/validate/reencode equality rejects duplicate/extra/reordered keys, whitespace, padding, noncanonical numbers/escaping, invalid UTF-8 and oversized tokens. Unsupported v rejects. Empty supplied cursor is invalid_cursor; omitted/null alone means absent.

Every SHA-valued decoded token member is a primitive JSON string matching lowercase `[0-9a-f]{64}`: REF.source_id, REF.sha256, cursor.source_id and cursor.fingerprint. Arrays, objects, numbers, booleans and null are malformed even when string coercion would match. Canonically encoded single-element arrays containing otherwise correct hashes therefore yield invalid_reference for REF members or invalid_cursor for cursor members, before artifact-byte consumption. The same cursor member grammar applies to list and read. Existing Table E precedence still applies when multiple faults coexist. These examples clarify FR-045/046/060 and AC-18/27.

Read fingerprint is SHA256 of canonical JSON `["artifact-read/v1",sourceID,scope,task,kind,id,bodySHA256,totalBytes,artifactResourceFingerprint]`. List fingerprint is SHA256 of canonical JSON `['artifact-list/v1',sourceID,scope,task,ordered tuples(scope,task,kind,id,presence,filetype),manifestSHA|null,invalid(source_index,reason),resourceFingerprint]`. Ordered tuples represent the ordered task/kind slots or safe project names and all eligible filename presence/file-type classes; invalid pairs preserve original indices/reasons. The manifest digest is raw bytes. Unrelated body digests do not enter it. Presence changes stale list cursors; unrelated content-only edits do not fabricate an atomic catalog revision. Equal-byte different artifacts and list/read cursors cannot interchange. Manifest byte edits stale project list cursors; unchanged eligible bodies retain REF continuity.

### Table P — exact UTF-8 byte pages

CLI numeric options use digits only, safe integers, leading zeros allowed; no sign, fraction or exponent. Catalog limit range is 1..100. CLI page size is an integer in bytes; module size is integer; range 4..131072. Let N be raw body bytes and O be offset. O is a safe integer in 0..N at a codepoint boundary. Negative, beyond-EOF and mid-codepoint offsets are invalid_cursor. At O<N choose the largest UTF-8 boundary E <= min(N,O+limit), E>O; return `[O,E)`. At O=N return empty `[N,N)`, eof true. Empty file is valid `[0,0)`. Changing page size and forged valid in-range cursors are allowed; neither establishes previous-byte possession. eof is true only at N and next_cursor is null there; earlier pages have continuation. Strict UTF-8 rejects overlong/surrogate/invalid-continuation encodings; valid BOM, CR/LF, NUL and noncharacters remain byte exact. No NFC, newline normalization, replacement decoding or binary fallback.

### Table G — detectable custody

Compare descriptor/path identity and available before/after size/mtime/ctime, selected content digest and current manifest eligibility. Detected replacement/mutation refuses stable refs/pages. A digest identifies consumed bytes; there is no guarantee against undetectable hostile concurrency, ancestor replacement races or cross-file atomicity. Unsafe/nonregular/symlink/hardlinked bodies never emit data.

### Table E — errors and precedence

Closed error `{schema_version:1,kind:"error",error:{code,message}}`, fixed bounded messages without raw paths, content or commands. Each fixed message is its code with underscores replaced by spaces. Codes: invalid_request, invalid_reference, invalid_cursor, stale_reference, stale_cursor, unsafe_source, oversized_source, invalid_utf8, runtime_resource, output_limit, read_failed.

Order: (1) validate option/token shapes; (2) compare independent scope/source/task/kind; (3) validate resources, root and canonical eligibility; (4) safely consume/check descriptor/source; (5) compare REF/current digest; (6) compare cursor fingerprint/range. Malformed tokens precede artifact opens; stale REF wins over a wrong cursor fingerprint; otherwise wrong fingerprint is stale_cursor. Unsafe data is never emitted. Unclassified low-level faults are fixed read_failed. Missing or changed current body is stale_reference. External executable/Node absence, old command absence and incompatible producer version are acquisition classifications; only the producer's defined errors are serialized by it.

### Table R — new offline resources

`schema/artifact-observation.schema.json`, `schema/artifact-coverage.json` and actual reader/metadata-parser companions declared by the validated plan/distribution manifest form the new closure. schema.digest is raw new observation schema SHA256; resourceFingerprint is SHA256 of canonical JSON of ASCII-relative-path-sorted `[relativepath,rawSHA256]` pairs for all declared new resources/companions. New resources are validated only for new operations, offline, using supported basic schema grammar plus explicit conditional/range validation. Source and installed relocated closure checks must freeze members and hashes before implementation acceptance. No schema validation establishes semantic truth.

### Table H — legacy compatibility

Existing list/show/capabilities preserve existing schema IDs, nine canonical brief families, legacy discovery, 2000-unit previews, 100-item summaries, nullability, terminal tokens and inert references. Compare defined semantic fields under frozen fixture time, while independently validating honest dynamic version/time/hash identity. New-only missing parser/schema/coverage companions cause runtime_resource on new operations while old complete resources still support old operations. This local full-content namespace intentionally diverges from summary prior art and MCP URI/multi-content/binary/list-pagination contracts; MCP 2026-07-28 and 2025-11-25 remain documentary references, not a lifecycle imported here.

### Table C — finite capability coverage

`coverage={coverage_version:1,entries:[{id,availability,source,authority,limitations}]}`. These entries describe data availability, never execution authority.

| Category | Availability |
|---|---|
| task-artifacts; project-agent-definitions; manifest-body; metadata | supported under the finite tables |
| roadmap-persisted-observations; legacy-phase-history | delegated, separately attributed |
| arbitrary-manifest-targets; historical-report-bodies; generated-project-inventory; global-project-inventory; live-execution; authenticated-session-joins | unsupported |

Unsupported categories differ from supported body absent/invalid and from missing external capability/runtime; no guessed path probe is needed to understand category support.


### Metadata extraction and accounting

JSON resources plan-data/review/qa-state/ledger require complete successful duplicate-free JSON parsing before structured metadata extraction. Invalid JSON leaves metadata invalid and safe raw UTF-8 body independently readable. Markdown resources use admitted first frontmatter plus explicit whole-line `**Status: VALUE**` declarations; no heading/title/verdict inference. Plain-text manifests and project manifest context have no task-report fields: metadata unknown and groups null. Agent definitions and admitted declarations use separate groups from Table M.

Reported extraction accepts exact keys task/task_id,status,round,cycle,date. Consistent task/task_id aliases populate reported.task; foreign values null it with task-mismatch; conflicting aliases or repeated differing explicit status declarations null the affected field with contradictory. Duplicate JSON/YAML keys invalidate structured metadata entirely, never partial key salvage. Missing fields are null; status/date are inert strings, round/cycle nonnegative safe integers; wrong types null with wrong-type. No chronology or verdict truth is inferred.

Structural root depth is 0; every value including scalar/container counts one node, each child descent adds one depth; bounds are inclusive. Capabilities limits has exactly source_bytes,response_bytes,page_bytes,catalog_items,scan_entries,catalog_bytes,ref_bytes,cursor_bytes,metadata. page_bytes and catalog_items have min/default/max. metadata has exactly frontmatter_bytes:65536,input_depth:32,input_nodes:100000,output_depth:8,output_nodes:1000,map_keys:64,array_items:100,string_units:2000,issue_items:100,agent_entries:10000. invalid_entries reasons are unsafe-name,missing-name,wrong-type,duplicate-name; one record per excluded original index.

Item format is markdown/json/text according to its canonical extension, descriptive only. Metadata availability is invalid when an applicable parse/field issue exists, valid for an applicable admitted observation without issues, unknown when metadata is not observed/applicable. Output clipping has explicit truncation and limit issues. Issue totals count observed pre-clipping issues; admission failure never claims exhaustive unseen issues.

List fingerprint tuple presence is boolean and filetype is missing/file/symlink/directory/other. Type describes observed filesystem kind, not safety; hardlinked regular files remain file-class but are rejected for body reading. Coverage source/authority/limitations are bounded inert strings from committed versioned coverage data, never authorization; supported/delegated/unsupported categories and meanings remain Table C.


## Acceptance Criteria

- **AC-1** [US-1 happy path; FR-009/053/054]: Given a spec longer than 2000 units and a distinct marker, when catalog/read run, then full canonical bytes reassemble exactly and spec/spec-result identities differ.
- **AC-2** [US-2 happy path; FR-024/025/034]: Given one project declaration and canonical full definition, when project inventory/read run, then attributed configuration/full body appear and use remains unknown/session null.
- **AC-3** [US-3 happy path; FR-041/052–055]: Given a multi-page multibyte body and independent exact binding, when continued with changed page sizes, then contiguous reassembly/digest match and complete bounded JSON pages retain source identity.
- **AC-4** [US-1/US-3; C-1; FR-002–004/021/022]: Given one discovered task and project names in reverse order, when catalog pagination runs, then task has 14 slots in fixed order, project names sort ASCII, identities are unique and context is excluded from totals.
- **AC-5** [US-1; C-2; FR-001/002/005]: Given separate fixtures containing only each finite canonical filename, when new discovery runs, then every T is discovered with 14 slots; nonexistent exact T is absent/total null; legacy discovery is preserved.
- **AC-6** [US-1/US-3; C-3; FR-006/007]: Given 6000 briefs entries plus 5000 specs entries and directory absence/unsafe variants, when task discovery runs, then combined budget refuses without partial catalog; one absent directory contributes empty; both absent mean absence; unsafe required directory fails.
- **AC-7** [US-2; C-4; FR-015/022/023]: Given absent, malformed duplicate-key/wrong-container and valid empty manifests, when project inventory runs, then absent/invalid totals are null; empty valid total is zero; safe invalid manifest remains readable in context without definition authority.
- **AC-8** [US-2; C-5; FR-017–020]: Given reviewer at original indices 0 and 2, implementer at 1 and one unsafe/scalar entry, when project inventory runs, then all duplicate occurrences and bad identities are excluded, original indices/exact excluded count survive, total is null, unique implementer survives.
- **AC-9** [US-2; C-6; FR-016/020/024]: Given unique safe declaration with invalid optional source/version or disabled runtime, when inventory/read run, then fixed canonical definition stays eligible and metadata cannot select another path.
- **AC-10** [US-2; C-7; FR-025–027]: Given manifest and definition versions differ and definition name mismatches canonical name, when metadata is read, then versions remain separately attributed; definition name is null/name-mismatch, safe body and canonical identity survive.
- **AC-11** [US-1/US-2; C-8; FR-011/025/028]: Given every whitelisted field plus missing required, absent optional, wrong-type and extension values, when metadata is projected, then only Table M groups/fields/types appear, required issues and optional nulls appear without defaults or truth inference. Regression fixtures include the valid and invalid SemVer examples in Table M; invalid version becomes null with wrong-type and metadata invalid while exact safe body bytes remain readable; absent optional version remains null without an issue.
- **AC-12** [US-2/US-3; C-9; FR-031/033]: Given metadata at and above every Table L input/output boundary, when inventory/read run, then bounded scalar-aligned summaries expose exact issue totals/truncation and safe body remains full.
- **AC-13** [US-2; C-10; FR-029/030]: Given BOM/LF/CRLF first block, later blocks and absent/unterminated/duplicate/alias/tag/wrong-root frontmatter variants, when metadata is extracted, then only first valid leading JSON-compatible object block is metadata; unsupported cases are invalid metadata with full safe body preserved.
- **AC-14** [US-1/US-2/US-3; C-11; FR-010/050]: Given empty, missing, unsafe, nonregular, symlinked, hardlinked, oversized and invalid-UTF8 bodies, when catalog and direct read run, then catalog isolates body failures with null digest/size/ref; empty body is valid; direct missing eligible body is stale_reference; required-source failures abort.
- **AC-15** [US-3; C-12; FR-040/041]: Given trusted task T and malicious project/other-task REF with recomputed hash, when read runs, then binding mismatch refuses before artifact-byte consumption; task-null catalog grant cannot authorize a read.
- **AC-16** [US-3; C-13; FR-042/043]: Given equivalent relative/trailing-separator roots, Unicode spellings and symlink/non-directory/missing roots, when source admission runs, then equivalent roots share identity, spelling is not normalized, unsafe roots refuse before scan and missing/unreadable is read_failed.
- **AC-17** [US-1/US-3; C-14; FR-044/059]: Given current same-scope eligible REF constructed with exact current digest but never listed, when read runs, then body is readable without issuance/custody/authorization claims; unsafe or foreign targets still refuse.
- **AC-18** [US-3; C-15; FR-045/046]: Given canonical tokens and duplicate/reordered/extra-key, whitespace, padded, noncanonical-number/escape, wrong-version, bad-UTF8 and oversize tokens, when public calls run, then canonical tokens admit and malformed ref/cursor yield corresponding invalid code; empty cursor is invalid, null/omitted absent. Regression fixtures replace each SHA-valued REF/cursor member with a single-element hash array, and include other non-string JSON types, through canonical token encoding; malformed members yield their corresponding invalid code and consume zero artifact bytes; valid primitive-string controls still admit.
- **AC-19** [US-3; C-16; FR-047]: Given two artifacts have identical bytes and read/list cursors from other identities, when cursor replay runs, then different artifact/operation/source fingerprint refuses stale_cursor rather than mixing identities.
- **AC-20** [US-1/US-2/US-3; C-17; FR-048]: Given catalog cursor followed by canonical presence/type change, invalid-index change or unrelated content-only edit, when list continues, then membership/resource changes stale cursor; unrelated body content alone does not pretend to be whole-catalog atomic change.
- **AC-21** [US-2/US-3; C-18; FR-049–051]: Given unchanged definition body with edited manifest role, then removed eligible name, when old list/body references are used, then manifest edit stales list cursor but unchanged eligible body reads; loss of eligibility yields stale_reference.
- **AC-22** [US-3; C-19; FR-052/054/055]: Given offsets zero, N, negative, beyond N, mid-codepoint and forged valid in-range offsets, when read runs, then valid ranges return exact requested suffix/EOF including empty N..N; invalid offsets refuse; EOF does not assert earlier possession.
- **AC-23** [US-3; C-20; FR-052]: Given four-byte scalars at boundaries and decimal page limits 4,65536,131072 plus invalid values, when read runs, then largest fitting scalar boundary advances without split/skip; numeric bounds/default are enforced.
- **AC-24** [US-2/US-3; C-21; FR-032/033/053]: Given BOM/CRLF/NUL/noncharacters, invalid UTF8 and ASCII JSON containing decoded unpaired-surrogate escapes, when bodies/metadata are read, then valid body bytes preserve exact digest, bad UTF8 refuses, malformed metadata strings null with issue without splitting pairs or altering raw body.
- **AC-25** [US-3; C-22; FR-056/057/068]: Given 16MiB admissible manifest plus 16MiB body and overbudget physical-consumption variant, when read/catalog run, then maximum pair fits when admitted bytes are reused; extra consumption exceeding budget gives closed output_limit; smaller pages cannot cure whole-source faults.
- **AC-26** [US-1/US-3; C-23; FR-058/059]: Given controlled same-size mutation/replacement and manifest-membership change during consumption, when operation observes changed descriptor/path/stat/digest/eligibility, then detected change refuses stable result while no undetectable-race or atomicity guarantee is claimed.
- **AC-27** [US-3; C-24; FR-041/060]: Given malformed token plus foreign binding/unsafe source, or stale REF plus wrong cursor, when operation runs, then Table E precedence applies before opens and stale_reference precedes stale_cursor; no raw diagnostics leak. Regression fixtures combine malformed hash-member arrays with otherwise valid source/ref/cursor inputs and with foreign-binding/unsafe-source variants; malformed tokens win in the existing Table E order with zero artifact-byte consumption, while well-typed changed hashes retain stale/binding behavior.
- **AC-28** [US-3; C-25; FR-036–038/060/068]: Given public module/CLI valid and extra-option cases plus oversized serialized output, when operations run, then signatures/defaults/envelopes match, module synchronously throws exported ObservationError, CLI stdout/stderr/exit2 and closed 2MiB bound hold.
- **AC-29** [US-3; C-26; FR-039/061]: Given complete source and relocated installed new closure, then each required new resource missing/incompatible, when new operations run offline, then capability shape/limits/coverage, raw schema digest and complete resource fingerprint validate; missing closure refuses without schema-truth claims.
- **AC-30** [US-3; C-27; FR-064/065]: Given missing executable/Node, old producer absent command, incompatible producer and incompatible new resource fixtures, when acquirer/new producer runs, then external failures remain acquisition classifications while new resource fault is runtime_resource and token-version mismatch rejects.
- **AC-31** [US-1/US-3; C-28; FR-062/063]: Given frozen legacy fixtures with all old resources plus individually missing new-only resources, when old/new operations run, then legacy schemas/discovery/preview/nullability/inert fields remain; dynamic identities validate honestly; only new operations fail runtime_resource.
- **AC-32** [US-1/US-3; C-29; FR-010/053/066]: Given empty text, missing body and binary/invalid UTF8 fixtures, when public reads run, then one finite UTF8 body is returned or typed failure; empty is valid and missing differs; no binary decoding or MCP multi-content behavior is imported.
- **AC-33** [US-3; C-30; FR-045/052/055/066]: Given empty versus omitted cursors, requested byte sizes and terminal pages, when local pagination runs, then empty cursor refuses, caller byte bounds apply, opaque tokens remain noncredentials and list EOF is not document completeness.
- **AC-34** [US-1/US-2; C-31; FR-008/023/044/066]: Given eligible target absent from current partial page and arbitrary manifest target declaration, when direct exact bound reads run, then canonical eligibility decides without list receipt; declarations do not widen whitelist; missing canonical body still stales.
- **AC-35** [US-3; C-32; FR-059/064/066]: Given local v1 capability and incompatible versions with dated MCP documentation, when public contract/version checks run, then local namespace refuses incompatibility without MCP handshake or authentication/semantic-truth inference.
- **AC-36** [US-2/US-3; C-33; FR-034/035]: Given matching session/model/runtime labels, generated extra and adjacent persisted assignments, when project inventory/read run, then all use values stay unknown/not-observed/session null and no inferred live joins or execution occur.
- **AC-37** [US-1/US-2/US-3; C-34; FR-039/067]: Given coverage catalog plus absent/invalid supported body and missing external producer, when capability/acquisition observations are compared, then supported/delegated/unsupported Table C categories remain distinguishable from absent/invalid body and missing capability.
- **AC-38** [US-1/US-3; C-35; FR-011–014/059]: Given foreign task, contradictory statuses, invalid round/cycle and plausible false well-typed claims, when metadata/full body are read, then affected fields null with issue, valid claims remain only reported, counts/acceptance/commands are not synthesized and raw text stays inert.

## Edge Cases

- EC-1 [US-1]: Only briefs/T-review.json exists.  Outcome follows the corresponding challenge and AC in Traceability.
- EC-2 [US-1, US-3]: briefs has 6,000 entries and specs has 5,000, with one eligible task in each.  Outcome follows the corresponding challenge and AC in Traceability.
- EC-3 [US-2]: Valid manifest contains duplicate reviewer entries at indices 0/2 and one valid implementer at 1.  Outcome follows the corresponding challenge and AC in Traceability.
- EC-4 [US-2]: Canonical reviewer frontmatter declares a different version and name than its manifest; body is valid UTF-8.  Outcome follows the corresponding challenge and AC in Traceability.
- EC-5 [US-2]: Project manifest is malformed JSON but safe UTF-8.  Outcome follows the corresponding challenge and AC in Traceability.
- EC-6 [US-3]: Same-scope forged REF uses the actual digest of a current eligible artifact never listed to that caller.  Outcome follows the corresponding challenge and AC in Traceability.
- EC-7 [US-3]: Two artifacts have identical bytes; a cursor from one is paired with the other REF.  Outcome follows the corresponding challenge and AC in Traceability.
- EC-8 [US-2, US-3]: Agent body unchanged, manifest role changes, same canonical safe name remains.  Outcome follows the corresponding challenge and AC in Traceability.
- EC-9 [US-3]: Empty file versus missing file versus removal after a valid REF.  Outcome follows the corresponding challenge and AC in Traceability.
- EC-10 [US-3]: Four-byte codepoint at the configured page boundary, then BOM/CRLF/NUL later in the document.  Outcome follows the corresponding challenge and AC in Traceability.
- EC-11 [US-2, US-3]: 16MiB manifest and 16MiB agent body, plus one required eligibility reread.  Outcome follows the corresponding challenge and AC in Traceability.
- EC-12 [US-1, US-3]: Same-size body mutates during its full digest read; manifest membership changes before definition open.  Outcome follows the corresponding challenge and AC in Traceability.
- EC-13 [US-3]: Old list runs with all old resources present but a new artifact-only schema missing.  Outcome follows the corresponding challenge and AC in Traceability.
- EC-14 [US-2]: Runtime disabled in otherwise valid manifest; canonical configured definition exists; generated runtime file and matching session label also exist.  Outcome follows the corresponding challenge and AC in Traceability.
- EC-15 [US-1, US-3]: Exact task read targets eligible canonical spec absent from the current catalog because no discoverable filename remains.  Outcome follows the corresponding challenge and AC in Traceability.
- EC-16 [US-3]: Cursor is empty string, noncanonical padded base64url, duplicate-key JSON, negative offset or beyond-EOF offset.  Outcome follows the corresponding challenge and AC in Traceability.

## Runnable Checks

These intended task-specific commands are not execution evidence. The verifier reuses the repository's standalone acceptance-runner pattern and exercises actual public interfaces in isolated fixtures. It must exist and distinguish setup from assertions before qualification. No check was executed or passed during specification. Required complete local gates are build:ts, test:pipeline, claims:check and npm test.

- **CHECK-1** [AC-1]: `rtk proxy node scripts/artifact-observation-check.cjs --case AC-1` → 0 passes; 1 assertion failure; >=2 setup/runtime/resource error. (authentic-success-path)
- **CHECK-2** [AC-2]: `rtk proxy node scripts/artifact-observation-check.cjs --case AC-2` → 0 passes; 1 assertion failure; >=2 setup/runtime/resource error. (authentic-success-path)
- **CHECK-3** [AC-3]: `rtk proxy node scripts/artifact-observation-check.cjs --case AC-3` → 0 passes; 1 assertion failure; >=2 setup/runtime/resource error. (authentic-success-path)
- **CHECK-4** [AC-4]: `rtk proxy node scripts/artifact-observation-check.cjs --case AC-4` → 0 passes; 1 assertion failure; >=2 setup/runtime/resource error.
- **CHECK-5** [AC-5]: `rtk proxy node scripts/artifact-observation-check.cjs --case AC-5` → 0 passes; 1 assertion failure; >=2 setup/runtime/resource error.
- **CHECK-6** [AC-6]: `rtk proxy node scripts/artifact-observation-check.cjs --case AC-6` → 0 passes; 1 assertion failure; >=2 setup/runtime/resource error.
- **CHECK-7** [AC-7]: `rtk proxy node scripts/artifact-observation-check.cjs --case AC-7` → 0 passes; 1 assertion failure; >=2 setup/runtime/resource error.
- **CHECK-8** [AC-8]: `rtk proxy node scripts/artifact-observation-check.cjs --case AC-8` → 0 passes; 1 assertion failure; >=2 setup/runtime/resource error.
- **CHECK-9** [AC-9]: `rtk proxy node scripts/artifact-observation-check.cjs --case AC-9` → 0 passes; 1 assertion failure; >=2 setup/runtime/resource error.
- **CHECK-10** [AC-10]: `rtk proxy node scripts/artifact-observation-check.cjs --case AC-10` → 0 passes; 1 assertion failure; >=2 setup/runtime/resource error.
- **CHECK-11** [AC-11]: `rtk proxy node scripts/artifact-observation-check.cjs --case AC-11` → 0 passes; 1 assertion failure; >=2 setup/runtime/resource error.
- **CHECK-12** [AC-12]: `rtk proxy node scripts/artifact-observation-check.cjs --case AC-12` → 0 passes; 1 assertion failure; >=2 setup/runtime/resource error.
- **CHECK-13** [AC-13]: `rtk proxy node scripts/artifact-observation-check.cjs --case AC-13` → 0 passes; 1 assertion failure; >=2 setup/runtime/resource error.
- **CHECK-14** [AC-14]: `rtk proxy node scripts/artifact-observation-check.cjs --case AC-14` → 0 passes; 1 assertion failure; >=2 setup/runtime/resource error. (fail-closed-path)
- **CHECK-15** [AC-15]: `rtk proxy node scripts/artifact-observation-check.cjs --case AC-15` → 0 passes; 1 assertion failure; >=2 setup/runtime/resource error. (fail-closed-path)
- **CHECK-16** [AC-16]: `rtk proxy node scripts/artifact-observation-check.cjs --case AC-16` → 0 passes; 1 assertion failure; >=2 setup/runtime/resource error.
- **CHECK-17** [AC-17]: `rtk proxy node scripts/artifact-observation-check.cjs --case AC-17` → 0 passes; 1 assertion failure; >=2 setup/runtime/resource error.
- **CHECK-18** [AC-18]: `rtk proxy node scripts/artifact-observation-check.cjs --case AC-18` → 0 passes; 1 assertion failure; >=2 setup/runtime/resource error. (fail-closed-path)
- **CHECK-19** [AC-19]: `rtk proxy node scripts/artifact-observation-check.cjs --case AC-19` → 0 passes; 1 assertion failure; >=2 setup/runtime/resource error.
- **CHECK-20** [AC-20]: `rtk proxy node scripts/artifact-observation-check.cjs --case AC-20` → 0 passes; 1 assertion failure; >=2 setup/runtime/resource error.
- **CHECK-21** [AC-21]: `rtk proxy node scripts/artifact-observation-check.cjs --case AC-21` → 0 passes; 1 assertion failure; >=2 setup/runtime/resource error.
- **CHECK-22** [AC-22]: `rtk proxy node scripts/artifact-observation-check.cjs --case AC-22` → 0 passes; 1 assertion failure; >=2 setup/runtime/resource error.
- **CHECK-23** [AC-23]: `rtk proxy node scripts/artifact-observation-check.cjs --case AC-23` → 0 passes; 1 assertion failure; >=2 setup/runtime/resource error.
- **CHECK-24** [AC-24]: `rtk proxy node scripts/artifact-observation-check.cjs --case AC-24` → 0 passes; 1 assertion failure; >=2 setup/runtime/resource error.
- **CHECK-25** [AC-25]: `rtk proxy node scripts/artifact-observation-check.cjs --case AC-25` → 0 passes; 1 assertion failure; >=2 setup/runtime/resource error.
- **CHECK-26** [AC-26]: `rtk proxy node scripts/artifact-observation-check.cjs --case AC-26` → 0 passes; 1 assertion failure; >=2 setup/runtime/resource error.
- **CHECK-27** [AC-27]: `rtk proxy node scripts/artifact-observation-check.cjs --case AC-27` → 0 passes; 1 assertion failure; >=2 setup/runtime/resource error. (fail-closed-path)
- **CHECK-28** [AC-28]: `rtk proxy node scripts/artifact-observation-check.cjs --case AC-28` → 0 passes; 1 assertion failure; >=2 setup/runtime/resource error.
- **CHECK-29** [AC-29]: `rtk proxy node scripts/artifact-observation-check.cjs --case AC-29` → 0 passes; 1 assertion failure; >=2 setup/runtime/resource error.
- **CHECK-30** [AC-30]: `rtk proxy node scripts/artifact-observation-check.cjs --case AC-30` → 0 passes; 1 assertion failure; >=2 setup/runtime/resource error.
- **CHECK-31** [AC-31]: `rtk proxy node scripts/artifact-observation-check.cjs --case AC-31` → 0 passes; 1 assertion failure; >=2 setup/runtime/resource error. (fail-closed-path)
- **CHECK-32** [AC-32]: `rtk proxy node scripts/artifact-observation-check.cjs --case AC-32` → 0 passes; 1 assertion failure; >=2 setup/runtime/resource error.
- **CHECK-33** [AC-33]: `rtk proxy node scripts/artifact-observation-check.cjs --case AC-33` → 0 passes; 1 assertion failure; >=2 setup/runtime/resource error.
- **CHECK-34** [AC-34]: `rtk proxy node scripts/artifact-observation-check.cjs --case AC-34` → 0 passes; 1 assertion failure; >=2 setup/runtime/resource error.
- **CHECK-35** [AC-35]: `rtk proxy node scripts/artifact-observation-check.cjs --case AC-35` → 0 passes; 1 assertion failure; >=2 setup/runtime/resource error.
- **CHECK-36** [AC-36]: `rtk proxy node scripts/artifact-observation-check.cjs --case AC-36` → 0 passes; 1 assertion failure; >=2 setup/runtime/resource error.
- **CHECK-37** [AC-37]: `rtk proxy node scripts/artifact-observation-check.cjs --case AC-37` → 0 passes; 1 assertion failure; >=2 setup/runtime/resource error.
- **CHECK-38** [AC-38]: `rtk proxy node scripts/artifact-observation-check.cjs --case AC-38` → 0 passes; 1 assertion failure; >=2 setup/runtime/resource error.

- **CHECK-39** [AC-11]: `rtk proxy node scripts/check-artifact-semver-regression.cjs` → 0 passes; 1 assertion failure; >=2 setup/runtime/resource error. New self-contained permanent SemVer ratchet; no arguments required.
- **CHECK-40** [AC-18/AC-27]: `rtk proxy node scripts/check-artifact-token-types-regression.cjs` → 0 passes; 1 assertion failure; >=2 setup/runtime/resource error. New self-contained permanent token-type/zero-read ratchet; no arguments required.

## Traceability

| Challenge | FR coverage | AC / exact check |
| C-1 | FR-002–004/021/022 | AC-4 / CHECK-4 |
| C-2 | FR-001/002/005 | AC-5 / CHECK-5 |
| C-3 | FR-006/007 | AC-6 / CHECK-6 |
| C-4 | FR-015/022/023 | AC-7 / CHECK-7 |
| C-5 | FR-017–020 | AC-8 / CHECK-8 |
| C-6 | FR-016/020/024 | AC-9 / CHECK-9 |
| C-7 | FR-025–027 | AC-10 / CHECK-10 |
| C-8 | FR-011/025/028 | AC-11 / CHECK-11 |
| C-9 | FR-031/033 | AC-12 / CHECK-12 |
| C-10 | FR-029/030 | AC-13 / CHECK-13 |
| C-11 | FR-010/050 | AC-14 / CHECK-14 |
| C-12 | FR-040/041 | AC-15 / CHECK-15 |
| C-13 | FR-042/043 | AC-16 / CHECK-16 |
| C-14 | FR-044/059 | AC-17 / CHECK-17 |
| C-15 | FR-045/046 | AC-18 / CHECK-18 |
| C-16 | FR-047 | AC-19 / CHECK-19 |
| C-17 | FR-048 | AC-20 / CHECK-20 |
| C-18 | FR-049–051 | AC-21 / CHECK-21 |
| C-19 | FR-052/054/055 | AC-22 / CHECK-22 |
| C-20 | FR-052 | AC-23 / CHECK-23 |
| C-21 | FR-032/033/053 | AC-24 / CHECK-24 |
| C-22 | FR-056/057/068 | AC-25 / CHECK-25 |
| C-23 | FR-058/059 | AC-26 / CHECK-26 |
| C-24 | FR-041/060 | AC-27 / CHECK-27 |
| C-25 | FR-036–038/060/068 | AC-28 / CHECK-28 |
| C-26 | FR-039/061 | AC-29 / CHECK-29 |
| C-27 | FR-064/065 | AC-30 / CHECK-30 |
| C-28 | FR-062/063 | AC-31 / CHECK-31 |
| C-29 | FR-010/053/066 | AC-32 / CHECK-32 |
| C-30 | FR-045/052/055/066 | AC-33 / CHECK-33 |
| C-31 | FR-008/023/044/066 | AC-34 / CHECK-34 |
| C-32 | FR-059/064/066 | AC-35 / CHECK-35 |
| C-33 | FR-034/035 | AC-36 / CHECK-36 |
| C-34 | FR-039/067 | AC-37 / CHECK-37 |
| C-35 | FR-011–014/059 | AC-38 / CHECK-38 |

| Edge | FR coverage | AC / check |
|---|---|---|
| EC-1 | FR-001–005 | AC-4/5; CHECK-4/5 |
| EC-2 | FR-006/007 | AC-6; CHECK-6 |
| EC-3 | FR-017–021 | AC-8; CHECK-8 |
| EC-4 | FR-025–028 | AC-10/11; CHECK-10/11 |
| EC-5 | FR-015/022/023 | AC-7/14; CHECK-7/14 |
| EC-6 | FR-044/059 | AC-17; CHECK-17 |
| EC-7 | FR-047 | AC-19; CHECK-19 |
| EC-8 | FR-049–051 | AC-21; CHECK-21 |
| EC-9 | FR-010/050/052 | AC-14/22; CHECK-14/22 |
| EC-10 | FR-032/033/052/053 | AC-23/24; CHECK-23/24 |
| EC-11 | FR-056/057 | AC-25; CHECK-25 |
| EC-12 | FR-058/059 | AC-26; CHECK-26 |
| EC-13 | FR-061–063 | AC-29/31; CHECK-29/31 |
| EC-14 | FR-016/034/035 | AC-9/36; CHECK-9/36 |
| EC-15 | FR-001/008/044/050 | AC-5/32/34; CHECK-5/32/34 |
| EC-16 | FR-045/046/052 | AC-18/22/33; CHECK-18/22/33 |

EC-15 does not require a discoverable filename to have existed previously. All present canonical filenames are discoverable under the approved repair; if none remains, direct eligible-path read is stale_reference. Absence from a partial list alone never proves ineligibility.



## Claims Metadata

```claims
{"record":"claims-header","schema_version":1,"namespace":"public-artifact-reading","spec_lifecycle":"draft"}
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
{"record":"requirement","id":"FR-016","lifecycle":"draft","external_sources":[],"depends_on":[]}
{"record":"requirement","id":"FR-017","lifecycle":"draft","external_sources":[],"depends_on":[]}
{"record":"requirement","id":"FR-018","lifecycle":"draft","external_sources":[],"depends_on":[]}
{"record":"requirement","id":"FR-019","lifecycle":"draft","external_sources":[],"depends_on":[]}
{"record":"requirement","id":"FR-020","lifecycle":"draft","external_sources":[],"depends_on":[]}
{"record":"requirement","id":"FR-021","lifecycle":"draft","external_sources":[],"depends_on":[]}
{"record":"requirement","id":"FR-022","lifecycle":"draft","external_sources":[],"depends_on":[]}
{"record":"requirement","id":"FR-023","lifecycle":"draft","external_sources":[],"depends_on":[]}
{"record":"requirement","id":"FR-024","lifecycle":"draft","external_sources":[],"depends_on":[]}
{"record":"requirement","id":"FR-025","lifecycle":"draft","external_sources":[],"depends_on":[]}
{"record":"requirement","id":"FR-026","lifecycle":"draft","external_sources":[],"depends_on":[]}
{"record":"requirement","id":"FR-027","lifecycle":"draft","external_sources":[],"depends_on":[]}
{"record":"requirement","id":"FR-028","lifecycle":"draft","external_sources":[],"depends_on":[]}
{"record":"requirement","id":"FR-029","lifecycle":"draft","external_sources":[],"depends_on":[]}
{"record":"requirement","id":"FR-030","lifecycle":"draft","external_sources":[],"depends_on":[]}
{"record":"requirement","id":"FR-031","lifecycle":"draft","external_sources":[],"depends_on":[]}
{"record":"requirement","id":"FR-032","lifecycle":"draft","external_sources":[],"depends_on":[]}
{"record":"requirement","id":"FR-033","lifecycle":"draft","external_sources":[],"depends_on":[]}
{"record":"requirement","id":"FR-034","lifecycle":"draft","external_sources":[],"depends_on":[]}
{"record":"requirement","id":"FR-035","lifecycle":"draft","external_sources":[],"depends_on":[]}
{"record":"requirement","id":"FR-036","lifecycle":"draft","external_sources":[],"depends_on":[]}
{"record":"requirement","id":"FR-037","lifecycle":"draft","external_sources":[],"depends_on":[]}
{"record":"requirement","id":"FR-038","lifecycle":"draft","external_sources":[],"depends_on":[]}
{"record":"requirement","id":"FR-039","lifecycle":"draft","external_sources":[],"depends_on":[]}
{"record":"requirement","id":"FR-040","lifecycle":"draft","external_sources":[],"depends_on":[]}
{"record":"requirement","id":"FR-041","lifecycle":"draft","external_sources":[],"depends_on":[]}
{"record":"requirement","id":"FR-042","lifecycle":"draft","external_sources":[],"depends_on":[]}
{"record":"requirement","id":"FR-043","lifecycle":"draft","external_sources":[],"depends_on":[]}
{"record":"requirement","id":"FR-044","lifecycle":"draft","external_sources":[],"depends_on":[]}
{"record":"requirement","id":"FR-045","lifecycle":"draft","external_sources":[],"depends_on":[]}
{"record":"requirement","id":"FR-046","lifecycle":"draft","external_sources":[],"depends_on":[]}
{"record":"requirement","id":"FR-047","lifecycle":"draft","external_sources":[],"depends_on":[]}
{"record":"requirement","id":"FR-048","lifecycle":"draft","external_sources":[],"depends_on":[]}
{"record":"requirement","id":"FR-049","lifecycle":"draft","external_sources":[],"depends_on":[]}
{"record":"requirement","id":"FR-050","lifecycle":"draft","external_sources":[],"depends_on":[]}
{"record":"requirement","id":"FR-051","lifecycle":"draft","external_sources":[],"depends_on":[]}
{"record":"requirement","id":"FR-052","lifecycle":"draft","external_sources":[],"depends_on":[]}
{"record":"requirement","id":"FR-053","lifecycle":"draft","external_sources":[],"depends_on":[]}
{"record":"requirement","id":"FR-054","lifecycle":"draft","external_sources":[],"depends_on":[]}
{"record":"requirement","id":"FR-055","lifecycle":"draft","external_sources":[],"depends_on":[]}
{"record":"requirement","id":"FR-056","lifecycle":"draft","external_sources":[],"depends_on":[]}
{"record":"requirement","id":"FR-057","lifecycle":"draft","external_sources":[],"depends_on":[]}
{"record":"requirement","id":"FR-058","lifecycle":"draft","external_sources":[],"depends_on":[]}
{"record":"requirement","id":"FR-059","lifecycle":"draft","external_sources":[],"depends_on":[]}
{"record":"requirement","id":"FR-060","lifecycle":"draft","external_sources":[],"depends_on":[]}
{"record":"requirement","id":"FR-061","lifecycle":"draft","external_sources":[],"depends_on":[]}
{"record":"requirement","id":"FR-062","lifecycle":"draft","external_sources":[],"depends_on":[]}
{"record":"requirement","id":"FR-063","lifecycle":"draft","external_sources":[],"depends_on":[]}
{"record":"requirement","id":"FR-064","lifecycle":"draft","external_sources":[],"depends_on":[]}
{"record":"requirement","id":"FR-065","lifecycle":"draft","external_sources":[],"depends_on":[]}
{"record":"requirement","id":"FR-066","lifecycle":"draft","external_sources":[],"depends_on":[]}
{"record":"requirement","id":"FR-067","lifecycle":"draft","external_sources":[],"depends_on":[]}
{"record":"requirement","id":"FR-068","lifecycle":"draft","external_sources":[],"depends_on":[]}
{"record":"acceptance-criterion","id":"AC-1","for":["FR-009","FR-053","FR-054"]}
{"record":"acceptance-criterion","id":"AC-2","for":["FR-024","FR-025","FR-034"]}
{"record":"acceptance-criterion","id":"AC-3","for":["FR-041","FR-052","FR-053","FR-054","FR-055"]}
{"record":"acceptance-criterion","id":"AC-4","for":["FR-002","FR-003","FR-004","FR-021","FR-022"]}
{"record":"acceptance-criterion","id":"AC-5","for":["FR-001","FR-002","FR-005"]}
{"record":"acceptance-criterion","id":"AC-6","for":["FR-006","FR-007"]}
{"record":"acceptance-criterion","id":"AC-7","for":["FR-015","FR-022","FR-023"]}
{"record":"acceptance-criterion","id":"AC-8","for":["FR-017","FR-018","FR-019","FR-020"]}
{"record":"acceptance-criterion","id":"AC-9","for":["FR-016","FR-020","FR-024"]}
{"record":"acceptance-criterion","id":"AC-10","for":["FR-025","FR-026","FR-027"]}
{"record":"acceptance-criterion","id":"AC-11","for":["FR-011","FR-025","FR-028"]}
{"record":"acceptance-criterion","id":"AC-12","for":["FR-031","FR-033"]}
{"record":"acceptance-criterion","id":"AC-13","for":["FR-029","FR-030"]}
{"record":"acceptance-criterion","id":"AC-14","for":["FR-010","FR-050"]}
{"record":"acceptance-criterion","id":"AC-15","for":["FR-040","FR-041"]}
{"record":"acceptance-criterion","id":"AC-16","for":["FR-042","FR-043"]}
{"record":"acceptance-criterion","id":"AC-17","for":["FR-044","FR-059"]}
{"record":"acceptance-criterion","id":"AC-18","for":["FR-045","FR-046"]}
{"record":"acceptance-criterion","id":"AC-19","for":["FR-047"]}
{"record":"acceptance-criterion","id":"AC-20","for":["FR-048"]}
{"record":"acceptance-criterion","id":"AC-21","for":["FR-049","FR-050","FR-051"]}
{"record":"acceptance-criterion","id":"AC-22","for":["FR-052","FR-054","FR-055"]}
{"record":"acceptance-criterion","id":"AC-23","for":["FR-052"]}
{"record":"acceptance-criterion","id":"AC-24","for":["FR-032","FR-033","FR-053"]}
{"record":"acceptance-criterion","id":"AC-25","for":["FR-056","FR-057","FR-068"]}
{"record":"acceptance-criterion","id":"AC-26","for":["FR-058","FR-059"]}
{"record":"acceptance-criterion","id":"AC-27","for":["FR-041","FR-060"]}
{"record":"acceptance-criterion","id":"AC-28","for":["FR-036","FR-037","FR-038","FR-060","FR-068"]}
{"record":"acceptance-criterion","id":"AC-29","for":["FR-039","FR-061"]}
{"record":"acceptance-criterion","id":"AC-30","for":["FR-064","FR-065"]}
{"record":"acceptance-criterion","id":"AC-31","for":["FR-062","FR-063"]}
{"record":"acceptance-criterion","id":"AC-32","for":["FR-010","FR-053","FR-066"]}
{"record":"acceptance-criterion","id":"AC-33","for":["FR-045","FR-052","FR-055","FR-066"]}
{"record":"acceptance-criterion","id":"AC-34","for":["FR-008","FR-023","FR-044","FR-066"]}
{"record":"acceptance-criterion","id":"AC-35","for":["FR-059","FR-064","FR-066"]}
{"record":"acceptance-criterion","id":"AC-36","for":["FR-034","FR-035"]}
{"record":"acceptance-criterion","id":"AC-37","for":["FR-039","FR-067"]}
{"record":"acceptance-criterion","id":"AC-38","for":["FR-011","FR-012","FR-013","FR-014","FR-059"]}
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
{"record":"check","id":"CHECK-13","for":["AC-13"]}
{"record":"check","id":"CHECK-14","for":["AC-14"]}
{"record":"check","id":"CHECK-15","for":["AC-15"]}
{"record":"check","id":"CHECK-16","for":["AC-16"]}
{"record":"check","id":"CHECK-17","for":["AC-17"]}
{"record":"check","id":"CHECK-18","for":["AC-18"]}
{"record":"check","id":"CHECK-19","for":["AC-19"]}
{"record":"check","id":"CHECK-20","for":["AC-20"]}
{"record":"check","id":"CHECK-21","for":["AC-21"]}
{"record":"check","id":"CHECK-22","for":["AC-22"]}
{"record":"check","id":"CHECK-23","for":["AC-23"]}
{"record":"check","id":"CHECK-24","for":["AC-24"]}
{"record":"check","id":"CHECK-25","for":["AC-25"]}
{"record":"check","id":"CHECK-26","for":["AC-26"]}
{"record":"check","id":"CHECK-27","for":["AC-27"]}
{"record":"check","id":"CHECK-28","for":["AC-28"]}
{"record":"check","id":"CHECK-29","for":["AC-29"]}
{"record":"check","id":"CHECK-30","for":["AC-30"]}
{"record":"check","id":"CHECK-31","for":["AC-31"]}
{"record":"check","id":"CHECK-32","for":["AC-32"]}
{"record":"check","id":"CHECK-33","for":["AC-33"]}
{"record":"check","id":"CHECK-34","for":["AC-34"]}
{"record":"check","id":"CHECK-35","for":["AC-35"]}
{"record":"check","id":"CHECK-36","for":["AC-36"]}
{"record":"check","id":"CHECK-37","for":["AC-37"]}
{"record":"check","id":"CHECK-38","for":["AC-38"]}
{"record":"check","id":"CHECK-39","for":["AC-11"]}
{"record":"check","id":"CHECK-40","for":["AC-18","AC-27"]}
```

## Entities

- `ArtifactObservation`: Additive versioned read-only envelope for finite canonical artifact availability/content.
- `ArtifactReference`: Pathless digest-bound identity for one currently eligible artifact, never a credential or issuance proof.
- `ArtifactCursor`: Canonical operation/source/artifact fingerprint and offset for bounded continuation, never authority.
- `ArtifactInventory`: Ordered finite artifact slots or configured project definitions with separate manifest context and explicit uncertainty.
- `ProjectAgentDefinition`: Canonical project-configured instructions and attributed metadata independent from mobilization or session identity.

Existing PipelineObservation and CoverageManifest definitions/interfaces remain unchanged.
