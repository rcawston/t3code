import {
  THREAD_COORDINATION_MAX_MESSAGE_CHARS,
  type OrchestrationReadModel,
  type OrchestrationShellSnapshot,
  type OrchestrationThread,
  type OrchestrationThreadShell,
  type ThreadId,
} from "@t3tools/contracts";

export const THREAD_SEND_MAX_MESSAGE_CHARS = THREAD_COORDINATION_MAX_MESSAGE_CHARS;
export const THREAD_LIST_DEFAULT_LIMIT = 20;
export const THREAD_LIST_MAX_LIMIT = 50;

export type ThreadSendRejectReason =
  | "self"
  | "missing"
  | "archived"
  | "other_project"
  | "blank"
  | "oversized";

export interface ThreadListRow {
  readonly threadId: ThreadId;
  readonly title: string;
  readonly sessionStatus: string | null;
  readonly turnState: string | null;
  readonly branch: string | null;
  readonly worktreePath: string | null;
  readonly updatedAt: string;
}

export function validateThreadSendMessage(
  message: string,
):
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly reason: "blank" | "oversized" } {
  if (message.trim().length === 0) {
    return { ok: false, reason: "blank" };
  }
  if (message.length > THREAD_SEND_MAX_MESSAGE_CHARS) {
    return { ok: false, reason: "oversized" };
  }
  return { ok: true, text: message };
}

export function formatThreadCreateEnvelope(input: {
  readonly sourceThreadId: ThreadId;
  readonly sourceTitle: string;
  readonly message: string;
}): string {
  const title = input.sourceTitle.replace(/\s+/g, " ").trim() || "Untitled thread";
  return [
    `Started by T3 thread **${title}** (\`${input.sourceThreadId}\`) via T3 Code`,
    `Reply using thread_send to \`${input.sourceThreadId}\` only if useful.`,
    "",
    input.message,
  ].join("\n");
}

export function formatThreadSendEnvelope(input: {
  readonly sourceThreadId: ThreadId;
  readonly sourceTitle: string;
  readonly message: string;
}): string {
  const title = input.sourceTitle.replace(/\s+/g, " ").trim() || "Untitled thread";
  return [
    `Message from T3 thread **${title}** (\`${input.sourceThreadId}\`) via T3 Code`,
    `Reply using thread_send to \`${input.sourceThreadId}\` only if useful.`,
    "",
    input.message,
  ].join("\n");
}

const toListRow = (thread: OrchestrationThreadShell): ThreadListRow => ({
  threadId: thread.id,
  title: thread.title,
  sessionStatus: thread.session?.status ?? null,
  turnState: thread.latestTurn?.state ?? null,
  branch: thread.branch,
  worktreePath: thread.worktreePath,
  updatedAt: thread.updatedAt,
});

export function listSiblingThreads(
  snapshot: OrchestrationShellSnapshot,
  sourceThreadId: ThreadId,
  limit: number,
): ReadonlyArray<ThreadListRow> {
  const source = snapshot.threads.find((thread) => thread.id === sourceThreadId);
  if (source === undefined || source.archivedAt !== null) {
    return [];
  }
  const boundedLimit = Math.min(Math.max(limit, 1), THREAD_LIST_MAX_LIMIT);
  return snapshot.threads
    .filter(
      (thread) =>
        thread.id !== sourceThreadId &&
        thread.projectId === source.projectId &&
        thread.archivedAt === null,
    )
    .toSorted((left, right) => {
      const byUpdated = right.updatedAt.localeCompare(left.updatedAt);
      return byUpdated !== 0 ? byUpdated : right.id.localeCompare(left.id);
    })
    .slice(0, boundedLimit)
    .map(toListRow);
}

export function resolvePeerSendTarget(input: {
  readonly readModel: OrchestrationReadModel;
  readonly sourceThreadId: ThreadId;
  readonly targetThreadId: ThreadId;
}):
  | {
      readonly ok: true;
      readonly source: OrchestrationThread;
      readonly target: OrchestrationThread;
    }
  | { readonly ok: false; readonly reason: ThreadSendRejectReason; readonly detail: string } {
  if (input.sourceThreadId === input.targetThreadId) {
    return {
      ok: false,
      reason: "self",
      detail: `Thread '${input.targetThreadId}' cannot send a peer message to itself.`,
    };
  }
  const source = input.readModel.threads.find((thread) => thread.id === input.sourceThreadId);
  if (source === undefined || source.deletedAt !== null) {
    return {
      ok: false,
      reason: "missing",
      detail: `Source thread '${input.sourceThreadId}' does not exist.`,
    };
  }
  const target = input.readModel.threads.find((thread) => thread.id === input.targetThreadId);
  if (target === undefined || target.deletedAt !== null) {
    return {
      ok: false,
      reason: "missing",
      detail: `Thread '${input.targetThreadId}' does not exist.`,
    };
  }
  if (target.archivedAt !== null) {
    return {
      ok: false,
      reason: "archived",
      detail: `Thread '${input.targetThreadId}' is archived.`,
    };
  }
  if (source.archivedAt !== null) {
    return {
      ok: false,
      reason: "missing",
      detail: `Source thread '${input.sourceThreadId}' is not an active thread.`,
    };
  }
  if (source.projectId !== target.projectId) {
    return {
      ok: false,
      reason: "other_project",
      detail: `Thread '${input.targetThreadId}' is not in the same project.`,
    };
  }
  return { ok: true, source, target };
}
