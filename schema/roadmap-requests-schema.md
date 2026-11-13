# Roadmap operator requests (`requests.json`)

`requests.json` is an **advisory annex** of a roadmap board. It records, as structured data,
what the coordinator is waiting for from the human operator. It is written only by the four
`request-*` commands of `roster-roadmap.cjs` and read by `view`, `status --format text` and
`prompt`.

It never changes execution authority: `roadmap.json` and `state.json` are untouched, and
`claim`, `next`, `release`, `record`, `complete` and the default `status` JSON behave exactly
as without it. An open request bound to a mission is a signal (due now, later, unscheduled),
never a refusal of `claim`.

## Rules for people and agents

- **Never store a secret.** A request or an answer confirms something, or says where the thing
  is (for example "installed; see vault entry ops/staging"). The tool does not detect secrets.
  A secret that leaks into the annex must be treated as compromised and rotated.
- Labels (`to.label`, `answer.by`) are **unauthenticated assertions**, like every other
  identity label in the toolkit. The coordinator relays the operator's answer; there is no
  operator-side command, page or authentication.
- An answered request is never erased: it stays visible, marked answered with the answer and
  its date, until the mission it is bound to is done (display rule D4). An unbound request
  stays visible. A withdrawn request is a closed request, shown the same way.
- Strings may not contain C0 control characters (only `\n` and `\t` are allowed in `text`,
  `answer.text` and `reason`), C1, DEL, bidirectional controls or invisible format characters
  (U+200B-U+200F, U+2028, U+2029, U+202A-U+202E, U+2060-U+2069, U+FEFF). They are refused at
  write time and cleaned again when rendered as text.

## File

```json
{
  "schema_version": 1,
  "board_id": "demo",
  "revision": 1,
  "journal": null,
  "requests": [ { "id": "key-b", "to": { "kind": "role", "label": "owner" }, "kind": "supply",
    "text": "Install the staging key out of band", "task_id": "b", "need": "before-task", "refs": [],
    "created_at": "2026-11-13T10:00:00.000Z", "created_by": "lead", "status": "open",
    "supersedes": null, "answer": null, "withdrawal": null } ],
  "history": [ { "revision": 1, "action": "open", "request_id": "key-b", "coordinator": "lead", "at": "2026-11-13T10:00:00.000Z" } ]
}
```

- `revision` equals `history.length`; every write appends exactly one history entry
  (`open`, `answer`, `withdraw`, `journal`) and never deletes or rewrites a request's creation
  fields. An absent file reads as revision 0 with no requests.
- `id`: safe identifier (`[a-zA-Z][a-zA-Z0-9_-]{0,79}`), unique for the board's lifetime, even
  when withdrawn. `to = {kind: role|person, label <= 200}`. `kind`: `decision`, `supply`,
  `action`, `information`. `text`: nonempty, <= 2000. `task_id`: a task of the current
  `roadmap.json` at open time, or `null`. `need`: `blocking`, `before-task` (requires a task)
  or `later`. `refs`: at most 10 strings of at most 500 characters. `created_at`, `answer.at`,
  `withdrawal.at` are set by the tool (UTC).
- `status` is `open`, `answered` (`answer = {text, by, at, relayed_by}`) or `withdrawn`
  (`withdrawal = {reason, by, at}`); both are terminal.
- `supersedes` is `null` or names an existing closed request that no other request supersedes.
  The view derives `superseded_by`.
- Limits: at most 500 requests in total and 100 open at once. `journal` is `null` or inert text
  of at most 1000 characters; the tool never opens or resolves it.
- The annex is **invalid** when it is a symlink, larger than 16 MiB, malformed, belongs to
  another `board_id`, or `revision != history.length`. Reads then report
  `operator_requests.status = "invalid"`; every request command refuses until the file is
  repaired explicitly and manually.

## Commands

All take `--coordinator ID` and `--revision N` (the current annex revision, `0` when the file
is absent). On an accepted board `--coordinator` must equal `state.coordinator`; on a draft any
safe identifier is accepted. Each command holds the board `.lock` (refusing at once when
unavailable), re-reads and validates the board and the annex under it, and replaces the file
atomically. Input travels in JSON files (extra fields are refused).

```bash
roster-roadmap.cjs request-open     BOARD --coordinator lead --revision 0 --request request.json
roster-roadmap.cjs request-answer   BOARD --coordinator lead --revision 1 --id key-b --answer answer.json
roster-roadmap.cjs request-withdraw BOARD --coordinator lead --revision 2 --id q1 --withdrawal withdrawal.json
roster-roadmap.cjs request-journal  BOARD --coordinator lead --revision 3 --journal journal.json
```

| Command | File | Notes |
|---|---|---|
| `request-open` | `{id, to, kind, text, need, task_id?, refs?, supersedes?}` | refused on a globally complete board |
| `request-answer` | `{text, by}` | only an `open` request; `relayed_by` is `--coordinator` |
| `request-withdraw` | `{reason}` | only an `open` request; `by` is `--coordinator` |
| `request-journal` | `{path}` | `path` is text or `null` to clear; the file need not exist |

Answer, withdraw and journal stay allowed on a complete board.

## Due rules (derived, never stored)

For an open request: `now` if `need = blocking`; `unscheduled` if unbound or its task is not in
the contract; `later` if `need = later`; for `before-task`: `now` when the task is active or
blocked, or queued on an accepted board with no basic claim obstacle (dependency, budget,
route, capacity, scope); `unscheduled` when the task is done; `later` otherwise (including
drafts). An open blocking request bound to a done task stays `now` and visible: the coordinator
is expected to answer or withdraw it. Closed requests have `due: null`.

## Observation

`view.operator_requests` and `status --format text` (`Waiting on:` block right after `Goal:`)
and `prompt` expose the annex; see `view-schema.md`.
