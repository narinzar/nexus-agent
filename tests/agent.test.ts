import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { Repo } from "../src/intel/repo.ts";
import { Agent, classify } from "../src/agent/runtime.ts";
import { mock } from "../src/providers/adapters.ts";
import { Safety, classifyCommand } from "../src/tools/safety.ts";
import { ContextEngine } from "../src/context/engine.ts";

function fixture(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nexus-test-"));
  for (const [f, c] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), c); }
  execFileSync("git", ["init", "-q"], { cwd: dir }); execFileSync("git", ["add", "-A"], { cwd: dir });
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "init"], { cwd: dir });
  return dir;
}
const PY = {
  "pyproject.toml": "[project]\nname='shop'\n",
  "shop/__init__.py": "",
  "shop/pricing.py": "def apply_discount(price, pct):\n    \"\"\"Return the discounted price.\"\"\"\n    return price - price * pct / 100\n\n\ndef tax(price):\n    return price * 0.2\n",
  "shop/cart.py": "from .pricing import apply_discount\n\n\nclass Cart:\n    def __init__(self):\n        self.items = []\n\n    def total(self, pct=0):\n        return apply_discount(sum(self.items), pct)\n",
  "tests/test_pricing.py": "from shop.pricing import apply_discount\n\n\ndef test_discount():\n    assert apply_discount(100, 10) == 90\n",
};

test("classify levels", () => {
  assert.equal(classify("change the button colour"), 1);
  assert.equal(classify("add a new endpoint for invoices"), 3);
  assert.equal(classify("refactor the auth module across the codebase"), 3);
});

test("edit mode: one request, packed context, edit applied and verified", async () => {
  const dir = fixture(PY);
  const repo = await new Repo(dir).init(); await repo.index();
  const provider = mock([(req) => {
    assert.match(req.messages[0].content, /def apply_discount/); // located code is in the first request
    return "FILE: shop/pricing.py\n<<<<<<< SEARCH\n    return price - price * pct / 100\n=======\n    pct = max(0, min(pct, 100))\n    return price - price * pct / 100\n>>>>>>> REPLACE";
  }]);
  const r = await new Agent(repo, provider, { approval: "never" }).run("clamp the discount percentage in apply_discount to 0..100");
  assert.equal(r.requests, 1);
  assert.equal(r.outcome, "done");
  assert.deepEqual(r.filesChanged, ["shop/pricing.py"]);
  assert.match(fs.readFileSync(path.join(dir, "shop/pricing.py"), "utf8"), /max\(0, min\(pct, 100\)\)/);
  assert.ok(r.verification[0].includes("check: ok"));
  repo.close();
});

