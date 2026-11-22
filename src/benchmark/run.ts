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
interface Task { id: string; fixture?: string; git?: string; repo?: string; commit?: string; fix?: string; hiddenFromFix?: string[]; link?: string[]; lang: string; level: number; prompt: string; gold: string[]; hidden?: Record<string, string>; accept: string }
export interface Result { run?: number; task: string; variant: string; lang: string; level: number; requests: number; firstInput: number; totalInput: number; uncached: number; cacheRead: number; cacheWrite: number; output: number; cost: number | null; ms: number; changed: string[]; goldEdited: number; accept: "pass" | "fail"; acceptOut?: string; outcome: string }

const sh = (cmd: string, cwd: string, timeout = 900_000) => spawnSync("bash", ["-lc", cmd], { cwd, encoding: "utf8", timeout, maxBuffer: 1 << 27 });

function prepare(t: Task, dir: string) {
  fs.rmSync(dir, { recursive: true, force: true });
  if (t.fixture) { fs.cpSync(path.join(HERE, "benchmarks/fixtures", t.fixture), dir, { recursive: true }); execFileSync("git", ["init", "-q"], { cwd: dir }); }
  else {
    const src = t.repo ? repoCache(t.repo) : t.git!;
    execFileSync("git", ["clone", "-q", "--no-checkout", src, dir]); execFileSync("git", ["checkout", "-q", "--detach", t.commit!], { cwd: dir });
    execFileSync("git", ["remote", "remove", "origin"], { cwd: dir }); // the agent must not be able to fetch the fix
  }
  for (const l of t.link || []) fs.symlinkSync(path.join(t.git!, l), path.join(dir, l));
  execFileSync("git", ["add", "-A"], { cwd: dir });
  execFileSync("git", ["-c", "user.name=bench", "-c", "user.email=bench@localhost", "commit", "-qm", "bench start", "--allow-empty"], { cwd: dir });
}

/** Real upstream repositories are cloned once per machine (blob-less) and reused. */
function repoCache(url: string): string {
  // full clone: local clones made from a blob-less (partial) clone cannot read file contents
  const p = path.join(os.tmpdir(), "nexus-bench-repos", url.split("/").slice(-2).join("__") + "__full");
  if (!fs.existsSync(p)) execFileSync("git", ["clone", "-q", url, p], { stdio: "inherit" });
  return p;
}

function changedFiles(dir: string): string[] {
  const r = sh("git add -A -- . ':!.nexus' && git diff --cached --name-only HEAD", dir);
  return (r.stdout || "").split("\n").filter((f) => f && !f.startsWith(".nexus/"));
}

