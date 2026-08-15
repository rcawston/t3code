import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type OrchestrationCommand,
  type OrchestrationReadModel,
  type OrchestrationShellSnapshot,
  type OrchestrationThread,
  type OrchestrationThreadShell,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";

import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { OrchestrationEngineService } from "../../../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ThreadsToolkitHandlersLive } from "./handlers.ts";
import {
  THREAD_SEND_MAX_MESSAGE_CHARS,
  formatThreadSendEnvelope,
  listSiblingThreads,
  resolvePeerSendTarget,
  validateThreadSendMessage,
} from "./logic.ts";
import { ThreadSendRejectedError, ThreadsToolkit } from "./tools.ts";

const NOW = "2026-01-01T00:00:00.000Z";
const EARLIER = "2025-12-31T00:00:00.000Z";

const makeShell = (
  input: Partial<OrchestrationThreadShell> &
    Pick<OrchestrationThreadShell, "id" | "projectId" | "title">,
): OrchestrationThreadShell => ({
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
  runtimeMode: "full-access",
  interactionMode: "default",
  branch: input.branch ?? null,
  worktreePath: input.worktreePath ?? null,
  latestTurn: input.latestTurn ?? null,
  createdAt: NOW,
  updatedAt: input.updatedAt ?? NOW,
  archivedAt: input.archivedAt ?? null,
  settledOverride: null,
  settledAt: null,
  session: input.session ?? null,
  latestUserMessageAt: null,
  hasPendingApprovals: false,
  hasPendingUserInput: false,
  hasActionableProposedPlan: false,
  ...input,
});

const makeThread = (
  input: Partial<OrchestrationThread> & Pick<OrchestrationThread, "id" | "projectId" | "title">,
): OrchestrationThread => ({
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
  runtimeMode: "full-access",
  interactionMode: "default",
  branch: null,
  worktreePath: null,
  latestTurn: null,
  createdAt: NOW,
  updatedAt: NOW,
  archivedAt: null,
  settledOverride: null,
  settledAt: null,
  deletedAt: null,
  messages: [],
  proposedPlans: [],
  activities: [],
  checkpoints: [],
  session: null,
  ...input,
});

const snapshot: OrchestrationShellSnapshot = {
  snapshotSequence: 1,
  projects: [],
  threads: [
    makeShell({
      id: ThreadId.make("thread-self"),
      projectId: ProjectId.make("project-a"),
      title: "Self",
      updatedAt: NOW,
    }),
    makeShell({
      id: ThreadId.make("thread-sibling"),
      projectId: ProjectId.make("project-a"),
      title: "API review",
      branch: "feat/api",
      worktreePath: "/tmp/api",
      updatedAt: NOW,
      session: {
        threadId: ThreadId.make("thread-sibling"),
        status: "running",
        providerName: "Codex",
        runtimeMode: "full-access",
        activeTurnId: null,
        lastError: null,
        updatedAt: NOW,
      },
      latestTurn: {
        turnId: TurnId.make("turn-1"),
        state: "running",
        requestedAt: NOW,
        startedAt: NOW,
        completedAt: null,
        assistantMessageId: null,
      },
    }),
    makeShell({
      id: ThreadId.make("thread-older"),
      projectId: ProjectId.make("project-a"),
      title: "Older",
      updatedAt: EARLIER,
    }),
    makeShell({
      id: ThreadId.make("thread-other-project"),
      projectId: ProjectId.make("project-b"),
      title: "Other project",
      updatedAt: NOW,
    }),
    makeShell({
      id: ThreadId.make("thread-archived"),
      projectId: ProjectId.make("project-a"),
      title: "Archived",
      archivedAt: NOW,
      updatedAt: NOW,
    }),
  ],
  updatedAt: NOW,
};

