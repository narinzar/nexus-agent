// Execution & safety layer: permission mode x approval policy (after Codex), workspace boundary, command risk
// classification, checkpoints before every write, and an append-only JSONL execution log.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

export type Mode = "read-only" | "workspace-write" | "full";
export type Approval = "always" | "risky" | "never"; // when to ask the user: every action, only risky ones, never (mode limits still apply)
export type Approver = (what: string) => Promise<boolean>;

const READ_ONLY_CMDS = /^(git\s+(status|diff|log|show|branch|ls-files|blame|rev-parse)|ls|cat|head|tail|wc|rg|grep|find|tree|pwd|echo|which|node\s+--version|python3?\s+--version|go\s+(version|list|vet)|cargo\s+(metadata|tree)|npm\s+(ls|view)|pip\s+(list|show))\b/;
const RISKY: [RegExp, string][] = [
  [/\brm\s+(-\w*[rf]\w*\s+)+/, "recursive/forced delete"], [/\bgit\s+(push|reset\s+--hard|clean\s+-\w*f|checkout\s+--\s|rebase|commit\s+--amend)/, "history or remote change"],
  [/\b(curl|wget|nc|ssh|scp|rsync)\b/, "network access"], [/\b(npm|pnpm|yarn|pip3?|gem|cargo|go)\s+(install|add|i)\b|\bapt(-get)?\s+install|\bbrew\s+install/, "installs packages"],
  [/\bsudo\b|\bchmod\s+-R|\bchown\b|\bmkfs|\bdd\s+if=/, "system change"], [/\bdocker\s+(run|rm|rmi|system\s+prune)|kubectl\s+(apply|delete)|terraform\s+(apply|destroy)/, "infrastructure change"],
  [/>\s*\/(?!dev\/null)|\btee\s+\//, "writes outside workspace"], [/\b(shutdown|reboot|kill\s+-9|pkill)\b/, "process/system control"],
];
export function classifyCommand(cmd: string): { readOnly: boolean; risks: string[] } {
  const parts = cmd.split(/&&|\|\||;|\|/).map((s) => s.trim()).filter(Boolean);
  return { readOnly: parts.every((p) => READ_ONLY_CMDS.test(p)), risks: RISKY.filter(([re]) => re.test(cmd)).map(([, why]) => why) };
}

export class Safety {
  root: string; mode: Mode; approval: Approval; approver: Approver; session: string; logFile: string; ckDir: string;
  checkpoints: { file: string; existed: boolean }[] = [];
  constructor(root: string, opts: { mode?: Mode; approval?: Approval; approver?: Approver; session: string }) {
    this.root = path.resolve(root); this.mode = opts.mode || "workspace-write"; this.approval = opts.approval || "risky";
    this.approver = opts.approver || (async () => false); this.session = opts.session;
    this.logFile = path.join(this.root, ".nexus", "log", `${this.session}.jsonl`);
    this.ckDir = path.join(this.root, ".nexus", "checkpoints", this.session);
  }
  log(event: Record<string, unknown>) { fs.mkdirSync(path.dirname(this.logFile), { recursive: true }); fs.appendFileSync(this.logFile, JSON.stringify({ t: new Date().toISOString(), ...event }) + "\n"); }

  /** Resolve a path and enforce the workspace boundary (and never touch .git internals). */
  inside(p: string): string {
    const abs = path.resolve(this.root, p);
    const rel = path.relative(this.root, abs);
    if (rel.startsWith("..") || path.isAbsolute(rel)) throw new Error(`path outside the workspace: ${p}`);
    if (/^\.git(\/|$)/.test(rel)) throw new Error(`refusing to touch git internals: ${p}`);
    return abs;
  }

  async canWrite(file: string): Promise<void> {
    if (this.mode === "read-only") throw new Error(`read-only mode: cannot write ${file}`);
    const abs = path.resolve(this.root, file);
    if (this.mode === "workspace-write") this.inside(file);
    if (this.approval === "always" && !(await this.approver(`write ${path.relative(this.root, abs)}`))) throw new Error(`write to ${file} not approved`);
  }

  /** Write with checkpoint; returns repo-relative path. */
  async write(file: string, content: string): Promise<string> {
    await this.canWrite(file);
    const abs = this.mode === "full" ? path.resolve(this.root, file) : this.inside(file);
    const rel = path.relative(this.root, abs);
    if (!this.checkpoints.some((c) => c.file === rel)) {
      const existed = fs.existsSync(abs);
      if (existed) { const ck = path.join(this.ckDir, rel); fs.mkdirSync(path.dirname(ck), { recursive: true }); fs.copyFileSync(abs, ck); }
      this.checkpoints.push({ file: rel, existed });
      fs.mkdirSync(this.ckDir, { recursive: true }); fs.writeFileSync(path.join(this.ckDir, ".manifest.json"), JSON.stringify(this.checkpoints));
    }
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
    this.log({ type: "write", file: rel, bytes: content.length });
    return rel;
  }

  /** Run a shell command under the policy. Output is capped head+tail so it never floods the context. */
  async exec(cmd: string, { timeoutMs = 300_000, cap = 6000 } = {}): Promise<{ code: number; out: string; denied?: string }> {
    const { readOnly, risks } = classifyCommand(cmd);
    if (this.mode === "read-only" && !readOnly) return this.denied(cmd, "read-only mode allows only read-only commands");
    const ask = this.approval === "always" || (this.approval === "risky" && risks.length > 0);
    if (ask && !(await this.approver(`run: ${cmd}${risks.length ? `  [${risks.join(", ")}]` : ""}`))) return this.denied(cmd, `not approved${risks.length ? ` (${risks.join(", ")})` : ""}`);
    const t0 = Date.now();
    const r = spawnSync("bash", ["-lc", cmd], { cwd: this.root, encoding: "utf8", timeout: timeoutMs, maxBuffer: 1 << 26, env: { ...process.env, CI: "1", NO_COLOR: "1", FORCE_COLOR: "0" } });
    const raw = ((r.stdout || "") + (r.stderr ? (r.stdout ? "\n" : "") + r.stderr : "")).replace(/\x1b\[[0-9;]*m/g, "");
    const out = raw.length > cap ? `${raw.slice(0, cap * 0.4)}\n... [${raw.length - cap} chars omitted] ...\n${raw.slice(-cap * 0.6)}` : raw;
    const code = r.status ?? (r.signal ? 124 : 1);
    this.log({ type: "exec", cmd, code, ms: Date.now() - t0, outChars: raw.length, risks });
    return { code, out: out || (code === 0 ? "(no output)" : `(no output, exit ${code})`) };
  }
  private denied(cmd: string, why: string) { this.log({ type: "denied", cmd, why }); return { code: 126, out: `DENIED: ${why}`, denied: why }; }

  /** Restore every file written in this session. */
  /** Unified diff of everything this session changed, from the checkpoints (needs no VCS in the project). */
  diff(maxChars = 12000): string {
    const out: string[] = [];
    for (const c of this.checkpoints) {
      const abs = path.join(this.root, c.file), before = c.existed ? path.join(this.ckDir, c.file) : null;
      const r = spawnSync("git", ["diff", "--no-index", "--no-color", "-U3", before || "/dev/null", fs.existsSync(abs) ? abs : "/dev/null"], { encoding: "utf8" });
      let d = r.stdout || "";
      if (!d && r.error) d = `--- ${c.file}\n+++ ${c.file}\n${fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : "(deleted)"}`;
      out.push(d.replace(/^(---|\+\+\+) (a|b)?\S*/gm, (_m, k) => `${k} ${c.file}`).replace(/^diff --git .*\n(index .*\n)?/gm, ""));
    }
    const all = out.join("\n");
    return all.length > maxChars ? all.slice(0, maxChars) + `\n... (diff truncated at ${maxChars} chars)` : all;
  }

  undo(): string[] {
    const restored: string[] = [];
    for (const c of [...this.checkpoints].reverse()) {
      const abs = path.join(this.root, c.file);
      if (c.existed) fs.copyFileSync(path.join(this.ckDir, c.file), abs); else fs.rmSync(abs, { force: true });
      restored.push(c.file);
    }
    this.log({ type: "undo", files: restored }); this.checkpoints = [];
    return restored;
  }
  static undoSession(root: string, session: string): string[] {
    const ckDir = path.join(root, ".nexus", "checkpoints", session);
    const s = new Safety(root, { session });
    s.checkpoints = JSON.parse(fs.readFileSync(path.join(ckDir, ".manifest.json"), "utf8"));
    return s.undo();
  }
}

/** Interactive approver for terminals; non-interactive sessions deny by default. */
export function ttyApprover(): Approver {
  return async (what) => {
    if (!process.stdin.isTTY) return false;
    const rl = (await import("node:readline/promises")).createInterface({ input: process.stdin, output: process.stderr });
    const a = await rl.question(`[nexus] approve? ${what}  (y/N) `); rl.close();
    return /^y(es)?$/i.test(a.trim());
  };
}
