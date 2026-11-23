import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { init, validate, upsertBlock, BEGIN, END } from "../src/factory/init.ts";
import { lanes, matchesAny, takeBacklog, type Job } from "../src/factory/jobs.ts";
import { ATTRIBUTION_RE, personalRules, DEFAULT_PROFILE, applyProfile } from "../src/factory/profile.ts";
import { detectEnvironments } from "../src/factory/environments.ts";

function repoWith(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nexus-factory-"));
  for (const [f, c] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), c); }
  execFileSync("git", ["init", "-q"], { cwd: dir });
  return dir;
}
const profile = (dir: string, p: object) => { const f = path.join(dir, "..", `${path.basename(dir)}-profile.json`); fs.writeFileSync(f, JSON.stringify(p)); process.env.NEXUS_PROFILE = f; };

test("managed block: replaced in place, owner text kept byte for byte", () => {
  const owner = "# Title\n\nMy own notes.\n";
  const once = upsertBlock(owner, `${BEGIN}\nA\n${END}`);
  assert.ok(once.startsWith(owner));
  const twice = upsertBlock(once + "\nTrailing owner text.\n", `${BEGIN}\nB\n${END}`);
  assert.match(twice, /My own notes\./); assert.match(twice, /Trailing owner text\./);
  assert.doesNotMatch(twice, /\nA\n/); assert.match(twice, /\nB\n/);
  assert.equal(twice.split(BEGIN).length, 2);
});

test("init: detects stack, commands and environments; idempotent; personal rules stay out of the repository", async () => {
  const dir = repoWith({
    "package.json": JSON.stringify({ name: "x", scripts: { test: "node --test", typecheck: "tsc --noEmit" } }),
    "package-lock.json": "{}", "src/index.ts": "export const a = 1;\n", "AGENTS.md": "# X\n\nOwner rule.\n",
    "infra/serverless.yml": "service: x\n", "scripts/deploy.ps1": "Write-Host hi\n",
  });
  profile(dir, { git: { name: "someone", email: "someone@example.com" } });
  const r = await init(dir);
  const ids = r.config.environments.map((e) => e.id);
  for (const e of ["local", "aws-lambda", "powershell"]) assert.ok(ids.includes(e), `missing environment ${e}: ${ids}`);
  assert.equal(r.config.setup, "npm ci");
  assert.deepEqual(r.config.commands.map((c) => c.kind).sort(), ["test", "typecheck"]);
  const agents = fs.readFileSync(path.join(dir, "AGENTS.md"), "utf8");
  assert.match(agents, /Owner rule\./);
  assert.match(agents, /npm run typecheck/);
  assert.doesNotMatch(agents, /someone@example\.com|Co-Authored-By/, "personal rules must not be written into the repository");
  assert.match(fs.readFileSync(path.join(dir, "CLAUDE.md"), "utf8"), /@AGENTS\.md/);
  assert.ok(fs.existsSync(path.join(dir, ".claude/skills/env-aws-lambda/SKILL.md")));
  assert.ok(fs.existsSync(path.join(dir, ".agents/skills/code-review/SKILL.md")));
  assert.match(fs.readFileSync(path.join(dir, ".gitignore"), "utf8"), /!\.nexus\/factory\.json/);
  assert.equal(execFileSync("git", ["config", "user.email"], { cwd: dir, encoding: "utf8" }).trim(), "someone@example.com");
  const again = await init(dir);
  assert.deepEqual(again.written, [], "second run changes nothing");
  assert.ok(validate(dir).every((v) => v.level !== "error"), JSON.stringify(validate(dir)));
  // a locally edited skill is kept
  fs.appendFileSync(path.join(dir, ".agents/skills/testing/SKILL.md"), "\nLocal addition.\n");
  const third = await init(dir);
  assert.ok(third.notes.some((n) => /testing was edited here/.test(n)));
  assert.match(fs.readFileSync(path.join(dir, ".agents/skills/testing/SKILL.md"), "utf8"), /Local addition/);
});

test("validate: catches a command whose script was removed", async () => {
  const dir = repoWith({ "package.json": JSON.stringify({ name: "x", scripts: { lint: "eslint ." } }), "a.js": "export const a = 1;\n" });
  profile(dir, {});
  await init(dir);
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "x", scripts: {} }));
  assert.ok(validate(dir).some((v) => v.level === "error" && /no script "lint"/.test(v.msg)));
});

