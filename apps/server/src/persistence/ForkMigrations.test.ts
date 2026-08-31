import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import ProjectionProposedThreads from "./ForkMigrations/001_ProjectionProposedThreads.ts";
import { runMigrations } from "./Migrations.ts";
import * as NodeSqliteClient from "./NodeSqliteClient.ts";

const legacySlots43And44Layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

legacySlots43And44Layer("fork migrations", (it) => {
  it.effect("repairs legacy core slots and moves fork migrations to their own ledger", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 42 });
      yield* ProjectionProposedThreads;
      yield* sql`
        INSERT INTO effect_sql_migrations (migration_id, name)
        VALUES
          (43, 'ProjectionProposedThreads'),
          (44, 'ProjectionProposedThreads')
      `;

      yield* runMigrations();

      const columns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(projection_threads)
      `;
      assert.ok(columns.some((column) => column.name === "unsettled_at"));

      const coreEntries = yield* sql<{
        readonly migration_id: number;
        readonly name: string;
      }>`
        SELECT migration_id, name
        FROM effect_sql_migrations
        WHERE migration_id >= 43
        ORDER BY migration_id
      `;
      assert.deepStrictEqual(coreEntries, [
        { migration_id: 43, name: "ProjectionThreadsUnsettledAt" },
      ]);

      const forkEntries = yield* sql<{
        readonly migration_id: number;
        readonly name: string;
      }>`
        SELECT migration_id, name
        FROM t3_fork_migrations
        ORDER BY migration_id
      `;
      assert.deepStrictEqual(forkEntries, [{ migration_id: 1, name: "ProjectionProposedThreads" }]);
    }),
  );
});

const legacySlots41And44Layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

legacySlots41And44Layer("fork migrations from legacy slot 41", (it) => {
  it.effect("repairs skipped auth-session metadata columns and frees the core ledger", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 40 });
      yield* ProjectionProposedThreads;
      yield* sql`
        INSERT INTO effect_sql_migrations (migration_id, name)
        VALUES (41, 'ProjectionProposedThreads')
      `;
      yield* runMigrations({ toMigrationInclusive: 43 });
      yield* sql`
        INSERT INTO effect_sql_migrations (migration_id, name)
        VALUES (44, 'ProjectionProposedThreads')
      `;

      yield* runMigrations();

      const authSessionColumns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(auth_sessions)
      `;
      assert.ok(authSessionColumns.some((column) => column.name === "client_surface"));
      assert.ok(authSessionColumns.some((column) => column.name === "client_app_version"));

      const coreEntries = yield* sql<{
        readonly migration_id: number;
        readonly name: string;
      }>`
        SELECT migration_id, name
        FROM effect_sql_migrations
        WHERE migration_id >= 41
        ORDER BY migration_id
      `;
      assert.deepStrictEqual(coreEntries, [
        { migration_id: 41, name: "AuthSessionClientConnection" },
        { migration_id: 42, name: "ProjectionThreadLinkedPullRequest" },
        { migration_id: 43, name: "ProjectionThreadsUnsettledAt" },
      ]);

      const forkEntries = yield* sql<{
        readonly migration_id: number;
        readonly name: string;
      }>`
        SELECT migration_id, name
        FROM t3_fork_migrations
        ORDER BY migration_id
      `;
      assert.deepStrictEqual(forkEntries, [{ migration_id: 1, name: "ProjectionProposedThreads" }]);
    }),
  );
});
