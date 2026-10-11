import {
  commandSchema,
  commandsSchema,
  paperMapSchema,
  simulationStateSchema,
  type Command,
  type Courier,
  type Location,
  type Package,
  type PaperMap,
  type Priority,
  type Road,
  type Segment,
  type SimulationEvent,
  type SimulationState,
} from "./schema";

export const COURIER_SPEED = 10;
const MAX_EVENTS = 200;
const DISTANCE_EPSILON = 1e-9;

export interface Route {
  locationIds: string[];
  roadIds: string[];
  distance: number;
}

export interface CourierSeed {
  id: string;
  name: string;
  locationId?: string;
  capacity?: number;
}

export type MutationResult =
  | { accepted: true; state: SimulationState }
  | { accepted: false; state: SimulationState; error: string };

export interface CourierPosition {
  x: number;
  y: number;
}

export interface SimulationMetrics {
  elapsedSeconds: number;
  distanceTraveled: number;
  packageCount: number;
  deliveredCount: number;
  queuedCount: number;
  assignedCount: number;
  inTransitCount: number;
  unreachableCount: number;
  movingCouriers: number;
  idleCouriers: number;
  deliveriesPerMinute: number;
}

interface PathCandidate extends Route {
  signature: string;
}

function copySegment(segment: Segment | null): Segment | null {
  return segment ? { ...segment } : null;
}

function copyState(state: SimulationState): SimulationState {
  return {
    map: {
      locations: state.map.locations.map((location) => ({ ...location })),
      roads: state.map.roads.map((road) => ({ ...road })),
    },
    couriers: state.couriers.map((courier) => ({
      ...courier,
      segment: copySegment(courier.segment),
      packageIds: [...courier.packageIds],
    })),
    packages: state.packages.map((pkg) => ({ ...pkg })),
    elapsedSeconds: state.elapsedSeconds,
    distanceTraveled: state.distanceTraveled,
    events: state.events.map((event) => ({ ...event })),
    nextPackageNumber: state.nextPackageNumber,
    nextEventNumber: state.nextEventNumber,
  };
}

function buildAdjacency(map: PaperMap): Map<string, Array<{ road: Road; nextId: string; length: number }>> {
  const locations = new Map(map.locations.map((location) => [location.id, location]));
  const adjacency = new Map<string, Array<{ road: Road; nextId: string; length: number }>>();
  for (const location of map.locations) adjacency.set(location.id, []);
  for (const road of map.roads) {
    if (road.closed) continue;
    const from = locations.get(road.from);
    const to = locations.get(road.to);
    if (!from || !to) continue;
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    adjacency.get(road.from)?.push({ road, nextId: road.to, length });
    adjacency.get(road.to)?.push({ road, nextId: road.from, length });
  }
  for (const edges of adjacency.values()) edges.sort((left, right) => left.road.id.localeCompare(right.road.id) || left.nextId.localeCompare(right.nextId));
  return adjacency;
}

function comparePaths(left: PathCandidate, right: PathCandidate): number {
  const difference = left.distance - right.distance;
  if (Math.abs(difference) > DISTANCE_EPSILON) return difference;
  return left.signature.localeCompare(right.signature);
}

function shortestPathUnchecked(map: PaperMap, from: string, to: string): Route | null {
  const locationIds = new Set(map.locations.map((location) => location.id));
  if (!locationIds.has(from) || !locationIds.has(to)) return null;
  if (from === to) return { locationIds: [from], roadIds: [], distance: 0 };

  const adjacency = buildAdjacency(map);
  const best = new Map<string, PathCandidate>();
  const visited = new Set<string>();
  best.set(from, { locationIds: [from], roadIds: [], distance: 0, signature: "" });

  while (true) {
    let currentId: string | undefined;
    let currentPath: PathCandidate | undefined;
    for (const [candidateId, candidatePath] of best) {
      if (visited.has(candidateId)) continue;
      if (!currentPath || comparePaths(candidatePath, currentPath) < 0) {
        currentId = candidateId;
        currentPath = candidatePath;
      }
    }
    if (!currentId || !currentPath) return null;
    if (currentId === to) {
      return {
        locationIds: [...currentPath.locationIds],
        roadIds: [...currentPath.roadIds],
        distance: currentPath.distance,
      };
    }
    visited.add(currentId);

    for (const edge of adjacency.get(currentId) ?? []) {
      if (visited.has(edge.nextId)) continue;
      const roadIds = [...currentPath.roadIds, edge.road.id];
      const locations = [...currentPath.locationIds, edge.nextId];
      const nextPath: PathCandidate = {
        roadIds,
        locationIds: locations,
        distance: currentPath.distance + edge.length,
        signature: `${roadIds.join("\u0000")}\u0001${locations.join("\u0000")}`,
      };
      const existing = best.get(edge.nextId);
      if (!existing || comparePaths(nextPath, existing) < 0) best.set(edge.nextId, nextPath);
    }
  }
}

