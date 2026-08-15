import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import ProjectionProposedThreads from "./ForkMigrations/001_ProjectionProposedThreads.ts";
import { runMigrations } from "./Migrations.ts";
import * as NodeSqliteClient from "./NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("fork migrations", (it) => {
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
