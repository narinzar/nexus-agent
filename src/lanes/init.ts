// `nexus init`: set a repository up for agent work in one command.
// Who decides what:
//   - facts (stack, commands, environments) come from deterministic detection with evidence: no model involved;
//   - personal policy (git identity, attribution, push and merge rules) comes from the owner's profile and is applied
//     outside the repository (user-level agent files, local git config, a local commit-msg hook), never committed;
//   - project rules are the owner's to add in .nexus/config.json ("rules");
//   - the owner's own text is never rewritten: Nexus only manages the block between its markers.
// Everything decided is recorded in .nexus/config.json, which the owner may edit; re-running init re-renders from it.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { Repo } from "../repo-intel/repo.ts";
import { commandsFor, type Profile } from "../repo-intel/detect.ts";
import { detectEnvironments } from "./environments.ts";
import { loadProfile, type PersonalProfile } from "./profile.ts";

export const BEGIN = "<!-- nexus:begin (managed by `nexus init`; edit outside this block or in .nexus/config.json) -->";
export const END = "<!-- nexus:end -->";
const BUILTIN_SKILLS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../skills");
const BASE_SKILLS = ["build-for-handover", "code-review", "git-workflow", "testing", "debugging"];

export interface Command { kind: string; cmd: string; evidence: string }
export interface NexusConfig {
  version: 1;
  project: { languages: string[]; frameworks: string[]; entryPoints: string[]; docs: string[]; ci: string[] };
  setup?: string;
  commands: Command[];
  environments: { id: string; title: string; skill: string; evidence: string[] }[];
  agents: string[];
  skills: { name: string; source: string; hash: string }[];
  /** project rules (shared with everyone working on the repository); personal rules never go here */
  rules: string[];
  /** paths whose change always needs the owner: lanes never auto-approve a job touching them */
  escalate: string[];
  models: { build?: string };
}

export const DEFAULT_ESCALATE = [".github/workflows/**", ".gitlab-ci.yml", "**/Dockerfile*", "**/*compose*.y*ml", "**/migrations/**", "**/*.sql", "**/auth/**", "**/.env*", "**/*.tf", "**/serverless.y*ml", "**/app.y*ml", "**/cloudbuild.y*ml", "**/package.json", "**/pyproject.toml", "**/go.mod", "**/Cargo.toml", "**/requirements*.txt", "AGENTS.md", "CLAUDE.md"];

function rootScripts(root: string): Record<string, string> {
  try { return JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).scripts ?? {}; } catch { return {}; }
}

/** Setup for the repository: a root install script, else the root lockfile, else each sub-package's lockfile. */
function setupCommand(root: string, files: string[], subdirs: string[] = []): string | undefined {
  const scripts = rootScripts(root);
  const named = ["setup", "bootstrap", "install:all", "install-all", "deps"].find((n) => /\b(install|ci|sync)\b/.test(scripts[n] ?? ""));
  if (named) return `npm run ${named}`;
  const own = setupIn(root, files, "");
  if (own) return own;
  const subs = subdirs.map((d) => { const c = setupIn(root, files, d); return c && `(cd ${d} && ${c})`; }).filter(Boolean);
  return subs.length ? subs.join(" && ") : undefined;
}

function setupIn(root: string, files: string[], dir: string): string | undefined {
  const at = (f: string) => { const rel = dir ? `${dir}/${f}` : f; return files.includes(rel) || fs.existsSync(path.join(root, rel)); }; // lockfiles are not indexed
  if (at("pnpm-lock.yaml")) return "pnpm install --frozen-lockfile";
  if (at("yarn.lock")) return "yarn install --frozen-lockfile";
  if (at("bun.lockb") || at("bun.lock")) return "bun install --frozen-lockfile";
  if (at("package-lock.json")) return "npm ci";
  if (at("uv.lock")) return "uv sync";
  if (at("poetry.lock")) return "poetry install";
  if (at("requirements.txt")) return "python -m pip install -r requirements.txt";
  if (at("go.mod")) return "go mod download";
  if (at("Cargo.toml")) return "cargo fetch";
  if (at("Gemfile.lock")) return "bundle install";
  return undefined;
}

