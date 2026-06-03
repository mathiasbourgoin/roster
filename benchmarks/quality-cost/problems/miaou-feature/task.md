# Feature task — add `normalize` to the chart utilities (miaou, OCaml)

You are working inside an existing OCaml project (**miaou**), a large terminal-UI toolkit built
with **dune** and multiple opam packages. Build the whole project with `make build` and run the
test suite with `make test` (it uses dune + alcotest). The toolchain and dependencies are already
installed in the active opam switch.

## What to implement

In the `miaou-core.widgets.display` library, the module **`Chart_utils`**
(`src/miaou_widgets_display/chart_utils.ml` and its interface `chart_utils.mli`) provides shared
helpers for chart widgets (`bounds`, `scale`, `format_value`, `nice_number`, …).

Add a new **public** function `normalize` with exactly this signature and documented semantics:

```ocaml
(** Normalize a list of floats to the [0., 1.] range using min-max scaling.
    Each value [x] maps to [(x -. lo) /. (hi -. lo)] where [lo] and [hi] are the
    minimum and maximum of the list.
    - the empty list maps to the empty list
    - if all values are equal ([hi = lo]), every value maps to [0.]
    Order and length are preserved. *)
val normalize : float list -> float list
```

- Implement it in `chart_utils.ml` and expose it in `chart_utils.mli`.
- Match the existing code style (the project is `ocamlformat`-formatted).
- **The project must still build (`make build`) and ALL existing tests must still pass
  (`make test`).** Do not break anything.

That is the whole task. When done, the feature is a single new public function used like
`Chart_utils.normalize [0.; 5.; 10.] = [0.; 0.5; 1.]`.
