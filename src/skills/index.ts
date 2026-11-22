// Skill Engine: open Agent Skills format (agentskills.io SKILL.md). Progressive disclosure:
//   level 1 catalogue (name + description, a few hundred tokens) is always in the cacheable prefix;
//   level 2 SKILL.md body is loaded when the model asks (@skill name) or when the task clearly matches;
//   level 3 references/scripts are read or executed on demand (paths are listed, contents never preloaded).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { words, stem } from "../repo-intel/locate.ts";

export interface Skill { name: string; description: string; dir: string; source: string; meta: Record<string, string> }
const BUILTIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../skills");

export function parseFrontmatter(text: string): { meta: Record<string, string>; body: string } {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: text };
  const meta: Record<string, string> = {}; let key = "";
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^([\w-]+):\s*(.*)$/);
    if (kv) { key = kv[1]; meta[key] = kv[2].replace(/^["']|["']$/g, ""); } else if (key && /^\s+/.test(line)) meta[key] += " " + line.trim();
  }
  return { meta, body: m[2] };
}

export class Skills {
  root: string; list: Skill[] = [];
  constructor(root: string, extraDirs: string[] = []) {
    this.root = root;
    const dirs = [path.join(root, ".nexus/skills"), path.join(root, ".agents/skills"), path.join(root, ".claude/skills"), path.join(root, ".github/skills"), path.join(os.homedir(), ".nexus/skills"), ...extraDirs, BUILTIN];
    const seen = new Set<string>();
    for (const d of dirs) {
      let ents: fs.Dirent[] = []; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
      for (const e of ents) {
        const f = path.join(d, e.name, "SKILL.md"); if (!e.isDirectory() || !fs.existsSync(f)) continue;
        const { meta } = parseFrontmatter(fs.readFileSync(f, "utf8"));
        const name = meta.name || e.name; if (seen.has(name)) continue; // first source wins: repo overrides user overrides built-in
        seen.add(name); this.list.push({ name, description: meta.description || "", dir: path.join(d, e.name), source: d === BUILTIN ? "builtin" : path.relative(root, d) || d, meta });
      }
    }
  }
  /** Level 1: compact catalogue, with skills relevant to the task marked. */
  catalogue(task = ""): string {
    if (!this.list.length) return "";
    const tw = new Set(words(task).map(stem));
    const rel = (s: Skill) => words(`${s.name} ${s.description}`).map(stem).filter((w) => tw.has(w)).length;
    const lines = this.list.map((s) => `- ${s.name}: ${s.description.slice(0, 220)}${rel(s) >= 2 ? "  [likely relevant]" : ""}`);
    return `Load a skill's full instructions with @skill <name> only when it applies.\n${lines.join("\n")}`;
  }
  /** Level 2: SKILL.md body plus a listing (not contents) of its resources. */
  load(name: string): string | null {
    const s = this.list.find((x) => x.name === name); if (!s) return null;
    const { body } = parseFrontmatter(fs.readFileSync(path.join(s.dir, "SKILL.md"), "utf8"));
    const res: string[] = [];
    for (const sub of ["references", "scripts", "assets"]) { try { for (const f of fs.readdirSync(path.join(s.dir, sub))) res.push(path.relative(this.root, path.join(s.dir, sub, f))); } catch {} }
    return body.trim() + (res.length ? `\n\nResources (read with @show, run with @run; not preloaded):\n${res.map((r) => `- ${r}`).join("\n")}` : "");
  }
  create(name: string, description: string): string {
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(name)) throw new Error("skill names: lowercase letters, digits and hyphens, max 64 characters");
    const dir = path.join(this.root, ".nexus/skills", name);
    fs.mkdirSync(path.join(dir, "references"), { recursive: true });
    fs.writeFileSync(path.join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: ${description || "TODO: what this skill does and when to use it (third person, under 1024 characters)."}\n---\n\n# ${name}\n\n## When to use\n\n## Procedure\n1. \n\n## Checks\n- \n`);
    return dir;
  }
  install(src: string): string {
    const isGit = /^(https?:\/\/|git@)/.test(src);
    const tmp = isGit ? fs.mkdtempSync(path.join(os.tmpdir(), "nexus-skill-")) : src;
    if (isGit) { execFileSync("git", ["clone", "--depth", "1", src, tmp], { stdio: "pipe" }); }
    const found: string[] = [];
    const walk = (d: string, depth = 0) => { if (depth > 3) return; for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (e.name.startsWith(".")) continue; const p = path.join(d, e.name); if (e.isDirectory()) { if (fs.existsSync(path.join(p, "SKILL.md"))) found.push(p); else walk(p, depth + 1); } } };
    if (fs.existsSync(path.join(tmp, "SKILL.md"))) found.push(tmp); else walk(tmp);
    for (const d of found) fs.cpSync(d, path.join(this.root, ".nexus/skills", path.basename(d) === path.basename(tmp) && isGit ? path.basename(src).replace(/\.git$/, "") : path.basename(d)), { recursive: true });
    return found.length ? `installed ${found.length} skill(s): ${found.map((d) => path.basename(d)).join(", ")}` : "no SKILL.md found";
  }
}
