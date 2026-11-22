// Shared types. The core is language-agnostic: it only knows files, symbols, imports, references and spans.

/** How a fact was obtained. Queries prefer higher precision when sources disagree. */
export type Precision = "heuristic" | "syntactic" | "semantic";
export const PRECISION_RANK: Record<Precision, number> = { heuristic: 1, syntactic: 2, semantic: 3 };

export interface SymbolFact {
  name: string;
  kind: string; // function | method | class | struct | interface | trait | enum | type | const | module | component | test | route | resource | target | rule | key | heading ...
  line: number;
  end: number;
  exported?: boolean;
  sig?: string;
  parent?: string; // enclosing class/module, for methods
}

export interface ImportFact {
  source: string; // as written: "./x", "os.path", "github.com/a/b", "crate::x::y", "com.foo.Bar", "x.h"
  line: number;
  names?: { imported: string; local: string }[];
}

export interface RefFact {
  name: string; // referenced identifier (last segment) or value (class name, text key, route path)
  kind: "call" | "mcall" | "ref" | "extends" | "render" | "style" | "text" | "route" | "string";
  line: number;
  in?: string; // enclosing top-level symbol name
}

export interface FileFacts {
  lang: string;
  precision: Precision;
  provider: string;
  symbols: SymbolFact[];
  imports: ImportFact[];
  refs: RefFact[];
  syntaxErrors?: { line: number; message: string }[];
  meta?: Record<string, unknown>; // e.g. css rules context, package name, Go package, Java package
}

export interface IntelProvider {
  id: string;
  precision: Precision;
  /** Languages this provider can extract (after init). */
  languages(): string[];
  init?(): Promise<boolean>;
  extract(text: string, path: string, lang: string): FileFacts | null;
}

/** Normalised model usage across providers. inputUncached + cacheRead + cacheWrite = total input. */
export interface Usage {
  inputUncached: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
  reasoning?: number;
  cost?: { total: number; source: "provider" | "catalog" | "unknown" };
}

export const emptyUsage = (): Usage => ({ inputUncached: 0, cacheRead: 0, cacheWrite: 0, output: 0, reasoning: 0, cost: { total: 0, source: "unknown" } });
export function addUsage(a: Usage, b: Usage): Usage {
  return {
    inputUncached: a.inputUncached + b.inputUncached,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    output: a.output + b.output,
    reasoning: (a.reasoning || 0) + (b.reasoning || 0),
    cost: { total: (a.cost?.total || 0) + (b.cost?.total || 0), source: a.cost?.source === "provider" || b.cost?.source === "provider" ? "provider" : (b.cost?.source || "unknown") },
  };
}
export const totalInput = (u: Usage) => u.inputUncached + u.cacheRead + u.cacheWrite;

/** Rough token estimate when no tokenizer is available (~4 chars per token for code and English). */
export const estTokens = (s: string) => Math.ceil(s.length / 4);
