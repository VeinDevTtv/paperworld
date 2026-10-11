"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";

const DeliveryWorld3D = dynamic(() => import("./delivery-world-3d"), { ssr: false, loading: () => <div className="world-loading" role="status">Building your 3D world…</div> });

export type LocationKind = "depot" | "home" | "shop" | "junction";

export type WorldLocation = {
  id: string;
  label: string;
  kind: LocationKind;
  x: number;
  y: number;
};

export type WorldRoad = {
  id: string;
  from: string;
  to: string;
  closed: boolean;
};

export type RoadChangeKind = "new" | "changed";

export type CourierMarker = {
  id: string;
  label: string;
  x: number;
  y: number;
  activePackage?: {
    id: string;
    fromLabel: string;
    toLabel: string;
    priority: "normal" | "urgent";
    status: "queued" | "assigned" | "in_transit" | "unreachable" | "delivered";
    pickedUp: boolean;
  } | null;
  blockedPackage?: { id: string; targetLabel: string; phase: "pickup" | "delivery" } | null;
  additionalPackageCount?: number;
  routeRoadIds?: string[];
  routeReplanned?: boolean;
  currentSegmentToLabel?: string | null;
  pinnedSegment?: { fromX: number; fromY: number; toX: number; toY: number } | null;
  nextActionLabel?: string | null;
  waitingReason?: string;
  heading?: number;
};

type DeliveryWorldProps = {
  locations: WorldLocation[];
  roads: WorldRoad[];
  couriers?: CourierMarker[];
  roadChanges?: ReadonlyMap<string, RoadChangeKind>;
  onToggleRoad?: (roadId: string) => string | null;
  mapRevision?: number;
  worldBirthRevision?: number;
  deliveredEvents?: { id: string; courierId?: string }[];
  suppressDeliveryEffects?: boolean;
};

export type WorldSelection =
  | { kind: "location"; id: string }
  | { kind: "road"; id: string }
  | { kind: "courier"; id: string };

const EMPTY_DELIVERED_EVENTS: { id: string; courierId?: string }[] = [];
const VIEWBOX_WIDTH = 1000;
const VIEWBOX_HEIGHT = 560;

function toPoint(x: number, y: number) {
  return {
    x: 60 + (x / 100) * 880,
    y: 48 + (y / 100) * 464,
  };
}

function pathForRoad(from: WorldLocation, to: WorldLocation) {
  const start = toPoint(from.x, from.y);
  const end = toPoint(to.x, to.y);
  const middle = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy) || 1;
  const badge = { x: middle.x - (dy / length) * 22, y: middle.y + (dx / length) * 22 };

  return {
    d: `M ${start.x} ${start.y} L ${end.x} ${end.y}`,
    middle,
    badge,
  };
}

function activateOnKeyboard(event: React.KeyboardEvent<SVGGElement>, action: () => void) {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    action();
  }
}

function LocationGlyph({ kind }: { kind: LocationKind }) {
  if (kind === "home") {
    return (
      <path
        d="M-7 1 0-5 7 1v7H2V3h-4v5h-5z"
        className="location-glyph"
      />
    );
  }

  if (kind === "shop") {
    return (
      <g className="location-glyph">
        <path d="M-7-2h14l-1.5-4h-11z" />
        <path d="M-6-1v8h12v-8M-2 7V2h4v5" />
      </g>
    );
  }

  if (kind === "depot") {
    return (
      <g className="location-glyph">
        <path d="M-8-2 0-7 8-2v10H-8z" />
        <path d="M-3 8V2h6v6M-8 1h16" />
      </g>
    );
  }

  return <circle r="3" className="junction-core" />;
}

