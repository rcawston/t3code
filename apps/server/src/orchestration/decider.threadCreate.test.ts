import {
  CommandId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationReadModel,
  type OrchestrationThread,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { decideOrchestrationCommand } from "./decider.ts";

const NOW = "2026-01-01T00:00:00.000Z";

function makeThread(input: {
  readonly id: string;
  readonly projectId: string;
  readonly proposedThreads?: OrchestrationThread["proposedThreads"];
}): OrchestrationThread {
  return {
    id: ThreadId.make(input.id),
    projectId: ProjectId.make(input.projectId),
    title: input.id,
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
    proposedThreads: input.proposedThreads ?? [],
    activities: [],
    checkpoints: [],
    session: null,
  };
}

function makeReadModel(threads: ReadonlyArray<OrchestrationThread>): OrchestrationReadModel {
  return {
    snapshotSequence: 0,
    projects: [
      {
        id: ProjectId.make("project-1"),
        title: "Project",
        workspaceRoot: "/tmp/project-1",
        defaultModelSelection: null,
        scripts: [],
        createdAt: NOW,
        updatedAt: NOW,
        deletedAt: null,
      },
    ],
    threads: [...threads],
    updatedAt: NOW,
  };
}

const proposal = {
  threadId: ThreadId.make("thread-new"),
  projectId: ProjectId.make("project-1"),
  sourceThreadId: ThreadId.make("thread-source"),
  sourceTitle: "API review",
  title: "Pagination check",
  message: "Please verify pagination.",
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
  runtimeMode: "full-access" as const,
  interactionMode: "default" as const,
  createdAt: NOW,
};

it.layer(NodeServices.layer)("decider thread create proposals", (it) => {
  it.effect("records a proposal on the source thread", () =>
    Effect.gen(function* () {
      const result = yield* decideOrchestrationCommand({
        command: {
          type: "thread.propose",
          commandId: CommandId.make("cmd-propose"),
          threadId: ThreadId.make("thread-new"),
          sourceThreadId: ThreadId.make("thread-source"),
          title: "Pagination check",
          message: "Please verify pagination.",
          modelSelection: proposal.modelSelection,
          runtimeMode: "full-access",
          interactionMode: "default",
          createdAt: NOW,
        },
        readModel: makeReadModel([makeThread({ id: "thread-source", projectId: "project-1" })]),
      });
      const event = Array.isArray(result) ? result[0] : result;
      expect(event.type).toBe("thread.proposed");
      if (event.type !== "thread.proposed") return;
      expect(event.payload.proposedThread.projectId).toBe(ProjectId.make("project-1"));
      expect(event.payload.proposedThread.title).toBe("Pagination check");
    }),
  );

  it.effect("dismisses a proposal without creating a thread", () =>
    Effect.gen(function* () {
      const result = yield* decideOrchestrationCommand({
        command: {
          type: "thread.proposal.respond",
          commandId: CommandId.make("cmd-dismiss"),
          threadId: ThreadId.make("thread-new"),
          decision: "dismiss",
          createdAt: NOW,
        },
        readModel: makeReadModel([
          makeThread({
            id: "thread-source",
            projectId: "project-1",
            proposedThreads: [proposal],
          }),
        ]),
      });
      const event = Array.isArray(result) ? result[0] : result;
      expect(event.type).toBe("thread.proposal-dismissed");
    }),
  );

  it.effect("confirms a proposal by creating and starting the reserved thread", () =>
    Effect.gen(function* () {
      const result = yield* decideOrchestrationCommand({
        command: {
          type: "thread.proposal.respond",
          commandId: CommandId.make("cmd-confirm"),
          threadId: ThreadId.make("thread-new"),
          decision: "confirm",
          createdAt: NOW,
        },
        readModel: makeReadModel([
          makeThread({
            id: "thread-source",
            projectId: "project-1",
            proposedThreads: [proposal],
          }),
        ]),
      });
      const events = Array.isArray(result) ? result : [result];
      expect(events.map((event) => event.type)).toEqual([
        "thread.proposal-dismissed",
        "thread.created",
        "thread.message-sent",
        "thread.turn-start-requested",
      ]);
      const created = events[1];
      if (created?.type !== "thread.created") return;
      expect(created.payload.worktreePath).toBeNull();
      expect(created.payload.projectId).toBe(ProjectId.make("project-1"));
    }),
  );

  it.effect("rejects a missing proposal and a duplicate reserved thread id", () =>
    Effect.gen(function* () {
      const missing = yield* decideOrchestrationCommand({
        command: {
          type: "thread.proposal.respond",
          commandId: CommandId.make("cmd-missing"),
          threadId: ThreadId.make("thread-new"),
          decision: "dismiss",
          createdAt: NOW,
        },
        readModel: makeReadModel([makeThread({ id: "thread-source", projectId: "project-1" })]),
      }).pipe(Effect.flip);
      expect(missing._tag).toBe("OrchestrationCommandInvariantError");

      const duplicate = yield* decideOrchestrationCommand({
        command: {
          type: "thread.propose",
          commandId: CommandId.make("cmd-dup"),
          threadId: ThreadId.make("thread-new"),
          sourceThreadId: ThreadId.make("thread-source"),
          title: "Pagination check",
          message: "Please verify pagination.",
          modelSelection: proposal.modelSelection,
          runtimeMode: "full-access",
          interactionMode: "default",
          createdAt: NOW,
        },
        readModel: makeReadModel([
          makeThread({
            id: "thread-source",
            projectId: "project-1",
            proposedThreads: [proposal],
          }),
        ]),
      }).pipe(Effect.flip);
      expect(duplicate._tag).toBe("OrchestrationCommandInvariantError");
    }),
  );
});
