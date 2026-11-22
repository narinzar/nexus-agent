// `nexus run "<task>"` and `nexus undo <session>`.
import { Repo } from "../intel/repo.ts";
import { Agent } from "./runtime.ts";
import { createProvider, defaultSpec } from "../providers/index.ts";
import { ttyApprover, Safety } from "../tools/safety.ts";
import { totalInput } from "../core/types.ts";

export async function runCli(root: string, rest: () => string[], opt: (n: string, d?: string) => string | undefined, flag: (n: string) => boolean) {
  if (rest()[0] === "undo") { const args = rest(); { console.log(`restored: ${Safety.undoSession(root, args[1]).join(", ") || "-"}`); return; } }
  const spec = opt("--model") || defaultSpec();
  const mode = (opt("--mode", "auto") === "plan" ? "plan" : "auto") as "auto" | "plan";
  const approval = (opt("--approve", "risky") as any);
  const permission = (opt("--permission", "workspace-write") as any);
  const turnsOpt = opt("--turns"); const maxTurns = turnsOpt ? +turnsOpt : undefined;
  const dry = flag("--dry"), quiet = flag("--quiet"), json = flag("--json");
  const task = rest().join(" ").trim();
  if (!task) { console.log('usage: nexus run "<task>" [--model provider:model] [--mode plan] [--approve always|risky|never] [--permission read-only|workspace-write|full] [--dry] [--json]'); return; }
  const repo = await new Repo(root).init();
  await repo.index();
  const agent = new Agent(repo, createProvider(spec), { mode, approval, permission, approver: ttyApprover(), maxTurns, dry, log: quiet ? undefined : (s) => console.error(`[nexus] ${s}`) });
  const r = await agent.run(task);
  if (json) { console.log(JSON.stringify(r, null, 1)); return; }
  const u = r.usage;
  console.log(`${r.outcome}${r.summary ? `: ${r.summary}` : ""}
level ${r.level} | ${r.requests} request(s), ${r.turns} turn(s) | input ${totalInput(u)} (uncached ${u.inputUncached}, cache read ${u.cacheRead}, cache write ${u.cacheWrite}) | output ${u.output} | patch ~${r.patchTokens} tok | cost ${u.cost?.source === "unknown" ? "unknown" : `$${u.cost!.total.toFixed(4)} (${u.cost!.source})`} | ${(r.ms / 1000).toFixed(1)}s
changed: ${r.filesChanged.join(", ") || "-"}
verify: ${r.verification.join(" / ") || "-"}
tokens by source (estimated, all requests): ${Object.entries(r.tokensBySource).map(([k, v]) => `${k} ${v}`).join(", ")}
session ${r.session} (log: .nexus/log/${r.session}.jsonl; undo: nexus run undo ${r.session})`);
  repo.close();
}