/** Return the shortest open-road route. Equal-length routes break ties by road id, then location id. */
export function shortestPath(map: PaperMap, from: string, to: string): Route | null {
  const parsedMap = paperMapSchema.parse(map);
  return shortestPathUnchecked(parsedMap, from, to);
}

/** Pick a capacity-eligible courier whose current route can reach the pickup and destination. */
export function selectAvailableCourierForDelivery(
  map: PaperMap,
  couriers: readonly Courier[],
  from: string,
  to: string,
  courierId?: string,
): string | undefined {
  const parsedMap = paperMapSchema.parse(map);
  if (from === to || !parsedMap.locations.some((location) => location.id === from) || !parsedMap.locations.some((location) => location.id === to)) return undefined;
  const candidates = (courierId ? couriers.filter((courier) => courier.id === courierId) : [...couriers].sort((left, right) => left.id.localeCompare(right.id)));
  return candidates.find((courier) => {
    if (courier.packageIds.length >= courier.capacity) return false;
    const effectiveLocation = courier.segment?.to ?? courier.locationId;
    return shortestPathUnchecked(parsedMap, effectiveLocation, from) !== null &&
      shortestPathUnchecked(parsedMap, from, to) !== null;
  })?.id;
}

/** Create a fresh simulation with two deterministic couriers unless seeds are supplied. */
export function createSimulation(map: PaperMap, seeds?: readonly CourierSeed[]): SimulationState {
  const parsedMap = paperMapSchema.parse(map);
  const defaultStart = parsedMap.locations.find((location) => location.kind === "depot")?.id ?? parsedMap.locations[0]?.id;
  if (!defaultStart) throw new Error("A simulation map needs at least one location.");

  const courierSeeds = seeds ?? [
    { id: "courier-1", name: "Mina", locationId: defaultStart, capacity: 2 },
    { id: "courier-2", name: "Rook", locationId: defaultStart, capacity: 2 },
  ];
  if (courierSeeds.length < 1 || courierSeeds.length > 16) throw new Error("A simulation needs between 1 and 16 couriers.");

  const locationIds = new Set(parsedMap.locations.map((location) => location.id));
  const couriers: Courier[] = courierSeeds.map((seed) => {
    const locationId = seed.locationId ?? defaultStart;
    const capacity = seed.capacity ?? 2;
    if (!locationIds.has(locationId)) throw new Error(`Courier ${seed.id} starts at a location missing from the map.`);
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 8) throw new Error(`Courier ${seed.id} has an invalid capacity.`);
    return { id: seed.id, name: seed.name, locationId, segment: null, packageIds: [], capacity };
  });

  const state: SimulationState = {
    map: parsedMap,
    couriers,
    packages: [],
    elapsedSeconds: 0,
    distanceTraveled: 0,
    events: [],
    nextPackageNumber: 1,
    nextEventNumber: 1,
  };
  return simulationStateSchema.parse(state);
}

function appendEvent(
  state: SimulationState,
  type: SimulationEvent["type"],
  details: Pick<SimulationEvent, "courierId" | "packageId" | "roadId"> = {},
): void {
  const event: SimulationEvent = {
    id: `event-${state.nextEventNumber}`,
    type,
    atSeconds: state.elapsedSeconds,
    ...details,
  };
  state.nextEventNumber += 1;
  state.events = [...state.events, event].slice(-MAX_EVENTS);
}

