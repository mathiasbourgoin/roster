# code-intel pack registry

`code-intel.jsonl` is roster's public discovery list of code-intel packs — tools that plug
into the pipeline's deterministic seam (`capability: code-intel`) to provide QA gates, audit
sections, or index initialization. One JSON object per line (JSONL). The entry shape is
documented in [`code-intel.schema.json`](code-intel.schema.json) and enforced in CI by
`scripts/check-code-intel-registry.js` (offline, dependency-free).

**The registry is discovery/curation only. Consumers never read it.** Pack resolution at
runtime is frontmatter-only (skills tagged `capability: code-intel`); an installed pack that
is absent from this registry is fully supported — first-class, never flagged, never named.
The registry exists solely so roster-init and recruit can *suggest* packs.

## Entry fields

| Field | Required | Constraint |
|---|---|---|
| `name` | yes | kebab-case, unique across the registry |
| `tool` | yes | underlying tool/binary, unique across the registry |
| `repo` | yes | exactly one of: `http(s)` URL, or roster-repo-relative path (no leading `/`, no `..`, must exist in the repo) |
| `languages` | yes | non-empty array; enum: `go`, `rust`, `typescript`, `javascript`, `python`, `ocaml` (extensible only by editing the schema) |
| `provides` | yes | non-empty array; enum: `gate`, `audit-section`, `init` |
| `install` | yes | non-empty free-text command block — shown to the user **verbatim**, never executed |
| `tier` | yes | `verified` or `community` |
| `notes` | verified: yes | free-text; required non-empty for `verified` entries, optional otherwise |

## Tier semantics

- **`verified`** — roster-maintained: the pack's install and seam contract are covered by
  roster's CI. Verified does **not** mean the underlying tool's correctness across all its
  language paths is CI-tested — language-path correctness is the upstream tool's domain.
- **`community`** — schema-valid, submitted via PR; **not verified by roster**. Discovery
  labels these "community — not verified by roster".

Tier assignment changes **only** via a maintainer-merged PR. There is no automated
promotion or demotion of tiers.

## Submitting a community entry

Open a PR that appends one line to `code-intel.jsonl`. Checklist:

- [ ] Entry is a single JSON object on one line, matching `code-intel.schema.json`
- [ ] `name` and `tool` do not collide with any existing entry
- [ ] `repo` is a reachable public URL (or an in-repo path that exists)
- [ ] `install` is copy-pasteable as written — it will be presented verbatim, never executed
- [ ] `tier` is `community` (only maintainers assign `verified`)
- [ ] `node scripts/check-code-intel-registry.js` exits 0 locally
- [ ] Optionally sanity-check reachability with `node scripts/check-code-intel-registry.js --online` (never run in CI)
