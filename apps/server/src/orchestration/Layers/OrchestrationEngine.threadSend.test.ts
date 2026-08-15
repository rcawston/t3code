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
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
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
    ServerConfig.layerTest(process.cwd(), { prefix: "t3-orchestration-thread-send-test-" }),
  ),
  Layer.provideMerge(NodeServices.layer),
);

it.layer(TestLayer)("OrchestrationEngine peer thread send", (it) => {
  it.effect("commits an attributed turn start before any provider work", () =>
    Effect.gen(function* () {
      const createdAt = "2026-01-01T00:00:00.000Z";
      const engine = yield* OrchestrationEngineService;
      const snapshotQuery = yield* ProjectionSnapshotQuery;

      yield* engine.dispatch({
        type: "project.create",
        commandId: CommandId.make("cmd-project-create"),
        projectId: asProjectId("project-1"),
        title: "Project 1",
        workspaceRoot: "/tmp/project-1",
        defaultModelSelection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5-codex",
        },
        createdAt,
      });
      yield* engine.dispatch({
        type: "thread.create",
        commandId: CommandId.make("cmd-thread-source"),
        threadId: ThreadId.make("thread-source"),
        projectId: asProjectId("project-1"),
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
      yield* engine.dispatch({
        type: "thread.create",
        commandId: CommandId.make("cmd-thread-target"),
        threadId: ThreadId.make("thread-target"),
        projectId: asProjectId("project-1"),
        title: "Implementer",
        modelSelection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5-codex",
        },
        interactionMode: "plan",
        runtimeMode: "auto",
        branch: null,
        worktreePath: null,
        createdAt,
      });

      const receipt = yield* engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-peer-send"),
        threadId: ThreadId.make("thread-target"),
        sourceThreadId: ThreadId.make("thread-source"),
        message: {
          messageId: MessageId.make("msg-peer"),
          role: "user",
          text: [
            "Message from T3 thread **API review** (`thread-source`) via T3 Code",
            "Reply using thread_send to `thread-source` only if useful.",
            "",
            "Please verify pagination.",
          ].join("\n"),
          attachments: [],
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt,
      });

      expect(receipt.sequence).toBeGreaterThan(0);
      const readModel = yield* snapshotQuery.getSnapshot();
      const target = readModel.threads.find(
        (thread) => thread.id === ThreadId.make("thread-target"),
      );
      expect(target?.messages.map((message) => message.role)).toEqual(["user"]);
      expect(target?.messages[0]?.text).toContain("Message from T3 thread **API review**");
      expect(target?.messages[0]?.text).toContain("Please verify pagination.");
      expect(target?.interactionMode).toBe("plan");
      expect(target?.runtimeMode).toBe("auto");
    }),
  );
});
