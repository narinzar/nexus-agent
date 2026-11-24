// Handover check: is this repository ready for the next agent or person to pick up cold?
// Every item is mechanical (files, git, exit codes); no model decides it.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { readConfig, validate } from "./init.ts";
import { run, GATE_KINDS } from "./jobs.ts";

export interface Check { name: string; ok: boolean; detail: string }

const TEST_FILE = /(^|\/)(tests?|__tests__|spec)\/|[._-](test|spec)\.[a-z0-9]+$|_test\.go$|(^|\/)test_[^/]*\.py$/i;
const SECRET_FILE = /(^|\/)\.env(\.[^/]*)?$/;
const SAFE_ENV = /\.(example|sample|template|dist)$/;

const git = (root: string, ...a: string[]) => spawnSync("git", a, { cwd: root, encoding: "utf8" });
const tracked = (root: string) => git(root, "ls-files").stdout.split("\n").filter(Boolean);

/**
 * requireSpec: a project started with `nexus new` must also have SPEC.md and a BACKLOG.md with items.
 * runChecks: run setup and every check command (slow); off for a quick look.
 */
export async function handoverCheck(root: string, o: { requireSpec?: boolean; runChecks?: boolean } = {}): Promise<Check[]> {
  const out: Check[] = [], files = tracked(root), cfg = readConfig(root);
  const add = (name: string, ok: boolean, detail: string) => out.push({ name, ok, detail });

  const v = cfg ? validate(root).filter((x) => x.level === "error") : [];
  add("agent instructions", !!cfg && !v.length, !cfg ? "no .nexus/config.json: run `nexus init`" : v.length ? v.map((x) => x.msg).join("; ") : "AGENTS.md matches the repository");

  const cmds = cfg?.commands || [], kinds = cmds.map((c) => c.kind);
  add("check commands", kinds.includes("test"), kinds.length ? `found: ${[cfg?.setup && "setup", ...new Set(kinds)].filter(Boolean).join(", ")}${kinds.includes("test") ? "" : "; no test command"}` : "none detected: add scripts for setup, test, lint");

  const tests = files.filter((f) => TEST_FILE.test(f));
  add("tests", tests.length > 0, tests.length ? `${tests.length} test file(s), e.g. ${tests[0]}` : "no test files");

  const readme = files.find((f) => /^readme(\.md|\.rst|\.txt)?$/i.test(f));
  const rText = readme ? fs.readFileSync(path.join(root, readme), "utf8") : "";
  const testCmd = cmds.find((c) => c.kind === "test")?.cmd;
  const mentions = !!rText && (/```|^ {4}\S/m.test(rText)) && (testCmd ? rText.includes(testCmd) || /\btest/i.test(rText) : true);
  add("README", mentions, !readme ? "no README" : mentions ? `${readme} explains how to run things` : `${readme} has no commands for setup, run and test`);

  if (o.requireSpec) {
    const spec = fs.existsSync(path.join(root, "SPEC.md")), bl = path.join(root, "BACKLOG.md");
    const items = fs.existsSync(bl) ? (fs.readFileSync(bl, "utf8").match(/^\s*[-*] \[[ x]\] /gm) || []).length : 0;
    add("spec and backlog", spec && items > 0, `${spec ? "SPEC.md" : "no SPEC.md"}; ${items ? `BACKLOG.md with ${items} item(s)` : "no BACKLOG.md items"}`);
  }

  const secrets = files.filter((f) => SECRET_FILE.test(f) && !SAFE_ENV.test(f));
  add("no secrets tracked", !secrets.length, secrets.length ? secrets.join(", ") : "no .env files in git");

  const head = git(root, "rev-parse", "--verify", "-q", "HEAD").status === 0;
  const dirty = git(root, "status", "--porcelain", "--untracked-files=all").stdout.split("\n").filter((l) => l && !/ \.nexus\/(?!config\.json$)/.test(l));
  add("committed", head && !dirty.length, !head ? "no commits yet" : dirty.length ? `${dirty.length} uncommitted change(s): ${dirty.slice(0, 3).map((l) => l.slice(3)).join(", ")}` : "working tree clean");

  if (o.runChecks !== false && cfg) {
    const steps = [...(cfg.setup ? [{ kind: "setup", cmd: cfg.setup }] : []), ...GATE_KINDS.flatMap((k) => cmds.filter((c) => c.kind === k))];
    let failed = "";
    for (const s of steps) { const r = await run(s.cmd, root); if (r.code !== 0) { failed = `${s.kind}: \`${s.cmd}\` exit ${r.code}: ${r.out.trim().split("\n").slice(-3).join(" ")}`; break; } }
    add("checks pass", !failed && steps.length > 0, failed || (steps.length ? steps.map((s) => s.kind).join(", ") + " passed" : "nothing to run"));
  }
  return out;
}

export const ready = (cs: Check[]) => cs.every((c) => c.ok);
export const failures = (cs: Check[]) => cs.filter((c) => !c.ok).map((c) => `- ${c.name}: ${c.detail}`).join("\n");
