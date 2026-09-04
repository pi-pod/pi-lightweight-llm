import { ToolExecutionComponent, type Theme } from "@earendil-works/pi-coding-agent";
import { Box, Text, type Component } from "@earendil-works/pi-tui";
import { cleanSummary, type ToolSnapshot, type TranscriptMode } from "./summary.ts";

// Compatibility boundary for pi 0.84.4. Pi exposes the component, but not a
// transcript-wide renderer hook. No tools, result contents, or context are changed.
interface RowInternals extends ToolSnapshot {
  isPartial: boolean;
  children: Component[];
  contentBox: Box;
  contentText: Text;
  ui: { requestRender(force?: boolean): void };
  invalidate(): void;
}
const owner = Symbol.for("pi-lightweight-llm.transcript-owner");

export function installTranscript(
  mode: () => TranscriptMode,
  summary: (tool: ToolSnapshot) => string | undefined,
  getTheme: () => Theme,
  pending: (tool: ToolSnapshot) => boolean = () => false,
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
    const text = summary(row);
    // Keep native output visible while background work is queued or running.
    if (text === undefined) {
      const lines = original.call(this, width);
      if (!pending(row) || lines.length === 0) return lines;
      // Locate the native shell, not the end of the row (images can follow it).
      // Self-rendered custom tools have no standard shell; leave those intact.
      const shellIndex = row.children?.findIndex(child => child === row.contentBox || child === row.contentText) ?? -1;
      if (shellIndex < 0) return lines;
      const shellEnd = row.children.slice(0, shellIndex + 1)
        .reduce((height, child) => height + child.render(width).length, 0);
      if (shellEnd < 2 || shellEnd > lines.length) return lines;
      const theme = getTheme();
      const indicator = new Text(theme.fg("muted", "LLM Summary Processing..."), 1, 0);
      indicator.setCustomBgFn(line => theme.bg(row.result!.isError ? "toolErrorBg" : "toolSuccessBg", line));
      // Insert before the shell's bottom padding without mutating native render caches.
      return [...lines.slice(0, shellEnd - 1), ...indicator.render(width), ...lines.slice(shellEnd - 1)];
    }
    const theme = getTheme(); // Read on every render so theme changes apply immediately.
    const label = `${row.result.isError ? "ERROR · " : ""}${row.toolName}`;
    const title = theme.fg("toolTitle", theme.bold(cleanSummary(label)))
      + theme.fg("muted", " · LLM summary");
    // Match pi's standard tool shell, including full-width background and padding.
    const box = new Box(1, 1, line => theme.bg(row.result.isError ? "toolErrorBg" : "toolSuccessBg", line));
    box.addChild(new Text(title, 0, 0));
    box.addChild(new Text(text.split("\n").map(line => theme.fg("toolOutput", line)).join("\n"), 0, 0));
    return ["", ...box.render(width)];
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
