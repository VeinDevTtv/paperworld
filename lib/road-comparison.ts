import type { PaperMap, SimulationState } from "./schema";
import { paperMapSchema } from "./schema";
import { applyMap, getMetrics, tick } from "./simulation";

export const COMPARISON_INTERVAL_SECONDS = 20;

export interface RoadComparisonCapture {
  before: SimulationState;
  editedMap: PaperMap;
  capturedAtSeconds: number;
}

export interface RoadComparisonMetrics {
  delivered: number;
  waiting: number;
  distance: number;
  completedPackageIds: string[];
}

export interface RoadComparisonResult {
  capturedAtSeconds: number;
  intervalSeconds: number;
  withoutChange: SimulationState;
  withChange: SimulationState;
  withoutMetrics: RoadComparisonMetrics;
  withMetrics: RoadComparisonMetrics;
}

function locationsKey(map: PaperMap): string {
  return JSON.stringify([...map.locations].sort((a, b) => a.id.localeCompare(b.id)));
}

function roadsKey(map: PaperMap): string {
  return JSON.stringify([...map.roads].sort((a, b) => a.id.localeCompare(b.id))
    .map(({ id, from, to, closed }) => ({ id, from, to, closed: Boolean(closed) })));
}

/** Freeze one pre-edit snapshot; never retain references into the live run. */
export function captureRoadComparison(before: SimulationState, editedMap: PaperMap): RoadComparisonCapture | null {
  const parsed = paperMapSchema.safeParse(editedMap);
  if (!parsed.success || locationsKey(before.map) !== locationsKey(parsed.data)
    || roadsKey(before.map) === roadsKey(parsed.data)) return null;
  const snapshot = structuredClone(before);
  const candidate = structuredClone(parsed.data);
  if (!applyMap(snapshot, candidate).accepted) return null;
  return { before: snapshot, editedMap: candidate, capturedAtSeconds: before.elapsedSeconds };
}

function metrics(before: SimulationState, outcome: SimulationState): RoadComparisonMetrics {
  const counts = getMetrics(outcome);
  const previouslyDelivered = new Set(before.packages.filter((p) => p.status === "delivered").map((p) => p.id));
  return {
    delivered: counts.deliveredCount,
    waiting: counts.unreachableCount,
    distance: outcome.distanceTraveled - before.distanceTraveled,
    completedPackageIds: outcome.packages.filter((p) => p.status === "delivered" && !previouslyDelivered.has(p.id)).map((p) => p.id),
  };
}

/** Both branches use the same engine and fixed interval. Only the map edit differs. */
export function runRoadComparison(capture: RoadComparisonCapture): RoadComparisonResult {
  const before = structuredClone(capture.before);
  const edited = applyMap(structuredClone(before), structuredClone(capture.editedMap));
  if (!edited.accepted) throw new Error(`This road change cannot be compared: ${edited.error}`);
  const withoutChange = tick(structuredClone(before), COMPARISON_INTERVAL_SECONDS);
  const withChange = tick(edited.state, COMPARISON_INTERVAL_SECONDS);
  return {
    capturedAtSeconds: before.elapsedSeconds,
    intervalSeconds: COMPARISON_INTERVAL_SECONDS,
    withoutChange,
    withChange,
    withoutMetrics: metrics(before, withoutChange),
    withMetrics: metrics(before, withChange),
  };
}
