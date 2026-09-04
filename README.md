# pi-lightweight-llm

Modular lightweight LLM capabilities for pi. Each capability can be enabled or disabled independently. The first capability is **LLM tool summaries**.

## Install

```sh
pi install git:github.com/pi-pod/pi-lightweight-llm
# Or from a local checkout:
pi install /absolute/path/to/pi-lightweight-llm
```

Run `/reload` in an existing session. To try without installing: `pi -e ./src/index.ts`.

## Settings

Add `lightweightLlm` to `~/.pi/agent/settings.json`. The effective defaults are:

```json
{
  "lightweightLlm": {
    "provider": null,
    "model": null,
    "thinkingLevel": null,
    "capabilities": {
      "toolSummary": true
    }
  }
}
```

**Every capability defaults to enabled, but no capability activates unless provider, model, and thinking level are all non-null.** Missing fields default to null. An inactive tool-summary capability makes no model requests, adds no transcript adapter or editor interception, and leaves native Ctrl+O behavior untouched. Commands remain available for reloading settings.

To activate capabilities, explicitly choose a model available in your pi installation:

```json
{
  "lightweightLlm": {
    "provider": "anthropic",
    "model": "claude-haiku-4-5",
    "thinkingLevel": "off",
    "capabilities": {
      "toolSummary": true
    }
  }
}
```

`"off"` is an explicit thinking level and **does activate capabilities**; `null` does not. Supported levels: `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`. Non-reasoning models use `off` after activation; other levels follow provider capabilities. Prefer `off` or `low` for lightweight work. The primary agent model/thinking level is never changed.

Set `capabilities.toolSummary` to `false` to disable only tool summaries. Future capabilities also default to enabled unless explicitly set to false. Capability flags merge individually between global and project settings; a project-level `model: null` or `thinkingLevel: null` disables all capabilities, even if global settings are configured.

`PI_CODING_AGENT_DIR` is respected. Only trusted `.pi/settings.json` overrides are read. Invalid settings deactivate capabilities with a warning; there is no silent fallback to the primary model.

After edits, run **`/lightweight-llm`** or `/reload`. Reloading stops active capabilities and cancels pending work before applying changes. These are JSON extension settings, not rows in pi's built-in `/settings` menu.

### Migration

The repository is now `pi-pod/pi-lightweight-llm`, and the package is `pi-lightweight-llm` (previously `pi-lightweight-tasks` in the `pi-tool-summaries` repository). Update old package references in pi settings to the new repository.

The old `lightweightTasks` settings section is still read when `lightweightLlm` is absent in that settings file. **Thinking no longer defaults to `off`: set it explicitly to activate capabilities.** Previously saved tool summaries remain readable.

## Capability: toolSummary

While active, **Ctrl+O** cycles **compact → verbose → LLM summary → compact**.

- Compact and verbose preserve native renderers, including third-party tool renderers.
- Summary replaces completed tool rows with the tool name, error indicator, and an LLM summary of at most **999 characters**. Running tools retain native progress rendering.
- User/assistant messages, thinking blocks, and `!`/`!!` shell commands are unchanged.

Commands:

- `/transcript [compact|verbose|summary]` — select a mode or cycle.
- `/tool-summaries` — reload shared settings and retry/backfill missing summaries.
- `/lightweight-llm` — reload shared settings and all capability toggles.

Pi reserves the native expand shortcut, so Ctrl+O is intercepted in the main editor, composing with an existing custom editor. Picker-local Ctrl+O actions are unaffected. Other keys bound to native expansion still perform native expansion.

### Requests, persistence, and privacy

When active, completed tool calls are summarized automatically in TUI sessions, **even when summary mode is not selected**. Resume/reload backfills missing summaries on the current branch. This incurs model requests and sends potentially sensitive tool arguments/output to the configured provider. Only enable it with an appropriate provider.

Requests run serially in the background, with a 60-second deadline and a 2048-token output budget. Arguments are excerpted to 6000 characters and output to 18000, retaining head and tail. Images are described by type only; image bytes, tool `details`, and the rest of the conversation are not sent. Summaries can omit important information: verbose mode remains the source of truth.

Summaries and helper usage are stored as custom session entries, **not model-context messages**. Original tool results and context are never replaced. Cached summaries survive resume/reload/fork; changing the helper model does not regenerate cached summaries. Usage is stored for inspection but not included in pi's native token/cost totals. Failures never fail the original tool. Disable/null configuration, branch changes, reload, and shutdown cancel work and prevent stale session writes. Tool summaries do not activate in print/JSON/RPC modes.

## Architecture and compatibility

```text
src/
  index.ts                         # Capability registry, activation, event dispatch, reload
  settings.ts                      # Shared model/thinking and capability settings
  lightweight.ts                   # Shared authenticated model-request entry point
  capabilities/
    types.ts                       # Capability lifecycle contract
    tool-summary/
      index.ts                     # Tool-summary state, lifecycle, commands, editor integration
      summary.ts                   # Prompt, bounds, cache keys, background queue
      transcript.ts                # Isolated pi transcript compatibility adapter
```

To add a capability, create its own module implementing `Capability` and register its factory in `src/index.ts`. Give it a unique settings ID and implement `supports`, `start`, and `stop` plus any optional event handlers. The host handles null configuration, default-on flags, dispatch, and teardown; capability code owns its resources and cleanup. Reuse `runLightweightTask()` for authenticated requests without changing the agent model.

Tested on **pi 0.84.4 / Node 22**. Pi has no public transcript-wide tool renderer hook, so `capabilities/tool-summary/transcript.ts` wraps the exported `ToolExecutionComponent.prototype.render` and reads internal row fields. It covers built-in, extension, SDK, and restored tool rows without overriding execution. Unknown shapes fall back to native rendering; the wrapper is removed on deactivation. Future pi versions or extensions patching the same component may require adapter changes. Older `@mariozechner/*` installations are unsupported.

## Development

```sh
npm install
npm run check
npm test
# Optional real-CLI test (Linux/macOS, pi on PATH; no model calls):
python3 test/cli-smoke.py
```

Tests cover null defaults, explicit `off`, configuration merging, toggles, runtime deactivation/cancellation, limits, persistence/restoration, and actual pi row rendering. The PTY smoke test verifies Ctrl+O cycling, cached rendering on resume, and `/reload` cleanup. Provider calls are mocked; tests do not spend tokens.
