import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ModelSettings } from "./settings.ts";

/** Shared entry point for this and future lightweight tasks; never switches the agent model. */
export async function runLightweightTask(
  ctx: ExtensionContext,
  settings: ModelSettings,
  task: { instructions: string; input: string },
  signal: AbortSignal,
) {
  const model = ctx.modelRegistry.find(settings.provider, settings.model);
  if (!model) throw new Error(`Unknown lightweight model: ${settings.provider}/${settings.model}`);
  if (!ctx.modelRegistry.hasConfiguredAuth(model)) throw new Error("Lightweight model authentication is not configured");
  const response = await ctx.modelRegistry.complete(model, {
    systemPrompt: task.instructions,
    messages: [{ role: "user", content: task.input, timestamp: Date.now() }],
  }, {
    signal,
    reasoningEffort: model.reasoning ? settings.thinkingLevel : "off",
    maxTokens: 2048,
    cacheRetention: "none",
  });
  if (response.stopReason === "error" || response.stopReason === "aborted") {
    throw new Error(response.errorMessage || `Lightweight task ${response.stopReason}`);
  }
  const text = response.content.filter(c => c.type === "text").map(c => c.text).join("\n").trim();
  if (!text) throw new Error("Lightweight model returned no text");
  return { text, usage: response.usage };
}
