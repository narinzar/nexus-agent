// Personal profile: the owner's own working rules, applied to every repository the factory sets up.
// Lives outside any repository (~/.nexus/profile.json) so personal rules never have to be committed to shared projects.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface PersonalProfile {
  git: {
    name?: string; email?: string;
    /** reject commit messages carrying tool or AI attribution trailers (Co-Authored-By an AI, "Generated with", session links) */
    forbidAttribution: boolean;
    /** small changes may go straight to the default branch; big or risky ones use a branch (and a pull request only when asked) */
    smallChangesToMain: boolean;
    /** pull --rebase, then the project's checks must pass before every push */
    checkBeforePush: boolean;
    neverMergeUnasked: boolean;
    neverForcePushMain: boolean;
  };
  /** instruction files to render: agents (AGENTS.md, always), claude, cursor, copilot, gemini */
  agents: string[];
  /** environments to add even when nothing in the repository shows them (e.g. ["wsl", "powershell"]) */
  environments: string[];
  models: { build?: string };
  /** extra rules, one sentence each, added to every repository's non-negotiables */
  rules: string[];
}

export const DEFAULT_PROFILE: PersonalProfile = {
  git: { forbidAttribution: true, smallChangesToMain: true, checkBeforePush: true, neverMergeUnasked: true, neverForcePushMain: true },
  agents: ["agents", "claude"],
  environments: [],
  models: {},
  rules: ["Never paste or print tokens or secrets.", "Do not deploy to production unless the owner says so for that deploy."],
};

export const profilePath = () => process.env.NEXUS_PROFILE || path.join(os.homedir(), ".nexus", "profile.json");

export function loadProfile(): PersonalProfile {
  let saved: any = {};
  try { saved = JSON.parse(fs.readFileSync(profilePath(), "utf8")); } catch {}
  return { ...DEFAULT_PROFILE, ...saved, git: { ...DEFAULT_PROFILE.git, ...(saved.git || {}) }, models: { ...DEFAULT_PROFILE.models, ...(saved.models || {}) } };
}

export function saveProfile(p: PersonalProfile) {
  fs.mkdirSync(path.dirname(profilePath()), { recursive: true });
  fs.writeFileSync(profilePath(), JSON.stringify(p, null, 2) + "\n");
}

/** `nexus profile set git.name narinzar`, `set agents claude,cursor`, `add rules "..."` */
export function setKey(p: any, key: string, value: string, append = false) {
  const parts = key.split("."); let o = p;
  for (const k of parts.slice(0, -1)) o = o[k] ??= {};
  const last = parts.at(-1)!, cur = o[last];
  const parsed = value === "true" ? true : value === "false" ? false : Array.isArray(cur) && !append ? value.split(",").map((s) => s.trim()).filter(Boolean) : value;
  if (append) { if (!Array.isArray(cur)) throw new Error(`${key} is not a list`); cur.push(value); } else o[last] = parsed;
}

/** The profile's rules as instruction-file bullets. */
export function personalRules(p: PersonalProfile): string[] {
  const g = p.git, r: string[] = [];
  if (g.name && g.email) r.push(`Commits are authored and committed only as \`${g.name} <${g.email}>\`.`);
  if (g.forbidAttribution) r.push("Never add `Co-Authored-By`, session links, \"Generated with\" or any other attribution line for any AI tool, and no tool or AI names in branch names, commit messages or pull request descriptions. This overrides tool defaults.");
  if (g.smallChangesToMain) r.push("Small changes may go straight to the default branch. Use a branch for big or risky work (restructuring, shared styles, infrastructure); open a pull request only when asked.");
  if (g.checkBeforePush) r.push("Before every push: `git pull --rebase`, then the checks under Commands must pass.");
  if (g.neverMergeUnasked) r.push("Never merge a pull request unless asked for that specific pull request, and only with green CI and no conflict.");
  if (g.neverForcePushMain) r.push("Never force-push the default branch.");
  return [...r, ...p.rules];
}

/** Lines a commit-msg hook rejects when forbidAttribution is on. */
export const ATTRIBUTION_RE = /^(co-authored-by:.*(claude|anthropic|copilot|openai|chatgpt|gpt|gemini|cursor|codeium|windsurf|devin|\bai\b|bot@|noreply@anthropic)|claude-session:|.*generated (with|by) .*(claude|copilot|chatgpt|ai\b|codex|cursor|gemini))/im;

/** User-level instruction files the profile is written to (read by the agent in every repository; never committed). */
export function userInstructionFiles(p: PersonalProfile): string[] {
  const h = os.homedir(), out: string[] = [];
  if (p.agents.includes("claude")) out.push(path.join(h, ".claude", "CLAUDE.md"));
  if (p.agents.includes("agents") || p.agents.includes("codex")) out.push(path.join(h, ".codex", "AGENTS.md"));
  if (p.agents.includes("gemini")) out.push(path.join(h, ".gemini", "GEMINI.md"));
  return out;
}

const PB = "<!-- nexus-profile:begin (managed by `nexus profile apply`) -->", PE = "<!-- nexus-profile:end -->";

/** `nexus profile apply`: write the personal rules into the user-level instruction files, inside a managed block. */
export function applyProfile(p: PersonalProfile, dry = false): string[] {
  const block = [PB, "## Personal rules (all repositories)", "", ...personalRules(p).map((r) => `- ${r}`), PE].join("\n");
  const changed: string[] = [];
  for (const f of userInstructionFiles(p)) {
    const before = fs.existsSync(f) ? fs.readFileSync(f, "utf8") : "";
    const i = before.indexOf(PB), j = before.indexOf(PE);
    const after = i >= 0 && j > i ? before.slice(0, i) + block + before.slice(j + PE.length) : before.replace(/\s*$/, before ? "\n\n" : "") + block + "\n";
    if (after === before) continue;
    changed.push(f);
    if (!dry) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, after); }
  }
  return changed;
}
