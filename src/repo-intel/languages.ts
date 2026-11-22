// Language registry: file extension / name -> language id and family. Extend here (or via config) to add languages.

export interface LangInfo { id: string; family: "c-like" | "python" | "ruby" | "markup" | "config" | "style" | "shell" | "sql" | "doc" | "other"; test?: RegExp }

const L = (id: string, family: LangInfo["family"], test?: RegExp): LangInfo => ({ id, family, test });

const BY_EXT: Record<string, LangInfo> = {
  py: L("python", "python", /(^|\/)(test_[^/]+|[^/]+_test)\.py$|(^|\/)tests?\//), pyi: L("python", "python"),
  js: L("javascript", "c-like", /\.(test|spec)\.[cm]?jsx?$|__tests__\//), mjs: L("javascript", "c-like"), cjs: L("javascript", "c-like"), jsx: L("javascript", "c-like", /\.(test|spec)\.jsx$/),
  ts: L("typescript", "c-like", /\.(test|spec)\.[cm]?tsx?$|__tests__\//), mts: L("typescript", "c-like"), cts: L("typescript", "c-like"), tsx: L("tsx", "c-like", /\.(test|spec)\.tsx$/),
  go: L("go", "c-like", /_test\.go$/), rs: L("rust", "c-like", /(^|\/)tests\/.*\.rs$/),
  java: L("java", "c-like", /(^|\/)src\/test\/|Test\.java$/), kt: L("kotlin", "c-like", /(^|\/)src\/test\/|Test\.kt$/), kts: L("kotlin", "c-like"),
  scala: L("scala", "c-like", /(^|\/)src\/test\//), groovy: L("groovy", "c-like"),
  cs: L("csharp", "c-like", /Tests?\.cs$|(^|\/)[^/]*\.Tests?\//), fs: L("fsharp", "other"), vb: L("vbnet", "other"),
  c: L("c", "c-like", /(^|\/)tests?\//), h: L("c", "c-like"), cc: L("cpp", "c-like", /(^|\/)tests?\//), cpp: L("cpp", "c-like", /(^|\/)tests?\//), cxx: L("cpp", "c-like"), hpp: L("cpp", "c-like"), hh: L("cpp", "c-like"), hxx: L("cpp", "c-like"), m: L("objc", "c-like"), mm: L("objc", "c-like"),
  swift: L("swift", "c-like", /Tests?\.swift$|(^|\/)Tests\//), dart: L("dart", "c-like", /_test\.dart$/),
  php: L("php", "c-like", /Test\.php$|(^|\/)tests\//), rb: L("ruby", "ruby", /_(test|spec)\.rb$|(^|\/)(test|spec)\//), rake: L("ruby", "ruby"),
  zig: L("zig", "c-like"), lua: L("lua", "other"), ex: L("elixir", "other"), exs: L("elixir", "other", /_test\.exs$/), erl: L("erlang", "other"),
  hs: L("haskell", "other"), ml: L("ocaml", "other"), clj: L("clojure", "other"), r: L("r", "other"), jl: L("julia", "other"), nim: L("nim", "other"),
  gd: L("gdscript", "python"), cshtml: L("razor", "markup"),
  sol: L("solidity", "c-like"), proto: L("protobuf", "c-like"), graphql: L("graphql", "other"), gql: L("graphql", "other"),
  sh: L("shell", "shell"), bash: L("shell", "shell"), zsh: L("shell", "shell"), ps1: L("powershell", "shell"), bat: L("batch", "shell"), cmd: L("batch", "shell"),
  sql: L("sql", "sql"),
  tf: L("hcl", "config"), tfvars: L("hcl", "config"), hcl: L("hcl", "config"),
  yaml: L("yaml", "config"), yml: L("yaml", "config"), toml: L("toml", "config"), ini: L("ini", "config"), json: L("json", "config"), jsonc: L("json", "config"), xml: L("xml", "markup"), gradle: L("groovy", "c-like"),
  css: L("css", "style"), scss: L("scss", "style"), sass: L("sass", "style"), less: L("less", "style"),
  html: L("html", "markup"), htm: L("html", "markup"), vue: L("vue", "markup"), svelte: L("svelte", "markup"), astro: L("astro", "markup"),
  md: L("markdown", "doc"), mdx: L("markdown", "doc"), rst: L("rst", "doc"), adoc: L("asciidoc", "doc"),
  tscn: L("godot-scene", "config"), tres: L("godot-resource", "config"), uproject: L("json", "config"), uplugin: L("json", "config"),
};
const BY_NAME: Record<string, LangInfo> = {
  dockerfile: L("dockerfile", "config"), "containerfile": L("dockerfile", "config"), makefile: L("make", "config"), gnumakefile: L("make", "config"),
  "cmakelists.txt": L("cmake", "config"), "build.bazel": L("starlark", "python"), "build": L("starlark", "python"), "workspace": L("starlark", "python"),
  gemfile: L("ruby", "ruby"), rakefile: L("ruby", "ruby"), jenkinsfile: L("groovy", "c-like"), "justfile": L("make", "config"), "procfile": L("config", "config"),
};

export function langOf(path: string): LangInfo | null {
  const base = path.split("/").pop()!.toLowerCase();
  if (BY_NAME[base]) return BY_NAME[base];
  if (base.startsWith("dockerfile")) return BY_NAME.dockerfile;
  const ext = base.includes(".") ? base.split(".").pop()! : "";
  return BY_EXT[ext] || null;
}
export const isTestPath = (path: string, info = langOf(path)) => !!(info?.test && info.test.test(path)) || /(^|\/)(tests?|spec|__tests__)\//.test(path);
/** Languages whose files are "code" for ranking and language statistics (configs and docs are indexed but not counted). */
export const isCodeLang = (info: LangInfo | null) => !!info && !["config", "doc", "markup", "style"].includes(info.family) || info?.id === "vue" || info?.id === "svelte";
