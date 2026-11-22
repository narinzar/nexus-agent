// Context Engine: assembles every model request from typed state instead of an ever-growing transcript.
//  - stable prefix (system rules, project facts, skill catalogue, memory) is identical across a session -> cacheable
//  - volatile suffix is rebuilt each turn from: task, working set (spans with file hashes), recent observations,
//    and a compact log of earlier steps
//  - an inspection ledger dedupes spans (unchanged -> one-line reference) and flags stale ones (file changed)
//  - every request records estimated tokens per source, to compare with provider-reported usage
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { estTokens, type Usage } from "../core/types.ts";

export type Source = "system" | "project" | "skills" | "memory" | "task" | "code" | "observation" | "history" | "error";
export interface Span { key: string; file: string; from: number; to: number; text: string; hash: string; turn: number; seq?: number; reason?: string }
export interface CallRecord { turn: number; bySource: Partial<Record<Source, number>>; usage?: Usage; model?: string; ms?: number }

const fileHash = (root: string, file: string) => { try { return crypto.createHash("sha1").update(fs.readFileSync(path.join(root, file))).digest("hex").slice(0, 12); } catch { return "missing"; } };

export class ContextEngine {
  root: string; turn = 0;
  system = ""; project = ""; skills = ""; memory = "";
  task = "";
  spans = new Map<string, Span>();
  observations: { turn: number; seq?: number; title: string; text: string }[] = [];
  seq = 0; // monotonically increasing: every span/observation gets one, so "what is new since the last request" is exact
  steps: string[] = []; // one line per earlier action: the compacted history
  calls: CallRecord[] = [];
  /** Append-only conversation: earlier turns are never re-rendered, so providers serve them from the prompt cache. */
  history: { role: "user" | "assistant"; content: string }[] = [];
  epoch = 0; // increments on compaction (a new cached conversation starts)
  compactAt = 60_000; // estimated tokens of history before compacting
  private sentSeq = 0; // observations/spans up to this turn were already sent
  keepObservations = 3;
  maxObservationChars = 8000;
  constructor(root: string) { this.root = root; }

  /** Add a code span to the working set. Returns how it was shown: new, unchanged (deduped) or refreshed (stale). */
  addSpan(file: string, from: number, to: number, text: string, reason?: string): "new" | "unchanged" | "refreshed" {
    const key = `${file}:${from}-${to}`;
    const hash = fileHash(this.root, file);
    const prev = this.spans.get(key);
    if (prev && prev.hash === hash) return "unchanged";
    // a wider span already covering it with the same file version also counts as shown
    for (const s of this.spans.values()) if (s.file === file && s.hash === hash && s.from <= from && s.to >= to) return "unchanged";
    // drop narrower spans of the same file that this one covers
    for (const [k, s] of this.spans) if (s.file === file && s.from >= from && s.to <= to) this.spans.delete(k);
    this.spans.set(key, { key, file, from, to, text, hash, turn: this.turn, seq: ++this.seq, reason });
    return prev ? "refreshed" : "new";
  }
  /** Spans whose file changed since they were read: re-read them or treat as outdated. */
  stale(): Span[] { return [...this.spans.values()].filter((s) => fileHash(this.root, s.file) !== s.hash); }
  /** After the agent edits a file, re-slice its spans so the working set shows current code. */
  refreshFile(file: string, read: (f: string, a: number, b: number) => string[]) {
    for (const s of [...this.spans.values()].filter((x) => x.file === file)) {
      const lines = read(file, s.from, s.to + 20);
      this.spans.set(s.key, { ...s, text: lines.slice(0, s.to - s.from + 1).join("\n"), hash: fileHash(this.root, file), turn: this.turn, seq: ++this.seq });
    }
  }
  observe(title: string, text: string) {
    const t = text.length > this.maxObservationChars ? `${text.slice(0, this.maxObservationChars * 0.7)}\n... [${text.length - this.maxObservationChars} chars omitted]\n${text.slice(-this.maxObservationChars * 0.3)}` : text;
    this.observations.push({ turn: this.turn, seq: ++this.seq, title, text: t });
  }
  step(line: string) { this.steps.push(`${this.turn}. ${line}`); }

