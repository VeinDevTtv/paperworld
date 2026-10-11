import { z } from "zod";

const idSchema = z.string().trim().min(1).max(24);
const coordinateSchema = z.number().finite().min(0).max(100);

export const locationSchema = z.object({
  id: idSchema,
  label: z.string().trim().min(1).max(80),
  kind: z.enum(["depot", "home", "shop", "junction"]),
  x: coordinateSchema,
  y: coordinateSchema,
}).strict();

export const roadSchema = z.object({
  id: idSchema,
  from: idSchema,
  to: idSchema,
  closed: z.boolean(),
}).strict();

export const paperMapSchema = z.object({
  locations: z.array(locationSchema).min(1).max(32),
  roads: z.array(roadSchema).max(64),
}).strict().superRefine((map, context) => {
  const locations = new Map<string, Location>();
  for (const [index, location] of map.locations.entries()) {
    if (locations.has(location.id)) {
      context.addIssue({ code: "custom", path: ["locations", index, "id"], message: "Duplicate location id" });
    }
    locations.set(location.id, location);
  }

  const roadIds = new Set<string>();
  for (const [index, road] of map.roads.entries()) {
    if (roadIds.has(road.id)) {
      context.addIssue({ code: "custom", path: ["roads", index, "id"], message: "Duplicate road id" });
    }
    roadIds.add(road.id);

    const from = locations.get(road.from);
    const to = locations.get(road.to);
    if (!from || !to || road.from === road.to) {
      context.addIssue({ code: "custom", path: ["roads", index], message: "Road must connect two distinct known locations" });
      continue;
    }
    if (Math.hypot(to.x - from.x, to.y - from.y) <= 0) {
      context.addIssue({ code: "custom", path: ["roads", index], message: "Road length must be positive" });
    }
  }
});

export const prioritySchema = z.enum(["normal", "urgent"]);

export const commandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("create-package"), from: idSchema, to: idSchema, priority: prioritySchema }).strict(),
  z.object({ type: z.literal("set-priority"), packageId: idSchema, priority: prioritySchema }).strict(),
  z.object({ type: z.literal("set-road"), roadId: idSchema, closed: z.boolean() }).strict(),
  z.object({ type: z.literal("assign-package"), packageId: idSchema, courierId: idSchema }).strict(),
]);

export const commandsSchema = z.array(commandSchema).max(64);

export const segmentSchema = z.object({
  roadId: idSchema,
  from: idSchema,
  to: idSchema,
  fromX: coordinateSchema,
  fromY: coordinateSchema,
  toX: coordinateSchema,
  toY: coordinateSchema,
  progress: z.number().finite().nonnegative(),
  distance: z.number().finite().positive(),
}).strict().superRefine((segment, context) => {
  if (segment.progress > segment.distance + 1e-9) {
    context.addIssue({ code: "custom", path: ["progress"], message: "Segment progress cannot exceed its length" });
  }
  if (Math.hypot(segment.toX - segment.fromX, segment.toY - segment.fromY) <= 0) {
    context.addIssue({ code: "custom", path: ["distance"], message: "Segment length must be positive" });
  }
});

export const courierSchema = z.object({
  id: idSchema,
  name: z.string().trim().min(1).max(48),
  locationId: idSchema,
  segment: segmentSchema.nullable(),
  packageIds: z.array(idSchema).max(8),
  capacity: z.number().int().min(1).max(8),
}).strict().superRefine((courier, context) => {
  if (courier.packageIds.length > courier.capacity) {
    context.addIssue({ code: "custom", path: ["packageIds"], message: "Courier package load exceeds capacity" });
  }
  if (new Set(courier.packageIds).size !== courier.packageIds.length) {
    context.addIssue({ code: "custom", path: ["packageIds"], message: "Courier package ids must be unique" });
  }
  if (courier.segment && courier.segment.from !== courier.locationId) {
    context.addIssue({ code: "custom", path: ["segment", "from"], message: "Courier segment must start at its current location" });
  }
});