it("lists same-project active siblings and excludes self and archived", () => {
  const rows = listSiblingThreads(snapshot, ThreadId.make("thread-self"), 20);
  expect(rows.map((row) => row.threadId)).toEqual([
    ThreadId.make("thread-sibling"),
    ThreadId.make("thread-older"),
  ]);
  expect(rows[0]).toMatchObject({
    title: "API review",
    sessionStatus: "running",
    turnState: "running",
    branch: "feat/api",
    worktreePath: "/tmp/api",
  });
});

it("bounds the sibling list by recency", () => {
  expect(
    listSiblingThreads(snapshot, ThreadId.make("thread-self"), 1).map((row) => row.threadId),
  ).toEqual([ThreadId.make("thread-sibling")]);
});

it("validates blank and oversized peer messages", () => {
  expect(validateThreadSendMessage("   ")).toEqual({ ok: false, reason: "blank" });
  expect(validateThreadSendMessage("x".repeat(THREAD_SEND_MAX_MESSAGE_CHARS + 1))).toEqual({
    ok: false,
    reason: "oversized",
  });
  expect(validateThreadSendMessage("hello")).toEqual({ ok: true, text: "hello" });
});

it("formats a server-authored attribution envelope", () => {
  expect(
    formatThreadSendEnvelope({
      sourceThreadId: ThreadId.make("thread-self"),
      sourceTitle: "API review",
      message: "Please verify pagination.",
    }),
  ).toBe(
    [
      "Message from T3 thread **API review** (`thread-self`) via T3 Code",
      "Reply using thread_send to `thread-self` only if useful.",
      "",
      "Please verify pagination.",
    ].join("\n"),
  );
});

it("resolves peer send routing without leaking other projects", () => {
  const readModel: OrchestrationReadModel = {
    snapshotSequence: 1,
    projects: [],
    threads: [
      makeThread({
        id: ThreadId.make("thread-self"),
        projectId: ProjectId.make("project-a"),
        title: "Self",
      }),
      makeThread({
        id: ThreadId.make("thread-sibling"),
        projectId: ProjectId.make("project-a"),
        title: "Sibling",
      }),
      makeThread({
        id: ThreadId.make("thread-other-project"),
        projectId: ProjectId.make("project-b"),
        title: "Other",
      }),
      makeThread({
        id: ThreadId.make("thread-archived"),
        projectId: ProjectId.make("project-a"),
        title: "Archived",
        archivedAt: NOW,
      }),
    ],
    updatedAt: NOW,
  };

  const rejected = (targetThreadId: string) =>
    resolvePeerSendTarget({
      readModel,
      sourceThreadId: ThreadId.make("thread-self"),
      targetThreadId: ThreadId.make(targetThreadId),
    });
  expect(rejected("thread-self")).toMatchObject({ ok: false, reason: "self" });
  expect(rejected("thread-missing")).toMatchObject({ ok: false, reason: "missing" });
  expect(rejected("thread-archived")).toMatchObject({ ok: false, reason: "archived" });
  expect(rejected("thread-other-project")).toMatchObject({ ok: false, reason: "other_project" });
  expect(rejected("thread-sibling")).toMatchObject({ ok: true });
});

const invocation: McpInvocationContext.McpInvocationScope = {
  environmentId: EnvironmentId.make("environment-1"),
  threadId: ThreadId.make("thread-self"),
  providerSessionId: "provider-session-1",
  providerInstanceId: ProviderInstanceId.make("codex"),
  capabilities: new Set(["preview", "threads"]),
  issuedAt: 1,
};

const unusedQuery = {
  getArchivedShellSnapshot: () => Effect.die("unused"),
  getSnapshot: () => Effect.die("unused"),
  getSnapshotSequence: () => Effect.die("unused"),
  getCounts: () => Effect.die("unused"),
  getActiveProjectByWorkspaceRoot: () => Effect.succeed(Option.none()),
  getProjectShellById: () => Effect.succeed(Option.none()),
  getFirstActiveThreadIdByProjectId: () => Effect.succeed(Option.none()),
  getThreadCheckpointContext: () => Effect.succeed(Option.none()),
  getFullThreadDiffContext: () => Effect.succeed(Option.none()),
  getThreadShellById: () => Effect.succeed(Option.none()),
  getThreadDetailById: () => Effect.succeed(Option.none()),
  getThreadDetailSnapshot: () => Effect.succeed(Option.none()),
  searchThreads: () => Effect.succeed({ matches: [] }),
};

