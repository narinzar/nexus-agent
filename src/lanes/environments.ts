// Environment profiles: where the code runs and how it is operated. Each is detected from evidence in the repository
// (or the machine), has preflight checks that print the fix command, and a skill with the working practices.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

export interface Check { what: string; cmd: string[]; fix: string; ok?: (out: string) => boolean }
export interface Environment { id: string; title: string; skill: string; evidence: (root: string, files: string[]) => string[]; checks: Check[] }

const has = (files: string[], re: RegExp) => files.filter((f) => re.test(f)).slice(0, 3);
const grepFiles = (root: string, files: string[], fileRe: RegExp, textRe: RegExp, max = 400) => {
  const hits: string[] = [];
  for (const f of files.filter((x) => fileRe.test(x)).slice(0, max)) {
    try { if (textRe.test(fs.readFileSync(path.join(root, f), "utf8").slice(0, 20000))) hits.push(f); } catch {}
    if (hits.length >= 3) break;
  }
  return hits;
};
const isWsl = () => { try { return /microsoft/i.test(fs.readFileSync("/proc/version", "utf8")); } catch { return false; } };

export const ENVIRONMENTS: Environment[] = [
  { id: "local", title: "Local machine", skill: "env-local", evidence: () => ["always"], checks: [
    { what: "git", cmd: ["git", "--version"], fix: "install git: https://git-scm.com/downloads" },
  ] },
  { id: "wsl", title: "WSL (Linux on Windows)", skill: "env-wsl", evidence: (_r, files) => [...(isWsl() ? ["running inside WSL (/proc/version)"] : []), ...has(files, /(^|\/)\.wslconfig$|(^|\/)wsl\.conf$/)], checks: [
    { what: "repository on the Linux filesystem (not /mnt/c)", cmd: ["pwd"], fix: "clone into ~/ (e.g. ~/code/<repo>): /mnt/c is 5-20x slower and breaks file watching", ok: (o) => !/^\/mnt\/[a-z]\//.test(o.trim()) },
    { what: "git line endings", cmd: ["git", "config", "core.autocrlf"], fix: "git config --global core.autocrlf input", ok: (o) => o.trim() !== "true" },
  ] },
  { id: "powershell", title: "Windows PowerShell", skill: "env-powershell", evidence: (_r, files) => [...(process.platform === "win32" ? ["running on Windows"] : []), ...has(files, /\.(ps1|psm1|psd1)$/i)], checks: [
    { what: "PowerShell 7 (pwsh)", cmd: ["pwsh", "-NoProfile", "-Command", "$PSVersionTable.PSVersion.Major"], fix: process.platform === "win32" ? "winget install Microsoft.PowerShell" : process.platform === "darwin" ? "brew install powershell/tap/powershell" : "sudo snap install powershell --classic (or see learn.microsoft.com/powershell/scripting/install/installing-powershell-on-linux)", ok: (o) => +o.trim() >= 7 },
  ] },
  { id: "docker", title: "Containers", skill: "env-local", evidence: (_r, files) => has(files, /(^|\/)(Dockerfile[^/]*|(docker-)?compose\.ya?ml|\.dockerignore)$/), checks: [
    { what: "docker", cmd: ["docker", "version", "--format", "{{.Server.Version}}"], fix: "install Docker Desktop (Windows/macOS) or docker-ce (Linux) and start the daemon" },
  ] },
  { id: "gcp", title: "Google Cloud", skill: "env-gcp", evidence: (root, files) => [...has(files, /(^|\/)(app\.ya?ml|cloudbuild\.ya?ml|\.gcloudignore|firebase\.json|service\.ya?ml|skaffold\.ya?ml)$/), ...grepFiles(root, files, /(^|\/)(package\.json|requirements[^/]*\.txt|pyproject\.toml|go\.mod)$/, /google-cloud|@google-cloud\/|functions-framework|firebase-admin|cloud\.google\.com\/go/)], checks: [
    { what: "gcloud CLI", cmd: ["gcloud", "--version"], fix: "install the Google Cloud CLI: https://cloud.google.com/sdk/docs/install" },
    { what: "gcloud signed in", cmd: ["gcloud", "auth", "list", "--filter=status:ACTIVE", "--format=value(account)"], fix: "gcloud auth login && gcloud auth application-default login", ok: (o) => /@/.test(o) },
    { what: "gcloud project set", cmd: ["gcloud", "config", "get-value", "project"], fix: "gcloud config set project <project-id>", ok: (o) => /\w/.test(o) && !/unset/.test(o) },
  ] },
  { id: "aws-lambda", title: "AWS Lambda", skill: "env-aws-lambda", evidence: (root, files) => [...has(files, /(^|\/)(serverless\.ya?ml|samconfig\.toml|cdk\.json|template\.ya?ml)$/).filter((f) => !/template\.ya?ml$/.test(f) || /AWS::Serverless|AWS::Lambda/.test(read(root, f))), ...grepFiles(root, files, /(^|\/)(package\.json|requirements[^/]*\.txt|pyproject\.toml|go\.mod)$/, /aws-lambda|@aws-sdk\/|aws-cdk|boto3|aws-lambda-go|mangum/)], checks: [
    { what: "aws CLI", cmd: ["aws", "--version"], fix: "install AWS CLI v2: https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html" },
    { what: "aws credentials", cmd: ["aws", "sts", "get-caller-identity", "--query", "Account", "--output", "text"], fix: "aws configure sso   (or: aws configure)", ok: (o) => /^\d{12}/.test(o.trim()) },
  ] },
  { id: "modal", title: "Modal", skill: "env-modal", evidence: (root, files) => grepFiles(root, files, /\.py$|(^|\/)(requirements[^/]*\.txt|pyproject\.toml)$/, /^\s*import modal\b|^\s*from modal\b|modal\.App\(|^modal[=>~ ]|"modal[=>~"]/m), checks: [
    { what: "modal CLI", cmd: ["modal", "--version"], fix: "pip install modal   (or: uv tool install modal)" },
    { what: "modal token", cmd: ["modal", "profile", "current"], fix: "modal setup", ok: (o) => /\w/.test(o) },
  ] },
];

function read(root: string, f: string) { try { return fs.readFileSync(path.join(root, f), "utf8").slice(0, 20000); } catch { return ""; } }

export function detectEnvironments(root: string, files: string[], forced: string[] = []): { id: string; title: string; skill: string; evidence: string[] }[] {
  return ENVIRONMENTS.map((e) => ({ id: e.id, title: e.title, skill: e.skill, evidence: forced.includes(e.id) ? ["profile: always on"] : e.evidence(root, files) }))
    .filter((e) => e.evidence.length);
}

/** Run each environment's checks. Never throws; a missing tool is a failed check with its fix. */
export function preflight(ids: string[], cwd: string): { env: string; what: string; ok: boolean; fix: string }[] {
  const out: { env: string; what: string; ok: boolean; fix: string }[] = [];
  for (const e of ENVIRONMENTS.filter((x) => ids.includes(x.id))) for (const c of e.checks) {
    const r = spawnSync(c.cmd[0], c.cmd.slice(1), { cwd, encoding: "utf8", timeout: 15000, shell: process.platform === "win32" });
    const ok = !r.error && r.status === 0 && (c.ok ? c.ok(r.stdout || "") : true);
    out.push({ env: e.id, what: c.what, ok, fix: c.fix });
  }
  return out;
}
