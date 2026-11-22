// Agent runtime: classify -> seed context -> loop(model reply -> edits + batched commands -> observations) -> verify.
// One text protocol for every model (native tool calling is an optimisation planned per provider).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { addUsage, emptyUsage, totalInput, type Usage } from "../core/types.ts";
import type { Repo } from "../intel/repo.ts";
import * as Q from "../intel/query.ts";
import { locate, seedContext } from "../intel/locate.ts";
import { commandsFor } from "../intel/detect.ts";
import { ContextEngine } from "../context/engine.ts";
import { Safety, type Mode, type Approval, type Approver } from "../tools/safety.ts";
import type { Provider } from "../providers/types.ts";
import { Skills } from "../skills/index.ts";
import { Memory } from "../memory/index.ts";

export interface RunOptions { maxCost?: number; mode?: "auto" | "plan"; permission?: Mode; approval?: Approval; approver?: Approver; maxTurns?: number; dry?: boolean; verify?: "auto" | "none" | "full"; log?: (s: string) => void }
export interface RunReport {
  session: string; task: string; level: number; outcome: string; summary?: string;
  turns: number; requests: number; usage: Usage; tokensBySource: Record<string, number>; firstRequestInput: number;
  commands: string[]; filesShown: string[]; filesChanged: string[]; patchTokens: number; verification: string[]; ms: number; model: string;
}

/** Deterministic first guess at task size; the loop escalates on its own when the working set is not enough. */
export function classify(task: string): number {
  const x = task.toLowerCase();
  if (/\b(architecture|re-?architect|state management|rewrite|migrate .* to|framework|infrastructure|monorepo)\b/.test(x)) return 4;
  if (/\b(new|add an?|create an?|implement)\s+(\w+\s+){0,3}(page|route|endpoint|feature|module|service|command|screen|api|subsystem|integration)\b/.test(x)) return 3;
  if (/\b(refactor|restructure|rename .* (everywhere|across)|every (caller|usage|import)|across (the )?(repo|codebase|modules|services|packages)|move .* (into|to) .*(module|package|file|crate|lib))\b/.test(x)) return 3;
  if (/\b(shared|all callers|everywhere|each page|every page|api change|signature)\b/.test(x)) return 2;
  return 1;
}

const SYSTEM = `You are Nexus, a software engineering agent working inside a repository (any language or stack).
Reply ONLY with actions, no prose:
1. Edits: one block per change, SEARCH copied exactly from the working set (as few lines as make it unique); empty SEARCH creates a file.
FILE: <repo-relative path>
<<<<<<< SEARCH
<exact existing lines>
=======
<replacement lines>
>>>>>>> REPLACE
2. Commands, one per line (batch independent ones in one reply):
@locate <words> | @find <name> | @ctx <symbol|file> | @refs <symbol> | @show <symbol|path:a-b|.cssclass> | @map [focus words] | @grep <regex>
@run <shell command> | @test | @check | @skill <name> | @remember <durable fact about this repo> | @ask <question for the user> | @done <one-line summary>
Rules:
- The working set holds exact current file text; never ask for code already shown. Request more only when needed (@show/@ctx/@refs).
- After edits the system itself re-indexes and verifies (syntax, imports, typecheck and tests near the change) and shows the results: do not run typecheck/tests yourself after editing. If the edits fully do the task, include @done in the same reply.
- Make the smallest correct change. Keep conventions of the surrounding code. Update every caller when you change a signature.
- If the request is ambiguous in a way that changes the outcome, use @ask instead of guessing.
- Finish with @done when the task is complete and verified.`;

const EDIT_RE = /FILE:\s*(.+?)\s*\n<<<<<<< SEARCH\n([\s\S]*?)\n?=======\n([\s\S]*?)\n?>>>>>>> REPLACE/g;

export class Agent {
  repo: Repo; provider: Provider; opts: RunOptions; ctx: ContextEngine; safety: Safety; skills: Skills; memory: Memory;
  session = `${new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14)}-${crypto.randomBytes(3).toString("hex")}`;
  log: (s: string) => void;
  constructor(repo: Repo, provider: Provider, opts: RunOptions = {}) {
    this.repo = repo; this.provider = provider; this.opts = opts;
    this.ctx = new ContextEngine(repo.root);
    this.safety = new Safety(repo.root, { mode: opts.mode === "plan" ? "read-only" : opts.permission, approval: opts.approval, approver: opts.approver, session: this.session });
    this.skills = new Skills(repo.root); this.memory = new Memory(repo.root);
    this.log = opts.log || (() => {});
  }

