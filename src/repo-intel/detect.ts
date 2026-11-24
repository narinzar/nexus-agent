// Project profile: languages, build systems, commands, entry points, tests, docs, frameworks.
// Table-driven so new ecosystems are one entry, not new code paths.
import fs from "node:fs";
import path from "node:path";
import { langOf, isCodeLang, isTestPath } from "./languages.ts";

export interface BuildSystem { id: string; manifest: string; dir: string; commands: Partial<Record<"build" | "test" | "lint" | "typecheck" | "run" | "format", string>> }
export interface Profile {
  root: string;
  languages: { id: string; files: number }[];
  buildSystems: BuildSystem[];
  frameworks: string[];
  entryPoints: string[];
  testDirs: string[];
  docs: string[];
  instructions: string[]; // AGENTS.md, CLAUDE.md, CONTRIBUTING.md ...
  ci: string[];
}

/** Python tools run inside the project's environment when a lockfile says which manager owns it. */
const pyRunner = (root: string, d: string) => { const at = (f: string) => fs.existsSync(path.join(root, d, f)); return at("uv.lock") ? "uv run " : at("poetry.lock") ? "poetry run " : at("Pipfile.lock") ? "pipenv run " : ""; };

/** Commands from a task runner's own targets (Makefile, justfile): the project's declared way to run each check. */
const TARGETS: [keyof BuildSystem["commands"], string[]][] = [["build", ["build"]], ["test", ["test", "tests", "check"]], ["lint", ["lint"]], ["typecheck", ["typecheck", "type-check", "types", "mypy", "tsc"]], ["format", ["format", "fmt"]], ["run", ["run", "start", "dev", "serve"]]];
function runnerTargets(text: string, prefix: string, allIsBuild: boolean): BuildSystem["commands"] {
  const has = (t: string) => new RegExp(`^${t.replace(/-/g, "\\-")}\\s*:(?!=)`, "m").test(text);
  const out: BuildSystem["commands"] = {};
  for (const [kind, names] of TARGETS) { const n = names.find(has); if (n) out[kind] = prefix + n; }
  if (!out.build && allIsBuild && has("all")) out.build = prefix.trimEnd();
  return out;
}

