// `nexus bench new`: how well does `nexus new --build --until-done` turn one sentence into a finished project?
// Each idea is built from scratch, then checked independently on a fresh clone: setup from nothing, every check,
// and the handover check. Commits use a neutral benchmark identity, never the owner's.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export interface Idea { id: string; lang: string; prompt: string }
export interface NewResult {
  idea: string; lang: string; run: number; model: string;
  ready: boolean; failed: string[]; items: number; merged: number; held: number; open: number;
  jobs: number; jobsMerged: number; testFiles: number; commits: number; cost: number; ms: number; stop: string;
}

const git = (dir: string, ...a: string[]) => spawnSync("git", a, { cwd: dir, encoding: "utf8" });

/** Count backlog items by state from BACKLOG.md. */
function backlogState(dir: string) {
  const f = path.join(dir, "BACKLOG.md"); const t = fs.existsSync(f) ? fs.readFileSync(f, "utf8") : "";
  const done = (t.match(/^\s*[-*] \[x\] /gm) || []).length, open = (t.match(/^\s*[-*] \[ \] /gm) || []).length;
  return { items: done + open, merged: done, open };
}

async function one(idea: Idea, run: number, o: { model: string; budget: number; work: string; log: (s: string) => void }): Promise<NewResult> {
  const { createProject } = await import("../lanes/new.ts");
  const { handoverCheck } = await import("../lanes/handover.ts");
  const dir = path.join(o.work, `${idea.id}-${run}`);
  fs.rmSync(dir, { recursive: true, force: true });
  const t0 = Date.now();
  const r = await createProject(dir, idea.prompt, { model: o.model, build: true, untilDone: true, budget: o.budget, take: 5, parallel: 3, log: (s) => o.log(`[${idea.id}] ${s.split("\n")[0]}`) });
  const ms = Date.now() - t0;
  // independent check: a fresh clone, set up from nothing, every check and the handover check
  const clone = `${dir}-clone`; fs.rmSync(clone, { recursive: true, force: true });
  git(o.work, "clone", "-q", dir, clone);
  const checks = await handoverCheck(clone, { requireSpec: true });
  const b = backlogState(dir), files = git(dir, "ls-files").stdout.split("\n");
  const until = r.notes.find((n) => n.startsWith("until-done:")) || (r.ready ? "" : "skeleton not ready");
  return {
    idea: idea.id, lang: idea.lang, run, model: o.model,
    ready: checks.every((c) => c.ok), failed: checks.filter((c) => !c.ok).map((c) => `${c.name}: ${c.detail}`.slice(0, 200)),
    items: b.items, merged: b.merged, open: b.open, held: r.notes.filter((n) => n.startsWith("held for you")).length,
    jobs: r.jobs.length, jobsMerged: r.jobs.filter((j) => j.stage === "merged").length,
    testFiles: files.filter((f) => /(^|\/)(tests?|__tests__|spec)\/|[._-](test|spec)\.[a-z0-9]+$|_test\.go$|(^|\/)test_[^/]*\.py$/i.test(f)).length,
    commits: +git(dir, "rev-list", "--count", "HEAD").stdout.trim() || 0, cost: r.cost, ms, stop: until.replace(/^until-done: /, ""),
  };
}

export async function benchNew(o: { ideas: Idea[]; model: string; repeat: number; budget: number; parallel: number; resume?: string }) {
  const work = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), "nexus-bench-new-"));
  // a neutral identity for the generated commits; the owner's profile is never used here
  const prof = path.join(work, "profile.json");
  fs.writeFileSync(prof, JSON.stringify({ git: { name: "nexus-bench", email: "bench@example.com" } }));
  process.env.NEXUS_PROFILE = prof;
  const out = o.resume || path.join(HERE, "benchmarks/results", `${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}-new.json`);
  const results: NewResult[] = o.resume && fs.existsSync(o.resume) ? JSON.parse(fs.readFileSync(o.resume, "utf8")).results : [];
  const save = (complete: boolean) => fs.writeFileSync(out, JSON.stringify({ suite: "new", date: new Date().toISOString(), model: o.model, repeat: o.repeat, budget: o.budget, complete, results }, null, 2));
  const queue = o.ideas.flatMap((idea) => Array.from({ length: o.repeat }, (_, i) => ({ idea, run: i + 1 }))).filter((q) => !results.some((r) => r.idea === q.idea.id && r.run === q.run));
  const log = (s: string) => console.error(s);
  await Promise.all(Array.from({ length: Math.max(1, o.parallel) }, async () => {
    for (let q = queue.shift(); q; q = queue.shift()) {
      const r = await one(q.idea, q.run, { model: o.model, budget: o.budget, work, log });
      results.push(r); save(false);
      console.log(`${r.idea} ${r.lang.padEnd(10)} ready=${r.ready} items ${r.merged}/${r.items} held ${r.held} tests ${r.testFiles} $${r.cost.toFixed(3)} ${(r.ms / 60000).toFixed(1)} min  ${r.stop}${r.failed.length ? `  FAILED: ${r.failed.join(" | ")}` : ""}`);
    }
  }));
  save(true);
  console.log(`\nresults: ${path.relative(HERE, out)}  (projects kept in ${work})`);
}
