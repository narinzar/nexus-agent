// `nexus new`: start a project from a description, built from the first commit to be handed over.
//   1. the agent writes SPEC.md and BACKLOG.md, then a runnable skeleton with scripts for every check;
//   2. `init` prepares it for agents (AGENTS.md, skills, config, identity, attribution guard);
//   3. the handover check decides, mechanically, whether it is ready; one repair round if not;
//   4. optionally, the backlog is built in lanes, each item gated and merged.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { init } from "./init.ts";
import { loadProfile } from "./profile.ts";
import { runNexus, runBacklog, type Job, type LanesOptions } from "./jobs.ts";
import { handoverCheck, ready, failures, type Check } from "./handover.ts";

export interface NewOptions extends LanesOptions { build?: boolean; take?: number }
export interface NewResult { dir: string; checks: Check[]; ready: boolean; cost: number; jobs: Job[]; notes: string[] }

export const SCAFFOLD = (description: string) => `Start a new project in this empty repository.

Project: ${description}

Build the first version as a small, runnable skeleton that other agents will extend one backlog item at a time:
1. SPEC.md: the goal in one paragraph; who uses it; in scope and out of scope; the main features, each with acceptance
   criteria someone could test; the stack, with a one-line reason per choice (prefer common, well-supported tools);
   open questions.
2. BACKLOG.md: the features from SPEC.md as "- [ ] " lines in build order. Each item is one small change that a
   separate agent can build and test on its own, and says which behaviour its test checks. Do not build them now.
3. The skeleton, in the standard layout for the stack:
   - a manifest with scripts for setup, test and lint (and typecheck and build where the stack has them);
   - one smoke test that passes;
   - README.md: what it is, and the exact commands to set up, run and test it;
   - .gitignore, and .env.example listing any settings, with no real values.
4. Install the dependencies and run every script until they all pass.
Follow the build-for-handover skill (@skill build-for-handover).`;

export const REPAIR = (cs: Check[]) => `This repository must be ready to hand over to another agent, and these checks fail:
${failures(cs)}

Fix each one in the repository (scripts, tests, README, SPEC.md or BACKLOG.md as needed), then run the checks again.
Do not build backlog features. Follow the build-for-handover skill (@skill build-for-handover).`;

const git = (dir: string, ...a: string[]) => spawnSync("git", a, { cwd: dir, encoding: "utf8" });

function commitAll(dir: string, msg: string): boolean {
  const me = loadProfile(), id = me.git.name && me.git.email ? ["-c", `user.name=${me.git.name}`, "-c", `user.email=${me.git.email}`] : [];
  git(dir, "add", "-A", "--", ".", ":(glob,exclude)**/node_modules"); // .gitignore keeps .nexus state out, config.json in
  if (git(dir, "diff", "--cached", "--quiet").status === 0) return false;
  return git(dir, ...id, "commit", "-q", "-m", msg).status === 0;
}

export async function createProject(dir: string, description: string, o: NewOptions = {}): Promise<NewResult> {
  const log = o.log || (() => {}), notes: string[] = [];
  if (fs.existsSync(dir) && fs.readdirSync(dir).some((f) => f !== ".git")) throw new Error(`${dir} is not empty: use \`nexus init\` to prepare an existing project`);
  fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(path.join(dir, ".git")) && git(dir, "init", "-q", "-b", "main").status !== 0) git(dir, "init", "-q");
  let cost = 0; const add = (r: any) => { cost += r?.usage?.cost?.total || 0; };

  log("writing SPEC.md, BACKLOG.md and the skeleton");
  const r = await runNexus(dir, SCAFFOLD(description), o.model, o.maxCost || "3", ["--turns", "40"]); add(r);
  log(`skeleton: ${r.outcome}${r.summary ? ` (${String(r.summary).slice(0, 120)})` : ""}`);
  await init(dir);
  commitAll(dir, `Start ${path.basename(path.resolve(dir))}: spec, backlog and skeleton`);

  let checks = await handoverCheck(dir, { requireSpec: true });
  if (!ready(checks)) {
    log(`not ready for handover yet:\n${failures(checks)}\nrepairing`);
    const f = await runNexus(dir, REPAIR(checks), o.model, o.maxCost || "3", ["--turns", "30"]); add(f);
    await init(dir);
    commitAll(dir, "Make the project ready for handover");
    checks = await handoverCheck(dir, { requireSpec: true });
  }
  const ok = ready(checks);
  log(ok ? "ready for handover" : `still not ready:\n${failures(checks)}`);

  let jobs: Job[] = [];
  if (o.build) {
    if (!ok) notes.push("backlog not built: the skeleton is not ready for handover");
    else {
      log("building the backlog in lanes");
      jobs = await runBacklog(dir, path.join(dir, "BACKLOG.md"), o.take || 5, { ...o, merge: true });
      for (const j of jobs) add({ usage: { cost: { total: j.build?.cost || 0 } } });
    }
  }
  return { dir, checks, ready: ok, cost, jobs, notes };
}
