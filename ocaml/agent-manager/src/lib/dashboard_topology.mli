(** Pipeline topology section for dashboard renderers.

    The topology deliberately separates declared ACL edges from future
    structured workflow edges. Natural-language pipeline_role text is rendered
    as metadata elsewhere and is not promoted into graph edges here. *)

type contract_state = Contract | Unknown
type node_id = private Node_id of Id.Workspace.t * Id.Agent.t
type edge_id = private Edge_id of Id.Workspace.t * Id.Agent.t
type focus = Node of node_id | Edge of edge_id

type node = {
  id : node_id;
  role : string;
  contract : contract_state;
  status : string;
}

type acl_edge = {
  workspace : Id.Workspace.t;
  from_agent : Id.Agent.t;
  readable : Id.Agent.t list;
  writable : Id.Agent.t list;
}

type t = { nodes : node list; declared_acl_edges : acl_edge list }

val empty : t
val node_id : workspace:Id.Workspace.t -> agent:Id.Agent.t -> node_id
val edge_id : workspace:Id.Workspace.t -> from_agent:Id.Agent.t -> edge_id
val node_workspace : node_id -> Id.Workspace.t
val node_agent : node_id -> Id.Agent.t
val edge_workspace : edge_id -> Id.Workspace.t
val edge_from_agent : edge_id -> Id.Agent.t
val equal_node_id : node_id -> node_id -> bool
val equal_edge_id : edge_id -> edge_id -> bool
val contract_to_string : contract_state -> string

val move :
  [ `Next | `Previous ] -> selected:node_id option -> t -> node_id option

val move_edge :
  [ `Next | `Previous ] -> selected:edge_id option -> t -> edge_id option

val edge_targets : edge_id -> t -> node_id list

val render :
  ?selected_edge:edge_id ->
  width:int ->
  focused:bool ->
  selected:node_id option ->
  t ->
  string list
