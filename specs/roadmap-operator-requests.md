---
name: roster-spec
type: spec
status: live
feature: Roadmap operator requests annex
brief: briefs/roadmap-operator-requests-intake.md
date: 2026-11-13
version: 1.0.0
---

# Spec — Roadmap operator requests annex

A roadmap board says, in structured data, what the coordinator is waiting for from the
human operator. The data lives in an advisory annex `requests.json`, written only by
dedicated `roster-roadmap.cjs` commands and exposed in `view`, `status --format text`
and `prompt`.

## Owner decisions (binding, Mathias, 2026-11-13)

- **D1** Board annex `requests.json`, written by dedicated commands on the `estimates.json`
  model (same board lock, the annex's own revision, atomic replace); visible in `view`,
  `status --format text` and `prompt`. `roadmap.json` and `state.json` do not change.
- **D2** An open request bound to a mission is a signal (due now, later, unscheduled),
  never a refusal of `claim`.
- **D3** The coordinator relays answers. No operator command or page, no authentication.
- **D4** An answered request is never erased. It stays visible, marked answered with the
  answer and its date, and leaves the current view only once the mission it was bound to
  is done. An unbound request stays visible. Status `withdrawn` exists.
- **D5** An answer never contains a secret: it confirms, or says where to find the thing.

## Clarifications

| Q | A |
|---|---|
| Which flag names the writer? | `--coordinator ID`, the same flag the execution mutations use. On an accepted board it must equal `state.coordinator`; on a draft board any safe identifier. |
| Are requests allowed on draft boards? | Yes, read with draft tolerance. `task_id` must name a task in the current `roadmap.json` at open time. |
| What if a bound task disappears from a draft contract? | The request stays valid; the view reports `task_state: "unknown"` and computes due-ness as if unbound. |
| Is there a history, as in `estimates.json`? | Yes: an append-only `history` of operations; `revision` must equal `history.length`. Records themselves are never deleted. |
| Does default `status` JSON or `next` change? | No. Only `view`, `status --format text` and `prompt` (D1). |
| Does `--task` filter `operator_requests` in `view`? | No; like `counts`, the block stays board-wide. |
| Is a corrupt annex fatal? | Reads: no, the view shows `status: "invalid"`. Writes: every request command refuses until the file is repaired explicitly. |
| View `schema_version`? | Stays 1. The view contract exists only on the unreleased `next` line; new properties are declared in `view.schema.json`. |

## User Stories

### US-1: Coordinator records an ask to the operator (Priority: P0)
As the designated coordinator, I want to open a structured request to the operator, bound
to a mission or not, so that what we wait for is board data rather than prose.
**Why this priority**: it is the feature's reason to exist.
**Scope**: This story does NOT cover answering, display, or operator-side tools.
**Independent Test**: open a request on a fixture board and read `requests.json`.
**Acceptance Scenarios**:
1. **Given** accepted board B (coordinator `lead`, task `b` queued) without `requests.json`, **When** `request-open B --coordinator lead --revision 0 --request r.json` with `{"id":"key-b","to":{"kind":"role","label":"owner"},"kind":"supply","text":"Install the staging key out of band","task_id":"b","need":"before-task"}`, **Then** `requests.json` has revision 1, one `open` request with `created_by: "lead"`, one history entry, and `state.json` and `roadmap.json` are byte-identical.
2. **Given** the same board, **When** `--coordinator other` opens a request, **Then** exit 1 with a foreign-coordinator error and no file change.
3. **Given** annex revision 3, **When** request-open passes `--revision 2`, **Then** exit 1 with a stale-revision error and no change.
4. **Given** request `key-b` exists, even withdrawn, **When** another request with id `key-b` is opened, **Then** it is refused.

### US-2: Coordinator relays the answer or withdraws (Priority: P0)
As the coordinator, I want to record the operator's answer, or withdraw a request, so the
board shows it closed with who and when, without secrets.
**Why this priority**: without closure the list only grows.
**Scope**: This story does NOT cover verifying the answer's truth or detecting secrets.
**Independent Test**: answer and withdraw requests on a fixture board.
**Acceptance Scenarios**:
1. **Given** open `key-b`, **When** `request-answer --id key-b --answer a.json` with `{"text":"Installed; see vault entry ops/staging","by":"owner"}`, **Then** status `answered`, `answer = {text, by:"owner", at, relayed_by:"lead"}`, revision + 1.
2. **Given** answered `key-b`, **When** it is answered again or withdrawn, **Then** refused (terminal).
3. **Given** open `q1`, **When** `request-withdraw --id q1 --withdrawal w.json` with `{"reason":"Settled from logs"}`, **Then** status `withdrawn`, `withdrawal = {reason, by:"lead", at}`.
4. **Given** withdrawn `q1`, **When** request `q1b` with `supersedes: "q1"` is opened, **Then** accepted; superseding an open, unknown or already superseded request is refused.

### US-3: Operator sees what is expected first (Priority: P0)
As the operator reading a page that renders `view`, or `status --format text`, I want
pending asks first with their due-ness, and answered asks still visible until their
mission is done.
**Why this priority**: "on doit voir tout de suite ce qu'on attend de nous".
**Scope**: This story does NOT cover any HTML page or notification.
**Independent Test**: build a board with mixed requests and inspect `view` and text status.
**Acceptance Scenarios**:
1. **Given** an open blocking request and an open `later` request, **When** `view`, **Then** `operator_requests.items` lists the blocking one (`due: "now"`) first, `counts.now = 1`, and `next_action` starts with `Waiting on owner`.
2. **Given** answered `key-b` bound to queued `b`, **When** `view`, **Then** it is in `items` with its answer; after `b` is done it leaves `items` and `counts.archived = 1`.
3. **Given** an answered unbound request, **When** every task is done, **Then** it is still in `items`.
4. **Given** open requests, **When** `status --format text`, **Then** a `Waiting on` block is the line block right after `Goal:`.
5. **Given** a corrupted `requests.json`, **When** `view`, text status or `prompt`, **Then** they render with `operator_requests.status = "invalid"` and `claim` still succeeds.

### US-4: Requests stay advisory (Priority: P0)
As the coordinator, I want claims and `next` unaffected by open requests (D2).
**Why this priority**: an owner decision; a mechanical block would change execution authority.
**Scope**: This story does NOT cover prompt guidance.
**Independent Test**: compare `next`/`claim` with and without requests.
**Acceptance Scenarios**:
1. **Given** an open blocking request bound to ready queued `b`, **When** `next`, **Then** `b` is ready, and `claim` succeeds.
2. **Given** any request write, **Then** `state.revision`, `state.json` bytes and the contract digest are unchanged.
3. **Given** the board `.lock` directory is held, **When** a request command runs, **Then** it refuses with a lock-unavailable error and changes nothing.

### US-5: Prompt carries the asks (Priority: P1)
As a coordinator or worker session resuming through `prompt`, I want the relevant requests
within the character budget.
**Why this priority**: sessions resume from `prompt`; requests outside it are forgotten.
**Scope**: This story does NOT cover raising the default budget.
**Independent Test**: render prompts on a fixture board with requests.
**Acceptance Scenarios**:
1. **Given** open and answered current requests, **When** `prompt` without `--task`, **Then** `operator_requests.items` lists them with `due`, texts cut to 300 characters with a marker.
2. **Given** requests bound to `a` and `b`, **When** `prompt --task b`, **Then** only `b`'s requests appear.
3. **Given** enough requests to exceed `--max-chars`, **When** `prompt`, **Then** it refuses with the existing overflow error rather than dropping them.

### US-6: Project journal reference (Priority: P2)
As the coordinator, I want to record an inert reference to the project logbook, shown in
`view` and never opened by the tool.
**Why this priority**: convenience for pages that link the logbook.
**Scope**: This story does NOT cover reading or validating the journal.
**Independent Test**: set and clear the reference; inspect `view`.
**Acceptance Scenarios**:
1. **Given** no journal, **When** `request-journal --journal j.json` with `{"path":"~/notes/demo/journal.html"}`, **Then** `view.operator_requests.journal` equals that string and revision + 1, although the path does not exist.
2. **Given** a journal, **When** `{"path":null}`, **Then** it is cleared.
3. **Given** `{"path":""}` or a path with a control character, **Then** refused.

## Challenges

| ID | Story | Challenge | Resolution |
|---|---|---|---|
| C-1 | US-1 | Draft boards: what is checked? | Draft-tolerant read; `task_id` must exist in current `roadmap.json` tasks; any safe `--coordinator` before acceptance. |
| C-2 | US-1 | Bound task removed from a draft | Item stays valid; `task_state: "unknown"`, due-ness as unbound. |
| C-3 | US-1 | Draft authors vs later coordinator | After acceptance the coordinator may answer or withdraw any request; acceptance ignores the annex. |
| C-4 | US-1 | `--author` vs `--coordinator`; passing null | Use `--coordinator`; `null` journal travels in a JSON file. |
| C-5 | US-1 | Core file 488/500 lines; closure | New sibling `roster-roadmap-requests.cjs`; core gets COMMANDS, one dispatch and one prompt line; sync, schema docs, skill and install test list the sibling. |
| C-6 | US-1 | Control/bidi characters | Write-time refusal: labels, ids, refs, journal reject C0, C1, DEL and bidi controls (U+202A–U+202E, U+2066–U+2069); multi-line texts allow only `\n` and `\t`. Text rendering also cleans them. |
| C-7 | US-1 | Corrupt annex | Writes refuse; reads report `invalid`. Repair is explicit and manual. |
| C-8 | US-1 | No history unlike estimates | Append-only `history` `{revision, action, request_id, coordinator, at}`; `revision == history.length`. |
| C-9 | US-2 | Format of `by`; D5 breaches | `answer.by` is an inert label (≤ 200, no controls); `withdrawal.by` and `answer.relayed_by` come from `--coordinator`. D5 is a documented rule: a leaked secret must be treated as compromised and rotated; the tool does not detect secrets. |
| C-10 | US-2 | `supersedes` semantics | Target must exist, be closed (answered or withdrawn) and not already superseded; the view derives `superseded_by`. |
| C-11 | US-2 | Complete boards | `request-open` refused on a globally complete board; answer, withdraw and journal allowed. Own code path, not `mutate`. |
| C-12 | US-3 | `canClaimBasic` on drafts | Only consulted on accepted boards; draft tasks have status `draft`. |
| C-13 | US-3 | `canClaimBasic` vs `canClaim`; done tasks | Readiness uses `canClaimBasic` (dependency, budget, route, capacity, scope); a reframe-needed task may show `now`, which is right: the ask precedes its next attempt. `blocking` is `now` whatever the task state. |
| C-14 | US-3 | Strict view schema | Declare `operator_requests` (top level) and `requests` (task item) in `view.schema.json`; not required, so older saved views still validate; `schema_version` stays 1 (unreleased `next` contract). |
| C-15 | US-3 | 2 MiB view cap | Limits: ≤ 500 requests in total, ≤ 100 open at once, refs ≤ 10 × 500 characters. If the serialized block exceeds 512 KiB, closed items are dropped (oldest closed first), never open ones, with `truncated: true`; counts stay exact. (Amended after plan review: dropping open asks would hide what we wait for.) |
| C-16 | US-3 | Prefix wording | `Waiting on <label> (<n>)[, <label> (<n>)]: <total> request(s) due now. ` before the existing next action, labels in first-due order; only when the annex is valid and `counts.now > 0`. |
| C-17 | US-3 | Counts and ordering | `open = now + later + unscheduled`; `answered`, `withdrawn` are file totals; `archived` = closed requests not in `items`. Open: due rank, `created_at`, `id`; closed: `closed_at` descending, `id`. |
| C-18 | US-3 | Text block layout and cleaning | Specified in FR-018; the module's own cleaner removes C0, C1, DEL and bidi controls. |
| C-19 | US-3 | `version` inputs | Annex status, revision and the `[id, due]` list of open requests. |
| C-20 | US-3 | Default `status` JSON, `next` | Unchanged. |
| C-21 | US-4 | Lock and re-read | Same `.lock`, immediate refusal; board and annex are read and validated under the lock; invalid state refuses. |
| C-22 | US-5 | Prompt roles | No `--task` = coordinator view; `--task` = mission view; drafts keep failing as today. Items carry `refs_count`, not refs. Coordinator prompt: open requests plus answered requests bound to a task not done; unbound answered requests are omitted from the prompt (the coordinator relayed them itself) so closed history cannot grow the resume context. |
| C-23 | US-5 | Overflow from many requests | Intended: never drop context silently. The growth is bounded by the 100-open limit and by C-22; the error says to close/withdraw requests, focus `--task` or raise `--max-chars`. |
| C-24 | US-6 | Journal validation | Nonempty text ≤ 1000, no controls, absolute or relative; bumps revision; allowed on drafts. |

## Functional Requirements

#### Annex and records [US-1, US-2, US-6]
- **FR-001** [US-1]: The toolkit MUST store requests only in `<board>/requests.json` with exactly `{schema_version: 1, board_id, revision, journal, requests, history}`; an absent file MUST read as revision 0 with no requests.
- **FR-002** [US-1]: Each request MUST have exactly the fields `id, to, kind, text, task_id, need, refs, created_at, created_by, status, supersedes, answer, withdrawal`, validated as: safe identifier id unique for the board's lifetime; `to = {kind: role|person, label ≤ 200}`; `kind ∈ {decision, supply, action, information}`; text nonempty ≤ 2000; `task_id` a current contract task or null; `need ∈ {blocking, before-task, later}`, `before-task` only with a task; refs ≤ 10 strings ≤ 500; tool-set UTC `created_at`.
- **FR-003** [US-1]: The toolkit MUST refuse at write time C0 (except `\n`, `\t` in texts, answers and reasons), C1, DEL and bidi and invisible format characters (U+200B–U+200F, U+2028, U+2029, U+202A–U+202E, U+2060–U+2069, U+FEFF) in every string, and MUST refuse more than 500 requests in total or more than 100 open requests.
- **FR-004** [US-1]: `revision` MUST equal `history.length`; each write MUST append one history entry `{revision, action, request_id, coordinator, at}` and never delete or rewrite a request's creation fields.
- **FR-005** [US-1]: `request-open BOARD --coordinator ID --revision N --request FILE` MUST create one `open` request with `answer` and `withdrawal` null; `request-answer ... --id RID --answer FILE` (`{text, by}`) MUST set `status: answered` and `answer = {text, by, at, relayed_by}`; `request-withdraw ... --id RID --withdrawal FILE` (`{reason}`) MUST set `status: withdrawn` and `withdrawal = {reason, by, at}`; `request-journal ... --journal FILE` (`{path}`) MUST set or clear `journal`.
- **FR-006** [US-2]: Answer and withdraw MUST apply only to `open` requests; terminal states MUST be final.
- **FR-007** [US-2]: `supersedes` MUST be null or name an existing closed request not already superseded.
- **FR-008** [US-1]: On an accepted board `--coordinator` MUST equal `state.coordinator`; on a draft any safe identifier MUST be accepted.
- **FR-009** [US-1]: Every request command MUST hold the board `.lock`, read and validate the board and the annex under it, refuse a `--revision` different from the annex revision, refuse when the annex is invalid (including a foreign `board_id` or symlinked path), and replace the file atomically.
- **FR-010** [US-2]: `request-open` MUST be refused on a globally complete board; answer, withdraw and journal MUST remain allowed.
- **FR-011** [US-6]: The journal MUST be null or nonempty text ≤ 1000 without control characters, and the toolkit MUST NOT open, read or resolve it.

#### Advisory boundary [US-4]
- **FR-012** [US-4]: Request commands MUST NOT modify `roadmap.json`, `state.json`, receipts, `estimates.json` or `progress/`, and `claim`, `next`, `release`, default `status` JSON MUST behave identically with or without requests.

#### Observation [US-3]
- **FR-013** [US-3]: `view` MUST include `operator_requests = {status: absent|valid|invalid, reason, revision, journal, counts, items, truncated}`; an invalid annex MUST NOT make `view`, text status or `prompt` fail.
- **FR-014** [US-3]: For each open request the view MUST derive `due`: `now` if `need = blocking`; `unscheduled` if unbound or its task is unknown; `later` if `need = later`; for `before-task`: `now` when the task is active or blocked, or queued on an accepted board with no `canClaimBasic` reason; `unscheduled` when the task is done; `later` otherwise. Closed requests MUST have `due: null`.
- **FR-015** [US-3]: `items` MUST contain every open request, and every closed request that is unbound, bound to an unknown task, or bound to a task not done; closed requests bound to a done task MUST be counted in `counts.archived` and omitted.
- **FR-016** [US-3]: `items` MUST be ordered open first by due (now, later, unscheduled), `created_at`, `id`; then closed by `closed_at` descending and `id`. Each item MUST carry the stored record plus `due`, `task_state`, `closed_at`, `superseded_by`.
- **FR-017** [US-3]: `counts` MUST be `{open, now, later, unscheduled, answered, withdrawn, archived}`; each task item MUST carry `requests` (IDs of its open requests); `version` MUST include annex status, revision and the open `[id, due]` list; when valid and `counts.now > 0`, `next_action` MUST be prefixed with `Waiting on <label> (<n>)…: <total> request(s) due now. `.
- **FR-018** [US-3]: `status --format text` MUST print, right after the `Goal:` line and only when the annex is invalid or `items` is nonempty, a `Waiting on:` block: one line per open item `  [<due>] <id> → <label> (<kind>; task <id>|unbound): <text ≤ 160>`, then per closed item `  [answered <at>] <id> ← <by>: <answer ≤ 160>` or `  [withdrawn <at>] <id>: <reason ≤ 160>`; an invalid annex prints `Waiting on: requests annex invalid — <reason>`. All strings MUST be cleaned of C0, C1, DEL, bidi and invisible format characters.
- **FR-019** [US-3]: When the serialized block exceeds 512 KiB the view MUST drop closed items, oldest closed first, and set `truncated: true`, keeping counts exact; open items MUST never be dropped.
- **FR-020** [US-3]: `view.schema.json` MUST declare `operator_requests` and task `requests` without making them required; view `schema_version` MUST stay 1.

#### Prompt [US-5]
- **FR-021** [US-5]: `prompt` without `--task` MUST include `operator_requests = {status, revision, journal, items}` with every open request and every answered request bound to a task that is not done (withdrawn and unbound answered requests omitted); with `--task` only the open and answered requests bound to that task. Each item: `id, to, kind, task_id, need, due, status, text, refs_count`, and `answer` when answered; texts and answers truncated to 300 characters with `…[truncated]`.
- **FR-022** [US-5]: Prompt output including requests MUST still be bound by `--max-chars`, refusing on overflow; the coordinator continuation MUST say to open a request instead of pausing silently and never to put secrets in requests.

#### Distribution and docs
- **FR-023** [US-1]: The sibling module and `schema/roadmap-requests-schema.md` MUST be part of the installed runtime closure (sync, install test) and documented in `schema/roadmap-schema.md`, `schema/roadmap-view-schema.md` and `skills/pipeline/roster-roadmap.md`, including D5.
- **FR-024** [US-1]: `scripts/roster-roadmap.cjs` MUST stay at or under 500 lines.

## Acceptance Criteria

- **AC-1** [US-1 happy path]: open on accepted board → annex revision 1, one open request, one history entry, state/contract bytes unchanged.
- **AC-2** [US-1, C-21]: foreign coordinator, stale revision, duplicate id, unknown task, `before-task` unbound, invalid characters, held lock → refused, file unchanged.
- **AC-3** [US-2 happy path]: answer then withdraw other → statuses, `answer`/`withdrawal` fields, revisions, history.
- **AC-4** [US-2, C-10]: terminal re-answer/withdraw refused; supersede rules enforced.
- **AC-5** [US-3 happy path]: view ordering, due derivation for every rule, counts, task `requests`, `next_action` prefix.
- **AC-6** [US-3, D4]: answered bound request visible until its task is done, then archived; unbound closed stays.
- **AC-7** [US-3, C-7]: corrupt/foreign/symlinked annex → view/status/prompt render `invalid`; writes refuse; claim works.
- **AC-8** [US-3]: text status prints the `Waiting on:` block right after `Goal:` with cleaned strings.
- **AC-9** [US-4]: `next` and `claim` identical with an open blocking request; state bytes unchanged by request writes.
- **AC-10** [US-5]: coordinator/mission prompt content, truncation and overflow refusal.
- **AC-11** [US-6]: journal set/clear/refusals; nonexistent path accepted.
- **AC-12** [US-3, C-14]: a view with requests validates against `view.schema.json` (required properties and `additionalProperties: false` honoured).
- **AC-13** [C-5]: installed closure contains the sibling module and schema doc; core ≤ 500 lines; drafts allow requests.

## Edge Cases

- EC-1 [US-1]: draft `task_id` not in the contract → refused at open.
- EC-2 [US-1]: `--revision 0` with no file → accepted; with a file at revision ≥ 1 → stale.
- EC-3 [US-1]: annex `board_id` ≠ board → invalid.
- EC-4 [US-1]: symlinked `requests.json` → writes refused, view `invalid`.
- EC-5 [US-2]: extra fields in answer/withdrawal/request files → refused.
- EC-6 [US-2]: superseding unknown, open or already superseded request → refused.
- EC-7 [US-3]: open blocking request bound to a done task → `due: now`, stays in items; the coordinator is expected to answer or withdraw it (documented).
- EC-8 [US-3]: open before-task request bound to a done task → `unscheduled`, stays in items.
- EC-9 [US-3]: draft board view with bound request → `later`/`unscheduled`, no crash.
- EC-10 [US-3]: annex over 16 MiB → `invalid`.
- EC-11 [US-3]: bidi override in a stored string → refused at write; cleaned if hand-written.
- EC-12 [US-4]: lock held by another command → immediate refusal; retry after release.
- EC-13 [US-5]: `prompt --task` with no requests → `items: []`; invalid annex → `{status: "invalid", reason}`.
- EC-14 [US-6]: journal `""` → refused; `null` clears.

## Runnable Checks

- **CHECK-1** [AC-1, AC-2, AC-3, AC-4, AC-11, AC-13]: (authentic-success-path, fail-closed-path) `node --test scripts/roster-roadmap-requests.test.js` → exit 0.
- **CHECK-2** [AC-5, AC-6, AC-7, AC-8, AC-9, AC-10, AC-12]: `node --test scripts/roster-roadmap-requests-view.test.js` → exit 0.
- **CHECK-3** [AC-13]: `npm run test:roadmap` → exit 0 (includes install closure test).
- **CHECK-4** [AC-13]: `test $(wc -l < scripts/roster-roadmap.cjs) -le 500` → exit 0.
- **CHECK-5** [AC-13]: `bash scripts/sync-harness.sh --check && node scripts/check-pipeline-install.js` → exit 0.

## Claims Metadata

```claims
{"record":"claims-header","schema_version":1,"namespace":"roadmap-operator-requests","spec_lifecycle":"draft"}
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
{"record":"acceptance-criterion","id":"AC-1","for":["FR-001","FR-002","FR-004","FR-005","FR-012"]}
{"record":"acceptance-criterion","id":"AC-2","for":["FR-002","FR-003","FR-008","FR-009"]}
{"record":"acceptance-criterion","id":"AC-3","for":["FR-005","FR-004"]}
{"record":"acceptance-criterion","id":"AC-4","for":["FR-006","FR-007","FR-010"]}
{"record":"acceptance-criterion","id":"AC-5","for":["FR-013","FR-014","FR-016","FR-017"]}
{"record":"acceptance-criterion","id":"AC-6","for":["FR-015"]}
{"record":"acceptance-criterion","id":"AC-7","for":["FR-009","FR-013"]}
{"record":"acceptance-criterion","id":"AC-8","for":["FR-018"]}
{"record":"acceptance-criterion","id":"AC-9","for":["FR-012"]}
{"record":"acceptance-criterion","id":"AC-10","for":["FR-021","FR-022"]}
{"record":"acceptance-criterion","id":"AC-11","for":["FR-011","FR-005"]}
{"record":"acceptance-criterion","id":"AC-12","for":["FR-019","FR-020"]}
{"record":"acceptance-criterion","id":"AC-13","for":["FR-023","FR-024","FR-008"]}
{"record":"check","id":"CHECK-1","for":["AC-1","AC-2","AC-3","AC-4","AC-11","AC-13"]}
{"record":"check","id":"CHECK-2","for":["AC-5","AC-6","AC-7","AC-8","AC-9","AC-10","AC-12"]}
{"record":"check","id":"CHECK-3","for":["AC-13"]}
{"record":"check","id":"CHECK-4","for":["AC-13"]}
{"record":"check","id":"CHECK-5","for":["AC-13"]}
```

## Entities

- `OperatorRequest`: one ask from the coordinator to a human operator, stored in `requests.json`.
- `RequestsAnnex`: the advisory board file `requests.json` with its own revision and history.
- `Due`: the derived timing of an open request in a given observation: `now`, `later` or `unscheduled`.
