// SQLite store for the repository index (node:sqlite, built into Node >= 22.5; no install).
import fs from "node:fs";
import path from "node:path";

// Silence the one-time ExperimentalWarning for node:sqlite; other warnings still print.
const origEmit = process.emitWarning;
(process as any).emitWarning = function (w: any, ...a: any[]) { if (String(w).includes("SQLite")) return; return (origEmit as any).call(process, w, ...a); };
const { DatabaseSync } = await import("node:sqlite");

export const SCHEMA_VERSION = 3;

export class Store {
  db: any;
  constructor(file: string) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA temp_store=MEMORY;");
    const v = this.get("SELECT value FROM meta WHERE key='schema'", [], true);
    if (v?.value !== String(SCHEMA_VERSION)) this.reset();
  }
  reset() {
    this.db.exec(`
      DROP TABLE IF EXISTS files; DROP TABLE IF EXISTS symbols; DROP TABLE IF EXISTS imports; DROP TABLE IF EXISTS refs; DROP TABLE IF EXISTS meta;
      CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE files(path TEXT PRIMARY KEY, lang TEXT, hash TEXT, mtime REAL, size INTEGER, lines INTEGER, precision TEXT, provider TEXT, errors TEXT, meta TEXT, test INTEGER);
      CREATE TABLE symbols(id INTEGER PRIMARY KEY, file TEXT, name TEXT, short TEXT, kind TEXT, line INTEGER, end INTEGER, exported INTEGER, sig TEXT, parent TEXT);
      CREATE TABLE imports(file TEXT, source TEXT, line INTEGER, names TEXT, resolved TEXT);
      CREATE TABLE refs(file TEXT, name TEXT, kind TEXT, line INTEGER, in_sym TEXT);
      CREATE INDEX sym_short ON symbols(short); CREATE INDEX sym_file ON symbols(file); CREATE INDEX sym_name ON symbols(name);
      CREATE INDEX ref_name ON refs(name); CREATE INDEX ref_file ON refs(file);
      CREATE INDEX imp_file ON imports(file); CREATE INDEX imp_res ON imports(resolved);
    `);
    this.run("INSERT INTO meta(key,value) VALUES('schema',?)", [String(SCHEMA_VERSION)]);
  }
  run(sql: string, params: any[] = []) { return this.db.prepare(sql).run(...params); }
  all(sql: string, params: any[] = []): any[] { return this.db.prepare(sql).all(...params); }
  get(sql: string, params: any[] = [], tolerant = false): any { try { return this.db.prepare(sql).get(...params); } catch (e) { if (tolerant) return undefined; throw e; } }
  tx<T>(fn: () => T): T { this.db.exec("BEGIN"); try { const r = fn(); this.db.exec("COMMIT"); return r; } catch (e) { this.db.exec("ROLLBACK"); throw e; } }
  setMeta(key: string, value: unknown) { this.run("INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [key, JSON.stringify(value)]); }
  getMeta<T>(key: string): T | undefined { const r = this.get("SELECT value FROM meta WHERE key=?", [key]); return r ? JSON.parse(r.value) : undefined; }
  close() { this.db.close(); }
}