function runNexus(t: Task, dir: string, model: string, maxCost: string, review: string): Partial<Result> {
  // NODE_USE_ENV_PROXY: Node's fetch honours HTTPS_PROXY only with it (needed behind egress proxies such as cloud sandboxes)
  const env = { ...process.env, ...(process.env.HTTPS_PROXY ? { NODE_USE_ENV_PROXY: "1" } : {}), OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY || "proxy-injected" };
  const r = spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", path.join(HERE, "src/cli.ts"), "run", "--repo", dir, "--json", "--quiet", "--approve", "never", "--max-cost", maxCost, "--review", review, "--model", model, t.prompt], { cwd: dir, env, encoding: "utf8", timeout: 1_800_000, maxBuffer: 1 << 27 });
  if (!r.stdout.includes("{")) throw new Error((r.stderr || "no output").slice(-400));
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

/** Deterministic retrieval benchmark (no model): does the first request's packed context contain the gold files? */
async function retrieval(tasks: Task[]) {
  const { Repo } = await import("../repo-intel/repo.ts");
  const { seedContext } = await import("../repo-intel/locate.ts");
  const { classify } = await import("../agent/runtime.ts");
  const rows: string[] = ["| task | lang | level (rule) | top candidate | gold files in first-request context | context tokens (est.) | index ms |", "|---|---|---|---|---|---|---|"];
  let hit = 0, total = 0;
  for (const t of tasks) {
    const dir = path.join(os.tmpdir(), "nexus-bench-retrieval", t.id); prepare(t, dir);
    const repo = await new Repo(dir).init(); const st = await repo.index();
    const level = classify(t.prompt);
    const seed = seedContext(repo, t.prompt, level);
    const loc = seed.blocks.length ? [] : seed.candidates;
    let files: string[] = [], tokens = 0;
    if (seed.blocks.length) { files = [...new Set(seed.blocks.map((b) => b.file))]; tokens = Math.ceil(seed.blocks.reduce((a, b) => a + b.text.length, 0) / 4); }
    else { files = [...new Set(seed.candidates.map((x) => x.sym.file))]; }
    const top = seed.blocks[0] ? seed.blocks[0].reason : loc[0] ? `${loc[0].sym.name} (${loc[0].sym.file})` : "-";
    const g = t.gold.filter((x) => files.includes(x)).length; hit += g; total += t.gold.length;
    rows.push(`| ${t.id} | ${t.lang} | ${t.level} (${level}) | ${top} | ${g}/${t.gold.length}${level >= 3 ? " (candidate list)" : ""} | ${tokens || "map"} | ${st.ms} |`);
    repo.close();
  }
  rows.push(`| **total** | | | | **${hit}/${total}** | | |`);
  console.log(rows.join("\n"));
}

/** "${ENV}" in a suite path is expanded; tasks whose repository is not available locally are skipped (e.g. private repos). */
const expand = (s?: string) => s?.replace(/\$\{(\w+)\}/g, (_, k) => process.env[k] || "");
function available(t: Task): boolean { if (t.git) { t.git = expand(t.git); return !!t.git && fs.existsSync(t.git); } return true; }

export async function benchCli(_root: string, args: string[], opt: (n: string, d?: string) => string | undefined, flag: (n: string) => boolean) {
  const suiteArg = opt("--suite", "small")!;
  const suiteFile = fs.existsSync(suiteArg) ? suiteArg : path.join(HERE, "benchmarks/suites", `${suiteArg}.json`);
  if (args[0] === "report") { const { report } = await import("./report.ts"); return report(HERE); }
  const all: Task[] = JSON.parse(fs.readFileSync(suiteFile, "utf8"));
  const suite = all.filter((t) => { const ok = available(t); if (!ok) console.error(`skip ${t.id}: repository not available (${t.git ? "set the environment variable in its path" : ""})`); return ok; });
  const repeat = +(opt("--repeat", "1")!);
  if (flag("--retrieval")) { const ids = args.filter((a) => suite.some((t) => t.id === a)); return retrieval(ids.length ? suite.filter((t) => ids.includes(t.id)) : suite); }
  const variants = (opt("--variants", "nexus,claude-code") || "").split(",");
  const model = opt("--model", "claude-cli")!;
  const maxCost = opt("--max-cost", "1.0")!;
  const ccModel = opt("--cc-model", "")!;
  const ids = args.filter((a) => !a.startsWith("--") && suite.some((t) => t.id === a));
  const tasks = ids.length ? suite.filter((t) => ids.includes(t.id)) : suite;
  const work = path.join(os.tmpdir(), "nexus-bench");
  // results are saved after every run, so a stopped benchmark keeps its work; --resume <file> skips runs already in it
  const outDir = path.join(HERE, "benchmarks/results"); fs.mkdirSync(outDir, { recursive: true });
  const resume = opt("--resume");
  const outFile = resume ? path.resolve(resume) : path.join(outDir, `${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}-${path.basename(suiteFile, ".json")}.json`);
  const results: Result[] = resume ? JSON.parse(fs.readFileSync(outFile, "utf8")).results : [];
  const save = (complete: boolean) => fs.writeFileSync(outFile, JSON.stringify({ suite: path.basename(suiteFile, ".json"), date: new Date().toISOString(), repeat, model, ccModel: ccModel || "default", complete, results }, null, 1));
  for (let rep = 1; rep <= repeat; rep++) for (const t of tasks) for (const v of variants) {
    if (results.some((r) => r.run === rep && r.task === t.id && r.variant === v)) continue;
    const dir = path.join(work, `${t.id}-${v.replace(/[^\w.@-]/g, "_")}-${rep}`);
    prepare(t, dir);
    const t0 = Date.now();
    let part: Partial<Result>;
    if (v === "oracle" && t.fix) execFileSync("git", ["checkout", "-q", t.fix, "--", ...t.gold], { cwd: dir }); // apply the real upstream fix
    try { part = v === "none" ? { outcome: "no agent (suite validation: acceptance must fail)" } : v === "oracle" ? { outcome: "upstream fix applied (suite validation: acceptance must pass)" } : v.startsWith("nexus") ? runNexus(t, dir, v.includes("@") ? v.slice(v.indexOf("@") + 1) : model, maxCost, v.startsWith("nexus+review") ? "auto" : "off") : runClaudeCode(t, dir, ccModel); } catch (e: any) { part = { outcome: `error: ${e.message.slice(0, 200)}`, requests: 0, totalInput: 0, output: 0 }; }
    const ms = Date.now() - t0;
    const changed = changedFiles(dir);
    for (const [dest, src] of Object.entries(t.hidden || {})) { fs.mkdirSync(path.dirname(path.join(dir, dest)), { recursive: true }); fs.copyFileSync(path.join(HERE, "benchmarks/hidden-tests", src), path.join(dir, dest)); }
    if (t.fix && t.hiddenFromFix) { // upstream tests from the real fix commit, copied in only after the agent finished
      const src = t.repo ? repoCache(t.repo) : t.git!;
      for (const f of t.hiddenFromFix) { const body = execFileSync("git", ["show", `${t.fix}:${f}`], { cwd: src, maxBuffer: 1 << 26 }); fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), body); }
    }
    const acc = sh(t.accept, dir);
    const r: Result = { run: rep, task: t.id, variant: v, lang: t.lang, level: t.level, requests: 0, firstInput: 0, totalInput: 0, uncached: 0, cacheRead: 0, cacheWrite: 0, output: 0, cost: null, outcome: "", ...part, ms, changed, goldEdited: t.gold.filter((g) => changed.includes(g)).length / t.gold.length, accept: acc.status === 0 ? "pass" : "fail", acceptOut: acc.status === 0 ? undefined : ((acc.stdout || "") + (acc.stderr || "")).split("\n").filter((l) => /error|fail|assert|panic/i.test(l)).slice(0, 3).join(" | ") };
    results.push(r); save(false);
    console.error(`${t.id} ${v}: ${r.accept} | ${r.requests} req | in ${r.totalInput} | out ${r.output} | $${r.cost?.toFixed(3) ?? "?"} | ${(ms / 1000).toFixed(0)}s | ${r.outcome.slice(0, 60)}`);
  }
  save(true);
  console.log(table(results));
}

