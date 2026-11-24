import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { settleBacklog } from "../src/lanes/jobs.ts";

const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));

test("backlog outcomes: merged items stay ticked, others go back to unchecked with the job id", () => {
  const text = "- [x] a (job started 2026-11-24)\n- [x] b (job started 2026-11-24)\n- [ ] c\n";
  const out = settleBacklog(text, [{ id: "001-a", task: "a", stage: "merged" }, { id: "002-b", task: "b", stage: "needs-human" }] as any);
  assert.equal(out, "- [x] a (done: job 001)\n- [ ] b (needs-human: see job 002)\n- [ ] c\n");
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
