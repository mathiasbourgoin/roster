(** Lexical path normalization for config-derived workspace paths. *)

val normalize : string -> string
(** Normalize ".", "..", and duplicate separators without resolving symlinks. *)

val absolute : cwd:string -> string -> string
(** Make a path absolute against [cwd], then normalize it lexically. *)

val resolve : base:string -> string -> string
(** Resolve [path] against [base] when relative, then normalize it lexically. *)
