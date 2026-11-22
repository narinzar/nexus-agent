// Human/LLM-facing queries over the index. Output is compact: one fact per line, locations as path:line,
// inferred facts marked "~". Every function returns text; the agent and the CLI share them.
import path from "node:path";
import { execFileSync } from "node:child_process";
import type { Repo, Sym } from "./repo.ts";
import { commandsFor } from "./detect.ts";

const loc = (s: { file: string; line: number; end?: number }) => `${s.file}:${s.line}${s.end && s.end !== s.line ? `-${s.end}` : ""}`;
const uniq = <T>(a: T[]) => [...new Set(a)];
const label = (x: any) => (x.name ? `${x.name} (${x.file}:${x.line})` : x.file);

export function resolveTarget(repo: Repo, term: string): { syms: Sym[]; file?: string } {
  const t = term.trim().replace(/^\.\//, "");
  if (repo.file(t)) return { syms: [], file: t };
  const suffix = repo.store.all("SELECT path FROM files WHERE path LIKE ?", [`%/${t}`]);
  if (suffix.length === 1) return { syms: [], file: suffix[0].path };
  return { syms: repo.symbolsNamed(t).slice(0, 8) };
}

export function find(repo: Repo, term: string, limit = 40): string {
  const lc = term.toLowerCase();
  const rows = repo.store.all(`SELECT * FROM symbols WHERE lower(short) LIKE ? OR lower(name) LIKE ? ORDER BY CASE WHEN lower(short)=? THEN 0 WHEN lower(short) LIKE ? THEN 1 ELSE 2 END, exported DESC, length(short) LIMIT ?`, [`%${lc}%`, `%${lc}%`, lc, `${lc}%`, limit]);
  const files = repo.store.all("SELECT path, lines, lang FROM files WHERE lower(path) LIKE ? ORDER BY length(path) LIMIT 10", [`%${lc}%`]);
  const out = rows.map((s) => `${s.kind.padEnd(10)} ${s.name}  ${loc(s)}`);
  for (const f of files) out.push(`file       ${f.path} (${f.lines} lines, ${f.lang})`);
  return out.length ? out.join("\n") : `no match for "${term}" (try a shorter term, or: nexus grep ${term})`;
}

export function ctx(repo: Repo, term: string, depth = 1): string {
  const { syms, file } = resolveTarget(repo, term);
  if (file) return fileCtx(repo, file);
  if (!syms.length) return `no symbol "${term}"; candidates:\n${find(repo, term, 12)}`;
  return syms.slice(0, 4).map((s) => symCtx(repo, s, depth)).join("\n\n");
}
function symCtx(repo: Repo, s: Sym, depth: number): string {
  const F = repo.file(s.file);
  const o = [`${s.name}  ${s.kind}${s.exported ? ", exported" : ""}  ${loc(s)}  [${F?.lang}, ${F?.precision}]`];
  if (s.sig) o.push(`  sig: ${s.sig}`);
  const users = repo.usersOf(s);
  const byFrom = new Map<string, typeof users>();
  for (const u of users) { const k = label(u.from); (byFrom.get(k) || byFrom.set(k, []).get(k)!).push(u); }
  o.push(`  used by (${byFrom.size}): ${[...byFrom].slice(0, 25).map(([k, es]) => `${k} ${es[0].kind}@${uniq(es.map((e) => e.line)).join(",")}${es.every((e) => e.confidence === "inferred") ? "~" : ""}`).join("; ") || "-"}${byFrom.size > 25 ? ` ... +${byFrom.size - 25}` : ""}`);
  const uses = repo.usesOf(s);
  if (uses.length) o.push(`  uses: ${uses.slice(0, 30).map((u) => `${u.to.name} (${u.to.file}:${u.to.line})${u.confidence === "inferred" ? "~" : ""}`).join(", ")}`);
  const members = repo.store.all("SELECT name, kind, line FROM symbols WHERE file=? AND parent=? ORDER BY line LIMIT 40", [s.file, s.short]);
  if (members.length) o.push(`  members: ${members.map((m) => `${m.name.split(".").pop()}:${m.line}`).join(" ")}`);
  const styles = repo.store.all("SELECT DISTINCT name FROM refs WHERE file=? AND kind='style' AND line BETWEEN ? AND ?", [s.file, s.line, s.end]).map((r) => r.name);
  if (styles.length) o.push(`  styles: ${styles.map((c) => { const rules = repo.store.all("SELECT file, line, parent FROM symbols WHERE kind='css-class' AND short=?", ["." + c]); return `.${c}${rules.length ? " " + uniq(rules.map((r) => `${r.file}:${r.line}${r.parent ? `[${r.parent.replace(/^@media /, "@")}]` : ""}`)).slice(0, 8).join(",") : " (no rule)"}`; }).join("; ")}`);
  const tests = repo.testsFor(s.file); if (tests.length) o.push(`  tests: ${tests.slice(0, 10).join(", ")}`);
  if (byFrom.size > 1) o.push(`  NOTE shared: ${byFrom.size} users are affected by changes to the signature or behaviour`);
  if (depth > 1) for (const u of uses.filter((u) => u.to.file !== s.file || true).slice(0, 6)) o.push(symCtx(repo, u.to, depth - 1).split("\n").map((l) => "    " + l).join("\n"));
  return o.join("\n");
}
function fileCtx(repo: Repo, f: string): string {
  const F = repo.file(f);
  const o = [`${f}  (${F.lines} lines, ${F.lang}, ${F.precision} via ${F.provider}${F.test ? ", test" : ""})`];
  for (const s of repo.symbolsIn(f).filter((s) => !s.parent).slice(0, 60)) o.push(`  L${s.line}-${s.end} ${s.kind} ${s.name}`);
  const imps = repo.importsOf(f);
  o.push(`  imports: ${imps.map((i) => (i.resolved ? i.resolved.replace(/^(dir|ns):/, "") : `${i.source}(ext)`)).slice(0, 30).join(", ") || "-"}`);
  o.push(`  imported by: ${repo.importersOf(f).slice(0, 30).join(", ") || "-"}`);
  const tests = repo.testsFor(f); if (tests.length) o.push(`  tests: ${tests.join(", ")}`);
  if (F.errors) o.push(`  syntax errors: ${JSON.parse(F.errors).map((e: any) => `L${e.line} ${e.message}`).join("; ")}`);
  return o.join("\n");
}

export function refs(repo: Repo, term: string): string {
  const { syms, file } = resolveTarget(repo, term);
  if (file) return `${file} imported by:\n  ${repo.importersOf(file).join("\n  ") || "-"}`;
  if (!syms.length) return `no symbol "${term}"`;
  return syms.slice(0, 4).map((s) => { const us = repo.usersOf(s); return [`${s.name} (${loc(s)}) <- ${us.length} reference(s)`, ...us.slice(0, 60).map((u) => `  ${u.file}:${u.line} ${u.kind}${u.confidence === "inferred" ? "~" : ""} in ${(u.from as any).name || "(module)"}`), ...(us.length > 60 ? [`  ... +${us.length - 60}`] : [])].join("\n"); }).join("\n\n");
}

/** Print only what matters: a symbol's span, a file range, or all rules of a CSS class. Capped (SWE-agent style windows). */
export function show(repo: Repo, target: string, cap = 150): string {
  const num = (f: string, a: number, b: number) => { const L = repo.read(f, a, b); const shown = L.slice(0, cap); return [`${f}:${a}-${a + L.length - 1}`, ...shown.map((l, i) => `${String(a + i).padStart(5)}  ${l}`), ...(L.length > cap ? [`  ... ${L.length - cap} more lines: nexus show ${f}:${a + cap}-${b}`] : [])].join("\n"); };
  const m = target.match(/^(.+?):(\d+)(?:-(\d+))?$/);
  if (m) { const f = resolveTarget(repo, m[1]).file; if (f) return num(f, +m[2], m[3] ? +m[3] : +m[2] + 20); }
  if (target.startsWith(".")) { const rules = repo.store.all("SELECT * FROM symbols WHERE kind='css-class' AND short=? ORDER BY file, line", [target]); if (rules.length) return uniq(rules.map((r) => `${r.file}:${r.line}`)).map((k) => { const r = rules.find((x) => `${x.file}:${x.line}` === k); return `${k}${r.parent ? `  (inside ${r.parent})` : ""}\n${repo.read(r.file, r.line, r.end).join("\n")}`; }).join("\n"); }
  const { syms, file } = resolveTarget(repo, target);
  if (syms.length) return syms.slice(0, 3).map((s) => num(s.file, s.line, s.end)).join("\n\n");
  if (file) return num(file, 1, repo.file(file).lines);
  return `nothing to show for "${target}"`;
}

/** Aider-style repository map: PageRank over the file dependency graph, personalised by focus terms, fitted to a token budget. */
export function map(repo: Repo, budget = 1500, focus: string[] = []): string {
  const files = repo.store.all("SELECT path, lines, lang, test FROM files WHERE lang NOT IN ('markdown','rst','asciidoc','json','yaml','toml','ini')").map((r) => r);
  const ix = new Map(files.map((f, i) => [f.path, i]));
  const w: Map<number, number>[] = files.map(() => new Map());
  const addW = (a: string, b: string, x: number) => { const i = ix.get(a), j = ix.get(b); if (i === undefined || j === undefined || i === j) return; w[i].set(j, (w[i].get(j) || 0) + x); };
  for (const f of files) for (const d of repo.dependenciesOf(f.path)) addW(f.path, d, 1);
  // name-based references (aider def/ref graph) for languages with weak import resolution
  for (const r of repo.store.all("SELECT r.file AS a, s.file AS b, count(*) AS n FROM refs r JOIN symbols s ON s.short=r.name AND s.exported=1 WHERE r.kind IN ('call','render','extends') AND r.file<>s.file GROUP BY r.file, s.file")) addW(r.a, r.b, Math.sqrt(r.n) * 0.3);
  const P = files.map(() => 0);
  for (const t of focus.map((x) => x.toLowerCase())) { files.forEach((f, i) => { if (f.path.toLowerCase().includes(t)) P[i] += 1; }); for (const s of repo.store.all("SELECT DISTINCT file FROM symbols WHERE lower(short) LIKE ?", [`%${t}%`])) { const i = ix.get(s.file); if (i !== undefined) P[i] += 1; } }
  const ps = P.reduce((a, b) => a + b, 0); const pers = ps ? P.map((x) => x / ps) : files.map(() => 1 / Math.max(1, files.length));
  let r = files.map(() => 1 / Math.max(1, files.length));
  for (let it = 0; it < 40; it++) {
    const nr = pers.map((p) => 0.15 * p); let dang = 0;
    w.forEach((row, i) => { let tot = 0; for (const x of row.values()) tot += Math.sqrt(x); if (!tot) { dang += r[i]; return; } for (const [j, x] of row) nr[j] += 0.85 * r[i] * Math.sqrt(x) / tot; });
    r = nr.map((x, i) => x + 0.85 * dang * pers[i]);
  }
  const order = files.map((f, i) => [f, r[i]] as const).sort((a, b) => b[1] - a[1]);
  const prof = repo.profile();
  const head = `repo: ${prof.languages.slice(0, 5).map((l) => `${l.id}(${l.files})`).join(" ")}; build: ${prof.buildSystems.map((b) => b.id + (b.dir !== "." ? `@${b.dir}` : "")).join(" ") || "-"}; frameworks: ${prof.frameworks.join(" ") || "-"}${focus.length ? `; focus: ${focus.join(" ")}` : ""}`;
  const out = [head]; let used = head.length / 4;
  for (const [f] of order) {
    const syms = repo.store.all("SELECT short, kind, line FROM symbols WHERE file=? AND parent IS NULL AND (exported=1 OR kind IN ('class','struct','interface','trait','component')) AND kind NOT IN ('css-class','section','h1','h2','h3','h4','key') ORDER BY line LIMIT 16", [f.path]);
    let block = `${f.path} (${f.lines}L)${syms.length ? "\n  " + syms.map((s) => `${s.short}:${s.line}`).join(" ") : ""}`;
    if (used + block.length / 4 > budget) { block = `${f.path} (${f.lines}L)`; if (used + block.length / 4 > budget) break; }
    out.push(block); used += block.length / 4;
  }
  return out.join("\n");
}

export function impact(repo: Repo, files: string[]): string {
  if (!files.length) return "no changed indexed files";
  const o: string[] = []; const tests = new Set<string>(); const affected = new Set<string>();
  for (const f of files) {
    if (!repo.file(f)) { o.push(`${f}: not indexed`); continue; }
    // transitive importers, two levels
    const lvl1 = repo.importersOf(f); const lvl2 = uniq(lvl1.flatMap((x) => repo.importersOf(x))).filter((x) => x !== f && !lvl1.includes(x));
    lvl1.concat(lvl2).forEach((x) => affected.add(x));
    for (const t of [...repo.testsFor(f), ...lvl1.filter((x) => repo.file(x)?.test)]) tests.add(t);
    o.push(`${f}: used by ${lvl1.length} file(s)${lvl1.length ? ` (${lvl1.slice(0, 8).join(", ")}${lvl1.length > 8 ? " ..." : ""})` : ""}${lvl2.length ? `; indirectly ${lvl2.length}` : ""}`);
  }
  o.push(`tests to run: ${[...tests].join(", ") || "(none found; run the suite)"}`);
  const prof = repo.profile();
  const cmd = (k: any) => commandsFor(prof, k, files);
  o.push(`verify: nexus check ${files.join(" ")}${cmd("typecheck").length ? " && " + cmd("typecheck").join(" && ") : ""}${cmd("test").length ? " && " + cmd("test").join(" && ") : ""}${cmd("build").length ? `; before shipping: ${cmd("build").join(" && ")}` : ""}`);
  return o.join("\n");
}

/** Fast guardrail on changed files: syntax errors (tree-sitter / CSS parser), unresolved relative imports. */
export async function check(repo: Repo, files: string[]): Promise<string> {
  await repo.index();
  const probs: string[] = [];
  for (const f of files) {
    const F = repo.file(f); if (!F) continue;
    if (F.errors) for (const e of JSON.parse(F.errors)) probs.push(`${f}:${e.line}: syntax: ${e.message}`);
    for (const i of repo.importsOf(f)) if (!i.resolved && (i.source.startsWith("./") || i.source.startsWith("../"))) probs.push(`${f}:${i.line}: unresolved import ${i.source}`);
  }
  return probs.length ? probs.join("\n") : `ok (${files.length} file(s))`;
}

export function changedFiles(repo: Repo): string[] {
  const run = (a: string[]) => { try { return execFileSync("git", a, { cwd: repo.root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).split("\n").filter(Boolean); } catch { return []; } };
  return uniq([...run(["diff", "--name-only", "HEAD"]), ...run(["ls-files", "--others", "--exclude-standard"])]).filter((f) => repo.file(f));
}

export function grep(repo: Repo, pattern: string, max = 60): string {
  try {
    const out = execFileSync("rg", ["-n", "--no-heading", "-S", "--max-columns", "200", "-g", "!.nexus", pattern, "."], { cwd: repo.root, encoding: "utf8", maxBuffer: 1 << 26 }).split("\n").filter(Boolean);
    return out.slice(0, max).map((l) => l.replace(/^\.\//, "")).join("\n") + (out.length > max ? `\n... ${out.length - max} more matches; narrow the pattern` : "");
  } catch (e: any) { if (e.status === 1) return "no matches"; return `grep unavailable: ${e.message.split("\n")[0]}`; }
}
