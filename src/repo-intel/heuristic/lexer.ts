// Lexical helpers shared by heuristic extractors: blank out comments and string contents (keeping offsets and line
// numbers), collect string literals, compute brace depth, and map offsets to lines.

export interface Masked { code: string; strings: { start: number; end: number; value: string }[] }

export interface CommentStyle { line?: string[]; block?: [string, string][]; quotes?: string[]; triple?: boolean; raw?: boolean }
export const STYLE: Record<string, CommentStyle> = {
  "c-like": { line: ["//"], block: [["/*", "*/"]], quotes: ['"', "'", "`"] },
  python: { line: ["#"], quotes: ['"', "'"], triple: true },
  ruby: { line: ["#"], block: [["=begin", "=end"]], quotes: ['"', "'"] },
  shell: { line: ["#"], quotes: ['"', "'"] },
  sql: { line: ["--"], block: [["/*", "*/"]], quotes: ["'"] },
  hcl: { line: ["#", "//"], block: [["/*", "*/"]], quotes: ['"'] },
  lua: { line: ["--"], block: [["--[[", "]]"]], quotes: ['"', "'"] },
  haskell: { line: ["--"], block: [["{-", "-}"]], quotes: ['"'] },
  lisp: { line: [";"], quotes: ['"'] },
  none: {},
};

export function mask(src: string, st: CommentStyle): Masked {
  const out = src.split("");
  const strings: Masked["strings"] = [];
  const blank = (a: number, b: number) => { for (let k = a; k < b && k < out.length; k++) if (out[k] !== "\n") out[k] = " "; };
  let i = 0;
  const n = src.length;
  outer: while (i < n) {
    for (const lc of st.line || []) if (src.startsWith(lc, i)) {
      // avoid treating "#" inside e.g. C preprocessor as comment: c-like has no "#" line comment, fine
      const e = src.indexOf("\n", i); const end = e < 0 ? n : e; blank(i, end); i = end; continue outer;
    }
    for (const [a, b] of st.block || []) if (src.startsWith(a, i)) { const e = src.indexOf(b, i + a.length); const end = e < 0 ? n : e + b.length; blank(i, end); i = end; continue outer; }
    const c = src[i];
    if (st.quotes?.includes(c)) {
      if (st.triple && src.startsWith(c.repeat(3), i)) {
        const e = src.indexOf(c.repeat(3), i + 3); const end = e < 0 ? n : e + 3;
        strings.push({ start: i, end, value: src.slice(i + 3, end - 3) }); blank(i + 3, end - 3); i = end; continue;
      }
      // rust lifetimes / char literals: treat ' followed by ident and no closing ' within 3 chars as not a string
      if (c === "'" && /[A-Za-z_]/.test(src[i + 1] || "") && src[i + 2] !== "'" && src[i + 3] !== "'" && st.quotes.includes("`")) { i++; continue; }
      let j = i + 1;
      while (j < n && src[j] !== c) { if (src[j] === "\\") j++; else if (src[j] === "\n" && c !== "`") break; j++; }
      strings.push({ start: i, end: j + 1, value: src.slice(i + 1, j) }); blank(i + 1, j); i = j + 1; continue;
    }
    i++;
  }
  return { code: out.join(""), strings };
}

export function lineIndex(src: string): (off: number) => number {
  const nl: number[] = [];
  for (let i = 0; i < src.length; i++) if (src.charCodeAt(i) === 10) nl.push(i);
  return (off: number) => { let lo = 0, hi = nl.length; while (lo < hi) { const m = (lo + hi) >> 1; if (nl[m] < off) lo = m + 1; else hi = m; } return lo + 1; };
}

/** Brace depth before each line (1-based array index = line number). */
export function braceDepthByLine(code: string): number[] {
  const depth: number[] = [0, 0]; let d = 0, line = 1;
  for (let i = 0; i < code.length; i++) { const c = code[i]; if (c === "{") d++; else if (c === "}") d = Math.max(0, d - 1); else if (c === "\n") { line++; depth[line] = d; } }
  return depth;
}

/** End line of a brace block whose header starts at `line` (1-based); falls back to the header line for declarations without a body. */
export function braceEnd(lines: string[], line: number): number {
  let d = 0, seen = false;
  for (let k = line - 1; k < lines.length && k < line + 5000; k++) {
    for (const c of lines[k]) { if (c === "{") { d++; seen = true; } else if (c === "}") { d--; if (seen && d <= 0) return k + 1; } }
    if (!seen && (/;\s*$/.test(lines[k]) || (k > line + 2 && !/[,(\[=]\s*$/.test(lines[k - 1] || "")))) return k + 1 > line ? (seen ? k + 1 : line) : line;
  }
  return line;
}

/** End line of an indentation block (Python-like): last non-blank line indented deeper than the header. */
export function indentEnd(lines: string[], line: number): number {
  const ind = (l: string) => l.match(/^[ \t]*/)![0].replace(/\t/g, "    ").length;
  const base = ind(lines[line - 1]);
  let end = line;
  for (let k = line; k < lines.length; k++) { if (!lines[k].trim()) continue; if (ind(lines[k]) <= base) break; end = k + 1; }
  return end;
}

const KEYWORDS = new Set("if else elif for foreach while do return def class import from as with try catch except finally raise throw pass break continue lambda yield in is not and or None True False null nil true false self this super new delete typeof instanceof void var let const fn func function fun struct enum interface trait impl type package module namespace using use public private protected internal static final abstract override virtual async await match case switch default where select sizeof goto extern unsafe mut ref out val object when then end begin elsif unless until".split(" "));
export const isKeyword = (w: string) => KEYWORDS.has(w);

/** Identifier calls `name(` (last segment of a dotted chain) with their line. */
export function calls(code: string, L: (o: number) => number): { name: string; line: number; member?: boolean }[] {
  const out: { name: string; line: number; member?: boolean }[] = [];
  for (const m of code.matchAll(/([A-Za-z_$][\w$]*)\s*(?:<[^<>()]{0,60}>)?\s*\(/g)) if (!KEYWORDS.has(m[1])) { const before = code.slice(Math.max(0, m.index! - 2), m.index!); out.push({ name: m[1], line: L(m.index!), member: /\.$|->$|::$/.test(before) }); }
  return out;
}
