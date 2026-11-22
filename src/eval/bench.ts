// Benchmark harness: same tasks, isolated copies, two (or more) agent variants, hidden acceptance tests.
//   nexus        Nexus-Agent (`nexus run`) with the chosen model spec
//   claude-code  stock Claude Code headless (`claude -p`), default configuration: the baseline workflow
// Metrics: requests, first-request input, total input (uncached / cache read / cache write), output, cost (as reported),
// latency, files changed, gold-file coverage, acceptance (hidden tests copied in after the agent finished).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
interface Task { id: string; fixture?: string; git?: string; commit?: string; link?: string[]; lang: string; level: number; prompt: string; gold: string[]; hidden?: Record<string, string>; accept: string }
export interface Result { task: string; variant: string; lang: string; level: number; requests: number; firstInput: number; totalInput: number; uncached: number; cacheRead: number; cacheWrite: number; output: number; cost: number | null; ms: number; changed: string[]; goldEdited: number; accept: "pass" | "fail"; acceptOut?: string; outcome: string }

const sh = (cmd: string, cwd: string, timeout = 900_000) => spawnSync("bash", ["-lc", cmd], { cwd, encoding: "utf8", timeout, maxBuffer: 1 << 27 });

function prepare(t: Task, dir: string) {
  fs.rmSync(dir, { recursive: true, force: true });
  if (t.fixture) { fs.cpSync(path.join(HERE, "bench/fixtures", t.fixture), dir, { recursive: true }); execFileSync("git", ["init", "-q"], { cwd: dir }); }
  else { execFileSync("git", ["clone", "-q", "--no-checkout", t.git!, dir]); execFileSync("git", ["checkout", "-q", "--detach", t.commit!], { cwd: dir }); }
  for (const l of t.link || []) fs.symlinkSync(path.join(t.git!, l), path.join(dir, l));
  execFileSync("git", ["add", "-A"], { cwd: dir });
  execFileSync("git", ["-c", "user.name=bench", "-c", "user.email=bench@localhost", "commit", "-qm", "bench start", "--allow-empty"], { cwd: dir });
}

function changedFiles(dir: string): string[] {
  const r = sh("git add -A -- . ':!.nexus' && git diff --cached --name-only HEAD", dir);
  return (r.stdout || "").split("\n").filter((f) => f && !f.startsWith(".nexus/"));
}

function runNexus(t: Task, dir: string, model: string): Partial<Result> {
  const r = spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", path.join(HERE, "src/cli.ts"), "run", "--repo", dir, "--json", "--quiet", "--approve", "never", "--model", model, t.prompt], { cwd: dir, encoding: "utf8", timeout: 1_800_000, maxBuffer: 1 << 27 });
  const j = JSON.parse(r.stdout.slice(r.stdout.indexOf("{")));
  const u = j.usage;
  return { requests: j.requests, firstInput: j.firstRequestInput, totalInput: u.inputUncached + u.cacheRead + u.cacheWrite, uncached: u.inputUncached, cacheRead: u.cacheRead, cacheWrite: u.cacheWrite, output: u.output, cost: u.cost?.source === "unknown" ? null : u.cost.total, outcome: `${j.outcome}${j.summary ? ": " + j.summary.slice(0, 80) : ""}` };
}

function runClaudeCode(t: Task, dir: string, model: string): Partial<Result> {
  const env = { ...process.env }; delete env.CLAUDE_ADDITIONAL_DIRECTORIES; delete env.CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD;
  const args = ["-p", `${t.prompt}\n\nChange the working tree only: do not commit or push.`, "--output-format", "stream-json", "--verbose", "--permission-mode", "acceptEdits", "--allowedTools", "Bash,Read,Edit,Write,Grep,Glob", "--max-budget-usd", "3", ...(model ? ["--model", model] : [])];
  const r = spawnSync("claude", args, { cwd: dir, env, encoding: "utf8", timeout: 1_800_000, maxBuffer: 1 << 28 });
  const req = new Map<string, any>(); let res: any = null;
  for (const l of (r.stdout || "").split("\n")) { let e: any; try { e = JSON.parse(l); } catch { continue; } if (e.type === "assistant" && e.message?.id) req.set(e.message.id, e.message.usage); if (e.type === "result") res = e; }
  const us = [...req.values()]; const sum = (k: string) => us.reduce((a, x) => a + (x?.[k] || 0), 0);
  const tot = (x: any) => (x?.input_tokens || 0) + (x?.cache_read_input_tokens || 0) + (x?.cache_creation_input_tokens || 0);
  return { requests: req.size, firstInput: tot(us[0]), totalInput: us.reduce((a, x) => a + tot(x), 0), uncached: sum("input_tokens"), cacheRead: sum("cache_read_input_tokens"), cacheWrite: sum("cache_creation_input_tokens"), output: sum("output_tokens"), cost: res?.total_cost_usd ?? null, outcome: res?.subtype || "no result" };
}

