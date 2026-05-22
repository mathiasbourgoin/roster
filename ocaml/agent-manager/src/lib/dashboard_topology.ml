type contract_state = Contract | Unknown
type node_id = Node_id of Id.Workspace.t * Id.Agent.t
type edge_id = Edge_id of Id.Workspace.t * Id.Agent.t
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

let empty = { nodes = []; declared_acl_edges = [] }
let node_id ~workspace ~agent = Node_id (workspace, agent)
let edge_id ~workspace ~from_agent = Edge_id (workspace, from_agent)
let node_workspace (Node_id (workspace, _)) = workspace
let node_agent (Node_id (_, agent)) = agent
let edge_workspace (Edge_id (workspace, _)) = workspace
let edge_from_agent (Edge_id (_, agent)) = agent

let equal_node_id left right =
  Id.Workspace.equal (node_workspace left) (node_workspace right)
  && Id.Agent.equal (node_agent left) (node_agent right)

let equal_edge_id left right =
  Id.Workspace.equal (edge_workspace left) (edge_workspace right)
  && Id.Agent.equal (edge_from_agent left) (edge_from_agent right)

let contract_to_string = function
  | Contract -> "contract"
  | Unknown -> "unknown"

let fit width value =
  let length = String.length value in
  if width <= 0 then ""
  else if length = width then value
  else if length < width then value ^ String.make (width - length) ' '
  else if width <= 3 then String.sub value 0 width
  else String.sub value 0 (width - 3) ^ "..."

let join_agent_ids = function
  | [] -> "-"
  | agents -> agents |> List.map Id.Agent.to_string |> String.concat ","

let selected_node selected node =
  match selected with
  | Some selected -> equal_node_id selected node.id
  | None -> false

let node_line ~focused ~selected node =
  Printf.sprintf "%s %-9s %-12s %-22s %-11s status %s"
    (if focused && selected_node selected node then ">" else " ")
    (fit 9 (Id.Workspace.to_string (node_workspace node.id)))
    (fit 12 (Id.Agent.to_string (node_agent node.id)))
    (fit 22 node.role)
    (fit 11 (contract_to_string node.contract))
    node.status

let edge_id_of_edge edge =
  edge_id ~workspace:edge.workspace ~from_agent:edge.from_agent

let selected_edge selected edge =
  match selected with
  | Some selected -> equal_edge_id selected (edge_id_of_edge edge)
  | None -> false

let acl_line ~focused ~selected edge =
  Printf.sprintf "%s ACL %s/%s -> read %s | write %s"
    (if focused && selected_edge selected edge then ">" else " ")
    (Id.Workspace.to_string edge.workspace)
    (Id.Agent.to_string edge.from_agent)
    (join_agent_ids edge.readable)
    (join_agent_ids edge.writable)

let move direction ~selected topology =
  match topology.nodes with
  | [] -> None
  | first :: _ -> (
      let ids = List.map (fun node -> node.id) topology.nodes in
      match selected with
      | None -> Some first.id
      | Some selected ->
          let rec loop previous = function
            | [] -> (
                match direction with
                | `Next -> Some first.id
                | `Previous -> previous)
            | node :: rest ->
                if equal_node_id node.id selected then
                  match direction with
                  | `Next -> (
                      match rest with
                      | next :: _ -> Some next.id
                      | [] -> Some first.id)
                  | `Previous -> (
                      match previous with
                      | Some previous -> Some previous
                      | None -> List.rev ids |> List.find_opt (fun _ -> true))
                else loop (Some node.id) rest
          in
          loop None topology.nodes)

let move_edge direction ~selected topology =
  match topology.declared_acl_edges with
  | [] -> None
  | first :: _ -> (
      let ids = List.map edge_id_of_edge topology.declared_acl_edges in
      match selected with
      | None -> Some (edge_id_of_edge first)
      | Some selected ->
          let rec loop previous = function
            | [] -> (
                match direction with
                | `Next -> Some (edge_id_of_edge first)
                | `Previous -> previous)
            | edge :: rest ->
                let id = edge_id_of_edge edge in
                if equal_edge_id id selected then
                  match direction with
                  | `Next -> (
                      match rest with
                      | next :: _ -> Some (edge_id_of_edge next)
                      | [] -> Some (edge_id_of_edge first))
                  | `Previous -> (
                      match previous with
                      | Some previous -> Some previous
                      | None -> List.rev ids |> List.find_opt (fun _ -> true))
                else loop (Some id) rest
          in
          loop None topology.declared_acl_edges)

let find_edge id topology =
  List.find_opt
    (fun edge -> equal_edge_id id (edge_id_of_edge edge))
    topology.declared_acl_edges

let edge_targets id topology =
  match find_edge id topology with
  | None -> []
  | Some edge ->
      edge.readable @ edge.writable
      |> List.sort_uniq Id.Agent.compare
      |> List.map (fun agent -> node_id ~workspace:edge.workspace ~agent)

let render ?selected_edge ~width ~focused ~selected topology =
  let title =
    if focused then "Pipeline overview [focus]" else "Pipeline overview"
  in
  let nodes =
    match topology.nodes with
    | [] -> [ "  none" ]
    | nodes -> List.map (node_line ~focused ~selected) nodes
  in
  let acl_edges =
    match topology.declared_acl_edges with
    | [] -> [ "  none" ]
    | edges -> List.map (acl_line ~focused ~selected:selected_edge) edges
  in
  [
    title;
    fit width
      "  WORKSPACE AGENT        ROSTER ROLE            CONTRACT    STATUS";
  ]
  @ nodes
  @ [
      "  Edge categories: declared-acl, structured-workflow";
      "  ACL edges (declared links, not inferred workflow order)";
    ]
  @ acl_edges
  @ [ "  structured-workflow: none (pipeline_role prose is not inferred)" ]
  |> List.map (fit width)
