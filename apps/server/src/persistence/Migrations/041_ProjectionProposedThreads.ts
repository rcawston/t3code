import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_proposed_threads (
      thread_id TEXT PRIMARY KEY,
      source_thread_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      source_title TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      model_selection_json TEXT NOT NULL,
      runtime_mode TEXT NOT NULL,
      interaction_mode TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_proposed_threads_source
    ON projection_proposed_threads(source_thread_id, created_at)
  `;
});
