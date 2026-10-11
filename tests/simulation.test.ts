import assert from "node:assert/strict";
import test from "node:test";
import {
  applyCommands,
  applyMap,
  createSimulation,
  getCourierPosition,
  getMetrics,
  shortestPath,
  tick,
} from "../lib/simulation";
import { paperMapSchema, type PaperMap } from "../lib/schema";

const map: PaperMap = {
  locations: [
    { id: "A", label: "Depot", kind: "depot", x: 0, y: 0 },
    { id: "J", label: "Junction", kind: "junction", x: 10, y: 0 },
    { id: "B", label: "Home", kind: "home", x: 20, y: 0 },
    { id: "C", label: "Shop", kind: "shop", x: 10, y: 10 },
  ],
  roads: [
    { id: "A-J", from: "A", to: "J", closed: false },
    { id: "J-B", from: "J", to: "B", closed: false },
    { id: "J-C", from: "J", to: "C", closed: false },
  ],
};

function oneCourier(simulationMap: PaperMap = map) {
  return createSimulation(simulationMap, [{ id: "bike-1", name: "Mina", locationId: "A", capacity: 2 }]);
}

function apply(state: ReturnType<typeof createSimulation>, commands: Parameters<typeof applyCommands>[1]) {
  const result = applyCommands(state, commands);
  assert.equal(result.accepted, true, "command batch should be accepted");
  return result.state;
}

test("map schema rejects duplicate IDs, missing endpoints, and zero-length roads", () => {
  const duplicate = { ...map, locations: [...map.locations, { ...map.locations[0] }] };
  assert.equal(paperMapSchema.safeParse(duplicate).success, false);
  assert.equal(paperMapSchema.safeParse({ ...map, roads: [{ id: "bad", from: "A", to: "missing", closed: false }] }).success, false);
  assert.equal(paperMapSchema.safeParse({
    ...map,
    locations: [map.locations[0], { ...map.locations[1], x: 0, y: 0 }],
    roads: [{ id: "flat", from: "A", to: "J", closed: false }],
  }).success, false);
});

test("shortest path is deterministic and omits closed roads", () => {
  const route = shortestPath(map, "A", "B");
  assert.deepEqual(route?.roadIds, ["A-J", "J-B"]);
  const blocked = { ...map, roads: map.roads.map((road) => road.id === "A-J" ? { ...road, closed: true } : road) };
  assert.equal(shortestPath(blocked, "A", "B"), null);
  assert.deepEqual(shortestPath(map, "A", "B"), route);
});

test("tick is deterministic and both couriers advance concurrently without teleporting", () => {
  const initial = createSimulation(map, [
    { id: "bike-1", name: "Mina", locationId: "A", capacity: 1 },
    { id: "bike-2", name: "Rook", locationId: "A", capacity: 1 },
  ]);
  const assigned = apply(initial, [
    { type: "create-package", from: "A", to: "B", priority: "normal" },
    { type: "create-package", from: "A", to: "B", priority: "normal" },
    { type: "assign-package", packageId: "pkg-1", courierId: "bike-1" },
    { type: "assign-package", packageId: "pkg-2", courierId: "bike-2" },
  ]);

  const first = tick(assigned, 0.5);
  const repeated = tick(assigned, 0.5);
  assert.deepEqual(first, repeated);
  assert.deepEqual(getCourierPosition(first, "bike-1"), { x: 5, y: 0 });
  assert.deepEqual(getCourierPosition(first, "bike-2"), { x: 5, y: 0 });
  assert.equal(first.distanceTraveled, 10);
  assert.equal(first.packages.every((pkg) => pkg.status === "in_transit"), true);
});

