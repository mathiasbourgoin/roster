// Heuristic detection of AI-assisted commits/PRs from message trailers and
// authorship. VCS APIs never say "this is AI code", so we look for the
// fingerprints that popular coding tools leave behind.

export interface AiSignal {
  isAi: boolean;
  tool?: string;
}

// Ordered list: { tool label, matchers }. Matched case-insensitively against
// the commit message (incl. trailers), the author name, and the author email.
const RULES: { tool: string; patterns: RegExp[] }[] = [
  { tool: "Claude", patterns: [/co-authored-by:\s*claude/i, /generated with .*claude code/i, /\bclaude\b.*\bnoreply\b/i] },
  { tool: "GitHub Copilot", patterns: [/co-authored-by:\s*copilot/i, /\bcopilot\b.*@users\.noreply\.github\.com/i, /copilot-swe-agent/i] },
  { tool: "Cursor", patterns: [/co-authored-by:\s*cursor/i, /\bcursoragent\b/i, /generated with cursor/i] },
  { tool: "Windsurf", patterns: [/co-authored-by:\s*windsurf/i, /\bwindsurf\b.*codeium/i] },
  { tool: "Devin", patterns: [/co-authored-by:\s*devin/i, /devin-ai-integration/i] },
  { tool: "Aider", patterns: [/aider:/i, /co-authored-by:\s*aider/i] },
  { tool: "Gemini", patterns: [/co-authored-by:\s*gemini/i, /generated with gemini/i] },
  { tool: "Codex", patterns: [/co-authored-by:\s*codex/i, /\bchatgpt\b.*generated/i] },
];

// Generic catch-all trailers some setups add.
const GENERIC: RegExp[] = [
  /co-authored-by:\s*.*\bai\b.*<.*noreply/i,
  /\b(?:ai|agent)[- ]generated\b/i,
];

export function detectAi(parts: {
  message?: string | null;
  authorName?: string | null;
  authorEmail?: string | null;
}): AiSignal {
  const haystack = [parts.message, parts.authorName, parts.authorEmail]
    .filter(Boolean)
    .join("\n");
  if (!haystack) return { isAi: false };

  for (const rule of RULES) {
    if (rule.patterns.some((p) => p.test(haystack))) {
      return { isAi: true, tool: rule.tool };
    }
  }
  if (GENERIC.some((p) => p.test(haystack))) return { isAi: true, tool: "AI (generic)" };
  return { isAi: false };
}
