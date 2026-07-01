# Install Profiles

Profiles define which harness layers are installed. The **tech-lead** agent selects a profile based on project analysis, and layers are assembled accordingly.

## Profile Definitions

These definitions transcribe the arrays in `scripts/init-harness.sh` — the script is the
behavior; this document describes it. If they disagree, the script wins and this table is stale.

| Profile     | Agents                                                        | Rules                                  | Hooks                        | Skills                                  |
|-------------|---------------------------------------------------------------|----------------------------------------|------------------------------|-----------------------------------------|
| `core`      | recruiter, tech-lead, reviewer                                | sycophancy, escalation, code-quality, human-validation | block-dangerous-commands     | —                                       |
| `developer` | core + implementer, qa, architect, kb-agent, planner          | core                                   | core + post-edit-lint        | tdd-workflow, kb-update, git-conventions |
| `security`  | developer + mcp-vetter, red-team-auditor                      | core                                   | developer                    | developer                               |
| `full`      | security + harness-builder, context-manager, project-auditor, skill-creator, tool-provisioner, performance-monitor, expert-debugger, config-migrator, kernel-arm64-bringup, fex-wine-proton, gamescope-mangohud-qam | core | developer | developer + ambiguity-auditor, code-quality-auditor, spec-compliance-auditor, harness-validator |

Profiles compose additively — each tier includes everything from the tier below it
(core ⊂ developer ⊂ security ⊂ full). The installer copies the same core rule set for every
profile; per-profile rule additions (detected language rules, security-audit) and KB bootstrap
are handled by the governor and kb-agent after install, not by `init-harness.sh`.

## Profile Selection

The tech-lead agent selects a profile using project analysis heuristics:

| Signal                                      | Suggested Profile |
|---------------------------------------------|-------------------|
| No CI, single language, < 5k LOC            | `core`            |
| CI present, test framework detected         | `developer`       |
| Secrets in repo, auth code, crypto deps     | `security`        |
| Explicit user request or enterprise config  | `full`            |

The tech-lead proposes the profile and the user confirms. The profile is recorded in `harness.json` under the `profile` field.

## Profile Switching

To switch profiles (e.g., `core` → `developer`):

1. **Diff** — Compute the difference between current and target profile layers.
2. **Add** — Install new agents, rules, hooks, skills, and KB components from the target.
3. **Remove** — Optionally remove components not in the target profile (with user confirmation).
4. **Update manifest** — Write the new profile to `harness.json`.

Switching never removes components silently. The tech-lead shows a diff summary:

```
Profile: core → developer

+ agents:  implementer, qa, architect, kb-agent, planner
+ rules:   ocaml-style (detected)
+ hooks:   post-edit-lint
+ skills:  tdd-workflow, kb-update, git-conventions
+ kb:      bootstrap proposed

- (nothing removed)

Apply? [y/n]
```

## Custom Overrides

Users can override any profile by editing `harness.json` directly. Custom additions are tracked with `source: custom` and are preserved across profile switches.
