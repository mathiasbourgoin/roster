---
language: python
description: Good patterns and antipatterns for Python — type annotations, absence safety, and structured data.
version: 1.0.0
---

# Python Patterns

## Good Patterns

**Type annotations on all public functions**
```python
def find_user(user_id: UserId) -> Optional[User]: ...
```
Enables mypy/pyright to catch type mismatches before runtime.

**`Optional[T]` / `T | None` — explicit absence**
Never return `None` without declaring it in the return type. Callers must handle absence explicitly.

**`dataclasses` or `attrs` for structured data**
Replace `dict` with a typed `@dataclass`. Fields are named, typed, and IDE-navigable.

**`NewType` for domain values**
```python
from typing import NewType
UserId = NewType('UserId', str)
```
Prevents passing a raw string where a `UserId` is expected (caught by mypy).

**`enum.Enum` for categorical values**
```python
class Status(enum.Enum):
    ACTIVE = 'active'
    INACTIVE = 'inactive'
```
Not bare string constants scattered across the codebase.

**`match` statements for exhaustive handling (3.10+)**
Use structural pattern matching over long `if/elif` chains on discriminants.

**Custom exception types**
`class UserNotFoundError(ValueError): ...` instead of `raise ValueError("user not found")`. Callers can catch specific exceptions without parsing messages.

**Run `mypy --strict` in CI**
Strict mode catches `Any` leaks, missing annotations, and unreachable code.

---

## Antipatterns

**`dict` for structured data**
`{"user_id": ..., "name": ...}` has no schema, no autocompletion, no type checking. Use a dataclass.

**Bare `except:`**
Catches `KeyboardInterrupt`, `SystemExit`, and memory errors. Always specify: `except ValueError:` or at minimum `except Exception:`.

**Mutable default arguments**
```python
def append(item, lst=[]):  # shared across calls!
```
Use `None` as default, initialize inside the function.

**`# type: ignore` without explanation**
If mypy is wrong, explain why. If mypy is right, fix the code.

**Returning `None` without annotation**
Functions that sometimes return a value and sometimes return `None` silently break callers. Annotate with `Optional[T]`.

**String constants instead of enums**
`STATUS_ACTIVE = "active"` spread across modules — a typo is a silent runtime bug.

**`Any` in annotations**
Defeats the type checker. Narrow to the actual type or use `TypeVar` / `Protocol` for generics.

**Catching `Exception` and swallowing it**
```python
try:
    ...
except Exception:
    pass  # silent failure
```
Always log or re-raise.
