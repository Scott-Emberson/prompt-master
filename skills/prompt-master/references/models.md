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

`last-verified: 2026-08-19` · source: `claude-api` skill, cross-checked against anthropic.com release announcements

| Model | ID | Context | Max output | Input $/MTok | Output $/MTok |
|---|---|---|---|---|---|
| Claude Fable 5 | `claude-fable-5` | 1M | 128K | $10 | $50 |
| Claude Opus 5 | `claude-opus-5` | 1M | 128K | $5 | $25 |
| Claude Opus 4.8 | `claude-opus-4-8` | 1M | 128K | $5 | $25 |
| Claude Opus 4.7 | `claude-opus-4-7` | 1M | 128K | $5 | $25 |
| Claude Sonnet 5 | `claude-sonnet-5` | 1M | 128K | $3 | $15 |
| Claude Sonnet 4.6 | `claude-sonnet-4-6` | 1M | 128K | $3 | $15 |
| Claude Haiku 4.5 | `claude-haiku-4-5` | 200K | 64K | $1 | $5 |

Release order: Sonnet 5 on 2026-06-30, Opus 5 on 2026-07-24. Claude Mythos 5 exists but is restricted to an approved-access programme — do not route to it unless the user says they are in that programme.

**Sonnet 5 is on introductory pricing of $2/$10 per MTok through 2026-08-31.** After that it reverts to the $3/$15 in the table. If a cost estimate is part of the prompt, say which of the two you used.

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

`last-verified: 2026-08-19` · source: web (openai.com announcements, simonwillison.net launch coverage)

GPT-5.6 shipped 2026-07-09 in three tiers.

| Tier | Positioning | Input $/MTok | Output $/MTok |
|---|---|---|---|
| Sol | Flagship | $5 | $30 |
| Terra | Balanced everyday work | $2.50 | $15 |
| Luna | Fast, high-volume, cost-sensitive | $1 | $6 |

All three: 1M context, 128K max output, knowledge cutoff 2026-02-16.

- Reasoning effort spans `none`, `low`, `medium`, `high`, `xhigh`, `max`. **`max` effort and ultra mode are Sol-only.** Use the lowest level that meets the quality bar.
- **The API slugs are not formally documented.** `gpt-5.6-sol`, `gpt-5.6-terra`, and `gpt-5.6-luna` appear in launch coverage and example code but not in a published model table. Verify against the API before writing a slug into a prompt; route by tier name if you cannot.
- An Ultrafast mode for Sol (up to ~750 tokens/sec) was formalised 2026-08-13 as an API-only preview for selected customers. Do not assume the user has it.
- Product controls (Pro, Max, Ultra) are ChatGPT and Codex surface features, not API parameters. Do not translate one into the other.

---

## Google / Gemini

`last-verified: 2026-08-19` · source: web (ai.google.dev model list, Google blog, TechCrunch)

- **Pro tier: Gemini 3.1 Pro** (`gemini-3.1-pro-preview`). **Gemini 3.5 Pro has not shipped** — it was promised and delayed. Do not route to it.
- **Flash tier: Gemini 3.7 Flash** (`gemini-3.7-flash`), released 2026-08-13, currently the most capable workhorse. `gemini-3.6-flash` and `gemini-3.5-flash` remain available; `gemini-flash-latest` points at the GA Flash.
- The Flash line moves fast — three releases in roughly a month. Check the current slug rather than assuming.
- 1M context on Pro tiers. Native multimodal input: text, image, audio, video, PDF.
- `thinking_level` sets reasoning depth; `media_resolution` trades fine-detail reading against token cost. Both are carried from earlier documentation and were not re-confirmed in the current model list — verify before writing either into a setup note.

**Gemini Omni Flash** (`gemini-omni-flash`), released 2026-06-30, is the any-input-to-video model: text, images, audio, and reference video into one conversational session, with plain-language editing across turns. Priced per second of output video (about $0.10/sec at launch).

**The per-clip duration cap is not publicly documented.** A widely repeated figure of roughly 10 seconds circulates but does not appear in Google's own materials. Do not state a number as fact. Decompose long requests into a numbered clip sequence regardless — that is sound for continuity whatever the real cap turns out to be — and tell the user to confirm the limit for their surface.

---

## xAI / Grok

`last-verified: 2026-08-19` · source: web (docs.x.ai, AWS Bedrock model card, launch coverage)

- **`grok-4.6`**, released 2026-08-12. Built for coding, agentic work, and long-running agents.
- **500K context.** Text and image input, text-only output.
- Reasoning effort: `low`, `medium`, `high` (default), `xhigh`. `xhigh` is new in 4.6.
- Pricing is tiered on prompt size: $2/$0.50/$6 per MTok (input / cached input / output) below 200K prompt tokens, $4/$1/$12 above it. A prompt that crosses 200K doubles its own rate — worth flagging when the prompt ships a large context.
- OpenAI-API compatible. Supports function calling, web search, X search, and code execution.
- No realtime knowledge without Web Search or X Search enabled.
- Prompt caching keys: `prompt_cache_key` on the Responses API, `x-grok-conv-id` on Chat Completions.
- Grok Imagine is the image and short-video surface, a separate product from the API.

---

## MiniMax

`last-verified: 2026-08-19` · source: web (minimax.io research blog, platform.minimax.io docs, OpenRouter)

- **MiniMax M3**, released 2026-06-01. Open-weight mixture of experts, 428B total parameters with about 23B active per token.
- **1M context, 262K max output.** Native multimodal input: text, image, and video, passed as `image_url` and `video_url` content parts.
- OpenAI-compatible Chat Completions — an existing OpenAI setup needs only a base URL and key change.
- **Recommended sampling is `temperature=1.0`, `top_p=0.95`.** Earlier MiniMax generations required temperature at or below 1 and this file previously carried that as a hard rule; it is no longer the right guidance for M3. Do not write a temperature clamp into an M3 prompt.
- Strong on long-horizon agentic work, coding, and tool use.
- May emit reasoning in `<think>` tags.

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
