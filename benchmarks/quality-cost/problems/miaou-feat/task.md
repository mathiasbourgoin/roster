# Feature: Function-key (F1–F12) support in the terminal input parser

In the `miaou-core.driver-common` library, the module `Input_parser`
(`src/miaou_driver_common/input_parser.ml` / `.mli`) parses terminal escape sequences into a `key`
variant. It currently handles arrows, Home/End, PageUp/PageDown, Delete, Tab, mouse, etc. — but NOT
function keys. Add function-key support.

1. Add a constructor `Function of int` to the `key` type (the int is the function number, 1..12) —
   in BOTH `input_parser.mli` and `input_parser.ml`.
2. Parse the standard xterm sequences into `Function n` (`ESC` is the byte `0x1b`, written `\027`):
   - F1 = `ESC O P`, F2 = `ESC O Q`, F3 = `ESC O R`, F4 = `ESC O S`
   - F5 = `ESC [ 1 5 ~`, F6 = `ESC [ 1 7 ~`, F7 = `ESC [ 1 8 ~`, F8 = `ESC [ 1 9 ~`
   - F9 = `ESC [ 2 0 ~`, F10 = `ESC [ 2 1 ~`, F11 = `ESC [ 2 3 ~`, F12 = `ESC [ 2 4 ~`
   (F5..F12 use the CSI `~`-terminated numeric form; F1..F4 use the SS3 `ESC O` form.)
3. `key_to_string (Function n)` must return `"F" ^ string_of_int n` (e.g. `Function 5` → `"F5"`).
4. **Do not break any existing key parsing.** The project MUST build (`make build`) and the full
   test suite MUST pass (`make test`). Note the F-key numeric codes share the CSI numeric dispatch
   with Home (`ESC[1~`), PageUp (`ESC[5~`) etc. — integrate carefully.

Match the existing parser structure and code style.
