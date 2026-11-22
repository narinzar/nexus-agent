// CLI for the factory: init, validate, env, profile, factory run|backlog|status|merge|clean.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { init, validate, readConfig } from "./init.ts";
import { preflight, ENVIRONMENTS } from "./environments.ts";
import { loadProfile, saveProfile, setKey, applyProfile, profilePath, userInstructionFiles } from "./profile.ts";
import { runJobs, listJobs, mergeJob, takeBacklog } from "./jobs.ts";

type Opt = (n: string, d?: string) => string | undefined;

export async function initCli(root: string, opt: Opt, flag: (n: string) => boolean) {
  const dry = flag("--dry");
  const agents = opt("--agents")?.split(","), env = opt("--env")?.split(",");
  const r = await init(root, { dry, agents, env });
  const c = r.config;
  console.log(`${dry ? "Would set up" : "Set up"} ${path.basename(root)}:
  stack:        ${c.project.languages.join(", ") || "-"}${c.project.frameworks.length ? ` (${c.project.frameworks.join(", ")})` : ""}
  commands:     ${[c.setup && `setup: ${c.setup}`, ...c.commands.map((x) => `${x.kind}: ${x.cmd}`)].filter(Boolean).join(" | ") || "none detected"}
  environments: ${c.environments.map((e) => `${e.id} (${e.evidence[0]})`).join(", ")}
  agents:       ${c.agents.join(", ")}
  skills:       ${c.skills.map((s) => s.name).join(", ")}
files:
${r.written.map((w) => `  ${w.action.padEnd(17)} ${w.file}`).join("\n") || "  (nothing changed)"}${r.notes.length ? `\nnotes:\n${r.notes.map((n) => `  - ${n}`).join("\n")}` : ""}
next: nexus env check   |   nexus validate   |   nexus factory run "<task>" "<task>" --parallel 3`);
}

export function validateCli(root: string) {
  const out = validate(root);
  for (const o of out) console.log(`${o.level === "ok" ? "ok   " : o.level === "warn" ? "warn " : "ERROR"} ${o.msg}`);
  if (out.some((o) => o.level === "error")) process.exitCode = 1;
}

export function envCli(root: string, a: string[]) {
  if (a[0] === "list") { for (const e of ENVIRONMENTS) console.log(`${e.id.padEnd(11)} ${e.title} (skill: ${e.skill})`); return; }
  const args = a[0] === "check" ? a.slice(1) : a;
  const ids = args.length ? args : (readConfig(root)?.environments.map((e) => e.id) || ["local"]);
  const res = preflight(ids, root);
  for (const r of res) console.log(`${r.ok ? "ok  " : "FIX "} ${r.env.padEnd(11)} ${r.what}${r.ok ? "" : `\n       -> ${r.fix}`}`);
  if (res.some((r) => !r.ok)) process.exitCode = 1;
}

export function profileCli(rest: () => string[], flag: (n: string) => boolean) {
  const p: any = loadProfile(); const dryFlag = flag("--dry"); const a = rest();
  if (a[0] === "set" || a[0] === "add") { setKey(p, a[1], a.slice(2).join(" "), a[0] === "add"); saveProfile(p); console.log(`saved ${profilePath()}`); return; }
  if (a[0] === "apply") { const dry = dryFlag; const ch = applyProfile(p, dry); console.log(ch.length ? `${dry ? "would update" : "updated"}: ${ch.join(", ")}` : `up to date: ${userInstructionFiles(p).join(", ")}`); return; }
  console.log(`${profilePath()}\n${JSON.stringify(p, null, 2)}\n\nnexus profile set git.name <name> | set git.email <email> | set agents agents,claude,cursor | add rules "<rule>" | apply`);
}

export async function factoryCli(root: string, rest: () => string[], opt: Opt, flag: (n: string) => boolean) {
  const o = { parallel: +(opt("--parallel", "3")!), model: opt("--model"), maxCost: opt("--max-cost", "1"), merge: flag("--merge"), log: (s: string) => console.error(`[factory] ${s}`) };
  const file = path.resolve(root, opt("--file", "BACKLOG.md")!), take = +(opt("--take", "5")!);
  const a = rest(), sub = a[0];
  const show = (jobs = listJobs(root)) => {
    if (!jobs.length) return console.log("no jobs yet");
    for (const j of jobs) console.log(`${j.id.padEnd(46)} ${j.stage.padEnd(12)} ${j.build?.cost != null ? `$${j.build.cost.toFixed(3)}` : "      "}  ${j.reasons[0] || j.build?.summary || ""}`.slice(0, 160));
    console.log("details: .nexus/jobs/<id>/decision.md");
  };
  if (sub === "run") {
    const tasks = a.slice(1).filter(Boolean);
    if (!tasks.length) return console.log('usage: nexus factory run "<task>" ["<task>" ...] [--parallel 3] [--model m] [--max-cost 1] [--merge]');
    show(await runJobs(root, tasks, o)); return;
  }
  if (sub === "backlog") {
    if (!fs.existsSync(file)) return console.log(`no ${path.relative(root, file)}: write tasks as "- [ ] task" lines`);
    const tasks = takeBacklog(file, take);
    if (!tasks.length) return console.log("backlog has no unchecked items");
    show(await runJobs(root, tasks, o)); return;
  }
  if (sub === "merge") {
    const j = listJobs(root).find((x) => x.id === a[1] || x.id.startsWith(`${a[1]}-`));
    if (!j) return console.log("no such job");
    mergeJob(root, j, o.log); show([j]); return;
  }
  if (sub === "clean") {
    for (const j of listJobs(root).filter((x) => x.stage === "merged" || x.stage === "failed")) {
      if (fs.existsSync(j.worktree)) spawnSync("git", ["worktree", "remove", "--force", j.worktree], { cwd: root });
      spawnSync("git", ["branch", "-q", "-D", j.branch], { cwd: root });
    }
    spawnSync("git", ["worktree", "prune"], { cwd: root });
    console.log("removed the worktrees and branches of merged and failed jobs (approved and needs-human jobs are kept)"); return;
  }
  show();
}
