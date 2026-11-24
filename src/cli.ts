// nexus CLI. Every command works on the current directory's repository (or --repo <path>).
import path from "node:path";
import { Repo } from "./repo-intel/repo.ts";
import * as Q from "./repo-intel/query.ts";
import { locate } from "./repo-intel/locate.ts";

const HELP = `nexus <command> [args] [--repo <path>]

Repository intelligence (incremental index in .nexus/index.db)
  index [--force]           build/refresh the index
  status                    index statistics and detected project profile
  doctor                    what is available (parsers, toolchains) and what can be upgraded
  map [--budget N] [focus]  ranked repository map within a token budget
  locate "<task text>"      symbols a task most likely touches
  find <term>               symbols and files by name
  ctx <symbol|file> [--depth 2]   definition, users, uses, members, styles, tests
  refs <symbol|file>        who uses it
  show <symbol|file:a-b|.class>   only the relevant source
  impact [files...]         dependents, tests and verify commands for changed files (default: git changes)
  check [files...]          syntax + unresolved imports on changed files
  grep <pattern>            ripgrep with capped output

Prepare a repository, then run many tasks in parallel lanes
  init [--agents agents,claude,cursor,copilot,gemini] [--env wsl,powershell,gcp,aws-lambda,modal] [--dry]
                            detect stack, commands, environments; write AGENTS.md (+ thin per-agent files), skills, .nexus/config.json
  validate                  check the instruction files still match the repository
  env [check [ids] | list]  environment preflight: tools and sign-in, with the fix command for each failure
  profile [set|add|apply]   personal rules (~/.nexus/profile.json), written to user-level agent files, never to repositories
  lanes run "<task>" ... [--parallel 3] [--merge]     one worktree + branch per task; review; deterministic gates
  lanes backlog [--file BACKLOG.md] [--take 5]        run the unchecked "- [ ]" items
  lanes [status] | merge <id> | clean                 ("factory" still works as an alias)

Agent
  run "<task>" [--mode auto|plan] [--model provider:model] [--approve risky|always|never] [--review auto|off|always] [--dry]
  skills [list|show <name>|new <name>|install <path|git-url>]

Evaluation
  bench [task ids] [--variant nexus|baseline] [--suite file]`;

const argv = process.argv.slice(2);
const opt = (n: string, d?: string) => { const i = argv.indexOf(n); if (i < 0) return d; const v = argv[i + 1]; argv.splice(i, 2); return v; };
const flag = (n: string) => { const i = argv.indexOf(n); if (i < 0) return false; argv.splice(i, 1); return true; };
const root = path.resolve(opt("--repo", process.cwd())!);

async function main() {
  const [cmd, ...a] = argv;
  if (!cmd || cmd === "help" || cmd === "--help") return console.log(HELP);
  if (cmd === "run") { const { runCli } = await import("./agent/cli-run.ts"); return runCli(root, () => argv.slice(1), opt, flag); }
  if (["init", "validate", "env", "profile", "lanes", "factory"].includes(cmd)) {
    const F = await import("./lanes/cli.ts");
    if (cmd === "init") return F.initCli(root, opt, flag);
    if (cmd === "validate") return F.validateCli(root);
    if (cmd === "env") return F.envCli(root, argv.slice(1));
    if (cmd === "profile") return F.profileCli(() => argv.slice(1), flag);
    return F.lanesCli(root, () => argv.slice(1), opt, flag);
  }
  if (cmd === "skills") { const { skillsCli } = await import("./skills/cli.ts"); return skillsCli(root, a); }
  if (cmd === "bench") { const { benchCli } = await import("./benchmark/run.ts"); return benchCli(root, a, opt, flag); }
  const repo = await new Repo(root).init();
  const force = flag("--force");
  const st = await repo.index({ force });
  switch (cmd) {
    case "index": { const s = repo.stats(); console.log(`indexed ${s.files} files in ${st.ms} ms (re-parsed ${st.parsed}, removed ${st.removed}, skipped ${st.skipped}); providers: ${Object.entries(st.providers).map(([k, v]) => `${k}:${v}`).join(" ") || "-"}; ${s.symbols} symbols, ${s.imports} imports (${s.resolved} resolved), ${s.refs} refs${st.errors.length ? `\nerrors:\n  ${st.errors.slice(0, 10).join("\n  ")}` : ""}`); break; }
    case "status": { const s = repo.stats(); const p = repo.profile(); console.log(JSON.stringify({ index: { files: s.files, symbols: s.symbols, imports: `${s.resolved}/${s.imports} resolved`, refs: s.refs, precision: Object.fromEntries(s.byPrecision.map((r: any) => [r.precision, r.n])), languages: Object.fromEntries(s.byLang.slice(0, 15).map((r: any) => [r.lang, r.n])) }, profile: { ...p, root: undefined } }, null, 1)); break; }
    case "doctor": { const { doctor } = await import("./repo-intel/doctor.ts"); console.log(await doctor(repo)); break; }
    case "map": { const b = +(opt("--budget", "1500")!); console.log(Q.map(repo, b, argv.slice(1))); break; }
    case "locate": { const r = locate(repo, a.join(" ")); console.log(r.map((x) => `${String(x.score).padStart(6)}  ${x.sym.name}  ${x.sym.kind}  ${x.sym.file}:${x.sym.line}-${x.sym.end}  <- ${x.why.join("; ")}`).join("\n") || "no candidates; try: nexus find / nexus grep"); break; }
    case "find": console.log(Q.find(repo, a.join(" "))); break;
    case "ctx": { const d = +(opt("--depth", "1")!); console.log(Q.ctx(repo, argv.slice(1).join(" "), d)); break; }
    case "refs": console.log(Q.refs(repo, a.join(" "))); break;
    case "show": console.log(a.map((t) => Q.show(repo, t)).join("\n\n")); break;
    case "impact": console.log(Q.impact(repo, a.length ? a : Q.changedFiles(repo))); break;
    case "check": console.log(await Q.check(repo, a.length ? a : Q.changedFiles(repo))); break;
    case "grep": console.log(Q.grep(repo, a.join(" "))); break;
    default: console.log(`unknown command "${cmd}"\n\n${HELP}`); process.exitCode = 1;
  }
  repo.close();
}
main().catch((e) => { console.error(`nexus: ${e.stack || e.message}`); process.exit(1); });