export function table(results: Result[]): string {
  const k = (n: number) => (n >= 10000 ? `${(n / 1000).toFixed(0)}K` : n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n));
  const rows = results.map((r) => `| ${r.task} | ${r.lang} | L${r.level} | ${r.variant} | **${r.accept}** | ${r.requests} | ${k(r.firstInput)} | ${k(r.totalInput)} | ${k(r.cacheRead)} | ${k(r.output)} | ${r.cost === null ? "?" : "$" + r.cost.toFixed(3)} | ${(r.ms / 1000).toFixed(0)}s | ${Math.round(r.goldEdited * 100)}% |`);
  const agg = (v: string) => { const xs = results.filter((r) => r.variant === v); const s = (f: (r: Result) => number) => xs.reduce((a, r) => a + f(r), 0); return `| **all** | | | ${v} | **${xs.filter((r) => r.accept === "pass").length}/${xs.length}** | ${s((r) => r.requests)} | | ${k(s((r) => r.totalInput))} | ${k(s((r) => r.cacheRead))} | ${k(s((r) => r.output))} | $${s((r) => r.cost || 0).toFixed(2)} | ${(s((r) => r.ms) / 1000).toFixed(0)}s | |`; };
  return ["| task | lang | level | variant | accept | requests | 1st input | total input | cache read | output | cost | time | gold edited |", "|---|---|---|---|---|---|---|---|---|---|---|---|---|", ...rows, ...[...new Set(results.map((r) => r.variant))].map(agg)].join("\n");
}
