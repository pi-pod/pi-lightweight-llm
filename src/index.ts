import { CustomEditor, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { matchesKey } from "@earendil-works/pi-tui";
import { loadSettings, type LightweightSettings } from "./settings.ts";
import { runLightweightTask } from "./lightweight.ts";
import { cleanSummary, nextMode, summaryInput, summaryInstructions, summaryKey, WorkQueue,
  type ToolSnapshot, type TranscriptMode } from "./summary.ts";
import { installTranscript } from "./transcript.ts";

const ENTRY = "lightweight-tasks.tool-summary.v1";

export default function (pi: ExtensionAPI) {
  let settings: LightweightSettings | undefined;
  let mode: TranscriptMode = "compact";
  let adapter: ReturnType<typeof installTranscript> | undefined;
  let restoreEditor: (() => void) | undefined;
  let queue = new WorkQueue();
  const summaries = new Map<string, string>();
  const scheduled = new Set<string>();
  const failures = new Set<string>();
  const args = new Map<string, unknown>();
  let warned = false;

  function status(ctx: ExtensionContext) {
    ctx.ui.setStatus("lightweight-transcript", `transcript: ${mode}`);
  }
  function warn(ctx: ExtensionContext, message: string) {
    if (!warned) { warned = true; ctx.ui.notify(message, "warning"); }
  }
  function enqueue(tool: ToolSnapshot, ctx: ExtensionContext) {
    if (!settings || !adapter) return;
    const key = summaryKey(tool);
    if (summaries.has(key) || scheduled.has(key)) return;
    scheduled.add(key);
    const config = settings;
    const input = summaryInput(tool);
    queue.add(async signal => {
      const deadline = AbortSignal.any([signal, AbortSignal.timeout(60_000)]);
      const response = await runLightweightTask(ctx, config, { instructions: summaryInstructions, input }, deadline);
      if (signal.aborted) return; // Never append to a replaced session or branch.
      const text = cleanSummary(response.text);
      if (!text) throw new Error("Empty summary after sanitization");
      pi.appendEntry(ENTRY, { key, text, model: `${config.provider}/${config.model}`,
        thinkingLevel: config.thinkingLevel, usage: response.usage });
      summaries.set(key, text);
      adapter?.refresh();
    }, () => {
      failures.add(key);
      warn(ctx, "Tool summary failed (model, authentication, or timeout). Original output is intact; use Ctrl+O for verbose, /tool-summaries to retry.");
      adapter?.refresh();
    });
  }

  function scan(ctx: ExtensionContext) {
    args.clear();
    for (const entry of ctx.sessionManager.getEntries()) {
      if (entry.type !== "custom" || entry.customType !== ENTRY) continue;
      const data = entry.data as { key?: unknown; text?: unknown } | undefined;
      if (typeof data?.key === "string" && typeof data.text === "string") {
        const text = cleanSummary(data.text);
        if (text) summaries.set(data.key, text);
      }
    }
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type !== "message") continue;
      const message = entry.message;
      if (message.role === "assistant") {
        for (const part of message.content) if (part.type === "toolCall") args.set(part.id, part.arguments);
      } else if (message.role === "toolResult") {
        enqueue({ toolCallId: message.toolCallId, toolName: message.toolName,
          args: args.get(message.toolCallId) ?? {}, result: message }, ctx);
      }
    }
  }
  function resetWork() {
    queue.stop();
    queue = new WorkQueue();
    scheduled.clear();
    failures.clear();
    warned = false;
  }
  async function configure(ctx: ExtensionContext) {
    settings = undefined;
    try { settings = await loadSettings(ctx); }
    catch (error) { warn(ctx, String(error)); }
  }

  pi.on("session_start", async (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    resetWork();
    summaries.clear();
    mode = ctx.ui.getToolsExpanded() ? "verbose" : "compact";
    await configure(ctx);
    try {
      adapter = installTranscript(() => mode, tool => {
        const key = summaryKey(tool);
        return summaries.get(key) ?? (failures.has(key) ? "Summary unavailable. Ctrl+O for original output." : undefined);
      }, () => settings ? "Summarizing…" : "Set lightweightTasks.provider and model in pi settings.json, then /tool-summaries.");
    } catch (error) { warn(ctx, String(error)); return; }
    // app.tools.expand is reserved: registerShortcut("ctrl+o") is skipped by pi.
    // Intercept only the focused editor, preserving picker-local Ctrl+O behavior
    // and composing with an existing custom editor rather than replacing it.
    const previous = ctx.ui.getEditorComponent();
    let active = true;
    const factory: NonNullable<typeof previous> = (tui, theme, keybindings) => {
      const editor = previous?.(tui, theme, keybindings) ?? new CustomEditor(tui, theme, keybindings);
      const handleInput = editor.handleInput.bind(editor);
      editor.handleInput = data => {
        if (active && matchesKey(data, "ctrl+o")) { setMode(nextMode(mode), ctx); return; }
        handleInput(data);
      };
      return editor;
    };
    ctx.ui.setEditorComponent(factory);
    restoreEditor = () => {
      active = false;
      if (ctx.ui.getEditorComponent() === factory) ctx.ui.setEditorComponent(previous);
    };
    scan(ctx);
    status(ctx);
  });

  pi.on("message_end", (event, ctx) => {
    if (ctx.mode !== "tui" || !adapter) return;
    const message = event.message;
    if (message.role === "assistant") {
      for (const part of message.content) if (part.type === "toolCall") args.set(part.id, part.arguments);
    } else if (message.role === "toolResult") {
      enqueue({ toolCallId: message.toolCallId, toolName: message.toolName,
        args: args.get(message.toolCallId) ?? {}, result: message }, ctx);
    }
    // Deliberately no return patch: the agent always receives the original result.
  });
  pi.on("session_tree", (_event, ctx) => {
    if (!adapter) return;
    resetWork();
    scan(ctx);
    adapter.refresh();
  });
  pi.on("session_shutdown", (_event, ctx) => {
    queue.stop();
    restoreEditor?.();
    restoreEditor = undefined;
    mode = "compact";
    adapter?.dispose();
    adapter = undefined;
    summaries.clear();
    args.clear();
    if (ctx.mode === "tui") ctx.ui.setStatus("lightweight-transcript", undefined);
  });

  function setMode(value: TranscriptMode, ctx: ExtensionContext) {
    if (ctx.mode !== "tui" || !adapter) return;
    mode = value;
    ctx.ui.setToolsExpanded(mode === "verbose");
    adapter.refresh(); // compact -> summary also needs invalidation, despite the same expanded flag.
    status(ctx);
  }
  pi.registerCommand("transcript", {
    description: "Set transcript mode: compact, verbose, summary (or cycle with no argument)",
    handler: async (input, ctx) => {
      const value = input.trim();
      if (!value) { setMode(nextMode(mode), ctx); return; }
      if (value === "compact" || value === "verbose" || value === "summary") setMode(value, ctx);
      else ctx.ui.notify("Usage: /transcript [compact|verbose|summary]", "warning");
    },
  });
  pi.registerCommand("tool-summaries", {
    description: "Reload lightweightTasks settings and generate missing/retry failed tool summaries",
    handler: async (_input, ctx) => {
      if (ctx.mode !== "tui" || !adapter) return;
      resetWork();
      await configure(ctx);
      scan(ctx);
      adapter.refresh();
      if (!settings) ctx.ui.notify('Add "lightweightTasks": { "provider": "…", "model": "…", "thinkingLevel": "off" } to pi settings.json.', "info");
      else ctx.ui.notify(`Summarizing with ${settings.provider}/${settings.model} (${settings.thinkingLevel})`, "info");
    },
  });
}