export const packageSchema = z.object({
  id: idSchema,
  from: idSchema,
  to: idSchema,
  priority: prioritySchema,
  status: z.enum(["queued", "assigned", "in_transit", "unreachable", "delivered"]),
  pickedUp: z.boolean(),
  courierId: idSchema.nullable(),
  createdOrder: z.number().int().positive(),
}).strict().superRefine((pkg, context) => {
  if (pkg.from === pkg.to) {
    context.addIssue({ code: "custom", path: ["to"], message: "Package origin and destination must differ" });
  }
  if (pkg.status === "queued" && pkg.courierId !== null) {
    context.addIssue({ code: "custom", path: ["courierId"], message: "Queued package cannot have a courier" });
  }
  if (pkg.status !== "queued" && pkg.courierId === null) {
    context.addIssue({ code: "custom", path: ["courierId"], message: "Assigned package must have a courier" });
  }
  if ((pkg.status === "assigned" || pkg.status === "queued") && pkg.pickedUp) {
    context.addIssue({ code: "custom", path: ["pickedUp"], message: "Package cannot be picked up before its origin" });
  }
  if ((pkg.status === "in_transit" || pkg.status === "delivered") && !pkg.pickedUp) {
    context.addIssue({ code: "custom", path: ["pickedUp"], message: "Package must be picked up before delivery" });
  }
});

export const eventSchema = z.object({
  id: idSchema,
  type: z.enum(["package_created", "package_assigned", "priority_changed", "road_closed", "road_opened", "package_unreachable", "package_resumed", "package_picked_up", "package_delivered", "map_updated"]),
  atSeconds: z.number().finite().nonnegative(),
  courierId: idSchema.optional(),
  packageId: idSchema.optional(),
  roadId: idSchema.optional(),
}).strict();

export const simulationStateSchema = z.object({
  map: paperMapSchema,
  couriers: z.array(courierSchema).min(1).max(16),
  packages: z.array(packageSchema).max(256),
  elapsedSeconds: z.number().finite().nonnegative(),
  distanceTraveled: z.number().finite().nonnegative(),
  events: z.array(eventSchema).max(200),
  nextPackageNumber: z.number().int().positive(),
  nextEventNumber: z.number().int().positive(),
}).strict().superRefine((state, context) => {
  const locations = new Map(state.map.locations.map((location) => [location.id, location]));
  const couriers = new Map<string, Courier>();
  const packages = new Map<string, Package>();

  for (const [index, courier] of state.couriers.entries()) {
    if (couriers.has(courier.id)) {
      context.addIssue({ code: "custom", path: ["couriers", index, "id"], message: "Duplicate courier id" });
    }
    couriers.set(courier.id, courier);
    if (!locations.has(courier.locationId)) {
      context.addIssue({ code: "custom", path: ["couriers", index, "locationId"], message: "Courier location is missing from the map" });
    }
    if (courier.segment) {
      const from = locations.get(courier.segment.from);
      const to = locations.get(courier.segment.to);
      if (!from || !to) {
        context.addIssue({ code: "custom", path: ["couriers", index, "segment"], message: "Segment endpoints must remain on the map" });
      } else if (
        from.x !== courier.segment.fromX || from.y !== courier.segment.fromY ||
        to.x !== courier.segment.toX || to.y !== courier.segment.toY
      ) {
        context.addIssue({ code: "custom", path: ["couriers", index, "segment"], message: "Segment geometry must match its pinned map endpoints" });
      }
    }
  }

  for (const [index, pkg] of state.packages.entries()) {
    if (packages.has(pkg.id)) {
      context.addIssue({ code: "custom", path: ["packages", index, "id"], message: "Duplicate package id" });
    }
    packages.set(pkg.id, pkg);
    if (!locations.has(pkg.from) || !locations.has(pkg.to)) {
      context.addIssue({ code: "custom", path: ["packages", index], message: "Package endpoints must remain on the map" });
    }
    if (pkg.courierId !== null) {
      const courier = couriers.get(pkg.courierId);
      if (!courier || (pkg.status !== "delivered" && !courier.packageIds.includes(pkg.id))) {
        context.addIssue({ code: "custom", path: ["packages", index, "courierId"], message: "Package assignment must match courier load" });
      }
    }
  }

  for (const [courierIndex, courier] of state.couriers.entries()) {
    for (const [packageIndex, packageId] of courier.packageIds.entries()) {
      const pkg = packages.get(packageId);
      if (!pkg || pkg.courierId !== courier.id || pkg.status === "delivered") {
        context.addIssue({ code: "custom", path: ["couriers", courierIndex, "packageIds", packageIndex], message: "Courier load must contain only active assigned packages" });
      }
    }
  }
});

export type Location = z.infer<typeof locationSchema>;
export type Road = z.infer<typeof roadSchema>;
export type PaperMap = z.infer<typeof paperMapSchema>;
export type Priority = z.infer<typeof prioritySchema>;
export type Command = z.infer<typeof commandSchema>;
export type Segment = z.infer<typeof segmentSchema>;
export type Courier = z.infer<typeof courierSchema>;
export type Package = z.infer<typeof packageSchema>;
export type SimulationEvent = z.infer<typeof eventSchema>;
export type SimulationState = z.infer<typeof simulationStateSchema>;

