# Model Facts — Volatile Reference

Model IDs, context sizes, prices, and API parameters live here. [SKILL.md](../SKILL.md) and [tool-profiles.md](tool-profiles.md) hold prompting technique, which ages slowly. This file holds everything that rots.

## Refresh Protocol

Each vendor section carries a `last-verified` date and a source. **Before stating any fact from a section more than 60 days old, re-verify it.**

| Vendor | Re-verify with |
|---|---|
| Anthropic / Claude | The `claude-api` skill if it is installed — it ships current model IDs and parameters. Otherwise `platform.claude.com/docs/en/about-claude/models/overview` |
| Everything else | Web search: `"<vendor> current models <month> <year>"`, then the vendor's own docs |

After verifying, update the section and its date. Never present an expired fact as current: either verify first, or say "as of `<date>`" out loud. A section marked `UNVERIFIED` has never been independently checked — treat it as a lead, not a fact.

If you cannot verify and the prompt does not actually depend on the exact ID or parameter, drop to family-level guidance and say so. Never invent a model slug, context size, price, or parameter.

---

## Anthropic / Claude

`last-verified: 2026-06-24` · source: `claude-api` skill

| Model | ID | Context | Max output | Input $/MTok | Output $/MTok |
|---|---|---|---|---|---|
| Claude Fable 5 | `claude-fable-5` | 1M | 128K | $10 | $50 |
| Claude Opus 5 | `claude-opus-5` | 1M | 128K | $5 | $25 |
| Claude Opus 4.8 | `claude-opus-4-8` | 1M | 128K | $5 | $25 |
| Claude Opus 4.7 | `claude-opus-4-7` | 1M | 128K | $5 | $25 |
| Claude Sonnet 5 | `claude-sonnet-5` | 1M | 128K | $3 | $15 |
| Claude Sonnet 4.6 | `claude-sonnet-4-6` | 1M | 128K | $3 | $15 |
| Claude Haiku 4.5 | `claude-haiku-4-5` | 200K | 64K | $1 | $5 |

Use the exact ID strings. Do not append date suffixes.

**API parameters** — these matter only when the prompt is destined for the API or a scripted harness, not for claude.ai:

- Thinking on current models is adaptive: `thinking: {type: "adaptive"}`. A fixed `budget_tokens` is rejected with a 400 on Fable 5, Opus 5, Opus 4.8, Opus 4.7, and Sonnet 5. Never write a thinking budget into a prompt for these models.
- `temperature`, `top_p`, and `top_k` are removed on Fable 5, Opus 5, Opus 4.8, and Opus 4.7 (400). Steer with prompting instead. Sonnet 5 rejects non-default values.
- Depth is set with `output_config: {effort: "low" | "medium" | "high" | "xhigh" | "max"}`. Default is `high`. `xhigh` is the Claude Code default and the best setting for most coding and agentic work.
- Opus 5 thinks by default: omitting `thinking` runs adaptive. `thinking: {type: "disabled"}` is accepted only at effort `high` or below; pairing it with `xhigh` or `max` is a 400.
- Fable 5 always thinks. An explicit `{type: "disabled"}` is a 400 — omit the parameter.
- Raw chain of thought is never returned. `thinking.display` defaults to `"omitted"`; set `"summarized"` to get a readable summary.
- Last-assistant-turn prefills return a 400 on every 4.6-and-later model. Use structured outputs (`output_config.format`) instead.
- Fable 5 requires 30-day data retention and is unavailable to zero-data-retention orgs.

**Behavioral, and therefore prompt-relevant:**

- Opus 5 writes longer user-facing responses and longer files than 4.8. Ask for brevity explicitly; lowering effort does not reliably shorten visible output.
- Opus 5 self-verifies without being told. Do not add "double-check your work" instructions or a separate verifier subagent for routine work.
- Opus 5 delegates to subagents readily and can expand task scope. Cap delegation and state the scope boundary.
- Opus 4.8 narrates more than 4.7 and asks more often on minor decisions. Grant autonomy on small choices explicitly.
- Sonnet 5 follows instructions literally, especially at lower effort. State when a rule applies to every item, not just the first.

---

## OpenAI

`UNVERIFIED` · carried from upstream PR #62 (GPT-5.6 Sol / Terra / Luna routing)

- Family: **Sol** (flagship), **Terra** (balanced), **Luna** (fast, high-volume). Availability in the ChatGPT product depends on the user's plan.
- Reasoning effort is set per request; use the lowest level that meets the quality bar.
- Product controls (Pro, Max, Ultra) are ChatGPT and Codex surface features, not API parameters. Do not translate one into the other.
- Verify exact model slugs before writing them into a prompt. If you cannot, route by family name and say the slug is unverified.

---

## Google / Gemini

`UNVERIFIED` · Gemini 3.x family

- Tiers: Pro for hard reasoning and long documents, Flash for volume and latency.
- 1M context on current Pro tiers. Native multimodal input including video and PDF.
- `thinking_level` sets reasoning depth. `media_resolution` trades fine-detail reading against token cost.
- Gemini Omni is the any-input-to-video family; individual clips cap at roughly 10 seconds.
- Verify the current slug (`gemini-3.1-pro`, `gemini-3.5-flash`, `gemini-omni-flash`, and successors) before writing it into a prompt.

---

## xAI / Grok

`UNVERIFIED` · carried from upstream PR #62 (Grok 4.6 routing)

- `grok-4.6` for chat, coding, agentic, and knowledge work. Text and image input.
- OpenAI-API compatible. Reasoning effort: `low`, `medium`, `high` (API default), `xhigh`. Reasoning cannot be disabled.
- No realtime knowledge without Web Search or X Search enabled.
- Prompt caching keys: `prompt_cache_key` on the Responses API, `x-grok-conv-id` on Chat Completions.
- Grok Imagine is the image and short-video surface; it is a separate product from the API.

---

## MiniMax

`UNVERIFIED` · carried from upstream v1.7.0

- M3 is the current default; M2.7 carries a 1M context window.
- OpenAI-compatible API. Temperature must be in the range 0 to 1 inclusive; above 1 fails.
- May emit reasoning in `<think>` tags.
- Function calling uses OpenAI-style tool definitions.

---

## DeepSeek

`UNVERIFIED`

- R1 is reasoning-native: short clean instructions, no chain-of-thought scaffolding, `<think>` tags in output by default.
- Later DeepSeek releases fold the reasoning mode into a single model with an optional thinking switch. Verify which generation the user is on before writing parameter guidance.

---

## Alibaba / Qwen

`UNVERIFIED`

- Qwen3 has two modes. Thinking mode is reasoning-native; non-thinking mode takes full structure and explicit format specs.
- Qwen2.5 instruct and qwen2.5-coder remain widely deployed locally, notably through Ollama. Strong at JSON and structured output.

---

## Meta / Llama

`UNVERIFIED`

- Consumer Meta AI exposes no system prompt and no parameters. Everything goes in the single user message.
- Self-hosted Llama takes a system prompt. Instruction following is weaker than Claude or GPT: be more explicit and keep structure flat.

---

## Local / Ollama

Evergreen — model-dependent, so always ask which model is running.

- The system prompt is the highest-leverage knob. Include it so the user can set it in their Modelfile.
- Shorter, flatter prompts. Local models lose coherence with deep nesting.
- Temperature 0.1 for coding and deterministic work, 0.7 to 0.8 for creative work.
- For coding, prefer a coder variant (qwen2.5-coder, CodeLlama) over a general chat model.
