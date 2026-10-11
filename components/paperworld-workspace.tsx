"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DeliveryWorld, type RoadChangeKind } from "./delivery-world";
import { PaperworkPanel } from "./paperwork-panel";
import { OperationsWorkbench } from "./operations-workbench";
import {
  applyCommands,
  applyMap,
  createSimulation,
  getCourierPosition,
  getMetrics,
  shortestPath,
  startDemoDeliveries,
  tick,
} from "../lib/simulation";
import type { PaperMap, Package, SimulationEvent, SimulationState } from "../lib/schema";

const sampleMap: PaperMap = {
  locations: [
    { id: "depot", label: "Depot", kind: "depot", x: 47, y: 47 },
    { id: "home-north", label: "North home", kind: "home", x: 18, y: 17 },
    { id: "shop-north", label: "North shop", kind: "shop", x: 78, y: 17 },
    { id: "junction-west", label: "West junction", kind: "junction", x: 17, y: 77 },
    { id: "junction-south", label: "South junction", kind: "junction", x: 48, y: 78 },
    { id: "home-east", label: "East home", kind: "home", x: 80, y: 77 },
    { id: "shop-east", label: "East shop", kind: "shop", x: 82, y: 48 },
  ],
  roads: [
    { id: "road-1", from: "depot", to: "home-north", closed: false },
    { id: "road-2", from: "depot", to: "shop-north", closed: false },
    { id: "road-3", from: "depot", to: "junction-west", closed: false },
    { id: "road-4", from: "depot", to: "junction-south", closed: false },
    { id: "road-5", from: "depot", to: "shop-east", closed: true },
    { id: "road-6", from: "junction-west", to: "junction-south", closed: false },
    { id: "road-7", from: "junction-south", to: "home-east", closed: false },
    { id: "road-8", from: "shop-east", to: "home-east", closed: false },
    { id: "road-9", from: "shop-north", to: "shop-east", closed: false },
  ],
};

function getRoadChanges(previousMap: PaperMap, nextMap: PaperMap) {
  const previousRoads = new Map(previousMap.roads.map((road) => [road.id, road]));
  const previousLocations = new Map(previousMap.locations.map((location) => [location.id, location]));
  const nextLocations = new Map(nextMap.locations.map((location) => [location.id, location]));
  const changes = new Map<string, RoadChangeKind>();

  for (const road of nextMap.roads) {
    const previousRoad = previousRoads.get(road.id);
    if (!previousRoad) {
      changes.set(road.id, "new");
      continue;
    }

    const sameConnection =
      (previousRoad.from === road.from && previousRoad.to === road.to) ||
      (previousRoad.from === road.to && previousRoad.to === road.from);
    const previousFrom = previousLocations.get(previousRoad.from);
    const previousTo = previousLocations.get(previousRoad.to);
    const nextFrom = nextLocations.get(road.from);
    const nextTo = nextLocations.get(road.to);
    const sameGeometry = Boolean(
      previousFrom && previousTo && nextFrom && nextTo && (
        (previousFrom.x === nextFrom.x && previousFrom.y === nextFrom.y && previousTo.x === nextTo.x && previousTo.y === nextTo.y) ||
        (previousFrom.x === nextTo.x && previousFrom.y === nextTo.y && previousTo.x === nextFrom.x && previousTo.y === nextFrom.y)
      ),
    );

    if (!sameConnection || !sameGeometry || previousRoad.closed !== road.closed) {
      changes.set(road.id, "changed");
    }
  }

  return changes;
}

function createSampleSimulation() {
  const initial = createSimulation(sampleMap);
  const result = applyCommands(initial, [
    { type: "create-package", from: "home-north", to: "home-east", priority: "urgent" },
    { type: "assign-package", packageId: "pkg-1", courierId: "courier-1" },
    { type: "create-package", from: "shop-north", to: "junction-west", priority: "normal" },
    { type: "assign-package", packageId: "pkg-2", courierId: "courier-2" },
  ]);
  return result.accepted ? result.state : initial;
}

function formatElapsed(seconds: number) {
  const total = Math.floor(seconds);
  const minutes = Math.floor(total / 60);
  const remainder = total % 60;
  return `${minutes}:${remainder.toString().padStart(2, "0")}`;
}

