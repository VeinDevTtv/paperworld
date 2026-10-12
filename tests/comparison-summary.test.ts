import assert from "node:assert/strict";
import test from "node:test";
import { summarizeRoadComparison } from "../lib/comparison-summary";
import type { RoadComparisonResult } from "../lib/road-comparison";
import { captureRoadComparison, runRoadComparison } from "../lib/road-comparison";
import { applyCommands, createSimulation } from "../lib/simulation";

function comparison(): RoadComparisonResult {
  const initial = createSimulation({
    locations: [
      { id: "d", label: "Depot", kind: "depot", x: 10, y: 50 },
      { id: "h", label: "Home", kind: "home", x: 80, y: 50 },
    ],
    roads: [{ id: "dh", from: "d", to: "h", closed: false }],
  });
  const dispatched = applyCommands(initial, [{ type: "dispatch-delivery", from: "d", to: "h", priority: "normal" }]);
  assert.ok(dispatched.accepted);
  const capture = captureRoadComparison(dispatched.state, { ...initial.map, roads: [{ ...initial.map.roads[0], closed: true }] });
  assert.ok(capture);
  return runRoadComparison(capture);
}

test("takeaway reports a harmful closure, without claiming a gain", () => {
  const result = comparison();
  const before = JSON.stringify(result);
  assert.match(summarizeRoadComparison(result), /Without this road change, pkg-1 completes within 20 simulated seconds.*with it, it remains blocked/);
  assert.equal(JSON.stringify(result), before);
});

test("takeaway identifies the specific recovered package", () => {
  const result = comparison();
  [result.withChange, result.withoutChange] = [result.withoutChange, result.withChange];
  [result.withMetrics, result.withoutMetrics] = [result.withoutMetrics, result.withMetrics];
  assert.match(summarizeRoadComparison(result), /With this road change, pkg-1 completes.*without it, it remains blocked/);
});

test("unfinished reachable deliveries are not described as blocked", () => {
  const result = comparison();
  result.withChange.packages[0].status = "in_transit";
  const summary = summarizeRoadComparison(result);
  assert.match(summary, /has not completed in that interval/);
  assert.doesNotMatch(summary, /remains blocked|faster|%|infinite/);
});

test("equal completions do not imply equal distances or real-world benefit", () => {
  const result = comparison();
  result.withChange = structuredClone(result.withoutChange);
  result.withMetrics = { ...result.withoutMetrics, distance: result.withoutMetrics.distance + 10 };
  assert.match(summarizeRoadComparison(result), /same packages complete in both versions/);
  assert.doesNotMatch(summarizeRoadComparison(result), /saved|faster|cheaper|%|distance/);
});
