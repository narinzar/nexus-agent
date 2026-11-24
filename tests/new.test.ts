import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { init } from "../src/lanes/init.ts";
import { handoverCheck, ready } from "../src/lanes/handover.ts";
import { settleBacklog } from "../src/lanes/jobs.ts";
import { createProject } from "../src/lanes/new.ts";

const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const useProfile = () => { const f = path.join(tmp("nexus-prof-"), "profile.json"); fs.writeFileSync(f, JSON.stringify({ git: { name: "someone", email: "someone@example.com" } })); process.env.NEXUS_PROFILE = f; };
const file = (p: string, body: string) => `FILE: ${p}\n<<<<<<< SEARCH\n=======\n${body}\n>>>>>>> REPLACE`;

const SKELETON = {
  "package.json": JSON.stringify({ name: "tally", version: "0.1.0", type: "module", scripts: { test: "node --test" } }, null, 2),
  "src/tally.js": "export const add = (counts, word) => ({ ...counts, [word]: (counts[word] || 0) + 1 });",
  "test/tally.test.js": "import { test } from \"node:test\";\nimport assert from \"node:assert/strict\";\nimport { add } from \"../src/tally.js\";\ntest(\"counts a word\", () => assert.deepEqual(add({}, \"a\"), { a: 1 }));",
  "README.md": "# tally\n\nCounts words.\n\n```bash\nnpm test\n```",
  "SPEC.md": "# Spec\n\nGoal: count words.",
  "BACKLOG.md": "# Backlog\n\n- [ ] Read words from a file (test: counts from a fixture file)",
  ".gitignore": "node_modules/",
};

function commitAll(dir: string) {
  execFileSync("git", ["add", "-A"], { cwd: dir });
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-qm", "x"], { cwd: dir });
}

test("handover check: a ready project passes; missing tests and a tracked .env fail", async () => {
  useProfile();
  const dir = tmp("nexus-ho-"); execFileSync("git", ["init", "-q"], { cwd: dir });
  for (const [f, c] of Object.entries(SKELETON)) { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), c + "\n"); }
  await init(dir); commitAll(dir);
  const ok = await handoverCheck(dir, { requireSpec: true });
  assert.ok(ready(ok), JSON.stringify(ok.filter((c) => !c.ok)));

  fs.rmSync(path.join(dir, "test"), { recursive: true }); fs.writeFileSync(path.join(dir, ".env"), "KEY=1\n"); commitAll(dir);
  const bad = await handoverCheck(dir, { requireSpec: true, runChecks: false });
  const failed = bad.filter((c) => !c.ok).map((c) => c.name);
  assert.ok(failed.includes("tests") && failed.includes("no secrets tracked"), failed.join(","));
});

test("init picks up a test command added after the first run, keeping saved commands", async () => {
  useProfile();
  const dir = tmp("nexus-cmd-"); execFileSync("git", ["init", "-q"], { cwd: dir });
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "x", scripts: { lint: "echo lint" } }));
  fs.writeFileSync(path.join(dir, "a.js"), "export const a = 1;\n");
  await init(dir);
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "x", scripts: { lint: "echo lint", test: "node --test" } }));
  const r = await init(dir);
  assert.deepEqual(r.config.commands.map((c) => c.kind).sort(), ["lint", "test"]);
});

test("backlog outcomes: merged items stay ticked, others go back to unchecked with the job id", () => {
  const text = "- [x] a (job started 2026-11-24)\n- [x] b (job started 2026-11-24)\n- [ ] c\n";
  const out = settleBacklog(text, [{ id: "001-a", task: "a", stage: "merged" }, { id: "002-b", task: "b", stage: "needs-human" }] as any);
  assert.equal(out, "- [x] a (done: job 001)\n- [ ] b (needs-human: see job 002)\n- [ ] c\n");
});

