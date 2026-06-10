# Research — Dynamic skill routing for roster

_Generated: 2026-06-06 · branch `next` (VERSION 2.7.0)_
_Mode: full (3 parallel research agents: academic papers, industry/blogs, roster self-map)_
_Question: Is a cheap-model/retrieval orchestrator that selects a relevant skill subset per task — instead of loading all skills into context — a sound idea? What does the field know? What does roster already have?_

---

## TL;DR

The idea is **well-founded, well-precedented, and the problem it solves is empirically severe.** The pattern
has a name — **dynamic tool/skill routing** — and the top framework (LangChain's `langgraph-bigtool`),
a recent paper targeting exactly Claude Code / Codex / OpenClaw (`SkillRouter`, arXiv:2603.22455, 80K
skills, March 2026), and strong academic evidence that context bloat from tool overload causes 7–85%
performance degradation. Roster already has most of the building blocks.

**The one non-obvious constraint the field has converged on:** routing accuracy is much better on full
skill text than on name + description alone. Hiding the skill body (using only metadata) causes a
**31–44 percentage point drop** in Hit@1 (SkillRouter). The index needs enough content to be useful —
but that content lives in a database queried by code, not loaded into the LLM's context. The two halves
must stay separate.

**Concrete options ranked for roster:**

| Option | Router | Index | Cost/query | Est. Hit@1 | Roster build effort |
|---|---|---|---|---|---|
| **A. Hybrid vector+keyword** | none (code) | LanceDB over `when_to_use` + first 200 chars of skill body | ~0 (no model call) | ~65–75% | small (adapt kb-search) |
| **B. A + cheap LLM rerank** | Haiku / GPT-4o-mini | same | ~$0.0001 | ~80–85% | small–medium |
| **C. A + local model rerank** | Qwen2.5 0.5B or Llama3.2 3B (ollama) | same | $0 (local) | ~74–80% | medium |
| **D. Full SkillRouter** (fine-tuned bi-encoder+reranker) | 0.6B fine-tuned model | full skill text | ~0 | **74–76% Hit@1** at 80K skills | large (requires training) |

For roster's current scale (34 skills, realistic deployment 10–20 installed), **Option A alone will
perform well**. Option B adds meaningful accuracy for the rare ambiguous case. Option D is overkill
until the skill registry reaches thousands of entries.

---

## 1. Why the problem is real: the empirical evidence

**OpenAI's own cap:** "Developers typically see a reduction in the model's ability to select the correct
tool once they have between 10–20 tools defined." Semantic Kernel docs cite this directly.

**LongFuncEval (arXiv:2505.10570):** 7 frontier models (GPT-4o, Llama-3.1-70B, Mistral-Large…) tested
as tool catalog grew from 8K to 120K tokens. Performance drops ranged from **7.59% to 85.58%**. Mistral
degrades up to 94% and hallucinates function names entirely at 120K tokens.

**Context length ≠ context quality (arXiv:2510.05381):** Even with perfect retrieval (>90% recall),
adding distractor tokens causes Llama-3.1-8B to lose 24% on MMLU and 85% on variable summation at 30K
tokens. The degradation survives even when distractors are masked from attention — it's a training
distribution issue, not just noise.

**WorkBench benchmark (arXiv:2405.00823):** GPT-4 given all 26 tools: 43% accuracy. Given only required
tools: 49%. Six percentage points lost to tool-set contamination alone — at only 26 tools.

**Lost-in-the-middle applied to tools:** Liu et al. (2024) found 30%+ accuracy drop when relevant
content moved from position 1 to position 10 in a 20-document context. Tool schemas injected linearly
into a system prompt suffer the same U-shaped attention bias from RoPE position encoding.

**Context rot is universal (Chroma/Morph, 2025):** every frontier model tested (GPT-4.1, Claude Opus 4,
Gemini 2.5 Pro, Qwen3) performs worse as context grows. Doubling task duration quadruples failure rate.

**MCP as forcing function:** a single Playwright MCP server was measured consuming **22.2% of Claude
Sonnet 4's 200K token context window**. RAG-MCP is the direct community response to MCP tool explosion.

---

## 2. What the field has built: the solution landscape

All approaches share the same shape: **route first (cheap) → load relevant subset → call main model**.

### 2.1 Frameworks with shipping implementations

**LangChain `langgraph-bigtool`** (Jan 2025) — the most direct analogue:
- Tools indexed in LangGraph's persistence layer using `text-embedding-3-small`
- A single meta-tool `retrieve_tools` exposed to the agent; it returns a ranked list of tool IDs on demand
- `retrieve_tools_function` / `retrieve_tools_coroutine` are customizable (bring your own retriever)
- No benchmark data published; stated target "hundreds or thousands of tools"
- Source: https://github.com/langchain-ai/langgraph-bigtool

**LlamaIndex `ObjectIndex` + `ObjectRetriever`** — wraps a `VectorStoreIndex` over `Tool` objects;
demonstrated on 1 real + 28 distractor tools. Explicit framing: "removes complexity of too many
functions to fit in prompt."
Source: https://developers.llamaindex.ai/python/examples/agent/openai_agent_retrieval/

**smolagents**: no built-in routing; toolsets are static lists passed at construction. The gap is
deliberate (minimalist library) and is where the community is building.

### 2.2 The key academic paper: SkillRouter (arXiv:2603.22455, March 2026)

This is the most directly relevant paper to roster's situation — it explicitly targets Claude Code,
Codex, and OpenClaw as motivation.

**Scale:** ~80,000 skills. **Architecture:** two-stage:
1. **SR-Emb-0.6B** (fine-tuned bi-encoder, hard-negative mining + 3-layer false-negative filtering):
   offline-embeds full skill text → ANN retrieves top-20 candidates
2. **SR-Rank-0.6B** (fine-tuned cross-encoder, listwise cross-entropy): re-scores (query, top-20)
   jointly → returns ranked subset

**The single most important finding for roster:**
> *"Hiding skill implementation bodies (using only name + description) causes a 31–44 percentage point
> drop in routing accuracy across all retrieval methods (sparse, dense, reranker)."*

This means: a routing index built only on frontmatter (name, description, tags) will be materially
worse. **The index must include enough skill body to reflect what the skill actually does — not just
what it says it does.** However this content lives in the **index file/database**, not in the LLM's
context. The whole point is it never gets loaded unless selected.

**Numbers:**
- Hit@1 = 74.0% at 1.2B params (80K candidates); 76.0% at 8B
- 13× fewer params and 5.8× lower latency than 16B baseline
- End-to-end on real Claude Code / Codex harnesses: +1.78–3.22pp task success

Source: https://arxiv.org/abs/2603.22455 · https://github.com/zhengyanzhao1997/SkillRouter

### 2.3 Other notable approaches

**AnyTool (arXiv:2402.04253, ICML 2024):** hierarchical LLM routing across 16K APIs — meta-agent picks
categories, category agents pick tools, tool agents pick endpoints. No trained retriever needed;
uses GPT-4 function-calling at each tier. Good recall (58.2% pass-rate vs 23% for ToolLLM), but
expensive (multiple GPT-4 calls per query). *Relevant pattern for roster's domain grouping:
pipeline / workflow / kb / meta / testing / media is already a natural two-tier index.*

**Gorilla / APIBench (arXiv:2305.15334, NeurIPS 2024):** dense retrieval (text-embedding-ada-002) +
Retriever-Aware Training. Key number: oracle retriever at +23% vs dense at −29% vs BM25 at −52% over
no-retrieval baseline. Dense >> BM25 for tool selection universally.

**ToolGen (arXiv:2410.03439, ICLR 2025):** assigns each tool a virtual vocabulary token (atomic
indexing); model routes by next-token prediction over extended vocabulary — zero context cost, no
retrieval step. NDCG@5 of 91.5 on ToolBench I1 vs BERT retriever's 75. *Relevant long-term but requires
fine-tuning; out of scope for roster today.*

**RouteLLM (arXiv:2406.18665, ICLR 2025):** routes between strong/weak *models* (not tools), but the
BERT-classifier architecture (trained on preference data, <10ms, <0.4% total cost overhead) is directly
reusable as a skill router with per-skill outcome data as preference signal.

**AutoTool (arXiv:2511.14650, AAAI 2026):** constructs a directed graph from historical agent
trajectories, uses tool-transition probabilities to predict next tool without an LLM call. 30% inference
cost reduction. *The roster friction log + `state.json` ledger already produces the trajectory data this
would need.*

---

## 3. What roster already has (the building blocks)

From the codebase map — all file:line refs available on request:

| Capability | Artifact | Usable for routing? |
|---|---|---|
| Rich skill index | `index.json` (name, description, domain, tags, complexity, compatible_with, version, path) | ✓ — already built by `npm run build:index` |
| Skill frontmatter metadata | `when_to_use`, `phase`, `allowed_tools`, `domain`, `tags` fields | ✓ — good routing signals |
| Directory-based categorization | `skills/{pipeline,workflow,kb,meta,testing,media}/` | ✓ — natural tier-1 filter (AnyTool-style) |
| Hybrid vector+keyword search | `kb-search.md`: LanceDB + BM25 fusion (0.7/0.3), pre-filtered by status | ✓ — directly adaptable, just needs a skills table |
| LanceDB infrastructure | `kb-reindex.md`: chunking, `text-embedding-3-small`, incremental update | ✓ — reuse for skill embeddings |
| Pre/post hook execution | `roster-run.md:97-164` hook framework | ✓ — a pre-hook that queries the index and gates skill loading is the natural insertion point |
| Friction log as usage signal | `skills-meta/friction.jsonl` | ✓ — usage signal for trajectory-based routing (AutoTool-style) |
| Task state ledger | `briefs/<task>-state.json` append-only | ✓ — trajectory data for routing inference |
| index.json build scripts | `scripts/build-index.ts`, `scripts/lib/{normalize,infer,types}.ts` | ✓ — extend to chunk skill body for the routing index |

**The two gaps:**
1. No skill description index for semantic lookup (the `index.json` exists but isn't queried at runtime per-task)
2. No mechanism to gate which skills are loaded into context per session/task

---

## 4. The proposed architecture

### Core concept: a permanent tiny meta-skill + an off-context skill index

```
┌──────────────────────────────────────────────────────────┐
│  Claude Code / agent context window                       │
│                                                           │
│  ┌──────────────────┐   ┌───────────────────────────┐    │
│  │  roster-router   │   │  Selected skills (3–8)    │    │
│  │  (tiny, always   │──▶│  dynamically loaded into  │    │
│  │   loaded)        │   │  context for this task    │    │
│  └────────┬─────────┘   └───────────────────────────┘    │
│           │                                               │
│           │ calls deterministic tool                      │
└───────────┼───────────────────────────────────────────────┘
            │
            ▼  (outside context window, on disk)
   ┌────────────────────┐
   │  .roster/skill-    │
   │  index/ (LanceDB)  │
   │  • skill body      │
   │  • when_to_use     │
   │  • domain / tags   │
   │  • embeddings      │
   └────────────────────┘
```

**roster-router** is the single always-loaded skill. It is intentionally tiny: its entire body is "call
`roster-index-query` with the current task description; receive a ranked list of skill IDs; load only
those skills into the session." No skill prose in context except itself.

**roster-index-query** is a deterministic CLI script (not an LLM call): it embeds the task description
via `text-embedding-3-small` (or local model), queries the LanceDB skills table, and returns a JSON
list of skill IDs ranked by relevance. No model reads the output and "scores" it — it is pure vector
cosine arithmetic, the same pipeline as the existing `kb-search` but over the skill index.

**Optional cheap-LLM rerank**: if the top-K from vector search is ambiguous (scores within a small
margin), a single Haiku/GPT-4o-mini call reads the task + top-10 skill `when_to_use` excerpts
(~200 chars each) and re-ranks. Cost: ~1K tokens × $0.00025/1K = ~$0.00025 per task. Opt-in.

### Index content (addressing the SkillRouter 31–44pp finding)

The routing index is NOT just frontmatter. Each skill entry contains:
- `name` + `description` (from frontmatter)
- `when_to_use` full text (this is the highest-signal routing field)
- First ~300 characters of the Steps section (enough to reflect what the skill *actually does*)
- `domain`, `tags`, `phase`, `complexity` (for deterministic pre-filters)

This stays well under 1K tokens per skill in the index (stored on disk, never in context), but gives the
retriever the signal it needs.

### Tiered routing (AnyTool-style, using existing domain grouping)

Tier 1 (deterministic, free): filter by `domain` tag. The task classification in `roster-run` already
emits a mode (`express`/`fast`/`full`) which maps cleanly to relevant domains. A Full-mode task needs
`pipeline/` skills; a KB question needs `kb/` skills; a meta-task needs `meta/`. This alone cuts the
candidate space from 34 to 5–12 before any embedding query.

Tier 2 (vector search within the filtered domain): hybrid LanceDB query over the domain-filtered subset.
For 5–12 candidates this is near-instant and the context-window-load decision is trivial.

Tier 3 (optional LLM rerank): only when tier-2 scores are tight.

---

## 5. Key design decisions and tradeoffs

**1. The bootstrapping question: how does roster-router itself load without overhead?**
It must be permanently, unconditionally installed as a single small always-available meta-skill. Its
entire body should fit in under 500 tokens. The routing index query is a tool call (code path), not an
in-context LLM read. This resolves the bootstrap problem: the router loads ~500 tokens, calls out-of-
context code, and the selected skills are loaded. Total overhead: router body + query latency (~50ms) +
selected skill bodies.

**2. False negatives are the real risk, not false positives.**
A router that incorrectly excludes a needed skill silently degrades performance with no error signal.
Mitigations:
- Keep K high enough (top-8 of 34 = 24% coverage, reasonable)
- Always include a small "golden set" that's always loaded regardless (pipeline entry points, preamble)
- Expose a `--all-skills` override flag for when the user knows what they need
- Log routing decisions to `friction.jsonl` as first-class routing friction entries, so misses surface
  naturally in skill-health analysis

**3. Small roster (current: 34 skills) vs. large roster (future: hundreds)**
At 34 skills, the performance gain from routing is modest (loading 34 × ~2K avg tokens = ~68K tokens
vs. loading 5–8 × ~2K = ~10–16K tokens; a real saving, but context win is not the crisis it is at
hundreds of skills). The main benefit at small scale is specialization quality — loading only the
relevant skills removes the "lost-in-the-middle" confusion among irrelevant skill descriptions.
The architecture should be designed for scale now so it's not rearchitected later.

**4. Cheap LLM vs. local model vs. pure vector**
- Pure vector search (Option A): no API dependency, no latency, no cost, deterministic. Adequate for
  roster's current scale. SkillRouter's 31–44pp finding applies when you only have 1-line descriptions
  — if the index has `when_to_use` + 300-char body excerpt, vector search performance is much better.
- Cheap API LLM (Option B): ~$0.0001/task overhead, meaningfully better on ambiguous cases. Network
  dependency.
- Local model (Option C): zero cost, offline. Requires ollama or equivalent. Good choice for projects
  that already run local infrastructure. SkillRouter shows 0.6B models reach 74% Hit@1 even at 80K
  skills — more than adequate for roster's scale.
- Fine-tuned router (Option D): overkill until roster has thousands of skills and routing is the
  performance bottleneck. Save this for v3+.

**Recommendation: ship Option A first** (pure vector, adapt kb-search infrastructure), add Option B as
an optional harness tunable. Keep Option C as a documented alternative for offline/cost-sensitive
deployments.

**5. The skill index is infrastructure — it must be versioned and kept in sync**
`sync-harness.sh --check` already fails CI if projections drift. The skill router index needs the same:
`roster-index-build` runs as part of `sync-harness.sh` (or as a post-sync hook), and
`sync-harness.sh --check` must verify the index is current (hash of source skills matches stored hash).
A stale index is the same failure mode as a stale projection.

---

## 6. What stays constant (things that must not change)

This design does **not** affect:
- The human-validation protocol — routing is pre-selection, not approval
- The propose-only model of roster-upgrade
- The per-project self-eval design (they are orthogonal and composable)
- Any existing deterministic gate

The only behavioral change is: fewer skill bodies in context by default. The routing decision is
transparent (the router emits the selected skill IDs as a log line), auditable (friction log), and
overridable (`--all-skills`).

---

## 7. Open questions (for a design note / specs/ phase)

1. **Index storage location:** `.roster/skill-index/` (local, gitignored like `kb/.index/`) or include
   a pre-built serialized index in the harness bundle (so projects without `build:index` still work)?
2. **Golden-set definition:** which skills are always loaded unconditionally regardless of routing?
   Candidates: `roster-run`, `roster-router` itself, the preamble. Keep this list minimal and explicit.
3. **Routing decision logging:** extend `friction.jsonl` schema with a `routing_decision` field
   (`{task, selected_skills, scores, was_override}`), or a separate `.roster/routing.log`?
4. **How does routing interact with `--express`/`--fast`/`--full` mode flags?** The mode already
   implies a skill domain filter. Routing should compose with mode, not fight it.
5. **What happens when a skill is not installed but would have been selected?** The router should emit
   a `MISSING_SKILL` warning that routes to `recruiter` Mode 1, not silently fail.

---

## 8. Sources (all from this session's research agents)

**Academic papers**
- SkillRouter (80K skills, directly targets Claude Code): https://arxiv.org/abs/2603.22455
- Gorilla / APIBench (NeurIPS 2024): https://arxiv.org/abs/2305.15334
- ToolLLM / ToolBench (ICLR 2024): https://arxiv.org/abs/2307.16789
- AnyTool / hierarchical LLM routing (ICML 2024): https://arxiv.org/abs/2402.04253
- ToolkenGPT / tool-as-token (NeurIPS 2023 Oral): https://arxiv.org/abs/2305.11554
- ToolGen / generation-as-retrieval (ICLR 2025): https://arxiv.org/abs/2410.03439
- ToolRerank / two-stage reranking (LREC-COLING 2024): https://arxiv.org/abs/2403.06551
- IterFeedback / LLM feedback loop for retrieval (2024): https://arxiv.org/abs/2406.17465
- GRETEL / execution-validated retrieval (2025): https://arxiv.org/abs/2510.17843
- Toolshed / RAG fusion for tools (2024): https://arxiv.org/pdf/2410.14594
- Tool-to-Agent Retrieval / shared vector space (2025): https://arxiv.org/pdf/2511.01854
- ToolDreamer / hypothesis-conditioned retrieval (EACL 2026): https://arxiv.org/pdf/2510.19791
- AutoTool / trajectory-graph tool prediction (AAAI 2026): https://arxiv.org/pdf/2511.14650
- RouteLLM / model routing (ICLR 2025): https://arxiv.org/abs/2406.18665
- LongFuncEval / context degradation with tool overload (2025): https://arxiv.org/abs/2505.10570
- Context length degradation (2025): https://arxiv.org/abs/2510.05381
- WorkBench / tool contamination benchmark (2024): https://arxiv.org/abs/2405.00823

**Frameworks / industry**
- langgraph-bigtool: https://github.com/langchain-ai/langgraph-bigtool
- LangChain context engineering: https://www.langchain.com/blog/context-engineering-for-agents
- LlamaIndex ObjectIndex: https://developers.llamaindex.ai/python/examples/agent/openai_agent_retrieval/
- Semantic Kernel (≤20 tool warning): https://learn.microsoft.com/en-us/semantic-kernel/concepts/plugins/
- RAG-MCP (Writer Engineering): https://writer.com/engineering/rag-mcp/
- MCP too-many-tools problem: https://demiliani.com/2025/09/04/model-context-protocol-and-the-too-many-tools-problem/
- RouteLLM (LMSYS): https://www.lmsys.org/blog/2024-07-01-routellm/
- Context rot (Morph): https://www.morphllm.com/context-rot
- Karpathy context engineering: https://aiiq.substack.com/p/karpathys-2025-llm-year-in-review
- Lilian Weng agents post: https://lilianweng.github.io/posts/2023-06-23-agent/
- Latent.Space agent engineering: https://www.latent.space/p/agent
- Agent orchestration patterns: https://beam.ai/agentic-insights/multi-agent-orchestration-patterns-production
- Allen Chan tool token cost analysis: https://achan2013.medium.com/how-many-tools-functions-can-an-ai-agent-has-21e0a82b7847

## Coverage gaps / caveats

- Most performance figures (SkillRouter, RouteLLM, Toolshed) are self-reported; no independent replications surfaced.
- WorkBench figure (49%→43%) comes from a single source at GPT-4 vintage — may not represent current models.
- SkillRouter's training regime (hard-negative mining, fine-tuning 0.6B models) applies to the large-scale case; roster at 34 skills needs only the retrieval architecture, not the training infrastructure.
- `langgraph-bigtool` has no published benchmark numbers; its correctness claims are unverified.
