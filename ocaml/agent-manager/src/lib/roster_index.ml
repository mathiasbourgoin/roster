type entry = {
  name : string;
  display_name : string option;
  description : string option;
  domain : string list;
  tags : string list;
  model : string option;
  complexity : string option;
  compatible_with : string list;
  version : string option;
  author : string option;
  isolation : string option;
  pipeline_role : Roster_pipeline_role.t option;
  path : string option;
  source : string option;
}

type t = { agents : entry list }
type error = { path : string; message : string }

let empty = { agents = [] }
let error path message = { path; message }
let fail path message = Error [ error path message ]
let error_to_string { path; message } = path ^ ": " ^ message
let ( let* ) = Result.bind

let object_fields path = function
  | `Assoc fields -> Ok fields
  | _ -> fail path "expected object"

let string_field path name fields =
  match List.assoc_opt name fields with
  | Some (`String value) -> Ok value
  | Some _ -> fail (path ^ "." ^ name) "expected string"
  | None -> fail (path ^ "." ^ name) "missing required field"

let optional_string_field path name fields =
  match List.assoc_opt name fields with
  | None -> Ok None
  | Some (`String value) -> Ok (Some value)
  | Some _ -> fail (path ^ "." ^ name) "expected string"

let optional_string_list_field path name fields =
  match List.assoc_opt name fields with
  | None -> Ok []
  | Some (`List values) ->
      let rec loop idx acc = function
        | [] -> Ok (List.rev acc)
        | `String value :: rest -> loop (idx + 1) (value :: acc) rest
        | _ :: _ ->
            fail
              (path ^ "." ^ name ^ "[" ^ string_of_int idx ^ "]")
              "expected string"
      in
      loop 0 [] values
  | Some _ -> fail (path ^ "." ^ name) "expected string list"

let component_type fields =
  match List.assoc_opt "component_type" fields with
  | Some (`String value) -> Some value
  | _ -> None

let parse_entry path json =
  let* fields = object_fields path json in
  match component_type fields with
  | Some "agent" ->
      let* name = string_field path "name" fields in
      let* display_name = optional_string_field path "display_name" fields in
      let* description = optional_string_field path "description" fields in
      let* domain = optional_string_list_field path "domain" fields in
      let* tags = optional_string_list_field path "tags" fields in
      let* model = optional_string_field path "model" fields in
      let* complexity = optional_string_field path "complexity" fields in
      let* compatible_with =
        optional_string_list_field path "compatible_with" fields
      in
      let* version = optional_string_field path "version" fields in
      let* author = optional_string_field path "author" fields in
      let* isolation = optional_string_field path "isolation" fields in
      let* path_value = optional_string_field path "path" fields in
      let* source = optional_string_field path "source" fields in
      Ok
        (Some
           {
             name;
             display_name;
             description;
             domain;
             tags;
             model;
             complexity;
             compatible_with;
             version;
             author;
             isolation;
             pipeline_role = None;
             path = path_value;
             source;
           })
  | _ -> Ok None

let parse_array json =
  match json with
  | `List values ->
      let rec loop idx acc = function
        | [] -> Ok { agents = List.rev acc }
        | value :: rest -> (
            match parse_entry ("$[" ^ string_of_int idx ^ "]") value with
            | Ok None -> loop (idx + 1) acc rest
            | Ok (Some entry) -> loop (idx + 1) (entry :: acc) rest
            | Error errors -> Error errors)
      in
      loop 0 [] values
  | _ -> fail "$" "expected index array"

let parse_string text =
  match Yojson.Safe.from_string text with
  | json -> parse_array json
  | exception Yojson.Json_error message -> fail "$" ("invalid JSON: " ^ message)

let read_file path =
  match open_in path with
  | exception Sys_error message -> fail path message
  | channel ->
      Fun.protect
        ~finally:(fun () -> close_in_noerr channel)
        (fun () ->
          let buffer = Buffer.create 4096 in
          let bytes = Bytes.create 4096 in
          let rec loop () =
            match input channel bytes 0 (Bytes.length bytes) with
            | 0 -> Ok (Buffer.contents buffer)
            | read ->
                Buffer.add_subbytes buffer bytes 0 read;
                loop ()
          in
          match loop () with
          | Ok text -> Ok text
          | Error _ as error -> error
          | exception Sys_error message -> fail path message)

let load path =
  let* text = read_file path in
  parse_string text

let is_safe_relative_path path =
  Filename.is_relative path
  && not
       (List.exists
          (fun segment -> String.equal segment Filename.parent_dir_name)
          (String.split_on_char Filename.dir_sep.[0] path))

let metadata_path ~root path = Filename.concat root path

let overlay_scalar key current frontmatter =
  match Roster_frontmatter.find_scalar key frontmatter with
  | Some value when not (String.equal value "") -> Some value
  | _ -> current

let overlay_list key current frontmatter =
  match Roster_frontmatter.find_list key frontmatter with
  | Some values when values <> [] -> values
  | _ -> current

let name_matches entry frontmatter =
  match Roster_frontmatter.find_scalar "name" frontmatter with
  | Some name -> String.equal name entry.name
  | None -> false

let overlay_pipeline_role current text =
  match Roster_pipeline_role.parse_string text with
  | Some pipeline_role -> Some pipeline_role
  | None -> current

let enrich_entry_from_frontmatter ~root (entry : entry) =
  match (entry.source, entry.path) with
  | Some source, Some path
    when String.equal source "local" && is_safe_relative_path path -> (
      let metadata_path = metadata_path ~root path in
      match Roster_frontmatter.read_file metadata_path with
      | Error _ -> entry
      | Ok text -> (
          match Roster_frontmatter.parse_string text with
          | None -> entry
          | Some frontmatter when not (name_matches entry frontmatter) -> entry
          | Some frontmatter ->
              {
                entry with
                display_name =
                  overlay_scalar "display_name" entry.display_name frontmatter;
                description =
                  overlay_scalar "description" entry.description frontmatter;
                domain = overlay_list "domain" entry.domain frontmatter;
                tags = overlay_list "tags" entry.tags frontmatter;
                model = overlay_scalar "model" entry.model frontmatter;
                complexity =
                  overlay_scalar "complexity" entry.complexity frontmatter;
                compatible_with =
                  overlay_list "compatible_with" entry.compatible_with
                    frontmatter;
                version = overlay_scalar "version" entry.version frontmatter;
                author = overlay_scalar "author" entry.author frontmatter;
                isolation =
                  overlay_scalar "isolation" entry.isolation frontmatter;
                pipeline_role = overlay_pipeline_role entry.pipeline_role text;
              }))
  | _ -> entry

let enrich_from_frontmatter ~root index =
  { agents = List.map (enrich_entry_from_frontmatter ~root) index.agents }

let mem_agent index name =
  List.exists (fun entry -> String.equal entry.name name) index.agents

let find_agent index name =
  List.find_opt (fun entry -> String.equal entry.name name) index.agents

let agents index = index.agents
