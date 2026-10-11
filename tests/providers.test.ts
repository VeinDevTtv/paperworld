import assert from "node:assert/strict";
import test from "node:test";
import { paperMapSchema } from "../lib/schema";
import { ApiError } from "../server/security";
import { parseMapImage, proposeCommand, reconcileMap } from "../server/providers";

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
const courier = { id: "bike-1", name: "Mina", locationId: "A", segment: null, packageIds: [], capacity: 2 };
const operationChoices = ["create_package", "dispatch_delivery", "set_priority", "set_road", "assign_package", "delegate_to_codex", "clarify"];

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

async function withMockedOpenAi(responseBody: unknown, run: () => Promise<void>): Promise<void> {
  const envNames = ["PAPERWORLD_OPENAI_PROVIDER", "PAPERWORLD_ALLOW_PAID_API", "OPENAI_API_KEY", "OPENAI_MODEL"] as const;
  const previousEnv = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
  const savedFetch = globalThis.fetch;
  process.env.PAPERWORLD_OPENAI_PROVIDER = "api";
  process.env.PAPERWORLD_ALLOW_PAID_API = "true";
  process.env.OPENAI_API_KEY = "provider-test-placeholder";
  process.env.OPENAI_MODEL = "provider-test-model";
  globalThis.fetch = (async () => new Response(JSON.stringify({
    model: "provider-test-model",
    output_text: JSON.stringify(responseBody),
  }), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
  try {
    await run();
  } finally {
    globalThis.fetch = savedFetch;
    for (const name of envNames) {
      const value = previousEnv[name];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

function typeSafeDecision(operation: string, priority = "unspecified", roadState = "unspecified") {
  return {
    model: "jev-test",
    answers: {
      operation: typeSafeAnswer(operation, operationChoices),
      priority: typeSafeAnswer(priority, ["normal", "urgent", "unspecified"]),
      road_state: typeSafeAnswer(roadState, ["open", "closed", "unspecified"]),
    },
  };
}

test("Jev malformed priority labels fail closed instead of defaulting to normal", async () => {
  const response = {
    model: "jev-test",
    answers: {
      operation: typeSafeAnswer("create_package", operationChoices),
      priority: typeSafeAnswer("malformed", ["normal", "urgent", "unspecified"]),
      road_state: typeSafeAnswer("unspecified", ["open", "closed", "unspecified"]),
    },
  };
  await withMockedTypeSafe(response, async () => {
    await assert.rejects(
      proposeCommand({ text: "Create a package from A to B urgent", map, packages: [], couriers: [courier], mode: "jev" }),
      (error) => error instanceof ApiError && error.code === "typesafe_invalid_response",
    );
  });
});

test("Jev probability vectors must match every named choice and total one", async () => {
  const response = {
    model: "jev-test",
    answers: {
      operation: { ...typeSafeAnswer("create_package", operationChoices), probabilities: { create_package: 0.7, dispatch_delivery: 0, set_priority: 0.1, set_road: 0.1, assign_package: 0.05, delegate_to_codex: 0.03, clarify: 0.02 } },
      priority: { ...typeSafeAnswer("urgent", ["normal", "urgent", "unspecified"]), probabilities: { normal: 0.1, urgent: 0.7, unspecified: 0.1 } },
      road_state: typeSafeAnswer("unspecified", ["open", "closed", "unspecified"]),
    },
  };
  await withMockedTypeSafe(response, async () => {
    await assert.rejects(
      proposeCommand({ text: "Create a package from A to B urgent", map, packages: [], couriers: [courier], mode: "jev" }),
      (error) => error instanceof ApiError && error.code === "typesafe_invalid_response",
    );
  });
});

test("automatic mode routes a single dispatch to Jev, defaults priority, and assigns a courier in code", async () => {
  await withMockedTypeSafe(typeSafeDecision("dispatch_delivery"), async () => {
    const proposal = await proposeCommand({
      text: "Dispatch a delivery from Depot to Home",
      map,
      packages: [],
      couriers: [courier],
    });
    assert.deepEqual(proposal.commands, [{
      type: "dispatch-delivery",
      from: "A",
      to: "B",
      priority: "normal",
      courierId: "bike-1",
    }]);
    assert.equal(proposal.clarification, null);
    assert.equal(proposal.provider, "typesafe");
  });
});

test("automatic dispatch clarifies when a named courier is ambiguous", async () => {
  await withMockedTypeSafe(typeSafeDecision("dispatch_delivery"), async () => {
    const proposal = await proposeCommand({
      text: "Dispatch a delivery from Depot to Home with Mina",
      map,
      packages: [],
      couriers: [
        { ...courier, id: "bike-1" },
        { ...courier, id: "bike-2" },
      ],
    });
    assert.deepEqual(proposal.commands, []);
    assert.match(proposal.clarification ?? "", /one courier clearly/i);
  });
});

test("automatic create-delivery wording preserves the explicitly named courier", async () => {
  await withMockedTypeSafe(typeSafeDecision("dispatch_delivery", "urgent"), async () => {
    const proposal = await proposeCommand({
      text: "Create an urgent delivery from Depot to Home with Rook",
      map,
      packages: [],
      couriers: [
        { ...courier, id: "bike-1", name: "Mina" },
        { ...courier, id: "bike-2", name: "Rook" },
      ],
    });
    assert.deepEqual(proposal.commands, [{
      type: "dispatch-delivery",
      from: "A",
      to: "B",
      priority: "urgent",
      courierId: "bike-2",
    }]);
    assert.equal(proposal.clarification, null);
  });
});

test("automatic dispatch clarifies instead of dropping a courier mention it cannot align", async () => {
  await withMockedTypeSafe(typeSafeDecision("dispatch_delivery"), async () => {
    const proposal = await proposeCommand({
      text: "Arrange an urgent delivery from Depot to Home with Rook",
      map,
      packages: [],
      couriers: [
        { ...courier, id: "bike-1", name: "Mina" },
        { ...courier, id: "bike-2", name: "Rook" },
      ],
    });
    assert.deepEqual(proposal.commands, []);
    assert.match(proposal.clarification ?? "", /courier in one clear delivery clause/i);
  });
});

test("automatic dispatch clarifies when its explicitly named courier lacks capacity", async () => {
  await withMockedTypeSafe(typeSafeDecision("dispatch_delivery"), async () => {
    const proposal = await proposeCommand({
      text: "Send a delivery from Depot to Home with Mina",
      map,
      packages: [{ id: "pkg-1", from: "A", to: "B", priority: "normal", status: "assigned", pickedUp: false, courierId: "bike-1", createdOrder: 1 }],
      couriers: [
        { ...courier, id: "bike-1", name: "Mina", packageIds: ["pkg-1"], capacity: 1 },
        { ...courier, id: "bike-2", name: "Rook", capacity: 2 },
      ],
    });
    assert.deepEqual(proposal.commands, []);
    assert.match(proposal.clarification ?? "", /Mina does not have capacity/i);
  });
});

test("automatic compound delivery routing scopes courier names and reports total Jev-to-Codex latency", async () => {
  let codexPrompt = "";
  const classifierStarted = performance.now();
  const proposal = await proposeCommand({
    text: "Send a delivery from Depot to Home with Mina, set pkg-1 urgent, and assign pkg-2 to Rook",
    map,
    packages: [
      { id: "pkg-1", from: "A", to: "B", priority: "normal", status: "queued", pickedUp: false, courierId: null, createdOrder: 1 },
      { id: "pkg-2", from: "A", to: "B", priority: "normal", status: "queued", pickedUp: false, courierId: null, createdOrder: 2 },
    ],
    couriers: [
      { ...courier, id: "bike-1", name: "Mina" },
      { ...courier, id: "bike-2", name: "Rook" },
    ],
  }, {
    classify: async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return {
        choices: { operation: "delegate_to_codex", priority: "urgent", road_state: "unspecified" },
        confidence: 0.94,
        model: "jev-router-test",
        latencyMs: Math.round(performance.now() - classifierStarted),
      };
    },
    runCodex: async ({ prompt }) => {
      codexPrompt = prompt;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return {
        value: {
          commands: [
            { type: "dispatch-delivery", from: "A", to: "B", priority: "normal", courierId: null },
            { type: "set-priority", packageId: "pkg-1", priority: "urgent" },
            { type: "assign-package", packageId: "pkg-2", courierId: "bike-2" },
          ],
          clarification: null,
        },
        model: "codex-planner-test",
        latencyMs: 20,
      };
    },
  });
  assert.deepEqual(proposal.commands, [
    { type: "dispatch-delivery", from: "A", to: "B", priority: "normal", courierId: "bike-1" },
    { type: "set-priority", packageId: "pkg-1", priority: "urgent" },
    { type: "assign-package", packageId: "pkg-2", courierId: "bike-2" },
  ]);
  assert.equal(proposal.provider, "codex");
  assert.equal(proposal.model, "codex-planner-test");
  assert.equal(proposal.routedBy, "typesafe");
  assert.equal(proposal.routeCategory, "delegate_to_codex");
  const routerLatencyMs = proposal.routerLatencyMs ?? 0;
  assert.ok(routerLatencyMs >= 15);
  assert.ok(proposal.latencyMs >= routerLatencyMs + 15);
  assert.match(codexPrompt, /Use assign-package only for an existing package the user identifies\. For a new delivery, use dispatch-delivery instead\./);
  assert.doesNotMatch(codexPrompt, /compound create-and-assign request/);
});

test("automatic routing honors different courier names on separate delivery clauses", async () => {
  const proposal = await proposeCommand({
    text: "Dispatch a delivery from Depot to Home with Mina and dispatch another delivery from Depot to Home with Rook",
    map,
    packages: [],
    couriers: [
      { ...courier, id: "bike-1", name: "Mina" },
      { ...courier, id: "bike-2", name: "Rook" },
    ],
  }, {
    classify: async () => ({
      choices: { operation: "delegate_to_codex", priority: "unspecified", road_state: "unspecified" },
      confidence: 0.94,
      model: "jev-router-test",
      latencyMs: 1,
    }),
    runCodex: async () => ({
      value: {
        commands: [
          { type: "dispatch-delivery", from: "A", to: "B", priority: "normal", courierId: null },
          { type: "dispatch-delivery", from: "A", to: "B", priority: "urgent", courierId: null },
        ],
        clarification: null,
      },
      model: "codex-planner-test",
      latencyMs: 5,
    }),
  });
  assert.deepEqual(proposal.commands.map((command) => command.type === "dispatch-delivery" ? command.courierId : null), ["bike-1", "bike-2"]);
  assert.equal(proposal.clarification, null);
});

test("automatic compound dispatch clarifies when later deliveries exceed planned fleet capacity", async () => {
  const proposal = await proposeCommand({
    text: "Dispatch a delivery from Depot to Home and dispatch another delivery from Depot to Home",
    map,
    packages: [],
    couriers: [{ ...courier, capacity: 1 }],
  }, {
    classify: async () => ({
      choices: { operation: "delegate_to_codex", priority: "unspecified", road_state: "unspecified" },
      confidence: 0.94,
      model: "jev-router-test",
      latencyMs: 1,
    }),
    runCodex: async () => ({
      value: {
        commands: [
          { type: "dispatch-delivery", from: "A", to: "B", priority: "normal", courierId: null },
          { type: "dispatch-delivery", from: "A", to: "B", priority: "urgent", courierId: null },
        ],
        clarification: null,
      },
      model: "codex-planner-test",
      latencyMs: 5,
    }),
  });
  assert.deepEqual(proposal.commands, []);
  assert.match(proposal.clarification ?? "", /No available courier has capacity/i);
});

test("Jev resolves a road from unique visible endpoint labels in either direction", async () => {
  await withMockedTypeSafe(typeSafeDecision("set_road", "unspecified", "closed"), async () => {
    const proposal = await proposeCommand({ text: "Close the road between Home and Depot", map, packages: [], couriers: [courier], mode: "jev" });
    assert.deepEqual(proposal.commands, [{ type: "set-road", roadId: "A-B", closed: true }]);
    assert.equal(proposal.clarification, null);
  });
});

test("Jev asks for a road ID when parallel roads share the named endpoints", async () => {
  const parallelMap = paperMapSchema.parse({
    ...map,
    roads: [
      { id: "A-B", from: "A", to: "B", closed: false },
      { id: "B-A-alt", from: "B", to: "A", closed: false },
    ],
  });
  await withMockedTypeSafe(typeSafeDecision("set_road", "unspecified", "closed"), async () => {
    const proposal = await proposeCommand({ text: "Close the road between Depot and Home", map: parallelMap, packages: [], couriers: [courier], mode: "jev" });
    assert.deepEqual(proposal.commands, []);
    assert.match(proposal.clarification ?? "", /road ID/i);
  });
});

test("provider command contexts reject duplicate entity IDs before making a provider call", async () => {
  const duplicatePackages = [
    { id: "pkg-1", from: "A", to: "B", priority: "normal", status: "queued", pickedUp: false, courierId: null, createdOrder: 1 },
    { id: "pkg-1", from: "A", to: "B", priority: "urgent", status: "queued", pickedUp: false, courierId: null, createdOrder: 2 },
  ];
  await assert.rejects(
    proposeCommand({ text: "Set pkg-1 urgent", map, packages: duplicatePackages, couriers: [{ id: "bike-1", name: "Mina", locationId: "A", segment: null, packageIds: [], capacity: 2 }], mode: "jev" }),
    (error) => error instanceof ApiError && error.code === "invalid_command_request",
  );
});

test("provider command contexts reject package endpoints absent from the map", async () => {
  await assert.rejects(
    proposeCommand({
      text: "Set pkg-1 urgent",
      map,
      packages: [{ id: "pkg-1", from: "missing-stop", to: "B", priority: "normal", status: "queued", pickedUp: false, courierId: null, createdOrder: 1 }],
      couriers: [courier],
      mode: "jev",
    }),
    (error) => error instanceof ApiError && error.code === "invalid_command_request",
  );
});

test("OpenAI proposal output cannot contain both executable commands and a clarification", async () => {
  await withMockedOpenAi({
    commands: [{ type: "set-road", roadId: "A-B", closed: true }],
    clarification: "Which road did you mean?",
  }, async () => {
    await assert.rejects(
      proposeCommand({ text: "Close road A-B", map, packages: [], couriers: [courier], mode: "openai" }),
      (error) => error instanceof ApiError && error.code === "provider_invalid_response",
    );
  });
});

test("map parsing rejects provider roads with endpoints missing from its locations", async () => {
  await withMockedOpenAi({
    locations: [
      { id: "A", label: "Depot", kind: "depot", x: 10, y: 50 },
      { id: "B", label: "Home", kind: "home", x: 90, y: 50 },
    ],
    roads: [{ id: "A-C", from: "A", to: "C", closed: false }],
  }, async () => {
    await assert.rejects(
      parseMapImage("data:image/png;base64,iVBORw0KGgo="),
      (error) => error instanceof ApiError && error.code === "provider_invalid_map",
    );
  });
});

test("OpenAI compound proposals remain valid when each requested entity is clear", async () => {
  await withMockedOpenAi({
    commands: [
      { type: "set-priority", packageId: "pkg-1", priority: "urgent" },
      { type: "set-road", roadId: "A-B", closed: true },
    ],
    clarification: null,
  }, async () => {
    const proposal = await proposeCommand({
      text: "Set pkg-1 to urgent and close road A-B",
      map,
      packages: [{ id: "pkg-1", from: "A", to: "B", priority: "normal", status: "queued", pickedUp: false, courierId: null, createdOrder: 1 }],
      couriers: [{ id: "bike-1", name: "Mina", locationId: "A", segment: null, packageIds: [], capacity: 2 }],
      mode: "openai",
    });
    assert.deepEqual(proposal.commands, [
      { type: "set-priority", packageId: "pkg-1", priority: "urgent" },
      { type: "set-road", roadId: "A-B", closed: true },
    ]);
    assert.equal(proposal.clarification, null);
  });
});

test("provider command proposals prefer a fully named location over its contained label", async () => {
  const overlappingMap = paperMapSchema.parse({
    locations: [
      { id: "D", label: "Depot", kind: "depot", x: 0, y: 50 },
      { id: "H", label: "Home", kind: "home", x: 50, y: 20 },
      { id: "N", label: "North Home", kind: "home", x: 50, y: 80 },
    ],
    roads: [
      { id: "D-H", from: "D", to: "H", closed: false },
      { id: "D-N", from: "D", to: "N", closed: false },
    ],
  });
  await withMockedOpenAi({
    commands: [{ type: "create-package", from: "D", to: "N", priority: "urgent" }],
    clarification: null,
  }, async () => {
    const proposal = await proposeCommand({
      text: "Create an urgent package from Depot to North Home",
      map: overlappingMap,
      packages: [],
      couriers: [{ id: "bike-1", name: "Mina", locationId: "D", segment: null, packageIds: [], capacity: 2 }],
      mode: "openai",
    });
    assert.deepEqual(proposal.commands, [{ type: "create-package", from: "D", to: "N", priority: "urgent" }]);
    assert.equal(proposal.clarification, null);
  });
});

test("provider command proposals still clarify when two locations share the same label", async () => {
  const duplicateLabelMap = paperMapSchema.parse({
    locations: [
      { id: "D", label: "Depot", kind: "depot", x: 0, y: 50 },
      { id: "H", label: "Home", kind: "home", x: 50, y: 20 },
      { id: "N", label: "Home", kind: "home", x: 50, y: 80 },
    ],
    roads: [
      { id: "D-H", from: "D", to: "H", closed: false },
      { id: "D-N", from: "D", to: "N", closed: false },
    ],
  });
  await withMockedOpenAi({
    commands: [{ type: "create-package", from: "D", to: "H", priority: "urgent" }],
    clarification: null,
  }, async () => {
    const proposal = await proposeCommand({
      text: "Create an urgent package from Depot to Home",
      map: duplicateLabelMap,
      packages: [],
      couriers: [{ id: "bike-1", name: "Mina", locationId: "D", segment: null, packageIds: [], capacity: 2 }],
      mode: "openai",
    });
    assert.deepEqual(proposal.commands, []);
    assert.match(proposal.clarification ?? "", /labels match multiple stops/i);
  });
});

test("compound package routing does not make an explicitly named parallel road ambiguous", async () => {
  const parallelMap = paperMapSchema.parse({
    ...map,
    roads: [
      { id: "A-B", from: "A", to: "B", closed: false },
      { id: "B-A-alt", from: "B", to: "A", closed: false },
    ],
  });
  await withMockedOpenAi({
    commands: [
      { type: "create-package", from: "A", to: "B", priority: "urgent" },
      { type: "set-road", roadId: "A-B", closed: true },
    ],
    clarification: null,
  }, async () => {
    const proposal = await proposeCommand({
      text: "Create urgent package from Depot to Home and close road A-B",
      map: parallelMap,
      packages: [],
      couriers: [courier],
      mode: "openai",
    });
    assert.deepEqual(proposal.commands, [
      { type: "create-package", from: "A", to: "B", priority: "urgent" },
      { type: "set-road", roadId: "A-B", closed: true },
    ]);
    assert.equal(proposal.clarification, null);
  });
});

test("longer road IDs remain exact when they contain another road ID", async () => {
  const overlappingRoadIds = paperMapSchema.parse({
    ...map,
    roads: [
      { id: "A-B", from: "A", to: "B", closed: false },
      { id: "A-B-alt", from: "B", to: "A", closed: false },
    ],
  });
  await withMockedTypeSafe(typeSafeDecision("set_road", "unspecified", "closed"), async () => {
    const proposal = await proposeCommand({
      text: "Close road A-B-alt",
      map: overlappingRoadIds,
      packages: [],
      couriers: [courier],
      mode: "jev",
    });
    assert.deepEqual(proposal.commands, [{ type: "set-road", roadId: "A-B-alt", closed: true }]);
    assert.equal(proposal.clarification, null);
  });
});
