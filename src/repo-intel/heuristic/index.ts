// L0 "heuristic" intelligence provider: zero dependencies, ~35 languages and config formats.
// Definitions + spans are reliable for conventionally formatted code; references are lexical (name-based).
import type { FileFacts, IntelProvider, SymbolFact, ImportFact, RefFact } from "../../core/types.ts";
import { mask, STYLE, lineIndex, braceDepthByLine, braceEnd, indentEnd, calls, isKeyword } from "./lexer.ts";
import { parseCss } from "./css.ts";

type Def = [RegExp, string, number?]; // regex (group `n` = name, optional group `p` = parent), kind, max brace depth (default 1)
const ID = "[A-Za-z_$][\\w$]*";
const MODS = "(?:(?:public|private|protected|internal|static|final|abstract|sealed|open|override|virtual|async|export|default|declare|readonly|inline|suspend|data|partial|extern|unsafe|const|synchronized|native|transient|volatile|operator|infix|tailrec|external|lateinit|required|convenience|mutating|nonmutating|fileprivate|dynamic|optional|lazy|weak|@\\w+(?:\\([^)]*\\))?)\\s+)*";

const DEFS: Record<string, Def[]> = {
  js: [
    [new RegExp(`^\\s*${MODS}function\\*?\\s+(?<n>${ID})`), "function", 0],
    [new RegExp(`^\\s*${MODS}class\\s+(?<n>${ID})`), "class", 0],
    [new RegExp(`^\\s*${MODS}interface\\s+(?<n>${ID})`), "interface", 0],
    [new RegExp(`^\\s*${MODS}type\\s+(?<n>${ID})\\s*(<[^=]*>)?\\s*=`), "type", 0],
    [new RegExp(`^\\s*${MODS}enum\\s+(?<n>${ID})`), "enum", 0],
    [new RegExp(`^\\s*${MODS}(?:const|let|var)\\s+(?<n>${ID})\\s*(?::[^=]+)?=\\s*(?:async\\s+)?(?:function\\b|\\([^)]*\\)\\s*(?::[^=]+)?=>|${ID}\\s*=>|(?:React\\.)?(?:memo|forwardRef|lazy|dynamic)\\()`), "function", 0],
    [new RegExp(`^\\s*${MODS}(?:const|let|var)\\s+(?<n>${ID})\\b`), "const", 0],
    [new RegExp(`^\\s*${MODS}(?:get\\s+|set\\s+)?(?<n>${ID})\\s*(?:<[^>]*>)?\\s*\\([^)]*\\)?\\s*(?::\\s*[^{=;]+)?\\{\\s*$`), "method", 1],
  ],
  go: [
    [/^func\s+\((?:\w+\s+)?\*?(?<p>\w+)(?:\[[^\]]*\])?\)\s+(?<n>\w+)/, "method", 0],
    [/^func\s+(?<n>\w+)/, "function", 0],
    [/^type\s+(?<n>\w+)(?:\[[^\]]*\])?\s+struct\b/, "struct", 0],
    [/^type\s+(?<n>\w+)(?:\[[^\]]*\])?\s+interface\b/, "interface", 0],
    [/^type\s+(?<n>\w+)\b/, "type", 0],
    [/^(?:var|const)\s+(?<n>\w+)/, "const", 0],
  ],
  rust: [
    [/^\s*(?:pub(?:\([^)]*\))?\s+)?(?:const\s+|async\s+|unsafe\s+|extern\s+"[^"]*"\s+)*fn\s+(?<n>\w+)/, "function", 1],
    [/^\s*(?:pub(?:\([^)]*\))?\s+)?struct\s+(?<n>\w+)/, "struct", 0],
    [/^\s*(?:pub(?:\([^)]*\))?\s+)?enum\s+(?<n>\w+)/, "enum", 0],
    [/^\s*(?:pub(?:\([^)]*\))?\s+)?(?:unsafe\s+)?trait\s+(?<n>\w+)/, "trait", 0],
    [/^\s*(?:pub(?:\([^)]*\))?\s+)?union\s+(?<n>\w+)/, "struct", 0],
    [/^\s*(?:pub(?:\([^)]*\))?\s+)?type\s+(?<n>\w+)/, "type", 1],
    [/^\s*(?:pub(?:\([^)]*\))?\s+)?(?:const|static)\s+(?:mut\s+)?(?<n>[A-Z_][A-Z0-9_]*)/, "const", 1],
    [/^\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+(?<n>\w+)\s*\{/, "module", 0],
    [/^\s*macro_rules!\s*(?<n>\w+)/, "macro", 0],
    [/^\s*(?:unsafe\s+)?impl(?:<[^>]*>)?\s+(?:[\w:<>, ]+\s+for\s+)?(?<n>\w+)/, "impl", 0],
  ],
  jvm: [ // java, kotlin, scala, groovy, c#, swift, dart, php
    [new RegExp(`^\\s*${MODS}(?:class|interface|enum|record|struct|object|trait|protocol|extension|actor|mixin|annotation\\s+class|enum\\s+class|data\\s+class|sealed\\s+class|value\\s+class|@interface)\\s+(?<n>${ID})`), "class", 2],
    [new RegExp(`^\\s*${MODS}(?:fun|func|def|function)\\s+(?:<[^>]*>\\s*)?(?:${ID}\\.)?(?<n>${ID})`), "function", 2],
    [new RegExp(`^\\s*${MODS}(?:[\\w<>\\[\\],.?]+\\s+)+(?<n>${ID})\\s*\\([^;]*\\)\\s*(?:throws\\s+[\\w., ]+)?\\s*(?:\\{|=>|$)`), "function", 2],
    [new RegExp(`^\\s*${MODS}(?:typealias|using)\\s+(?<n>${ID})\\s*=`), "type", 1],
    [new RegExp(`^\\s*namespace\\s+(?<n>[\\w.\\\\]+)`), "module", 0],
  ],
  cfamily: [
    [/^\s*(?:typedef\s+)?(?:struct|class|union|enum(?:\s+class)?)\s+(?:\w+\s+)*?(?<n>[A-Za-z_]\w*)\s*(?:final\s*)?(?::[^{;]*)?\{?\s*$/, "class", 1],
    [/^\s*namespace\s+(?<n>[\w:]+)/, "module", 0],
    [/^\s*#\s*define\s+(?<n>[A-Za-z_]\w*)/, "macro", 9],
    [/^\s*(?:template\s*<[^>]*>\s*)?(?:(?:static|inline|extern|virtual|constexpr|explicit|friend|const|unsigned|signed|long|short|struct|enum|volatile|__\w+)\s+)*[\w:<>,*&\s]*?[\w>*&]\s+[*&]*(?<n>(?:[A-Za-z_]\w*::)*~?[A-Za-z_]\w*)\s*\([^;]*$/, "function", 1],
    [/^\s*typedef\s+[^;]*?\b(?<n>[A-Za-z_]\w*)\s*;/, "type", 0],
  ],
  zig: [[/^\s*(?:pub\s+)?(?:export\s+|extern\s+|inline\s+)*fn\s+(?<n>\w+)/, "function", 1], [/^\s*(?:pub\s+)?const\s+(?<n>\w+)\s*=\s*(?:packed\s+|extern\s+)?(?:struct|enum|union|opaque)/, "struct", 1], [/^\s*test\s+"(?<n>[^"]+)"/, "test", 0]],
  solidity: [[/^\s*(?:abstract\s+)?(?:contract|interface|library)\s+(?<n>\w+)/, "class", 0], [/^\s*(?:function|modifier|event)\s+(?<n>\w+)/, "function", 1]],
  protobuf: [[/^\s*(?:message|service|enum)\s+(?<n>\w+)/, "class", 1], [/^\s*rpc\s+(?<n>\w+)/, "function", 1]],
};
const FAMILY_OF: Record<string, string> = { javascript: "js", typescript: "js", tsx: "js", go: "go", rust: "rust", java: "jvm", kotlin: "jvm", scala: "jvm", groovy: "jvm", csharp: "jvm", swift: "jvm", dart: "jvm", php: "jvm", c: "cfamily", cpp: "cfamily", objc: "cfamily", zig: "zig", solidity: "solidity", protobuf: "protobuf" };

const IMPORTS: Record<string, RegExp[]> = {
  js: [/\bfrom\s+["']([^"']+)["']/, /^\s*import\s+["']([^"']+)["']/, /\brequire\(\s*["']([^"']+)["']\s*\)/, /\bimport\(\s*["']([^"']+)["']\s*\)/],
  go: [/^\s*import\s+(?:\w+\s+)?"([^"]+)"/, /^\s+(?:[\w.]+\s+)?"([^"]+)"\s*$/],
  rust: [/^\s*(?:pub\s+)?use\s+(\w+(?:::\w+)*(?:::\{[^}]*\})?)/, /^\s*(?:pub\s+)?mod\s+(\w+)\s*;/, /^\s*extern\s+crate\s+(\w+)/],
  jvm: [/^\s*import\s+(?:static\s+)?([\w.]+(?:\.\*)?)/, /^\s*using\s+(?:static\s+)?([\w.]+)\s*;/, /^\s*use\s+([\w\\]+)/, /^\s*(?:require|include)(?:_once)?\s*\(?\s*['"]([^'"]+)['"]/, /^\s*import\s+['"]([^'"]+)['"]/, /^\s*import\s+(\w+)\s*$/],
  cfamily: [/^\s*#\s*include\s+["<]([^">]+)[">]/, /^\s*#\s*import\s+["<]([^">]+)[">]/, /^\s*import\s+([\w.]+)\s*;/],
  zig: [/@import\(\s*"([^"]+)"\s*\)/],
  solidity: [/^\s*import\s+["']([^"']+)["']/, /\bfrom\s+["']([^"']+)["']/],
  protobuf: [/^\s*import\s+(?:public\s+)?"([^"]+)"/],
};

const IMPORT_TRIGGER: Record<string, RegExp> = { js: /\b(import|export|require)\b/, go: /^\s*(import\b|\s)/, rust: /^\s*(pub\s+)?(use|mod|extern)\b/, jvm: /^\s*(import|using|use|require|include)/, cfamily: /^\s*(#\s*(include|import)|import)\b/, zig: /@import/, solidity: /\bimport\b/, protobuf: /^\s*import\b/ };

function cLike(src: string, path: string, lang: string): FileFacts {
  const fam = FAMILY_OF[lang];
  const { code, strings } = mask(src, STYLE["c-like"]);
  const codeLines = code.split("\n"), raw = src.split("\n");
  const depth = braceDepthByLine(code);
  const L = lineIndex(src);
  const symbols: SymbolFact[] = [], imports: ImportFact[] = [], refs: RefFact[] = [];
  const containers: SymbolFact[] = [];
  const isJsx = /\.(tsx|jsx)$/.test(path);
  codeLines.forEach((cl, i) => {
    const line = i + 1, d = depth[line] ?? 0;
    // imports (use raw text: strings are blanked in `code`)
    const trigger = IMPORT_TRIGGER[fam];
    if (trigger && trigger.test(cl)) for (const re of IMPORTS[fam] || []) {
      const m = raw[i].match(re);
      if (!m) continue;
      if (fam === "go" && re.source.startsWith("^\\s+") && !insideGoImportBlock(raw, i)) continue;
      if (fam === "jvm" && /^\s*import\s+(\w+)\s*$/.test(raw[i]) && lang !== "swift") continue;
      if (fam === "rust" && m[1].includes("{")) { const [base, rest] = m[1].split("::{"); for (const part of rest.replace(/}$/, "").split(",")) imports.push({ source: `${base}::${part.trim().split(" as ")[0]}`, line }); }
      else imports.push({ source: m[1], line, names: fam === "js" ? jsNames(raw, i) : undefined });
      break;
    }
    if (fam === "cfamily" && /^\s*#/.test(cl) && !/#\s*define/.test(cl)) return;
    for (const [re, kind, maxDepth = 1] of DEFS[fam] || []) {
      if (d > maxDepth) continue;
      const m = cl.match(re); if (!m?.groups?.n) continue;
      const name = m.groups.n;
      if (isKeyword(name) || /^(if|for|while|switch|catch|return|sizeof|else)$/.test(name)) continue;
      if (kind === "method" && d === 0 && fam === "js") continue;
      const end = /\{\s*$|\{[^}]*$/.test(cl) || /^\s*$/.test(codeLines[i + 1] || "x") === false ? braceEnd(codeLines, line) : line;
      let parent = m.groups.p || containers.filter((c) => c.line < line && c.end >= line && c.kind !== "module").pop()?.name;
      let k = kind;
      let nm = name;
      if (nm.includes("::")) { const parts = nm.split("::"); nm = parts.pop()!; parent = parts.pop() || parent; k = "method"; }
      if (parent && (k === "function") && d > 0) k = "method";
      if (fam === "js" && (k === "function" || k === "class") && /^[A-Z]/.test(name) && isJsx) k = "component";
      if (fam === "zig" && k === "test") nm = raw[i].match(/test\s+"([^"]+)"/)?.[1] || nm;
      const sym: SymbolFact = { name: parent && (k === "method" || d > 0) ? `${parent}.${nm}` : nm, kind: k, line, end: Math.max(end, line), exported: /\bexport\b|\bpub\b|\bpublic\b/.test(cl) || /^[A-Z]/.test(name), sig: raw[i].trim().slice(0, 160), parent };
      symbols.push(sym);
      if (["class", "struct", "interface", "trait", "impl", "module", "enum"].includes(k)) containers.push(sym);
      // inheritance
      const ext = cl.match(/\b(?:extends|implements)\s+([\w.,\s<>]+?)\s*(?:\{|$|implements)/) || (fam === "jvm" || fam === "cfamily" ? cl.match(new RegExp(`(?:class|struct|interface|object)\\s+${name}[^:{(]*:\\s*([^{]+)`)) : null);
      if (ext) for (const b of ext[1].split(",")) { const bn = b.trim().replace(/^(public|private|protected|virtual)\s+/, "").split(/[<(\s]/)[0].split(".").pop(); if (bn && /^[A-Za-z_]/.test(bn)) refs.push({ name: bn, kind: "extends", line, in: sym.name }); }
      if (fam === "rust" && k === "impl") { const t = cl.match(/impl(?:<[^>]*>)?\s+([\w:]+)(?:<[^>]*>)?\s+for\s+/); if (t) refs.push({ name: t[1].split("::").pop()!, kind: "extends", line, in: name }); }
      break;
    }
  });
  const tops = symbols.filter((s) => !s.parent);
  const inSym = (line: number) => { let b: SymbolFact | undefined; for (const s of tops) if (line >= s.line && line <= s.end && (!b || s.line >= b.line)) b = s; return b?.name; };
  for (const c of calls(code, L)) { if (symbols.some((s) => s.line === c.line && s.name.endsWith(c.name))) continue; refs.push({ name: c.name, kind: c.member ? "mcall" : "call", line: c.line, in: inSym(c.line) }); }
  if (fam === "js") {
    for (const m of code.matchAll(/<([A-Z][\w$.]*)[\s/>]/g)) { const line = L(m.index!); refs.push({ name: m[1].split(".")[0], kind: "render", line, in: inSym(line) }); }
    for (const s of strings) { const before = code.slice(Math.max(0, s.start - 30), s.start); if (/\bclass(Name)?\s*=\s*\{?\s*$/.test(before)) { const line = L(s.start); for (const t of s.value.replace(/\$\{[^}]*\}/g, " ").split(/\s+/)) if (/^-?[_a-zA-Z][\w-]*$/.test(t)) refs.push({ name: t, kind: "style", line, in: inSym(line) }); } }
  }
  addStrings(refs, strings, L, inSym);
  return { lang, precision: "heuristic", provider: "heuristic", symbols, imports, refs };
}
function insideGoImportBlock(raw: string[], i: number) { for (let k = i - 1; k >= 0 && k > i - 200; k--) { if (/^\s*\)/.test(raw[k])) return false; if (/^\s*import\s*\(/.test(raw[k])) return true; } return false; }
function jsNames(raw: string[], i: number) {
  let txt = raw[i]; for (let k = i - 1; k >= 0 && k > i - 30 && !/^\s*(import|export)\b/.test(txt); k--) txt = raw[k] + " " + txt;
  const names: { imported: string; local: string }[] = [];
  const clause = txt.replace(/^\s*(import|export)\s+(type\s+)?/, "").split(/\bfrom\b/)[0];
  const def = clause.match(/^\s*([A-Za-z_$][\w$]*)\s*(,|$)/); if (def) names.push({ imported: "default", local: def[1] });
  const ns = clause.match(/\*\s*as\s+([\w$]+)/); if (ns) names.push({ imported: "*", local: ns[1] });
  const br = clause.match(/\{([^}]*)\}/); if (br) for (const p of br[1].split(",")) { const [a, b] = p.trim().replace(/^type\s+/, "").split(/\s+as\s+/); if (a) names.push({ imported: a, local: b || a }); }
  return names;
}
function addStrings(refs: RefFact[], strings: { start: number; value: string }[], L: (o: number) => number, inSym: (l: number) => string | undefined) {
  let n = 0;
  for (const s of strings) { const v = s.value.trim(); if (v.length < 3 || v.length > 100 || !/[A-Za-z]{2}/.test(v) || /^[\w./-]+$/.test(v) && !/\s/.test(v) && !/^[A-Z][a-z]+$/.test(v)) continue; if (++n > 300) break; const line = L(s.start); refs.push({ name: v, kind: "string", line, in: inSym(line) }); }
}

// ---------- Python, GDScript, Starlark (indentation) ----------
function indentLang(src: string, lang: string): FileFacts {
  const { code, strings } = mask(src, STYLE.python);
  const lines = code.split("\n"), raw = src.split("\n");
  const L = lineIndex(src);
  const symbols: SymbolFact[] = [], imports: ImportFact[] = [], refs: RefFact[] = [];
  const stack: { name: string; ind: number }[] = [];
  const ind = (l: string) => l.match(/^[ \t]*/)![0].replace(/\t/g, "    ").length;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]; if (!l.trim()) continue;
    const n = ind(l); while (stack.length && n <= stack.at(-1)!.ind) stack.pop();
    let m: RegExpMatchArray | null;
    if ((m = l.match(/^\s*(?:async\s+)?(?:static\s+)?func?\s+([A-Za-z_]\w*)\s*\(|^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)/))) {
      const name = m[1] || m[2];
      let start = i; while (start > 0 && /^\s*@/.test(raw[start - 1])) start--;
      const parent = stack.length ? stack.at(-1)!.name : undefined;
      const sym: SymbolFact = { name: parent ? `${parent}.${name}` : name, kind: parent ? "method" : name.startsWith("test") ? "test" : "function", line: start + 1, end: indentEnd(lines, i + 1), exported: !name.startsWith("_"), sig: raw[i].trim().slice(0, 160), parent };
      symbols.push(sym);
      for (let k = start; k < i; k++) { const r = raw[k].match(/^\s*@[\w.]*\.(route|get|post|put|patch|delete|api_route|websocket)\(\s*["']([^"']+)["']/); if (r) refs.push({ name: r[2], kind: "route", line: k + 1, in: sym.name }); }
    } else if ((m = l.match(/^\s*class\s+([A-Za-z_]\w*)\s*(?:\(([^)]*)\))?/)) || (m = l.match(/^\s*class_name\s+([A-Za-z_]\w*)/))) {
      symbols.push({ name: m[1], kind: "class", line: i + 1, end: lang === "gdscript" && /class_name/.test(l) ? lines.length : indentEnd(lines, i + 1), exported: !m[1].startsWith("_"), sig: raw[i].trim().slice(0, 160) });
      if (m[2]) for (const b of m[2].split(",")) { const bn = b.trim().split(/[.[=]/).pop()?.trim(); if (bn && /^[A-Za-z_]/.test(bn) && !/metaclass/.test(b)) refs.push({ name: b.trim().split("[")[0].split(".").pop()!, kind: "extends", line: i + 1, in: m[1] }); }
      if (!/class_name/.test(l)) stack.push({ name: m[1], ind: n });
    } else if (lang === "gdscript" && (m = l.match(/^extends\s+(\w+)|^signal\s+(\w+)/))) {
      if (m[1]) refs.push({ name: m[1], kind: "extends", line: i + 1 }); else symbols.push({ name: m[2], kind: "signal", line: i + 1, end: i + 1, exported: true });
    } else if (n === 0 && (m = l.match(/^([A-Za-z_]\w*)\s*(?::[^=]+)?=(?!=)/))) {
      symbols.push({ name: m[1], kind: "const", line: i + 1, end: indentEnd(lines, i + 1), exported: !m[1].startsWith("_"), sig: raw[i].trim().slice(0, 160) });
    }
    if ((m = l.match(/^\s*from\s+(\.*[\w.]*)\s+import\s+(.+)/))) {
      let names = m[2]; let k = i; if (names.includes("(") && !names.includes(")")) while (++k < lines.length) { names += " " + lines[k]; if (lines[k].includes(")")) break; }
      imports.push({ source: m[1], line: i + 1, names: names.replace(/[()\\]/g, " ").split(",").map((x) => x.trim()).filter(Boolean).map((x) => { const [a, b] = x.split(/\s+as\s+/); return { imported: a.trim(), local: (b || a).trim() }; }) });
    } else if ((m = l.match(/^\s*import\s+([\w.,\s]+)$/))) for (const part of m[1].split(",")) { const [a, b] = part.trim().split(/\s+as\s+/); if (a) imports.push({ source: a, line: i + 1, names: [{ imported: "*", local: b || a.split(".")[0] }] }); }
    else if (lang === "gdscript" && (m = raw[i].match(/(?:pre)?load\(\s*"([^"]+)"/))) imports.push({ source: m[1], line: i + 1 });
    else if (lang === "starlark" && (m = raw[i].match(/^load\(\s*"([^"]+)"/))) imports.push({ source: m[1], line: i + 1 });
  }
  const tops = symbols.filter((s) => !s.parent);
  const inSym = (line: number) => { let b: SymbolFact | undefined; for (const s of tops) if (line >= s.line && line <= s.end && (!b || s.line >= b.line)) b = s; return b?.name; };
  for (const c of calls(code, L)) if (!symbols.some((s) => s.line === c.line)) refs.push({ name: c.name, kind: c.member ? "mcall" : "call", line: c.line, in: inSym(c.line) });
  addStrings(refs, strings, L, inSym);
  return { lang, precision: "heuristic", provider: "heuristic", symbols, imports, refs };
}

// ---------- Ruby, Elixir, Lua (end-delimited) ----------
function endLang(src: string, lang: string): FileFacts {
  const { code, strings } = mask(src, lang === "lua" ? STYLE.lua : STYLE.ruby);
  const lines = code.split("\n"), raw = src.split("\n"); const L = lineIndex(src);
  const symbols: SymbolFact[] = [], imports: ImportFact[] = [], refs: RefFact[] = [];
  const open: { sym: SymbolFact; ind: number }[] = [];
  const ind = (l: string) => l.match(/^\s*/)![0].length;
  lines.forEach((l, i) => {
    let m: RegExpMatchArray | null; const line = i + 1;
    const parent = open.filter((o) => ["class", "module"].includes(o.sym.kind)).at(-1)?.sym.name;
    if ((m = l.match(/^\s*(class|module|defmodule)\s+([A-Z][\w:.]*)(?:\s*<\s*([\w:]+))?/))) { const s = { name: m[2], kind: m[1] === "class" ? "class" : "module", line, end: line, exported: true, sig: raw[i].trim() }; symbols.push(s); open.push({ sym: s, ind: ind(l) }); if (m[3]) refs.push({ name: m[3].split("::").pop()!, kind: "extends", line, in: m[2] }); }
    else if ((m = l.match(/^\s*(?:def|defp|defmacro)\s+(?:self\.)?([\w?!=]+)/)) || (m = l.match(/^\s*(?:local\s+)?function\s+([\w.:]+)/))) { const name = m[1]; const s = { name: parent ? `${parent}.${name}` : name, kind: parent ? "method" : "function", line, end: line, exported: !/defp|local/.test(l), sig: raw[i].trim().slice(0, 160), parent }; symbols.push(s); if (!/\bend\s*$/.test(l) && !/,\s*do:/.test(l)) open.push({ sym: s, ind: ind(l) }); }
    else if ((m = l.match(/^\s*end\b/))) { const k = [...open].reverse().findIndex((o) => o.ind === ind(l)); if (k >= 0) { const idx = open.length - 1 - k; open[idx].sym.end = line; open.splice(idx); } }
    if ((m = raw[i].match(/^\s*require(?:_relative)?\s*\(?\s*["']([^"']+)/)) || (m = raw[i].match(/\brequire\s*\(?\s*["']([^"']+)["']/)) || (m = raw[i].match(/^\s*(?:import|alias|use)\s+([A-Z][\w.]*)/))) imports.push({ source: m[1], line });
  });
  for (const o of open) o.sym.end = lines.length;
  const tops = symbols.filter((s) => !s.parent);
  const inSym = (line: number) => { let b: SymbolFact | undefined; for (const s of tops) if (line >= s.line && line <= s.end && (!b || s.line >= b.line)) b = s; return b?.name; };
  for (const c of calls(code, L)) refs.push({ name: c.name, kind: c.member ? "mcall" : "call", line: c.line, in: inSym(c.line) });
  addStrings(refs, strings, L, inSym);
  return { lang, precision: "heuristic", provider: "heuristic", symbols, imports, refs };
}

// ---------- config, infra, data, docs ----------
function configLang(src: string, lang: string, path: string): FileFacts {
  const raw = src.split("\n"); const symbols: SymbolFact[] = [], imports: ImportFact[] = [], refs: RefFact[] = [];
  const add = (name: string, kind: string, line: number, end = line, sig?: string) => symbols.push({ name, kind, line, end, exported: true, sig: (sig ?? raw[line - 1]).trim().slice(0, 160) });
  if (lang === "sql") {
    const { code } = mask(src, STYLE.sql); const lines = code.split("\n");
    lines.forEach((l, i) => {
      const m = l.match(/^\s*CREATE\s+(?:OR\s+REPLACE\s+)?(?:TEMP(?:ORARY)?\s+|UNIQUE\s+|MATERIALIZED\s+)*(TABLE|VIEW|FUNCTION|PROCEDURE|INDEX|TRIGGER|TYPE|SCHEMA|SEQUENCE)\s+(?:IF\s+NOT\s+EXISTS\s+)?([\w."`\[\]]+)/i);
      if (m) { let e = i; while (e < lines.length - 1 && !/;\s*$/.test(lines[e])) e++; add(m[2].replace(/["`\[\]]/g, ""), m[1].toLowerCase(), i + 1, e + 1); }
      for (const r of l.matchAll(/\b(?:REFERENCES|FROM|JOIN|INTO|UPDATE|TABLE)\s+([\w."`]+)/gi)) refs.push({ name: r[1].replace(/["`]/g, "").split(".").pop()!, kind: "ref", line: i + 1 });
    });
  } else if (lang === "hcl") {
    const { code } = mask(src, STYLE.hcl); const lines = code.split("\n");
    lines.forEach((l, i) => {
      const m = raw[i].match(/^\s*(resource|data|module|variable|output|provider|locals|terraform)\s*(?:"([^"]+)")?\s*(?:"([^"]+)")?\s*\{/);
      if (m) { const name = m[1] === "resource" ? `${m[2]}.${m[3]}` : m[1] === "data" ? `data.${m[2]}.${m[3]}` : m[2] ? `${m[1] === "variable" ? "var" : m[1]}.${m[2]}` : m[1]; add(name, m[1] === "resource" || m[1] === "data" ? "resource" : m[1], i + 1, braceEnd(lines, i + 1)); }
      const s = raw[i].match(/^\s*source\s*=\s*"([^"]+)"/); if (s) imports.push({ source: s[1], line: i + 1 });
      for (const r of raw[i].matchAll(/\b(var\.\w+|module\.\w+|local\.\w+|data\.\w+\.\w+|[a-z]+_[a-z0-9_]+\.[a-z0-9_]+)\b/g)) refs.push({ name: r[1], kind: "ref", line: i + 1 });
    });
  } else if (lang === "dockerfile") {
    raw.forEach((l, i) => {
      let m = l.match(/^\s*FROM\s+(?:--\S+\s+)*(\S+)(?:\s+AS\s+(\S+))?/i); if (m) { imports.push({ source: m[1], line: i + 1 }); if (m[2]) add(m[2], "stage", i + 1); }
      m = l.match(/--from=(\S+)/); if (m) refs.push({ name: m[1], kind: "ref", line: i + 1 });
      if (/^\s*(ENTRYPOINT|CMD)\b/i.test(l)) add(l.trim().split(/\s+/)[0].toUpperCase(), "entry", i + 1);
    });
  } else if (lang === "yaml") {
    let section = "", kind = "";
    raw.forEach((l, i) => {
      const top = l.match(/^([A-Za-z_][\w.-]*):/); if (top) { section = top[1]; if (!["jobs", "services", "on", "kind", "metadata", "spec"].includes(section)) add(section, "key", i + 1, yamlEnd(raw, i)); }
      const k = l.match(/^kind:\s*(\w+)/); if (k) kind = k[1];
      const nm = l.match(/^\s{2}name:\s*["']?([\w.-]+)/); if (nm && kind) { add(`${kind}/${nm[1]}`, "resource", i + 1); kind = ""; }
      const sub = l.match(/^ {2}([A-Za-z_][\w.-]*):/); if (sub && (section === "jobs" || section === "services")) add(sub[1], section === "jobs" ? "job" : "service", i + 1, yamlEnd(raw, i));
      const u = l.match(/^\s*-?\s*uses:\s*["']?([^\s"'@]+)/); if (u) imports.push({ source: u[1], line: i + 1 });
      const img = l.match(/^\s*image:\s*["']?([^\s"']+)/); if (img) imports.push({ source: img[1], line: i + 1 });
    });
  } else if (lang === "make") {
    raw.forEach((l, i) => { const m = l.match(/^([A-Za-z_][\w.%/-]*)\s*:(?!=)/); if (m && !l.startsWith("\t")) { let e = i; while (e + 1 < raw.length && /^\t/.test(raw[e + 1])) e++; add(m[1], "target", i + 1, e + 1); } const inc = l.match(/^-?include\s+(\S+)/); if (inc) imports.push({ source: inc[1], line: i + 1 }); });
  } else if (lang === "shell" || lang === "powershell" || lang === "batch") {
    const { code } = mask(src, STYLE.shell); const lines = code.split("\n");
    lines.forEach((l, i) => { const m = l.match(/^\s*(?:function\s+([\w:-]+)|([\w:-]+)\s*\(\)\s*\{?)/); if (m) add(m[1] || m[2], "function", i + 1, braceEnd(lines, i + 1)); const s = raw[i].match(/^\s*(?:source|\.)\s+["']?([^\s"']+)/); if (s) imports.push({ source: s[1], line: i + 1 }); });
    const L = lineIndex(src); for (const c of calls(code, L)) refs.push({ name: c.name, kind: "call", line: c.line });
  } else if (lang === "toml" || lang === "ini") {
    raw.forEach((l, i) => { const m = l.match(/^\s*\[{1,2}([^\]]+)\]{1,2}/); if (m) add(m[1].trim(), "section", i + 1, sectionEnd(raw, i)); });
  } else if (lang === "godot-scene" || lang === "godot-resource") {
    raw.forEach((l, i) => { let m = l.match(/^\[node\s+name="([^"]+)"(?:\s+type="([^"]+)")?/); if (m) add(m[1], m[2] ? `node:${m[2]}` : "node", i + 1); m = l.match(/path="(res:\/\/[^"]+)"/); if (m) imports.push({ source: m[1], line: i + 1 }); });
  } else if (lang === "markdown" || lang === "rst" || lang === "asciidoc") {
    let fence = false; const heads: SymbolFact[] = [];
    raw.forEach((l, i) => { if (/^\s*```/.test(l)) fence = !fence; const m = !fence && (l.match(/^(#{1,4})\s+(.+)/) || l.match(/^(={1,4})\s+(.+)/)); if (m) heads.push({ name: m[2].trim().slice(0, 100), kind: `h${m[1].length}`, line: i + 1, end: raw.length, exported: true }); });
    heads.forEach((h, k) => { const lvl = +h.kind.slice(1); const nxt = heads.slice(k + 1).find((x) => +x.kind.slice(1) <= lvl); h.end = nxt ? nxt.line - 1 : raw.length; symbols.push(h); });
    for (const m of src.matchAll(/\]\(([^)#\s]+\.(?:md|rst|ts|js|py|go|rs|java|cs|cpp|c|h))\)/g)) imports.push({ source: m[1], line: lineIndex(src)(m.index!) });
  }
  return { lang, precision: "heuristic", provider: "heuristic", symbols, imports, refs };
}
const yamlEnd = (raw: string[], i: number) => { const base = raw[i].match(/^\s*/)![0].length; let e = i; for (let k = i + 1; k < raw.length; k++) { if (!raw[k].trim() || /^\s*#/.test(raw[k])) continue; if (raw[k].match(/^\s*/)![0].length <= base && !/^\s*-/.test(raw[k].slice(base) ? "" : raw[k])) break; e = k; } return e + 1; };
const sectionEnd = (raw: string[], i: number) => { let e = i; for (let k = i + 1; k < raw.length; k++) { if (/^\s*\[/.test(raw[k])) break; if (raw[k].trim()) e = k; } return e + 1; };

function cssLang(src: string, lang: string): FileFacts {
  const symbols: SymbolFact[] = [], refs: RefFact[] = [];
  const { rules, comments } = parseCss(src);
  for (const r of rules) {
    const classes = [...new Set((r.sel.match(/\.(-?[_a-zA-Z][\w-]*)/g) || []).map((c) => c.slice(1)))];
    for (const c of classes) symbols.push({ name: `.${c}`, kind: "css-class", line: r.line, end: r.end, exported: true, sig: `${r.ctx ? r.ctx + " " : ""}${r.sel}`.slice(0, 160), parent: r.ctx || undefined });
    if (!classes.length) symbols.push({ name: r.sel.slice(0, 80), kind: "css-rule", line: r.line, end: r.end, exported: true, sig: `${r.ctx ? r.ctx + " " : ""}${r.sel}`.slice(0, 160) });
    for (const d of r.decls) for (const m of d.value.matchAll(/var\((--[\w-]+)/g)) refs.push({ name: m[1], kind: "ref", line: d.line });
  }
  for (const c of comments) if (c.text.length < 120) symbols.push({ name: c.text.replace(/\s+/g, " ").slice(0, 80), kind: "section", line: c.line, end: c.line, exported: false });
  return { lang, precision: "heuristic", provider: "heuristic", symbols, imports: [], refs, meta: { rules: rules.length } };
}

function sfc(src: string, lang: string, path: string): FileFacts {
  const m = src.match(/<script[^>]*>([\s\S]*?)<\/script>/);
  const offset = m ? src.slice(0, m.index! + m[0].indexOf(">") + 1).split("\n").length - 1 : 0;
  const facts = m ? cLike(m[1], path.replace(/\.(vue|svelte|astro)$/, /lang=["']ts/.test(m[0]) ? ".ts" : ".js"), "typescript") : { symbols: [], imports: [], refs: [] } as any;
  for (const s of facts.symbols) { s.line += offset; s.end += offset; }
  for (const x of [...facts.imports, ...facts.refs]) x.line += offset;
  const name = path.split("/").pop()!.replace(/\.\w+$/, "");
  facts.symbols.unshift({ name, kind: "component", line: 1, end: src.split("\n").length, exported: true, sig: `<${name}>` });
  const L = lineIndex(src);
  for (const x of src.matchAll(/<([A-Z][\w.]*)[\s/>]/g)) facts.refs.push({ name: x[1], kind: "render", line: L(x.index!), in: name });
  for (const x of src.matchAll(/\sclass=["']([^"'{}]+)["']/g)) for (const t of x[1].split(/\s+/)) if (t) facts.refs.push({ name: t, kind: "style", line: L(x.index!), in: name });
  return { lang, precision: "heuristic", provider: "heuristic", symbols: facts.symbols, imports: facts.imports, refs: facts.refs };
}

const CONFIG = new Set(["sql", "hcl", "dockerfile", "yaml", "make", "shell", "powershell", "batch", "toml", "ini", "godot-scene", "godot-resource", "markdown", "rst", "asciidoc"]);
export const heuristicProvider: IntelProvider = {
  id: "heuristic",
  precision: "heuristic",
  languages: () => [...Object.keys(FAMILY_OF), "python", "gdscript", "starlark", "ruby", "elixir", "lua", "css", "scss", "less", "vue", "svelte", "astro", ...CONFIG],
  extract(text, path, lang) {
    if (FAMILY_OF[lang]) return cLike(text, path, lang);
    if (lang === "python" || lang === "gdscript" || lang === "starlark") return indentLang(text, lang);
    if (lang === "ruby" || lang === "elixir" || lang === "lua") return endLang(text, lang);
    if (lang === "css" || lang === "scss" || lang === "less") return cssLang(text, lang);
    if (lang === "vue" || lang === "svelte" || lang === "astro") return sfc(text, lang, path);
    if (CONFIG.has(lang)) return configLang(text, lang, path);
    return null;
  },
};
