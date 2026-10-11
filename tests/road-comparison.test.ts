import assert from "node:assert/strict";
import test from "node:test";
import { captureRoadComparison, COMPARISON_INTERVAL_SECONDS, runRoadComparison } from "../lib/road-comparison";
import type { PaperMap } from "../lib/schema";
import { applyCommands, applyMap, createSimulation, getCourierPosition, tick } from "../lib/simulation";

const map: PaperMap = {
  locations: [
    { id: "d", label: "Depot", kind: "depot", x: 10, y: 50 },
    { id: "j", label: "Junction", kind: "junction", x: 40, y: 50 },
    { id: "h", label: "Home", kind: "home", x: 80, y: 20 },
    { id: "s", label: "Shop", kind: "shop", x: 75, y: 80 },
  ],
  roads: [
    { id: "dj", from: "d", to: "j", closed: false },
    { id: "jh", from: "j", to: "h", closed: false },
    { id: "js", from: "j", to: "s", closed: false },
  ],
};

function moving() {
  const assigned = applyCommands(createSimulation(map), [{ type: "dispatch-delivery", from: "d", to: "h", priority: "urgent" }]);
  assert.ok(assigned.accepted);
  return tick(assigned.state, 1);
}

test("comparison applies only the road edit, advances identical intervals, and reports actual package outcomes", () => {
  const closedMap = { ...map, roads: map.roads.map((r) => ({ ...r, closed: r.id === "jh" })) };
  const closed = applyMap(moving(), closedMap);
  assert.ok(closed.accepted);
  const waiting = tick(closed.state, 4);
  assert.equal(waiting.packages[0].status, "unreachable");
  const recovered = { ...closedMap, roads: [...closedMap.roads, { id: "sh", from: "s", to: "h", closed: false }] };
  const capture = captureRoadComparison(waiting, recovered);
  assert.ok(capture);
  const snapshot = JSON.stringify(waiting);
  const result = runRoadComparison(capture);
  assert.equal(JSON.stringify(waiting), snapshot);
  assert.equal(result.withoutChange.elapsedSeconds, waiting.elapsedSeconds + COMPARISON_INTERVAL_SECONDS);
  assert.equal(result.withChange.elapsedSeconds, result.withoutChange.elapsedSeconds);
  assert.deepEqual(result.withoutChange, tick(waiting, COMPARISON_INTERVAL_SECONDS));
  const edited = applyMap(waiting, recovered);
  assert.ok(edited.accepted);
  assert.deepEqual(result.withChange, tick(edited.state, COMPARISON_INTERVAL_SECONDS));
  assert.equal(result.withoutMetrics.waiting, 1);
  assert.equal(result.withoutMetrics.delivered, 0);
  assert.equal(result.withMetrics.waiting, 0);
  assert.equal(result.withMetrics.delivered, 1);
  assert.deepEqual(result.withMetrics.completedPackageIds, [waiting.packages[0].id]);
  assert.equal(result.withChange.events.filter((e) => e.type === "package_delivered").length, 1);
  assert.ok(result.withMetrics.distance > 0);
  assert.equal(result.withoutMetrics.distance, 0);
});

test("captures and both result branches own isolated state and repeated comparison is deterministic", () => {
  const before = moving();
  const editedMap = structuredClone(map);
  editedMap.roads[1].closed = true;
  const capture = captureRoadComparison(before, editedMap);
  assert.ok(capture);
  const frozenCapture = structuredClone(capture);
  const first = runRoadComparison(capture);
  const expected = structuredClone(first);
  before.packages[0].priority = "normal";
  editedMap.roads[1].closed = false;
  first.withoutChange.packages[0].priority = "normal";
  first.withChange.map.locations[0].label = "changed result";
  assert.deepEqual(capture, frozenCapture);
  assert.deepEqual(runRoadComparison(capture), expected);
});

test("closing an occupied road retains its segment geometry and cannot advance the live courier", () => {
  const before = moving();
  const position = getCourierPosition(before, before.couriers[0].id);
  const capture = captureRoadComparison(before, { ...map, roads: map.roads.map((r) => ({ ...r, closed: r.id === "dj" })) });
  assert.ok(capture);
  assert.deepEqual(getCourierPosition(capture.before, before.couriers[0].id), position);
  const snapshot = JSON.stringify(before);
  const result = runRoadComparison(capture);
  assert.equal(JSON.stringify(before), snapshot);
  assert.equal(result.withoutChange.packages[0].id, result.withChange.packages[0].id);
  assert.equal(result.withChange.packages[0].status, "delivered", "occupied segment finishes under existing engine rules");
});

test("unchanged/reordered roads, changed stops and invalid edits do not create a road comparison", () => {
  const before = moving();
  assert.equal(captureRoadComparison(before, map), null);
  assert.equal(captureRoadComparison(before, { ...map, roads: [...map.roads].reverse() }), null);
  assert.equal(captureRoadComparison(before, { ...map, locations: map.locations.map((l) => ({ ...l, x: l.x + 1 })) }), null);
  assert.equal(captureRoadComparison(before, { ...map, roads: [{ id: "bad", from: "d", to: "missing", closed: false }] }), null);
});