const makeQuery = (input: {
  readonly shell?: OrchestrationShellSnapshot;
  readonly readModel?: OrchestrationReadModel;
}) =>
  ProjectionSnapshotQuery.of({
    ...unusedQuery,
    getShellSnapshot: () => Effect.succeed(input.shell ?? snapshot),
    getCommandReadModel: () =>
      Effect.succeed(
        input.readModel ?? {
          snapshotSequence: 1,
          projects: [],
          threads: [
            makeThread({
              id: ThreadId.make("thread-self"),
              projectId: ProjectId.make("project-a"),
              title: "API review",
            }),
            makeThread({
              id: ThreadId.make("thread-sibling"),
              projectId: ProjectId.make("project-a"),
              title: "Sibling",
              runtimeMode: "auto",
              interactionMode: "plan",
            }),
          ],
          updatedAt: NOW,
        },
      ),
  });

const makeEngine = (dispatched: Array<OrchestrationCommand>) =>
  OrchestrationEngineService.of({
    dispatch: (command) =>
      Effect.sync(() => {
        dispatched.push(command);
        return { sequence: 42 };
      }),
    readEvents: () => Stream.empty,
    streamDomainEvents: Stream.empty,
    latestSequence: Effect.succeed(0),
  });

const runTool = (
  name: "thread_list" | "thread_send",
  params: Record<string, unknown>,
  input: {
    readonly invocation?: McpInvocationContext.McpInvocationScope;
    readonly dispatched?: Array<OrchestrationCommand>;
    readonly query?: ReturnType<typeof makeQuery>;
  } = {},
) =>
  Effect.gen(function* () {
    const built = yield* ThreadsToolkit;
    const stream = yield* built.handle(name, params as never);
    return yield* Stream.run(stream, Sink.last()).pipe(Effect.flatMap(Effect.fromOption));
  }).pipe(
    Effect.provideService(
      McpInvocationContext.McpInvocationContext,
      input.invocation ?? invocation,
    ),
    Effect.provide(
      ThreadsToolkitHandlersLive.pipe(
        Layer.provideMerge(Layer.succeed(ProjectionSnapshotQuery, input.query ?? makeQuery({}))),
        Layer.provideMerge(
          Layer.succeed(OrchestrationEngineService, makeEngine(input.dispatched ?? [])),
        ),
        Layer.provideMerge(NodeServices.layer),
      ),
    ),
  );

it.effect("lists siblings through the toolkit without including this thread", () =>
  Effect.gen(function* () {
    const result = yield* runTool("thread_list", {});
    expect(result.encodedResult).toMatchObject({
      threads: [
        { threadId: "thread-sibling", title: "API review" },
        { threadId: "thread-older", title: "Older" },
      ],
    });
  }),
);

it.effect("dispatches an attributed turn start and returns an acceptance receipt", () =>
  Effect.gen(function* () {
    const dispatched: Array<OrchestrationCommand> = [];
    const result = yield* runTool(
      "thread_send",
      {
        threadId: ThreadId.make("thread-sibling"),
        message: "Please verify pagination.",
      },
      { dispatched },
    );

    expect(result.encodedResult).toMatchObject({
      accepted: true,
      threadId: "thread-sibling",
      sequence: 42,
    });
    expect(result.encodedResult).not.toHaveProperty("messages");
    expect(result.encodedResult).not.toHaveProperty("transcript");
    expect(dispatched).toHaveLength(1);
    const command = dispatched[0];
    if (command?.type !== "thread.turn.start") {
      throw new Error("expected thread.turn.start");
    }
    expect(command.sourceThreadId).toBe(ThreadId.make("thread-self"));
    expect(command.runtimeMode).toBe("auto");
    expect(command.interactionMode).toBe("plan");
    expect(command.message.text).toContain("Message from T3 thread **API review**");
    expect(command.message.text).toContain("Please verify pagination.");
    expect(command.message.text).not.toContain("transcript");
  }),
);

