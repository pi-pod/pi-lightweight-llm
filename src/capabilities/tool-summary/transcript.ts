import { ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { cleanSummary, type ToolSnapshot, type TranscriptMode } from "./summary.ts";

// Compatibility boundary for pi 0.84.4. Pi exposes the component, but not a
// transcript-wide renderer hook. No tools, result contents, or context are changed.
interface RowInternals extends ToolSnapshot {
  isPartial: boolean;
  ui: { requestRender(force?: boolean): void };
  invalidate(): void;
}
const owner = Symbol.for("pi-lightweight-llm.transcript-owner");

export function installTranscript(
  mode: () => TranscriptMode,
  summary: (tool: ToolSnapshot) => string | undefined,
  pendingLabel: () => string,
) {
  const prototype = ToolExecutionComponent.prototype;
  const tagged = prototype as unknown as Record<symbol, unknown>;
  if (tagged[owner]) throw new Error("Lightweight transcript adapter is already installed");
  const original = prototype.render;
  if (typeof original !== "function" || typeof prototype.updateResult !== "function") {
    throw new Error("Unsupported pi tool transcript component");
  }
  const rows = new Set<WeakRef<RowInternals>>();
  const seen = new WeakSet<object>();
  const render: typeof original = function (this: ToolExecutionComponent, width) {
    const row = this as unknown as RowInternals;
    if (!seen.has(this)) { seen.add(this); rows.add(new WeakRef(row)); }
    // Fail safely to native rendering if pi changes its internal row shape.
    if (mode() !== "summary" || row.isPartial !== false ||
        typeof row.toolCallId !== "string" || typeof row.toolName !== "string" ||
        !Array.isArray(row.result?.content)) return original.call(this, width);
    const text = summary(row) ?? pendingLabel();
    const label = `${row.result.isError ? "ERROR · " : ""}${row.toolName} · LLM summary`;
    return ["", ...new Text(`${cleanSummary(label)}\n${text}`, 1, 0).render(width)];
  };
  tagged[owner] = render;
  prototype.render = render;

  function refresh() {
    const uis = new Set<RowInternals["ui"]>();
    for (const ref of rows) {
      const row = ref.deref();
      if (!row) { rows.delete(ref); continue; }
      row.invalidate();
      if (typeof row.ui?.requestRender === "function") uis.add(row.ui);
    }
    for (const ui of uis) ui.requestRender();
  }
  return {
    refresh,
    dispose() {
      // Don't clobber a later wrapper installed by another extension.
      if (prototype.render === render) prototype.render = original;
      delete tagged[owner];
      refresh();
      rows.clear();
    },
  };
}