test("closing and removing a road mid-segment preserves its geometry, then reroutes at the endpoint", () => {
  const detourMap: PaperMap = {
    locations: [
      { id: "A", label: "Depot", kind: "depot", x: 0, y: 0 },
      { id: "J", label: "Junction", kind: "junction", x: 20, y: 0 },
      { id: "K", label: "Corner", kind: "junction", x: 20, y: 20 },
    ],
    roads: [
      { id: "A-J", from: "A", to: "J", closed: false },
      { id: "J-K", from: "J", to: "K", closed: false },
      { id: "K-A", from: "K", to: "A", closed: false },
    ],
  };
  let state = createSimulation(detourMap, [{ id: "bike-1", name: "Mina", locationId: "A", capacity: 1 }]);
  state = apply(state, [
    { type: "create-package", from: "J", to: "A", priority: "normal" },
    { type: "assign-package", packageId: "pkg-1", courierId: "bike-1" },
  ]);
  state = tick(state, 1);
  assert.equal(state.couriers[0]?.segment?.roadId, "A-J");
  assert.deepEqual(getCourierPosition(state, "bike-1"), { x: 10, y: 0 });

  const rescannedMap = { ...detourMap, roads: detourMap.roads.filter((road) => road.id !== "A-J") };
  const update = applyMap(state, rescannedMap);
  assert.equal(update.accepted, true, "map update should be accepted");
  state = update.state;
  assert.equal(state.couriers[0]?.segment?.roadId, "A-J");
  assert.deepEqual(getCourierPosition(state, "bike-1"), { x: 10, y: 0 });

  state = tick(state, 1);
  assert.equal(state.couriers[0]?.locationId, "J");
  assert.equal(state.packages[0]?.status, "in_transit");
  state = tick(state, 0.1);
  assert.equal(state.couriers[0]?.segment?.roadId, "J-K");
  assert.ok(getCourierPosition(state, "bike-1").y > 0);
});

test("map updates reject removal or movement of locations referenced by live state atomically", () => {
  let state = oneCourier();
  state = apply(state, [{ type: "create-package", from: "A", to: "B", priority: "normal" }]);
  const removed = applyMap(state, { ...map, locations: map.locations.filter((location) => location.id !== "B"), roads: map.roads.filter((road) => road.to !== "B" && road.from !== "B") });
  assert.equal(removed.accepted, false);
  assert.deepEqual(removed.state, state);

  const moved = applyMap(state, { ...map, locations: map.locations.map((location) => location.id === "B" ? { ...location, x: 21 } : location) });
  assert.equal(moved.accepted, false);
  assert.deepEqual(moved.state, state);
});

test("priority update changes the next stop and capacity prevents an extra assignment", () => {
  let state = oneCourier();
  state = apply(state, [
    { type: "create-package", from: "B", to: "A", priority: "normal" },
    { type: "create-package", from: "C", to: "A", priority: "normal" },
    { type: "assign-package", packageId: "pkg-1", courierId: "bike-1" },
    { type: "assign-package", packageId: "pkg-2", courierId: "bike-1" },
    { type: "set-priority", packageId: "pkg-2", priority: "urgent" },
  ]);
  const full = applyCommands(state, [
    { type: "create-package", from: "J", to: "A", priority: "normal" },
    { type: "assign-package", packageId: "pkg-3", courierId: "bike-1" },
  ]);
  assert.equal(full.accepted, false);
  assert.deepEqual(full.state, state);

  state = tick(state, 1);
  state = tick(state, 0.1);
  assert.equal(state.couriers[0]?.segment?.roadId, "J-C");
});

test("invalid command batches reject atomically without creating partial state", () => {
  const state = oneCourier();
  const result = applyCommands(state, [
    { type: "create-package", from: "A", to: "B", priority: "normal" },
    { type: "assign-package", packageId: "missing-package", courierId: "bike-1" },
  ]);
  assert.equal(result.accepted, false);
  assert.deepEqual(result.state, state);
});

test("unreachable assignments recover when a connecting road opens and deliver only on arrival", () => {
  const blockedMap: PaperMap = {
    ...map,
    roads: map.roads.map((road) => road.id === "J-C" ? { ...road, closed: true } : road),
  };
  let state = oneCourier(blockedMap);
  state = apply(state, [
    { type: "create-package", from: "C", to: "B", priority: "normal" },
    { type: "assign-package", packageId: "pkg-1", courierId: "bike-1" },
  ]);
  assert.equal(state.packages[0]?.status, "unreachable");
  assert.equal(getMetrics(state).unreachableCount, 1);

  const opened = applyCommands(state, [{ type: "set-road", roadId: "J-C", closed: false }]);
  assert.equal(opened.accepted, true, "opening the road should be accepted");
  state = opened.state;
  assert.equal(state.packages[0]?.status, "assigned");

  state = tick(state, 2.2);
  assert.equal(state.packages[0]?.status, "in_transit");
  assert.notEqual(state.packages[0]?.status, "delivered");
  state = tick(state, 2.5);
  assert.equal(state.packages[0]?.status, "delivered");
  assert.equal(getMetrics(state).deliveredCount, 1);
  assert.equal(state.couriers[0]?.packageIds.length, 0);
});

