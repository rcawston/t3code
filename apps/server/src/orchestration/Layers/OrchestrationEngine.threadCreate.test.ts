import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { OrchestrationCommandReceiptRepositoryLive } from "../../persistence/Layers/OrchestrationCommandReceipts.ts";
import { OrchestrationEventStoreLive } from "../../persistence/Layers/OrchestrationEventStore.ts";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import * as RepositoryIdentityResolver from "../../project/RepositoryIdentityResolver.ts";
import { ServerConfig } from "../../config.ts";
import { OrchestrationEngineLive } from "./OrchestrationEngine.ts";
import { OrchestrationProjectionPipelineLive } from "./ProjectionPipeline.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "./ProjectionSnapshotQuery.ts";
import * as ThreadBackgroundLiveness from "../ThreadBackgroundLiveness.ts";
import * as ThreadPlanProgress from "../ThreadPlanProgress.ts";
import {
  OrchestrationEngineService,
  type OrchestrationEngineShape,
} from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";

const asProjectId = (value: string): ProjectId => ProjectId.make(value);

const TestLayer = Layer.mergeAll(
  OrchestrationEngineLive.pipe(
    Layer.provide(OrchestrationProjectionSnapshotQueryLive),
    Layer.provide(OrchestrationProjectionPipelineLive),
  ),
  OrchestrationProjectionSnapshotQueryLive,
).pipe(
  Layer.provide(ThreadBackgroundLiveness.layer),
  Layer.provide(ThreadPlanProgress.layer),
  Layer.provide(OrchestrationEventStoreLive),
  Layer.provide(OrchestrationCommandReceiptRepositoryLive),
  Layer.provide(RepositoryIdentityResolver.layer),
  Layer.provide(SqlitePersistenceMemory),
  Layer.provideMerge(
    ServerConfig.layerTest(process.cwd(), { prefix: "t3-orchestration-thread-create-test-" }),
  ),
  Layer.provideMerge(NodeServices.layer),
);

const seedProjectAndSource = Effect.fn("seedProjectAndSource")(function* (
  engine: OrchestrationEngineShape,
  ids: {
    readonly projectId: string;
    readonly sourceThreadId: string;
  },
) {
  const createdAt = "2026-01-01T00:00:00.000Z";
  yield* engine.dispatch({
    type: "project.create",
    commandId: CommandId.make(`cmd-project-create-${ids.projectId}`),
    projectId: asProjectId(ids.projectId),
    title: "Project 1",
    workspaceRoot: `/tmp/${ids.projectId}`,
    defaultModelSelection: {
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5-codex",
    },
    createdAt,
  });
  yield* engine.dispatch({
    type: "thread.create",
    commandId: CommandId.make(`cmd-thread-source-${ids.sourceThreadId}`),
    threadId: ThreadId.make(ids.sourceThreadId),
    projectId: asProjectId(ids.projectId),
    title: "API review",
    modelSelection: {
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5-codex",
    },
    interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
    runtimeMode: "approval-required",
    branch: null,
    worktreePath: null,
    createdAt,
  });
  return createdAt;
});

