# Claims Reconciliation

Roster's claims reconciler keeps human-readable specifications and generated knowledge-base views
in sync. The Markdown requirement, acceptance criterion, or check remains the normative sentence.
A small JSONL block adds stable identity and dependency metadata without copying that sentence.

## Source And Views

Authoritative inputs:

- `specs/*.md` Markdown plus one optional fenced `claims` block and any source `code-intel` fences
- `specs/claims-authority.json` for approval authority of active claim types
- `specs/claims.lock` for immutable external registry revisions

Generated views are `kb/spec.md`, `kb/properties.md`, and `kb/index.md`. They are versioned once
claims are enabled, marked `derived`, and carry a digest of the model, authority map, lock,
renderer, and selection policy. Edit their source spec instead of editing generated prose.

## Commands

```bash
npm run claims:audit      # read-only migration inventory and candidate metadata
npm run claims:validate   # closed schema, pairing, authority, lock, and dependency checks
npm run claims:project    # atomically regenerate the three KB views
npm run claims:check      # fail when a managed view is absent, changed, or stale
npm run test:claims       # all deterministic and mutation-backed claim scenarios
```

Installed harnesses expose the same CLI at `.harness/bin/claims-reconcile.js`. A repository with
no `claims` block remains in legacy mode: `check` passes and `project` performs no write.

## Minimal Metadata

````markdown
## Functional Requirements

- **FR-001** [US-1]: The service MUST reject an expired token.

## Acceptance Criteria

- **AC-1** [US-1]: An expired token is submitted -> access is rejected.

## Runnable Checks

- **CHECK-1** [AC-1]: `npm test -- expired-token` -> expected: exit 0

```claims
{"record":"claims-header","schema_version":1,"namespace":"session-auth","spec_lifecycle":"active"}
{"record":"requirement","id":"FR-001","depends_on":[],"external_sources":[]}
{"record":"acceptance-criterion","id":"AC-1","for":["FR-001"]}
{"record":"check","id":"CHECK-1","for":["AC-1"]}
```
````

References within the same block use local IDs. Cross-spec references use
`namespace/FR-001`. Migrated `VALIDATED` documents use `pending-confirmation`, which remains in
mandatory context until a maintainer confirms or retires it.

Both `- **AC-1**: ...` and the historical `- AC-1: ...` list form are recognized under canonical
headings. Files with no recognized normative line are surfaced by `claims:audit` in
`metrics.unrecognized_specifications`; they require a deliberate migration rather than being
silently omitted.

Place machine-checkable invariants in a source spec, for example:

````markdown
```code-intel
{"id":"INV-1","type":"layering","description":"no cycle","check":{"kind":"acyclic"}}
```
````

The reconciler projects this fence byte-for-byte to `kb/properties.md`. A fence edited directly in
the generated KB is stale; a legacy fence with no source is rejected on projection so it cannot be
lost unnoticed.

## Agentic Boundaries

Agents may suggest namespaces, links, dependencies, or semantic-search candidates. Those remain
candidates until a patch passes deterministic validation and human review. Semantic candidates
are labeled as hints and never become evidence or remove mandatory context.

The questions digest attests the exact neutral research questions. Technical IDs are constrained
by the grammar and treated as structural references; V1 does not claim that they conceal domain
semantics. External-registry claims are accepted only with a locked source revision and have
`verification: absent` until a later evidence contract proves otherwise.

The authority gate validates the separate authority map and incorporates it into freshness. It
does not currently authenticate the Git identity of the reviewer or prove that the named person
approved a patch. Repository branch protection and review policy must enforce that boundary.

Set the KB agent's `embedding_mode` to `disabled` for an offline workflow. This removes optional
semantic candidates only; claims, dependency closure, digests, projections, compliance, and QA
remain available.

V1's context manifest contains all applicable managed claims. It is not yet scoped from roots
named by an intake; task-specific dependency closure is the next iteration, not an implied claim.
