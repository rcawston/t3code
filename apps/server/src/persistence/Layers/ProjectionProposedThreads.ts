import { ModelSelection } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Struct from "effect/Struct";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { toPersistenceSqlError } from "../Errors.ts";
import {
  DeleteProjectionProposedThreadInput,
  DeleteProjectionProposedThreadsBySourceInput,
  ListProjectionProposedThreadsBySourceInput,
  ProjectionProposedThread,
  ProjectionProposedThreadRepository,
  type ProjectionProposedThreadRepositoryShape,
} from "../Services/ProjectionProposedThreads.ts";

const ProjectionProposedThreadDbRow = ProjectionProposedThread.mapFields(
  Struct.assign({
    modelSelection: Schema.fromJsonString(ModelSelection),
  }),
);

const makeProjectionProposedThreadRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertRow = SqlSchema.void({
    Request: ProjectionProposedThread,
    execute: (row) => sql`
      INSERT INTO projection_proposed_threads (
        thread_id,
        source_thread_id,
        project_id,
        source_title,
        title,
        message,
        model_selection_json,
        runtime_mode,
        interaction_mode,
        created_at
      )
      VALUES (
        ${row.threadId},
        ${row.sourceThreadId},
        ${row.projectId},
        ${row.sourceTitle},
        ${row.title},
        ${row.message},
        ${JSON.stringify(row.modelSelection)},
        ${row.runtimeMode},
        ${row.interactionMode},
        ${row.createdAt}
      )
      ON CONFLICT (thread_id)
      DO UPDATE SET
        source_thread_id = excluded.source_thread_id,
        project_id = excluded.project_id,
        source_title = excluded.source_title,
        title = excluded.title,
        message = excluded.message,
        model_selection_json = excluded.model_selection_json,
        runtime_mode = excluded.runtime_mode,
        interaction_mode = excluded.interaction_mode,
        created_at = excluded.created_at
    `,
  });

  const listAllRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionProposedThreadDbRow,
    execute: () => sql`
      SELECT
        thread_id AS "threadId",
        source_thread_id AS "sourceThreadId",
        project_id AS "projectId",
        source_title AS "sourceTitle",
        title,
        message,
        model_selection_json AS "modelSelection",
        runtime_mode AS "runtimeMode",
        interaction_mode AS "interactionMode",
        created_at AS "createdAt"
      FROM projection_proposed_threads
      ORDER BY created_at ASC, thread_id ASC
    `,
  });

  const listBySourceRows = SqlSchema.findAll({
    Request: ListProjectionProposedThreadsBySourceInput,
    Result: ProjectionProposedThreadDbRow,
    execute: ({ sourceThreadId }) => sql`
      SELECT
        thread_id AS "threadId",
        source_thread_id AS "sourceThreadId",
        project_id AS "projectId",
        source_title AS "sourceTitle",
        title,
        message,
        model_selection_json AS "modelSelection",
        runtime_mode AS "runtimeMode",
        interaction_mode AS "interactionMode",
        created_at AS "createdAt"
      FROM projection_proposed_threads
      WHERE source_thread_id = ${sourceThreadId}
      ORDER BY created_at ASC, thread_id ASC
    `,
  });

  const deleteByThreadIdRow = SqlSchema.void({
    Request: DeleteProjectionProposedThreadInput,
    execute: ({ threadId }) => sql`
      DELETE FROM projection_proposed_threads
      WHERE thread_id = ${threadId}
    `,
  });

  const deleteBySourceRow = SqlSchema.void({
    Request: DeleteProjectionProposedThreadsBySourceInput,
    execute: ({ sourceThreadId }) => sql`
      DELETE FROM projection_proposed_threads
      WHERE source_thread_id = ${sourceThreadId}
    `,
  });

  return {
    upsert: (row) =>
      upsertRow(row).pipe(
        Effect.mapError(toPersistenceSqlError("ProjectionProposedThreadRepository.upsert:query")),
      ),
    listAll: () =>
      listAllRows().pipe(
        Effect.mapError(toPersistenceSqlError("ProjectionProposedThreadRepository.listAll:query")),
      ),
    listBySourceThreadId: (input) =>
      listBySourceRows(input).pipe(
        Effect.mapError(
          toPersistenceSqlError("ProjectionProposedThreadRepository.listBySourceThreadId:query"),
        ),
      ),
    deleteByThreadId: (input) =>
      deleteByThreadIdRow(input).pipe(
        Effect.mapError(
          toPersistenceSqlError("ProjectionProposedThreadRepository.deleteByThreadId:query"),
        ),
      ),
    deleteBySourceThreadId: (input) =>
      deleteBySourceRow(input).pipe(
        Effect.mapError(
          toPersistenceSqlError("ProjectionProposedThreadRepository.deleteBySourceThreadId:query"),
        ),
      ),
  } satisfies ProjectionProposedThreadRepositoryShape;
});

export const ProjectionProposedThreadRepositoryLive = Layer.effect(
  ProjectionProposedThreadRepository,
  makeProjectionProposedThreadRepository,
);