type Rule = { id: string; match: RegExp; commands: (dir: string, text: string, root: string) => BuildSystem["commands"]; frameworks?: (text: string) => string[] };
const pre = (dir: string) => (dir === "." ? "" : `cd ${dir} && `);
const npmScripts = (dir: string, text: string, root: string): BuildSystem["commands"] => {
  let s: Record<string, string> = {}; try { s = JSON.parse(text).scripts || {}; } catch {}
  const run = (k: string) => `${pre(dir)}npm run ${k}`;
  return {
    build: s.build ? run("build") : undefined,
    test: s.test && !/no test specified/.test(s.test) ? `${pre(dir)}npm test` : undefined,
    lint: s.lint ? run("lint") : undefined,
    typecheck: s.typecheck ? run("typecheck") : s["type-check"] ? run("type-check") : s.tsc ? run("tsc") : fs.existsSync(path.join(root, dir, "tsconfig.json")) ? `${pre(dir)}npx tsc --noEmit` : undefined,
    run: s.start ? run("start") : s.dev ? run("dev") : undefined,
  };
};
const RULES: Rule[] = [
  { id: "npm", match: /(^|\/)package\.json$/, commands: npmScripts, frameworks: (t) => { const d = (() => { try { const j = JSON.parse(t); return { ...j.dependencies, ...j.devDependencies }; } catch { return {}; } })(); return ["next", "react", "vue", "svelte", "@angular/core", "express", "fastify", "@nestjs/core", "electron", "react-native", "expo", "vite", "jest", "vitest", "mocha", "playwright", "@playwright/test", "three"].filter((k) => d[k]).map((k) => k.replace(/^@[^/]+\//, "").replace("core", "angular")); } },
  { id: "python", match: /(^|\/)(pyproject\.toml|setup\.py|setup\.cfg|requirements[^/]*\.txt|Pipfile)$/, commands: (d, t, root) => { const x = pre(d) + pyRunner(root, d); return { test: `${x}${x.endsWith("run ") ? "pytest -q" : "python3 -m pytest -q"}`, lint: /ruff/.test(t) ? `${x}ruff check .` : undefined, typecheck: /mypy/.test(t) ? `${x}mypy .` : /pyright/.test(t) ? `${x}pyright` : undefined }; }, frameworks: (t) => ["django", "flask", "fastapi", "pytest", "numpy", "pandas", "torch", "tensorflow", "scikit-learn", "langchain", "pydantic", "sqlalchemy", "celery"].filter((k) => new RegExp(`\\b${k}\\b`, "i").test(t)) },
  { id: "go", match: /(^|\/)go\.mod$/, commands: (d) => ({ build: `${pre(d)}go build ./...`, test: `${pre(d)}go test ./...`, lint: `${pre(d)}go vet ./...` }), frameworks: (t) => ["gin-gonic/gin", "labstack/echo", "gofiber/fiber", "spf13/cobra", "grpc"].filter((k) => t.includes(k)).map((k) => k.split("/").pop()!) },
  { id: "cargo", match: /(^|\/)Cargo\.toml$/, commands: (d) => ({ build: `${pre(d)}cargo build`, test: `${pre(d)}cargo test`, lint: `${pre(d)}cargo clippy`, typecheck: `${pre(d)}cargo check` }), frameworks: (t) => ["tokio", "axum", "actix-web", "bevy", "tauri", "serde", "clap"].filter((k) => new RegExp(`^\\s*${k}\\s*=`, "m").test(t)) },
  { id: "maven", match: /(^|\/)pom\.xml$/, commands: (d) => ({ build: `${pre(d)}mvn -q package -DskipTests`, test: `${pre(d)}mvn -q test` }), frameworks: (t) => (/spring-boot/.test(t) ? ["spring-boot"] : []) },
  { id: "gradle", match: /(^|\/)build\.gradle(\.kts)?$/, commands: (d, _t, root) => { const w = fs.existsSync(path.join(root, d, "gradlew")) ? "./gradlew" : "gradle"; return { build: `${pre(d)}${w} build -x test`, test: `${pre(d)}${w} test` }; }, frameworks: (t) => [/com\.android/.test(t) && "android", /spring/.test(t) && "spring-boot", /kotlin/.test(t) && "kotlin"].filter(Boolean) as string[] },
  { id: "dotnet", match: /\.(sln|csproj|fsproj|vbproj)$/, commands: (d) => ({ build: `${pre(d)}dotnet build`, test: `${pre(d)}dotnet test` }), frameworks: (t) => [/Microsoft\.AspNetCore|Sdk\.Web/.test(t) && "aspnetcore", /Maui/.test(t) && "maui", /Unity/.test(t) && "unity"].filter(Boolean) as string[] },
  { id: "cmake", match: /(^|\/)CMakeLists\.txt$/, commands: (d) => ({ build: `${pre(d)}cmake -S . -B build && cmake --build build`, test: `${pre(d)}ctest --test-dir build` }) },
  { id: "make", match: /(^|\/)(GNU)?[Mm]akefile$/, commands: (d, t) => runnerTargets(t, `${pre(d)}make `, true) },
  { id: "just", match: /(^|\/)[Jj]ustfile$/, commands: (d, t) => runnerTargets(t, `${pre(d)}just `, false) },
  { id: "meson", match: /(^|\/)meson\.build$/, commands: (d) => ({ build: `${pre(d)}meson setup build && meson compile -C build`, test: `${pre(d)}meson test -C build` }) },
  { id: "bazel", match: /(^|\/)(MODULE\.bazel|WORKSPACE(\.bazel)?)$/, commands: (d) => ({ build: `${pre(d)}bazel build //...`, test: `${pre(d)}bazel test //...` }) },
  { id: "composer", match: /(^|\/)composer\.json$/, commands: (d, t) => ({ test: /phpunit/.test(t) ? `${pre(d)}vendor/bin/phpunit` : undefined }), frameworks: (t) => ["laravel", "symfony"].filter((k) => t.includes(k)) },
  { id: "bundler", match: /(^|\/)Gemfile$/, commands: (d, t) => ({ test: /rspec/.test(t) ? `${pre(d)}bundle exec rspec` : `${pre(d)}bundle exec rake test` }), frameworks: (t) => ["rails", "sinatra", "rspec"].filter((k) => t.includes(k)) },
  { id: "mix", match: /(^|\/)mix\.exs$/, commands: (d) => ({ build: `${pre(d)}mix compile`, test: `${pre(d)}mix test` }), frameworks: (t) => (/phoenix/.test(t) ? ["phoenix"] : []) },
  { id: "dart", match: /(^|\/)pubspec\.yaml$/, commands: (d, t) => ({ test: /flutter/.test(t) ? `${pre(d)}flutter test` : `${pre(d)}dart test`, lint: `${pre(d)}dart analyze` }), frameworks: (t) => (/flutter/.test(t) ? ["flutter"] : []) },
  { id: "swiftpm", match: /(^|\/)Package\.swift$/, commands: (d) => ({ build: `${pre(d)}swift build`, test: `${pre(d)}swift test` }) },
  { id: "xcode", match: /\.xcodeproj\/project\.pbxproj$/, commands: () => ({ build: "xcodebuild build" }) },
  { id: "zig", match: /(^|\/)build\.zig$/, commands: (d) => ({ build: `${pre(d)}zig build`, test: `${pre(d)}zig build test` }) },
  { id: "godot", match: /(^|\/)project\.godot$/, commands: () => ({}), frameworks: () => ["godot"] },
  { id: "unreal", match: /\.uproject$/, commands: () => ({}), frameworks: () => ["unreal"] },
  { id: "unity", match: /(^|\/)ProjectSettings\/ProjectVersion\.txt$/, commands: () => ({}), frameworks: () => ["unity"] },
  { id: "terraform", match: /(^|\/)(main|versions|providers)\.tf$/, commands: (d) => ({ lint: `${pre(d)}terraform validate`, format: `${pre(d)}terraform fmt -check` }), frameworks: () => ["terraform"] },
  { id: "docker", match: /(^|\/)(Dockerfile|Containerfile|docker-compose\.ya?ml|compose\.ya?ml)$/, commands: (d) => ({ build: `${pre(d)}docker build .` }), frameworks: () => ["docker"] },
  { id: "helm", match: /(^|\/)Chart\.yaml$/, commands: (d) => ({ lint: `${pre(d)}helm lint .` }), frameworks: () => ["helm", "kubernetes"] },
];
const ENTRY = /(^|\/)(main\.(go|rs|c|cc|cpp|py|kt|swift|dart|zig)|__main__\.py|manage\.py|app\.py|wsgi\.py|asgi\.py|server\.(js|ts|py|go)|index\.(js|ts|mjs)|Program\.cs|Main\.java|Application\.(java|kt)|lib\.rs|cli\.(py|ts|js|go))$/;

export function detectProfile(root: string, files: string[]): Profile {
  const langs: Record<string, number> = {};
  const p: Profile = { root, languages: [], buildSystems: [], frameworks: [], entryPoints: [], testDirs: [], docs: [], instructions: [], ci: [] };
  const fw = new Set<string>(), testDirs = new Set<string>();
  for (const f of files) {
    const info = langOf(f);
    if (isCodeLang(info)) langs[info!.id] = (langs[info!.id] || 0) + 1;
    for (const r of RULES) if (r.match.test(f) && f.split("/").length <= 4) {
      const dir = path.dirname(f); let text = ""; try { text = fs.readFileSync(path.join(root, f), "utf8").slice(0, 200_000); } catch {}
      const cmds = Object.fromEntries(Object.entries(r.commands(dir, text, root)).filter(([, v]) => v)) as BuildSystem["commands"];
      if (!p.buildSystems.some((b) => b.id === r.id && b.dir === dir)) p.buildSystems.push({ id: r.id, manifest: f, dir, commands: cmds });
      for (const x of r.frameworks?.(text) || []) fw.add(x);
    }
    if (ENTRY.test(f) && f.split("/").length <= 4) p.entryPoints.push(f);
    if (isTestPath(f, info) && isCodeLang(info)) { const m = f.match(/^(.*?(?:^|\/)(?:tests?|spec|__tests__|src\/test))\//); testDirs.add(m ? m[1] : path.dirname(f)); }
    if (/(^|\/)(README|ARCHITECTURE|DESIGN|CONTRIBUTING)[^/]*\.md$/i.test(f) || /^docs?\/.*\.(md|rst|adoc)$/.test(f)) p.docs.push(f);
    if (/(^|\/)(AGENTS|CLAUDE|GEMINI)\.md$|^\.github\/copilot-instructions\.md$|^\.cursorrules$|^\.clinerules/.test(f)) p.instructions.push(f);
    if (/^\.github\/workflows\/|^\.gitlab-ci\.yml$|^Jenkinsfile$|^\.circleci\/|^azure-pipelines\.yml$/.test(f)) p.ci.push(f);
  }
  const RUNNERS = ["make", "just"]; // declared commands (targets, scripts) beat guessed defaults in the same folder
  for (const r of p.buildSystems.filter((b) => RUNNERS.includes(b.id)))
    for (const other of p.buildSystems.filter((b) => b.dir === r.dir && !RUNNERS.includes(b.id)))
      for (const k of Object.keys(r.commands) as (keyof BuildSystem["commands"])[]) delete other.commands[k];
  p.languages = Object.entries(langs).sort((a, b) => b[1] - a[1]).map(([id, n]) => ({ id, files: n }));
  p.buildSystems.sort((a, b) => a.dir.split("/").length - b.dir.split("/").length);
  p.frameworks = [...fw];
  p.testDirs = [...testDirs].slice(0, 20);
  p.docs = p.docs.slice(0, 30);
  return p;
}

/** The commands to run for a given verification level, preferring the build system closest to the changed files. */
export function commandsFor(p: Profile, kind: keyof BuildSystem["commands"], near?: string[]): string[] {
  const out: string[] = [];
  const score = (b: BuildSystem) => (near || []).reduce((s, f) => s + (b.dir === "." || f.startsWith(b.dir + "/") ? b.dir.length + 1 : 0), 0);
  for (const b of [...p.buildSystems].sort((a, b) => score(b) - score(a))) { const c = b.commands[kind]; if (c && !out.includes(c)) { out.push(c); if (near?.length) break; } }
  return out;
}
