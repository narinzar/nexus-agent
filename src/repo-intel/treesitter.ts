// L1 "syntactic" intelligence provider: tree-sitter (WASM, no compiler) with table-driven extraction.
// Grammars come from the optional dependency @vscode/tree-sitter-wasm (MIT, 16 grammars). Adding a language is one
// LANGS entry plus a grammar .wasm (e.g. from tree-sitter-language-pack).
import { createRequire } from "node:module";
import path from "node:path";
import type { FileFacts, IntelProvider, SymbolFact, ImportFact, RefFact } from "../core/types.ts";

interface LangSpec {
  wasm: string;
  defs: Record<string, { kind: string; name?: string[]; container?: boolean }>; // node type -> kind; name = field path candidates
  calls: Record<string, string[]>; // node type -> field names holding the callee
  imports: Record<string, (text: string) => string[]>; // node type -> sources from node text
  bases?: Record<string, string>; // node type holding base types -> searched for type identifiers
  render?: string[]; // JSX element node types
}
const q = (re: RegExp) => (t: string) => [...t.matchAll(re)].map((m) => m[1]);
const JS: LangSpec = {
  wasm: "javascript",
  defs: {
    function_declaration: { kind: "function" }, generator_function_declaration: { kind: "function" },
    class_declaration: { kind: "class", container: true }, abstract_class_declaration: { kind: "class", container: true },
    method_definition: { kind: "method" }, interface_declaration: { kind: "interface", container: true },
    type_alias_declaration: { kind: "type" }, enum_declaration: { kind: "enum" },
    variable_declarator: { kind: "const" }, public_field_definition: { kind: "field" },
  },
  calls: { call_expression: ["function"], new_expression: ["constructor"] },
  imports: { import_statement: q(/from\s*["']([^"']+)["']|^import\s*["']([^"']+)["']/g), export_statement: q(/from\s*["']([^"']+)["']/g) },
  bases: { class_heritage: "", extends_clause: "", implements_clause: "" },
  render: ["jsx_opening_element", "jsx_self_closing_element"],
};
const LANGS: Record<string, LangSpec> = {
  javascript: JS,
  typescript: { ...JS, wasm: "typescript" },
  tsx: { ...JS, wasm: "tsx" },
  python: {
    wasm: "python",
    defs: { function_definition: { kind: "function" }, class_definition: { kind: "class", container: true } },
    calls: { call: ["function"] },
    imports: { import_statement: q(/import\s+([\w.]+)/g), import_from_statement: q(/from\s+(\.*[\w.]*)\s+import/g) },
    bases: { argument_list: "class_definition" },
  },
  go: {
    wasm: "go",
    defs: { function_declaration: { kind: "function" }, method_declaration: { kind: "method" }, type_spec: { kind: "type" } },
    calls: { call_expression: ["function"] },
    imports: { import_spec: q(/"([^"]+)"/g) },
  },
  rust: {
    wasm: "rust",
    defs: { function_item: { kind: "function" }, function_signature_item: { kind: "function" }, struct_item: { kind: "struct", container: true }, enum_item: { kind: "enum", container: true }, trait_item: { kind: "trait", container: true }, impl_item: { kind: "impl", name: ["type"], container: true }, mod_item: { kind: "module", container: true }, type_item: { kind: "type" }, const_item: { kind: "const" }, static_item: { kind: "const" }, macro_definition: { kind: "macro" }, union_item: { kind: "struct" } },
    calls: { call_expression: ["function"], macro_invocation: ["macro"] },
    imports: { use_declaration: (t) => expandRustUse(t.replace(/^\s*(pub(\([^)]*\))?\s+)?use\s+/, "").replace(/;\s*$/, "")), mod_item: (t) => (/;\s*$/.test(t) ? [t.match(/mod\s+(\w+)/)?.[1] || ""] : []), extern_crate_declaration: q(/crate\s+(\w+)/g) },
  },
  java: {
    wasm: "java",
    defs: { class_declaration: { kind: "class", container: true }, interface_declaration: { kind: "interface", container: true }, enum_declaration: { kind: "enum", container: true }, record_declaration: { kind: "class", container: true }, annotation_type_declaration: { kind: "interface" }, method_declaration: { kind: "method" }, constructor_declaration: { kind: "method" } },
    calls: { method_invocation: ["name"], object_creation_expression: ["type"] },
    imports: { import_declaration: q(/import\s+(?:static\s+)?([\w.*]+)/g) },
    bases: { superclass: "", super_interfaces: "", extends_interfaces: "" },
  },
  csharp: {
    wasm: "c-sharp",
    defs: { class_declaration: { kind: "class", container: true }, struct_declaration: { kind: "struct", container: true }, interface_declaration: { kind: "interface", container: true }, enum_declaration: { kind: "enum" }, record_declaration: { kind: "class", container: true }, method_declaration: { kind: "method" }, constructor_declaration: { kind: "method" }, property_declaration: { kind: "field" }, namespace_declaration: { kind: "module", container: true }, file_scoped_namespace_declaration: { kind: "module" } },
    calls: { invocation_expression: ["function"], object_creation_expression: ["type"] },
    imports: { using_directive: q(/using\s+(?:static\s+)?(?:\w+\s*=\s*)?([\w.]+)/g) },
    bases: { base_list: "" },
  },
  cpp: {
    wasm: "cpp",
    defs: { function_definition: { kind: "function", name: ["declarator"] }, class_specifier: { kind: "class", container: true }, struct_specifier: { kind: "struct", container: true }, enum_specifier: { kind: "enum" }, union_specifier: { kind: "struct" }, namespace_definition: { kind: "module", container: true }, preproc_def: { kind: "macro" }, preproc_function_def: { kind: "macro" }, type_definition: { kind: "type", name: ["declarator"] } },
    calls: { call_expression: ["function"] },
    imports: { preproc_include: q(/#\s*include\s*[<"]([^>"]+)[>"]/g) },
    bases: { base_class_clause: "" },
  },
  php: {
    wasm: "php",
    defs: { class_declaration: { kind: "class", container: true }, interface_declaration: { kind: "interface", container: true }, trait_declaration: { kind: "trait", container: true }, enum_declaration: { kind: "enum" }, function_definition: { kind: "function" }, method_declaration: { kind: "method" } },
    calls: { function_call_expression: ["function"], member_call_expression: ["name"], scoped_call_expression: ["name"], object_creation_expression: [""] },
    imports: { namespace_use_declaration: q(/([\w\\]+\\[\w]+)/g), require_once_expression: q(/['"]([^'"]+)['"]/g), require_expression: q(/['"]([^'"]+)['"]/g), include_expression: q(/['"]([^'"]+)['"]/g) },
    bases: { base_clause: "", class_interface_clause: "" },
  },
  ruby: {
    wasm: "ruby",
    defs: { class: { kind: "class", container: true }, module: { kind: "module", container: true }, method: { kind: "method" }, singleton_method: { kind: "method" } },
    calls: { call: ["method"] },
    imports: { call: (t) => { const m = t.match(/^require(?:_relative)?\s*\(?\s*["']([^"']+)/); return m ? [m[1]] : []; } },
    bases: { superclass: "" },
  },
  shell: {
    wasm: "bash",
    defs: { function_definition: { kind: "function" } },
    calls: { command: ["name"] },
    imports: { command: (t) => { const m = t.match(/^(?:source|\.)\s+["']?([^\s"']+)/); return m ? [m[1]] : []; } },
  },
};
LANGS.c = LANGS.cpp;

function expandRustUse(t: string): string[] {
  const m = t.match(/^([\w:]*)::\{([\s\S]*)\}$/);
  if (!m) return [t.split(" as ")[0].trim()];
  return m[2].split(",").map((x) => x.trim()).filter(Boolean).flatMap((x) => expandRustUse(`${m[1]}::${x}`));
}

let Parser: any, Language: any, wasmDir = "";
const loaded = new Map<string, any>();
const parsers = new Map<string, any>();
let available: boolean | null = null;

export async function initTreeSitter(): Promise<boolean> {
  if (available !== null) return available;
  try {
    const req = createRequire(import.meta.url);
    const mod = req("@vscode/tree-sitter-wasm");
    Parser = mod.Parser; Language = mod.Language;
    wasmDir = path.join(path.dirname(req.resolve("@vscode/tree-sitter-wasm/package.json")), "wasm");
    await Parser.init();
    for (const [id, spec] of Object.entries(LANGS)) {
      if (loaded.has(spec.wasm)) { parsers.set(id, parsers.get(Object.keys(LANGS).find((k) => LANGS[k].wasm === spec.wasm)!)); continue; }
      try { const lang = await Language.load(path.join(wasmDir, `tree-sitter-${spec.wasm}.wasm`)); loaded.set(spec.wasm, lang); const p = new Parser(); p.setLanguage(lang); parsers.set(id, p); } catch { /* grammar missing: heuristic provider covers it */ }
    }
    available = parsers.size > 0;
  } catch { available = false; }
  return available;
}

const IDENT_TYPES = new Set(["identifier", "type_identifier", "field_identifier", "property_identifier", "constant", "name", "namespace_identifier", "word", "command_name", "private_property_identifier", "simple_identifier", "scoped_identifier", "qualified_identifier", "destructor_name", "operator_name", "scoped_type_identifier", "generic_type", "qualified_name"]);
/** Best-effort name of a definition node: the `name` field, or the first identifier inside the given fields (C declarators). */
function nodeName(node: any, fields?: string[]): string | null {
  const n = node.childForFieldName("name");
  if (n && !fields) return n.text;
  for (const f of fields || []) {
    let d = node.childForFieldName(f);
    while (d && !IDENT_TYPES.has(d.type)) d = d.childForFieldName("declarator") || d.childForFieldName("name") || d.childForFieldName("type") || d.namedChildren.find((c: any) => IDENT_TYPES.has(c.type) || /declarator$/.test(c.type)) || null;
    if (d) return d.text.replace(/^.*::/, "").replace(/<.*$/, "");
  }
  if (n) return n.text;
  return null;
}
/** Callee name: last identifier of the callee expression (a.b.c() -> c, ns::f() -> f, obj->m() -> m). */
function calleeName(node: any, fields: string[]): string | null {
  for (const f of fields) {
    let c = f ? node.childForFieldName(f) : node.namedChildren.find((x: any) => IDENT_TYPES.has(x.type) || x.type.endsWith("name"));
    if (!c) continue;
    for (let i = 0; i < 6 && c && !IDENT_TYPES.has(c.type); i++) c = c.childForFieldName("property") || c.childForFieldName("field") || c.childForFieldName("name") || c.childForFieldName("attribute") || c.childForFieldName("member") || c.namedChildren.at(-1) || null;
    if (c) return c.text.replace(/^.*(::|\\|\.)/, "").replace(/<.*$/, "");
  }
  return null;
}

export const treeSitterProvider: IntelProvider = {
  id: "tree-sitter",
  precision: "syntactic",
  languages: () => [...parsers.keys()],
  init: initTreeSitter,
  extract(text, file, lang) {
    const parser = parsers.get(lang); const spec = LANGS[lang];
    if (!parser || !spec) return null;
    const tree = parser.parse(text);
    const symbols: SymbolFact[] = [], imports: ImportFact[] = [], refs: RefFact[] = [];
    const syntaxErrors: { line: number; message: string }[] = [];
    const lines = text.split("\n");
    const stack: { name: string; end: number; container: boolean; module?: boolean }[] = [];
    const topAt: { name: string; line: number; end: number }[] = [];
    const isJsx = lang === "tsx" || /\.jsx$/.test(file);
    const visit = (node: any) => {
      const t = node.type;
      const line = node.startPosition.row + 1, end = node.endPosition.row + 1;
      while (stack.length && stack.at(-1)!.end < line) stack.pop();
      if (node.isMissing || t === "ERROR") { if (syntaxErrors.length < 5) syntaxErrors.push({ line, message: node.isMissing ? `missing ${t}` : `unexpected "${node.text.slice(0, 30)}"` }); }
      let pushed = false;
      const def = spec.defs[t];
      if (def) {
        let name: string | null = nodeName(node, def.name);
        // variable_declarator: keep only top-level ones (module constants, arrow-function components)
        if (t === "variable_declarator" && (stack.length || node.parent?.parent?.parent?.type !== "program" && node.parent?.parent?.type !== "program")) name = null;
        if (t === "type_spec") { const ty = node.childForFieldName("type")?.type; def.kind = ty === "struct_type" ? "struct" : ty === "interface_type" ? "interface" : "type"; }
        if (name && name.length < 200) {
          const parentC = stack.filter((s) => s.container && !s.module).at(-1);
          let kind = def.kind;
          if (t === "variable_declarator") { const v = node.childForFieldName("value")?.type || ""; kind = /arrow_function|function/.test(v) ? "function" : "const"; }
          if ((kind === "function") && parentC) kind = "method";
          if (t === "method_declaration" && lang === "go") { const recv = node.childForFieldName("receiver")?.text.match(/\*?\s*(\w+)\s*(\[[^\]]*\])?\)\s*$/); if (recv) { symbols.push({ name: `${recv[1]}.${name}`, kind: "method", line, end, exported: /^[A-Z]/.test(name), sig: lines[line - 1].trim().slice(0, 160), parent: recv[1] }); name = null; } }
          if (name && name.includes("::")) { const parts = name.split("::"); name = parts.pop()!; const owner = parts.pop(); if (owner) { symbols.push({ name: `${owner}.${name}`, kind: "method", line, end, exported: true, sig: lines[line - 1].trim().slice(0, 160), parent: owner }); stack.push({ name: `${owner}.${name}`, end, container: false }); pushed = true; name = null; } }
          if (name) {
            if (isJsx && /^[A-Z]/.test(name) && (kind === "function" || kind === "class" || kind === "const") && /<[A-Za-z>]/.test(node.text)) kind = "component";
            const full = parentC && kind !== "module" ? `${parentC.name}.${name}` : name;
            const exported = /^\s*(export|pub|public)\b/.test(lines[line - 1]) || node.parent?.type === "export_statement" || /^[A-Z]/.test(name) && lang === "go" || !name.startsWith("_") && lang === "python";
            symbols.push({ name: full, kind, line, end, exported, sig: lines[line - 1].trim().slice(0, 160), parent: parentC?.name });
            if (!stack.length) topAt.push({ name: full, line, end });
            stack.push({ name: full, end, container: !!def.container, module: kind === "module" }); pushed = true;
          }
        }
      }
      const callF = spec.calls[t];
      if (callF) { const n = calleeName(node, callF); if (n && n.length < 100) { const fn = node.childForFieldName(callF[0] || "function"); const member = !!fn && /member|field|attribute|selector|scoped|qualified/.test(fn.type) || t === "method_invocation" && !!node.childForFieldName("object") || t === "member_call_expression" || (t === "call" && !!node.childForFieldName("receiver")); refs.push({ name: n, kind: member ? "mcall" : "call", line }); } }
      if (spec.render?.includes(t)) { const n = node.childForFieldName("name")?.text; if (n && /^[A-Z]/.test(n)) refs.push({ name: n.split(".")[0], kind: "render", line }); }
      if (t === "jsx_attribute" && /^class(Name)?\b/.test(node.text)) { const v = node.text.match(/=\s*\{?\s*["'`]([^"'`]+)["'`]/); if (v) for (const c of v[1].replace(/\$\{[^}]*\}/g, " ").split(/\s+/)) if (/^-?[_a-zA-Z][\w-]*$/.test(c)) refs.push({ name: c, kind: "style", line }); }
      const imp = spec.imports[t];
      if (imp) for (const s of imp(node.text)) if (s) imports.push({ source: s, line });
      if (spec.bases && t in spec.bases && (!spec.bases[t] || node.parent?.type === spec.bases[t])) {
        const owner = stack.filter((s) => s.container).at(-1)?.name || symbols.at(-1)?.name;
        for (const m of node.text.matchAll(/([A-Z][\w]*)\s*(?:<[^>]*>)?\s*(?:[,({]|$)/g)) refs.push({ name: m[1], kind: "extends", line, in: owner });
      }
      if ((t === "string" || t === "string_literal" || t === "interpreted_string_literal" || t === "template_string") && refs.length < 2000) {
        const v = node.text.slice(1, -1).trim();
        if (v.length >= 3 && v.length <= 100 && /[A-Za-z]{2}/.test(v) && /\s|^[A-Z][a-z]+$/.test(v)) refs.push({ name: v, kind: "string", line });
      }
      if (t === "jsx_text") { const v = node.text.trim(); if (v.length > 1 && v.length <= 100) refs.push({ name: v, kind: "string", line }); }
      for (let i = 0; i < node.namedChildCount; i++) visit(node.namedChild(i));
      if (pushed && stack.length && stack.at(-1)!.end === end) stack.pop();
    };
    visit(tree.rootNode);
    if (tree.rootNode.hasError) { // missing tokens are unnamed nodes: walk every child of subtrees that contain errors
      const errs = (n: any) => { if (syntaxErrors.length >= 5) return; if (n.isMissing || n.isError || n.type === "ERROR") { syntaxErrors.push({ line: n.startPosition.row + 1, message: n.isMissing ? `missing "${n.type}"` : `unexpected "${n.text.slice(0, 30)}"` }); return; } for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c.hasError || c.isMissing) errs(c); } };
      syntaxErrors.length = 0; errs(tree.rootNode);
    }
    const inSym = (line: number) => { let b: { name: string; line: number } | undefined; for (const s of topAt) if (line >= s.line && line <= s.end && (!b || s.line >= b.line)) b = s; return b?.name; };
    for (const r of refs) if (!r.in) r.in = inSym(r.line);
    tree.delete?.();
    return { lang, precision: "syntactic", provider: "tree-sitter", symbols, imports, refs, syntaxErrors };
  },
};
