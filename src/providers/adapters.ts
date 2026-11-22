// Provider adapters, dependency-free (fetch / child process). Each maps tool calls, caching hints and usage.
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import type { Usage } from "../core/types.ts";
import type { CompleteRequest, CompleteResult, Provider, ToolCall } from "./types.ts";

async function postJson(url: string, headers: Record<string, string>, body: unknown, timeoutMs = 600_000) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body), signal: ctl.signal });
    const txt = await r.text();
    if (!r.ok) throw new Error(`${url} -> HTTP ${r.status}: ${txt.slice(0, 400)}`);
    return JSON.parse(txt);
  } finally { clearTimeout(t); }
}

/** Anthropic Messages API: explicit cache breakpoints on tools, system and the stable prefix. */
export function anthropic(model: string, apiKey = process.env.ANTHROPIC_API_KEY, baseUrl = process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com"): Provider {
  return {
    id: "anthropic", model, capabilities: { nativeTools: true, caching: "explicit", contextWindow: 200_000 },
    async complete(req) {
      if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
      const t0 = Date.now();
      const system: any[] = [{ type: "text", text: req.system, ...(req.prefix ? {} : { cache_control: { type: "ephemeral" } }) }];
      if (req.prefix) system.push({ type: "text", text: req.prefix, cache_control: { type: "ephemeral" } });
      const tools = req.tools?.map((t, i, a) => ({ name: t.name, description: t.description, input_schema: t.parameters, ...(i === a.length - 1 ? { cache_control: { type: "ephemeral" } } : {}) }));
      // breakpoint on the last message: the whole append-only conversation becomes a cache prefix for the next turn
      const messages = req.messages.map((m, i, a) => (i === a.length - 1 ? { role: m.role, content: [{ type: "text", text: m.content, cache_control: { type: "ephemeral" } }] } : m));
      const j = await postJson(`${baseUrl}/v1/messages`, { "x-api-key": apiKey, "anthropic-version": "2023-06-01" }, { model, max_tokens: req.maxTokens ?? 8192, system, messages, ...(tools?.length ? { tools } : {}), ...(req.temperature !== undefined ? { temperature: req.temperature } : {}) });
      const u = j.usage || {};
      const usage: Usage = { inputUncached: u.input_tokens || 0, cacheRead: u.cache_read_input_tokens || 0, cacheWrite: u.cache_creation_input_tokens || 0, output: u.output_tokens || 0, cost: { total: 0, source: "unknown" } };
      const text = (j.content || []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("");
      const toolCalls: ToolCall[] = (j.content || []).filter((c: any) => c.type === "tool_use").map((c: any) => ({ id: c.id, name: c.name, args: c.input }));
      return { text, toolCalls, usage, model: j.model || model, stopReason: j.stop_reason, ms: Date.now() - t0 };
    },
  };
}

/** OpenAI Chat Completions and every OpenAI-compatible server (OpenRouter, Ollama, vLLM, LM Studio, llama.cpp, LiteLLM). */
export function openaiCompatible(model: string, opts: { id?: string; baseUrl?: string; apiKey?: string } = {}): Provider {
  const baseUrl = opts.baseUrl || process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
  const apiKey = opts.apiKey ?? process.env.OPENAI_API_KEY;
  return {
    id: opts.id || "openai", model, capabilities: { nativeTools: true, caching: "automatic", contextWindow: 128_000 },
    async complete(req) {
      const t0 = Date.now();
      const messages = [{ role: "system", content: req.system + (req.prefix ? `\n\n${req.prefix}` : "") }, ...req.messages];
      const body: any = { model, messages, ...(req.maxTokens ? { max_completion_tokens: req.maxTokens } : {}), ...(req.temperature !== undefined ? { temperature: req.temperature } : {}) };
      if (req.tools?.length) body.tools = req.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }));
      if (req.cacheKey && baseUrl.includes("api.openai.com")) body.prompt_cache_key = req.cacheKey;
      if (baseUrl.includes("openrouter.ai")) body.usage = { include: true }; // OpenRouter returns the charged cost
      const j = await postJson(`${baseUrl}/chat/completions`, apiKey ? { authorization: `Bearer ${apiKey}` } : {}, body);
      const m = j.choices?.[0]?.message || {}; const u = j.usage || {};
      const cached = u.prompt_tokens_details?.cached_tokens || 0;
      const usage: Usage = { inputUncached: (u.prompt_tokens || 0) - cached, cacheRead: cached, cacheWrite: 0, output: u.completion_tokens || 0, reasoning: u.completion_tokens_details?.reasoning_tokens || 0, cost: typeof u.cost === "number" ? { total: u.cost, source: "provider" } : { total: 0, source: "unknown" } };
      const toolCalls: ToolCall[] = (m.tool_calls || []).map((c: any) => ({ id: c.id, name: c.function.name, args: safeJson(c.function.arguments) }));
      return { text: m.content || "", toolCalls, usage, model: j.model || model, stopReason: j.choices?.[0]?.finish_reason, ms: Date.now() - t0 };
    },
  };
}

