// Import resolution across ecosystems. Returns a repo-relative file, "dir:<path>/" (a package directory: Go, Java
// wildcard imports) or "ns:<name>" (C# namespaces), or null for external packages.
import fs from "node:fs";
import path from "node:path";

export interface ResolveCtx {
  root: string;
  files: Set<string>;
  byBase: Map<string, string[]>; // basename -> files
  aliases: Record<string, string>; // "@/" -> "src/"
  goModules: { module: string; dir: string }[];
}

const norm = (p: string) => path.posix.normalize(p).replace(/^\.\//, "").replace(/\/$/, "");
const first = (ctx: ResolveCtx, cands: string[]) => cands.map(norm).find((c) => ctx.files.has(c)) || null;

export function buildResolveCtx(root: string, files: string[]): ResolveCtx {
  const byBase = new Map<string, string[]>();
  for (const f of files) { const b = path.posix.basename(f); (byBase.get(b) || byBase.set(b, []).get(b)!).push(f); }
  const aliases: Record<string, string> = {};
  for (const f of files.filter((f) => /(^|\/)(tsconfig|jsconfig)[\w.-]*\.json$/.test(f) && !f.includes("node_modules/"))) {
    try {
      const co = parseJsonc(fs.readFileSync(path.join(root, f), "utf8"))?.compilerOptions; if (!co?.paths) continue;
      const base = path.posix.join(path.posix.dirname(f), co.baseUrl || ".");
      for (const [k, v] of Object.entries<any>(co.paths)) if (k.endsWith("/*") && v[0]?.endsWith("/*")) aliases[k.slice(0, -1)] = norm(path.posix.join(base, v[0].slice(0, -1))) + "/";
    } catch {}
  }
  const goModules: ResolveCtx["goModules"] = [];
  for (const f of files.filter((f) => /(^|\/)go\.mod$/.test(f))) { try { const m = fs.readFileSync(path.join(root, f), "utf8").match(/^module\s+(\S+)/m); if (m) goModules.push({ module: m[1], dir: path.posix.dirname(f) }); } catch {} }
  return { root, files: new Set(files), byBase, aliases, goModules };
}

const JS_EXT = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts", ".vue", ".svelte", ".css", ".scss", ".json", "/index.ts", "/index.tsx", "/index.js", "/index.jsx", "/index.mjs"];

export function resolveImport(ctx: ResolveCtx, from: string, lang: string, spec: string): string | null {
  const dir = path.posix.dirname(from);
  switch (lang) {
    case "javascript": case "typescript": case "tsx": case "vue": case "svelte": case "astro": {
      let base: string | null = null;
      const alias = Object.keys(ctx.aliases).filter((a) => spec.startsWith(a)).sort((a, b) => b.length - a.length)[0];
      if (alias) base = ctx.aliases[alias] + spec.slice(alias.length);
      else if (spec.startsWith(".")) base = path.posix.join(dir, spec);
      if (base === null) return null;
      const b = norm(base);
      // TS sources import "./x.js" meaning ./x.ts
      return first(ctx, [...JS_EXT.map((e) => b + e), b.replace(/\.js$/, ".ts"), b.replace(/\.js$/, ".tsx"), b.replace(/\.mjs$/, ".mts")]);
    }
    case "python": case "gdscript": case "starlark": {
      if (spec.startsWith("res://")) return first(ctx, [spec.slice(6)]);
      const dots = spec.match(/^\.*/)![0].length; const mod = spec.slice(dots).replace(/\./g, "/");
      const bases: string[] = [];
      if (dots) { let d = dir; for (let k = 1; k < dots; k++) d = path.posix.dirname(d); bases.push(d === "." ? "" : d + "/"); }
      else { bases.push("", "src/", "lib/"); const top = from.split("/")[0]; if (top !== from) bases.push(top + "/"); }
      for (const b of bases) { const r = first(ctx, mod ? [`${b}${mod}.py`, `${b}${mod}/__init__.py`, `${b}${mod}.gd`] : [`${b}__init__.py`]); if (r) return r; }
      return null;
    }
    case "go": {
      for (const m of ctx.goModules) if (spec === m.module || spec.startsWith(m.module + "/")) { const d = norm(path.posix.join(m.dir, spec.slice(m.module.length + 1))); return [...ctx.files].some((f) => path.posix.dirname(f) === d && f.endsWith(".go")) ? `dir:${d}/` : null; }
      return null;
    }
    case "rust": {
      if (/^\w+$/.test(spec)) { // `mod x;`
        const stem = path.posix.basename(from, ".rs");
        const here = ["main", "lib", "mod"].includes(stem) ? dir : path.posix.join(dir, stem);
        return first(ctx, [`${here}/${spec}.rs`, `${here}/${spec}/mod.rs`]);
      }
      const parts = spec.split("::");
      let baseDir: string | null = null;
      if (parts[0] === "crate") { let d = dir; while (d && d !== "." && !ctx.files.has(`${d}/lib.rs`) && !ctx.files.has(`${d}/main.rs`)) d = path.posix.dirname(d); baseDir = d === "." ? "src" : d; parts.shift(); }
      else if (parts[0] === "super" || parts[0] === "self") { baseDir = parts[0] === "super" ? path.posix.dirname(dir) : dir; parts.shift(); }
      if (baseDir === null) return null;
      for (let n = parts.length; n > 0; n--) { const p = parts.slice(0, n).join("/"); const r = first(ctx, [`${baseDir}/${p}.rs`, `${baseDir}/${p}/mod.rs`]); if (r) return r; }
      return null;
    }
    case "java": case "kotlin": case "scala": case "groovy": {
      if (spec.endsWith(".*")) { const d = spec.slice(0, -2).replace(/\./g, "/"); const hit = [...ctx.files].find((f) => path.posix.dirname(f).endsWith(d)); return hit ? `dir:${path.posix.dirname(hit)}/` : null; }
      const p = spec.replace(/\./g, "/");
      for (const ext of [".java", ".kt", ".scala", ".groovy"]) { const cands = ctx.byBase.get(p.split("/").pop() + ext) || []; const hit = cands.find((f) => f.endsWith(p + ext)); if (hit) return hit; }
      // import of a member (static import / Kotlin top-level function): drop the last segment
      const q = p.split("/").slice(0, -1).join("/"); for (const ext of [".java", ".kt"]) { const hit = (ctx.byBase.get(q.split("/").pop() + ext) || []).find((f) => f.endsWith(q + ext)); if (hit) return hit; }
      return null;
    }
    case "csharp": return `ns:${spec}`;
    case "c": case "cpp": case "objc": {
      const rel = first(ctx, [path.posix.join(dir, spec), spec, `include/${spec}`, `src/${spec}`]); if (rel) return rel;
      const cands = (ctx.byBase.get(path.posix.basename(spec)) || []).filter((f) => f.endsWith(spec));
      return cands.length ? cands.sort((a, b) => commonPrefix(b, from) - commonPrefix(a, from))[0] : null;
    }
    case "php": { const p = spec.replace(/\\/g, "/").replace(/^\//, ""); if (/\.php$/.test(p)) return first(ctx, [path.posix.join(dir, p), p]); const base = p.split("/").pop() + ".php"; const c = (ctx.byBase.get(base) || []).filter((f) => f.endsWith(p.split("/").slice(1).join("/") + ".php") || f.endsWith("/" + base)); return c[0] || null; }
    case "ruby": return first(ctx, [path.posix.join(dir, spec + ".rb"), path.posix.join(dir, spec), `lib/${spec}.rb`, `${spec}.rb`, `app/${spec}.rb`]);
    case "shell": case "make": return first(ctx, [path.posix.join(dir, spec), spec]);
    case "hcl": return spec.startsWith(".") ? (() => { const d = norm(path.posix.join(dir, spec)); return [...ctx.files].some((f) => f.startsWith(d + "/") && f.endsWith(".tf")) ? `dir:${d}/` : null; })() : null;
    case "zig": case "solidity": case "protobuf": case "markdown": return first(ctx, [path.posix.join(dir, spec), spec]);
    default: return null;
  }
}
/** JSON with comments and trailing commas (tsconfig style), string-aware. */
export function parseJsonc(t: string): any {
  let out = "", i = 0, inStr = false;
  while (i < t.length) {
    const c = t[i];
    if (inStr) { out += c; if (c === "\\") { out += t[i + 1] ?? ""; i += 2; continue; } if (c === '"') inStr = false; i++; continue; }
    if (c === '"') { inStr = true; out += c; i++; continue; }
    if (c === "/" && t[i + 1] === "/") { while (i < t.length && t[i] !== "\n") i++; continue; }
    if (c === "/" && t[i + 1] === "*") { const e = t.indexOf("*/", i + 2); i = e < 0 ? t.length : e + 2; continue; }
    out += c; i++;
  }
  try { return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1")); } catch { return null; }
}
const commonPrefix = (a: string, b: string) => { let i = 0; while (i < a.length && a[i] === b[i]) i++; return i; };
