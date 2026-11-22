// `nexus factory`: run several tasks in parallel, each in its own git worktree and branch, then decide each one with
// deterministic gates. The model only writes code (with its own review round); approval is not a model's opinion:
//   build (nexus run, with a review round on every job) -> gates: changed? checks pass? escalation paths? merges cleanly? -> decision
// Tasks predicted to touch the same files share a lane and run one after another; lanes run in parallel.
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Repo } from "../repo-intel/repo.ts";
import { locate } from "../repo-intel/locate.ts";
import { readConfig, DEFAULT_ESCALATE, type FactoryConfig } from "./init.ts";
import { loadProfile, ATTRIBUTION_RE } from "./profile.ts";

const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../cli.ts");

export interface Job {
  id: string; task: string; branch: string; worktree: string; base: string;
  stage: "queued" | "building" | "gates" | "approved" | "needs-human" | "failed" | "merged";
  predicted: string[]; changed: string[];
  build?: { outcome: string; summary?: string; requests: number; cost: number | null; reviews: string[] };
  gates: { name: string; ok: boolean; detail: string }[];
  reasons: string[]; started?: string; finished?: string;
}

const git = (cwd: string, ...args: string[]) => spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: 1 << 26 });
const slug = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "task";
const jobsDir = (root: string) => path.join(root, ".nexus", "jobs");

/** Atomic id claim: mkdir fails if another process took the number. */
function claim(root: string, task: string): string {
  fs.mkdirSync(jobsDir(root), { recursive: true });
  const used = fs.readdirSync(jobsDir(root)).map((d) => +d.slice(0, 3)).filter((n) => n > 0);
  for (let n = Math.max(0, ...used) + 1; ; n++) {
    const id = `${String(n).padStart(3, "0")}-${slug(task)}`;
    try { fs.mkdirSync(path.join(jobsDir(root), id)); return id; } catch (e: any) { if (e.code !== "EEXIST") throw e; }
  }
}

function globRe(g: string): RegExp {
  const re = g.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*\//g, "\u0000").replace(/\*\*/g, ".*").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]").replace(/\u0000/g, "(?:.*/)?");
  return new RegExp(`^${re}$`);
}
export const matchesAny = (file: string, globs: string[]) => globs.some((g) => globRe(g).test(file));

/** Group tasks whose predicted files overlap (union-find), so they never edit the same code at the same time. */
export function lanes(jobs: Job[]): Job[][] {
  const parent = jobs.map((_, i) => i), find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < jobs.length; i++) for (let j = i + 1; j < jobs.length; j++) if (jobs[i].predicted.some((f) => jobs[j].predicted.includes(f))) parent[find(i)] = find(j);
  const by = new Map<number, Job[]>(); jobs.forEach((j, i) => { const r = find(i); by.set(r, [...(by.get(r) || []), j]); });
  return [...by.values()];
}

