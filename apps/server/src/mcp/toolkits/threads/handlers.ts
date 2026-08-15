import { CommandId, MessageId, ThreadId } from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";

import * as McpInvocationContext from "../../McpInvocationContext.ts";
import type { OrchestrationDispatchError } from "../../../orchestration/Errors.ts";
import { OrchestrationEngineService } from "../../../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import {
  THREAD_LIST_DEFAULT_LIMIT,
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

const handlers = {
  thread_list: (input) => listThreads(input ?? {}),
  thread_send: (input) => sendThread(input),
} satisfies Parameters<typeof ThreadsToolkit.toLayer>[0];

export const ThreadsToolkitHandlersLive = ThreadsToolkit.toLayer(handlers);
