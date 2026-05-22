type contract_state = Contract | Unknown
type node_id = Node_id of Id.Workspace.t * Id.Agent.t

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
let node_workspace (Node_id (workspace, _)) = workspace
let node_agent (Node_id (_, agent)) = agent

let equal_node_id left right =
  Id.Workspace.equal (node_workspace left) (node_workspace right)
  && Id.Agent.equal (node_agent left) (node_agent right)

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

let acl_line edge =
  Printf.sprintf "  ACL %s/%s -> read %s | write %s"
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

let render ~width ~focused ~selected topology =
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
    | edges -> List.map acl_line edges
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