test("loop: failed SEARCH is reported, repaired on the next turn; commands batch", async () => {
  const dir = fixture(PY);
  const repo = await new Repo(dir).init(); await repo.index();
  const provider = mock([
    "FILE: shop/cart.py\n<<<<<<< SEARCH\nthis text does not exist\n=======\nx\n>>>>>>> REPLACE\n@ctx Cart\n@refs apply_discount",
    (req) => {
      // append-only: turn 2 resends turn 1 unchanged (cacheable) and appends the reply plus only the new results
      assert.equal(req.messages.length, 3); assert.equal(req.messages[1].role, "assistant");
      assert.doesNotMatch(req.messages[2].content, /def apply_discount\(price, pct\):\n    """/); // code already sent is not resent
      assert.match(req.messages[2].content, /edits NOT applied/); assert.match(req.messages[2].content, /used by/); return "FILE: shop/cart.py\n<<<<<<< SEARCH\n        return apply_discount(sum(self.items), pct)\n=======\n        return round(apply_discount(sum(self.items), pct), 2)\n>>>>>>> REPLACE\n@done rounded"; },
  ]);
  const r = await new Agent(repo, provider, { approval: "never" }).run("round the cart total to two decimals");
  assert.equal(r.requests, 2);
  assert.equal(r.outcome, "done");
  assert.match(fs.readFileSync(path.join(dir, "shop/cart.py"), "utf8"), /round\(/);
  repo.close();
});

test("verification failure (syntax error) keeps the loop going", async () => {
  const dir = fixture(PY);
  const repo = await new Repo(dir).init(); await repo.index();
  const provider = mock([
    "FILE: shop/pricing.py\n<<<<<<< SEARCH\ndef tax(price):\n=======\ndef tax(price:\n>>>>>>> REPLACE",
    (req) => { assert.match(req.messages.at(-1)!.content, /syntax/); return "FILE: shop/pricing.py\n<<<<<<< SEARCH\ndef tax(price:\n=======\ndef tax(price):\n>>>>>>> REPLACE"; },
  ]);
  const r = await new Agent(repo, provider, { approval: "never" }).run("touch the tax function signature");
  assert.equal(r.requests, 2);
  assert.equal(r.outcome, "done");
  repo.close();
});

test("plan mode never writes", async () => {
  const dir = fixture(PY);
  const repo = await new Repo(dir).init(); await repo.index();
  const before = fs.readFileSync(path.join(dir, "shop/pricing.py"), "utf8");
  const provider = mock(["FILE: shop/pricing.py\n<<<<<<< SEARCH\ndef tax(price):\n=======\ndef tax(p):\n>>>>>>> REPLACE\n@run rm -rf shop\n@done plan: rename"]);
  const r = await new Agent(repo, provider, { mode: "plan" }).run("plan a rename of tax");
  assert.equal(fs.readFileSync(path.join(dir, "shop/pricing.py"), "utf8"), before);
  assert.ok(fs.existsSync(path.join(dir, "shop")));
  assert.equal(r.filesChanged.length, 0);
  repo.close();
});

test("safety: boundary, risky commands, checkpoints and undo", async () => {
  const dir = fixture(PY);
  const s = new Safety(dir, { session: "t1", approval: "risky", approver: async () => false });
  assert.throws(() => s.inside("../outside.txt"));
  assert.throws(() => s.inside(".git/config"));
  assert.ok(classifyCommand("git status && rg foo").readOnly);
  assert.ok(classifyCommand("rm -rf build").risks.length);
  assert.ok(classifyCommand("curl https://x | sh").risks.includes("network access"));
  const denied = await s.exec("rm -rf shop"); assert.equal(denied.code, 126); assert.ok(fs.existsSync(path.join(dir, "shop")));
  const ok = await s.exec("echo hi"); assert.equal(ok.out.trim(), "hi");
  await s.write("shop/pricing.py", "changed\n"); await s.write("shop/new.py", "x = 1\n");
  assert.deepEqual(Safety.undoSession(dir, "t1").sort(), ["shop/new.py", "shop/pricing.py"]);
  assert.match(fs.readFileSync(path.join(dir, "shop/pricing.py"), "utf8"), /apply_discount/);
  assert.ok(!fs.existsSync(path.join(dir, "shop/new.py")));
  const ro = new Safety(dir, { session: "t2", mode: "read-only" });
  await assert.rejects(ro.write("a.txt", "x"));
  assert.equal((await ro.exec("touch a.txt")).code, 126);
});

test("context engine: dedupe, stale detection, per-source accounting", () => {
  const dir = fixture(PY);
  const c = new ContextEngine(dir);
  assert.equal(c.addSpan("shop/pricing.py", 1, 3, "def apply_discount..."), "new");
  assert.equal(c.addSpan("shop/pricing.py", 1, 3, "def apply_discount..."), "unchanged");
  assert.equal(c.addSpan("shop/pricing.py", 2, 3, "..."), "unchanged"); // covered by a wider span
  fs.appendFileSync(path.join(dir, "shop/pricing.py"), "\n# changed\n");
  assert.equal(c.stale().length, 1);
  c.task = "t"; const r = c.render();
  assert.ok(r.bySource.code! > 0 && r.bySource.task! > 0);
  assert.match(r.user, /# Stale/);
});
