type state
type config
type 'kind candidate = { path : string; purpose : string }

type source =
  | State of { path : string; explicit : bool }
  | Config of { path : string; explicit : bool }
  | Missing

let default_state_path = ".ta-state.json"
let default_config_path = ".harness/ta.json"

let state_candidates =
  [
    { path = default_state_path; purpose = "workspace state snapshot" };
    { path = ".harness/ta-state.json"; purpose = "harness state snapshot" };
    { path = "ta-state.json"; purpose = "plain state snapshot" };
  ]

let config_candidates =
  [
    { path = default_config_path; purpose = "workspace TA config" };
    { path = "ta.json"; purpose = "workspace TA config" };
    {
      path = "examples/ta.example.json";
      purpose = "agent-manager source-tree example";
    };
    {
      path = "ocaml/agent-manager/examples/ta.example.json";
      purpose = "agent-roster source-tree example";
    };
  ]

let first_existing exists candidates =
  List.find_opt (fun candidate -> exists candidate.path) candidates

let first_config_path ~exists =
  first_existing exists config_candidates |> Option.map (fun candidate -> candidate.path)

let resolve ~exists ?state_path ?config_path () =
  match (state_path, config_path) with
  | Some path, _ -> State { path; explicit = true }
  | None, Some path -> Config { path; explicit = true }
  | None, None -> (
      match first_existing exists state_candidates with
      | Some candidate -> State { path = candidate.path; explicit = false }
      | None -> (
          match first_existing exists config_candidates with
          | Some candidate -> Config { path = candidate.path; explicit = false }
          | None -> Missing))

let describe_candidates candidates =
  candidates
  |> List.map (fun candidate -> candidate.path ^ " (" ^ candidate.purpose ^ ")")
  |> String.concat ", "