function formatRate(value: number) {
  return value.toFixed(1);
}

function eventDescription(event: SimulationEvent, state: SimulationState) {
  const packageId = event.packageId;
  const courier = event.courierId ? state.couriers.find((item) => item.id === event.courierId) : undefined;
  const pkg = packageId ? state.packages.find((item) => item.id === packageId) : undefined;
  const road = event.roadId ? state.map.roads.find((item) => item.id === event.roadId) : undefined;
  const from = pkg ? state.map.locations.find((item) => item.id === pkg.from)?.label : undefined;
  const to = pkg ? state.map.locations.find((item) => item.id === pkg.to)?.label : undefined;
  const packageRoute = pkg && from && to ? `${pkg.id} · ${from} → ${to}` : packageId ?? "package";

  switch (event.type) {
    case "package_created": return `${packageRoute} created`;
    case "package_assigned": return `${packageRoute} assigned to ${courier?.name ?? event.courierId}`;
    case "priority_changed": return `${packageId ?? "Package"} priority changed`;
    case "road_closed": return `${road?.id ?? event.roadId} closed`;
    case "road_opened": return `${road?.id ?? event.roadId} reopened`;
    case "package_unreachable": return `${packageId ?? "Package"} route unreachable`;
    case "package_resumed": return `${packageId ?? "Package"} route restored`;
    case "package_picked_up": return `${packageId ?? "Package"} picked up by ${courier?.name ?? event.courierId}`;
    case "package_delivered": return `${packageId ?? "Package"} delivered by ${courier?.name ?? event.courierId}`;
    case "map_updated": return "Map update applied";
  }
}

function packageStatusLabel(status: Package["status"]) {
  switch (status) {
    case "in_transit": return "In transit";
    case "unreachable": return "Unreachable";
    default: return status.charAt(0).toUpperCase() + status.slice(1);
  }
}

