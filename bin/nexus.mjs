#!/usr/bin/env node
// Entry shim: Node >= 22.18 runs the TypeScript sources directly (type stripping), no build step.
process.removeAllListeners("warning");
process.on("warning", (w) => { if (w.name !== "ExperimentalWarning") console.error(w.toString()); });
await import("../src/cli.ts");
