// locate: task text -> ranked symbols most likely to be changed. Deterministic, no model.
// Signals (each independent; agreement multiplies): symbol names (IDF-weighted), literal UI/user-visible strings,
// file/dir names, CSS classes, routes. Then pack(): exact code spans for the top symbols plus related style rules.
import type { Repo, Sym } from "./repo.ts";

const STOP = new Set("the a an and or of to in on at for with from by into onto this that these those make change move update add show set use put its it be is are was so as all every each one two new under over below above when then than there their them they should would could can will not but just also more less very like about after before only same other please want need fix bug issue".split(" "));
export const words = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w));
export const stem = (w: string) => w.replace(/ies$/, "y").replace(/(sses|xes|ches)$/, (m) => m.slice(0, -2)).replace(/s$/, "").replace(/(ing|ed)$/, "");

export interface Located { sym: Sym; score: number; why: string[] }

export function locate(repo: Repo, task: string, limit = 8): Located[] {
  const tw = new Set(words(task).map(stem));
  if (!tw.size) return [];
  const score = new Map<number, number>(), why = new Map<number, Set<string>>(), symById = new Map<number, Sym>();
  const bump = (s: Sym, n: number, reason: string) => { if (["h1", "h2", "h3", "h4", "section", "key", "css-rule"].includes(s.kind)) return; symById.set(s.id, s); score.set(s.id, (score.get(s.id) || 0) + n); (why.get(s.id) || why.set(s.id, new Set()).get(s.id)!).add(reason); };
  const nSym = repo.store.get("SELECT count(*) n FROM symbols").n || 1;
  const df = (w: string) => repo.store.get("SELECT count(*) n FROM symbols WHERE lower(short) LIKE ?", [`%${w}%`]).n;
  const idf = (w: string) => Math.max(0.3, Math.min(2.5, Math.log10(nSym / (1 + df(w))) + 0.4));
  const ws = [...tw];
  // 1. symbol names
  for (const w of ws) {
    const weight = idf(w);
    for (const s of repo.store.all("SELECT * FROM symbols WHERE lower(short) LIKE ? LIMIT 400", [`%${w}%`]) as Sym[]) {
      const nameWords = words(s.short).map(stem); const hits = nameWords.filter((x) => tw.has(x));
      if (!hits.includes(w)) continue;
      const kindW = ["class", "struct", "component", "interface", "trait", "module"].includes(s.kind) ? 3 : s.kind === "css-class" ? 1 : 2;
      bump(s, kindW * weight * (hits.length === nameWords.length && nameWords.length > 1 ? 1.5 : 1) / Math.max(1, hits.length), `name ${s.name}`);
    }
  }
  // 2. user-visible strings (labels, messages) -> enclosing symbol; each task word counts once per symbol
  const seenText = new Set<string>();
  for (const w of ws) for (const r of repo.store.all("SELECT file, line, name, in_sym FROM refs WHERE kind='string' AND lower(name) LIKE ? LIMIT 300", [`%${w}%`])) {
    if (!words(r.name).map(stem).includes(w)) continue;
    const s = (r.in_sym && repo.store.get("SELECT * FROM symbols WHERE file=? AND name=?", [r.file, r.in_sym])) || repo.symbolAt(r.file, r.line);
    if (s && !seenText.has(`${s.id}|${w}`)) { seenText.add(`${s.id}|${w}`); bump(s, 1.5 * idf(w), `text "${r.name.slice(0, 30)}"`); }
  }
  // 3. file and directory names -> symbols in that file (weak), CSS classes -> their users
  for (const w of ws) {
    for (const f of repo.store.all("SELECT path FROM files WHERE lower(path) LIKE ? LIMIT 50", [`%${w}%`])) {
      const segs = f.path.toLowerCase().split(/[\/._-]/).map(stem); if (!segs.includes(w)) continue;
      for (const s of repo.store.all("SELECT * FROM symbols WHERE file=? AND parent IS NULL AND kind NOT IN ('css-class','section','h1','h2','h3','h4','key') LIMIT 30", [f.path]) as Sym[]) bump(s, 0.6 * idf(w), `in ${f.path.split("/").slice(-2).join("/")}`);
    }
    for (const r of repo.store.all("SELECT DISTINCT file, line, in_sym, name FROM refs WHERE kind='style' AND lower(name) LIKE ? LIMIT 100", [`%${w}%`])) {
      if (!r.name.toLowerCase().split(/[-_]/).map(stem).includes(w)) continue;
      const s = (r.in_sym && repo.store.get("SELECT * FROM symbols WHERE file=? AND name=?", [r.file, r.in_sym])) || repo.symbolAt(r.file, r.line);
      if (s) bump(s, 1.2, `class .${r.name}`);
    }
  }
  const mentionsTests = /\btests?\b|\bspec\b|coverage/i.test(task);
  for (const [id, set] of why) {
    const s = symById.get(id)!; let sc = score.get(id)!;
    const kinds = new Set([...set].map((x) => x.split(" ")[0])); // independent signal types agreeing
    if (kinds.size > 1) sc *= 1 + 0.5 * Math.min(kinds.size - 1, 3);
    const span = s.end - s.line + 1; if (span > 120) sc /= Math.log2(span / 60); // data blobs, giant functions
    if (!mentionsTests && repo.file(s.file)?.test) sc *= 0.3; // tests are rarely the change site unless the task says so
    if (s.kind === "const" && span > 30) sc *= 0.5; // dictionaries, config objects: usually not the change site
    score.set(id, sc);
  }
  return [...score].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([id, sc]) => ({ sym: symById.get(id)!, score: +sc.toFixed(2), why: [...why.get(id)!].slice(0, 6) }));
}