export function DeliveryWorld({ locations, roads, couriers = [], roadChanges = new Map(), onToggleRoad, mapRevision = 0, worldBirthRevision = 0, deliveredEvents = EMPTY_DELIVERED_EVENTS, suppressDeliveryEffects = false }: DeliveryWorldProps) {
  const [selection, setSelection] = useState<WorldSelection | null>(null);
  const [view, setView] = useState<"3d" | "2d">("3d");
  const [viewNotice, setViewNotice] = useState<string | null>(null);
  const [resetView, setResetView] = useState(0);
  const roadBirthTimes = useRef(new Map<string, number>());
  const previousRoadIds = useRef(new Set<string>());
  const roadAnimationTimes = useRef(new Map<string, number>());
  const birthTimes = useRef(new Map<string, number>());
  const buildingOffsetCache = useRef(new Map<string, { birth?: number; offset: [number, number, number] }>());
  const previousBirthRevision = useRef(worldBirthRevision);
  const previousIds = useRef(new Set<string>());
  const celebrationTimes = useRef(new Map<string, number>());
  const seenDelivered = useRef(new Set<string>());
  const [, refreshEffects] = useState(0);
  useEffect(() => {
    const freshWorld = previousBirthRevision.current !== worldBirthRevision;
    previousBirthRevision.current = worldBirthRevision;
    if (freshWorld) { buildingOffsetCache.current.clear(); birthTimes.current.clear(); roadAnimationTimes.current.clear(); roadBirthTimes.current.clear(); }
    const nextIds = new Set(locations.map((location) => location.id));
    for (const id of nextIds) if (freshWorld || !previousIds.current.has(id)) birthTimes.current.set(id, Date.now());
    previousIds.current = nextIds;
    for (const road of roads) {
      if (freshWorld || !previousRoadIds.current.has(road.id)) roadBirthTimes.current.set(road.id, Date.now());
      if (freshWorld || !previousRoadIds.current.has(road.id) || roadChanges.has(road.id)) roadAnimationTimes.current.set(road.id, Date.now());
    }
    previousRoadIds.current = new Set(roads.map((road) => road.id));
    refreshEffects((value) => value + 1);
  }, [mapRevision, worldBirthRevision]);
  useEffect(() => {
    for (const event of deliveredEvents) {
      if (seenDelivered.current.has(event.id)) continue;
      seenDelivered.current.add(event.id);
      if (event.courierId) celebrationTimes.current.set(event.courierId, Date.now());
    }
    if (!deliveredEvents.length) { seenDelivered.current.clear(); celebrationTimes.current.clear(); }
    refreshEffects((value) => value + 1);
  }, [deliveredEvents]);
  function showFallback() {
    setView("2d");
    setViewNotice("3D graphics became unavailable. The same delivery run continues in 2D.");
  }
  const [roadError, setRoadError] = useState<string | null>(null);
  const locationById = new Map(locations.map((location) => [location.id, location]));
  const selectedLocation = selection?.kind === "location"
    ? locationById.get(selection.id)
    : undefined;
  const selectedRoad = selection?.kind === "road"
    ? roads.find((road) => road.id === selection.id)
    : undefined;
  const selectedCourier = selection?.kind === "courier"
    ? couriers.find((courier) => courier.id === selection.id)
    : undefined;
  const coLocatedCouriers = new Map<string, CourierMarker[]>();
  for (const courier of couriers) {
    const key = `${courier.x.toFixed(2)}:${courier.y.toFixed(2)}`;
    coLocatedCouriers.set(key, [...(coLocatedCouriers.get(key) ?? []), courier]);
  }
  const courierOffsets = new Map<string, number>();
  for (const group of coLocatedCouriers.values()) {
    group.forEach((courier, index) => {
      courierOffsets.set(courier.id, (index - (group.length - 1) / 2) * 27);
    });
  }
  const coLocatedLocations = new Map<string, WorldLocation[]>();
  for (const location of locations) {
    const key = `${location.x}:${location.y}`;
    coLocatedLocations.set(key, [...(coLocatedLocations.get(key) ?? []), location]);
  }
  const locationLabelOffsets = new Map<string, number>();
  for (const group of coLocatedLocations.values()) {
    group.forEach((location, index) => {
      locationLabelOffsets.set(location.id, (index - (group.length - 1) / 2) * 24);
    });
  }

  return (
    <div className="world-frame">
      <div className="map-toolbar">
        <div className="map-toolbar-title">
          <span className="map-live-mark" aria-hidden="true" />
          <span>ROUTE NETWORK</span>
        </div>
        <div className="map-toolbar-meta">
          <span>{locations.length} STOPS</span>
          <span className="toolbar-divider" aria-hidden="true" />
          <span>{roads.length} ROADS</span>
        </div>
      </div>

      <div className="world-view-controls">
        <div className="world-view-switch" aria-label="World view"><button type="button" aria-pressed={view === "3d"} onClick={() => { setView("3d"); setViewNotice(null); }}>3D world</button><button type="button" aria-pressed={view === "2d"} onClick={() => setView("2d")}>2D map</button></div>
        {view === "3d" ? <button className="world-reset-view" type="button" onClick={() => setResetView((value) => value + 1)}>Reset view</button> : null}
        <label className="world-inspect-select"><span className="visually-hidden">Inspect a stop, road, or courier</span><select aria-label="Inspect world object" value={selection ? `${selection.kind}:${selection.id}` : ""} onChange={(event) => { const [kind, ...parts] = event.target.value.split(":"); setSelection(kind ? { kind: kind as WorldSelection["kind"], id: parts.join(":") } : null); }}><option value="">Inspect…</option><optgroup label="Couriers">{couriers.map((courier) => <option key={courier.id} value={`courier:${courier.id}`}>{courier.label}</option>)}</optgroup><optgroup label="Stops">{locations.map((location) => <option key={location.id} value={`location:${location.id}`}>{location.label}</option>)}</optgroup><optgroup label="Roads">{roads.map((road) => <option key={road.id} value={`road:${road.id}`}>{locationById.get(road.from)?.label} – {locationById.get(road.to)?.label} · {road.id}</option>)}</optgroup></select></label>
      </div>
      {viewNotice ? <p className="world-view-notice" role="status">{viewNotice}</p> : null}
      {view === "3d" ? <div className="world-3d-stage" aria-label="Interactive 3D paper town"><DeliveryWorld3D locations={locations} roads={roads} couriers={couriers} roadChanges={roadChanges} selection={selection} onSelect={setSelection} onUnavailable={showFallback} resetView={resetView} births={birthTimes.current} buildingOffsetCache={buildingOffsetCache.current} celebrations={suppressDeliveryEffects ? new Map() : celebrationTimes.current} roadAnimations={roadAnimationTimes.current} roadBirths={roadBirthTimes.current} /><span className="world-gesture-hint">Drag to orbit · scroll or pinch to zoom</span></div> : <div className="map-canvas">
        <svg
          className="delivery-map"
          viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
          role="group"
          aria-label="Interactive delivery network map"
        >
          <defs>
            <pattern id="world-grid" width="32" height="32" patternUnits="userSpaceOnUse">
              <path d="M32 0H0V32" className="grid-line" />
            </pattern>
            <pattern id="world-grid-major" width="160" height="160" patternUnits="userSpaceOnUse">
              <path d="M160 0H0V160" className="grid-line-major" />
            </pattern>
            <filter id="courier-shadow" x="-100%" y="-100%" width="300%" height="300%">
              <feDropShadow dx="0" dy="4" stdDeviation="5" floodColor="#30291f" floodOpacity="0.13" />
            </filter>
          </defs>

          <rect width={VIEWBOX_WIDTH} height={VIEWBOX_HEIGHT} fill="url(#world-grid)" />
          <rect width={VIEWBOX_WIDTH} height={VIEWBOX_HEIGHT} fill="url(#world-grid-major)" />


          <g aria-label="Roads">
            {roads.map((road) => {
              const from = locationById.get(road.from);
              const to = locationById.get(road.to);
              if (!from || !to) return null;

              const geometry = pathForRoad(from, to);
              const roadChange = roadChanges.get(road.id);
              const roadChangeLabel = roadChange === "new" ? "NEW" : roadChange === "changed" ? "CHANGED" : null;
              const isSelected = selection?.kind === "road" && selection.id === road.id;
              const routeCouriers = couriers.filter((courier) => courier.routeRoadIds?.includes(road.id));
              const selectedRoute = selectedCourier?.routeRoadIds?.includes(road.id) ?? false;
              const roadClass = [
                "road-hit-area",
                road.closed ? "road-hit-area-closed" : "",
                isSelected ? "road-hit-area-selected" : "",
              ].filter(Boolean).join(" ");
              const action = () => {
                setSelection({ kind: "road", id: road.id });
                setRoadError(null);
              };

              return (
                <g
                  key={road.id}
                  role="button"
                  tabIndex={0}
                  aria-pressed={isSelected}
                  aria-label={`${roadChangeLabel ? `${roadChangeLabel} · ` : ""}${road.closed ? "Closed" : "Open"} road between ${from.label} and ${to.label}`}
                  onClick={action}
                  onKeyDown={(event) => activateOnKeyboard(event, action)}
                >
                  <title>{`${roadChangeLabel ? `${roadChangeLabel} · ` : ""}${from.label} to ${to.label}${road.closed ? " · closed" : ""}`}</title>
                  <path d={geometry.d} className="road-casing" />
                  <path d={geometry.d} className={roadClass} />
                  <path
                    d={geometry.d}
                    className={`road-centerline ${road.closed ? "road-centerline-closed" : ""} ${roadChange ? `road-centerline-${roadChange}` : ""}`}
                  />
                  {routeCouriers.length ? (
                    <path
                      d={geometry.d}
                      className={`active-route-line ${selectedRoute ? "active-route-line-selected" : ""} ${selectedRoute && selectedCourier?.routeReplanned ? "active-route-line-replanned" : ""}`}
                      aria-hidden="true"
                    />
                  ) : null}
                  {road.closed ? (
                    <g transform={`translate(${geometry.middle.x} ${geometry.middle.y})`} className="closure-marker" aria-hidden="true">
                      <circle r="13" />
                      <path d="m-4-4 8 8m0-8-8 8" />
                    </g>
                  ) : null}
                  {roadChangeLabel ? (
                    <g transform={`translate(${geometry.badge.x} ${geometry.badge.y})`} className={`road-change-badge road-change-badge-${roadChange}`} aria-hidden="true" pointerEvents="none">
                      <rect x={roadChange === "changed" ? -26 : -18} y="-9" width={roadChange === "changed" ? 52 : 36} height="18" rx="9" />
                      <text textAnchor="middle" dominantBaseline="central">{roadChangeLabel}</text>
                    </g>
                  ) : null}
                </g>
              );
            })}
          </g>

          <g aria-label="Pinned in-flight roads" className="pinned-segment-trails">
            {couriers.map((courier) => {
              if (!courier.pinnedSegment) return null;
              const from = toPoint(courier.pinnedSegment.fromX, courier.pinnedSegment.fromY);
              const to = toPoint(courier.pinnedSegment.toX, courier.pinnedSegment.toY);
              return <path key={courier.id} d={`M ${from.x} ${from.y} L ${to.x} ${to.y}`} className="pinned-segment-trail" aria-hidden="true" />;
            })}
          </g>

          <g aria-label="Stops">
            {locations.map((location) => {
              const point = toPoint(location.x, location.y);
              const isSelected = selection?.kind === "location" && selection.id === location.id;
              const action = () => setSelection({ kind: "location", id: location.id });
              const labelBelow = location.y <= 84;
              const labelY = (labelBelow
                ? point.y + (location.kind === "junction" ? 28 : 40)
                : point.y - 24) + (locationLabelOffsets.get(location.id) ?? 0);
              const labelAnchor = location.x < 14 ? "start" : location.x > 86 ? "end" : "middle";

              return (
                <g
                  key={location.id}
                  className={`location-node location-${location.kind} ${isSelected ? "location-selected" : ""}`}
                  transform={`translate(${point.x} ${point.y})`}
                  role="button"
                  tabIndex={0}
                  aria-pressed={isSelected}
                  aria-label={`${location.kind}: ${location.label}`}
                  onClick={action}
                  onKeyDown={(event) => activateOnKeyboard(event, action)}
                >
                  <title>{`${location.kind}: ${location.label}`}</title>
                  {location.kind === "junction" ? (
                    <>
                      <circle r="9" className="junction-ring" />
                      <LocationGlyph kind={location.kind} />
                    </>
                  ) : (
                    <>
                      <circle r="19" className="location-shadow" />
                      <circle r="17" className="location-disc" />
                      <LocationGlyph kind={location.kind} />
                    </>
                  )}
                  <text x="0" y={labelY - point.y} className="location-label" textAnchor={labelAnchor}>
                    {location.label}
                  </text>
                  <text x="0" y={labelY - point.y + 13} className="location-kind" textAnchor={labelAnchor}>
                    {location.kind.toUpperCase()}
                  </text>
                </g>
              );
            })}
          </g>

          <g aria-label="Couriers">
            {couriers.map((courier) => {
              const point = toPoint(courier.x, courier.y);
              const markerOffset = courierOffsets.get(courier.id) ?? 0;
              const isSelected = selection?.kind === "courier" && selection.id === courier.id;
              const action = () => setSelection({ kind: "courier", id: courier.id });
              const courierAriaLabel = courier.activePackage
                ? courier.activePackage.pickedUp
                  ? `Courier ${courier.label}, carrying ${courier.activePackage.id} to ${courier.activePackage.toLabel}`
                  : `Courier ${courier.label}, heading to pick up ${courier.activePackage.id} at ${courier.activePackage.fromLabel}`
                : `Courier ${courier.label}, ${courier.waitingReason ?? "waiting"}`;

              return (
                <g
                  key={courier.id}
                  className={`courier-marker ${isSelected ? "courier-marker-selected" : ""}`}
                  transform={`translate(${point.x} ${point.y})`}
                  role="button"
                  tabIndex={0}
                  aria-pressed={isSelected}
                  aria-label={courierAriaLabel}
                  onClick={action}
                  onKeyDown={(event) => activateOnKeyboard(event, action)}
                  filter="url(#courier-shadow)"
                >
                  <title>{courierAriaLabel}</title>
                  {markerOffset !== 0 ? <path d={`M 0 17 L ${markerOffset} 25`} className="courier-tether" aria-hidden="true" /> : null}
                  <circle r="25" className="courier-pulse" />
                  <circle r="16" className="courier-disc" />
                  <path d="M-7 1h14v8H-7zM-5-5h10l3 6H-8z" className="courier-bag" />
                  <circle cx="-4" cy="10" r="2" className="courier-wheel" />
                  <circle cx="4" cy="10" r="2" className="courier-wheel" />
                  <rect x={markerOffset - 35} y="25" width="70" height="18" rx="9" className="courier-tag" />
                  <text x={markerOffset} y="37" textAnchor="middle" className="courier-tag-label">{courier.label}</text>
                </g>
              );
            })}
          </g>

          <g className="map-compass" transform="translate(930 92)" aria-hidden="true">
            <text x="0" y="-18" textAnchor="middle">N</text>
            <path d="M0-10 6 7 0 3-6 7z" />
            <circle r="17" />
          </g>
        </svg>
        <div className="map-scale" aria-hidden="true"><span /><span>1 grid unit</span></div>
      </div>}

      <div className="map-bottom">
        <div className={`map-legend ${view === "3d" ? "map-legend-3d" : ""}`} aria-label={view === "3d" ? "3D world legend" : "2D map legend"}>
          <span className="legend-item"><span className="legend-icon legend-depot" aria-hidden="true" />Depot</span>
          <span className="legend-item"><span className="legend-icon legend-home" aria-hidden="true" />Home</span>
          <span className="legend-item"><span className="legend-icon legend-shop" aria-hidden="true" />Shop</span>
          <span className="legend-item"><span className="legend-icon legend-junction" aria-hidden="true" />Junction</span>
          <span className="legend-item"><span className="legend-icon legend-courier" aria-hidden="true" />Courier</span>
          <span className="legend-item"><span className="legend-icon legend-route" aria-hidden="true" />Delivery route</span>
          <span className="legend-item"><span className="legend-icon legend-alternate-route" aria-hidden="true" />Alternate route</span>
          <span className="legend-item"><span className="legend-icon legend-closed" aria-hidden="true" />Closed road</span>
        </div>

        <div className="selection-readout" aria-live="polite">
          {selectedLocation ? (
            <><span className="readout-type">STOP</span><strong>{selectedLocation.label}</strong><span>{selectedLocation.kind}</span></>
          ) : selectedRoad ? (
            <>
              <span className="readout-type">ROAD</span>
              <strong>{locationById.get(selectedRoad.from)?.label ?? selectedRoad.from} → {locationById.get(selectedRoad.to)?.label ?? selectedRoad.to}</strong>
              <span>{selectedRoad.closed ? "Closed" : "Open"}{roadChanges.get(selectedRoad.id) === "new" ? " · New connection" : roadChanges.has(selectedRoad.id) ? " · Changed connection" : ""}</span>
              <button
                className="road-toggle-button"
                type="button"
                disabled={!onToggleRoad}
                onClick={() => { if (onToggleRoad) setRoadError(onToggleRoad(selectedRoad.id)); }}
              >
                {selectedRoad.closed ? "Reopen road" : "Close road"}
              </button>
              {roadError ? <span className="road-toggle-error" role="alert">{roadError}</span> : null}
            </>
          ) : selectedCourier ? (
            <>
              <span className="readout-type">COURIER</span>
              <strong>{selectedCourier.label}</strong>
              {selectedCourier.activePackage ? (
                <span className="courier-inspection">
                  <span className="courier-inspection-route">
                    <b>{selectedCourier.activePackage.id}</b>
                    <span>{selectedCourier.activePackage.fromLabel} → {selectedCourier.activePackage.toLabel}</span>
                  </span>
                  <span className="courier-inspection-state">
                    {selectedCourier.currentSegmentToLabel
                      ? `Finishing current road to ${selectedCourier.currentSegmentToLabel}`
                      : selectedCourier.waitingReason ?? "Available for a delivery"}
                    {selectedCourier.routeReplanned ? " · Alternate route around a closure" : ""}
                  </span>
                  {selectedCourier.currentSegmentToLabel && selectedCourier.activePackage.status === "unreachable" ? (
                    <span className="courier-inspection-state">{selectedCourier.waitingReason}</span>
                  ) : null}
                  {selectedCourier.blockedPackage && selectedCourier.blockedPackage.id !== selectedCourier.activePackage.id ? (
                    <span className="courier-inspection-state">
                      Blocked: {selectedCourier.blockedPackage.id} has no open route to {selectedCourier.blockedPackage.phase} at {selectedCourier.blockedPackage.targetLabel}.
                      {selectedCourier.currentSegmentToLabel ? " Current road will finish before the courier waits." : ""}
                    </span>
                  ) : null}
                  {selectedCourier.nextActionLabel ? (
                    <span className="courier-inspection-state">Next: {selectedCourier.nextActionLabel}</span>
                  ) : null}
                  {selectedCourier.additionalPackageCount ? (
                    <span className="courier-inspection-state">+ {selectedCourier.additionalPackageCount} more assigned</span>
                  ) : null}
                </span>
              ) : (
                <span className="courier-inspection-state">{selectedCourier.waitingReason ?? "Available for a delivery"}</span>
              )}
            </>
          ) : (
            <><span className="readout-type">INSPECT</span><span>Select a stop, road, or courier</span></>
          )}
        </div>
      </div>
    </div>
  );
}