export function PaperworldWorkspace() {
  const [simulation, setSimulation] = useState<SimulationState>(createSampleSimulation);
  const simulationRef = useRef(simulation);
  const [scenario, setScenario] = useState<"sample" | "scanned">("sample");
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<0.25 | 1 | 4>(0.25);
  const [worldRevision, setWorldRevision] = useState(0);
  const [mapRevision, setMapRevision] = useState(0);
  const [roadChanges, setRoadChanges] = useState<ReadonlyMap<string, RoadChangeKind>>(() => new Map());
  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;
  const resumeAfterPaperworkRef = useRef(false);

  const updateSimulation = useCallback((update: (current: SimulationState) => SimulationState) => {
    const next = update(simulationRef.current);
    simulationRef.current = next;
    setSimulation(next);
  }, []);

  useEffect(() => {
    if (!isPlaying) return;
    const interval = window.setInterval(() => {
      updateSimulation((current) => tick(current, 0.25 * playbackSpeed));
    }, 250);
    return () => window.clearInterval(interval);
  }, [isPlaying, playbackSpeed, updateSimulation]);

  const metrics = useMemo(() => getMetrics(simulation), [simulation]);
  const locationById = useMemo(
    () => new Map(simulation.map.locations.map((location) => [location.id, location])),
    [simulation.map.locations],
  );
  const courierMarkers = useMemo(() => {
    const allRoadsOpenMap: PaperMap = {
      locations: simulation.map.locations,
      roads: simulation.map.roads.map((road) => ({ ...road, closed: false })),
    };
    const locationById = new Map(simulation.map.locations.map((location) => [location.id, location]));

    return simulation.couriers.map((courier) => {
      const position = getCourierPosition(simulation, courier.id);
      const assignedPackages = courier.packageIds
        .map((packageId) => simulation.packages.find((pkg) => pkg.id === packageId))
        .filter((pkg): pkg is Package => pkg !== undefined && pkg.status !== "delivered")
        .sort((left, right) => Number(right.priority === "urgent") - Number(left.priority === "urgent") || left.createdOrder - right.createdOrder);
      const schedulablePackages = assignedPackages.filter((pkg) => pkg.status !== "unreachable");
      const activePackage = schedulablePackages[0] ?? assignedPackages[0];
      const blockedPackage = assignedPackages.find((pkg) => pkg.status === "unreachable");
      const routeTarget = activePackage ? (activePackage.pickedUp ? activePackage.to : activePackage.from) : null;
      const currentSegmentRoad = courier.segment
        ? simulation.map.roads.find((road) => road.id === courier.segment?.roadId)
        : undefined;
      const currentSegmentRoadMatches = Boolean(
        currentSegmentRoad && courier.segment &&
        ((currentSegmentRoad.from === courier.segment.from && currentSegmentRoad.to === courier.segment.to) ||
          (currentSegmentRoad.from === courier.segment.to && currentSegmentRoad.to === courier.segment.from)),
      );
      const effectiveLocation = courier.segment?.to ?? courier.locationId;
      const currentRoute = routeTarget && activePackage?.status !== "unreachable"
        ? shortestPath(simulation.map, effectiveLocation, routeTarget)
        : null;
      const unobstructedRoute = routeTarget && activePackage?.status !== "unreachable"
        ? shortestPath(allRoadsOpenMap, effectiveLocation, routeTarget)
        : null;
      const routeRoadIds = [
        ...(courier.segment && currentSegmentRoadMatches ? [courier.segment.roadId] : []),
        ...(currentRoute?.roadIds ?? []),
      ];
      const routeReplanned = Boolean(
        currentRoute && unobstructedRoute &&
        currentRoute.roadIds.join("\u0000") !== unobstructedRoute.roadIds.join("\u0000"),
      );
      const fromLabel = activePackage ? locationById.get(activePackage.from)?.label ?? activePackage.from : "";
      const toLabel = activePackage ? locationById.get(activePackage.to)?.label ?? activePackage.to : "";
      const activeTargetLabel = activePackage
        ? activePackage.pickedUp ? toLabel : fromLabel
        : null;
      const waitingReason = activePackage?.status === "unreachable"
        ? courier.segment
          ? `No open route to ${activePackage.pickedUp ? "destination" : "pickup"}; this delivery will wait after the current road`
          : `No open route to ${activePackage.pickedUp ? "destination" : "pickup"}; package is waiting`
        : activePackage && !courier.segment && courier.locationId === routeTarget
          ? activePackage.pickedUp ? "At delivery stop; package will be delivered on the next step" : "At pickup; package will be collected on the next step"
          : activePackage && !courier.segment
          ? `Ready for the next leg toward ${activeTargetLabel}`
          : activePackage
            ? `Traveling toward ${activeTargetLabel}`
              : `Available at ${locationById.get(courier.locationId)?.label ?? "current stop"}`;
      const nextActionLabel = activePackage && activePackage.status !== "unreachable"
        ? activePackage.pickedUp ? `deliver ${activePackage.id} at ${toLabel}` : `pick up ${activePackage.id} at ${fromLabel}`
        : null;

      return {
        id: courier.id,
        label: courier.name,
        x: position.x,
        y: position.y,
        activePackage: activePackage ? {
          id: activePackage.id,
          fromLabel,
          toLabel,
          priority: activePackage.priority,
          status: activePackage.status,
          pickedUp: activePackage.pickedUp,
        } : null,
        blockedPackage: blockedPackage ? {
          id: blockedPackage.id,
          targetLabel: locationById.get(blockedPackage.pickedUp ? blockedPackage.to : blockedPackage.from)?.label ?? (blockedPackage.pickedUp ? blockedPackage.to : blockedPackage.from),
          phase: blockedPackage.pickedUp ? "delivery" as const : "pickup" as const,
        } : null,
        additionalPackageCount: Math.max(0, assignedPackages.length - 1),
        routeRoadIds: [...new Set(routeRoadIds)],
        routeReplanned,
        pinnedSegment: courier.segment && !currentSegmentRoadMatches ? {
          fromX: courier.segment.fromX,
          fromY: courier.segment.fromY,
          toX: courier.segment.toX,
          toY: courier.segment.toY,
        } : null,
        currentSegmentToLabel: courier.segment ? locationById.get(courier.segment.to)?.label ?? courier.segment.to : null,
        nextActionLabel,
        waitingReason,
      };
    });
  }, [simulation]);
  const pinnedLocationIds = useMemo(() => {
    const ids = new Set<string>();
    for (const courier of simulation.couriers) {
      ids.add(courier.locationId);
      if (courier.segment) {
        ids.add(courier.segment.from);
        ids.add(courier.segment.to);
      }
    }
    for (const pkg of simulation.packages) {
      ids.add(pkg.from);
      ids.add(pkg.to);
    }
    return ids;
  }, [simulation]);
  const sortedPackages = useMemo(
    () => [...simulation.packages].sort((left, right) => right.createdOrder - left.createdOrder),
    [simulation.packages],
  );
  const visibleEvents = useMemo(() => [...simulation.events].reverse().slice(0, 8), [simulation.events]);

  function applyProposedMap(map: PaperMap, startsFreshWorld: boolean) {
    const changes = getRoadChanges(simulationRef.current.map, map);
    if (startsFreshWorld) {
      updateSimulation(() => createSimulation(map));
      setRoadChanges(changes);
      setScenario("scanned");
      setIsPlaying(false);
      setWorldRevision((revision) => revision + 1);
      setMapRevision((revision) => revision + 1);
      return null;
    }

    const result = applyMap(simulationRef.current, map);
    if (!result.accepted) return result.error;
    updateSimulation(() => result.state);
    setRoadChanges(changes);
    setWorldRevision((revision) => revision + 1);
    setMapRevision((revision) => revision + 1);
    return null;
  }

  function applyCommandsToSimulation(commands: Parameters<typeof applyCommands>[1]) {
    const current = simulationRef.current;
    const result = applyCommands(current, commands);
    if (!result.accepted) return result.error;
    updateSimulation(() => result.state);
    setWorldRevision((revision) => revision + 1);
    if (commands.some((command) => command.type === "set-road")) {
      const changes = getRoadChanges(current.map, result.state.map);
      if (changes.size) setRoadChanges(changes);
      setMapRevision((revision) => revision + 1);
    }
    return null;
  }

  function startDemoRun() {
    const result = startDemoDeliveries(simulationRef.current);
    if (!result.accepted) return result.error;
    updateSimulation(() => result.state);
    setPlaybackSpeed(0.25);
    resumeAfterPaperworkRef.current = false;
    isPlayingRef.current = true;
    setIsPlaying(true);
    setWorldRevision((revision) => revision + 1);
    return null;
  }

  function resetSimulation() {
    updateSimulation((current) => scenario === "sample" ? createSampleSimulation() : createSimulation(current.map));
    setRoadChanges(new Map());
    setIsPlaying(false);
    setWorldRevision((revision) => revision + 1);
    setMapRevision((revision) => revision + 1);
  }

  function toggleRoad(roadId: string) {
    const current = simulationRef.current;
    const road = current.map.roads.find((candidate) => candidate.id === roadId);
    if (!road) return "That road is no longer on the map. Refresh the route view and try again.";
    const result = applyMap(current, {
      ...current.map,
      roads: current.map.roads.map((candidate) => candidate.id === roadId
        ? { ...candidate, closed: !candidate.closed }
        : candidate),
    });
    if (!result.accepted) return result.error;
    updateSimulation(() => result.state);
    setRoadChanges(getRoadChanges(current.map, result.state.map));
    setWorldRevision((revision) => revision + 1);
    setMapRevision((revision) => revision + 1);
    return null;
  }

  function pauseForPaperwork() {
    if (isPlayingRef.current) resumeAfterPaperworkRef.current = true;
    isPlayingRef.current = false;
    setIsPlaying(false);
  }

  function finishPaperworkReview() {
    resumeAfterPaperworkRef.current = false;
    isPlayingRef.current = false;
    setIsPlaying(false);
  }

  function togglePlayback() {
    resumeAfterPaperworkRef.current = false;
    setIsPlaying((playing) => {
      isPlayingRef.current = !playing;
      return !playing;
    });
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <a className="brand" href="#main" aria-label="Paperworld home">
          <span className="brand-mark" aria-hidden="true"><i /><i /><i /><i /></span>
          <span>paperworld</span>
        </a>
        <div className="header-actions">
          <div className="header-state">
            <span className="state-mark" aria-hidden="true" />
            <span>{scenario === "sample" ? "Example" : "Scanned map"}</span>
            <span className="header-state-separator" aria-hidden="true">·</span>
            <span>{isPlaying ? "Running" : "Paused"}</span>
          </div>
          <button
            className={`simulation-toggle ${isPlaying ? "simulation-toggle-playing" : ""}`}
            type="button"
            onClick={togglePlayback}
            aria-label={isPlaying ? "Pause simulation" : "Resume simulation"}
            aria-pressed={isPlaying}
          >
            <span className="simulation-toggle-icon" aria-hidden="true">{isPlaying ? "Ⅱ" : "▶"}</span>
            <span>{isPlaying ? "Pause" : "Resume"}</span>
          </button>
        </div>
      </header>

      <main id="main" className="main-content">
        <h1 className="visually-hidden">Paperworld delivery demo</h1>

        <div className="workspace-grid">
          <section className="world-column" aria-labelledby="world-title">
            <div className="column-heading">
              <div>
                <h2 id="world-title">Route plan</h2>
              </div>
              <div className="simulation-clock" aria-label={`Elapsed simulation time ${formatElapsed(metrics.elapsedSeconds)}`}>
                <span className={`clock-dot ${isPlaying ? "clock-dot-running" : ""}`} aria-hidden="true" />
                <strong>{formatElapsed(metrics.elapsedSeconds)}</strong>
              </div>
            </div>
            <DeliveryWorld
              locations={simulation.map.locations}
              roads={simulation.map.roads}
              couriers={courierMarkers}
              roadChanges={roadChanges}
              onToggleRoad={toggleRoad}
            />
            <details className="run-controls">
              <summary>Playback controls <span>{playbackSpeed}× speed</span></summary>
              <div className="run-control-content">
                <button className="simulation-step" type="button" onClick={() => updateSimulation((current) => tick(current, 1))} aria-label="Advance simulation by one second">
                  <span aria-hidden="true">›</span> Step 1 second
                </button>
                <label className="speed-select"><span>Speed</span><select aria-label="Simulation speed" value={playbackSpeed} onChange={(event) => setPlaybackSpeed(Number(event.target.value) as 0.25 | 1 | 4)}>
                  <option value={0.25}>0.25× demo</option><option value={1}>1×</option><option value={4}>4×</option>
                </select></label>
                <button className="simulation-reset" type="button" onClick={resetSimulation}>Reset run</button>
              </div>
            </details>
          </section>

          <OperationsWorkbench simulation={simulation} worldRevision={worldRevision} onApplyCommands={applyCommandsToSimulation} />

          <PaperworkPanel
            previousMap={simulation.map}
            startsNewWorld={scenario === "sample"}
            mapRevision={mapRevision}
            pinnedLocationIds={pinnedLocationIds}
            onScanStart={() => setRoadChanges(new Map())}
            onApply={applyProposedMap}
            onPauseSimulation={pauseForPaperwork}
            onFinishReview={finishPaperworkReview}
            onStartDemoDeliveries={startDemoRun}
      demoStartAvailable={scenario === "scanned" && !simulation.packages.some((pkg) => pkg.source === "demo")}
          />
        </div>

        <details className="run-details" id="run-details">
          <summary className="disclosure-summary">
            <span><strong>Run details</strong><small>Metrics, couriers, packages, and activity</small></span>
            <span className="disclosure-chevron" aria-hidden="true">⌄</span>
          </summary>
        <section className="operations-section" aria-labelledby="operations-title">
          <div className="operations-heading">
            <div>
              <p className="section-kicker">SIMULATION</p>
              <h2 id="operations-title">Operations</h2>
            </div>
            <span className="local-state-label"><span aria-hidden="true" /> Local simulation</span>
          </div>

          <div className="metric-strip" aria-label="Simulation metrics">
            <div className="metric-cell">
              <span className="metric-label">Delivered</span>
              <strong>{metrics.deliveredCount.toString().padStart(2, "0")}</strong>
              <small>{formatRate(metrics.deliveriesPerMinute)} per minute</small>
            </div>
            <div className="metric-cell">
              <span className="metric-label">Active</span>
              <strong>{(metrics.assignedCount + metrics.inTransitCount).toString().padStart(2, "0")}</strong>
              <small>assigned or in transit</small>
            </div>
            <div className="metric-cell">
              <span className="metric-label">Waiting</span>
              <strong>{(metrics.queuedCount + metrics.unreachableCount).toString().padStart(2, "0")}</strong>
              <small>{metrics.queuedCount} queued · {metrics.unreachableCount} blocked</small>
            </div>
          </div>

          <div className="operations-grid">
            <section className="operation-list" aria-labelledby="couriers-title">
              <div className="list-heading">
                <h3 id="couriers-title">Couriers</h3>
                <span>{simulation.couriers.length} on shift</span>
              </div>
              <div className="courier-list">
                {simulation.couriers.map((courier) => {
                  const atLocation = locationById.get(courier.locationId)?.label ?? courier.locationId;
                  const nextLocation = courier.segment
                    ? locationById.get(courier.segment.to)?.label ?? courier.segment.to
                    : undefined;
                  const packageSummary = courier.packageIds.length
                    ? `${courier.packageIds.join(", ")} · ${courier.packageIds.length}/${courier.capacity} slots`
                    : `No assigned packages · 0/${courier.capacity} slots`;
                  return (
                    <div className="courier-row" key={courier.id}>
                      <span className="courier-avatar" aria-hidden="true">{courier.name.slice(0, 1).toUpperCase()}</span>
                      <div className="courier-main">
                        <strong>{courier.name}</strong>
                        <span>{packageSummary}</span>
                      </div>
                      <div className="courier-route">
                        <span>{courier.segment ? "EN ROUTE" : "AT STOP"}</span>
                        <strong>{courier.segment ? `${atLocation} → ${nextLocation}` : atLocation}</strong>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="operation-list package-operation" aria-labelledby="packages-title">
              <div className="list-heading">
                <h3 id="packages-title">Packages</h3>
                <span>{simulation.packages.length} total</span>
              </div>
              {sortedPackages.length ? (
                <div className="package-list">
                  {sortedPackages.map((pkg) => {
                    const from = locationById.get(pkg.from)?.label ?? pkg.from;
                    const to = locationById.get(pkg.to)?.label ?? pkg.to;
                    const courier = pkg.courierId
                      ? simulation.couriers.find((item) => item.id === pkg.courierId)
                      : undefined;
                    return (
                      <div className="package-row" key={pkg.id}>
                        <div className="package-route">
                          <strong>{pkg.id}{pkg.source === "demo" ? <span className="demo-package-badge">DEMO</span> : null}</strong>
                          <span>{from} <i aria-hidden="true">→</i> {to}</span>
                        </div>
                        <span className={`priority-label ${pkg.priority === "urgent" ? "priority-urgent" : ""}`}>
                          <i aria-hidden="true" />{pkg.priority}
                        </span>
                        <span className={`package-status package-status-${pkg.status}`}>
                          {packageStatusLabel(pkg.status)}
                        </span>
                        <span className="package-courier">{courier?.name ?? "Unassigned"}</span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="empty-operation-state">
                  <span className="empty-state-mark" aria-hidden="true">＋</span>
                  <div><strong>No packages yet</strong><span>Packages will appear here when commands are added.</span></div>
                </div>
              )}
            </section>

            <section className="operation-list event-operation" aria-labelledby="events-title">
              <div className="list-heading">
                <h3 id="events-title">Event log</h3>
                <span>Last {visibleEvents.length} events</span>
              </div>
              {visibleEvents.length ? (
                <ol className="event-list">
                  {visibleEvents.map((event) => (
                    <li key={event.id}>
                      <time dateTime={`PT${Math.floor(event.atSeconds)}S`}>{formatElapsed(event.atSeconds)}</time>
                      <span className="event-mark" aria-hidden="true" />
                      <span>{eventDescription(event, simulation)}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <div className="empty-operation-state event-empty-state">
                  <span className="empty-state-mark" aria-hidden="true">↳</span>
                  <div><strong>Waiting for activity</strong><span>Simulation events will be recorded here.</span></div>
                </div>
              )}
            </section>
          </div>
        </section>
        </details>

        <footer className="page-footer">
          <span>Paperworld <span className="footer-separator">/</span> Dispatch workspace</span>
          <span>{scenario === "sample" ? "Sample scenario · no provider result" : "Local simulation · provider result shown per scan"}</span>
        </footer>
      </main>
    </div>
  );
}
