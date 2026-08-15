import {
  CommandId,
  IsoDateTime,
  MessageId,
  ProviderInstanceId,
  ThreadId,
  TrimmedNonEmptyString,
} from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/unstable/ai";

import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { OrchestrationEngineService } from "../../../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ServerSettingsService } from "../../../serverSettings.ts";
import { THREAD_LIST_MAX_LIMIT, THREAD_SEND_MAX_MESSAGE_CHARS } from "./logic.ts";

const dependencies = [
  McpInvocationContext.McpInvocationContext,
  OrchestrationEngineService,
  ProjectionSnapshotQuery,
  ServerSettingsService,
  Crypto.Crypto,
];

export const ThreadListInput = Schema.Struct({
  limit: Schema.optional(
    Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: THREAD_LIST_MAX_LIMIT })),
  ).annotate({
    description: `Maximum sibling threads to return (1-${THREAD_LIST_MAX_LIMIT}). Defaults to 20.`,
  }),
});

export const ThreadListRow = Schema.Struct({
  threadId: ThreadId,
  title: Schema.String,
  sessionStatus: Schema.NullOr(Schema.String),
  turnState: Schema.NullOr(Schema.String),
  branch: Schema.NullOr(Schema.String),
  worktreePath: Schema.NullOr(Schema.String),
  updatedAt: IsoDateTime,
});

export const ThreadListResult = Schema.Struct({
  threads: Schema.Array(ThreadListRow),
});

export const ThreadSendInput = Schema.Struct({
  threadId: ThreadId.annotate({
    description: "Stable T3 thread id from thread_list. Titles are display-only.",
  }),
  message: Schema.String.annotate({
    description: `Plain text to deliver to the target thread, at most ${THREAD_SEND_MAX_MESSAGE_CHARS} characters.`,
  }),
});

export const ThreadSendResult = Schema.Struct({
  accepted: Schema.Literal(true),
  threadId: ThreadId,
  commandId: CommandId,
  messageId: MessageId,
  sequence: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  createdAt: IsoDateTime,
});

export const ThreadSendRejectReason = Schema.Literals([
  "self",
  "missing",
  "archived",
  "other_project",
  "blank",
  "oversized",
]);

export class ThreadSendRejectedError extends Schema.TaggedErrorClass<ThreadSendRejectedError>()(
  "ThreadSendRejectedError",
  {
    reason: ThreadSendRejectReason,
    threadId: Schema.optional(ThreadId),
    detail: Schema.String,
  },
) {
  override get message(): string {
    return this.detail;
  }
}

export const ThreadCreateInput = Schema.Struct({
  title: TrimmedNonEmptyString.annotate({
    description: "Title for the new sibling thread.",
  }),
  message: Schema.String.annotate({
    description: `First user message for the new thread, at most ${THREAD_SEND_MAX_MESSAGE_CHARS} characters.`,
  }),
  instanceId: Schema.optional(
    ProviderInstanceId.annotate({
      description: "Optional provider instance id. Omit to inherit the source thread's model.",
    }),
  ),
  model: Schema.optional(
    TrimmedNonEmptyString.annotate({
      description: "Optional model id. Omit to inherit the source thread's model.",
    }),
  ),
});

export const ThreadCreateResult = Schema.Struct({
  threadId: ThreadId,
  title: Schema.String,
  mode: Schema.Literals(["started", "proposed"]),
});

export class ThreadToolkitQueryError extends Schema.TaggedErrorClass<ThreadToolkitQueryError>()(
  "ThreadToolkitQueryError",
  {
    operation: Schema.Literals(["list", "send", "create"]),
    detail: Schema.String,
  },
) {
  override get message(): string {
    return this.detail;
  }
}

export const ThreadToolkitError = Schema.Union([
  McpInvocationContext.McpCapabilityUnavailableError,
  ThreadSendRejectedError,
  ThreadToolkitQueryError,
]);

export const ThreadListTool = Tool.make("thread_list", {
  description:
    "List other active threads in this project. Returns compact rows with stable T3 thread ids, titles, session/turn state, branch, worktree path, and update time. Does not include this thread, archived threads, other projects, or transcripts. Use thread_send with a returned threadId to message a sibling.",
  parameters: ThreadListInput,
  success: ThreadListResult,
  failure: ThreadToolkitError,
  dependencies,
})
  .annotate(Tool.Title, "List sibling threads")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true);

export const ThreadCreateTool = Tool.make("thread_create", {
  description:
    "Create a sibling thread in this project workspace. Inherits the current thread's project, runtime mode, and interaction mode. Does not create a worktree. Depending on the server setting, T3 either starts the new thread immediately or shows the user a confirm/dismiss tile. Returns the reserved thread id and whether the thread was started or only proposed. Do not wait for the new thread to finish.",
  parameters: ThreadCreateInput,
  success: ThreadCreateResult,
  failure: ThreadToolkitError,
  dependencies,
})
  .annotate(Tool.Title, "Create sibling thread")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false);

export const ThreadSendTool = Tool.make("thread_send", {
  description:
    "Send a short text message to one existing sibling thread in this project, addressed by its stable T3 thread id from thread_list. T3 attributes the sender and starts or steers the target through the ordinary turn path. Returns an acceptance receipt after the target turn is durably requested; it does not wait for or return the target transcript. Do not invent a from-id. Reply with thread_send only if useful.",
  parameters: ThreadSendInput,
  success: ThreadSendResult,
  failure: ThreadToolkitError,
  dependencies,
})
  .annotate(Tool.Title, "Send message to sibling thread")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false);

export const ThreadsToolkit = Toolkit.make(ThreadListTool, ThreadSendTool, ThreadCreateTool);