function getPackageById(state: SimulationState, packageId: string): Package | undefined {
  return state.packages.find((pkg) => pkg.id === packageId);
}

function getCourierById(state: SimulationState, courierId: string): Courier | undefined {
  return state.couriers.find((courier) => courier.id === courierId);
}

function routeExistsForPackage(state: SimulationState, courier: Courier, pkg: Package): boolean {
  const effectiveLocation = courier.segment?.to ?? courier.locationId;
  if (pkg.pickedUp) return shortestPathUnchecked(state.map, effectiveLocation, pkg.to) !== null;
  return shortestPathUnchecked(state.map, effectiveLocation, pkg.from) !== null &&
    shortestPathUnchecked(state.map, pkg.from, pkg.to) !== null;
}

function refreshPackageStatuses(state: SimulationState): void {
  for (const pkg of state.packages) {
    if (pkg.status === "queued" || pkg.status === "delivered" || pkg.courierId === null) continue;
    const courier = getCourierById(state, pkg.courierId);
    if (!courier) continue;

    const wasUnreachable = pkg.status === "unreachable";
    const reachable = routeExistsForPackage(state, courier, pkg);
    const nextStatus = reachable ? (pkg.pickedUp ? "in_transit" : "assigned") : "unreachable";
    if (pkg.status === nextStatus) continue;
    pkg.status = nextStatus;
    if (!reachable) appendEvent(state, "package_unreachable", { courierId: courier.id, packageId: pkg.id });
    else if (wasUnreachable) appendEvent(state, "package_resumed", { courierId: courier.id, packageId: pkg.id });
  }
}

function processArrivals(state: SimulationState, courier: Courier): boolean {
  // locationId remains the segment's origin while the courier is moving. Only a
  // courier physically at a node can pick up or deliver a package there.
  if (courier.segment !== null) return false;

  let changed = false;

  for (const packageId of [...courier.packageIds]) {
    const pkg = getPackageById(state, packageId);
    if (!pkg || pkg.pickedUp || pkg.status === "delivered" || pkg.from !== courier.locationId) continue;
    pkg.pickedUp = true;
    pkg.status = "in_transit";
    appendEvent(state, "package_picked_up", { courierId: courier.id, packageId: pkg.id });
    changed = true;
  }

  for (const packageId of [...courier.packageIds]) {
    const pkg = getPackageById(state, packageId);
    if (!pkg || !pkg.pickedUp || pkg.status === "delivered" || pkg.to !== courier.locationId) continue;
    pkg.status = "delivered";
    appendEvent(state, "package_delivered", { courierId: courier.id, packageId: pkg.id });
    courier.packageIds = courier.packageIds.filter((id) => id !== packageId);
    changed = true;
  }

  return changed;
}

function compareScheduledPackages(left: Package, right: Package): number {
  const leftPriority = left.priority === "urgent" ? 0 : 1;
  const rightPriority = right.priority === "urgent" ? 0 : 1;
  return leftPriority - rightPriority || left.createdOrder - right.createdOrder || left.id.localeCompare(right.id);
}

function createSegment(state: SimulationState, courier: Courier): boolean {
  const packages = courier.packageIds
    .map((packageId) => getPackageById(state, packageId))
    .filter((pkg): pkg is Package => pkg !== undefined && pkg.status !== "delivered" && pkg.status !== "unreachable")
    .sort(compareScheduledPackages);
  const locations = new Map(state.map.locations.map((location) => [location.id, location]));

  for (const pkg of packages) {
    const target = pkg.pickedUp ? pkg.to : pkg.from;
    const route = shortestPathUnchecked(state.map, courier.locationId, target);
    if (!route || route.locationIds.length < 2 || route.roadIds.length < 1) continue;
    const from = locations.get(route.locationIds[0]);
    const to = locations.get(route.locationIds[1]);
    if (!from || !to) continue;
    const road = state.map.roads.find((candidate) => candidate.id === route.roadIds[0]);
    if (!road || road.closed) continue;
    const distance = Math.hypot(to.x - from.x, to.y - from.y);
    if (!(distance > 0)) continue;

    courier.segment = {
      roadId: road.id,
      from: from.id,
      to: to.id,
      fromX: from.x,
      fromY: from.y,
      toX: to.x,
      toY: to.y,
      progress: 0,
      distance,
    };
    return true;
  }
  return false;
}

