// `nexus bench report`: regenerate benchmarks/REPORT.md and SVG charts from the raw result files in benchmarks/results.
// Nothing in the report is typed by hand: re-run a benchmark, re-run this, commit.
import fs from "node:fs";
import path from "node:path";
import type { Result } from "./run.ts";

interface RunFile { file: string; suite: string; date: string; repeat: number; results: Result[] }
interface Agg { variant: string; runs: number; pass: number; requests: number; input: number; cacheRead: number; output: number; cost: number; costKnown: number; ms: number }

const short = (v: string) => v.replace("nexus@openrouter:", "nexus · ").replace("nexus@claude-cli", "nexus · claude").replace(/^claude-code$/, "Claude Code (baseline)").replace(/\/([\w.-]+)$/, (_, m) => `/${m}`);
const fmtK = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)} M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)} K` : `${Math.round(n)}`);
const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : "-");

function load(dir: string): RunFile[] {
  return fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort().map((f) => {
    const j = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    const results: Result[] = j.results || [];
    const suite = j.suite || (results.some((r) => /^(CK|CB|K2)/.test(r.task)) ? "large" : "small");
    return { file: f, suite, date: j.date || f.slice(0, 10), repeat: j.repeat || 1, results };
  }).filter((r) => r.results.length && !r.results.every((x) => x.variant === "none" || x.variant === "oracle"));
}

function aggregate(results: Result[]): Agg[] {
  const by = new Map<string, Agg>();
  for (const r of results) {
    const a = by.get(r.variant) || { variant: r.variant, runs: 0, pass: 0, requests: 0, input: 0, cacheRead: 0, output: 0, cost: 0, costKnown: 0, ms: 0 };
    a.runs++; if (r.accept === "pass") a.pass++;
    a.requests += r.requests; a.input += r.totalInput; a.cacheRead += r.cacheRead; a.output += r.output; a.ms += r.ms;
    if (r.cost !== null && r.cost !== undefined) { a.cost += r.cost; a.costKnown++; }
    by.set(r.variant, a);
  }
  return [...by.values()];
}

// ---------- SVG charts (no dependencies; readable on light and dark GitHub themes) ----------
const PALETTE = ["#4C78A8", "#F58518", "#54A24B", "#B279A2", "#E45756", "#72B7B2", "#9D755D"];
function barChart(title: string, rows: { label: string; value: number; text: string }[], unit = ""): string {
  const W = 720, rowH = 30, left = 230, top = 44, H = top + rows.length * rowH + 20;
  const max = Math.max(...rows.map((r) => r.value), 1e-9);
  const bars = rows.map((r, i) => {
    const y = top + i * rowH, w = Math.max(2, ((W - left - 110) * r.value) / max);
    return `<text x="${left - 10}" y="${y + 19}" text-anchor="end" font-size="13" fill="#888">${esc(r.label)}</text>
  <rect x="${left}" y="${y + 5}" width="${w.toFixed(1)}" height="20" rx="3" fill="${PALETTE[i % PALETTE.length]}"/>
  <text x="${left + w + 8}" y="${y + 19}" font-size="13" fill="#888">${esc(r.text)}</text>`;
  }).join("\n  ");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="system-ui, -apple-system, Segoe UI, sans-serif">
  <text x="16" y="26" font-size="16" font-weight="600" fill="#888">${esc(title)}${unit ? ` (${esc(unit)})` : ""}</text>
  ${bars}
</svg>\n`;
}
function scatter(title: string, pts: { label: string; x: number; y: number }[], xLabel: string, yLabel: string): string {
  const W = 720, H = 420, L = 70, R = 30, T = 44, B = 60;
  const maxX = Math.max(...pts.map((p) => p.x), 1e-9) * 1.1, maxY = 100;
  const sx = (x: number) => L + ((W - L - R) * x) / maxX, sy = (y: number) => H - B - ((H - T - B) * y) / maxY;
  const grid = [0, 25, 50, 75, 100].map((y) => `<line x1="${L}" x2="${W - R}" y1="${sy(y)}" y2="${sy(y)}" stroke="#8884" /><text x="${L - 8}" y="${sy(y) + 4}" text-anchor="end" font-size="12" fill="#888">${y}%</text>`).join("");
  const dots = pts.map((p, i) => `<circle cx="${sx(p.x).toFixed(1)}" cy="${sy(p.y).toFixed(1)}" r="7" fill="${PALETTE[i % PALETTE.length]}"/><text x="${(sx(p.x) + 11).toFixed(1)}" y="${(sy(p.y) + 4).toFixed(1)}" font-size="12" fill="#888">${esc(p.label)}</text>`).join("\n  ");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="system-ui, -apple-system, Segoe UI, sans-serif">
  <text x="16" y="26" font-size="16" font-weight="600" fill="#888">${esc(title)}</text>
  ${grid}
  <line x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}" stroke="#888"/>
  <text x="${(L + W - R) / 2}" y="${H - 18}" text-anchor="middle" font-size="13" fill="#888">${esc(xLabel)}</text>
  <text x="18" y="${(T + H - B) / 2}" font-size="13" fill="#888" transform="rotate(-90 18 ${(T + H - B) / 2})" text-anchor="middle">${esc(yLabel)}</text>
  ${dots}
