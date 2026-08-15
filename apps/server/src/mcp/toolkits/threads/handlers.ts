import { CommandId, MessageId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";

import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { findThreadById } from "../../../orchestration/commandInvariants.ts";
import type { OrchestrationDispatchError } from "../../../orchestration/Errors.ts";
import { OrchestrationEngineService } from "../../../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ServerSettingsService } from "../../../serverSettings.ts";
import {
  THREAD_LIST_DEFAULT_LIMIT,
  formatThreadCreateEnvelope,
  formatThreadSendEnvelope,
  listSiblingThreads,
  resolvePeerSendTarget,
  validateThreadSendMessage,
} from "./logic.ts";
import { ThreadSendRejectedError, ThreadToolkitQueryError, ThreadsToolkit } from "./tools.ts";

const toDispatchSendError = (
  error: OrchestrationDispatchError,
  threadId: ThreadId,
): ThreadSendRejectedError | ThreadToolkitQueryError => {
  if (error._tag === "OrchestrationCommandInvariantError") {
    const detail = error.detail;
    const reason = detail.includes("cannot send a peer message to itself")
      ? "self"
      : detail.includes("already archived")
        ? "archived"
        : detail.includes("not in the same project")
          ? "other_project"
          : "missing";
    return new ThreadSendRejectedError({ reason, threadId, detail });
  }
  return new ThreadToolkitQueryError({
    operation: "send",
    detail: "Failed to dispatch the sibling turn.",
  });
};

const listThreads = Effect.fn("ThreadsToolkit.thread_list")(function* (input: {
  readonly limit?: number | undefined;
}) {
  yield* McpInvocationContext.requireMcpCapability("threads");
  const invocation = yield* McpInvocationContext.McpInvocationContext;
  const snapshotQuery = yield* ProjectionSnapshotQuery;
  const snapshot = yield* snapshotQuery.getShellSnapshot().pipe(
    Effect.mapError(
      () =>
        new ThreadToolkitQueryError({
          operation: "list",
          detail: "Failed to read the project thread list.",
        }),
    ),
  );
  return {
    threads: listSiblingThreads(
      snapshot,
      invocation.threadId,
      input.limit ?? THREAD_LIST_DEFAULT_LIMIT,
    ),
  };
});

const sendThread = Effect.fn("ThreadsToolkit.thread_send")(function* (input: {
  readonly threadId: ThreadId;
  readonly message: string;
}) {
  yield* McpInvocationContext.requireMcpCapability("threads");
  const invocation = yield* McpInvocationContext.McpInvocationContext;
  const validated = validateThreadSendMessage(input.message);
  if (!validated.ok) {
    return yield* new ThreadSendRejectedError({
      reason: validated.reason,
      threadId: input.threadId,
      detail:
        validated.reason === "blank"
          ? "Message text is empty."
          : "Message text is larger than the coordination size limit.",
    });
  }

  const snapshotQuery = yield* ProjectionSnapshotQuery;
  const readModel = yield* snapshotQuery.getCommandReadModel().pipe(
    Effect.mapError(
      () =>
        new ThreadToolkitQueryError({
          operation: "send",
          detail: "Failed to read thread state for delivery.",
        }),
    ),
  );
  const resolved = resolvePeerSendTarget({
    readModel,
    sourceThreadId: invocation.threadId,
    targetThreadId: input.threadId,
  });
  if (!resolved.ok) {
    return yield* new ThreadSendRejectedError({
      reason: resolved.reason,
      threadId: input.threadId,
      detail: resolved.detail,
    });
  }

  const crypto = yield* Crypto.Crypto;
  const commandId = yield* crypto.randomUUIDv4.pipe(
    Effect.map((uuid) => CommandId.make(`mcp:thread.send:${uuid}`)),
    Effect.orDie,
  );
  const messageId = yield* crypto.randomUUIDv4.pipe(
    Effect.map((uuid) => MessageId.make(uuid)),
    Effect.orDie,
  );
  const createdAt = DateTime.formatIso(yield* DateTime.now);
  const engine = yield* OrchestrationEngineService;
  const { sequence } = yield* engine
    .dispatch({
      type: "thread.turn.start",
      commandId,
      threadId: resolved.target.id,
      message: {
        messageId,
        role: "user",
        text: formatThreadSendEnvelope({
          sourceThreadId: resolved.source.id,
          sourceTitle: resolved.source.title,
          message: validated.text,
        }),
        attachments: [],
      },
      runtimeMode: resolved.target.runtimeMode,
      interactionMode: resolved.target.interactionMode,
      sourceThreadId: resolved.source.id,
      createdAt,
    })
    .pipe(Effect.mapError((error) => toDispatchSendError(error, input.threadId)));

  return {
    accepted: true as const,
    threadId: resolved.target.id,
    commandId,
    messageId,
    sequence,
    createdAt,
  };
});

const createThread = Effect.fn("ThreadsToolkit.thread_create")(function* (input: {
  readonly title: string;
  readonly message: string;
  readonly instanceId?: ProviderInstanceId | undefined;
  readonly model?: string | undefined;
}) {
  yield* McpInvocationContext.requireMcpCapability("threads");
  const invocation = yield* McpInvocationContext.McpInvocationContext;
  const validated = validateThreadSendMessage(input.message);
  if (!validated.ok) {
    return yield* new ThreadSendRejectedError({
      reason: validated.reason,
      detail:
        validated.reason === "blank"
          ? "Message text is empty."
          : "Message text is larger than the coordination size limit.",
    });
  }

  const snapshotQuery = yield* ProjectionSnapshotQuery;
  const readModel = yield* snapshotQuery.getCommandReadModel().pipe(
    Effect.mapError(
      () =>
        new ThreadToolkitQueryError({
          operation: "create",
          detail: "Failed to read thread state for create.",
        }),
    ),
  );
  const source = findThreadById(readModel, invocation.threadId);
  if (source === undefined || source.deletedAt !== null || source.archivedAt !== null) {
    return yield* new ThreadSendRejectedError({
      reason: "missing",
      detail: `Source thread '${invocation.threadId}' is not an active thread.`,
    });
  }

  const modelSelection =
    input.instanceId !== undefined && input.model !== undefined
      ? { instanceId: input.instanceId, model: input.model }
      : source.modelSelection;
  const enveloped = formatThreadCreateEnvelope({
    sourceThreadId: source.id,
    sourceTitle: source.title,
    message: validated.text,
  });
  const crypto = yield* Crypto.Crypto;
  const threadId = yield* crypto.randomUUIDv4.pipe(
    Effect.map((uuid) => ThreadId.make(uuid)),
    Effect.orDie,
  );
  const createdAt = DateTime.formatIso(yield* DateTime.now);
  const settings = yield* ServerSettingsService;
  const mode = yield* settings.getSettings.pipe(
    Effect.map((current) => current.threadCreateMode),
    Effect.mapError(
      () =>
        new ThreadToolkitQueryError({
          operation: "create",
          detail: "Failed to read the thread create setting.",
        }),
    ),
  );
  const engine = yield* OrchestrationEngineService;

  if (mode === "manual") {
    const commandId = yield* crypto.randomUUIDv4.pipe(
      Effect.map((uuid) => CommandId.make(`mcp:thread.propose:${uuid}`)),
      Effect.orDie,
    );
    yield* engine
      .dispatch({
        type: "thread.propose",
        commandId,
        threadId,
        sourceThreadId: source.id,
        title: input.title,
        message: enveloped,
        modelSelection,
        runtimeMode: source.runtimeMode,
        interactionMode: source.interactionMode,
        createdAt,
      })
      .pipe(Effect.mapError((error) => toDispatchSendError(error, threadId)));
    return { threadId, title: input.title, mode: "proposed" as const };
  }

  const createCommandId = yield* crypto.randomUUIDv4.pipe(
    Effect.map((uuid) => CommandId.make(`mcp:thread.create:${uuid}`)),
    Effect.orDie,
  );
  const startCommandId = yield* crypto.randomUUIDv4.pipe(
    Effect.map((uuid) => CommandId.make(`mcp:thread.start:${uuid}`)),
    Effect.orDie,
  );
  const messageId = yield* crypto.randomUUIDv4.pipe(
    Effect.map((uuid) => MessageId.make(uuid)),
    Effect.orDie,
  );
  yield* engine
    .dispatch({
      type: "thread.create",
      commandId: createCommandId,
      threadId,
      projectId: source.projectId,
      title: input.title,
      modelSelection,
      runtimeMode: source.runtimeMode,
      interactionMode: source.interactionMode,
      branch: null,
      worktreePath: null,
      createdAt,
    })
    .pipe(Effect.mapError((error) => toDispatchSendError(error, threadId)));
  yield* engine
    .dispatch({
      type: "thread.turn.start",
      commandId: startCommandId,
      threadId,
      sourceThreadId: source.id,
      message: {
        messageId,
        role: "user",
        text: enveloped,
        attachments: [],
      },
      runtimeMode: source.runtimeMode,
      interactionMode: source.interactionMode,
      createdAt,
    })
    .pipe(Effect.mapError((error) => toDispatchSendError(error, threadId)));
  return { threadId, title: input.title, mode: "started" as const };
});

const handlers = {
  thread_list: (input) => listThreads(input ?? {}),
  thread_send: (input) => sendThread(input),
  thread_create: (input) => createThread(input),
} satisfies Parameters<typeof ThreadsToolkit.toLayer>[0];

export const ThreadsToolkitHandlersLive = ThreadsToolkit.toLayer(handlers);
