export type ComponentType = "agent" | "skill" | "rule" | "hook" | "kb" | "other";

export type IndexEntry = {
  name: string;
  display_name: string;
  description: string;
  domain: string[];
  tags: string[];
  model: string;
  complexity: string;
  compatible_with: string[];
  version: string;
  path: string;
  source: "local" | "remote";
  source_id: string;
  source_repo: string;
  component_type: ComponentType;
};

export type RemoteSource = {
  id: string;
  repo: string;
  branch?: string;
  seed_files: string[];
  include_patterns: string[];
  exclude_patterns?: string[];
};

export type SourceCache = {
  source_id: string;
  source_repo: string;
  built_at: string;
  source_fingerprint?: string;
  entries: IndexEntry[];
};
