# Install Profiles

Profiles define which harness layers are installed. The **tech-lead** agent selects a profile based on project analysis, and layers are assembled accordingly.

## Profile Definitions

| Profile     | Agents                                                        | Rules                                  | Hooks                        | Skills                                  | KB               |
|-------------|---------------------------------------------------------------|----------------------------------------|------------------------------|-----------------------------------------|------------------|
| `core`      | tech-lead, reviewer                                           | sycophancy, escalation                 | block-dangerous-commands     | —                                       | —                |
| `developer` | core + implementer, qa, architect, kb-agent                   | core + detected language rules         | core + post-edit-lint        | tdd-workflow, kb-update, git-conventions | bootstrap proposed |
| `security`  | developer + mcp-vetter                                        | developer + security-audit             | developer (secret-scan: not yet available) | (security-review: not yet available) | + security auditor |
| `full`      | all applicable                                                | all applicable                         | all                          | all                                     | bootstrap + all auditors |

Profiles are additive — each tier includes everything from the tier below it.

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

+ agents:  implementer, qa, architect, kb-agent
+ rules:   ocaml-style (detected)
+ hooks:   post-edit-lint
+ skills:  tdd-workflow, kb-update, git-conventions
+ kb:      bootstrap proposed

- (nothing removed)

Apply? [y/n]
```

## Custom Overrides

Users can override any profile by editing `harness.json` directly. Custom additions are tracked with `source: custom` and are preserved across profile switches.