function save(root: string, j: Job) {
  const d = path.join(jobsDir(root), j.id); fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, "job.json"), JSON.stringify(j, null, 1));
  const lines = [`# ${j.id}: ${j.stage}`, "", `Task: ${j.task}`, "", `Branch \`${j.branch}\` from \`${j.base.slice(0, 10)}\`, worktree \`${j.worktree}\`.`, ""];
  if (j.build) lines.push(`Build: ${j.build.outcome}${j.build.summary ? ` (${j.build.summary})` : ""}; ${j.build.requests} requests; cost ${j.build.cost === null ? "unknown" : `$${j.build.cost.toFixed(3)}`}; review: ${j.build.reviews.join(" / ") || "-"}.`, "");
  if (j.changed.length) lines.push(`Changed: ${j.changed.map((f) => `\`${f}\``).join(", ")}.`, "");
  if (j.gates.length) lines.push("| Gate | Result | Evidence |", "|---|---|---|", ...j.gates.map((g) => `| ${g.name} | ${g.ok ? "pass" : "FAIL"} | ${g.detail.replace(/\|/g, "\\|").replace(/\n/g, " ").slice(0, 200)} |`), "");
  if (j.reasons.length) lines.push("Needs the owner because:", ...j.reasons.map((r) => `- ${r}`), "");
  fs.writeFileSync(path.join(d, "decision.md"), lines.join("\n"));
}

function run(cmd: string, cwd: string, timeoutMs = 900_000): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const p = spawn(cmd, { cwd, shell: true, env: process.env });
    let out = ""; const add = (b: Buffer) => { out += b.toString(); if (out.length > 200_000) out = out.slice(-100_000); };
    p.stdout.on("data", add); p.stderr.on("data", add);
    const t = setTimeout(() => p.kill("SIGTERM"), timeoutMs);
    p.on("close", (code) => { clearTimeout(t); resolve({ code: code ?? 1, out }); });
  });
}

function runNexus(wt: string, task: string, model: string | undefined, maxCost: string): Promise<any> {
  return new Promise((resolve) => {
    const env = { ...process.env, ...(process.env.HTTPS_PROXY ? { NODE_USE_ENV_PROXY: "1" } : {}) };
    // unattended, so every job gets a review round
    const args = ["--disable-warning=ExperimentalWarning", CLI, "run", "--repo", wt, "--json", "--quiet", "--approve", "never", "--review", "always", "--max-cost", maxCost, ...(model ? ["--model", model] : []), task];
    const p = spawn(process.execPath, args, { cwd: wt, env });
    let out = "", err = ""; p.stdout.on("data", (b) => (out += b)); p.stderr.on("data", (b) => (err += b));
    p.on("close", () => { try { resolve(JSON.parse(out.slice(out.indexOf("{")))); } catch { resolve({ outcome: "error", summary: (err || out).slice(-300), requests: 0, usage: {}, reviews: [] }); } });
  });
}

export interface FactoryOptions { parallel?: number; model?: string; maxCost?: string; merge?: boolean; log?: (s: string) => void }

export async function runJobs(root: string, tasks: string[], o: FactoryOptions = {}): Promise<Job[]> {
  const log = o.log || (() => {});
  const cfg: FactoryConfig | null = readConfig(root);
  if (git(root, "rev-parse", "--is-inside-work-tree").stdout.trim() !== "true") throw new Error("not a git repository: the factory runs each job on its own branch");
  const repo = await new Repo(root).init(); await repo.index();
  const jobs: Job[] = tasks.map((task) => {
    const id = claim(root, task), base = git(root, "rev-parse", "HEAD").stdout.trim();
    // predicted files: strong candidates only (at least half the top score), so unrelated tasks are not serialised
    // files the task names explicitly win; otherwise strong candidates only (at least half the top score)
    const named = [...task.matchAll(/[\w./-]+\.\w{1,5}\b/g)].map((m) => m[0].replace(/^\.\//, "")).filter((f) => repo.file(f));
    const cands = named.length ? [] : locate(repo, task), top = cands[0]?.score || 0;
    const files = named.length ? [...new Set(named)] : [...new Set(cands.filter((x) => x.score >= top * 0.5).map((x) => x.sym.file))].slice(0, 5);
    const predicted = [...new Set([...files, ...files.flatMap((f) => repo.testsFor(f))])]; // shared tests conflict too
    const j: Job = { id, task, branch: `job/${id}`, worktree: path.join(path.dirname(root), `${path.basename(root)}.jobs`, id), base, stage: "queued", predicted, changed: [], gates: [], reasons: [] };
    save(root, j); return j;
  });
  repo.close();
  const ls = lanes(jobs);
  log(`${jobs.length} job(s) in ${ls.length} lane(s); running ${Math.min(o.parallel || 3, ls.length)} at a time`);
  let mergeChain = Promise.resolve();
  const doLane = async (lane: Job[]) => {
    for (const j of lane) {
      if (o.merge) { await mergeChain; j.base = git(root, "rev-parse", "HEAD").stdout.trim(); } // start from what earlier jobs merged
      await runJob(root, j, cfg, o, log);
      if (o.merge && j.stage === "approved") mergeChain = mergeChain.then(() => { mergeJob(root, j, log); });
    }
  };
  // a small pool over lanes
  const queue = [...ls]; const workers = Array.from({ length: Math.min(o.parallel || 3, ls.length) }, async () => { while (queue.length) await doLane(queue.shift()!); });
  await Promise.all(workers); await mergeChain;
  return jobs;
}

async function runJob(root: string, j: Job, cfg: FactoryConfig | null, o: FactoryOptions, log: (s: string) => void) {
  j.started = new Date().toISOString(); j.stage = "building"; save(root, j);
  fs.mkdirSync(path.dirname(j.worktree), { recursive: true });
  const add = git(root, "worktree", "add", "-q", "-b", j.branch, j.worktree, j.base);
  if (add.status !== 0) { j.stage = "failed"; j.reasons.push(`worktree: ${add.stderr.trim()}`); return save(root, j); }
  // dependencies: reuse the main checkout's node_modules when present (fast, read-mostly); otherwise run setup
  if (fs.existsSync(path.join(root, "node_modules")) && !fs.existsSync(path.join(j.worktree, "node_modules"))) fs.symlinkSync(path.join(root, "node_modules"), path.join(j.worktree, "node_modules"), "junction");
  else if (cfg?.setup) { const s = await run(cfg.setup, j.worktree); j.gates.push({ name: "setup", ok: s.code === 0, detail: `${cfg.setup} -> exit ${s.code}` }); }
  log(`[${j.id}] building`);
  const r = await runNexus(j.worktree, j.task, o.model || cfg?.models?.build, o.maxCost || "1");
  j.build = { outcome: r.outcome, summary: r.summary, requests: r.requests || 0, cost: r.usage?.cost?.source === "unknown" ? null : r.usage?.cost?.total ?? null, reviews: r.reviews || [] };
  j.stage = "gates"; save(root, j);
  // gates, all deterministic
  git(j.worktree, "add", "-A", "--", ".", ":!.nexus", ":!node_modules");
  j.changed = git(j.worktree, "diff", "--cached", "--name-only").stdout.split("\n").filter(Boolean);
  j.gates.push({ name: "agent finished", ok: r.outcome === "done", detail: `${r.outcome}${r.summary ? `: ${r.summary}` : ""}` });
  j.gates.push({ name: "changed something", ok: j.changed.length > 0, detail: `${j.changed.length} file(s)` });
  for (const c of (cfg?.commands || []).filter((x) => ["typecheck", "lint", "test"].includes(x.kind))) {
    const res = await run(c.cmd, j.worktree);
    j.gates.push({ name: c.kind, ok: res.code === 0, detail: `\`${c.cmd}\` exit ${res.code}${res.code ? `: ${res.out.trim().split("\n").slice(-3).join(" ")}` : ""}` });
  }
  const risky = j.changed.filter((f) => matchesAny(f, cfg?.escalate || DEFAULT_ESCALATE));
  j.gates.push({ name: "escalation paths", ok: !risky.length, detail: risky.length ? risky.join(", ") : "none touched" });
  if (j.changed.length) {
    const me = loadProfile(), msg = j.task.split("\n")[0].slice(0, 72);
    if (ATTRIBUTION_RE.test(msg)) j.reasons.push("task text contains an attribution line");
    const id = me.git.name && me.git.email ? ["-c", `user.name=${me.git.name}`, "-c", `user.email=${me.git.email}`] : [];
    const c = git(j.worktree, ...id, "commit", "-q", "-m", msg, "-m", j.task.length > 72 ? j.task : "");
    j.gates.push({ name: "commit", ok: c.status === 0, detail: c.status === 0 ? git(j.worktree, "rev-parse", "--short", "HEAD").stdout.trim() : c.stderr.trim() });
    const head = git(root, "rev-parse", "HEAD").stdout.trim();
    const mt = git(root, "merge-tree", "--write-tree", head, j.branch);
    j.gates.push({ name: "merges cleanly", ok: mt.status === 0, detail: mt.status === 0 ? `onto ${head.slice(0, 10)}` : "conflicts with the current branch" });
  }
  const failed = j.gates.filter((g) => !g.ok);
  if (risky.length) j.reasons.push(`touches escalation paths: ${risky.join(", ")}`);
  for (const g of failed.filter((g) => g.name !== "escalation paths")) j.reasons.push(`${g.name}: ${g.detail}`);
  j.stage = !j.changed.length || failed.some((g) => g.name === "agent finished" || g.name === "commit") ? "failed" : failed.length ? "needs-human" : "approved";
  j.finished = new Date().toISOString(); save(root, j);
  log(`[${j.id}] ${j.stage}${j.reasons.length ? `: ${j.reasons[0]}` : ""}`);
}

