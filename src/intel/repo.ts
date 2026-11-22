// Repository Intelligence: incremental multi-language index (SQLite) + graph queries.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import type { FileFacts, IntelProvider } from "../core/types.ts";
import { langOf, isTestPath, isCodeLang } from "./languages.ts";
import { heuristicProvider } from "./heuristic/index.ts";
import { treeSitterProvider, initTreeSitter } from "./treesitter.ts";
import { detectProfile, type Profile } from "./detect.ts";
import { buildResolveCtx, resolveImport } from "./resolve.ts";
import { Store } from "./store.ts";

export interface IndexStats { files: number; parsed: number; removed: number; skipped: number; ms: number; providers: Record<string, number>; errors: string[] }
export interface Sym { id: number; file: string; name: string; short: string; kind: string; line: number; end: number; exported: number; sig: string; parent: string | null }
export interface Edge { from: Sym | { file: string; name?: string }; to: Sym; kind: string; line: number; file: string; confidence: "confirmed" | "inferred" }

const MAX_BYTES = 1_000_000;
const DEFAULT_EXCLUDE = /(^|\/)(node_modules|\.git|dist|build|out|target|vendor|\.venv|venv|__pycache__|\.next|\.nuxt|coverage|bin\/Debug|bin\/Release|obj|\.gradle|\.idea|\.vs|Pods|DerivedData|\.dart_tool|\.nexus|\.agent-shell|Library|Temp|Intermediate|Binaries|Saved|\.godot)\//;
const GENERATED = /(\.min\.(js|css)|\.map|\.lock|lock\.json|\.pb\.go|_pb2\.py|\.g\.dart|\.generated\.\w+|\.designer\.cs)$/i;

export class Repo {
  root: string;
  store: Store;
  providers: IntelProvider[] = [];
  constructor(root: string, dbPath = path.join(root, ".nexus", "index.db")) { this.root = path.resolve(root); this.store = new Store(dbPath); }

  async init() {
    this.providers = [];
    if (await treeSitterProvider.init!()) this.providers.push(treeSitterProvider);
    this.providers.push(heuristicProvider);
    return this;
  }

