# Example roadmap contract

Copy these shapes into a newly initialized disposable board, then adapt them to the
actual project. All runtimes are intentionally unavailable until observed; no model
or session permission is granted by an example.

```bash
node scripts/roster-roadmap.cjs init /tmp/my-roadmap-example --id example-roadmap
cp examples/roadmap/roadmap.json /tmp/my-roadmap-example/roadmap.json
cp examples/roadmap/capabilities.json /tmp/my-roadmap-example/capabilities.json
node scripts/roster-roadmap.cjs lint /tmp/my-roadmap-example
```

The two dependent tasks separate implementation and independent review. Review has no
sequential fallback: an unavailable independent reviewer must not become self-review.
Check commands, intake references, scopes, models and success criteria are examples,
not evidence that a consumer project exists or passes. Follow the [roadmap guide](../../docs/roadmap-coordination.md)
and [artifact reference](../../schema/roadmap-schema.md) to record an actual acceptance,
claim missions and return real verification evidence.
