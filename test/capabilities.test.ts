import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ToolExecutionComponent,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import extension from "../src/index.ts";

test("capability activation gates work AND UI; live disabling cancels pending writes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-capabilities-"));
  const oldDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  const nativeRender = ToolExecutionComponent.prototype.render;
  const handlers = new Map<string, Function>();
  const commands = new Map<string, any>();
  let editor: unknown;
  let calls = 0;
  let writes = 0;
  let resolve: (value: any) => void = () => {};
  const pi = {
    on: (event: string, handler: Function) => handlers.set(event, handler),
    registerCommand: (name: string, command: unknown) =>
      commands.set(name, command),
    appendEntry: () => writes++,
  } as unknown as ExtensionAPI;
  const ctx = {
    mode: "tui",
    hasUI: true,
    cwd: dir,
    isProjectTrusted: () => false,
    ui: {
      getToolsExpanded: () => false,
      getEditorComponent: () => editor,
      setEditorComponent: (value: unknown) => {
        editor = value;
      },
      setStatus: () => {},
      notify: () => {},
    },
    sessionManager: { getEntries: () => [], getBranch: () => [] },
    modelRegistry: {
      find: () => ({ reasoning: true }),
      hasConfiguredAuth: () => true,
      complete: () => {
        calls++;
        return new Promise((r) => {
          resolve = r;
        });
      },
    },
  } as unknown as ExtensionContext;
  const config = { provider: "test", model: "small", thinkingLevel: "off" };
  const save = (value: unknown) =>
    writeFile(
      join(dir, "settings.json"),
      JSON.stringify({ lightweightLlm: value }),
    );
  const emit = (name: string, event = {}) => handlers.get(name)?.(event, ctx);
  const tick = () => new Promise((r) => setImmediate(r));
  const message = {
    role: "toolResult",
    toolCallId: "a",
    toolName: "bash",
    content: [{ type: "text", text: "output" }],
    isError: false,
  };
  const reload = () => commands.get("lightweight-llm").handler("", ctx);
  try {
    extension(pi);
    for (const value of [
      {},
      { provider: "test", model: "small" },
      { ...config, model: null },
      { ...config, thinkingLevel: null },
      { ...config, capabilities: { toolSummary: false } },
    ]) {
      await save(value);
      await emit("session_start");
      await emit("message_end", { message });
      await tick();
      assert.equal(calls, 0);
      assert.equal(editor, undefined);
      assert.equal(ToolExecutionComponent.prototype.render, nativeRender);
    }
    await save(config); // No capability flag: enabled by default.
    await reload();
    assert.ok(editor);
    assert.notEqual(ToolExecutionComponent.prototype.render, nativeRender);
    await emit("message_end", { message });
    await tick();
    assert.equal(calls, 1);
    await save({ ...config, capabilities: { toolSummary: false } });
    await reload();
    assert.equal(editor, undefined);
    assert.equal(ToolExecutionComponent.prototype.render, nativeRender);
    resolve({
      stopReason: "stop",
      content: [{ type: "text", text: "stale summary" }],
      usage: {},
    });
    await tick();
    assert.equal(writes, 0);
    await save({ ...config, capabilities: { toolSummary: true } });
    await reload();
    assert.ok(editor);
    await save({ ...config, thinkingLevel: null });
    await reload();
    assert.equal(editor, undefined);
    assert.equal(ToolExecutionComponent.prototype.render, nativeRender);
    await save(config);
    for (const mode of ["print", "json", "rpc"]) {
      (ctx as any).mode = mode;
      await reload();
      await emit("message_end", { message });
      await tick();
      assert.equal(calls, 1);
      assert.equal(editor, undefined);
    }
  } finally {
    await emit("session_shutdown");
    if (oldDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = oldDir;
    await rm(dir, { recursive: true, force: true });
  }
});
