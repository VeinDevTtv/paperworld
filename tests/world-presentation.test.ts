import assert from "node:assert/strict";
import test from "node:test";
import { paperPointToWorld, roadPose } from "../lib/world-presentation";
import { applyCommands, applyMap, createSimulation, getCourierPosition, tick } from "../lib/simulation";
import type { PaperMap } from "../lib/schema";

function close(actual: number, expected: number) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
}

test("3D road meshes and projected courier points share the same straight segment", () => {
  for (const [from, to] of [
    [{ x: 0, y: 0 }, { x: 100, y: 100 }],
    [{ x: 81, y: 17 }, { x: 13, y: 77 }],
    [{ x: 50, y: 50 }, { x: 50, y: 90 }],
  ]) {
    const pose = roadPose(from, to);
    for (const progress of [0, 0.25, 0.5, 0.9, 1]) {
      const projected = paperPointToWorld(from.x + (to.x - from.x) * progress, from.y + (to.y - from.y) * progress);
      const along = pose.length * (progress - 0.5);
      close(projected[0], pose.position[0] + Math.sin(pose.rotationY) * along);
      close(projected[2], pose.position[2] + Math.cos(pose.rotationY) * along);
      assert.equal(projected[1], 0);
    }
  }
});

test("projection keeps authoritative occupied-segment geometry through closure and removal", () => {
  const map: PaperMap = {
    locations: [
      { id: "d", label: "Depot", kind: "depot", x: 10, y: 10 },
      { id: "j", label: "Junction", kind: "junction", x: 90, y: 10 },
      { id: "h", label: "Home", kind: "home", x: 90, y: 90 },
    ],
    roads: [{ id: "dj", from: "d", to: "j", closed: false }, { id: "jh", from: "j", to: "h", closed: false }],
  };
  const assigned = applyCommands(createSimulation(map), [{ type: "dispatch-delivery", from: "d", to: "h", priority: "urgent" }]);
  assert.ok(assigned.accepted);
  const moving = tick(assigned.state, 2);
  const before = getCourierPosition(moving, moving.couriers[0].id);
  const edited = applyMap(moving, { ...map, roads: [map.roads[1]] });
  assert.ok(edited.accepted);
  const after = getCourierPosition(edited.state, edited.state.couriers[0].id);
  assert.deepEqual(paperPointToWorld(after.x, after.y), paperPointToWorld(before.x, before.y));
  assert.equal(edited.state.packages[0].id, moving.packages[0].id);
  const snapshot = JSON.stringify(edited.state);
  for (let i = 0; i < 5; i += 1) paperPointToWorld(after.x, after.y);
  assert.equal(JSON.stringify(edited.state), snapshot, "renderer geometry must not mutate or advance the run");
});

test("higher presentation tick frequency preserves routing, completion and distance", () => {
  const map: PaperMap = {
    locations: [
      { id: "d", label: "Depot", kind: "depot", x: 10, y: 20 },
      { id: "j", label: "Junction", kind: "junction", x: 45, y: 20 },
      { id: "h", label: "Home", kind: "home", x: 85, y: 30 },
      { id: "s", label: "Shop", kind: "shop", x: 70, y: 80 },
    ],
    roads: [{ id: "dj", from: "d", to: "j", closed: false }, { id: "jh", from: "j", to: "h", closed: false }, { id: "js", from: "j", to: "s", closed: false }],
  };
  function run(step: number) {
    const started = applyCommands(createSimulation(map), [{ type: "dispatch-delivery", from: "d", to: "h", priority: "urgent" }]);
    assert.ok(started.accepted);
    let state = started.state;
    for (let i = 0; i < Math.round(2 / step); i += 1) state = tick(state, step);
    const closed = applyCommands(state, [{ type: "set-road", roadId: "jh", closed: true }]);
    assert.ok(closed.accepted);
    state = closed.state;
    for (let i = 0; i < Math.round(4 / step); i += 1) state = tick(state, step);
    const recovered = applyMap(state, { ...state.map, roads: [...state.map.roads, { id: "sh", from: "s", to: "h", closed: false }] });
    assert.ok(recovered.accepted);
    state = recovered.state;
    for (let i = 0; i < Math.round(25 / step); i += 1) state = tick(state, step);
    return state;
  }
  const previous = run(0.25);
  const smooth = run(0.05);
  assert.deepEqual(smooth.packages, previous.packages);
  assert.deepEqual(smooth.couriers, previous.couriers);
  close(smooth.elapsedSeconds, previous.elapsedSeconds);
  close(smooth.distanceTraveled, previous.distanceTraveled);
  assert.deepEqual(smooth.events.map(({ atSeconds, ...event }) => event), previous.events.map(({ atSeconds, ...event }) => event));
  smooth.events.forEach((event, index) => close(event.atSeconds, previous.events[index].atSeconds));
  assert.equal(smooth.events.filter(event => event.type === "package_delivered").length, 1);
});
