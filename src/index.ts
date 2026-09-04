import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { configuredModel, loadSettings } from "./settings.ts";
import type { Capability } from "./capabilities/types.ts";
import { createToolSummaryCapability } from "./capabilities/tool-summary/index.ts";

export default function (pi: ExtensionAPI) {
  const active = new Set<Capability>();
  let generation = 0;
  const capabilities: Capability[] = [
    createToolSummaryCapability(pi, { reload }),
  ];

  function stop(ctx: ExtensionContext) {
    generation++;
    for (const capability of active) capability.stop(ctx);
    active.clear();
  }

  async function reload(ctx: ExtensionContext) {
    stop(ctx); // Cancel pending work before reading new settings (including invalid/null config).
    const current = generation;
    try {
      const settings = await loadSettings(ctx);
      if (current !== generation) return;
      const model = configuredModel(settings);
      if (!model) return; // Null model OR thinking means no capability execution or UI hooks.
      for (const capability of capabilities) {
        if (
          settings.capabilities[capability.id] === false ||
          !capability.supports(ctx)
        )
          continue;
        active.add(capability);
        await capability.start(ctx, model);
        if (current !== generation) return;
      }
    } catch (error) {
      if (current !== generation) return;
      stop(ctx);
      if (ctx.hasUI)
        ctx.ui.notify(`pi-lightweight-llm: ${String(error)}`, "warning");
    }
  }

  pi.on("session_start", (_event, ctx) => reload(ctx));
  pi.on("session_shutdown", (_event, ctx) => stop(ctx));
  pi.on("message_end", (event, ctx) => {
    for (const capability of active) capability.messageEnd?.(event, ctx);
  });
  pi.on("session_tree", (_event, ctx) => {
    for (const capability of active) capability.tree?.(ctx);
  });
  pi.registerCommand("lightweight-llm", {
    description: "Reload lightweightLlm settings and capability toggles",
    handler: async (_args, ctx) => {
      await reload(ctx);
      if (ctx.hasUI)
        ctx.ui.notify(
          active.size
            ? `Active capabilities: ${[...active].map((capability) => capability.id).join(", ")}`
            : "No active capabilities. Set lightweightLlm.provider, model and thinkingLevel, and enable the desired capabilities.",
          "info",
        );
    },
  });
}