  projectFacts(): string {
    const p = this.repo.profile();
    const cmds = (k: any) => commandsFor(p, k).join(" | ");
    const lines = [
      `Languages: ${p.languages.slice(0, 8).map((l) => `${l.id} (${l.files})`).join(", ") || "-"}. Frameworks: ${p.frameworks.join(", ") || "-"}.`,
      `Build systems: ${p.buildSystems.map((b) => `${b.id}${b.dir !== "." ? `@${b.dir}` : ""}`).join(", ") || "-"}. Build: ${cmds("build") || "-"}. Test: ${cmds("test") || "-"}. Typecheck: ${cmds("typecheck") || "-"}. Lint: ${cmds("lint") || "-"}.`,
      `Entry points: ${p.entryPoints.slice(0, 8).join(", ") || "-"}. Tests: ${p.testDirs.slice(0, 6).join(", ") || "-"}.`,
    ];
    for (const f of p.instructions.filter((f) => /AGENTS\.md|CLAUDE\.md/.test(f)).slice(0, 2)) { try { lines.push(`Instructions from ${f}:\n${fs.readFileSync(path.join(this.repo.root, f), "utf8").slice(0, 4000)}`); } catch {} }
    const nexusMd = path.join(this.repo.root, ".nexus", "project.md"); if (fs.existsSync(nexusMd)) lines.push(fs.readFileSync(nexusMd, "utf8").slice(0, 6000));
    return lines.join("\n");
  }

