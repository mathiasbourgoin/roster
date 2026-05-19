---
language: rust
description: Good patterns and antipatterns for Rust — type safety, error handling, and effect boundaries.
version: 1.0.0
---

# Rust Patterns

## Good Patterns

**Newtype pattern for domain values**
Wrap primitives in single-field structs: `struct UserId(Uuid)`. Prevents mixing incompatible IDs and enables `impl` blocks for domain logic.

**`Result<T, E>` everywhere; `?` for propagation**
Return `Result` for any fallible operation. Use `?` to propagate errors up the call stack. Define error types with `thiserror`.

**`Option<T>` instead of sentinel values**
Never use `-1`, `""`, or `0` to signal absence. Return `Option<T>` and let the caller handle `None`.

**Immutable by default**
`let x = ...` not `let mut x = ...` unless mutation is necessary. Prefer functional transformations (`map`, `filter`, `collect`) over mutating loops.

**Enums with data for sum types**
`enum Command { Quit, Move { x: i32, y: i32 }, Write(String) }` is better than a struct with multiple optional fields and a discriminant int.

**`clippy` as part of CI; treat warnings as errors**
`#![deny(warnings, clippy::all)]` in lib/bin crates. Clippy catches a large class of correctness and style issues automatically.

**`thiserror` for library errors, `anyhow` for application errors**
Library crates expose typed errors callers can match on. Application crates use `anyhow` for ergonomic error propagation without exposing type details.

**Derive `Debug`, `Clone`, `PartialEq` where appropriate**
Derive them by default for data types. Only hand-implement when the derived version is wrong.

---

## Antipatterns

**`unwrap()` or `expect()` outside tests**
Panics in production. Use `?`, `map_err`, or explicit `match`. `expect()` with a message is acceptable only if the invariant is truly impossible to violate — document why.

**`clone()` as a band-aid**
Cloning to silence the borrow checker often hides a design problem. Understand the ownership before cloning.

**`Arc<Mutex<T>>` for everything**
Default to single-threaded ownership. Reach for `Arc<Mutex>` only when shared mutable state across threads is genuinely needed.

**`String` / `Vec<u8>` for typed domain values**
`fn create_user(id: String, name: String)` makes it trivial to swap arguments silently. Use newtypes.

**`todo!()` or `panic!()` in non-test production paths**
These are deferred bugs. Return an error type instead.

**`unsafe` without a documented invariant**
Every `unsafe` block must have a comment explaining exactly which invariant the programmer is manually upholding and why the compiler cannot verify it.

**Ignoring `Result` with `let _ = ...`**
Silently discards errors. Either propagate with `?` or handle explicitly.

**Large `impl` blocks mixing pure logic and I/O**
Keep I/O-free methods separate from methods that call `tokio`, `std::fs`, etc. Makes testing easier.
