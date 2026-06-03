# Feature: group the SQL window-function `OVER` clause into the Function

sqlparse parses SQL into a token tree (`sqlparse.parse(sql)`). Currently a window expression like
`foo(c1) OVER (PARTITION BY c2 ORDER BY c3) AS bar` does NOT group the `OVER (...)` part into the
function token. Add support for this.

Requirements (match exactly so downstream code can rely on the structure):

1. Add a new token class `Over` to `sqlparse/sql.py`:
   ```python
   class Over(TokenList):
       """An OVER clause."""
       M_OPEN = T.Keyword, 'OVER'
   ```
2. In the grouping engine (`sqlparse/engine/grouping.py`):
   - Add a `group_over` step that groups the `OVER` keyword together with the **following**
     parenthesis or window name into an `Over` token.
   - Integrate with function grouping so that when a function `foo(...)` is immediately followed by
     an `Over` clause, the `Over` token becomes part of the enclosing `Function` token.
   - Register `group_over` in the grouping pipeline (before `group_functions`).
3. Resulting structure must be, for `parse("foo(c1) over (partition by c2 order by c3) as bar")[0]`:
   - `tokens[0]` is an `Identifier`
   - `tokens[0].tokens[0]` is a `Function` with exactly 4 child tokens
   - `tokens[0].tokens[0].tokens[3]` is an `Over`; its `.tokens[2]` is the `Parenthesis`
   - and for `parse("foo(c1) over win1 as bar")[0]`, that `Over`'s `.tokens[2]` is an `Identifier`
     (the window name `win1`).

Do NOT break any existing parsing or grouping behavior. The full test suite (`python -m pytest`)
must pass.