/** Merge an approved job into the current branch (local only; never pushes), then remove its worktree. */
export function mergeJob(root: string, j: Job, log: (s: string) => void = () => {}) {
  if (git(root, "status", "--porcelain", "--untracked-files=no").stdout.trim()) { j.reasons.push("main checkout has uncommitted changes: not merged"); return save(root, j); }
  const me = loadProfile(), id = me.git.name && me.git.email ? ["-c", `user.name=${me.git.name}`, "-c", `user.email=${me.git.email}`] : [];
  const m = git(root, ...id, "merge", "--no-ff", "--no-edit", "-q", j.branch);
  if (m.status !== 0) { git(root, "merge", "--abort"); j.stage = "needs-human"; j.reasons.push(`merge failed: ${m.stderr.trim().slice(0, 200)}`); return save(root, j); }
  git(root, "worktree", "remove", "--force", j.worktree); git(root, "branch", "-q", "-d", j.branch);
  j.stage = "merged"; save(root, j); log(`[${j.id}] merged`);
}

export function listJobs(root: string): Job[] {
  try { return fs.readdirSync(jobsDir(root)).sort().flatMap((d) => { try { return [JSON.parse(fs.readFileSync(path.join(jobsDir(root), d, "job.json"), "utf8"))]; } catch { return []; } }); } catch { return []; }
}

/** Unchecked items of a Markdown backlog ("- [ ] task"). Claimed items are ticked so another session skips them. */
export function takeBacklog(file: string, n: number): string[] {
  const text = fs.readFileSync(file, "utf8"), out: string[] = [];
  const next = text.replace(/^(\s*[-*] )\[ \] (.+)$/gm, (m, pre, t) => { if (out.length >= n) return m; out.push(t.trim()); return `${pre}[x] ${t} (job started ${new Date().toISOString().slice(0, 10)})`; });
  fs.writeFileSync(file, next);
  return out;
}
