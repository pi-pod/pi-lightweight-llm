import assert from "node:assert/strict";
import { test } from "node:test";
import { initTheme, ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { installTranscript } from "../src/transcript.ts";
import type { TranscriptMode } from "../src/summary.ts";

initTheme("dark", false);

test("real pi rows retain native modes, replace completed built-in/custom rows, restore on dispose", () => {
  let renders = 0;
  const ui = { requestRender: () => renders++ } as unknown as TUI;
  const native = ToolExecutionComponent.prototype.render;
  let mode: TranscriptMode = "compact";
  const result = { content: [{ type: "text" as const, text: "original result" }], isError: false };
  const adapter = installTranscript(() => mode, () => "A short factual summary.", () => "pending");
  try {
    assert.throws(() => installTranscript(() => mode, () => "", () => ""), /already installed/);
    for (const name of ["bash", "third_party_tool"]) {
      const row = new ToolExecutionComponent(name, "id", { command: "echo hi" }, {}, undefined, ui, process.cwd());
      row.updateResult(result);
      assert.deepEqual(row.render(80), native.call(row, 80));
      mode = "verbose";
      row.setExpanded(true);
      assert.deepEqual(row.render(80), native.call(row, 80));
      mode = "summary";
      assert.ok(row.render(80).join("\n").includes("A short factual summary."));
      assert.ok(!row.render(80).join("\n").includes("original result"));
      assert.equal(result.content[0].text, "original result");
      row.updateResult(result, true);
      assert.deepEqual(row.render(80), native.call(row, 80));
      mode = "compact";
    }
    adapter.refresh();
    assert.ok(renders > 0);
  } finally { adapter.dispose(); }
  assert.equal(ToolExecutionComponent.prototype.render, native);
});
