import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import {
  applyCommands,
  applyMap,
  COURIER_SPEED,
  createSimulation,
  getCourierPosition,
  shortestPath,
  tick,
} from "../lib/simulation";
import type { Command, Location, PaperMap, Road, SimulationState } from "../lib/schema";
import { getProviderStatus, parseMapImage, proposeCommand } from "../server/providers";

type Stage = "initial" | "blocked" | "reconnected";
type NodeDrawing = { id: string; label: string; kind: Location["kind"]; x: number; y: number };
type EdgeDrawing = { id: string; from: string; to: string; closed?: boolean };

const IMAGE_LIMIT = 1_500_000;
const COURIER_ID = "courier-acceptance";

const NODES: NodeDrawing[] = [
  { id: "D", label: "DEPOT", kind: "depot", x: 110, y: 350 },
  { id: "X", label: "JUNCTION", kind: "junction", x: 390, y: 350 },
  { id: "H", label: "HOME", kind: "home", x: 790, y: 145 },
  { id: "S", label: "SHOP", kind: "shop", x: 735, y: 525 },
];

function edgesFor(stage: Stage): EdgeDrawing[] {
  return [
    { id: "D-X", from: "D", to: "X" },
    { id: "X-H", from: "X", to: "H", ...(stage === "blocked" || stage === "reconnected" ? { closed: true } : {}) },
    { id: "X-S", from: "X", to: "S" },
    ...(stage === "reconnected" ? [{ id: "S-H", from: "S", to: "H" }] : []),
  ];
}

function svgFor(stage: Stage): string {
  const nodes = new Map(NODES.map((node) => [node.id, node]));
  const edges = edgesFor(stage);
  const roadSvg = edges.map((edge) => {
    const from = nodes.get(edge.from)!;
    const to = nodes.get(edge.to)!;
    const mx = (from.x + to.x) / 2;
    const my = (from.y + to.y) / 2;
    const line = '<path d="M' + from.x + " " + from.y + " L" + to.x + " " + to.y + '" fill="none" stroke="#737f8c" stroke-width="15" stroke-linecap="round"/>';
    const mark = edge.closed
      ? '<path d="M' + (mx - 17) + " " + (my - 17) + " L" + (mx + 17) + " " + (my + 17) + " M" + (mx + 17) + " " + (my - 17) + " L" + (mx - 17) + " " + (my + 17) + '" fill="none" stroke="#f7f5ee" stroke-width="25"/><path d="M' + (mx - 13) + " " + (my - 13) + " L" + (mx + 13) + " " + (my + 13) + " M" + (mx + 13) + " " + (my - 13) + " L" + (mx - 13) + " " + (my + 13) + '" fill="none" stroke="#cf3444" stroke-width="8" stroke-linecap="round"/>'
      : "";
    return line + mark;
  }).join("");
  const nodeSvg = NODES.map((node) =>
    '<circle cx="' + node.x + '" cy="' + node.y + '" r="26" fill="#f0c36a" stroke="#243244" stroke-width="3"/>' +
    '<text x="' + node.x + '" y="' + (node.y + 7) + '" text-anchor="middle" font-family="Arial,sans-serif" font-size="20" font-weight="700" fill="#172033">' + node.id + '</text>' +
    '<text x="' + node.x + '" y="' + (node.y + 48) + '" text-anchor="middle" font-family="Arial,sans-serif" font-size="14" font-weight="700" fill="#243244">' + node.label + '</text>'
  ).join("");
  return '<svg xmlns="http://www.w3.org/2000/svg" width="960" height="640" viewBox="0 0 960 640">' +
    '<rect width="960" height="640" fill="#f7f5ee"/><rect x="18" y="18" width="924" height="604" rx="20" fill="#fbfaf6" stroke="#d5d0c4" stroke-width="2"/>' +
    '<text x="45" y="58" font-family="Arial,sans-serif" font-size="19" font-weight="700" fill="#243244">PAPER MAP</text>' +
    '<text x="760" y="58" font-family="Arial,sans-serif" font-size="14" font-weight="700" fill="#cf3444">RED X = CLOSED ROAD</text>' +
    roadSvg + nodeSvg + '</svg>';
}