function normalizeState(state: SimulationState): SimulationState {
  refreshPackageStatuses(state);
  return simulationStateSchema.parse(state);
}

/** Advance couriers along physical road geometry at a fixed speed. */
export function tick(state: SimulationState, seconds: number): SimulationState {
  const parsedState = simulationStateSchema.parse(state);
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > 3600) {
    throw new RangeError("Tick duration must be between 0 and 3600 seconds.");
  }
  const next = copyState(parsedState);
  const finalElapsedSeconds = parsedState.elapsedSeconds + seconds;
  let remainingSeconds = seconds;

  refreshPackageStatuses(next);
  for (const courier of next.couriers) processArrivals(next, courier);
  refreshPackageStatuses(next);

  let iterations = 0;
  while (remainingSeconds > 0) {
    iterations += 1;
    if (iterations > 100_000) throw new Error("Simulation step exceeded its movement limit.");

    for (const courier of next.couriers) {
      if (!courier.segment) {
        processArrivals(next, courier);
        refreshPackageStatuses(next);
        createSegment(next, courier);
      }
    }

    const movingCouriers = next.couriers.filter((courier) => courier.segment !== null);
    if (movingCouriers.length === 0) break;
    const timeToNextEndpoint = Math.min(...movingCouriers.map((courier) => {
      const segment = courier.segment;
      return segment ? Math.max(0, segment.distance - segment.progress) / COURIER_SPEED : Number.POSITIVE_INFINITY;
    }));
    const timeUsed = Math.min(remainingSeconds, timeToNextEndpoint);
    if (!(timeUsed > 0)) {
      // A zero-length remainder can only come from floating-point rounding at an endpoint.
      for (const courier of movingCouriers) {
        const segment = courier.segment;
        if (!segment || segment.distance - segment.progress > DISTANCE_EPSILON) continue;
        courier.locationId = segment.to;
        courier.segment = null;
        processArrivals(next, courier);
      }
      refreshPackageStatuses(next);
      continue;
    }

    for (const courier of movingCouriers) {
      const segment = courier.segment;
      if (!segment) continue;
      const distanceRemaining = Math.max(0, segment.distance - segment.progress);
      const distanceMoved = Math.min(distanceRemaining, COURIER_SPEED * timeUsed);
      segment.progress += distanceMoved;
      next.distanceTraveled += distanceMoved;
    }

    next.elapsedSeconds += timeUsed;
    remainingSeconds = Math.max(0, remainingSeconds - timeUsed);

    for (const courier of movingCouriers) {
      const segment = courier.segment;
      if (!segment) continue;
      if (segment.distance - segment.progress <= DISTANCE_EPSILON) {
        courier.locationId = segment.to;
        courier.segment = null;
        processArrivals(next, courier);
      }
    }
    refreshPackageStatuses(next);
  }

  next.elapsedSeconds = finalElapsedSeconds;
  return normalizeState(next);
}

function referencedLocationIds(state: SimulationState): Set<string> {
  const references = new Set<string>();
  for (const courier of state.couriers) {
    references.add(courier.locationId);
    if (courier.segment) {
      references.add(courier.segment.from);
      references.add(courier.segment.to);
    }
  }
  for (const pkg of state.packages) {
    references.add(pkg.from);
    references.add(pkg.to);
  }
  return references;
}

function rejection(state: SimulationState, error: string): MutationResult {
  return { accepted: false, state, error };
}