/** A sub-package command is redundant when a root script of the same kind already runs it (`--prefix dir`, `cd dir`, ...). */
function delegated(c: Command, sameKind: Command[], scripts: Record<string, string>): boolean {
  const dir = c.cmd.match(/^cd (\S+) && /)?.[1]; if (!dir) return false;
  const d = dir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const via = new RegExp(`(--prefix|-C|--dir|--cwd|--workspace|-w|cd)[ =]+(\\./)?${d}(/|\\b)`);
  return sameKind.some((r) => {
    if (r.cmd.startsWith("cd ")) return false;
    const name = r.cmd.match(/^(?:npm run|pnpm(?: run)?|yarn(?: run)?|bun run)\s+(\S+)/)?.[1];
    return !!name && via.test(scripts[name] ?? "");
  });
}

/** Commands are facts, re-detected on every run. A command the owner sets with "evidence": "owner" is policy: it is
 * kept, and replaces the detected ones of its kind. */
function mergeCommands(saved: Command[] | undefined, found: Command[]): Command[] {
  const owned = (saved || []).filter((c) => c.evidence === "owner");
  return [...owned, ...found.filter((f) => !owned.some((o) => o.kind === f.kind))];
}

export async function plan(root: string, me: PersonalProfile = loadProfile()): Promise<NexusConfig> {
  const repo = await new Repo(root).init(); await repo.index();
  const p: Profile = repo.profile(); const files = repo.listFiles(); repo.close();
  const saved = readConfig(root);
  const commands: Command[] = [];
  for (const kind of ["setup", "build", "typecheck", "lint", "test", "format", "run"] as const) {
    if (kind === "setup") {
      const subdirs = [...new Set(p.buildSystems.map((b) => path.posix.dirname(b.manifest)).filter((d) => d !== "."))];
      const s = setupCommand(root, files, subdirs); if (s) commands.push({ kind, cmd: s, evidence: "lockfile or install script" }); continue;
    }
    const found = commandsFor(p, kind).map((c) => ({ kind, cmd: c, evidence: p.buildSystems.find((x) => x.commands[kind] === c)!.manifest }));
    commands.push(...found.filter((c) => !delegated(c, found, rootScripts(root))));
  }
  const envs = detectEnvironments(root, files, me.environments);
  const skills = [...new Set([...BASE_SKILLS, ...envs.map((e) => e.skill)])].filter((s) => fs.existsSync(path.join(BUILTIN_SKILLS, s, "SKILL.md")));
  return {
    version: 1,
    project: { languages: p.languages.slice(0, 6).map((l) => l.id), frameworks: p.frameworks, entryPoints: p.entryPoints.slice(0, 8), docs: p.docs.slice(0, 8), ci: p.ci },
    setup: saved?.setup ?? commands.find((c) => c.kind === "setup")?.cmd,
    // detected commands, except kinds the owner pinned
    commands: mergeCommands(saved?.commands, commands.filter((c) => c.kind !== "setup")),
    environments: envs,
    rules: saved?.rules ?? [],
    agents: saved?.agents ?? me.agents,
    skills: skills.map((name) => ({ name, source: `nexus-agent/skills/${name}`, hash: hashDir(path.join(BUILTIN_SKILLS, name)) })),
    escalate: saved?.escalate ?? DEFAULT_ESCALATE,
    models: { ...me.models, ...(saved?.models || {}) },
  };
}

export const configPath = (root: string) => path.join(root, ".nexus", "config.json");
/** Older setups kept the config in .nexus/factory.json; it is read as a fallback and replaced on the next init. */
const legacyConfigPath = (root: string) => path.join(root, ".nexus", "factory.json");
export function readConfig(root: string): NexusConfig | null {
  for (const f of [configPath(root), legacyConfigPath(root)]) { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { /* next */ } }
  return null;
}

function hashDir(dir: string): string {
  const h = crypto.createHash("sha256");
  const walk = (d: string) => { for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else { h.update(path.relative(dir, f)); h.update(fs.readFileSync(f)); } } };
  try { walk(dir); } catch {}
  return h.digest("hex").slice(0, 16);
}

