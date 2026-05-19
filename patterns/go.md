---
language: go
description: Good patterns and antipatterns for Go — explicit errors, small interfaces, and safe concurrency.
version: 1.0.0
---

# Go Patterns

## Good Patterns

**Explicit error handling — never ignore `err`**
```go
result, err := doSomething()
if err != nil {
    return fmt.Errorf("doSomething: %w", err)
}
```
Wrap errors with `%w` to preserve the chain for `errors.Is` / `errors.As`.

**Small interfaces**
Define interfaces at the point of use, with only the methods actually needed. `io.Reader` (1 method) is better than a 10-method interface that forces mock complexity.

**Return errors as values, not panics**
`panic` is for unrecoverable programmer errors (invariant violations). Expected failures return `error`.

**`errors.Is` / `errors.As` for error inspection**
Never compare error strings. Use sentinel errors (`var ErrNotFound = errors.New(...)`) and `errors.Is`.

**`context.Context` as first argument for cancellation and deadlines**
Any function that does I/O or may block should accept `ctx context.Context` as its first parameter.

**Table-driven tests**
```go
tests := []struct{ input string; want int }{ ... }
for _, tt := range tests { ... }
```
Reduces duplication and makes adding cases trivial.

**Typed domain wrappers**
```go
type UserID string
```
A named type prevents accidental mixing even though the underlying type is the same.

**`defer` for cleanup, not control flow**
Use `defer f.Close()` immediately after acquiring a resource. Do not use `defer` to implement complex branching logic.

---

## Antipatterns

**Swallowed errors**
```go
result, _ = doSomething()  // error silently discarded
```
Every error must be handled or explicitly propagated.

**`interface{}` / `any` instead of concrete types**
Loses type safety and forces runtime type assertions. Define the actual interface or type.

**Global mutable state**
Package-level `var` that is mutated by multiple goroutines without synchronization is a data race. Use dependency injection instead.

**Goroutine leaks**
Spawning a goroutine without a clear termination condition (context cancellation, channel close) leaks memory. Always define the exit path before launching.

**Panic in library code**
Library functions should return errors, not panic. Panics in libraries crash the caller's program unexpectedly.

**Returning concrete types instead of interfaces**
`func NewRepo() *PostgresRepo` forces callers to depend on the implementation. Return an interface when the caller only needs the behavior.

**Long functions with many responsibilities**
Go's lack of generics (pre-1.18) historically led to copy-paste; prefer extracting helpers even if it means more files.

**Ignoring `context` cancellation**
Not checking `ctx.Err()` in long loops means the goroutine keeps running after the caller has given up.