/** Google Gemini generateContent. Implicit caching applies automatically to repeated prefixes. */
export function gemini(model: string, apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY): Provider {
  return {
    id: "gemini", model, capabilities: { nativeTools: true, caching: "implicit", contextWindow: 1_000_000 },
    async complete(req) {
      if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
      const t0 = Date.now();
      const body: any = { systemInstruction: { parts: [{ text: req.system + (req.prefix ? `\n\n${req.prefix}` : "") }] }, contents: req.messages.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })), generationConfig: { ...(req.maxTokens ? { maxOutputTokens: req.maxTokens } : {}), ...(req.temperature !== undefined ? { temperature: req.temperature } : {}) } };
      if (req.tools?.length) body.tools = [{ functionDeclarations: req.tools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters })) }];
      const j = await postJson(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, { "x-goog-api-key": apiKey }, body);
      const parts = j.candidates?.[0]?.content?.parts || []; const u = j.usageMetadata || {};
      const cached = u.cachedContentTokenCount || 0;
      const usage: Usage = { inputUncached: (u.promptTokenCount || 0) - cached, cacheRead: cached, cacheWrite: 0, output: (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0), reasoning: u.thoughtsTokenCount || 0, cost: { total: 0, source: "unknown" } };
      const toolCalls: ToolCall[] = parts.filter((p: any) => p.functionCall).map((p: any, i: number) => ({ id: `g${i}`, name: p.functionCall.name, args: p.functionCall.args || {} }));
      return { text: parts.map((p: any) => p.text || "").join(""), toolCalls, usage, model, stopReason: j.candidates?.[0]?.finishReason, ms: Date.now() - t0 };
    },
  };
}

/** The local Claude Code CLI as a plain completion endpoint (uses the user's existing login; no API key needed).
 *  Its own system prompt, tools, MCP servers and skill listing are switched off, leaving ~1.4K fixed tokens.
 *  Multi-turn conversations continue one CLI session (--resume), so earlier turns are served from the prompt cache. */
export function claudeCli(model = ""): Provider {
  const sessions = new Map<string, { id: string; turns: number }>(); // cacheKey -> CLI session
  return {
    id: "claude-cli", model: model || "default", capabilities: { nativeTools: false, caching: "automatic", contextWindow: 200_000 },
    complete(req) {
      const t0 = Date.now();
      const sys = req.system + (req.prefix ? `\n\n${req.prefix}` : "");
      const key = req.cacheKey || "";
      const known = key ? sessions.get(key) : undefined;
      // continue the CLI session when it already holds every earlier turn; otherwise start one (or fall back to a transcript)
      const canResume = !!known && req.messages.length === known.turns * 2 + 1;
      const input = canResume || req.messages.length === 1 ? req.messages[req.messages.length - 1].content : req.messages.map((m) => `<${m.role}>\n${m.content}\n</${m.role}>`).join("\n\n") + "\n\nContinue as the assistant.";
      const sessionArgs = !key ? ["--no-session-persistence"] : canResume ? ["--resume", known!.id] : ["--session-id", crypto.randomUUID()];
      const args = ["-p", "--system-prompt", sys, "--tools", "", "--strict-mcp-config", "--setting-sources", "", "--disable-slash-commands", ...sessionArgs, "--output-format", "json", ...(model ? ["--model", model] : [])];
      return new Promise((resolve, reject) => {
        const p = spawn("claude", args, { stdio: ["pipe", "pipe", "pipe"] });
        let out = "", err = "";
        p.stdout.on("data", (d) => (out += d)); p.stderr.on("data", (d) => (err += d));
        p.on("error", reject);
        p.on("close", () => {
          try {
            const j = JSON.parse(out); const u = j.usage || {};
            if (j.is_error) return reject(new Error(`claude-cli: ${j.result || j.subtype}`));
            if (key) { const id = canResume ? known!.id : sessionArgs[1]; if (id && sessionArgs[0] !== "--no-session-persistence") sessions.set(key, { id, turns: canResume ? known!.turns + 1 : (req.messages.length === 1 ? 1 : 0) }); }
            resolve({ text: j.result || "", toolCalls: [], model: Object.keys(j.modelUsage || {})[0] || model, ms: Date.now() - t0, usage: { inputUncached: u.input_tokens || 0, cacheRead: u.cache_read_input_tokens || 0, cacheWrite: u.cache_creation_input_tokens || 0, output: u.output_tokens || 0, cost: { total: j.total_cost_usd || 0, source: "provider" } } });
          } catch { reject(new Error(`claude-cli failed: ${(err || out).slice(0, 400)}`)); }
        });
        p.stdin.end(input);
      });
    },
  };
}

/** Scripted provider for tests and offline development. */
export function mock(replies: (string | ((req: CompleteRequest) => string))[]): Provider & { requests: CompleteRequest[] } {
  const requests: CompleteRequest[] = [];
  let i = 0;
  return {
    id: "mock", model: "mock", capabilities: { nativeTools: false, caching: "none", contextWindow: 1_000_000 }, requests,
    async complete(req) {
      requests.push(req);
      const r = replies[Math.min(i++, replies.length - 1)];
      const text = typeof r === "function" ? r(req) : r;
      const inTok = Math.ceil((req.system.length + (req.prefix?.length || 0) + req.messages.reduce((a, m) => a + m.content.length, 0)) / 4);
      return { text, toolCalls: [], model: "mock", ms: 0, usage: { inputUncached: inTok, cacheRead: 0, cacheWrite: 0, output: Math.ceil(text.length / 4), cost: { total: 0, source: "unknown" } } };
    },
  };
}
const safeJson = (s: string) => { try { return JSON.parse(s || "{}"); } catch { return { _raw: s }; } };
