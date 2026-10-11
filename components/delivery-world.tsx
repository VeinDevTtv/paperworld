"use client";

import { useState } from "react";

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

export type CourierMarker = {
  id: string;
  label: string;
  x: number;
  y: number;
};

type DeliveryWorldProps = {
  locations: WorldLocation[];
  roads: WorldRoad[];
  couriers?: CourierMarker[];
};

type Selection =
  | { kind: "location"; id: string }
  | { kind: "road"; id: string }
  | { kind: "courier"; id: string };

const VIEWBOX_WIDTH = 1000;
const VIEWBOX_HEIGHT = 560;

function toPoint(x: number, y: number) {
  return {
    x: 60 + (x / 100) * 880,
    y: 48 + (y / 100) * 464,
  };
}

function pathForRoad(from: WorldLocation, to: WorldLocation, index: number) {
  const start = toPoint(from.x, from.y);
  const end = toPoint(to.x, to.y);
  const middleX = (start.x + end.x) / 2;
  const middleY = (start.y + end.y) / 2;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.max(Math.hypot(dx, dy), 1);
  const curve = ((index % 3) - 1) * 14;
  const controlX = middleX - (dy / length) * curve;
  const controlY = middleY + (dx / length) * curve;

  return {
    d: `M ${start.x} ${start.y} Q ${controlX} ${controlY} ${end.x} ${end.y}`,
    middle: {
      x: (start.x + 2 * controlX + end.x) / 4,
      y: (start.y + 2 * controlY + end.y) / 4,
    },
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

export function DeliveryWorld({ locations, roads, couriers = [] }: DeliveryWorldProps) {
  const [selection, setSelection] = useState<Selection | null>(null);
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

      <div className="map-canvas">
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

          <g className="map-area-labels" aria-hidden="true">
            <text x="90" y="100">NORTH DISTRICT</text>
            <text x="690" y="385">RIVER WARD</text>
            <text x="85" y="530">SOUTH DISTRICT</text>
          </g>

          <g aria-label="Roads">
            {roads.map((road, index) => {
              const from = locationById.get(road.from);
              const to = locationById.get(road.to);
              if (!from || !to) return null;

              const geometry = pathForRoad(from, to, index);
              const isSelected = selection?.kind === "road" && selection.id === road.id;
              const roadClass = [
                "road-hit-area",
                road.closed ? "road-hit-area-closed" : "",
                isSelected ? "road-hit-area-selected" : "",
              ].filter(Boolean).join(" ");
              const action = () => setSelection({ kind: "road", id: road.id });

              return (
                <g
                  key={road.id}
                  role="button"
                  tabIndex={0}
                  aria-pressed={isSelected}
                  aria-label={`${road.closed ? "Closed" : "Open"} road between ${from.label} and ${to.label}`}
                  onClick={action}
                  onKeyDown={(event) => activateOnKeyboard(event, action)}
                >
                  <title>{`${from.label} to ${to.label}${road.closed ? " · closed" : ""}`}</title>
                  <path d={geometry.d} className="road-casing" />
                  <path d={geometry.d} className={roadClass} />
                  <path
                    d={geometry.d}
                    className={`road-centerline ${road.closed ? "road-centerline-closed" : ""}`}
                  />
                  {road.closed ? (
                    <g transform={`translate(${geometry.middle.x} ${geometry.middle.y})`} className="closure-marker" aria-hidden="true">
                      <circle r="13" />
                      <path d="m-4-4 8 8m0-8-8 8" />
                    </g>
                  ) : null}
                </g>
              );
            })}
          </g>

          <g aria-label="Stops">
            {locations.map((location) => {
              const point = toPoint(location.x, location.y);
              const isSelected = selection?.kind === "location" && selection.id === location.id;
              const action = () => setSelection({ kind: "location", id: location.id });
              const labelBelow = location.y <= 84;
              const labelY = labelBelow
                ? point.y + (location.kind === "junction" ? 28 : 40)
                : point.y - 24;
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
              const isSelected = selection?.kind === "courier" && selection.id === courier.id;
              const action = () => setSelection({ kind: "courier", id: courier.id });

              return (
                <g
                  key={courier.id}
                  className={`courier-marker ${isSelected ? "courier-marker-selected" : ""}`}
                  transform={`translate(${point.x} ${point.y})`}
                  role="button"
                  tabIndex={0}
                  aria-pressed={isSelected}
                  aria-label={`Sample courier ${courier.label}`}
                  onClick={action}
                  onKeyDown={(event) => activateOnKeyboard(event, action)}
                  filter="url(#courier-shadow)"
                >
                  <title>{`Sample courier ${courier.label}`}</title>
                  <circle r="25" className="courier-pulse" />
                  <circle r="16" className="courier-disc" />
                  <path d="M-7 1h14v8H-7zM-5-5h10l3 6H-8z" className="courier-bag" />
                  <circle cx="-4" cy="10" r="2" className="courier-wheel" />
                  <circle cx="4" cy="10" r="2" className="courier-wheel" />
                  <rect x="-23" y="25" width="46" height="18" rx="9" className="courier-tag" />
                  <text x="0" y="37" textAnchor="middle" className="courier-tag-label">{courier.label}</text>
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
      </div>

      <div className="map-bottom">
        <div className="map-legend" aria-label="Map legend">
          <span className="legend-item"><span className="legend-icon legend-depot" aria-hidden="true" />Depot</span>
          <span className="legend-item"><span className="legend-icon legend-home" aria-hidden="true" />Home</span>
          <span className="legend-item"><span className="legend-icon legend-shop" aria-hidden="true" />Shop</span>
          <span className="legend-item"><span className="legend-icon legend-junction" aria-hidden="true" />Junction</span>
          <span className="legend-item"><span className="legend-icon legend-courier" aria-hidden="true" />Courier</span>
          <span className="legend-item"><span className="legend-icon legend-closed" aria-hidden="true" />Closed road</span>
        </div>

        <div className="selection-readout" aria-live="polite">
          {selectedLocation ? (
            <><span className="readout-type">STOP</span><strong>{selectedLocation.label}</strong><span>{selectedLocation.kind}</span></>
          ) : selectedRoad ? (
            <><span className="readout-type">ROAD</span><strong>{selectedRoad.from} → {selectedRoad.to}</strong><span>{selectedRoad.closed ? "Closed" : "Open"}</span></>
          ) : selectedCourier ? (
            <><span className="readout-type">COURIER</span><strong>{selectedCourier.label}</strong><span>Sample position</span></>
          ) : (
            <><span className="readout-type">INSPECT</span><span>Select a stop, road, or courier</span></>
          )}
        </div>
      </div>
    </div>
  );
}