/** Atomically apply a rescanned map while preserving active physical references. */
export function applyMap(state: SimulationState, map: PaperMap): MutationResult {
  const parsedState = simulationStateSchema.parse(state);
  const parsedMap = paperMapSchema.safeParse(map);
  if (!parsedMap.success) return rejection(state, parsedMap.error.issues[0]?.message ?? "Map validation failed.");

  const newLocations = new Map(parsedMap.data.locations.map((location) => [location.id, location]));
  const oldLocations = new Map(parsedState.map.locations.map((location) => [location.id, location]));
  for (const id of referencedLocationIds(parsedState)) {
    const oldLocation = oldLocations.get(id);
    const newLocation = newLocations.get(id);
    if (!newLocation) return rejection(state, `Cannot remove location ${id} while simulation state refers to it.`);
    if (oldLocation && (oldLocation.x !== newLocation.x || oldLocation.y !== newLocation.y)) {
      return rejection(state, `Cannot move location ${id} while simulation state refers to it.`);
    }
  }

  const next = copyState(parsedState);
  next.map = parsedMap.data;
  appendEvent(next, "map_updated");
  refreshPackageStatuses(next);
  const validated = simulationStateSchema.safeParse(next);
  if (!validated.success) return rejection(state, validated.error.issues[0]?.message ?? "Map update could not be applied.");
  return { accepted: true, state: validated.data };
}

function commandFailureMessage(command: Command, reason: string): string {
  return `${command.type}: ${reason}`;
}

function applyOneCommand(state: SimulationState, command: Command): string | null {
  if (command.type === "create-package") {
    const locationIds = new Set(state.map.locations.map((location) => location.id));
    if (!locationIds.has(command.from) || !locationIds.has(command.to)) return commandFailureMessage(command, "package endpoints must exist on the map");
    if (command.from === command.to) return commandFailureMessage(command, "origin and destination must differ");
    if (state.packages.length >= 256) return commandFailureMessage(command, "package limit reached");

    let id = `pkg-${state.nextPackageNumber}`;
    while (state.packages.some((pkg) => pkg.id === id)) {
      state.nextPackageNumber += 1;
      id = `pkg-${state.nextPackageNumber}`;
    }
    const createdOrder = state.packages.reduce((max, pkg) => Math.max(max, pkg.createdOrder), 0) + 1;
    state.packages.push({
      id,
      from: command.from,
      to: command.to,
      priority: command.priority,
      status: "queued",
      pickedUp: false,
      courierId: null,
      createdOrder,
    });
    state.nextPackageNumber += 1;
    appendEvent(state, "package_created", { packageId: id });
    return null;
  }

  if (command.type === "set-priority") {
    const pkg = getPackageById(state, command.packageId);
    if (!pkg) return commandFailureMessage(command, `package ${command.packageId} does not exist`);
    if (pkg.status === "delivered") return commandFailureMessage(command, "delivered package priority is immutable");
    if (pkg.priority !== command.priority) {
      pkg.priority = command.priority;
      appendEvent(state, "priority_changed", {
        packageId: pkg.id,
        ...(pkg.courierId ? { courierId: pkg.courierId } : {}),
      });
    }
    return null;
  }

  if (command.type === "set-road") {
    const road = state.map.roads.find((candidate) => candidate.id === command.roadId);
    if (!road) return commandFailureMessage(command, `road ${command.roadId} does not exist`);
    if (road.closed !== command.closed) {
      road.closed = command.closed;
      appendEvent(state, command.closed ? "road_closed" : "road_opened", { roadId: road.id });
    }
    return null;
  }

  if (command.type === "dispatch-delivery") {
    const locationIds = new Set(state.map.locations.map((location) => location.id));
    if (!locationIds.has(command.from) || !locationIds.has(command.to)) return commandFailureMessage(command, "package endpoints must exist on the map");
    if (command.from === command.to) return commandFailureMessage(command, "origin and destination must differ");
    if (state.packages.length >= 256) return commandFailureMessage(command, "package limit reached");
    const courierId = selectAvailableCourierForDelivery(state.map, state.couriers, command.from, command.to, command.courierId ?? undefined);
    if (!courierId) {
      return commandFailureMessage(command, command.courierId
        ? "the selected courier must have capacity and a reachable pickup and delivery route"
        : "no courier has capacity and a reachable pickup and delivery route");
    }
    const courier = getCourierById(state, courierId);
    if (!courier) return commandFailureMessage(command, "the selected courier does not exist");

    let id = `pkg-${state.nextPackageNumber}`;
    while (state.packages.some((pkg) => pkg.id === id)) {
      state.nextPackageNumber += 1;
      id = `pkg-${state.nextPackageNumber}`;
    }
    const createdOrder = state.packages.reduce((max, pkg) => Math.max(max, pkg.createdOrder), 0) + 1;
    state.packages.push({
      id,
      source: "user",
      from: command.from,
      to: command.to,
      priority: command.priority,
      status: "assigned",
      pickedUp: false,
      courierId: courier.id,
      createdOrder,
    });
    state.nextPackageNumber += 1;
    courier.packageIds.push(id);
    appendEvent(state, "package_created", { packageId: id });
    appendEvent(state, "package_assigned", { courierId: courier.id, packageId: id });
    return null;
  }

  const pkg = getPackageById(state, command.packageId);
  if (!pkg) return commandFailureMessage(command, `package ${command.packageId} does not exist`);
  if (pkg.status !== "queued" || pkg.courierId !== null) return commandFailureMessage(command, "only an unassigned queued package can be assigned");
  const courier = getCourierById(state, command.courierId);
  if (!courier) return commandFailureMessage(command, `courier ${command.courierId} does not exist`);
  if (courier.packageIds.length >= courier.capacity) return commandFailureMessage(command, `courier ${courier.id} is at capacity`);

  pkg.courierId = courier.id;
  pkg.status = "assigned";
  courier.packageIds.push(pkg.id);
  appendEvent(state, "package_assigned", { courierId: courier.id, packageId: pkg.id });
  return null;
}

