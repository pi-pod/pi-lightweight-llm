import type {
  ExtensionContext,
  MessageEndEvent,
} from "@earendil-works/pi-coding-agent";
import type { ModelSettings } from "../settings.ts";

/** Each capability owns its state, work, UI, and cleanup. The host owns activation. */
export interface Capability {
  id: string;
  supports(ctx: ExtensionContext): boolean;
  start(ctx: ExtensionContext, model: ModelSettings): void | Promise<void>;
  stop(ctx: ExtensionContext): void;
  messageEnd?(event: MessageEndEvent, ctx: ExtensionContext): void;
  tree?(ctx: ExtensionContext): void;
}

export interface CapabilityControls {
  reload(ctx: ExtensionContext): Promise<void>;
}
