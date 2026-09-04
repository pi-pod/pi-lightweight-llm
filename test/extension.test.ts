import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import extension from "../src/index.ts";
import { summaryKey } from "../src/summary.ts";

test("background integration: selected model, immutable results, persistence, cached restore, shutdown race", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-lightweight-test-"));
  const oldDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  await writeFile(join(dir, "settings.json"), JSON.stringify({ lightweightTasks: { provider: "test", model: "small", thinkingLevel: "low" } }));
  const handlers = new Map<string, Function>();
  const entries: any[] = [];
  let resolve: (value: any) => void = () => {};
  let calls = 0;
  const pi = {
    on: (event: string, handler: Function) => handlers.set(event, handler),
    registerShortcut: () => {}, registerCommand: () => {},
    appendEntry: (customType: string, data: unknown) => entries.push({ type: "custom", customType, data }),
  } as unknown as ExtensionAPI;
  const ctx = {
    mode: "tui", cwd: dir, isProjectTrusted: () => false,
    ui: { getToolsExpanded: () => false, setStatus: () => {}, notify: () => {},
      getEditorComponent: () => undefined, setEditorComponent: () => {} },
    sessionManager: { getEntries: () => entries, getBranch: () => [] },
    modelRegistry: {
      find: (provider: string, id: string) => { assert.equal(provider, "test"); assert.equal(id, "small"); return { reasoning: true }; },
      hasConfiguredAuth: () => true,
      complete: (_model: unknown, _context: unknown, options: any) => {
        calls++; assert.equal(options.reasoningEffort, "low");
        return new Promise(r => { resolve = r; });
      },
    },
  } as unknown as ExtensionContext;
  const emit = (event: string, data = {}) => handlers.get(event)?.(data, ctx);
  const tick = () => new Promise(r => setImmediate(r));
  const response = { stopReason: "stop", content: [{ type: "text", text: "Summary" }], usage: {} };
  const result = { role: "toolResult", toolCallId: "a", toolName: "custom", content: [{ type: "text", text: "raw" }], isError: false };
  try {
    extension(pi);
    await emit("session_start");
    assert.equal(await emit("message_end", { message: result }), undefined);
    await tick();
    assert.equal(calls, 1);
    assert.equal(entries.length, 0); // Main agent did not wait for helper completion.
    resolve(response);
    await tick();
    assert.equal(entries[0].data.text, "Summary");
    assert.equal(result.content[0].text, "raw");
    assert.equal(entries[0].data.key, summaryKey({ ...result, args: {}, result }));
    await emit("message_end", { message: result });
    await tick();
    assert.equal(calls, 1);
    await emit("session_shutdown");
    extension(pi);
    await emit("session_start");
    await emit("message_end", { message: result });
    await tick();
    assert.equal(calls, 1); // Persisted cache restored.
    await emit("message_end", { message: { ...result, toolCallId: "b" } });
    await tick();
    assert.equal(calls, 2);
    await emit("session_shutdown");
    resolve(response); // Provider ignored cancellation: must not append stale data.
    await tick();
    assert.equal(entries.length, 1);
  } finally {
    await emit("session_shutdown");
    if (oldDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = oldDir;
    await rm(dir, { recursive: true, force: true });
  }
});
