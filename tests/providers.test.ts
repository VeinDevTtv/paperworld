import assert from "node:assert/strict";
import test from "node:test";
import { paperMapSchema } from "../lib/schema";
import { ApiError } from "../server/security";
import { proposeCommand, reconcileMap } from "../server/providers";

test("map reconciliation follows unique visible labels over conflicting model IDs", () => {
  const previous = paperMapSchema.parse({
    locations: [
      { id: "A", label: "First Home", kind: "home", x: 10, y: 10 },
      { id: "B", label: "Second Home", kind: "home", x: 90, y: 90 },
    ],
    roads: [{ id: "road-stable", from: "A", to: "B", closed: false }],
  });
  const rescan = paperMapSchema.parse({
    locations: [
      { id: "A", label: "Second Home", kind: "home", x: 89, y: 88 },
      { id: "B", label: "First Home", kind: "home", x: 11, y: 12 },
    ],
    roads: [{ id: "road-new", from: "A", to: "B", closed: false }],
  });

  const result = reconcileMap(rescan, previous);
  assert.deepEqual(result.map.locations, [
    { id: "B", label: "Second Home", kind: "home", x: 90, y: 90 },
    { id: "A", label: "First Home", kind: "home", x: 10, y: 10 },
  ]);
  assert.equal(result.map.roads[0].id, "road-stable");
  assert.ok(result.reviewReasons.includes("location_id_reconciled_by_label"));
});

const map = paperMapSchema.parse({
  locations: [
    { id: "A", label: "Depot", kind: "depot", x: 10, y: 50 },
    { id: "B", label: "Home", kind: "home", x: 90, y: 50 },
  ],
  roads: [{ id: "A-B", from: "A", to: "B", closed: false }],
});

function typeSafeAnswer(choice: string, choices: string[]) {
  return {
    type: "choice",
    choice,
    confidence: 0.99,
    probabilities: Object.fromEntries(choices.map((label) => [label, label === choice ? 1 : 0])),
  };
}

async function withMockedTypeSafe(responseBody: unknown, run: () => Promise<void>): Promise<void> {
  const savedFetch = globalThis.fetch;
  const savedKey = process.env.TYPESAFE_API_KEY;
  process.env.TYPESAFE_API_KEY = "provider-test-placeholder";
  globalThis.fetch = (async () => new Response(JSON.stringify(responseBody), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
  try {
    await run();
  } finally {
    globalThis.fetch = savedFetch;
    if (savedKey === undefined) delete process.env.TYPESAFE_API_KEY;
    else process.env.TYPESAFE_API_KEY = savedKey;
  }
}

test("Jev malformed priority labels fail closed instead of defaulting to normal", async () => {
  const response = {
    model: "jev-test",
    answers: {
      operation: typeSafeAnswer("create_package", ["create_package", "set_priority", "set_road", "assign_package", "clarify"]),
      priority: typeSafeAnswer("malformed", ["normal", "urgent", "unspecified"]),
      road_state: typeSafeAnswer("unspecified", ["open", "closed", "unspecified"]),
    },
  };
  await withMockedTypeSafe(response, async () => {
    await assert.rejects(
      proposeCommand({ text: "Create a package from A to B urgent", map, packages: [], couriers: [], mode: "jev" }),
      (error) => error instanceof ApiError && error.code === "typesafe_invalid_response",
    );
  });
});

test("Jev probability vectors must match every named choice and total one", async () => {
  const response = {
    model: "jev-test",
    answers: {
      operation: { ...typeSafeAnswer("create_package", ["create_package", "set_priority", "set_road", "assign_package", "clarify"]), probabilities: { create_package: 0.7, set_priority: 0.1, set_road: 0.1, assign_package: 0.05, clarify: 0.05 } },
      priority: { ...typeSafeAnswer("urgent", ["normal", "urgent", "unspecified"]), probabilities: { normal: 0.1, urgent: 0.7, unspecified: 0.1 } },
      road_state: typeSafeAnswer("unspecified", ["open", "closed", "unspecified"]),
    },
  };
  await withMockedTypeSafe(response, async () => {
    await assert.rejects(
      proposeCommand({ text: "Create a package from A to B urgent", map, packages: [], couriers: [], mode: "jev" }),
      (error) => error instanceof ApiError && error.code === "typesafe_invalid_response",
    );
  });
});