  async run(task: string): Promise<RunReport> {
    const t0 = Date.now();
    const report: RunReport = { session: this.session, task, level: classify(task), outcome: "", turns: 0, requests: 0, usage: emptyUsage(), tokensBySource: {}, firstRequestInput: 0, commands: [], filesShown: [], filesChanged: [], patchTokens: 0, verification: [], ms: 0, model: this.provider.model };
    const ctx = this.ctx;
    ctx.system = SYSTEM + (this.opts.mode === "plan" ? "\nPLAN MODE: do not edit or run commands that change anything; investigate and finish with @done <the plan>." : "");
    ctx.project = this.projectFacts();
    ctx.skills = this.skills.catalogue(task);
    ctx.memory = this.memory.recallText(task, (f) => this.repo.hash(f));
    ctx.task = task;
    // seed: level 1-2 -> exact code of the located symbols; level 3-4 -> repository map + located candidates
    const seed = seedContext(this.repo, task, report.level);
    const loc = seed.candidates;
    if (seed.blocks.length) {
      for (const b of seed.blocks) ctx.addSpan(b.file, b.from, b.to, b.text, b.reason);
      const others = loc.slice(0, 5);
      if (others.length) ctx.observe("other candidates (not shown)", others.map((x) => `${x.sym.name} ${x.sym.kind} ${x.sym.file}:${x.sym.line}-${x.sym.end}`).join("\n"));
    } else {
      ctx.observe("repository map", Q.map(this.repo, report.level >= 4 ? 3000 : 1800, task.split(/\W+/).filter((w) => w.length > 3).slice(0, 6)));
      if (loc.length) ctx.observe("likely relevant symbols (kg locate)", loc.map((x) => `${x.sym.name} ${x.sym.kind} ${x.sym.file}:${x.sym.line}-${x.sym.end}  <- ${x.why.slice(0, 3).join("; ")}`).join("\n"));
    }
    report.filesShown = [...new Set([...ctx.spans.values()].map((s) => s.file))];
    const maxTurns = this.opts.maxTurns ?? (report.level >= 3 ? 30 : 12);
    let failures = 0;
    for (let turn = 1; turn <= maxTurns; turn++) {
      ctx.turn = turn; report.turns = turn;
      const { user, bySource } = ctx.render(turn === 1 ? "" : "Continue: reply with edits and/or commands; @done when finished.");
      const res = await this.provider.complete({ system: ctx.system, prefix: ctx.prefix(), messages: [{ role: "user", content: user }], cacheKey: this.session, maxTokens: 16000 });
      report.requests++; report.usage = addUsage(report.usage, res.usage);
      if (turn === 1) report.firstRequestInput = totalInput(res.usage);
      const overBudget = this.opts.maxCost !== undefined && (report.usage.cost?.total || 0) > this.opts.maxCost;
      ctx.record({ bySource: { system: Math.ceil(ctx.system.length / 4), project: Math.ceil(ctx.prefix().length / 4), ...bySource }, usage: res.usage, model: res.model, ms: res.ms });
      this.safety.log({ type: "model", turn, usage: res.usage, ms: res.ms, chars: res.text.length });
      this.log(`turn ${turn}: in ${totalInput(res.usage)} (cached ${res.usage.cacheRead}) out ${res.usage.output}`);
      const reply = res.text;
      // 1. edits
      const edits = [...reply.matchAll(EDIT_RE)].map((m) => ({ file: m[1].trim().replace(/^`|`$/g, ""), search: m[2], replace: m[3] }));
      let edited: string[] = [];
      if (edits.length) {
        if (this.opts.mode === "plan") ctx.observe("edits refused", "plan mode: no edits");
        else {
          const r = await this.applyEdits(edits);
          if (r.errors.length) { failures++; ctx.observe("edits NOT applied", r.errors.join("\n") + "\nRe-send corrected blocks (copy SEARCH text exactly from the working set)."); ctx.step(`edit failed: ${r.errors[0]}`); }
          else { edited = r.files; report.patchTokens += Math.ceil(edits.reduce((a, e) => a + e.search.length + e.replace.length, 0) / 4); for (const f of edited) if (!report.filesChanged.includes(f)) report.filesChanged.push(f); ctx.step(`edited ${edited.join(", ")}`); }
        }
      }
      // 2. verification after edits (before commands, so duplicate verification requests can be skipped)
      let verified: boolean | null = null;
      if (edited.length) {
        const v = await this.verify(edited, report.level);
        report.verification.push(v.summary);
        ctx.observe("verification", v.detail);
        ctx.step(`verify: ${v.summary}`);
        verified = v.ok; if (!v.ok) failures++;
      }
      // 3. commands (batched); verification-only commands after a passing verification are redundant
      const isVerify = (c: { name: string; arg: string }) => c.name === "test" || c.name === "check" || (c.name === "run" && /\b(test|tests|typecheck|type-check|tsc|lint|build|check|vet|clippy|pytest|ctest)\b/.test(c.arg) && !/\b(rm|git|curl|install)\b/.test(c.arg));
      const cmds = [...reply.matchAll(/^\s*@(\w+)\s*(.*)$/gm)].map((m) => ({ name: m[1].toLowerCase(), arg: m[2].trim() })).filter((c) => !(verified === true && isVerify(c)));
      let done: string | null = null, asked: string | null = null;
      for (const c of cmds) {
        report.commands.push(`@${c.name} ${c.arg}`.trim());
        if (c.name === "done") { done = c.arg || "done"; continue; }
        if (c.name === "ask") { asked = c.arg; continue; }
        const out = await this.command(c.name, c.arg);
        if (out !== null) ctx.observe(`@${c.name} ${c.arg}`.slice(0, 120), out);
        ctx.step(`@${c.name} ${c.arg}`.slice(0, 140));
      }
      if (verified === false) done = null;
      else if (verified === true && !cmds.some((c) => !["done", "remember", "skill"].includes(c.name))) done = done || "edits applied and verified";
      for (const f of report.filesShown) if (!report.filesShown.includes(f)) report.filesShown.push(f);
      for (const s of ctx.spans.values()) if (!report.filesShown.includes(s.file)) report.filesShown.push(s.file);
      if (asked) { report.outcome = "needs-input"; report.summary = asked; break; }
      if (done) { report.outcome = "done"; report.summary = done; break; }
      if (!edits.length && !cmds.length) { failures++; ctx.observe("format", "Your reply contained no edits and no @commands. Reply only with actions."); }
      if (failures >= 6) { report.outcome = "gave-up"; report.summary = "too many failed steps"; break; }
      if (overBudget) { report.outcome = "budget"; report.summary = `cost limit $${this.opts.maxCost} reached`; break; }
    }
    if (!report.outcome) { report.outcome = "turn-limit"; }
    if (this.opts.dry && report.filesChanged.length) { this.safety.undo(); report.outcome += " (dry run: reverted)"; }
    report.ms = Date.now() - t0;
    report.tokensBySource = ctx.totals() as Record<string, number>;
    const runsDir = path.join(this.repo.root, ".nexus", "runs"); fs.mkdirSync(runsDir, { recursive: true });
    fs.writeFileSync(path.join(runsDir, `${this.session}.json`), JSON.stringify(report, null, 1));
    this.memory.recordRun(report);
    return report;
  }

