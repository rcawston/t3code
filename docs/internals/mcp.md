# Native MCP server

> For maintainers. Using T3 Code? See [docs/user](../user/).

T3 injects a first-party MCP server at `/mcp` into every provider session (Codex, Claude, Cursor,
Grok, OpenCode). Adding a toolkit there is how a capability becomes native. Do not add a
third-party MCP or call `ProviderService.sendTurn` from a toolkit.

## Trust boundary

`/mcp` sits outside environment auth. The only guard is a per-session bearer minted by
[`McpSessionRegistry`][registry] and bound to `{environmentId, threadId, providerSessionId,
providerInstanceId, capabilities}`. Dead or revoked tokens still 401 with
`invalid_mcp_credential`. Agents cannot spoof the source thread: it comes from the credential.

Each credential currently grants `preview` and `threads`. Handlers call
`requireMcpCapability(...)` before doing work.

## Toolkits

Preview automation lives in `apps/server/src/mcp/toolkits/preview`. Sibling-thread messaging
lives in `apps/server/src/mcp/toolkits/threads` and is registered next to preview in
[`McpHttpServer.ts`][http].

### `thread_list` / `thread_send`

These are the smallest useful coordination tools. They are not a second orchestration API.

- `thread_list` reads [`getShellSnapshot()`][snapshot] and returns compact same-project, active,
  non-archived, non-self rows. No transcripts, diffs, or other projects.
- `thread_send` validates the target in the handler and again in
  [`decideOrchestrationCommand`][decider], then dispatches `thread.turn.start` through
  [`OrchestrationEngineService.dispatch`][engine]. The command carries a server-set
  `sourceThreadId`. Client command schemas omit that field, so a UI or HTTP caller cannot spoof
  it.

The stored user text is prefixed with a server envelope naming the source thread. Runtime and
interaction mode are copied from the **target** thread. The sender gets an acceptance receipt
after the command is durably committed. The toolkit does not wait for the target turn and does
not return its transcript.

If the target is idle or stopped, ordinary `thread.turn.start` starts it through
[`ProviderCommandReactor`][reactor]. If it is already running, delivery uses the existing
steering path. There is no second send path and no call to `ProviderService.sendTurn`.

### `thread_create`

Create is still MCP-visible orchestration, not a new provider runtime. The tool inherits project,
runtime mode, and interaction mode from the source thread and never invents a worktree.

`threadCreateMode` on server settings chooses the path:

- `automatic` dispatches `thread.create` then `thread.turn.start`.
- `manual` (default) dispatches internal `thread.propose`. The human confirms or dismisses with
  client-dispatchable `thread.proposal.respond`. Confirm emits dismiss + create + turn start.
  Manual mode fails closed: if the proposal cannot be persisted, the tool fails instead of
  creating a session.

Proposed threads live on the source thread (`proposedThreads`) and ride the existing
`thread-upserted` shell stream.

## Related

- [Architecture overview](./overview.md)
- [Glossary](./glossary.md)
- User guide: [Message another thread](../user/thread-messaging.md)

[registry]: ../../apps/server/src/mcp/McpSessionRegistry.ts
[http]: ../../apps/server/src/mcp/McpHttpServer.ts
[snapshot]: ../../apps/server/src/orchestration/Services/ProjectionSnapshotQuery.ts
[decider]: ../../apps/server/src/orchestration/decider.ts
[engine]: ../../apps/server/src/orchestration/Services/OrchestrationEngine.ts
[reactor]: ../../apps/server/src/orchestration/Layers/ProviderCommandReactor.ts
