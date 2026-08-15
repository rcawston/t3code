import {
  IsoDateTime,
  ModelSelection,
  ProjectId,
  ProviderInteractionMode,
  RuntimeMode,
  ThreadId,
  TrimmedNonEmptyString,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const ProjectionProposedThread = Schema.Struct({
  threadId: ThreadId,
  sourceThreadId: ThreadId,
  projectId: ProjectId,
  sourceTitle: TrimmedNonEmptyString,
  title: TrimmedNonEmptyString,
  message: Schema.String,
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode,
  createdAt: IsoDateTime,
});
export type ProjectionProposedThread = typeof ProjectionProposedThread.Type;

export const ListProjectionProposedThreadsBySourceInput = Schema.Struct({
  sourceThreadId: ThreadId,
});

export const DeleteProjectionProposedThreadInput = Schema.Struct({
  threadId: ThreadId,
});

export const DeleteProjectionProposedThreadsBySourceInput = Schema.Struct({
  sourceThreadId: ThreadId,
});

export interface ProjectionProposedThreadRepositoryShape {
  readonly upsert: (
    row: ProjectionProposedThread,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly listAll: () => Effect.Effect<
    ReadonlyArray<ProjectionProposedThread>,
    ProjectionRepositoryError
  >;
  readonly listBySourceThreadId: (
    input: typeof ListProjectionProposedThreadsBySourceInput.Type,
  ) => Effect.Effect<ReadonlyArray<ProjectionProposedThread>, ProjectionRepositoryError>;
  readonly deleteByThreadId: (
    input: typeof DeleteProjectionProposedThreadInput.Type,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly deleteBySourceThreadId: (
    input: typeof DeleteProjectionProposedThreadsBySourceInput.Type,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
}

export class ProjectionProposedThreadRepository extends Context.Service<
  ProjectionProposedThreadRepository,
  ProjectionProposedThreadRepositoryShape
>()("t3/persistence/Services/ProjectionProposedThreads/ProjectionProposedThreadRepository") {}
