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