async function pngFor(stage: Stage): Promise<Buffer> {
  const require = createRequire(process.cwd() + "/package.json");
  const sharp = require("sharp") as (input: Buffer) => { png(): { toBuffer(): Promise<Buffer> } };
  const png = await sharp(Buffer.from(svgFor(stage), "utf8")).png().toBuffer();
  assert.ok(png.byteLength > 0 && png.byteLength <= IMAGE_LIMIT, "synthetic PNG must fit the parser limit");
  assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", "synthetic drawing must be a PNG");
  const fixtureDirectory = path.join(process.cwd(), "public", "demo");
  await mkdir(fixtureDirectory, { recursive: true });
  await writeFile(path.join(fixtureDirectory, stage + ".png"), png);
  return png;
}

async function parseDrawing(stage: Stage, previous?: PaperMap) {
  const png = await pngFor(stage);
  const image = "data:image/png;base64," + png.toString("base64");
  const result = await parseMapImage(image, previous);
  assert.equal(result.provider, "codex", "map scans must use local Codex, not the paid API");
  return {
    result,
    image: { stage, format: "png", bytes: png.byteLength, sha256_prefix: createHash("sha256").update(png).digest("hex").slice(0, 12) },
  };
}

function location(map: PaperMap, kind: Location["kind"]): Location {
  const matches = map.locations.filter((entry) => entry.kind === kind);
  assert.equal(matches.length, 1, "map should contain exactly one " + kind);
  return matches[0]!;
}

function roadBetween(map: PaperMap, a: string, b: string): Road {
  const matches = map.roads.filter((road) => (road.from === a && road.to === b) || (road.from === b && road.to === a));
  assert.equal(matches.length, 1, "map should contain exactly one road between " + a + " and " + b);
  return matches[0]!;
}

function assertGraph(map: PaperMap, stage: Stage): void {
  assert.equal(map.locations.length, 4, stage + " scan should contain the four drawn locations");
  const depot = location(map, "depot");
  const junction = location(map, "junction");
  const home = location(map, "home");
  const shop = location(map, "shop");
  const expectedRoadCount = stage === "reconnected" ? 4 : 3;
  assert.equal(map.roads.length, expectedRoadCount, stage + " scan should contain only the drawn roads");
  assert.equal(roadBetween(map, depot.id, junction.id).closed, false);
  assert.equal(roadBetween(map, junction.id, home.id).closed, stage !== "initial");
  assert.equal(roadBetween(map, junction.id, shop.id).closed, false);
  if (stage === "reconnected") assert.equal(roadBetween(map, shop.id, home.id).closed, false);
}

function assertStableLocations(previous: PaperMap, next: PaperMap): void {
  for (const kind of ["depot", "junction", "home", "shop"] as const) {
    const before = location(previous, kind);
    const after = location(next, kind);
    assert.equal(after.id, before.id, kind + " ID should remain stable across scans");
    assert.equal(after.x, before.x, kind + " x coordinate should remain pinned across scans");
    assert.equal(after.y, before.y, kind + " y coordinate should remain pinned across scans");
  }
}

function apply(state: SimulationState, commands: Command[]): SimulationState {
  const result = applyCommands(state, commands);
  if (!result.accepted) throw new Error(result.error);
  return result.state;
}

function applyRescan(state: SimulationState, map: PaperMap): SimulationState {
  const result = applyMap(state, map);
  if (!result.accepted) throw new Error(result.error);
  return result.state;
}

