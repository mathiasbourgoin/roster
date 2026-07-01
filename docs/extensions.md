# Roster Extensions

Roster extensions package reusable capabilities that should live outside the core roster repository. They are local-path installs first: the installer reads the extension repository, projects supported runtime files, and records exactly what it changed in `.harness/extensions.json`.

This supports two extension shapes:

- Multi-skill workflow packs with examples, evals, and optional workflow tooling.
- Domain apparatus packs with one deep skill, profiles, project templates, and policies.

## Commands

Compile first:

```bash
npm run build:ts
```

Then inspect or install:

```bash
npm run extension -- info ~/dev/security-workflows
npm run extension -- install ~/dev/security-workflows
npm run extension -- info ~/dev/verification-apparatus
npm run extension -- install ~/dev/verification-apparatus
```

Use `--target <project-root>` to install into another roster-managed project. Use `--dry-run` to see the planned file set without writing.

## What Install Does

`install` reads `roster-extension.json` if present, otherwise falls back to `.claude-plugin/plugin.json` and layout inference.

Today it projects skill directories from:

```text
skills/<name>/SKILL.md
```

into the configured directory-based runtime targets:

```text
.agents/skills/<name>/
.opencode/skills/<name>/
```

When `.harness/harness.json` exists, only enabled runtimes are accepted and their configured project-local entrypoints are used. Without a harness manifest, the conventional paths above are used.

The installer preserves sibling resource files in the skill directory. It writes a `.roster-extension` marker inside each projected skill directory, but removal is driven by the explicit file list recorded in `.harness/extensions.json`.

Profiles, project templates, workflows, tools, hooks, and agents are recorded as extension components but not yet automatically projected. This keeps the first installer safe: it enables skill pack distribution without making assumptions about project-specific scaffolds or tool installation.

An extension with no skill components at all (for example a profiles-only pack) still installs as a recorded-only registry entry with an empty `installed_files` list: nothing is projected, but the pack is listed and version/commit-tracked by `converge`, which flags it with a `recorded_only` advisory (advisory alone keeps exit code 0).

Installation refuses to overwrite a runtime skill that is not already owned by the same registered extension. Reinstall and upgrade also stop if an installed file was locally modified.

## Converge

Run:

```bash
npm run extension -- converge
```

The converge check reports drift when:

- an installed file is missing,
- an installed file was edited after installation,
- an installed source file changed without reinstalling,
- the source extension version changed,
- the source extension git revision changed.

Use `--json` for machine-readable output.

The command exits non-zero when any extension reports `DRIFT`, so it can be used as a CI or preflight check.

## Remove

Run:

```bash
npm run extension -- remove security-workflows
```

Removal deletes only the files listed in `.harness/extensions.json` for that extension. It validates every file before deleting any of them, refuses locally modified files, rejects unmanaged targets, and refuses paths beneath symlinked runtime directories.

## Extension Manifests

See [`schema/extension-schema.md`](../schema/extension-schema.md). A minimal explicit manifest is:

```json
{
  "schema_version": "1.0",
  "name": "verification-apparatus",
  "version": "1.2.1",
  "type": "apparatus",
  "runtime_targets": ["codex"]
}
```

The `type` field is descriptive in schema v1. Installation behavior is driven by discovered components and supported runtime targets; future schema versions may add type-specific installation semantics.
