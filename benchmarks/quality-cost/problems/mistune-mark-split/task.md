# Three tasks — complete them IN THIS ORDER

## Task 1
Add `==text==` highlight ("mark") inline syntax to mistune's CORE inline parser
(`src/mistune/inline_parser.py` — `SPECIFICATION` dict, `rules` list, a `parse_*` method) plus the
HTML renderer (`src/mistune/renderers/html.py`), so the DEFAULT `mistune.html("==hi==")` renders the
text inside a `<mark>` element. `==hi==` → `<mark>hi</mark>`; works mid-text (`a ==b== c`); a single
`=` (`a = b`) is NOT a mark; the content is inline-parsed (`==**b**==` → `<mark><strong>b</strong></mark>`).

## Task 2 (unrelated)
Add clear, accurate docstrings to every public method of the HTML renderer class in
`src/mistune/renderers/html.py` that currently lacks one. Describe what each renders. Do NOT change
any behavior.

## Task 3
Make `==mark==` round-trip: in the Markdown renderer (`src/mistune/renderers/markdown.py`), render a
`mark` token back to `==...==`, so that parse → markdown-render → parse is stable.

Do NOT break existing behavior. The full test suite (`python -m pytest`) must pass when done.
