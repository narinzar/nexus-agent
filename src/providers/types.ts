// Provider-independent model interface. Adapters translate this to each API and normalise usage.
import type { Usage } from "../core/types.ts";

export interface Message { role: "user" | "assistant"; content: string }
export interface ToolSpec { name: string; description: string; parameters: Record<string, unknown> }
export interface ToolCall { id: string; name: string; args: Record<string, unknown> }

export interface CompleteRequest {
  /** Stable across a session (cacheable): agent rules, protocol, tool docs. */
  system: string;
  /** Stable across a session (cacheable): project facts, skill catalogue, memory. Sent after `system`. */
  prefix?: string;
  /** Volatile turn content. */
  messages: Message[];
  tools?: ToolSpec[];
  maxTokens?: number;
  temperature?: number;
  /** Session id: used as OpenAI prompt_cache_key; providers that cache by prefix ignore it. */
  cacheKey?: string;
  effort?: "low" | "medium" | "high";
}
export interface CompleteResult { text: string; toolCalls: ToolCall[]; usage: Usage; model: string; stopReason?: string; ms: number }

export interface Capabilities { nativeTools: boolean; caching: "explicit" | "automatic" | "implicit" | "none"; contextWindow: number }
export interface Provider { id: string; model: string; capabilities: Capabilities; complete(req: CompleteRequest): Promise<CompleteResult> }

/** Optional user-configured prices (USD per million tokens). Never guessed: cost is "unknown" without provider data or config. */
export interface Price { input: number; output: number; cacheRead?: number; cacheWrite?: number }
export function priced(u: Usage, p?: Price): Usage {
  if (!p || u.cost?.source === "provider") return u;
  const total = (u.inputUncached * p.input + u.output * p.output + u.cacheRead * (p.cacheRead ?? p.input) + u.cacheWrite * (p.cacheWrite ?? p.input)) / 1e6;
  return { ...u, cost: { total, source: "catalog" } };
}