/** Apply an ordered command batch atomically. Invalid input leaves the original state untouched. */
export function applyCommands(state: SimulationState, commands: readonly Command[]): MutationResult {
  const parsedState = simulationStateSchema.parse(state);
  const parsedCommands = commandsSchema.safeParse(commands);
  if (!parsedCommands.success) return rejection(state, parsedCommands.error.issues[0]?.message ?? "Command validation failed.");

  const next = copyState(parsedState);
  for (const command of parsedCommands.data) {
    const error = applyOneCommand(next, command);
    if (error) return rejection(state, error);
  }
  refreshPackageStatuses(next);
  const validated = simulationStateSchema.safeParse(next);
  if (!validated.success) return rejection(state, validated.error.issues[0]?.message ?? "Command batch could not be applied.");
  return { accepted: true, state: validated.data };
}

export type DemoStartResult =
  | { accepted: true; state: SimulationState; demoPackageIds: string[] }
  | { accepted: false; state: SimulationState; error: string };

/** Start two real, code-routed demo deliveries on the current map, without marking either picked up. */
export function startDemoDeliveries(state: SimulationState): DemoStartResult {
  const parsedState = simulationStateSchema.safeParse(state);
  if (!parsedState.success) return { accepted: false, state, error: parsedState.error.issues[0]?.message ?? "Simulation state is invalid." };
  const current = parsedState.data;
  if (current.packages.some((pkg) => pkg.source === "demo")) {
    return { accepted: false, state, error: "Demo deliveries have already started for this simulation." };
  }
  if (current.packages.length > 254) return { accepted: false, state, error: "There is not enough package capacity to start two demo deliveries." };

  const origin = current.map.locations.find((location) => location.kind === "depot")?.id ?? current.map.locations[0]?.id;
  if (!origin) return { accepted: false, state, error: "The current map has no valid pickup location." };
  const reachableDestinations = current.map.locations.filter((location) =>
    location.id !== origin && shortestPathUnchecked(current.map, origin, location.id) !== null,
  );
  if (reachableDestinations.length === 0) {
    return { accepted: false, state, error: "Add two connected locations to the map before starting demo deliveries." };
  }

  const homes = reachableDestinations.filter((location) => location.kind === "home");
  const shops = reachableDestinations.filter((location) => location.kind === "shop");
  const otherDestinations = reachableDestinations.filter((location) => location.kind !== "home" && location.kind !== "shop");
  const orderedDestinations = [...homes, ...shops, ...otherDestinations];
  const secondDestinationOrder = (firstId: string): string[] => {
    const first = reachableDestinations.find((location) => location.id === firstId);
    const preferred = first?.kind === "home"
      ? [...shops, ...homes, ...otherDestinations]
      : [...homes, ...shops, ...otherDestinations];
    return [...preferred.filter((location) => location.id !== firstId).map((location) => location.id), firstId];
  };

  let selected: { firstDestination: string; secondDestination: string; firstCourier: string; secondCourier: string } | undefined;
  const orderedCouriers = [...current.couriers].sort((left, right) => left.id.localeCompare(right.id));
  for (const firstDestination of orderedDestinations) {
    if (selected) break;
    for (const secondDestination of secondDestinationOrder(firstDestination.id)) {
      if (selected) break;
      for (const firstCourier of orderedCouriers) {
        const firstCourierId = selectAvailableCourierForDelivery(current.map, [firstCourier], origin, firstDestination.id);
        if (!firstCourierId) continue;
        const secondCourier = orderedCouriers.find((courier) =>
          courier.id !== firstCourierId &&
          selectAvailableCourierForDelivery(current.map, [courier], origin, secondDestination) === courier.id,
        );
        if (!secondCourier) continue;
        selected = {
          firstDestination: firstDestination.id,
          secondDestination,
          firstCourier: firstCourierId,
          secondCourier: secondCourier.id,
        };
        break;
      }
    }
  }
  if (!selected) {
    return { accepted: false, state, error: "Two couriers need available capacity and reachable routes to start demo deliveries." };
  }

  const applied = applyCommands(current, [
    { type: "dispatch-delivery", from: origin, to: selected.firstDestination, priority: "normal", courierId: selected.firstCourier },
    { type: "dispatch-delivery", from: origin, to: selected.secondDestination, priority: "normal", courierId: selected.secondCourier },
  ]);
  if (!applied.accepted) return { accepted: false, state, error: applied.error };

  const previousIds = new Set(current.packages.map((pkg) => pkg.id));
  const demoPackageIds: string[] = [];
  const next = copyState(applied.state);
  for (const pkg of next.packages) {
    if (previousIds.has(pkg.id)) continue;
    pkg.source = "demo";
    demoPackageIds.push(pkg.id);
  }
  const validated = simulationStateSchema.safeParse(next);
  if (!validated.success) return { accepted: false, state, error: validated.error.issues[0]?.message ?? "Demo deliveries could not be started." };
  return { accepted: true, state: validated.data, demoPackageIds };
}