export async function benchCli(_root: string, args: string[], opt: (n: string, d?: string) => string | undefined, _flag: (n: string) => boolean) {
  const suite: Task[] = JSON.parse(fs.readFileSync(opt("--suite", path.join(HERE, "bench/suite.json"))!, "utf8"));
  const variants = (opt("--variants", "nexus,claude-code") || "").split(",");
  const model = opt("--model", "claude-cli")!;
  const ccModel = opt("--cc-model", "")!;
  const ids = args.filter((a) => !a.startsWith("--") && suite.some((t) => t.id === a));
  const tasks = ids.length ? suite.filter((t) => ids.includes(t.id)) : suite;
  const work = path.join(os.tmpdir(), "nexus-bench");
  const results: Result[] = [];
  for (const t of tasks) for (const v of variants) {
    const dir = path.join(work, `${t.id}-${v}`);
    prepare(t, dir);
    const t0 = Date.now();
    let part: Partial<Result>;
    try { part = v === "nexus" ? runNexus(t, dir, model) : runClaudeCode(t, dir, ccModel); } catch (e: any) { part = { outcome: `error: ${e.message.slice(0, 200)}`, requests: 0, totalInput: 0, output: 0 }; }
    const ms = Date.now() - t0;
    const changed = changedFiles(dir);
    for (const [dest, src] of Object.entries(t.hidden || {})) { fs.mkdirSync(path.dirname(path.join(dir, dest)), { recursive: true }); fs.copyFileSync(path.join(HERE, "bench/hidden", src), path.join(dir, dest)); }
    const acc = sh(t.accept, dir);
    const r: Result = { task: t.id, variant: v, lang: t.lang, level: t.level, requests: 0, firstInput: 0, totalInput: 0, uncached: 0, cacheRead: 0, cacheWrite: 0, output: 0, cost: null, outcome: "", ...part, ms, changed, goldEdited: t.gold.filter((g) => changed.includes(g)).length / t.gold.length, accept: acc.status === 0 ? "pass" : "fail", acceptOut: acc.status === 0 ? undefined : ((acc.stdout || "") + (acc.stderr || "")).split("\n").filter((l) => /error|fail|assert|panic/i.test(l)).slice(0, 3).join(" | ") };
    results.push(r);
    console.error(`${t.id} ${v}: ${r.accept} | ${r.requests} req | in ${r.totalInput} | out ${r.output} | $${r.cost?.toFixed(3) ?? "?"} | ${(ms / 1000).toFixed(0)}s | ${r.outcome.slice(0, 60)}`);
  }
  const outDir = path.join(HERE, "bench/results"); fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  fs.writeFileSync(path.join(outDir, `${stamp}.json`), JSON.stringify({ model, ccModel: ccModel || "default", results }, null, 1));
  console.log(table(results));
}

export function table(results: Result[]): string {
  const k = (n: number) => (n >= 10000 ? `${(n / 1000).toFixed(0)}K` : n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n));
  const rows = results.map((r) => `| ${r.task} | ${r.lang} | L${r.level} | ${r.variant} | **${r.accept}** | ${r.requests} | ${k(r.firstInput)} | ${k(r.totalInput)} | ${k(r.cacheRead)} | ${k(r.output)} | ${r.cost === null ? "?" : "$" + r.cost.toFixed(3)} | ${(r.ms / 1000).toFixed(0)}s | ${Math.round(r.goldEdited * 100)}% |`);
  const agg = (v: string) => { const xs = results.filter((r) => r.variant === v); const s = (f: (r: Result) => number) => xs.reduce((a, r) => a + f(r), 0); return `| **all** | | | ${v} | **${xs.filter((r) => r.accept === "pass").length}/${xs.length}** | ${s((r) => r.requests)} | | ${k(s((r) => r.totalInput))} | ${k(s((r) => r.cacheRead))} | ${k(s((r) => r.output))} | $${s((r) => r.cost || 0).toFixed(2)} | ${(s((r) => r.ms) / 1000).toFixed(0)}s | |`; };
  return ["| task | lang | level | variant | accept | requests | 1st input | total input | cache read | output | cost | time | gold edited |", "|---|---|---|---|---|---|---|---|---|---|---|---|---|", ...rows, ...[...new Set(results.map((r) => r.variant))].map(agg)].join("\n");
}
