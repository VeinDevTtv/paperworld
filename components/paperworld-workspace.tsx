"use client";

import { useEffect, useMemo, useState } from "react";
import { DeliveryWorld } from "./delivery-world";
import { PaperworkPanel } from "./paperwork-panel";
import { OperationsWorkbench } from "./operations-workbench";
import {
  applyCommands,
  applyMap,
  createSimulation,
  getCourierPosition,
  getMetrics,
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
  const [scenario, setScenario] = useState<"sample" | "scanned">("sample");
  const [isPlaying, setIsPlaying] = useState(true);
  const [playbackSpeed, setPlaybackSpeed] = useState<1 | 2 | 4>(1);

  useEffect(() => {
    if (!isPlaying) return;
    const interval = window.setInterval(() => {
      setSimulation((current) => tick(current, 0.25 * playbackSpeed));
    }, 250);
    return () => window.clearInterval(interval);
  }, [isPlaying, playbackSpeed]);

  const metrics = useMemo(() => getMetrics(simulation), [simulation]);
  const locationById = useMemo(
    () => new Map(simulation.map.locations.map((location) => [location.id, location])),
    [simulation.map.locations],
  );
  const courierMarkers = useMemo(() => simulation.couriers.map((courier) => {
    const position = getCourierPosition(simulation, courier.id);
    return { id: courier.id, label: courier.name, x: position.x, y: position.y };
  }), [simulation]);
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

  function applyProposedMap(map: PaperMap) {
    if (scenario === "sample") {
      setSimulation(createSimulation(map));
      setScenario("scanned");
      setIsPlaying(false);
      return null;
    }

    const result = applyMap(simulation, map);
    if (!result.accepted) return result.error;
    setSimulation(result.state);
    return null;
  }

  function applyCommandsToSimulation(commands: Parameters<typeof applyCommands>[1]) {
    const result = applyCommands(simulation, commands);
    if (!result.accepted) return result.error;
    setSimulation(result.state);
    return null;
  }

  function resetSimulation() {
    setSimulation(() => scenario === "sample" ? createSampleSimulation() : createSimulation(simulation.map));
    setIsPlaying(false);
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <a className="brand" href="#main" aria-label="Paperworld home">
          <span className="brand-mark" aria-hidden="true"><i /><i /><i /><i /></span>
          <span>paperworld</span>
        </a>
        <div className="header-context" aria-label="Current workspace">
          <span className="header-divider" aria-hidden="true" />
          <span className="header-context-label">FIELD DESK</span>
          <span className="header-context-value">Delivery network</span>
        </div>
        <div className="header-state">
          <span className="state-mark" aria-hidden="true" />
          <span>{scenario === "sample" ? "Sample scenario" : "Local simulation"}</span>
        </div>
      </header>

      <main id="main" className="main-content">
        <div className="page-heading">
          <div>
            <p className="eyebrow">COURIER OPERATIONS <span>/</span> NETWORK 01</p>
            <h1>Delivery network</h1>
            <p className="page-description">
              Turn a paper route sketch into a reviewable, working delivery world.
            </p>
          </div>
          <div className="heading-actions">
            <div className={`scenario-label ${scenario === "sample" ? "scenario-label-sample" : ""}`}>
              <span className="sample-label-dot" aria-hidden="true" />
              <span>{scenario === "sample" ? "Illustrative sample" : "Scanned network"}</span>
            </div>
            <button
              className={`simulation-toggle ${isPlaying ? "simulation-toggle-playing" : ""}`}
              type="button"
              onClick={() => setIsPlaying((playing) => !playing)}
              aria-label={isPlaying ? "Pause simulation" : "Resume simulation"}
              aria-pressed={isPlaying}
            >
              <span className="simulation-toggle-icon" aria-hidden="true">{isPlaying ? "Ⅱ" : "▶"}</span>
              <span>{isPlaying ? "Pause" : "Resume"}</span>
            </button>
            <button className="simulation-step" type="button" onClick={() => setSimulation((current) => tick(current, 1))} aria-label="Advance simulation by one second">
              <span aria-hidden="true">›</span><span>Step 1s</span>
            </button>
            <label className="speed-select"><span>Speed</span><select aria-label="Simulation speed" value={playbackSpeed} onChange={(event) => setPlaybackSpeed(Number(event.target.value) as 1 | 2 | 4)}>
              <option value={1}>1×</option><option value={2}>2×</option><option value={4}>4×</option>
            </select></label>
            <button className="simulation-reset" type="button" onClick={resetSimulation}>Reset run</button>
          </div>
        </div>

        <div className="workspace-grid">
          <section className="world-column" aria-labelledby="world-title">
            <div className="column-heading">
              <div>
                <p className="section-kicker">NETWORK VIEW</p>
                <h2 id="world-title">Route plan</h2>
              </div>
              <div className="simulation-clock">
                <span className={`clock-dot ${isPlaying ? "clock-dot-running" : ""}`} aria-hidden="true" />
                <span>{isPlaying ? "RUNNING" : "PAUSED"}</span>
                <strong>{formatElapsed(metrics.elapsedSeconds)}</strong>
              </div>
            </div>
            <DeliveryWorld
              locations={simulation.map.locations}
              roads={simulation.map.roads}
              couriers={courierMarkers}
            />
            <div className="world-caption">
              <span>{scenario === "sample" ? "SAMPLE DATA" : "LOCAL STATE"}</span>
              <span>{scenario === "sample"
                ? "A labeled example run. Applying your first drawing starts a fresh simulation."
                : "Courier movement and delivery events are computed locally from the current map."}</span>
            </div>
          </section>

          <PaperworkPanel
            previousMap={simulation.map}
            startsNewWorld={scenario === "sample"}
            pinnedLocationIds={pinnedLocationIds}
            onApply={applyProposedMap}
          />
        </div>

        <OperationsWorkbench simulation={simulation} onApplyCommands={applyCommandsToSimulation} />

        <section className="operations-section" aria-labelledby="operations-title">
          <div className="operations-heading">
            <div>
              <p className="section-kicker">SIMULATION</p>
              <h2 id="operations-title">Operations</h2>
            </div>
            <span className="local-state-label"><span aria-hidden="true" /> Deterministic local run</span>
          </div>

          <div className="metric-strip" aria-label="Simulation metrics">
            <div className="metric-cell">
              <span className="metric-label">Packages</span>
              <strong>{metrics.packageCount.toString().padStart(2, "0")}</strong>
              <small>{metrics.queuedCount} queued · {metrics.assignedCount + metrics.inTransitCount} active</small>
            </div>
            <div className="metric-cell">
              <span className="metric-label">Delivered</span>
              <strong>{metrics.deliveredCount.toString().padStart(2, "0")}</strong>
              <small>{formatRate(metrics.deliveriesPerMinute)} per minute</small>
            </div>
            <div className="metric-cell">
              <span className="metric-label">Distance</span>
              <strong>{metrics.distanceTraveled.toFixed(1)}</strong>
              <small>map units traveled</small>
            </div>
            <div className="metric-cell">
              <span className="metric-label">Couriers</span>
              <strong>{metrics.movingCouriers.toString().padStart(2, "0")} <em>/ {simulation.couriers.length.toString().padStart(2, "0")}</em></strong>
              <small>{metrics.movingCouriers} moving · {metrics.idleCouriers} idle</small>
            </div>
            <div className="metric-cell">
              <span className="metric-label">Unreachable</span>
              <strong>{metrics.unreachableCount.toString().padStart(2, "0")}</strong>
              <small>routes needing attention</small>
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
                  {sortedPackages.slice(0, 6).map((pkg) => {
                    const from = locationById.get(pkg.from)?.label ?? pkg.from;
                    const to = locationById.get(pkg.to)?.label ?? pkg.to;
                    const courier = pkg.courierId
                      ? simulation.couriers.find((item) => item.id === pkg.courierId)
                      : undefined;
                    return (
                      <div className="package-row" key={pkg.id}>
                        <div className="package-route">
                          <strong>{pkg.id}</strong>
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
                  {sortedPackages.length > 6 ? <p className="list-overflow">+ {sortedPackages.length - 6} more packages</p> : null}
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

        <footer className="page-footer">
          <span>Paperworld <span className="footer-separator">/</span> Dispatch workspace</span>
          <span>{scenario === "sample" ? "Sample scenario · no provider result" : "Local simulation · provider result shown per scan"}</span>
        </footer>
      </main>
    </div>
  );
}