test("nexus new: spec, backlog and skeleton, prepared for agents, committed, ready for handover", async () => {
  useProfile();
  const replies = path.join(tmp("nexus-replies-"), "replies.json");
  fs.writeFileSync(replies, JSON.stringify([
    Object.entries(SKELETON).map(([f, c]) => file(f, c)).join("\n") + "\n@done skeleton with a passing test",
    "@approve skeleton, spec and backlog are complete",
  ]));
  const dir = path.join(tmp("nexus-new-"), "tally");
  const r = await createProject(dir, "a word-count library", { model: `mock:${replies}` });
  assert.ok(r.ready, JSON.stringify(r.checks.filter((c) => !c.ok)));
  for (const f of ["AGENTS.md", "CLAUDE.md", "SPEC.md", "BACKLOG.md", ".agents/skills/build-for-handover/SKILL.md", ".nexus/config.json"]) assert.ok(fs.existsSync(path.join(dir, f)), f);
  const log = execFileSync("git", ["log", "--format=%an <%ae>|%s"], { cwd: dir, encoding: "utf8" }).trim().split("\n");
  assert.equal(log.length, 1); assert.match(log[0], /^someone <someone@example\.com>\|Start tally: spec, backlog and skeleton$/);
  assert.equal(execFileSync("git", ["status", "--porcelain"], { cwd: dir, encoding: "utf8" }).trim(), "");
  await assert.rejects(createProject(dir, "again", { model: `mock:${replies}` }), /not empty/);
});

test("commands: Makefile targets win over guessed defaults; Python runs in its uv environment; owner pins are kept", async () => {
  useProfile();
  const dir = tmp("nexus-mk-"); execFileSync("git", ["init", "-q"], { cwd: dir });
  fs.writeFileSync(path.join(dir, "pyproject.toml"), "[project]\nname = \"x\"\n[tool.mypy]\n[tool.ruff]\n");
  fs.writeFileSync(path.join(dir, "uv.lock"), "");
  fs.writeFileSync(path.join(dir, "x.py"), "a = 1\n");
  fs.writeFileSync(path.join(dir, "Makefile"), "setup:\n\tuv sync\ntest:\n\tuv run pytest\ntypecheck:\n\tuv run mypy\n");
  let r = await init(dir, { dry: true });
  assert.deepEqual(r.config.commands.map((c) => `${c.kind}: ${c.cmd}`).sort(), ["lint: uv run ruff check .", "test: make test", "typecheck: make typecheck"]);
  await init(dir);
  const cfgFile = path.join(dir, ".nexus/config.json"), cfg = JSON.parse(fs.readFileSync(cfgFile, "utf8"));
  cfg.commands.push({ kind: "test", cmd: "make test-fast", evidence: "owner" }); fs.writeFileSync(cfgFile, JSON.stringify(cfg));
  r = await init(dir, { dry: true });
  assert.deepEqual(r.config.commands.filter((c) => c.kind === "test").map((c) => c.cmd), ["make test-fast"]);
});

test("backlog items: continuation lines belong to the item, markdown titles make clean commit subjects, retries drop old outcomes", async () => {
  const { takeBacklog, subject } = await import("../src/lanes/jobs.ts");
  const f = path.join(tmp("nexus-bl2-"), "BACKLOG.md");
  fs.writeFileSync(f, "# Backlog\n\n- [ ] **1. `add` command** - appends a book.\n  Files: `src/cli.py`. Tests in `tests/test_add.py`.\n- [ ] **2. `list` command** - prints books. (needs-human: see job 002)\n  Files: `src/cli.py`.\n\nNotes.\n");
  const tasks = takeBacklog(f, 5);
  assert.deepEqual(tasks, ["**1. `add` command** - appends a book. Files: `src/cli.py`. Tests in `tests/test_add.py`.", "**2. `list` command** - prints books. Files: `src/cli.py`."]);
  assert.equal(subject(tasks[0]), "`add` command");
  assert.equal(subject("1. Fix the login redirect. It loops."), "Fix the login redirect");
  const settled = settleBacklog(fs.readFileSync(f, "utf8"), [{ id: "003-x", task: tasks[0], stage: "merged" }] as any);
  assert.match(settled, /- \[x\] \*\*1\. `add` command\*\* - appends a book\. \(done: job 003\)\n  Files: `src\/cli\.py`\. Tests/);
});

