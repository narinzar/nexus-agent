// Provider selection: "provider:model" specs, environment detection, and routing by task level.
import { execFileSync } from "node:child_process";
import type { Provider, Price } from "./types.ts";
import { anthropic, openaiCompatible, gemini, claudeCli, mock } from "./adapters.ts";

export interface ModelConfig { default?: string; small?: string; large?: string; prices?: Record<string, Price> }

/** Spec forms: anthropic:<model> | openai:<model> | gemini:<model> | openrouter:<model> | ollama:<model> | lmstudio:<model> |
 *  vllm:<model>@<baseUrl> | compat:<model>@<baseUrl> | claude-cli[:<model>] | mock */
export function createProvider(spec: string): Provider {
  const [kind, ...rest] = spec.split(":"); const model = rest.join(":");
  const [m, base] = model.split("@");
  switch (kind) {
    case "anthropic": return anthropic(m);
    case "openai": return openaiCompatible(m);
    case "gemini": case "google": return gemini(m);
    case "openrouter": return openaiCompatible(m, { id: "openrouter", baseUrl: "https://openrouter.ai/api/v1", apiKey: process.env.OPENROUTER_API_KEY });
    case "ollama": return openaiCompatible(m, { id: "ollama", baseUrl: base || process.env.OLLAMA_BASE_URL || "http://localhost:11434/v1", apiKey: "" });
    case "lmstudio": return openaiCompatible(m, { id: "lmstudio", baseUrl: base || "http://localhost:1234/v1", apiKey: "" });
    case "vllm": case "llamacpp": case "compat": return openaiCompatible(m, { id: kind, baseUrl: base || "http://localhost:8000/v1", apiKey: process.env.COMPAT_API_KEY || "" });
    case "claude-cli": return claudeCli(m);
    case "mock": return mock(["DONE"]);
    default: throw new Error(`unknown provider "${kind}" in "${spec}"`);
  }
}

const has = (bin: string) => { try { execFileSync("sh", ["-c", `command -v ${bin}`], { stdio: "pipe" }); return true; } catch { return false; } };
/** First available provider when none is configured. */
export function defaultSpec(): string {
  if (process.env.NEXUS_MODEL) return process.env.NEXUS_MODEL;
  if (process.env.ANTHROPIC_API_KEY) return "anthropic:claude-sonnet-5-5";
  if (process.env.OPENAI_API_KEY) return "openai:gpt-5";
  if (process.env.GEMINI_API_KEY) return "gemini:gemini-2.5-pro";
  if (has("claude")) return "claude-cli";
  throw new Error("no model provider available: set NEXUS_MODEL (e.g. ollama:qwen3-coder) or an API key");
}

/** Route by task level: small models for classification/summaries, default for edits, large for level >= 3 or repeated failure. */
export function route(cfg: ModelConfig, level: number, failures = 0): string {
  if ((level >= 3 || failures >= 2) && cfg.large) return cfg.large;
  return cfg.default || defaultSpec();
}
