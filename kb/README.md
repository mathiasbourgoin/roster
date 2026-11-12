# Code contracts

The generated [claim index](index.md) links to the specification and invariant
views. Its pending-confirmation entries have no recorded verification; they are
not established behavior.

The executable entry points for this repository are:

- [`scripts/install.sh`](../scripts/install.sh): install the selected runtime files.
- [`scripts/sync-harness.sh`](../scripts/sync-harness.sh): project the shared harness.
- [`scripts/claims-reconcile.js`](../scripts/claims-reconcile.js): validate and check claim projections.
- [`scripts/check-leak.js`](../scripts/check-leak.js): scan repository content for leak patterns.
