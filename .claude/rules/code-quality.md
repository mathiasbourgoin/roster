---
name: code-quality
description: Universal code quality limits — file length, function length, nesting, naming, dead code.
scope: global
category: style
version: 1.0.0
---

# Universal Code Quality Limits

## Size Limits

- **Max file length:** 500 lines (configurable). If a file exceeds this, split it by responsibility.
- **Max function length:** 50 lines (configurable). If a function exceeds this, extract sub-functions.
- **Max nesting depth:** 4 levels. Use early returns, guard clauses, or extracted functions to flatten.

## Structure

- No deep inheritance hierarchies. Prefer composition over inheritance.
- Functions should do one thing. If a function name requires "and", it does too much.

## Naming

- Names must be descriptive and reveal intent.
- No single-letter variables except: loop counters (`i`, `j`, `k`), coordinates (`x`, `y`, `z`), and well-known mathematical conventions.
- Avoid abbreviations unless they are universally understood in the domain (e.g., `ctx`, `cfg`, `db`).

## Dead Code

Scope dead-code removal to **your change**. Distinguish orphans you created from dead code that
was already there — deleting code you did not touch is an out-of-scope change (see `escalation.md`).

- **Your orphans → clean up.** Unused variables, imports, functions, or commented-out code that
  *your change* introduced or left behind must be removed before you finish. Version control exists.
- **Pre-existing dead code outside your task scope → flag, do not delete.** Note it (in the
  Friction Log, or a one-line note in your handoff/summary if you have no friction-log phase) so it
  can be handled deliberately; silently deleting it erases context you may not have and exceeds
  your task's scope.
- No TODO comments older than the current PR. File an issue instead and reference the issue number if needed.
- No unreachable code paths **introduced by your change**. If a branch you added can never execute, remove it.