async function main(): Promise<void> {
  loadEnvConfig(process.cwd());
  const providers = await getProviderStatus();
  assert.equal(providers.openaiApi.enabled, false, "paid OpenAI API mode must remain disabled");
  assert.equal(providers.image.provider, "codex");
  assert.equal(providers.command.provider, "codex");
  assert.equal(providers.image.ready, true, "local Codex sign-in must be ready");
  assert.equal(providers.command.ready, true, "local Codex sign-in must be ready");
  assert.equal(providers.jev.ready, true, "JEv must be ready");

  const initialScan = await parseDrawing("initial");
  const initial = initialScan.result;
  assertGraph(initial.map, "initial");
  assertStableLocations(initial.map, initial.map);
  const depot = location(initial.map, "depot");
  const junction = location(initial.map, "junction");
  const home = location(initial.map, "home");
  const shop = location(initial.map, "shop");
  assert.ok(shortestPath(initial.map, depot.id, home.id), "initial open map should connect depot to home");

  let state = createSimulation(initial.map, [{ id: COURIER_ID, name: "Mina", locationId: depot.id, capacity: 2 }]);
  state = apply(state, [
    { type: "create-package", from: depot.id, to: home.id, priority: "normal" },
    { type: "assign-package", packageId: "pkg-1", courierId: COURIER_ID },
  ]);
  state = tick(state, 0.01);
  let courier = state.couriers[0]!;
  assert.equal(state.packages[0]!.pickedUp, true, "package should be picked up while the courier is physically at the depot");
  assert.equal(state.events.filter((event) => event.type === "package_picked_up" && event.packageId === "pkg-1").length, 1);
  assert.ok(courier.segment, "assigned courier should start moving");
  assert.equal(courier.segment.from, depot.id);
  assert.equal(courier.segment.to, junction.id);
  const targetProgress = courier.segment.distance * 0.4;
  state = tick(state, Math.max(0, targetProgress - courier.segment.progress) / COURIER_SPEED);
  courier = state.couriers[0]!;
  assert.ok(courier.segment && courier.segment.progress > 0 && courier.segment.progress < courier.segment.distance, "courier should be between depot and junction");
  const midpointPosition = getCourierPosition(state, COURIER_ID);
  const midpointSegment = { ...courier.segment };
  const priorLocationCoordinates = state.map.locations.map((entry) => [entry.id, entry.x, entry.y]).sort((a, b) => String(a[0]).localeCompare(String(b[0])));

  const blockedScan = await parseDrawing("blocked", initial.map);
  assertGraph(blockedScan.result.map, "blocked");
  assertStableLocations(initial.map, blockedScan.result.map);
  assert.equal(roadBetween(blockedScan.result.map, junction.id, home.id).id, roadBetween(initial.map, junction.id, home.id).id, "closed road ID should remain stable");
  state = applyRescan(state, blockedScan.result.map);
  courier = state.couriers[0]!;
  assert.deepEqual(courier.segment, midpointSegment, "map application should preserve the active segment");
  assert.deepEqual(getCourierPosition(state, COURIER_ID), midpointPosition, "map application should preserve the physical position");
  assert.deepEqual(state.map.locations.map((entry) => [entry.id, entry.x, entry.y]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))), priorLocationCoordinates);
  assert.equal(state.packages[0]!.status, "unreachable", "closing the only route should strand the assigned package");

  const remainingTravelSeconds = (courier.segment!.distance - courier.segment!.progress) / COURIER_SPEED;
  state = tick(state, remainingTravelSeconds + 0.2);
  courier = state.couriers[0]!;
  assert.equal(courier.locationId, junction.id, "courier should reach the junction before stranding");
  assert.equal(courier.segment, null, "stranded courier should have no open next segment");
  assert.equal(state.packages[0]!.status, "unreachable");
  assert.equal(state.packages[0]!.pickedUp, true, "package stays aboard while the route is blocked");
  assert.equal(state.events.filter((event) => event.type === "package_picked_up" && event.packageId === "pkg-1").length, 1, "arrival at the junction must not create a duplicate pickup");
  assert.ok(state.events.some((event) => event.type === "package_unreachable" && event.packageId === "pkg-1"));

  const urgentProposal = await proposeCommand({
    text: "Set package pkg-1 to urgent.",
    map: state.map,
    packages: state.packages,
    couriers: state.couriers,
    mode: "jev",
  });
  assert.equal(urgentProposal.provider, "typesafe");
  assert.equal(urgentProposal.clarification, null);
  assert.deepEqual(urgentProposal.commands, [{ type: "set-priority", packageId: "pkg-1", priority: "urgent" }]);
  state = apply(state, urgentProposal.commands);
  assert.equal(state.packages[0]!.priority, "urgent");

  const recoveryScan = await parseDrawing("reconnected", blockedScan.result.map);
  assertGraph(recoveryScan.result.map, "reconnected");
  assertStableLocations(blockedScan.result.map, recoveryScan.result.map);
  const newRoad = roadBetween(recoveryScan.result.map, shop.id, home.id);
  assert.ok(!blockedScan.result.map.roads.some((road) => road.id === newRoad.id), "new shop-home connection should be detected");
  state = applyRescan(state, recoveryScan.result.map);
  assert.equal(state.packages[0]!.status, "in_transit", "new road should make the stranded package reachable again");
  assert.ok(state.events.some((event) => event.type === "package_resumed" && event.packageId === "pkg-1"));
  assert.equal(state.packages[0]!.pickedUp, true);

  for (let i = 0; i < 500 && state.packages[0]!.status !== "delivered"; i += 1) state = tick(state, 0.5);
  assert.equal(state.packages[0]!.status, "delivered", "courier should physically recover and deliver after the new road appears");
  assert.equal(state.packages[0]!.pickedUp, true);
  assert.equal(state.events.filter((event) => event.type === "package_picked_up" && event.packageId === "pkg-1").length, 1);
  assert.equal(state.events.filter((event) => event.type === "package_delivered" && event.packageId === "pkg-1").length, 1);

  let scratch = createSimulation(initial.map, [{ id: COURIER_ID, name: "Mina", locationId: depot.id, capacity: 2 }]);
  scratch = apply(scratch, [
    { type: "create-package", from: depot.id, to: home.id, priority: "normal" },
    { type: "create-package", from: junction.id, to: shop.id, priority: "normal" },
  ]);
  assert.equal(scratch.packages.length, 2, "Codex compound command must receive two existing packages");
  const unchanged = JSON.stringify(scratch);
  const ambiguous = await proposeCommand({
    text: "Make that package urgent.",
    map: scratch.map,
    packages: scratch.packages,
    couriers: scratch.couriers,
    mode: "jev",
  });
  assert.equal(ambiguous.provider, "typesafe");
  assert.equal(ambiguous.commands.length, 0);
  assert.ok(ambiguous.clarification, "ambiguous package target should receive a clarification");
  assert.equal(JSON.stringify(scratch), unchanged, "ambiguous JEv proposal must remain unapplied");

  const compoundRoad = roadBetween(initial.map, depot.id, junction.id);
  const compound = await proposeCommand({
    text: "Set package pkg-2 to urgent and close road " + compoundRoad.id + ".",
    map: scratch.map,
    packages: scratch.packages,
    couriers: scratch.couriers,
    mode: "openai",
  });
  assert.equal(compound.provider, "codex", "mode openai should use local Codex while paid API mode is disabled");
  assert.equal(compound.clarification, null);
  assert.equal(compound.commands.length, 2, "Codex should return both explicitly requested operations");
  assert.deepEqual(compound.commands.find((command) => command.type === "set-priority"), {
    type: "set-priority", packageId: "pkg-2", priority: "urgent",
  });
  assert.deepEqual(compound.commands.find((command) => command.type === "set-road"), {
    type: "set-road", roadId: compoundRoad.id, closed: true,
  });
  scratch = apply(scratch, compound.commands);
  assert.equal(scratch.packages.find((pkg) => pkg.id === "pkg-2")!.priority, "urgent");
  assert.equal(scratch.map.roads.find((road) => road.id === compoundRoad.id)!.closed, true);

  const records = [initialScan, blockedScan, recoveryScan];
  process.stdout.write(JSON.stringify({
    status: "passed",
    providers: {
      image: { provider: providers.image.provider, model: providers.image.model, ready: providers.image.ready },
      command: { provider: providers.command.provider, model: providers.command.model, ready: providers.command.ready },
      jev: { provider: "typesafe", model: providers.jev.model, ready: providers.jev.ready },
      paid_openai_api_enabled: providers.openaiApi.enabled,
    },
    drawings: records.map((record) => ({
      ...record.image,
      provider: record.result.provider,
      model: record.result.model,
      latency_ms: record.result.latencyMs,
      requires_review: record.result.requiresReview,
      review_reasons: record.result.reviewReasons,
      locations: record.result.map.locations.length,
      roads: record.result.map.roads.length,
    })),
    simulation: {
      courier_id: COURIER_ID,
      package_id: "pkg-1",
      preserved_mid_edge_position: midpointPosition,
      blocked_status: "unreachable",
      recovery_road_id: newRoad.id,
      final_status: state.packages[0]!.status,
      elapsed_seconds: state.elapsedSeconds,
      distance_traveled: state.distanceTraveled,
    },
    commands: {
      jev_priority: { provider: urgentProposal.provider, model: urgentProposal.model, latency_ms: urgentProposal.latencyMs, applied: true },
      jev_ambiguity: { provider: ambiguous.provider, model: ambiguous.model, latency_ms: ambiguous.latencyMs, clarified: Boolean(ambiguous.clarification), applied: false },
      codex_compound: { provider: compound.provider, model: compound.model, latency_ms: compound.latencyMs, command_types: compound.commands.map((command) => command.type), applied_to_scratch: true },
    },
  }, null, 2) + "\n");
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown acceptance failure";
  process.stderr.write(message + "\n");
  process.exitCode = 1;
});
