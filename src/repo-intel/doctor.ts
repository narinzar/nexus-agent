// doctor: what intelligence is active for this repo, and which upgrades are available or missing.
import { execFileSync } from "node:child_process";
import type { Repo } from "./repo.ts";
import { treeSitterProvider } from "./treesitter.ts";
import { heuristicProvider } from "./heuristic/index.ts";

const which = (bin: string) => { try { execFileSync("sh", ["-c", `command -v ${bin}`], { stdio: "pipe" }); return true; } catch { return false; } };
const LSP: Record<string, string[]> = { python: ["pyright-langserver", "pylsp", "basedpyright"], typescript: ["typescript-language-server"], javascript: ["typescript-language-server"], tsx: ["typescript-language-server"], go: ["gopls"], rust: ["rust-analyzer"], c: ["clangd"], cpp: ["clangd"], java: ["jdtls"], kotlin: ["kotlin-language-server"], csharp: ["csharp-ls", "OmniSharp"], ruby: ["ruby-lsp", "solargraph"], php: ["intelephense", "phpactor"], zig: ["zls"], hcl: ["terraform-ls"], lua: ["lua-language-server"], swift: ["sourcekit-lsp"], dart: ["dart"], gdscript: ["godot"] };
const SCIP: Record<string, string> = { typescript: "scip-typescript", javascript: "scip-typescript", python: "scip-python", java: "scip-java", kotlin: "scip-java", go: "scip-go", rust: "rust-analyzer", c: "scip-clang", cpp: "scip-clang", ruby: "scip-ruby", csharp: "scip-dotnet" };

export async function doctor(repo: Repo): Promise<string> {
  const s = repo.stats();
  const ts = new Set(treeSitterProvider.languages()), he = new Set(heuristicProvider.languages());
  const o = [`index: ${s.files} files, ${s.symbols} symbols, ${s.resolved}/${s.imports} imports resolved`];
  o.push(`tree-sitter: ${ts.size ? `active (${[...ts].join(", ")})` : "not installed (npm i @vscode/tree-sitter-wasm for syntactic precision)"}`);
  o.push(`text search: ${which("rg") ? "ripgrep" : "built-in (install ripgrep for speed)"}`);
  o.push("language coverage:");
  for (const l of s.byLang) {
    const level = ts.has(l.lang) ? "syntactic (tree-sitter)" : he.has(l.lang) ? "heuristic" : "files only";
    const lsp = (LSP[l.lang] || []).find(which); const scip = SCIP[l.lang] && which(SCIP[l.lang]) ? SCIP[l.lang] : null;
    const up = [lsp && `LSP ${lsp} found (precise layer: roadmap stage 3)`, scip && `SCIP ${scip} found`, !lsp && LSP[l.lang] && `install ${LSP[l.lang][0]} for semantic precision`].filter(Boolean).join("; ");
    o.push(`  ${l.lang.padEnd(14)} ${String(l.n).padStart(6)} files  ${level}${up ? "  | " + up : ""}`);
  }
  const p = repo.profile();
  o.push(`build systems: ${p.buildSystems.map((b) => `${b.id}@${b.dir} {${Object.keys(b.commands).join(",")}}`).join("; ") || "none detected"}`);
  for (const b of p.buildSystems) { const tool = { npm: "npm", python: "python3", go: "go", cargo: "cargo", maven: "mvn", gradle: "gradle", dotnet: "dotnet", cmake: "cmake", make: "make", composer: "composer", bundler: "bundle", dart: "dart", swiftpm: "swift", zig: "zig", terraform: "terraform", docker: "docker", helm: "helm" }[b.id]; if (tool && !which(tool) && !(b.id === "gradle" && b.commands.build?.startsWith(`${b.dir === "." ? "" : `cd ${b.dir} && `}./gradlew`))) o.push(`  missing toolchain: ${tool} (needed to build/test ${b.manifest})`); }
  return o.join("\n");
}
