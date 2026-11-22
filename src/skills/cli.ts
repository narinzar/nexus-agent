import { Skills } from "./index.ts";

export async function skillsCli(root: string, args: string[]) {
  const s = new Skills(root);
  const [sub = "list", name, ...rest] = args;
  if (sub === "list") console.log(s.list.map((k) => `${k.name.padEnd(24)} [${k.source}] ${k.description.slice(0, 110)}`).join("\n") || "no skills found");
  else if (sub === "show") console.log(s.load(name) ?? `no skill "${name}"`);
  else if (sub === "new") console.log(`created ${s.create(name, rest.join(" "))}`);
  else if (sub === "install") console.log(s.install(name));
  else console.log("usage: nexus skills [list | show <name> | new <name> [description] | install <path|git-url>]");
}
