type agent = {
  workspace : Id.Workspace.t;
  name : Id.Agent.t;
  roster_agent : string;
  command : string list;
  cwd : string;
  env : (string * string) list;
  startup_prompt : string option;
  planned_pane : Id.Pane.t;
  tmux_target : string;
}

type workspace = {
  id : Id.Workspace.t;
  session : Tmux.session;
  root : string;
  agents : agent list;
}

type t = { workspaces : workspace list }

let resolve_path ~base path =
  if Filename.is_relative path then
    match (base, path) with
    | ".", "." -> "."
    | _, "." -> base
    | ".", path -> path
    | base, path -> Filename.concat base path
  else path

let effective_cwd ~(root : string) = function
  | None -> root
  | Some "." -> root
  | Some cwd when Filename.is_relative cwd -> Filename.concat root cwd
  | Some cwd -> cwd

let planned_pane workspace agent =
  Id.Pane.unsafe_of_string
    (Id.Workspace.to_string workspace ^ "%" ^ Id.Agent.to_string agent)

let tmux_target session pane_index =
  Printf.sprintf "%s:0.%d" (Tmux.session_to_string session) pane_index

let plan_agent workspace pane_index (agent : Workspace_config.agent) =
  {
    workspace = workspace.Workspace_config.id;
    name = agent.name;
    roster_agent = agent.roster_agent;
    command = agent.command;
    cwd = effective_cwd ~root:workspace.root agent.cwd;
    env = agent.env;
    startup_prompt = agent.startup_prompt;
    planned_pane = planned_pane workspace.id agent.name;
    tmux_target = tmux_target workspace.tmux_session pane_index;
  }

let plan_workspace ~config_dir (workspace : Workspace_config.workspace) =
  let root = resolve_path ~base:config_dir workspace.root in
  let workspace = { workspace with root } in
  {
    id = workspace.id;
    session = workspace.tmux_session;
    root = workspace.root;
    agents = List.mapi (plan_agent workspace) workspace.agents;
  }

let of_config ?(config_dir = ".") config =
  match Workspace_config.validate config with
  | [] ->
      Ok
        { workspaces = List.map (plan_workspace ~config_dir) config.workspaces }
  | errors -> Error errors

let agent_count plan =
  List.fold_left
    (fun count workspace -> count + List.length workspace.agents)
    0 plan.workspaces

let env_to_string = function
  | [] -> "-"
  | env ->
      env
      |> List.map (fun (name, value) -> name ^ "=" ^ value)
      |> String.concat ","

let command_to_string command = String.concat " " command
let prompt_to_string = function None -> "-" | Some prompt -> prompt

let describe_agent agent =
  [
    Printf.sprintf "  - %s pane=%s target=%s roster=%s"
      (Id.Agent.to_string agent.name)
      (Id.Pane.to_string agent.planned_pane)
      agent.tmux_target agent.roster_agent;
    "    cwd=" ^ agent.cwd;
    "    command=" ^ command_to_string agent.command;
    "    env=" ^ env_to_string agent.env;
    "    startup_prompt=" ^ prompt_to_string agent.startup_prompt;
  ]

let describe_workspace workspace =
  [
    Printf.sprintf "Workspace %s session=%s root=%s"
      (Id.Workspace.to_string workspace.id)
      (Tmux.session_to_string workspace.session)
      workspace.root;
  ]
  @ List.concat_map describe_agent workspace.agents

let describe plan =
  let header =
    Printf.sprintf "TA launch plan: %d workspace(s), %d agent(s)"
      (List.length plan.workspaces)
      (agent_count plan)
  in
  String.concat "\n"
    (header :: List.concat_map describe_workspace plan.workspaces)