/** Return a courier's interpolated physical position on its current segment. */
export function getCourierPosition(state: SimulationState, courierId: string): CourierPosition {
  const validated = simulationStateSchema.parse(state);
  const courier = getCourierById(validated, courierId);
  if (!courier) throw new RangeError(`Courier ${courierId} does not exist.`);
  if (!courier.segment) {
    const location = validated.map.locations.find((candidate) => candidate.id === courier.locationId);
    if (!location) throw new RangeError(`Courier ${courierId} has no mapped position.`);
    return { x: location.x, y: location.y };
  }
  const segment = courier.segment;
  const ratio = Math.max(0, Math.min(1, segment.progress / segment.distance));
  return {
    x: segment.fromX + (segment.toX - segment.fromX) * ratio,
    y: segment.fromY + (segment.toY - segment.fromY) * ratio,
  };
}

/** Return derived delivery and activity totals without mutating simulation state. */
export function getMetrics(state: SimulationState): SimulationMetrics {
  const validated = simulationStateSchema.parse(state);
  const count = (status: Package["status"]) => validated.packages.filter((pkg) => pkg.status === status).length;
  const deliveredCount = count("delivered");
  const minutes = validated.elapsedSeconds / 60;
  const movingCouriers = validated.couriers.filter((courier) => courier.segment !== null).length;
  return {
    elapsedSeconds: validated.elapsedSeconds,
    distanceTraveled: validated.distanceTraveled,
    packageCount: validated.packages.length,
    deliveredCount,
    queuedCount: count("queued"),
    assignedCount: count("assigned"),
    inTransitCount: count("in_transit"),
    unreachableCount: count("unreachable"),
    movingCouriers,
    idleCouriers: validated.couriers.length - movingCouriers,
    deliveriesPerMinute: minutes > 0 ? deliveredCount / minutes : 0,
  };
}

export function isPriority(value: unknown): value is Priority {
  return value === "normal" || value === "urgent";
}

export function parseCommand(value: unknown): Command {
  return commandSchema.parse(value);
}