  async applyEdits(edits: { file: string; search: string; replace: string }[]): Promise<{ files: string[]; errors: string[] }> {
    const next = new Map<string, string>(); const errors: string[] = [];
    for (const [i, e] of edits.entries()) {
      let f = e.file.replace(/^\.\//, "").replace(/:\d+(-\d+)?$/, "");
      if (!this.repo.file(f)) { const hit = this.repo.store.all("SELECT path FROM files WHERE path LIKE ?", [`%/${f}`]); if (hit.length === 1) f = hit[0].path; }
      let abs: string; try { abs = this.safety.inside(f); } catch (err: any) { errors.push(`block ${i + 1}: ${err.message}`); continue; }
      let src = next.get(f) ?? (fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null);
      if (!e.search.trim()) { if (src) { errors.push(`block ${i + 1}: ${f} exists; use a SEARCH block`); continue; } next.set(f, e.replace.endsWith("\n") ? e.replace : e.replace + "\n"); continue; }
      if (src === null) { errors.push(`block ${i + 1}: ${f} not found`); continue; }
      let search = e.search, n = src.split(search).length - 1;
      if (n === 0) { const norm = (s: string) => s.split("\n").map((l) => l.trimEnd()).join("\n"); if (norm(src).split(norm(search)).length - 1 === 1) { src = norm(src); search = norm(search); n = 1; } }
      if (n !== 1) { errors.push(`block ${i + 1}: SEARCH ${n ? `matches ${n} places` : "not found"} in ${f}`); continue; }
      next.set(f, src.replace(search, () => e.replace));
    }
    if (errors.length) return { files: [], errors };
    const files: string[] = [];
    try { for (const [f, text] of next) files.push(await this.safety.write(f, text)); } catch (e: any) { return { files, errors: [e.message] }; }
    await this.repo.index();
    for (const f of files) this.ctx.refreshFile(f, (x, a, b) => this.repo.read(x, a, b));
    return { files, errors };
  }

  async verify(files: string[], level: number): Promise<{ ok: boolean; summary: string; detail: string }> {
    if (this.opts.verify === "none") return { ok: true, summary: "skipped", detail: "verification disabled" };
    const out: string[] = []; let ok = true;
    const chk = await Q.check(this.repo, files);
    out.push(`check: ${chk}`); if (!chk.startsWith("ok")) ok = false;
    const p = this.repo.profile();
    const typed = files.some((f) => /\.(ts|tsx|mts|cts|java|kt|cs|go|rs|swift|scala|c|cc|cpp|h|hpp)$/.test(f));
    const steps: string[] = [];
    if (ok && typed) steps.push(...commandsFor(p, "typecheck", files).slice(0, 1));
    if (ok && (level >= 2 || this.opts.verify === "full" || files.some((f) => this.repo.testsFor(f).length))) steps.push(...commandsFor(p, "test", files).slice(0, 1));
    if (ok && !steps.length && /\.(go|rs|java|kt|c|cc|cpp)$/.test(files.join(" "))) steps.push(...commandsFor(p, "build", files).slice(0, 1));
    for (const cmd of steps) {
      const r = await this.safety.exec(cmd, { timeoutMs: 600_000, cap: 3000 });
      out.push(`$ ${cmd} -> exit ${r.code}${r.code ? `\n${r.out}` : ""}`);
      if (r.code !== 0 && !r.denied) { ok = false; break; }
    }
    return { ok, summary: out.map((l) => l.split("\n")[0]).join("; ").slice(0, 300), detail: out.join("\n") };
  }

  async command(name: string, arg: string): Promise<string | null> {
    const repo = this.repo;
    try {
      switch (name) {
        case "locate": return locate(repo, arg).map((x) => `${x.sym.name} ${x.sym.kind} ${x.sym.file}:${x.sym.line}-${x.sym.end}  <- ${x.why.slice(0, 3).join("; ")}`).join("\n") || "no candidates";
        case "find": return Q.find(repo, arg, 25);
        case "ctx": return Q.ctx(repo, arg);
        case "refs": return Q.refs(repo, arg);
        case "map": return Q.map(repo, 1500, arg.split(/\s+/).filter(Boolean));
        case "grep": return Q.grep(repo, arg, 40);
        case "show": {
          const shown = Q.show(repo, arg, 200);
          const m = shown.match(/^(\S+):(\d+)-(\d+)\n/);
          if (m) { const body = shown.split("\n").slice(1).filter((l) => !l.startsWith("  ...")).map((l) => l.replace(/^\s*\d+  /, "")).join("\n"); const r = this.ctx.addSpan(m[1], +m[2], +m[3], body, `@show ${arg}`); return r === "unchanged" ? `${arg}: already in the working set, unchanged` : null; }
          return shown;
        }
        case "run": { if (this.opts.mode === "plan") return "plan mode: commands that may change state are not run"; const r = await this.safety.exec(arg); return `exit ${r.code}\n${r.out}`; }
        case "test": { const cmd = commandsFor(repo.profile(), "test", [...this.ctx.spans.values()].map((s) => s.file))[0]; if (!cmd) return "no test command detected; use @run"; const r = await this.safety.exec(cmd, { timeoutMs: 900_000 }); return `$ ${cmd}\nexit ${r.code}\n${r.out}`; }
        case "check": return await Q.check(repo, Q.changedFiles(repo));
        case "skill": { const s = this.skills.load(arg); if (!s) return `no skill "${arg}"`; this.ctx.skills += `\n\n## Skill: ${arg}\n${s}`; return `skill ${arg} loaded into the project context`; }
        case "remember": { this.memory.remember(arg, { source: `agent:${this.session}`, files: [...this.ctx.spans.values()].map((s) => s.file).slice(0, 5), hash: (f) => repo.hash(f) }); return "remembered"; }
        default: return `unknown command @${name}`;
      }
    } catch (e: any) { return `error: ${e.message}`; }
  }
}