export interface Block { file: string; from: number; to: number; text: string; reason: string }

/** Exact code for chosen symbols + the CSS rules for classes they use (all rules for specific classes; base rules for shared ones). */
export function pack(repo: Repo, syms: Sym[], maxLines = 220): Block[] {
  const blocks: Block[] = [];
  const cssLines = new Map<string, Set<number>>();
  const seenFiles = new Set<string>();
  for (const s of syms) {
    const n = s.end - s.line + 1;
    const fileLines = repo.file(s.file)?.lines ?? 0;
    if (fileLines <= 150) { // small file: the whole file is cheap and carries constants, imports and neighbours
      if (!seenFiles.has(s.file)) { seenFiles.add(s.file); blocks.push({ file: s.file, from: 1, to: fileLines, text: repo.read(s.file).join("\n"), reason: `whole file (contains ${s.name})` }); }
    } else {
      const body = repo.read(s.file, s.line, s.end).join("\n");
      // same-file constants/types the symbol refers to (e.g. a TITLE constant used by a function)
      for (const d of repo.store.all("SELECT * FROM symbols WHERE file=? AND parent IS NULL AND id<>? AND kind IN ('const','type','enum','struct','interface','macro') AND end-line < 30", [s.file, s.id]) as Sym[])
        if (new RegExp(`\\b${d.short.replace(/[$]/g, "\\$")}\\b`).test(body)) blocks.push({ file: d.file, from: d.line, to: d.end, text: repo.read(d.file, d.line, d.end).join("\n"), reason: `${d.short} used by ${s.name}` });
    }
    if (fileLines > 150) blocks.push(n > maxLines
      ? { file: s.file, from: s.line, to: s.line + 40, text: repo.read(s.file, s.line, s.line + 40).join("\n") + `\n... (${n} lines; NEED: show ${s.file}:${s.line + 41}-${s.end})`, reason: `definition of ${s.name} (truncated)` }
      : { file: s.file, from: s.line, to: s.end, text: repo.read(s.file, s.line, s.end).join("\n"), reason: `definition of ${s.name}` });
    else if (seenFiles.has(s.file) && blocks.at(-1)?.file !== s.file) { /* already included as whole file */ }
    for (const c of repo.store.all("SELECT DISTINCT name FROM refs WHERE file=? AND kind='style' AND line BETWEEN ? AND ?", [s.file, s.line, s.end]).map((r) => r.name)) {
      const users = repo.store.get("SELECT count(DISTINCT file || in_sym) n FROM refs WHERE kind='style' AND name=?", [c]).n;
      if (users > 8) continue;
      for (const r of repo.store.all("SELECT file, line, end, sig FROM symbols WHERE kind='css-class' AND short=?", ["." + c])) {
        const subject = String(r.sig).split(",").some((p: string) => new RegExp(`\\.${c.replace(/-/g, "\\-")}(?![\\w-])`).test(p.trim().split(/[\s>+~]+/).pop() || ""));
        if (users <= 3 || subject) { const set = cssLines.get(r.file) || cssLines.set(r.file, new Set()).get(r.file)!; for (let i = r.line; i <= r.end; i++) set.add(i); }
      }
    }
  }
  for (const [f, set] of cssLines) {
    const nums = [...set].sort((a, b) => a - b); let a = nums[0], p = nums[0];
    const flush = (x: number, y: number) => blocks.push({ file: f, from: x, to: y, text: repo.read(f, x, y).join("\n"), reason: "style rules used by the code above" });
    for (const n of nums.slice(1)) { if (n === p + 1) { p = n; continue; } flush(a, p); a = p = n; }
    if (nums.length) flush(a, p);
  }
  return blocks;
}

/** First-request context: located code packed exactly, then budgeted expansion along imports (small dependency files),
 *  so tiny repos/modules arrive complete while large ones stay focused. Level >= 3 gets candidates, not code. */
export function seedContext(repo: Repo, task: string, level: number, budgetTokens = 3500): { blocks: Block[]; candidates: Located[] } {
  const loc = locate(repo, task, 8);
  if (level >= 3 || !loc.length) return { blocks: [], candidates: loc };
  const best = loc[0].score;
  const chosen = loc.filter((x, i) => i === 0 || x.score >= 0.6 * best).slice(0, 3).map((x) => x.sym);
  const blocks = pack(repo, chosen);
  let tokens = blocks.reduce((a, b) => a + b.text.length, 0) / 4;
  const have = new Set(blocks.map((b) => b.file));
  const frontier = [...have];
  for (const f of frontier) {
    if (tokens >= budgetTokens) break;
    for (const d of repo.dependenciesOf(f)) {
      if (have.has(d)) continue;
      const F = repo.file(d); if (!F || F.test || F.lines > 150) continue;
      const text = repo.read(d).join("\n"); const t = text.length / 4;
      if (tokens + t > budgetTokens) continue;
      blocks.push({ file: d, from: 1, to: F.lines, text, reason: `imported by ${f}` }); have.add(d); tokens += t;
    }
  }
  return { blocks, candidates: loc.filter((x) => !chosen.includes(x.sym)) };
}
