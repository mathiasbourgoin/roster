(** Parser and validator for TA workspace configuration.

    The canonical project file is [.harness/ta.json]. Source repositories may
    carry examples elsewhere, but runtime consumers should prefer the harness
    path when it exists. *)

type error = { path : string; message : string }
type view = { id : Id.View.t; label : string }

type agent = {
  name : Id.Agent.t;
  roster_agent : string;
  command : string list;
  cwd : string option;
  env : (string * string) list;
  capabilities : Agent_capability.t list;
  startup_prompt : string option;
}

type link = {
  from_agent : Id.Agent.t;
  to_agent : Id.Agent.t;
  permissions : Permission.t list;
  reason : string;
}

type workspace = {
  id : Id.Workspace.t;
  label : string;
  root : string;
  harness_path : string option;
  tmux_session : Tmux.session;
  default_view : Id.View.t;
  views : view list;
  agents : agent list;
  links : link list;
}

type t = { version : string; workspaces : workspace list }

val parse_string : string -> (t, error list) result
val load : string -> (t, error list) result
val to_yojson : t -> Yojson.Safe.t
val to_string : t -> string
val validate : t -> error list
val validate_with_roster : roster:Roster_index.t -> t -> error list
val summarize : t -> string
val error_to_string : error -> string