it.effect(
  "rejects blank, oversized, self, missing, archived, and cross-project sends before dispatch",
  () =>
    Effect.gen(function* () {
      const dispatched: Array<OrchestrationCommand> = [];
      const blank = yield* runTool(
        "thread_send",
        { threadId: ThreadId.make("thread-sibling"), message: "  " },
        { dispatched },
      ).pipe(Effect.flip);
      expect(blank).toBeInstanceOf(ThreadSendRejectedError);
      expect(blank).toMatchObject({ reason: "blank" });

      const oversized = yield* runTool(
        "thread_send",
        {
          threadId: ThreadId.make("thread-sibling"),
          message: "x".repeat(THREAD_SEND_MAX_MESSAGE_CHARS + 1),
        },
        { dispatched },
      ).pipe(Effect.flip);
      expect(oversized).toMatchObject({ reason: "oversized" });

      const self = yield* runTool(
        "thread_send",
        {
          threadId: ThreadId.make("thread-self"),
          message: "loop",
        },
        { dispatched },
      ).pipe(Effect.flip);
      expect(self).toMatchObject({ reason: "self" });

      const missing = yield* runTool(
        "thread_send",
        {
          threadId: ThreadId.make("thread-missing"),
          message: "hello",
        },
        { dispatched },
      ).pipe(Effect.flip);
      expect(missing).toMatchObject({ reason: "missing" });

      const archived = yield* runTool(
        "thread_send",
        {
          threadId: ThreadId.make("thread-archived"),
          message: "hello",
        },
        {
          dispatched,
          query: makeQuery({
            readModel: {
              snapshotSequence: 1,
              projects: [],
              threads: [
                makeThread({
                  id: ThreadId.make("thread-self"),
                  projectId: ProjectId.make("project-a"),
                  title: "API review",
                }),
                makeThread({
                  id: ThreadId.make("thread-archived"),
                  projectId: ProjectId.make("project-a"),
                  title: "Archived",
                  archivedAt: NOW,
                }),
                makeThread({
                  id: ThreadId.make("thread-other-project"),
                  projectId: ProjectId.make("project-b"),
                  title: "Other",
                }),
              ],
              updatedAt: NOW,
            },
          }),
        },
      ).pipe(Effect.flip);
      expect(archived).toMatchObject({ reason: "archived" });

      const otherProject = yield* runTool(
        "thread_send",
        {
          threadId: ThreadId.make("thread-other-project"),
          message: "hello",
        },
        {
          dispatched,
          query: makeQuery({
            readModel: {
              snapshotSequence: 1,
              projects: [],
              threads: [
                makeThread({
                  id: ThreadId.make("thread-self"),
                  projectId: ProjectId.make("project-a"),
                  title: "API review",
                }),
                makeThread({
                  id: ThreadId.make("thread-other-project"),
                  projectId: ProjectId.make("project-b"),
                  title: "Other",
                }),
              ],
              updatedAt: NOW,
            },
          }),
        },
      ).pipe(Effect.flip);
      expect(otherProject).toMatchObject({ reason: "other_project" });
      expect(dispatched).toEqual([]);
    }),
);

it.effect("rejects a credential that does not grant threads", () =>
  Effect.gen(function* () {
    const error = yield* runTool(
      "thread_list",
      {},
      {
        invocation: { ...invocation, capabilities: new Set(["preview"]) },
      },
    ).pipe(Effect.flip);
    expect(error).toBeInstanceOf(McpInvocationContext.McpCapabilityUnavailableError);
  }),
);
