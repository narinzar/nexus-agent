import { test } from "node:test";
import assert from "node:assert/strict";

test("savings labels in the benchmark chart", async () => {
  const { saving } = await import("../src/benchmark/report.ts");
  assert.equal(saving("fewer", 214.8, 5.8), "37× fewer");
  assert.equal(saving("cheaper", 0.174, 0.033), "81% cheaper");
  assert.equal(saving("faster", 17, 8), "2.1× faster");
  assert.equal(saving("faster", 62, 66), "about the same");
  assert.equal(saving("faster", 50, 80), "60% slower");
});
