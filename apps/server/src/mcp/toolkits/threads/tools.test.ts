import { expect, it } from "@effect/vitest";
import { Tool } from "effect/unstable/ai";

import { ThreadsToolkit } from "./tools.ts";

it("exports provider-compatible object schemas with described parameters", () => {
  for (const tool of Object.values(ThreadsToolkit.tools)) {
    const schema = Tool.getJsonSchema(tool) as {
      readonly type?: unknown;
      readonly properties?: Readonly<Record<string, unknown>>;
      readonly anyOf?: unknown;
      readonly oneOf?: unknown;
    };
    expect(
      tool.description?.length ?? 0,
      `${tool.name} should have a useful description`,
    ).toBeGreaterThan(40);
    expect(schema.type, `${tool.name} must export a top-level object schema`).toBe("object");
    expect(schema.anyOf, `${tool.name} must not export a root anyOf`).toBeUndefined();
    expect(schema.oneOf, `${tool.name} must not export a root oneOf`).toBeUndefined();
    expect(schema.properties, `${tool.name} should declare object properties`).toBeTypeOf("object");
  }
  expect(Object.keys(ThreadsToolkit.tools).toSorted()).toEqual(["thread_list", "thread_send"]);
});
