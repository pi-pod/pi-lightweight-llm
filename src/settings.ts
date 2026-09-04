import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  CONFIG_DIR_NAME,
  getAgentDir,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";

export const thinkingLevels = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;
export type ThinkingLevel = (typeof thinkingLevels)[number];
export interface ModelSettings {
  provider: string;
  model: string;
  thinkingLevel: ThinkingLevel;
}
export interface LightweightSettings {
  provider: string | null;
  model: string | null;
  thinkingLevel: ThinkingLevel | null;
  capabilities: Record<string, boolean>;
}

export function configuredModel(
  settings: LightweightSettings,
): ModelSettings | undefined {
  if (
    settings.provider === null ||
    settings.model === null ||
    settings.thinkingLevel === null
  )
    return undefined;
  return {
    provider: settings.provider,
    model: settings.model,
    thinkingLevel: settings.thinkingLevel,
  };
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function parseSettings(
  global: unknown,
  project: unknown,
): LightweightSettings {
  const section = (value: unknown) => {
    if (!object(value)) throw new Error("settings.json must contain an object");
    // Keep existing installations working. The new namespace takes precedence.
    const config =
      value.lightweightLlm === undefined
        ? value.lightweightTasks
        : value.lightweightLlm;
    if (config === undefined) return {};
    if (!object(config)) throw new Error("lightweightLlm must be an object");
    return config;
  };
  const globalConfig = section(global);
  const projectConfig = section(project);
  const merged: Record<string, unknown> = {
    provider: null,
    model: null,
    thinkingLevel: null,
    ...globalConfig,
    ...projectConfig,
  };
  for (const key of ["provider", "model"] as const) {
    const value = merged[key];
    if (value !== null && (typeof value !== "string" || !value.trim())) {
      throw new Error(
        `lightweightLlm.${key} must be a non-empty string or null`,
      );
    }
  }
  if (
    merged.thinkingLevel !== null &&
    !thinkingLevels.includes(merged.thinkingLevel as ThinkingLevel)
  ) {
    throw new Error(
      `lightweightLlm.thinkingLevel must be null or one of: ${thinkingLevels.join(", ")}`,
    );
  }
  const capabilities: Record<string, boolean> = {};
  for (const config of [globalConfig, projectConfig]) {
    if (config.capabilities === undefined) continue;
    if (!object(config.capabilities))
      throw new Error("lightweightLlm.capabilities must be an object");
    for (const [id, enabled] of Object.entries(config.capabilities)) {
      if (typeof enabled !== "boolean")
        throw new Error(`lightweightLlm.capabilities.${id} must be a boolean`);
      capabilities[id] = enabled;
    }
  }
  return {
    provider: merged.provider as string | null,
    model: merged.model as string | null,
    thinkingLevel: merged.thinkingLevel as ThinkingLevel | null,
    capabilities,
  };
}

async function readSettings(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new Error(`Cannot read ${path}: ${String(error)}`);
  }
}

export async function loadSettings(
  ctx: ExtensionContext,
): Promise<LightweightSettings> {
  return parseSettings(
    await readSettings(join(getAgentDir(), "settings.json")),
    ctx.isProjectTrusted()
      ? await readSettings(join(ctx.cwd, CONFIG_DIR_NAME, "settings.json"))
      : {},
  );
}
