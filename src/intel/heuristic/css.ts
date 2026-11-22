// Dependency-free CSS / SCSS / Less reader: rules with selectors, at-rule context, declarations (with offsets for
// exact edits), top-level section comments, custom properties. Nested SCSS rules get their parent selector prefixed.

/** Parse into a flat list of rules. Throws on unbalanced braces (used by `check`). */
export function parseCss(src: string): { rules: any[]; comments: { text: string; line: number }[] } {
  const rules: any[] = [], comments: { text: string; line: number }[] = [];
  let i = 0, line = 1;
  const n = src.length;
  const adv = (to) => { for (; i < to; i++) if (src[i] === "\n") line++; };
  function skipWsComments(depth) {
    while (i < n) {
      if (/\s/.test(src[i])) { adv(i + 1); continue; }
      if (src[i] === "/" && src[i + 1] === "*") { const s = i, l = line; const e = src.indexOf("*/", i + 2); if (e < 0) throw err("unclosed comment", l); adv(e + 2); if (depth === 0) comments.push({ text: src.slice(s + 2, e).trim(), line: l }); continue; }
      if (src[i] === "/" && src[i + 1] === "/" ) { const e = src.indexOf("\n", i); adv(e < 0 ? n : e); continue; } // scss line comment
      break;
    }
  }
  const err = (msg: string, l: number) => Object.assign(new Error(`${msg} at line ${l}`), { line: l });
  // read prelude until { ; or } at paren depth 0, skipping strings
  function prelude() {
    const s = i; let p = 0;
    while (i < n) {
      const c = src[i];
      if (c === '"' || c === "'") { const e = src.indexOf(c, i + 1); adv(e < 0 ? n : e + 1); continue; }
      if (c === "(") p++; else if (c === ")") p--;
      else if (p === 0 && (c === "{" || c === ";" || c === "}")) break;
      if (c === "/" && src[i + 1] === "*") { const e = src.indexOf("*/", i + 2); adv(e < 0 ? n : e + 2); continue; }
      adv(i + 1);
    }
    return src.slice(s, i);
  }
  function block(ctx, parentSel, depth) {
    while (i < n) {
      skipWsComments(depth);
      if (i >= n) return;
      if (src[i] === "}") { if (depth === 0) throw err("unexpected }", line); adv(i + 1); return; }
      const startOff = i, startLine = line;
      const pre = prelude().trim();
      if (src[i] === ";" || src[i] === "}" || i >= n) { // declaration inside a block, or a statement at-rule (@import ...;)
        if (src[i] === ";") adv(i + 1);
        continue;
      }
      // src[i] === "{"
      const openOff = i; adv(i + 1);
      if (pre.startsWith("@")) {
        const name = pre.slice(1).split(/[\s(]/)[0].toLowerCase();
        if (/^(media|supports|layer|container|document|scope)$/.test(name)) { block([...ctx, pre.replace(/\s+/g, " ")], parentSel, depth + 1); continue; }
        // keyframes, font-face, page...: skip the whole block
        skipBalanced(); continue;
      }
      // a rule: read its body, collecting declarations; nested rules (scss) recurse
      const sel = expandSel(pre.replace(/\s+/g, " "), parentSel);
      const rule: any = { sel, ctx: ctx.join(" "), line: startLine, start: startOff, open: openOff, decls: [], end: 0, close: 0 };
      rules.push(rule);
      while (i < n) {
        skipWsComments(depth + 1);
        if (src[i] === "}") { rule.close = i; rule.endLine = line; adv(i + 1); break; }
        const dStart = i, dLine = line;
        const d = prelude();
        if (src[i] === "{") { // nested rule
          i = dStart; line = dLine; // rewind and parse as a block entry
          
          
          blockOne(ctx, sel, depth + 1);
          continue;
        }
        const colon = d.indexOf(":");
        if (colon > 0) {
          const prop = d.slice(0, colon).trim();
          const rawVal = d.slice(colon + 1);
          const vOff = dStart + colon + 1 + (rawVal.length - rawVal.trimStart().length);
          rule.decls.push({ prop, value: rawVal.trim(), line: dLine, vStart: vOff, vEnd: vOff + rawVal.trim().length, hasSemi: src[i] === ";" });
        }
        if (src[i] === ";") adv(i + 1);
      }
      if (!rule.close) throw err(`unclosed rule "${sel.slice(0, 40)}"`, startLine);
    }
    if (depth > 0) throw err("unclosed block", line);
  }
  function blockOne(ctx, parentSel, depth) { // parse exactly one nested entry (rule or at-rule)
    const pre = prelude().trim(); const l = line;
    if (src[i] !== "{") { if (src[i] === ";") adv(i + 1); return; }
    const openOff = i; adv(i + 1);
    if (pre.startsWith("@")) { const name = pre.slice(1).split(/[\s(]/)[0]; if (/^(media|supports|layer|container)$/.test(name)) { innerBlock([...ctx, pre], parentSel, depth); } else skipBalanced(); return; }
    // reuse block() by faking: parse body as rule
    i = openOff; line = l; const save = i;
    // simple approach: treat as top-level rule inside current ctx
    const r: any = { sel: expandSel(pre.replace(/\s+/g, " "), parentSel), ctx: ctx.join(" "), line: l, start: save, open: openOff, decls: [], end: 0, close: 0 };
    adv(i + 1); rules.push(r);
    while (i < n) {
      skipWsComments(depth + 1);
      if (src[i] === "}") { r.close = i; r.endLine = line; adv(i + 1); return; }
      const dStart = i, dLine = line; const d = prelude();
      if (src[i] === "{") { i = dStart; line = dLine; blockOne(ctx, r.sel, depth + 1); continue; }
      const colon = d.indexOf(":");
      if (colon > 0) { const rawVal = d.slice(colon + 1); const vOff = dStart + colon + 1 + (rawVal.length - rawVal.trimStart().length); r.decls.push({ prop: d.slice(0, colon).trim(), value: rawVal.trim(), line: dLine, vStart: vOff, vEnd: vOff + rawVal.trim().length, hasSemi: src[i] === ";" }); }
      if (src[i] === ";") adv(i + 1);
    }
  }
  function innerBlock(ctx, parentSel, depth) { while (i < n) { skipWsComments(depth); if (src[i] === "}") { adv(i + 1); return; } blockOne(ctx, parentSel, depth); } }
  function skipBalanced() { let d = 1; while (i < n && d > 0) { const c = src[i]; if (c === '"' || c === "'") { const e = src.indexOf(c, i + 1); adv(e < 0 ? n : e + 1); continue; } if (c === "{") d++; else if (c === "}") d--; adv(i + 1); } }
  block([], "", 0);
  for (const r of rules) r.end = r.endLine ?? r.line;
  return { rules, comments };
}

function expandSel(sel: string, parent: string): string {
  if (!parent) return sel;
  return sel.split(",").map((s) => s.trim()).map((s) => (s.includes("&") ? s.replace(/&/g, parent) : `${parent} ${s}`)).join(", ");
}

