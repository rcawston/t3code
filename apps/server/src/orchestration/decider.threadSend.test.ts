import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  MessageId,
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
  readonly archivedAt?: string | null;
  readonly deletedAt?: string | null;
  readonly runtimeMode?: OrchestrationThread["runtimeMode"];
  readonly interactionMode?: OrchestrationThread["interactionMode"];
}): OrchestrationThread {
  return {
    id: ThreadId.make(input.id),
    projectId: ProjectId.make(input.projectId),
    title: input.id,
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
    runtimeMode: input.runtimeMode ?? "full-access",
    interactionMode: input.interactionMode ?? "default",
    branch: null,
    worktreePath: null,
    latestTurn: null,
    createdAt: NOW,
    updatedAt: NOW,
    archivedAt: input.archivedAt ?? null,
    settledOverride: null,
    settledAt: null,
    deletedAt: input.deletedAt ?? null,
    messages: [],
    proposedPlans: [],
    proposedThreads: [],
    activities: [],
    checkpoints: [],
    session: null,
  };
}

function makeReadModel(threads: ReadonlyArray<OrchestrationThread>): OrchestrationReadModel {
  return {
    snapshotSequence: 0,
    projects: [],
    threads: [...threads],
    updatedAt: NOW,
  };
}

function peerSendCommand(input?: {
  readonly targetId?: string;
  readonly sourceId?: string;
  readonly text?: string;
}) {
  return {
    type: "thread.turn.start" as const,
    commandId: CommandId.make("cmd-peer-send"),
    threadId: ThreadId.make(input?.targetId ?? "thread-target"),
    sourceThreadId: ThreadId.make(input?.sourceId ?? "thread-source"),
    message: {
      messageId: MessageId.make("msg-peer"),
      role: "user" as const,
      text: input?.text ?? "please review",
      attachments: [],
    },
    interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
    runtimeMode: "approval-required" as const,
    createdAt: NOW,
  };
}

it.layer(NodeServices.layer)("decider peer thread send", (it) => {
  it.effect("emits an attributed turn start for a same-project sibling", () =>
    Effect.gen(function* () {
      const result = yield* decideOrchestrationCommand({
        command: peerSendCommand(),
        readModel: makeReadModel([
          makeThread({
            id: "thread-source",
            projectId: "project-1",
          }),
          makeThread({
            id: "thread-target",
            projectId: "project-1",
            runtimeMode: "auto",
            interactionMode: "plan",
          }),
        ]),
      });
      const events = Array.isArray(result) ? result : [result];
      expect(events.map((event) => event.type)).toEqual([
        "thread.message-sent",
        "thread.turn-start-requested",
      ]);
      const turnStart = events[1];
      if (turnStart?.type !== "thread.turn-start-requested") {
        throw new Error("expected turn-start-requested");
      }
      expect(turnStart.payload.runtimeMode).toBe("auto");
      expect(turnStart.payload.interactionMode).toBe("plan");
      expect(events[0]?.type === "thread.message-sent" && events[0].payload.text).toBe(
        "please review",
      );
    }),
  );

  it.effect("rejects self, missing, archived, and cross-project peer sends", () =>
    Effect.gen(function* () {
      const siblings = makeReadModel([
        makeThread({ id: "thread-source", projectId: "project-1" }),
        makeThread({ id: "thread-target", projectId: "project-1" }),
        makeThread({ id: "thread-other-project", projectId: "project-2" }),
        makeThread({ id: "thread-archived", projectId: "project-1", archivedAt: NOW }),
        makeThread({ id: "thread-deleted", projectId: "project-1", deletedAt: NOW }),
      ]);

      const self = yield* decideOrchestrationCommand({
        command: peerSendCommand({ targetId: "thread-source", sourceId: "thread-source" }),
        readModel: siblings,
      }).pipe(Effect.flip);
      expect(self.message).toContain("cannot send a peer message to itself");

      const missing = yield* decideOrchestrationCommand({
        command: peerSendCommand({ targetId: "thread-missing" }),
        readModel: siblings,
      }).pipe(Effect.flip);
      expect(missing.message).toContain("does not exist");

      const archived = yield* decideOrchestrationCommand({
        command: peerSendCommand({ targetId: "thread-archived" }),
        readModel: siblings,
      }).pipe(Effect.flip);
      expect(archived.message).toContain("already archived");

      const deleted = yield* decideOrchestrationCommand({
        command: peerSendCommand({ targetId: "thread-deleted" }),
        readModel: siblings,
      }).pipe(Effect.flip);
      expect(deleted.message).toContain("does not exist");

      const otherProject = yield* decideOrchestrationCommand({
        command: peerSendCommand({ targetId: "thread-other-project" }),
        readModel: siblings,
      }).pipe(Effect.flip);
      expect(otherProject.message).toContain("not in the same project");
    }),
  );

  it.effect("still allows a normal turn start without sourceThreadId on an archived thread", () =>
    Effect.gen(function* () {
      const result = yield* decideOrchestrationCommand({
        command: {
          type: "thread.turn.start",
          commandId: CommandId.make("cmd-ui-turn"),
          threadId: ThreadId.make("thread-archived"),
          message: {
            messageId: MessageId.make("msg-ui"),
            role: "user",
            text: "continue",
            attachments: [],
          },
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          runtimeMode: "approval-required",
          createdAt: NOW,
        },
        readModel: makeReadModel([
          makeThread({ id: "thread-archived", projectId: "project-1", archivedAt: NOW }),
        ]),
      });
      const events = Array.isArray(result) ? result : [result];
      expect(events.map((event) => event.type)).toEqual([
        "thread.message-sent",
        "thread.turn-start-requested",
      ]);
    }),
  );
});
