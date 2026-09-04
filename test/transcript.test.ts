import assert from "node:assert/strict";
import { test } from "node:test";
import { initTheme, ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import { visibleWidth, type TUI } from "@earendil-works/pi-tui";
import { theme } from "../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js";
import { installTranscript } from "../src/capabilities/tool-summary/transcript.ts";
import type { TranscriptMode } from "../src/capabilities/tool-summary/summary.ts";

initTheme("dark", false);

test("real pi rows retain native modes, replace completed built-in/custom rows, restore on dispose", () => {
  let renders = 0;
  const ui = { requestRender: () => renders++ } as unknown as TUI;
  const native = ToolExecutionComponent.prototype.render;
  let mode: TranscriptMode = "compact";
  const result = { content: [{ type: "text" as const, text: "original result" }], isError: false };
  let summary: string | undefined;
  let pending = true;
  const adapter = installTranscript(() => mode, () => summary, () => theme, () => pending);
  try {
    assert.throws(() => installTranscript(() => mode, () => "", () => theme), /already installed/);
    for (const name of ["bash", "third_party_tool"]) {
      const row = new ToolExecutionComponent(name, "id", { command: "echo hi" }, {}, undefined, ui, process.cwd());
      row.updateResult(result);
      assert.deepEqual(row.render(80), native.call(row, 80));
      mode = "verbose";
      row.setExpanded(true);
      assert.deepEqual(row.render(80), native.call(row, 80));
      mode = "summary";
      row.setExpanded(false);
      summary = undefined;
      pending = true;
      for (const width of [20, 80]) {
        const original = native.call(row, width);
        const lines = row.render(width);
        assert.deepEqual(lines.slice(0, original.length - 1), original.slice(0, -1));
        assert.equal(lines.at(-1), original.at(-1)); // Preserve native bottom padding.
        const indicatorLines = lines.slice(original.length - 1, -1);
        const indicator = indicatorLines.join("\n");
        assert.ok(indicator.includes(theme.getFgAnsi("muted")));
        assert.ok(indicatorLines.every(line => line.includes(theme.getBgAnsi("toolSuccessBg"))));
        assert.ok(indicatorLines.every(line => visibleWidth(line) === width));
        assert.ok(lines.every(line => visibleWidth(line) <= width));
        if (width === 80) assert.ok(indicator.includes("LLM Summary Processing..."));
      }
      pending = false; // Failed/cancelled work must not leave a stale indicator.
      assert.deepEqual(row.render(80), native.call(row, 80));
      const previousRenders = renders;
      summary = "A short factual summary.";
      adapter.refresh();
      assert.ok(renders > previousRenders);
      assert.ok(row.render(80).join("\n").includes("A short factual summary."));
      assert.ok(!row.render(80).join("\n").includes("original result"));
      assert.ok(!row.render(80).join("\n").includes("LLM Summary Processing..."));
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

test("summary shells match native theme colors and padding, including live theme changes and errors", () => {
  const ui = { requestRender: () => {} } as unknown as TUI;
  const native = ToolExecutionComponent.prototype.render;
  let summary: string | undefined = "Changed config.ts.";
  const adapter = installTranscript(() => "summary", () => summary, () => theme);
  try {
    const row = new ToolExecutionComponent("bash", "id", { command: "echo hi" }, {}, undefined, ui, process.cwd());
    const themedRenders: string[] = [];
    for (const name of ["dark", "light"]) {
      initTheme(name, false);
      for (const isError of [false, true]) {
        row.updateResult({ content: [{ type: "text", text: "native output" }], isError });
        for (const text of ["Changed config.ts.", undefined]) {
          summary = text;
          const lines = row.render(60);
          const rendered = lines.join("\n");
          const bg = theme.getBgAnsi(isError ? "toolErrorBg" : "toolSuccessBg");
          if (text === undefined) {
            assert.deepEqual(lines, native.call(row, 60));
            assert.ok(rendered.includes("native output"));
            assert.ok(!rendered.includes("Summarizing"));
            continue;
          }
          assert.ok(rendered.includes(bg));
          assert.ok(rendered.includes(theme.getFgAnsi("toolTitle")));
          assert.ok(rendered.includes(theme.getFgAnsi("toolOutput")));
          assert.ok(rendered.includes(text));
          assert.equal(rendered.includes("ERROR"), isError);
          assert.equal(lines[0], ""); // Inter-row spacer, outside the shell.
          assert.equal(lines[1], native.call(row, 60)[1]); // Native top padding/background.
          assert.equal(lines.at(-1), lines[1]); // Symmetric bottom padding.
          assert.ok(lines.slice(1).every(line => visibleWidth(line) === 60));
          if (!isError && text) themedRenders.push(rendered);
        }
      }
    }
    assert.notEqual(themedRenders[0], themedRenders[1]);
  } finally {
    adapter.dispose();
    initTheme("dark", false);
  }
});
