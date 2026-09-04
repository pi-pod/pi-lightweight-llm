import assert from "node:assert/strict";
import { test } from "node:test";
import { parseSettings } from "../src/settings.ts";
import { cleanSummary, nextMode, summaryInput, summaryKey, WorkQueue, type ToolSnapshot } from "../src/summary.ts";

const tool: ToolSnapshot = { toolCallId: "a", toolName: "bash", args: { command: "ls" }, result: { content: [{ type: "text", text: "file.ts" }] } };

test("settings merge and validate independently of agent settings", () => {
  assert.equal(parseSettings({}, {}), undefined);
  assert.deepEqual(parseSettings({ defaultModel: "big", lightweightTasks: { provider: "p", model: "small", thinkingLevel: "high" } },
    { lightweightTasks: { thinkingLevel: "off" } }), { provider: "p", model: "small", thinkingLevel: "off" });
  assert.equal(parseSettings({ lightweightTasks: { provider: "p", model: "m" } }, {})?.thinkingLevel, "off");
  for (const config of [null, [], { model: "m" }, { provider: "p", model: "m", thinkingLevel: "typo" }]) {
    assert.throws(() => parseSettings({ lightweightTasks: config }, {}));
  }
});

test("three modes cycle in the requested order", () => {
  assert.equal(nextMode("compact"), "verbose");
  assert.equal(nextMode("verbose"), "summary");
  assert.equal(nextMode("summary"), "compact");
});

test("summaries strictly under 1000 chars, safe Unicode and terminal output", () => {
  for (const text of ["a".repeat(1000), "😀".repeat(1000), "a".repeat(997) + "😀xyz"]) {
    const summary = cleanSummary(text);
    assert.ok(summary.length < 1000);
    assert.equal(Buffer.from(summary).toString("utf8"), summary);
  }
  assert.equal(cleanSummary("\x1b[31mhello\x1b[0m\x07"), "hello");
});

test("input is bounded, preserves error/tail, omits image data; cache detects changed output", () => {
  const big: ToolSnapshot = { ...tool, result: { isError: true, content: [
    { type: "text", text: "start" + "x".repeat(50000) + "end" },
    { type: "image", mimeType: "image/png", ...{ data: "secret-image-data" } },
  ] } };
  const input = summaryInput(big);
  assert.ok(input.length < 25000);
  assert.ok(input.includes("start") && input.includes("end") && input.includes("truncated"));
  assert.ok(input.includes('"isError":true'));
  assert.ok(!input.includes("secret-image-data"));
  assert.equal(summaryKey(tool), summaryKey(structuredClone(tool)));
  assert.notEqual(summaryKey(tool), summaryKey(big));
});

test("queue is serial, recovers from failures, and cancels queued work", async () => {
  const queue = new WorkQueue();
  const order: number[] = [];
  queue.add(async () => { order.push(1); throw new Error("test"); }, () => order.push(2));
  queue.add(async () => { order.push(3); }, error => assert.fail(String(error)));
  await queue.settled();
  assert.deepEqual(order, [1, 2, 3]);
  queue.add(async () => { order.push(4); }, error => assert.fail(String(error)));
  queue.stop();
  await queue.settled();
  assert.deepEqual(order, [1, 2, 3]);
});
