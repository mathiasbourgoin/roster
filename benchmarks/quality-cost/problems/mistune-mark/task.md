# Feature: add `==highlight==` ("mark") inline syntax to mistune's CORE parser

mistune (`src/mistune/`) is a Markdown parser. The default `mistune.html(text)` converts Markdown to
HTML using the core inline parser (`src/mistune/inline_parser.py` — it has a `SPECIFICATION` dict of
regexes, a `rules` list, and `parse_*` methods) and the default HTML renderer
(`src/mistune/renderers/html.py`).

Add support for `==text==` highlight syntax so the DEFAULT `mistune.html("==hi==")` renders the text
inside a `<mark>` element (e.g. `<p><mark>hi</mark></p>`).

Requirements:
- Implement it as a **core inline rule** in the default parser, so plain `mistune.html(...)` picks it
  up with NO extra configuration (do not require enabling a plugin).
- `==hi==` → `<mark>hi</mark>`; must also work mid-text (`a ==b== c`).
- A single `=` (e.g. `a = b`) must NOT be treated as a mark — it must render unchanged.
- The content inside `==...==` is itself inline-parsed (e.g. `==**b**==` →
  `<mark><strong>b</strong></mark>`).
- Do NOT break any existing parsing. The full test suite (`python -m pytest`) must pass.