test("commit-msg guard rejects AI attribution, allows normal messages", async () => {
  const dir = repoWith({ "a.txt": "a\n" });
  profile(dir, { git: { name: "someone", email: "someone@example.com" } });
  await init(dir);
  execFileSync("git", ["add", "-A"], { cwd: dir });
  assert.throws(() => execFileSync("git", ["commit", "-qm", "x\n\nCo-Authored-By: Claude <noreply@anthropic.com>"], { cwd: dir, stdio: "pipe" }));
  execFileSync("git", ["commit", "-qm", "Add a"], { cwd: dir, stdio: "pipe" });
  assert.ok(ATTRIBUTION_RE.test("Co-Authored-By: GitHub Copilot <bot@github.com>"));
  assert.ok(!ATTRIBUTION_RE.test("Co-Authored-By: Jane Doe <jane@example.com>"));
});

test("profile: rules rendered for user-level files only", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "nexus-home-")); const old = process.env.HOME; process.env.HOME = home;
  try {
    const p = { ...DEFAULT_PROFILE, git: { ...DEFAULT_PROFILE.git, name: "n", email: "n@example.com" }, agents: ["claude"] };
    assert.ok(personalRules(p).some((r) => r.includes("n <n@example.com>")));
    const changed = applyProfile(p);
    assert.equal(changed.length, 1); assert.match(fs.readFileSync(changed[0], "utf8"), /Personal rules/);
    assert.equal(applyProfile(p).length, 0, "idempotent");
  } finally { process.env.HOME = old; }
});

test("lanes: tasks touching the same files are serialised, others run in parallel", () => {
  const j = (id: string, predicted: string[]) => ({ id, predicted } as Job);
  const ls = lanes([j("1", ["a.ts", "a.test.ts"]), j("2", ["b.ts"]), j("3", ["c.ts", "a.test.ts"]), j("4", [])]);
  assert.equal(ls.length, 3);
  assert.deepEqual(ls.find((l) => l.some((x) => x.id === "1"))!.map((x) => x.id).sort(), ["1", "3"]);
});

test("escalation globs", () => {
  const g = ["**/migrations/**", ".github/workflows/**", "**/package.json", "**/.env*"];
  assert.ok(matchesAny("db/migrations/001.sql", g));
  assert.ok(matchesAny(".github/workflows/ci.yml", g));
  assert.ok(matchesAny("package.json", g) && matchesAny("web/package.json", g));
  assert.ok(matchesAny(".env.local", g));
  assert.ok(!matchesAny("src/app.ts", g));
});

test("backlog: takes unchecked items and ticks them", () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "nexus-bl-")), "BACKLOG.md");
  fs.writeFileSync(f, "# Backlog\n- [x] done already\n- [ ] first\n- [ ] second\n- [ ] third\n");
  assert.deepEqual(takeBacklog(f, 2), ["first", "second"]);
  assert.deepEqual(takeBacklog(f, 5), ["third"]);
  assert.deepEqual(takeBacklog(f, 5), []);
});

test("environment detection from repository evidence", () => {
  const dir = repoWith({ "train.py": "import modal\napp = modal.App('t')\n", "app.yaml": "runtime: python312\n", "Dockerfile": "FROM python:3.12\n" });
  const ids = detectEnvironments(dir, ["train.py", "app.yaml", "Dockerfile"]).map((e) => e.id);
  for (const e of ["modal", "gcp", "docker", "local"]) assert.ok(ids.includes(e), `${e} not in ${ids}`);
  assert.ok(!ids.includes("aws-lambda"));
});

test("monorepo: root scripts that forward to a sub-package are not duplicated; setup found for the sub-package", async () => {
  const dir = repoWith({
    "package.json": JSON.stringify({ name: "root", scripts: { build: "npm run build --prefix web", typecheck: "npm run typecheck --prefix web" } }),
    "web/package.json": JSON.stringify({ name: "web", scripts: { build: "next build", typecheck: "tsc --noEmit", lint: "eslint ." } }),
    "web/package-lock.json": "{}", "web/src/a.ts": "export const a = 1;\n",
  });
  profile(dir, {});
  const r = await init(dir, { dry: true });
  const cmds = r.config.commands.map((c) => `${c.kind}: ${c.cmd}`).sort();
  assert.deepEqual(cmds, ["build: npm run build", "lint: cd web && npm run lint", "typecheck: npm run typecheck"]);
  assert.equal(r.config.setup, "(cd web && npm ci)");
});
