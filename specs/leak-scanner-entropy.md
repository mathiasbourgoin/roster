---
name: leak-scanner-entropy
type: spec
status: VALIDATED
feature: Shape- and entropy-aware HIGH_BLOB detection in the leak scanner
brief: briefs/leak-scanner-entropy-intake.md
date: 2026-07-13
version: 1.2.0
---

# Spec — Leak Scanner Entropy (minimal-freeze)

> Validation: gate exercised under standing user delegation ("do them fully autonomously", 2026-07-13). Invariants, checks, and OQ encodings reviewed against the intake brief; the measured entropy constraint (hex ≤ 4.0 bits/char < prose corpus) was verified as the binding design constraint.

**Profile: minimal-freeze** (Type: fix + Trust boundary: yes — this changes secret-detection
behavior, the repo's fail-closed leak gate). Per the minimal-freeze contract: Invariants +
Runnable Checks + paired ACs only; no story ceremony; `min_user_stories`/
`min_gwtscenarios_per_story` do not apply. Requirements are numbered `LSE-N` (fresh range; the
existing specs' FR- space runs to FR-158 and is not reused).

## Context

`scripts/check-leak.js` (buildless CommonJS, exports `scanLine`/`scanFile`/`main`) flags any
unbroken `[A-Za-z0-9+/]{60,}={0,2}` run as HIGH `high-entropy-blob` (line 78) — length-only. This
produced three CI-red false positives on 2026-07-13 (slash-joined keyword list in spec prose;
`sha512-` npm integrity fields in `package-lock.json`; 64-hex `sha256` values in
`scripts/review-bundle.manifest.json`). The fix makes HIGH_BLOB shape- and entropy-aware and
removes the `.check-leak-ignore` entries the improved detector makes unnecessary.

**Measured entropy constraint (binding on the design):** a real sha256 hex digest has Shannon
entropy ≈ 3.81 bits/char — *lower* than the slash-joined prose false positive (≈ 4.00), because
the hex alphabet caps entropy at 4 bits/char. Therefore the Shannon threshold **cannot** be the
mechanism that distinguishes hex checksums from secrets in either direction: any threshold that
clears the prose list also sits above bare-hex entropy. Hex-40/64 handling MUST be carried by
context recognition (LSE-2), and a bare random hex key MUST remain HIGH regardless of the
threshold (INV-3).

**Concurrency note:** the `scripts-lib-split` task is restructuring `scripts/lib/` in parallel.
Verified: `check-leak.js`'s only import is `require("fs")` (line 32) — it has no `scripts/lib`
imports, so no interaction is expected.

**Gate decisions resolving the intake brief's Open Questions (binding):**

- **OQ1** — recognized checksum shapes are **downgraded to WARN** (printed, eyeballed, exit 0),
  never silently exempt. Fail-closed: every downgrade remains visible in scanner output.
- **OQ2** — hex-40/64 recognition **requires checksum-like context**: a **key name in key
  position** — `/(integrity|sha1|sha256|sha512|checksum|digest)["']?\s*[:=]/i` on the same line —
  or an explicit `sha256:` / `sha512-` prefix on the value. A prose mention of "sha256" elsewhere
  on the line is NOT context (A-1: anchoring made explicit after Voice 2 demonstrated a
  delta-gate bypass via trailing comments; a red fixture pins it). **The context match is
  evaluated only against the text PRECEDING the value on the line** (A-2, from review round 1:
  the colon form `<hex> // sha256: reference` defeated A-1's key-position anchor — keys precede
  values in every legitimate format, trailing comments never do; a second red fixture pins the
  colon form). Bare hex of 40/64 chars without such context stays HIGH.
- **OQ3** — the Shannon-entropy threshold is **derived from the actual corpus** by the
  implementer, with runtime-assembled fixtures on BOTH sides of the threshold committed as tests.
  This spec deliberately does not pick the constant; it requires the evidence (CHECK-3).
- **OQ4** — `.check-leak-ignore` entry removal is **conditional on a clean scanner run against
  the exact file** at the implementation commit (CHECK-4); rationale comments are updated in the
  same change. Any residual non-HIGH_BLOB HIGH hit keeps the entry (fail closed).

## Behavioral Changes

Exactly three, per the brief's Goal:

1. **LSE-1 (shape recognition → WARN):** `scanLine` MUST classify a HIGH_BLOB match as WARN
   (name distinguishable from a plain `high-entropy-blob` HIGH, e.g. `checksum-like-blob`)
   when — and only when — the match is a recognized checksum shape: hex-only of exactly 40 or 64
   chars **with** checksum-like context per OQ2, or a value carrying an explicit `sha256:` /
   `sha512-` integrity prefix. It MUST NOT produce no finding at all for these matches (OQ1).
2. **LSE-2 (entropy threshold):** `scanLine` MUST NOT emit HIGH `high-entropy-blob` for a
   matched run whose Shannon entropy falls below a corpus-derived threshold (OQ3); low-entropy
   runs (repeated fragments, prose-like slash-joined word lists) stop firing HIGH. The threshold
   MUST be documented at its definition site with the corpus evidence, and MUST NOT be the
   mechanism that clears hex-shaped values (see the measured constraint above; INV-3 pins this
   with a red fixture).
3. **LSE-3 (ignore-entry cleanup):** the `package-lock.json` and
   `scripts/review-bundle.manifest.json` entries in `.check-leak-ignore` MUST be removed iff
   `node scripts/check-leak.js <file>` exits 0 on each at the implementation commit; the
   `scripts/check-leak.test.js` entry MUST remain (its 7 HIGH hits are non-HIGH_BLOB classes:
   private-key-block, credential-in-url, secret-assignment ×3, credential-in-query ×2).

## Invariants

The true-positive guarantee is the trust boundary. The change must strictly reduce false
positives without weakening detection.

- **INV-1 (every existing HIGH class still fires):** every HIGH detection-class fixture in
  `scripts/check-leak.test.js` (private-key-block, aws-access-key-id, github-token, slack-token,
  google-api-key, google-oauth-token, stripe-key, openai-key, jwt, azure-account-key,
  credential-in-url, credential-in-query, bearer-token, secret-assignment incl. the
  placeholder-prefix bypass corpus) continues to assert HIGH and pass. No existing red fixture
  is deleted or weakened — only the HIGH_BLOB fixture is *replaced* per INV-2.
- **INV-2 (HIGH_BLOB red-fixture guarantee preserved):** the current HIGH_BLOB fixture
  `"Zm9vYmFy".repeat(10)` (check-leak.test.js:80) is low-entropy by construction (8-char repeat,
  ≈ 2.75 bits/char) and will legitimately stop firing under LSE-2. It MUST be replaced — not
  dropped — by a genuinely high-entropy, runtime-assembled base64 blob (string-concat assembly;
  never a contiguous secret-shaped literal — GitHub push protection) that asserts HIGH
  `high-entropy-blob`.
- **INV-3 (bare hex stays HIGH; entropy cannot clear it):** a runtime-assembled random 64-hex
  value (a plausible raw 256-bit key) and a random 40-hex value, each on a line with NO
  checksum-like context, MUST fire HIGH. This is the red fixture pinning the measured entropy
  constraint: hex entropy (≤ 4.0 bits/char) sits below any threshold that clears the prose
  corpus, so only OQ2's context gate may downgrade hex — never the entropy path.
- **INV-4 (no silent exemption):** recognized checksum shapes produce a WARN finding visible in
  scanner output (OQ1). For any input line, the fixed change never maps a pre-change HIGH to
  *no finding*; the only permitted transitions are HIGH → HIGH, HIGH → WARN (recognized shape),
  and HIGH → gone *solely* via the entropy floor of LSE-2 on genuinely low-entropy runs.
- **INV-5 (no new bypass surface):** the two existing exemption layers — the per-line `leak-ok`
  marker and the per-path `.check-leak-ignore` globs applied by `check-leak-diff.sh` — remain
  the only exemption inputs. The new logic is severity classification inside `scanLine`; it
  introduces no new config file, environment variable, CLI flag, or marker that suppresses
  findings. Recognition is narrow: exact lengths (40/64), exact prefixes
  (`sha256:`/`sha512-`/`sha384-` — A-1: `sha384-` added; npm SRI legitimately emits it at 64
  base64 chars, which would recreate the exact package-lock CI-red class this task fixes;
  `sha1-`/`sha256-` SRI values are 28/44 chars, below the 60-char match floor, moot), the exact
  context regex of OQ2. Near-misses (e.g. 63/65-hex, hex with no context, high-entropy base64
  without an integrity prefix) stay HIGH.
- **INV-6 (enforcement layer untouched):** `scripts/check-leak-diff.sh` semantics (`leak-ok`
  disabled under `--strict` for added lines; ignore-glob mechanism), the exit-code contract
  (0 clean/warn-only, 1 HIGH, 3 usage), and the `check-leak-delta` behavior are unchanged;
  their existing tests stay green.

## Acceptance Scenarios (GWT)

- **S-1 Given** `package-lock.json` at HEAD with its `"integrity": "sha512-…"` fields, **When**
  `node scripts/check-leak.js package-lock.json` runs, **Then** exit 0 with WARN lines naming
  the checksum-shape class — no HIGH. (LSE-1, OQ1)
- **S-2 Given** `scripts/review-bundle.manifest.json` at HEAD with its 15 64-hex `"sha256"`
  values, **When** the scanner runs on it, **Then** exit 0 with WARNs — no HIGH. (LSE-1, OQ2
  context: the `"sha256"` key is on the same line)
- **S-3 Given** a line holding a runtime-assembled random 64-hex string with no checksum-like
  key or prefix, **When** `scanLine` runs, **Then** a HIGH finding fires. (INV-3)
- **S-4 Given** the slash-joined keyword-list string that caused false positive #1 (assembled
  in-test; the reworded `specs/pipeline-loop-convergence.md` stands, out of scope), **When**
  `scanLine` runs, **Then** no HIGH `high-entropy-blob` fires. (LSE-2)
- **S-5 Given** a runtime-assembled genuinely high-entropy base64 blob ≥ 60 chars with no
  integrity prefix, **When** `scanLine` runs, **Then** HIGH `high-entropy-blob` fires. (INV-2)
- **S-6 Given** the post-fix `.check-leak-ignore`, **When** its entries are compared against
  per-file scanner runs, **Then** every removed entry corresponds to a file the scanner now
  exits 0 on, and `scripts/check-leak.test.js` is still listed. (LSE-3, OQ4)

## Runnable Checks

(Red-command convention: exit 0 = passes, 1 = assertion fired, ≥2 = error. `node --test` is
accepted here per the review-v2-corrections precedent; the fixtures themselves are plain
assertions.)

- **CHECK-1** [AC-1] (fail-closed-path): `node --test scripts/check-leak.test.js` → exit 0,
  where the suite MUST contain (all fixtures runtime-assembled): (a) every pre-existing HIGH
  class fixture unchanged and green (INV-1); (b) the replaced genuinely-high-entropy HIGH_BLOB
  red fixture (INV-2, S-5); (c) bare random 64-hex and 40-hex with no context → HIGH (INV-3,
  S-3); (d) near-miss shapes — 63/65-hex with checksum context, high-entropy base64 without
  `sha512-`/`sha256:` prefix — → HIGH (INV-5); (e) recognized shapes (`sha512-` integrity value;
  64-hex with `"sha256":` context) → WARN present, HIGH absent (INV-4, LSE-1).
- **CHECK-2** [AC-2] (authentic-success-path): `node scripts/check-leak.js package-lock.json
  scripts/review-bundle.manifest.json` → exit 0, stderr contains WARN lines for the checksum
  shapes and no `HIGH` line. Runs the real scanner binary against the real false-positive
  corpus at HEAD — the same files the CI enforcement path feeds it. (S-1, S-2)
- **CHECK-3** [AC-3]: threshold-evidence fixtures in `scripts/check-leak.test.js`: one
  runtime-assembled run with entropy strictly below the chosen threshold asserting *no* HIGH
  `high-entropy-blob` (includes the S-4 slash-joined-list class and the old `"Zm9vYmFy".repeat(10)`
  string) and one strictly above asserting HIGH — both citing the threshold constant, so moving
  it breaks a test (OQ3, LSE-2). `node --test scripts/check-leak.test.js` → exit 0 covers them.
- **CHECK-4** [AC-4]: ignore-entry cleanup verified against the exact files:
  `node scripts/check-leak.js package-lock.json && node scripts/check-leak.js
  scripts/review-bundle.manifest.json && ! grep -qE '^(package-lock\.json|scripts/review-bundle\.manifest\.json)$'
  .check-leak-ignore && grep -q '^scripts/check-leak\.test\.js$' .check-leak-ignore` → exit 0.
  If either scanner run exits non-zero, the corresponding entry MUST stay and this check is
  expected to be re-scoped only via a spec amendment (fail closed). (LSE-3, OQ4, S-6)
- **CHECK-5** [AC-5]: enforcement layer unchanged: `node --test scripts/check-leak-delta.test.js
  && bash scripts/check-leak-diff.sh origin/main` → exit 0. (INV-6)
- **CHECK-6** [AC-6]: whole-chain green, CI parity: `npm test` → exit 0. (INV-1, INV-6)

## Acceptance Criteria

- AC-1 ↔ CHECK-1: true-positive guarantee — every HIGH class still fires; replaced HIGH_BLOB
  red fixture is genuinely high-entropy; bare hex and near-miss shapes stay HIGH; recognized
  shapes downgrade to visible WARN.
- AC-2 ↔ CHECK-2: the real false-positive corpus scans clean (WARN-only) through the real
  scanner entry point.
- AC-3 ↔ CHECK-3: entropy threshold is corpus-derived with committed fixtures on both sides.
- AC-4 ↔ CHECK-4: ignore entries removed only against a proven-clean scanner run; test-fixture
  entry retained.
- AC-5 ↔ CHECK-5: delta gate and diff enforcement behavior unchanged.
- AC-6 ↔ CHECK-6: full test chain green (CI parity).

## Out of Scope (from the validated brief)

- The other HIGH detection classes (provider tokens, `secret-assignment`, JWT, bearer, etc.) —
  only `high-entropy-blob` and its severity/exemption logic change.
- `leak-ok` marker semantics and the `--strict` delta-gate contract in
  `scripts/check-leak-diff.sh`.
- The `.check-leak-ignore` *mechanism* (glob matching) — only the entries may shrink.
- CI workflow wiring (`.github/workflows/ci.yml`).
- Restoring the slash-joined keyword list in `specs/pipeline-loop-convergence.md` (the
  comma-separated rewording from `1d1eea0` stands).
- The WARN classes (email, private-ipv4).

## Entities

- `HIGH_BLOB`: the `high-entropy-blob` pattern (`check-leak.js:78`), currently length-only
  (`\b[A-Za-z0-9+/]{60,}={0,2}\b`), promoted into `HIGH`.
- `checksum-like context`: a key name matching `/integrity|sha(1|256|512)|checksum|digest/i` on
  the same line, or an explicit `sha256:`/`sha512-` value prefix (OQ2).
- `recognized checksum shape`: hex-only 40/64 chars with checksum-like context (key-position
  anchored, per A-1), or a `sha256:`/`sha512-`/`sha384-`-prefixed value — downgraded to WARN,
  never exempt (OQ1).