it.layer(TestLayer)("OrchestrationEngine sibling thread create", (it) => {
  it.effect("creates and starts a sibling in the project workspace without a worktree", () =>
    Effect.gen(function* () {
      const engine = yield* OrchestrationEngineService;
      const snapshotQuery = yield* ProjectionSnapshotQuery;
      const createdAt = yield* seedProjectAndSource(engine, {
        projectId: "project-auto",
        sourceThreadId: "thread-source-auto",
      });

      yield* engine.dispatch({
        type: "thread.create",
        commandId: CommandId.make("cmd-thread-create"),
        threadId: ThreadId.make("thread-new-auto"),
        projectId: asProjectId("project-auto"),
        title: "Pagination check",
        modelSelection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5-codex",
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        branch: null,
        worktreePath: null,
        createdAt,
      });
      yield* engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-thread-start"),
        threadId: ThreadId.make("thread-new-auto"),
        sourceThreadId: ThreadId.make("thread-source-auto"),
        message: {
          messageId: MessageId.make("msg-create"),
          role: "user",
          text: "Please verify pagination.",
          attachments: [],
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt,
      });

      const shell = yield* snapshotQuery.getShellSnapshot();
      const created = shell.threads.find(
        (thread) => thread.id === ThreadId.make("thread-new-auto"),
      );
      expect(created?.projectId).toBe(asProjectId("project-auto"));
      expect(created?.worktreePath).toBeNull();
      expect(created?.title).toBe("Pagination check");
    }),
  );

  it.effect("keeps a manual proposal off the thread list until it is confirmed", () =>
    Effect.gen(function* () {
      const engine = yield* OrchestrationEngineService;
      const snapshotQuery = yield* ProjectionSnapshotQuery;
      const createdAt = yield* seedProjectAndSource(engine, {
        projectId: "project-manual",
        sourceThreadId: "thread-source-manual",
      });

      yield* engine.dispatch({
        type: "thread.propose",
        commandId: CommandId.make("cmd-propose"),
        threadId: ThreadId.make("thread-new-manual"),
        sourceThreadId: ThreadId.make("thread-source-manual"),
        title: "Pagination check",
        message: "Please verify pagination.",
        modelSelection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5-codex",
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt,
      });

      const proposedShell = yield* snapshotQuery.getShellSnapshot();
      const source = proposedShell.threads.find(
        (thread) => thread.id === ThreadId.make("thread-source-manual"),
      );
      expect(source?.proposedThreads?.map((entry) => entry.threadId)).toEqual([
        ThreadId.make("thread-new-manual"),
      ]);
      expect(
        proposedShell.threads.some((thread) => thread.id === ThreadId.make("thread-new-manual")),
      ).toBe(false);

      yield* engine.dispatch({
        type: "thread.proposal.respond",
        commandId: CommandId.make("cmd-confirm"),
        threadId: ThreadId.make("thread-new-manual"),
        decision: "confirm",
        createdAt,
      });

      const confirmedShell = yield* snapshotQuery.getShellSnapshot();
      const confirmedSource = confirmedShell.threads.find(
        (thread) => thread.id === ThreadId.make("thread-source-manual"),
      );
      expect(confirmedSource?.proposedThreads).toEqual([]);
      const created = confirmedShell.threads.find(
        (thread) => thread.id === ThreadId.make("thread-new-manual"),
      );
      expect(created?.projectId).toBe(asProjectId("project-manual"));
      expect(created?.worktreePath).toBeNull();

      const readModel = yield* snapshotQuery.getSnapshot();
      const createdDetail = readModel.threads.find(
        (thread) => thread.id === ThreadId.make("thread-new-manual"),
      );
      expect(createdDetail?.messages[0]?.text).toBe("Please verify pagination.");
    }),
  );

  it.effect("dismisses a proposal without creating a thread", () =>
    Effect.gen(function* () {
      const engine = yield* OrchestrationEngineService;
      const snapshotQuery = yield* ProjectionSnapshotQuery;
      const createdAt = yield* seedProjectAndSource(engine, {
        projectId: "project-dismiss",
        sourceThreadId: "thread-source-dismiss",
      });

      yield* engine.dispatch({
        type: "thread.propose",
        commandId: CommandId.make("cmd-propose-dismiss"),
        threadId: ThreadId.make("thread-new-dismiss"),
        sourceThreadId: ThreadId.make("thread-source-dismiss"),
        title: "Pagination check",
        message: "Please verify pagination.",
        modelSelection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5-codex",
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt,
      });
      yield* engine.dispatch({
        type: "thread.proposal.respond",
        commandId: CommandId.make("cmd-dismiss"),
        threadId: ThreadId.make("thread-new-dismiss"),
        decision: "dismiss",
        createdAt,
      });

      const shell = yield* snapshotQuery.getShellSnapshot();
      const source = shell.threads.find(
        (thread) => thread.id === ThreadId.make("thread-source-dismiss"),
      );
      expect(source?.proposedThreads).toEqual([]);
      expect(
        shell.threads.some((thread) => thread.id === ThreadId.make("thread-new-dismiss")),
      ).toBe(false);
    }),
  );
});