test("backlog outcomes overwrite an agent's own tick on its item", () => {
  const out = settleBacklog("- [x] **2. list** - prints. (job 002 done)\n- [ ] other\n", [{ id: "003-2-list", task: "**2. list** - prints. Files: a.py", stage: "merged" }] as any);
  assert.equal(out, "- [x] **2. list** - prints. (done: job 003)\n- [ ] other\n");
});

// A stand-in for one lanes round: takes items like the real one, decides each outcome from its name, records jobs.
function fakeRound(outcome: (task: string) => { stage: string; reasons?: string[] }) {
  let n = 0;
  return async (root: string, file: string, take: number, _o: any, skip?: (h: string) => boolean) => {
    const { takeBacklog, settleBacklog } = await import("../src/lanes/jobs.ts");
    const jobs = takeBacklog(file, take, skip).map((task) => {
      const id = `${String(++n).padStart(3, "0")}-x`, j = { id, task, reasons: [], build: { cost: 0.5 }, ...outcome(task) };
      fs.mkdirSync(path.join(root, ".nexus/jobs", id), { recursive: true }); fs.writeFileSync(path.join(root, ".nexus/jobs", id, "job.json"), JSON.stringify(j));
      return j;
    });
    fs.writeFileSync(file, settleBacklog(fs.readFileSync(file, "utf8"), jobs as any));
    return jobs as any;
  };
}

test("until-done: finishes what it can, retries a failing item, then holds it for the owner", async () => {
  const { runUntilDone } = await import("../src/lanes/jobs.ts");
  const root = tmp("nexus-until-"), file = path.join(root, "BACKLOG.md");
  fs.writeFileSync(file, "- [ ] a\n- [ ] hard\n- [ ] c\n- [ ] deps\n");
  const r = await runUntilDone(root, file, { take: 2 }, fakeRound((t) =>
    t === "hard" ? { stage: "needs-human", reasons: ["test: failed"] } : t === "deps" ? { stage: "needs-human", reasons: ["touches escalation paths: package.json"] } : { stage: "merged" }));
  assert.equal(r.stop, "only held items are left");
  assert.equal(r.done, 2);
  assert.deepEqual(r.held.sort(), ["deps", "hard"]);
  assert.equal(r.jobs.filter((j) => j.task === "hard").length, 2, "a failing item is tried twice");
  assert.equal(r.jobs.filter((j) => j.task === "deps").length, 1, "an escalated item is not retried");
  assert.match(fs.readFileSync(file, "utf8"), /- \[x\] a \(done: job \d+\)/);
});

test("until-done: stops at the budget, and reports a finished backlog", async () => {
  const { runUntilDone } = await import("../src/lanes/jobs.ts");
  const root = tmp("nexus-until-"), file = path.join(root, "BACKLOG.md");
  fs.writeFileSync(file, "- [ ] a\n- [ ] b\n- [ ] c\n");
  const r = await runUntilDone(root, file, { take: 2, budget: 1 }, fakeRound(() => ({ stage: "merged" })));
  assert.equal(r.rounds, 1); assert.match(r.stop, /budget/); assert.deepEqual(r.open, ["c"]);
  const done = await runUntilDone(root, file, { take: 2 }, fakeRound(() => ({ stage: "merged" })));
  assert.equal(done.stop, "backlog finished"); assert.deepEqual(done.open, []);
});

test("savings labels in the benchmark chart", async () => {
  const { saving } = await import("../src/benchmark/report.ts");
  assert.equal(saving("fewer", 214.8, 5.8), "37× fewer");
  assert.equal(saving("cheaper", 0.174, 0.033), "81% cheaper");
  assert.equal(saving("faster", 17, 8), "2.1× faster");
  assert.equal(saving("faster", 62, 66), "about the same");
  assert.equal(saving("faster", 50, 80), "60% slower");
});