  /** All candidate source files (git-aware: tracked + untracked-not-ignored), filtered. */
  listFiles(): string[] {
    let out: string[] = [];
    try { out = execFileSync("git", ["ls-files", "-co", "--exclude-standard"], { cwd: this.root, encoding: "utf8", maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "ignore"] }).split("\n").filter(Boolean); }
    catch { const walk = (d: string) => { for (const e of fs.readdirSync(path.join(this.root, d), { withFileTypes: true })) { const r = d ? `${d}/${e.name}` : e.name; if (e.name.startsWith(".") && e.name !== ".github") continue; if (e.isDirectory()) { if (!DEFAULT_EXCLUDE.test(r + "/")) walk(r); } else out.push(r); } }; walk(""); }
    return out.filter((f) => !DEFAULT_EXCLUDE.test(f) && !GENERATED.test(f) && langOf(f));
  }

  async index({ force = false } = {}): Promise<IndexStats> {
    const t0 = Date.now();
    if (!this.providers.length) await this.init();
    const st: IndexStats = { files: 0, parsed: 0, removed: 0, skipped: 0, ms: 0, providers: {}, errors: [] };
    const files = this.listFiles();
    const live = new Set(files);
    const known = new Map<string, any>(this.store.all("SELECT path, hash, mtime, size FROM files").map((r) => [r.path, r]));
    const changed: { file: string; facts: FileFacts; hash: string; mtime: number; size: number; lines: number }[] = [];
    for (const f of files) {
      let s: fs.Stats; try { s = fs.statSync(path.join(this.root, f)); } catch { continue; }
      if (!s.isFile() || s.size > MAX_BYTES) { st.skipped++; continue; }
      const prev = known.get(f);
      if (!force && prev && prev.mtime === s.mtimeMs && prev.size === s.size) continue;
      const text = fs.readFileSync(path.join(this.root, f), "utf8");
      const hash = crypto.createHash("sha1").update(text).digest("hex").slice(0, 16);
      if (!force && prev && prev.hash === hash) { this.store.run("UPDATE files SET mtime=?, size=? WHERE path=?", [s.mtimeMs, s.size, f]); continue; }
      const lines = text.split("\n");
      if (lines.length > 10 && text.length / lines.length > 500 && !/\.(md|json)$/.test(f)) { st.skipped++; continue; } // minified
      const lang = langOf(f)!.id;
      let facts: FileFacts | null = null;
      for (const p of this.providers) if (p.languages().includes(lang)) { try { facts = p.extract(text, f, lang); } catch (e: any) { st.errors.push(`${f}: ${p.id}: ${e.message}`); } if (facts) break; }
      facts ||= { lang, precision: "heuristic", provider: "none", symbols: [], imports: [], refs: [] };
      st.providers[facts.provider] = (st.providers[facts.provider] || 0) + 1;
      changed.push({ file: f, facts, hash, mtime: s.mtimeMs, size: s.size, lines: lines.length });
    }
    const removed = [...known.keys()].filter((f) => !live.has(f));
    const ctx = buildResolveCtx(this.root, files);
    this.store.tx(() => {
      for (const f of removed) this.deleteFile(f);
      for (const c of changed) {
        this.deleteFile(c.file);
        const F = c.facts;
        this.store.run("INSERT INTO files(path,lang,hash,mtime,size,lines,precision,provider,errors,meta,test) VALUES(?,?,?,?,?,?,?,?,?,?,?)", [c.file, F.lang, c.hash, c.mtime, c.size, c.lines, F.precision, F.provider, F.syntaxErrors?.length ? JSON.stringify(F.syntaxErrors) : null, F.meta ? JSON.stringify(F.meta) : null, isTestPath(c.file) ? 1 : 0]);
        const insS = this.store.db.prepare("INSERT INTO symbols(file,name,short,kind,line,end,exported,sig,parent) VALUES(?,?,?,?,?,?,?,?,?)");
        for (const s of F.symbols) insS.run(c.file, s.name, s.kind === "css-class" || s.kind === "css-rule" ? s.name : s.name.split(".").pop()!, s.kind, s.line, s.end, s.exported ? 1 : 0, s.sig ?? null, s.parent ?? null);
        const insI = this.store.db.prepare("INSERT INTO imports(file,source,line,names,resolved) VALUES(?,?,?,?,?)");
        for (const i of F.imports) insI.run(c.file, i.source, i.line, i.names ? JSON.stringify(i.names) : null, resolveImport(ctx, c.file, F.lang, i.source));
        const insR = this.store.db.prepare("INSERT INTO refs(file,name,kind,line,in_sym) VALUES(?,?,?,?,?)");
        for (const r of F.refs) insR.run(c.file, r.name, r.kind, r.line, r.in ?? null);
      }
      // the file set changed: imports elsewhere may now resolve differently
      if (removed.length || changed.some((c) => !known.has(c.file))) {
        const upd = this.store.db.prepare("UPDATE imports SET resolved=? WHERE rowid=?");
        for (const r of this.store.all("SELECT i.rowid AS id, i.file, i.source, f.lang FROM imports i JOIN files f ON f.path=i.file")) upd.run(resolveImport(ctx, r.file, r.lang, r.source), r.id);
      }
      this.store.setMeta("profile", detectProfile(this.root, files));
      this.store.setMeta("indexedAt", new Date().toISOString());
    });
    st.parsed = changed.length; st.removed = removed.length; st.files = (this.store.get("SELECT count(*) AS n FROM files")).n; st.ms = Date.now() - t0;
    return st;
  }
  private deleteFile(f: string) { for (const t of ["files"]) this.store.run(`DELETE FROM ${t} WHERE path=?`, [f]); for (const t of ["symbols", "imports", "refs"]) this.store.run(`DELETE FROM ${t} WHERE file=?`, [f]); }

  profile(): Profile { return this.store.getMeta<Profile>("profile")!; }
  stats() {
    const q = (s: string) => this.store.get(s).n;
    return { files: q("SELECT count(*) n FROM files"), symbols: q("SELECT count(*) n FROM symbols"), imports: q("SELECT count(*) n FROM imports"), resolved: q("SELECT count(*) n FROM imports WHERE resolved IS NOT NULL"), refs: q("SELECT count(*) n FROM refs"), byPrecision: this.store.all("SELECT precision, count(*) n FROM files GROUP BY precision"), byLang: this.store.all("SELECT lang, count(*) n FROM files GROUP BY lang ORDER BY n DESC") };
  }

  // ---------- lookups ----------
  symbolsNamed(name: string): Sym[] {
    const exact = this.store.all("SELECT * FROM symbols WHERE name=? OR short=? ORDER BY exported DESC, kind", [name, name]);
    return exact.length ? exact : this.store.all("SELECT * FROM symbols WHERE lower(short)=lower(?) LIMIT 50", [name]);
  }
  symbolsIn(file: string): Sym[] { return this.store.all("SELECT * FROM symbols WHERE file=? ORDER BY line", [file]); }
  symbolAt(file: string, line: number): Sym | undefined { return this.store.get("SELECT * FROM symbols WHERE file=? AND line<=? AND end>=? AND parent IS NULL ORDER BY (end-line) LIMIT 1", [file, line, line]); }
  file(f: string) { return this.store.get("SELECT * FROM files WHERE path=?", [f]); }
  importsOf(f: string): { source: string; resolved: string | null; line: number }[] { return this.store.all("SELECT source, resolved, line FROM imports WHERE file=?", [f]); }
  /** Files whose imports resolve to `f` (directly, or via its directory / namespace). */
  importersOf(f: string): string[] {
    const dir = `dir:${path.posix.dirname(f)}/`;
    const ns = this.store.all("SELECT name FROM symbols WHERE file=? AND kind='module'", [f]).map((r) => `ns:${r.name}`);
    return [...new Set(this.store.all(`SELECT DISTINCT file FROM imports WHERE resolved IN (${["?", "?", ...ns.map(() => "?")].join(",")})`, [f, dir, ...ns]).map((r) => r.file))].filter((x) => x !== f);
  }
  /** Files a file depends on (resolved imports expanded: dir -> its files, ns -> files declaring it). */
  dependenciesOf(f: string): string[] {
    const out = new Set<string>();
    for (const r of this.importsOf(f)) {
      if (!r.resolved) continue;
      if (r.resolved.startsWith("dir:")) for (const x of this.store.all("SELECT path FROM files WHERE path LIKE ? AND path NOT LIKE ?", [r.resolved.slice(4) + "%", r.resolved.slice(4) + "%/%"])) out.add(x.path);
      else if (r.resolved.startsWith("ns:")) for (const x of this.store.all("SELECT DISTINCT file FROM symbols WHERE kind='module' AND name=?", [r.resolved.slice(3)])) out.add(x.file);
      else out.add(r.resolved);
    }
    // same-package visibility (Go, Java, C#, Rust module dir): files in the same directory and language
    const F = this.file(f);
    if (F && ["go", "java", "kotlin", "csharp", "scala"].includes(F.lang)) for (const x of this.store.all("SELECT path FROM files WHERE lang=? AND path LIKE ? AND path NOT LIKE ?", [F.lang, path.posix.dirname(f) + "/%", path.posix.dirname(f) + "/%/%"])) out.add(x.path);
    out.delete(f);
    return [...out];
  }

  /** Resolve a referenced name used in `file` to definitions: same file, then files it imports, then a unique global match. */
  resolveRef(file: string, name: string, member = false): { sym: Sym; confidence: "confirmed" | "inferred" }[] {
    const defs = this.store.all("SELECT * FROM symbols WHERE short=? AND kind NOT IN ('h1','h2','h3','h4','section','key','css-rule')", [name]) as Sym[];
    if (!defs.length) return [];
    const local = defs.filter((d) => d.file === file); if (local.length) return local.map((sym) => ({ sym, confidence: "confirmed" as const }));
    const deps = new Set(this.dependenciesOf(file));
    const viaImport = defs.filter((d) => deps.has(d.file)); if (viaImport.length) return viaImport.map((sym) => ({ sym, confidence: "confirmed" as const }));
    if (member) return [];
    const F = this.file(file);
    const sameLang = defs.filter((d) => this.file(d.file)?.lang === F?.lang || (isWebLang(F?.lang) && isWebLang(this.file(d.file)?.lang)));
    if (sameLang.length && sameLang.length <= 3) return sameLang.map((sym) => ({ sym, confidence: "inferred" as const }));
    return [];
  }

  /** Who uses symbol `s`: refs to its short name from files that can see it. */
  usersOf(s: Sym, kinds = ["call", "mcall", "render", "extends", "ref", "style"]): Edge[] {
    const out: Edge[] = [];
    const refs = this.store.all(`SELECT * FROM refs WHERE name=? AND kind IN (${kinds.map(() => "?").join(",")})`, [s.kind === "css-class" ? s.short.slice(1) : s.short, ...kinds]);
    const importers = new Set(this.importersOf(s.file));
    const sameDirLang = (f: string) => path.posix.dirname(f) === path.posix.dirname(s.file) && this.file(f)?.lang === this.file(s.file)?.lang;
    const defsElsewhere = this.store.get("SELECT count(DISTINCT file) n FROM symbols WHERE short=?", [s.short]).n;
    for (const r of refs) {
      if (r.file === s.file && r.in_sym === s.name) continue;
      let confidence: "confirmed" | "inferred" | null = null;
      if (s.kind === "css-class") confidence = "inferred";
      else if (r.file === s.file || importers.has(r.file) || sameDirLang(r.file)) confidence = "confirmed";
      else if (defsElsewhere <= 1 && r.kind !== "mcall") confidence = "inferred";
      if (!confidence) continue;
      const from = (r.in_sym && this.store.get("SELECT * FROM symbols WHERE file=? AND name=?", [r.file, r.in_sym])) || this.symbolAt(r.file, r.line) || { file: r.file };
      out.push({ from, to: s, kind: r.kind, line: r.line, file: r.file, confidence });
    }
    return out;
  }
  /** What symbol `s` uses (refs inside its span resolved to definitions). */
  usesOf(s: Sym): Edge[] {
    const out: Edge[] = []; const seen = new Set<string>();
    for (const r of this.store.all("SELECT * FROM refs WHERE file=? AND line>=? AND line<=? AND kind IN ('call','mcall','render','extends','ref')", [s.file, s.line, s.end])) {
      if (seen.has(r.name)) continue; seen.add(r.name);
      for (const d of this.resolveRef(s.file, r.name, r.kind === "mcall")) if (d.sym.id !== s.id) out.push({ from: s, to: d.sym, kind: r.kind, line: r.line, file: s.file, confidence: d.confidence });
    }
    return out;
  }
  testsFor(file: string): string[] {
    const base = path.posix.basename(file).replace(/\.\w+$/, "");
    const byImport = this.importersOf(file).filter((f) => this.file(f)?.test);
    const byName = this.store.all("SELECT path FROM files WHERE test=1 AND (path LIKE ? OR path LIKE ? OR path LIKE ? OR path LIKE ?)", [`%test_${base}.%`, `%${base}_test.%`, `%${base}.test.%`, `%${base}Test.%`]).map((r) => r.path);
    return [...new Set([...byImport, ...byName])];
  }
  stringsIn(file: string, from: number, to: number): string[] { return this.store.all("SELECT name FROM refs WHERE file=? AND kind='string' AND line BETWEEN ? AND ?", [file, from, to]).map((r) => r.name); }
  read(file: string, from = 1, to = Infinity): string[] { const L = fs.readFileSync(path.join(this.root, file), "utf8").split("\n"); return L.slice(from - 1, Math.min(to, L.length)); }
  hash(file: string): string | null { try { return crypto.createHash("sha1").update(fs.readFileSync(path.join(this.root, file))).digest("hex").slice(0, 16); } catch { return null; } }
  close() { this.store.close(); }
}
const isWebLang = (l?: string) => !!l && ["javascript", "typescript", "tsx", "vue", "svelte", "astro"].includes(l);
export { isCodeLang };
