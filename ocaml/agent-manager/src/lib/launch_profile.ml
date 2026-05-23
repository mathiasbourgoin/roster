type kind = Codex | Claude | OpenCode | Shell | Custom of string | Unknown

type t = {
  command : string list;
  cwd : string option;
  env : (string * string) list;
  startup_prompt : string option;
  kind : kind;
}

let of_executable = function
  | None -> Unknown
  | Some executable -> (
      match Filename.basename executable |> String.lowercase_ascii with
      | "codex" -> Codex
      | "claude" -> Claude
      | "opencode" -> OpenCode
      | "sh" -> Shell
      | executable -> Custom executable)

let of_parts ~command ~cwd ~env ~startup_prompt =
  {
    command;
    cwd;
    env;
    startup_prompt;
    kind = of_executable (List.find_opt (fun _ -> true) command);
  }

let of_command command =
  of_parts ~command ~cwd:None ~env:[] ~startup_prompt:None

let profile_label profile =
  match profile.kind with
  | Codex -> "Codex"
  | Claude -> "Claude"
  | OpenCode -> "OpenCode"
  | Shell -> "shell"
  | Custom executable -> executable
  | Unknown -> "unknown"

let short_command value =
  let limit = 64 in
  if String.length value <= limit then value
  else String.sub value 0 (limit - 3) ^ "..."

let effective_command profile =
  match profile.env with
  | [] -> profile.command
  | env ->
      "env"
      :: (List.map (fun (name, value) -> name ^ "=" ^ value) env
         @ profile.command)

let full_command_label profile =
  match profile.command with
  | [] -> "unknown command"
  | _ ->
      let command = effective_command profile |> Tmux.shell_command in
      let cwd =
        match profile.cwd with None -> [] | Some cwd -> [ "cwd " ^ cwd ]
      in
      let prompt =
        match profile.startup_prompt with
        | None -> []
        | Some _ -> [ "startup prompt" ]
      in
      String.concat " | " (cwd @ [ command ] @ prompt)

let compact_command_label profile =
  full_command_label profile |> short_command
