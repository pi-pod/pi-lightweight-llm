import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { CONFIG_DIR_NAME, getAgentDir, type ExtensionContext } from "@earendil-works/pi-coding-agent";

export const thinkingLevels = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export interface LightweightSettings {
  provider: string;
  model: string;
  thinkingLevel: typeof thinkingLevels[number];
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function parseSettings(global: unknown, project: unknown): LightweightSettings | undefined {
  const section = (value: unknown) => {
    if (!object(value)) throw new Error("settings.json must contain an object");
    if (value.lightweightTasks === undefined) return {};
    if (!object(value.lightweightTasks)) throw new Error("lightweightTasks must be an object");
    return value.lightweightTasks;
  };
  const merged = { ...section(global), ...section(project) };
  if (Object.keys(merged).length === 0) return undefined;
  if (typeof merged.provider !== "string" || !merged.provider.trim() ||
      typeof merged.model !== "string" || !merged.model.trim()) {
    throw new Error("lightweightTasks requires provider and model");
  }
  const thinkingLevel = merged.thinkingLevel ?? "off";
  if (!thinkingLevels.includes(thinkingLevel as LightweightSettings["thinkingLevel"])) {
    throw new Error(`lightweightTasks.thinkingLevel must be one of: ${thinkingLevels.join(", ")}`);
  }
  return { provider: merged.provider, model: merged.model, thinkingLevel: thinkingLevel as LightweightSettings["thinkingLevel"] };
}

async function readSettings(path: string): Promise<unknown> {
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new Error(`Cannot read ${path}: ${String(error)}`);
  }
}

export async function loadSettings(ctx: ExtensionContext): Promise<LightweightSettings | undefined> {
  return parseSettings(
    await readSettings(join(getAgentDir(), "settings.json")),
    ctx.isProjectTrusted() ? await readSettings(join(ctx.cwd, CONFIG_DIR_NAME, "settings.json")) : {},
  );
}