/** The managed block of AGENTS.md: short (target under 1,000 tokens), facts with their evidence, rules, pointers. */
export function renderAgents(c: NexusConfig): string {
  const L: string[] = [BEGIN, "## Project", ""];
  const pr = c.project;
  L.push(`- Languages: ${pr.languages.join(", ") || "-"}${pr.frameworks.length ? `; frameworks: ${pr.frameworks.join(", ")}` : ""}.`);
  if (pr.entryPoints.length) L.push(`- Entry points: ${pr.entryPoints.map((f) => `\`${f}\``).join(", ")}.`);
  if (pr.docs.length) L.push(`- Read first: ${pr.docs.slice(0, 4).map((f) => `\`${f}\``).join(", ")}.`);
  if (pr.ci.length) L.push(`- CI: ${pr.ci.slice(0, 3).map((f) => `\`${f}\``).join(", ")}.`);
  L.push("", "## Commands", "");
  if (c.setup) L.push(`- setup: \`${c.setup}\``);
  for (const x of c.commands) L.push(`- ${x.kind}: \`${x.cmd}\` (from \`${x.evidence}\`)`);
  if (!c.setup && !c.commands.length) L.push("- None detected. Add them to `.nexus/config.json` and re-run `nexus init`.");
  L.push("", "## Working rules", "");
  for (const r of c.rules) L.push(`- ${r}`);
  L.push("- Verify every change with the cheapest command above that covers it before saying it is done. Report what was not checked.");
  L.push("- Review your own diff before finishing: every requirement met, edge cases, other code that must change too, no unrelated changes.");
  L.push("- Leave the repository ready for the next agent: checks pass, the change has a test, README and BACKLOG.md are current (skill `build-for-handover`).");
  L.push("", "## Finding code", "");
  L.push("Query the code index before reading whole files: `nexus locate \"<task>\"`, `nexus ctx <symbol>`, `nexus show <symbol|file:a-b>`, `nexus refs <symbol>`, `nexus impact` (what a change affects and which tests cover it).");
  if (c.environments.length > 1 || c.skills.length) {
    L.push("", "## Environments and skills", "");
    for (const e of c.environments) L.push(`- ${e.title}: see skill \`${e.skill}\` (evidence: ${e.evidence.slice(0, 2).map((x) => `\`${x}\``).join(", ")}).`);
    L.push(`- Skills in \`.agents/skills/\`: ${c.skills.map((s) => s.name).join(", ")}. Load one only when the task needs it.`);
  }
  L.push(END);
  return L.join("\n");
}

function thin(agent: string): { file: string; text: string } | null {
  const pointer = "Follow `AGENTS.md` in the repository root: project facts, commands, rules and skills.";
  switch (agent) {
    case "claude": return { file: "CLAUDE.md", text: `${BEGIN}\n@AGENTS.md\n\n${pointer} Skills are also in \`.claude/skills/\`.\n${END}` };
    case "gemini": return { file: "GEMINI.md", text: `${BEGIN}\n${pointer}\n${END}` };
    case "copilot": return { file: ".github/copilot-instructions.md", text: `${BEGIN}\n${pointer}\n${END}` };
    case "cursor": return { file: ".cursor/rules/agents.mdc", text: `---\ndescription: Project rules\nalwaysApply: true\n---\n${BEGIN}\n${pointer}\n${END}` };
    default: return null;
  }
}

/** Replace the managed block, or append it; the owner's text outside the markers is kept byte for byte. */
export function upsertBlock(existing: string | null, block: string, title?: string): string {
  if (existing === null) return (title ? `# ${title}\n\n` : "") + block + "\n";
  const i = existing.indexOf(BEGIN.slice(0, 18)), j = existing.indexOf(END);
  if (i >= 0 && j > i) { const lineStart = existing.lastIndexOf("\n", i) + 1; return existing.slice(0, lineStart) + block + existing.slice(j + END.length); }
  return existing.replace(/\s*$/, "\n\n") + block + "\n";
}

export interface InitResult { config: NexusConfig; written: { file: string; action: string }[]; notes: string[] }