</svg>\n`;
}
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

export function report(root: string) {
  const dir = path.join(root, "benchmarks/results");
  const chartsDir = path.join(root, "benchmarks/charts"); fs.mkdirSync(chartsDir, { recursive: true });
  const files = load(dir);
  const out: string[] = ["# Benchmark report", "", "_Generated by `nexus bench report` from the raw files in [results/](results/). Do not edit by hand._", ""];
  out.push("**Method**", "", "- Each task runs in an isolated copy of its repository.", "- Hidden acceptance tests are copied in only after the agent finishes, then the task's test command decides pass or fail.", "- Large-suite tasks are real upstream fix commits. Each was validated to fail without a change and to pass with the upstream fix (`--variants none,oracle`).", "- Costs are as reported by the provider (OpenRouter, Claude CLI).", "- Input tokens include cache reads.", "");
  for (const suite of ["large", "small"]) {
    const sf = files.filter((f) => f.suite === suite);
    if (!sf.length) continue;
    // current results: the newest file(s) of the latest date with repeats, else the newest file
    const latest = sf.filter((f) => f.repeat > 1); const cur = latest.length ? latest : [sf[sf.length - 1]];
    const results = cur.flatMap((f) => f.results);
    const agg = aggregate(results).sort((a, b) => b.pass / b.runs - a.pass / a.runs || a.cost / a.runs - b.cost / b.runs);
    const tasks = [...new Set(results.map((r) => r.task))];
    const reps = Math.max(...cur.map((f) => f.repeat));
    out.push(`## ${suite === "large" ? "Large suite: real repositories, upstream fix commits" : "Small suite: multi-language fixtures"}`, "", `Tasks: ${tasks.join(", ")}. Runs per task and configuration: ${reps}. Source: ${cur.map((f) => `[${f.file}](results/${f.file})`).join(", ")}.`, "");
    out.push("| Configuration | Passed | Pass rate | Requests / task | Input tokens / task | Cache read | Output / task | Cost / task | Total cost | Time / task |", "|---|---|---|---|---|---|---|---|---|---|");
    for (const a of agg) out.push(`| ${short(a.variant)} | ${a.pass}/${a.runs} | **${pct(a.pass, a.runs)}** | ${(a.requests / a.runs).toFixed(1)} | ${fmtK(a.input / a.runs)} | ${pct(a.cacheRead, a.input)} | ${fmtK(a.output / a.runs)} | ${a.costKnown ? `$${(a.cost / a.costKnown).toFixed(3)}` : "?"} | ${a.costKnown ? `$${a.cost.toFixed(2)}` : "?"} | ${(a.ms / a.runs / 1000).toFixed(0)} s |`);
    out.push("");
    // per-task pass matrix
    const vs = agg.map((a) => a.variant);
    out.push("Passes per task (out of runs):", "", `| Task | ${vs.map(short).join(" | ")} |`, `|---|${vs.map(() => "---").join("|")}|`);
    for (const t of tasks) out.push(`| ${t} | ${vs.map((v) => { const xs = results.filter((r) => r.task === t && r.variant === v); return xs.length ? `${xs.filter((r) => r.accept === "pass").length}/${xs.length}` : "-"; }).join(" | ")} |`);
    out.push("");
    const name = (k: string) => `${suite}-${k}.svg`;
    fs.writeFileSync(path.join(chartsDir, name("pass-rate")), barChart(`${suite} suite: pass rate`, agg.map((a) => ({ label: short(a.variant), value: a.pass / a.runs, text: `${pct(a.pass, a.runs)} (${a.pass}/${a.runs})` }))));
    fs.writeFileSync(path.join(chartsDir, name("cost")), barChart(`${suite} suite: average cost per task`, agg.filter((a) => a.costKnown).map((a) => ({ label: short(a.variant), value: a.cost / a.costKnown, text: `$${(a.cost / a.costKnown).toFixed(3)}` })), "USD"));
    fs.writeFileSync(path.join(chartsDir, name("tokens")), barChart(`${suite} suite: input tokens per task`, agg.map((a) => ({ label: short(a.variant), value: a.input / a.runs, text: `${fmtK(a.input / a.runs)} (${pct(a.cacheRead, a.input)} cached)` }))));
    fs.writeFileSync(path.join(chartsDir, name("cost-vs-quality")), scatter(`${suite} suite: cost vs pass rate (up and to the left is better)`, agg.filter((a) => a.costKnown).map((a) => ({ label: short(a.variant), x: a.cost / a.costKnown, y: (100 * a.pass) / a.runs })), "average cost per task (USD)", "pass rate"));
    out.push(`![pass rate](charts/${name("pass-rate")})`, "", `![cost](charts/${name("cost")})`, "", `![tokens](charts/${name("tokens")})`, "", `![cost vs quality](charts/${name("cost-vs-quality")})`, "");
  }
  out.push("## Earlier runs", "", "Single-run results from development (before repeats), kept for history:", "");
  for (const f of files.filter((f) => f.repeat <= 1)) { const a = aggregate(f.results); out.push(`- [${f.file}](results/${f.file}) (${f.suite}): ${a.map((x) => `${short(x.variant)} ${x.pass}/${x.runs}`).join(", ")}`); }
  const val = fs.readdirSync(dir).filter((f) => /validation/.test(f));
  if (val.length) out.push("", `Suite validation (tests fail with no change, pass with the upstream fix): ${val.map((f) => `[${f}](results/${f})`).join(", ")}.`);
  out.push("", "Narrative write-ups of those runs, including what changed between them: [reports/](reports/).", "");
  fs.writeFileSync(path.join(root, "benchmarks/REPORT.md"), out.join("\n"));
  console.log(`wrote benchmarks/REPORT.md and ${fs.readdirSync(chartsDir).length} charts`);
}
