import * as Effect from "effect/Effect";
import * as Migrator from "effect/unstable/sql/Migrator";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import ProjectionProposedThreads from "./ForkMigrations/001_ProjectionProposedThreads.ts";
import AuthSessionClientConnection from "./Migrations/041_AuthSessionClientConnection.ts";

const CORE_MIGRATIONS_TABLE = "effect_sql_migrations";
const FORK_MIGRATIONS_TABLE = "t3_fork_migrations";

const run = Migrator.make({});
const loader = Migrator.fromRecord({
  "1_ProjectionProposedThreads": ProjectionProposedThreads,
});

export const reconcileLegacyForkMigrationHistory = Effect.fn("reconcileLegacyForkMigrationHistory")(
  function* () {
    const sql = yield* SqlClient.SqlClient;
    const migrationTables = yield* sql<{ readonly name: string }>`
      SELECT name
      FROM sqlite_master
      WHERE type = 'table' AND name = ${CORE_MIGRATIONS_TABLE}
    `;
    if (migrationTables.length === 0) {
      return;
    }

    yield* sql.withTransaction(
      Effect.gen(function* () {
        // Serialize reconciliation before inspecting schema so parallel starts cannot both add it.
        yield* sql`
          UPDATE effect_sql_migrations
          SET name = name
          WHERE migration_id = -1
        `;
        const legacyEntries = yield* sql<{
          readonly migration_id: number;
          readonly name: string;
        }>`
          SELECT migration_id, name
          FROM effect_sql_migrations
          WHERE
            (migration_id = 41 AND name = 'ProjectionProposedThreads')
            OR (migration_id = 43 AND name = 'ProjectionProposedThreads')
            OR (migration_id = 44 AND name = 'ProjectionProposedThreads')
        `;
        if (legacyEntries.length === 0) {
          return;
        }

        if (legacyEntries.some(({ migration_id }) => migration_id === 41)) {
          yield* AuthSessionClientConnection;
        }

        const projectionTables = yield* sql<{ readonly name: string }>`
          SELECT name
          FROM sqlite_master
          WHERE type = 'table' AND name = 'projection_threads'
        `;
        if (projectionTables.length > 0) {
          const columns = yield* sql<{ readonly name: string }>`
            PRAGMA table_info(projection_threads)
          `;
          if (!columns.some((column) => column.name === "unsettled_at")) {
            yield* sql`
              ALTER TABLE projection_threads
              ADD COLUMN unsettled_at TEXT
            `;
          }
        }

        yield* sql`
          UPDATE effect_sql_migrations
          SET name = 'AuthSessionClientConnection'
          WHERE migration_id = 41 AND name = 'ProjectionProposedThreads'
        `;
        yield* sql`
          UPDATE effect_sql_migrations
          SET name = 'ProjectionThreadsUnsettledAt'
          WHERE migration_id = 43 AND name = 'ProjectionProposedThreads'
        `;
        yield* sql`
          DELETE FROM effect_sql_migrations
          WHERE migration_id = 44 AND name = 'ProjectionProposedThreads'
        `;
        yield* Effect.logWarning("Reconciled legacy fork migration slots").pipe(
          Effect.annotateLogs({
            legacyMigrations: legacyEntries.map(
              ({ migration_id, name }) => `${migration_id}_${name}`,
            ),
          }),
        );
      }),
    );
  },
);

export const runForkMigrations = Effect.fn("runForkMigrations")(function* () {
  const executedMigrations = yield* run({
    loader,
    table: FORK_MIGRATIONS_TABLE,
  });
  const migrations = executedMigrations.map(([id, name]) => `${id}_${name}`);
  yield* migrations.length === 0
    ? Effect.logDebug("Fork schema is current")
    : Effect.log("Fork migrations ran successfully").pipe(Effect.annotateLogs({ migrations }));
  return executedMigrations;
});
