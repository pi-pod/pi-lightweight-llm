# pi-lightweight-tasks

A shared lightweight model for auxiliary tasks, starting with tool-call summaries and a three-mode transcript.

## Install

```sh
pi install /absolute/path/to/pi-lightweight-tasks
```

Run `/reload` in an existing session. To try without installing:

```sh
pi -e ./src/index.ts
```

## Configure

Add this section to `~/.pi/agent/settings.json` (use a model available in your pi installation):

```json
{
  "lightweightTasks": {
    "provider": "anthropic",
    "model": "claude-haiku-4-5",
    "thinkingLevel": "off"
  }
}
```

`PI_CODING_AGENT_DIR` is respected. Trusted `.pi/settings.json` overrides individual fields; untrusted project settings are ignored. No helper requests are made until provider and model are configured. Invalid configuration disables requests with a warning; there is no silent fallback to the primary model.

Thinking levels: `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`. Non-reasoning models use `off`; other levels follow the provider's capabilities. For lightweight work, prefer `off` or `low`.

Edit the JSON, then run `/tool-summaries` or `/reload` to apply it. These are extension settings, not additional rows in pi's built-in `/settings` menu. The primary model and its thinking level are never changed.

## Use

**Ctrl+O** cycles **compact → verbose → LLM summary → compact**.

- Compact and verbose use pi's original renderers, including third-party tool renderers.
- Summary replaces completed tool rows with the tool name, error indicator, and a plain-text LLM summary of at most **999 characters**. Running tools retain native progress rendering.
- User messages, assistant messages, and thinking blocks are unchanged. `!`/`!!` shell commands are not agent tool calls and are unchanged.

Commands:

- `/transcript [compact|verbose|summary]` — select a mode, or cycle without arguments.
- `/tool-summaries` — reload configuration, backfill missing summaries, and retry failures.

Ctrl+O is intercepted in the main editor, composing with any existing custom editor. (Pi reserves the built-in expand shortcut, so `registerShortcut` cannot override it.) Other shortcuts bound to native tool expansion still perform native expansion. The three-mode cycle remains on Ctrl+O. Picker-local Ctrl+O actions are unaffected.

## Requests, persistence, and privacy

When configured, completed tool calls are summarized automatically in interactive TUI sessions, **even when summary mode is not selected**. On resume/reload, missing summaries on the current branch are also generated. This incurs additional model requests and may send sensitive tool arguments/output to the configured provider. Only enable it with an appropriate provider.

Requests run serially in the background, with a 60-second deadline and a 2048-token output budget. Input is bounded to excerpts of arguments (6000 characters) and output (18000 characters), retaining both head and tail. Images are described by type only; image bytes, tool `details`, and the rest of the conversation are not sent. Summaries may omit important information: verbose mode remains the source of truth.

Summaries and helper usage are stored as custom session entries, **not model-context messages**. Original tool results and agent context are never replaced. Cached summaries survive resume/reload/fork; changing the lightweight model does not regenerate existing summaries. Helper usage is stored for inspection but is not included in pi's native token/cost totals. Failed summaries show an unavailable label; errors never fail the original tool. Branch changes, reload, and shutdown cancel background work and prevent stale session writes. Print/JSON/RPC modes do not generate summaries.

## Compatibility

Tested against **`@earendil-works/pi-coding-agent` 0.84.4** on Node 22.

Pi currently has no public transcript-wide tool renderer API. `src/transcript.ts` therefore wraps the exported `ToolExecutionComponent.prototype.render` and reads a small set of internal row fields. This covers built-in, extension, SDK, and restored tool rows **without overriding tool execution**. The wrapper is removed on shutdown/reload. Unknown row shapes fall back to native output. Future pi versions or extensions that also patch this component may require adapter changes. Older `@mariozechner/*` installations are not supported.

`src/lightweight.ts` exports `runLightweightTask()` as the shared model/authentication entry point for future auxiliary tasks.

## Development

```sh
npm install
npm run check
npm test
# Optional Linux/macOS real-CLI test (requires pi on PATH):
python3 test/cli-smoke.py
```

Tests cover settings, limits, queue cancellation, background persistence/restoration, stale completion prevention, and native/summary rendering with actual pi tool components. The PTY smoke test verifies actual Ctrl+O cycling, cached summary rendering on resume, and `/reload` cleanup in the installed CLI. Provider calls are mocked; tests do not spend tokens.