export async function init(root: string, opts: { dry?: boolean; agents?: string[]; env?: string[] } = {}): Promise<InitResult> {
  const me = loadProfile();
  if (opts.env?.length) me.environments = [...new Set([...me.environments, ...opts.env])];
  const config = await plan(root, me);
  if (opts.agents?.length) config.agents = opts.agents;
  const written: { file: string; action: string }[] = [], notes: string[] = [];
  const put = (rel: string, text: string) => {
    const abs = path.join(root, rel), before = fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null;
    if (before === text) return;
    written.push({ file: rel, action: before === null ? "create" : "update" });
    if (!opts.dry) { fs.mkdirSync(path.dirname(abs), { recursive: true }); fs.writeFileSync(abs, text); }
  };
  const block = (rel: string, b: string, title?: string) => { const abs = path.join(root, rel); put(rel, upsertBlock(fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null, b, title)); };

  block("AGENTS.md", renderAgents(config), path.basename(root));
  for (const a of config.agents) {
    const t = thin(a); if (!t) continue;
    if (!fs.existsSync(path.join(root, t.file))) put(t.file, t.text + "\n"); // new file: with any front matter it needs
    else block(t.file, t.text.slice(t.text.indexOf(BEGIN)));
  }
  // skills: copied (not linked) so the repository works without Nexus installed; provenance + hash in config.json
  const skillDirs = [".agents/skills", ...(config.agents.includes("claude") ? [".claude/skills"] : [])];
  const prev = readConfig(root);
  for (const s of config.skills) for (const d of skillDirs) {
    const dest = path.join(root, d, s.name), was = prev?.skills.find((x) => x.name === s.name)?.hash;
    if (fs.existsSync(dest) && hashDir(dest) !== was && hashDir(dest) !== s.hash) { notes.push(`${d}/${s.name} was edited here: kept (delete it to get the current version)`); continue; }
    copyDir(path.join(BUILTIN_SKILLS, s.name), path.join(d, s.name), root, put);
  }
  put(".nexus/config.json", JSON.stringify(config, null, 2) + "\n");
  if (fs.existsSync(legacyConfigPath(root))) { written.push({ file: ".nexus/factory.json", action: "remove (moved to config.json)" }); if (!opts.dry) fs.rmSync(legacyConfigPath(root)); }
  // ignore Nexus's local state, keep its config
  const gi = path.join(root, ".gitignore");
  // a rule that ignores the whole .nexus folder ("/.nexus/", ".nexus") hides config.json for good: git cannot
  // un-ignore a file inside an ignored folder, so such lines are removed and replaced by the block below
  const giBefore = fs.existsSync(gi) ? fs.readFileSync(gi, "utf8") : "";
  let giText = giBefore.replace(/^\/?\.nexus\/?[ \t]*(\n|$)/gm, "");
  if (!/^\.nexus\/\*$/m.test(giText)) giText = giText.replace(/\s*$/, giText ? "\n" : "") + "\n# Nexus local state (index, logs, checkpoints, jobs); its config is shared\n.nexus/*\n!.nexus/config.json\n";
  else if (!/^!\.nexus\/config\.json$/m.test(giText)) giText = giText.replace(/^!\.nexus\/factory\.json$/m, "!.nexus/config.json").replace(/the factory config is shared/, "its config is shared") + (/^!\.nexus\/factory\.json$/m.test(giText) ? "" : "!.nexus/config.json\n");
  if (giText !== giBefore) put(".gitignore", giText);
  // git: identity and an attribution guard, local to this clone
  if (fs.existsSync(path.join(root, ".git"))) {
    if (me.git.name && me.git.email && !opts.dry) { spawnSync("git", ["config", "user.name", me.git.name], { cwd: root }); spawnSync("git", ["config", "user.email", me.git.email], { cwd: root }); notes.push(`git identity for this clone: ${me.git.name} <${me.git.email}>`); }
    if (me.git.forbidAttribution) {
      const hooksDir = (spawnSync("git", ["rev-parse", "--git-path", "hooks"], { cwd: root, encoding: "utf8" }).stdout || ".git/hooks").trim();
      const hook = path.resolve(root, hooksDir, "commit-msg");
      if (fs.existsSync(hook) && !fs.readFileSync(hook, "utf8").includes("nexus attribution guard")) notes.push(`existing ${path.relative(root, hook)} left alone; add the attribution check by hand (see docs/lanes.md)`);
      else if (!fs.existsSync(hook) || fs.readFileSync(hook, "utf8") !== COMMIT_MSG_HOOK) { written.push({ file: path.relative(root, hook), action: "attribution guard" }); if (!opts.dry) { fs.mkdirSync(path.dirname(hook), { recursive: true }); fs.writeFileSync(hook, COMMIT_MSG_HOOK, { mode: 0o755 }); } }
    }
  }
  if (!me.git.name) notes.push("no personal profile yet: `nexus profile set git.name <name>` and `nexus profile set git.email <email>`, then re-run init");
  return { config, written, notes };
}

function copyDir(src: string, destRel: string, root: string, put: (rel: string, text: string) => void) {
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(destRel, e.name);
    if (e.isDirectory()) copyDir(s, d, root, put); else put(d, fs.readFileSync(s, "utf8"));
  }
}

