// Memory: durable facts, decisions and preferences with provenance (who/what said it, from which files at which
// version) so recalled facts can be flagged stale when those files changed. Plus a compact task history.
import path from "node:path";
import { Store } from "../intel/store.ts";
import { words, stem } from "../intel/locate.ts";

export interface Fact { id: number; kind: string; text: string; source: string; files: { file: string; hash: string | null }[]; created: string }

export class Memory {
  store: Store;
  constructor(root: string) {
    this.store = new Store(path.join(root, ".nexus", "memory.db"));
    this.store.db.exec(`CREATE TABLE IF NOT EXISTS facts(id INTEGER PRIMARY KEY, kind TEXT, text TEXT, source TEXT, files TEXT, created TEXT);
      CREATE TABLE IF NOT EXISTS runs(session TEXT PRIMARY KEY, task TEXT, outcome TEXT, summary TEXT, files TEXT, usage TEXT, created TEXT);`);
  }
  remember(text: string, o: { kind?: string; source: string; files?: string[]; hash?: (f: string) => string | null }) {
    const files = (o.files || []).map((f) => ({ file: f, hash: o.hash ? o.hash(f) : null }));
    this.store.run("INSERT INTO facts(kind,text,source,files,created) VALUES(?,?,?,?,?)", [o.kind || "fact", text, o.source, JSON.stringify(files), new Date().toISOString()]);
  }
  list(): Fact[] { return this.store.all("SELECT * FROM facts ORDER BY id DESC").map((r) => ({ ...r, files: JSON.parse(r.files || "[]") })); }
  forget(id: number) { this.store.run("DELETE FROM facts WHERE id=?", [id]); }
  /** Facts relevant to the task (word overlap), each marked stale if a source file changed since it was recorded. */
  recallText(task: string, hash: (f: string) => string | null, limit = 8): string {
    const tw = new Set(words(task).map(stem));
    const scored = this.list().map((f) => ({ f, s: words(f.text).map(stem).filter((w) => tw.has(w)).length + (f.kind === "preference" ? 1 : 0) })).filter((x) => x.s > 0 || x.f.kind === "preference").sort((a, b) => b.s - a.s).slice(0, limit);
    return scored.map(({ f }) => { const stale = f.files.filter((x) => x.hash && hash(x.file) !== x.hash).map((x) => x.file); return `- ${f.text} (${f.kind}, from ${f.source}${stale.length ? `; STALE: ${stale.join(", ")} changed since` : ""})`; }).join("\n");
  }
  recordRun(r: { session: string; task: string; outcome: string; summary?: string; filesChanged: string[]; usage: unknown }) {
    this.store.run("INSERT OR REPLACE INTO runs(session,task,outcome,summary,files,usage,created) VALUES(?,?,?,?,?,?,?)", [r.session, r.task, r.outcome, r.summary || "", JSON.stringify(r.filesChanged), JSON.stringify(r.usage), new Date().toISOString()]);
  }
}