  /** The cacheable prefix: identical across turns unless skills/memory are activated. */
  prefix(): string { return [this.project && `# Project\n${this.project}`, this.skills && `# Skills\n${this.skills}`, this.memory && `# Remembered facts\n${this.memory}`].filter(Boolean).join("\n\n"); }

  /** Volatile suffix for this turn + per-source token estimate. */
  render(extra = ""): { user: string; bySource: Partial<Record<Source, number>> } {
    const by: Partial<Record<Source, number>> = {};
    const parts: string[] = [];
    const push = (src: Source, s: string) => { if (!s) return; parts.push(s); by[src] = (by[src] || 0) + estTokens(s); };
    push("task", `# Task\n${this.task}`);
    const stale = this.stale();
    if (stale.length) push("error", `# Stale\nThese files changed since you read them; the spans below were refreshed or must be re-read: ${[...new Set(stale.map((s) => s.file))].join(", ")}`);
    if (this.spans.size) push("code", `# Working set (exact current file text)\n${[...this.spans.values()].sort((a, b) => a.file.localeCompare(b.file) || a.from - b.from).map((s) => `### ${s.file}:${s.from}-${s.to}${s.reason ? `  (${s.reason})` : ""}\n${s.text}`).join("\n\n")}`);
    if (this.steps.length) push("history", `# Steps so far\n${this.steps.slice(-40).join("\n")}`);
    const recent = this.observations.slice(-this.keepObservations);
    if (recent.length) push("observation", `# Latest results\n${recent.map((o) => `## ${o.title}\n${o.text}`).join("\n\n")}`);
    if (extra) push("task", extra);
    return { user: parts.join("\n\n"), bySource: by };
  }
  /** Messages for this turn: the first turn (or after compaction) gets the full rendered state; later turns append
   *  only what is new (spans added or refreshed and observations since the last request). */
  nextMessages(prevReply?: string): { messages: { role: "user" | "assistant"; content: string }[]; bySource: Partial<Record<Source, number>> } {
    if (prevReply !== undefined && this.history.length) this.history.push({ role: "assistant", content: prevReply });
    const size = this.history.reduce((a, m) => a + estTokens(m.content), 0);
    if (!this.history.length || size > this.compactAt) {
      if (this.history.length) this.epoch++; // compaction: one cache miss, then append-only again
      const r = this.render(this.history.length ? "Continue from the steps above: reply with edits and/or commands; @done when finished." : "");
      this.history = [{ role: "user", content: r.user }]; this.sentSeq = this.seq;
      return { messages: this.history, bySource: r.bySource };
    }
    const by: Partial<Record<Source, number>> = {}; const parts: string[] = [];
    const push = (src: Source, s: string) => { parts.push(s); by[src] = (by[src] || 0) + estTokens(s); };
    const stale = this.stale(); if (stale.length) push("error", `Changed since you read them (re-read if needed): ${[...new Set(stale.map((s) => s.file))].join(", ")}`);
    const fresh = [...this.spans.values()].filter((s) => (s.seq || 0) > this.sentSeq);
    if (fresh.length) push("code", `# Code (exact current text)\n${fresh.map((s) => `### ${s.file}:${s.from}-${s.to}${s.reason ? `  (${s.reason})` : ""}\n${s.text}`).join("\n\n")}`);
    const obs = this.observations.filter((o) => (o.seq || 0) > this.sentSeq);
    if (obs.length) push("observation", obs.map((o) => `## ${o.title}\n${o.text}`).join("\n\n"));
    push("task", "Continue: reply with edits and/or commands; @done when finished.");
    this.sentSeq = this.seq;
    this.history.push({ role: "user", content: parts.join("\n\n") });
    return { messages: this.history, bySource: by };
  }
  record(rec: Omit<CallRecord, "turn">) { this.calls.push({ turn: this.turn, ...rec }); }
  totals() {
    const by: Partial<Record<Source, number>> = {};
    for (const c of this.calls) for (const [k, v] of Object.entries(c.bySource)) by[k as Source] = (by[k as Source] || 0) + (v as number);
    return by;
  }
}
