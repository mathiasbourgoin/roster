type create_agent
type connect_agents

type _ witness =
  | Can_create_agent : create_agent witness
  | Can_connect_agents : connect_agents witness

type t = Create_agent | Connect_agents

let of_string = function
  | "create-agent" -> Ok Create_agent
  | "connect-agents" -> Ok Connect_agents
  | value -> Error ("unknown agent capability: " ^ value)

let to_string = function
  | Create_agent -> "create-agent"
  | Connect_agents -> "connect-agents"

let equal left right =
  match (left, right) with
  | Create_agent, Create_agent | Connect_agents, Connect_agents -> true
  | Create_agent, Connect_agents | Connect_agents, Create_agent -> false

let compare left right =
  match (left, right) with
  | Create_agent, Create_agent | Connect_agents, Connect_agents -> 0
  | Create_agent, Connect_agents -> -1
  | Connect_agents, Create_agent -> 1

let grants capability capabilities = List.exists (equal capability) capabilities
let grants_create_agent = grants Create_agent
let grants_connect_agents = grants Connect_agents