// POSIX sh so it runs from Git Bash on Windows, WSL, macOS and Linux.
const COMMIT_MSG_HOOK = `#!/bin/sh
# nexus attribution guard: reject tool or AI attribution lines in commit messages (installed by \`nexus init\`).
if grep -Eiq '^(co-authored-by:.*(claude|anthropic|copilot|openai|chatgpt|gpt|gemini|cursor|codeium|windsurf|devin|noreply@anthropic))|^claude-session:|generated (with|by) .*(claude|copilot|chatgpt|codex|cursor|gemini)' "$1"; then
  echo "commit-msg: attribution line found; remove it (personal rule: commits carry no AI or tool attribution)" >&2
  exit 1
fi
`;

/** `nexus validate`: mechanical checks that the instruction files still match the repository. */
export function validate(root: string): { level: "error" | "warn" | "ok"; msg: string }[] {
  const out: { level: "error" | "warn" | "ok"; msg: string }[] = [];
  const c = readConfig(root);
  if (!c) return [{ level: "error", msg: "no .nexus/config.json: run `nexus init`" }];
  const ignored = spawnSync("git", ["check-ignore", "-v", ".nexus/config.json"], { cwd: root, encoding: "utf8" });
  // check-ignore -v also reports a matching "!" rule, which means the file is kept, not ignored
  if (ignored.status === 0 && !/:!/.test(ignored.stdout.split("\t")[0])) out.push({ level: "error", msg: `.nexus/config.json is ignored by git (${ignored.stdout.trim().split("\t")[0]}), so other clones and job worktrees never get it: run \`nexus init\`` });
  const agents = path.join(root, "AGENTS.md");
  if (!fs.existsSync(agents)) out.push({ level: "error", msg: "AGENTS.md missing" });
  else {
    const t = fs.readFileSync(agents, "utf8"), i = t.indexOf(BEGIN.slice(0, 18)), j = t.indexOf(END);
    if (i < 0 || j < i) out.push({ level: "error", msg: "AGENTS.md has no nexus block" });
    else {
      const b = t.slice(i, j), tokens = Math.round(b.length / 4);
      out.push({ level: tokens > 1500 ? "error" : tokens > 1000 ? "warn" : "ok", msg: `AGENTS.md managed block ~${tokens} tokens (target < 1000, ceiling 1500)` });
      if (b !== renderAgents(c).slice(0, b.length)) out.push({ level: "warn", msg: "AGENTS.md block differs from .nexus/config.json: re-run `nexus init`" });
      for (const m of b.matchAll(/`([\w./-]+\.[\w]+)`/g)) if (!/^\w+:/.test(m[1]) && /\//.test(m[1]) && !fs.existsSync(path.join(root, m[1]))) out.push({ level: "error", msg: `AGENTS.md names a missing path: ${m[1]}` });
    }
  }
  for (const x of c.commands) if (!fs.existsSync(path.join(root, x.evidence))) out.push({ level: "error", msg: `command "${x.cmd}" cites ${x.evidence}, which no longer exists` });
  const pkg = (() => { try { return JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")); } catch { return null; } })();
  for (const x of c.commands) { const m = x.cmd.match(/^(?:npm|pnpm|yarn|bun) (?:run )?([\w:.-]+)$/); if (m && pkg && !["install", "ci", "test"].includes(m[1]) && !pkg.scripts?.[m[1]]) out.push({ level: "error", msg: `"${x.cmd}": no script "${m[1]}" in package.json` }); }
  for (const a of c.agents) { const t = thin(a); if (t && !(fs.existsSync(path.join(root, t.file)) && fs.readFileSync(path.join(root, t.file), "utf8").includes("AGENTS.md"))) out.push({ level: "warn", msg: `${t.file} does not point to AGENTS.md` }); }
  for (const s of c.skills) for (const d of [".agents/skills", ...(c.agents.includes("claude") ? [".claude/skills"] : [])]) {
    const dir = path.join(root, d, s.name);
    if (!fs.existsSync(dir)) out.push({ level: "warn", msg: `skill ${s.name} missing from ${d}` });
    else if (hashDir(dir) !== s.hash) out.push({ level: "ok", msg: `skill ${d}/${s.name} edited locally (init keeps local edits)` });
  }
  if (!out.some((o) => o.level !== "ok")) out.push({ level: "ok", msg: "instruction files match the repository" });
  return out;
}
