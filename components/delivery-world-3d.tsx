"use client";

import { Component, createContext, memo, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { BoxGeometry, CircleGeometry, CylinderGeometry, CanvasTexture, Matrix4, MeshStandardMaterial, SRGBColorSpace, type Group, type InstancedMesh } from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { paperPointToWorld, roadPose } from "../lib/world-presentation";
import type { CourierMarker as BaseCourierMarker, RoadChangeKind, WorldLocation, WorldRoad } from "./delivery-world";

type CourierMarker = BaseCourierMarker & { heading?: number };
type WorldSelection = { kind: "location" | "road" | "courier"; id: string };

type Props = {
  locations: WorldLocation[];
  roads: WorldRoad[];
  couriers: CourierMarker[];
  roadChanges: ReadonlyMap<string, RoadChangeKind>;
  selection: WorldSelection | null;
  onSelect: (selection: WorldSelection | null) => void;
  onUnavailable: () => void;
  resetView: number;
  births: ReadonlyMap<string, number>;
  buildingOffsetCache: Map<string, { birth?: number; offset: [number, number, number] }>;
  celebrations: ReadonlyMap<string, number>;
  reducedMotion?: boolean;
  roadBirths?: ReadonlyMap<string, number>;
  roadAnimations?: ReadonlyMap<string, number>;
};

class CanvasBoundary extends Component<{ children: ReactNode; onUnavailable: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error) { console.error("Paperworld 3D renderer unavailable:", error); this.props.onUnavailable(); }
  render() { return this.state.failed ? null : this.props.children; }
}

function Controls({ resetView, reducedMotion }: { resetView: number; reducedMotion?: boolean }) {
  const { camera, gl, invalidate, size } = useThree();
  const controls = useMemo(() => new OrbitControls(camera), [camera, gl]);
  useEffect(() => {
    controls.connect(gl.domElement);
    const changed = () => invalidate();
    controls.addEventListener("change", changed);
    return () => { controls.removeEventListener("change", changed); controls.dispose(); };
  }, [controls, gl, invalidate]);
  useEffect(() => {
    controls.target.set(0, 0, 0);
    controls.enablePan = false;
    controls.enableDamping = !reducedMotion;
    controls.dampingFactor = 0.12;
    controls.minDistance = 9;
    controls.maxDistance = 38;
    controls.maxPolarAngle = Math.PI * 0.46;
    controls.update();
    invalidate();
  }, [controls, invalidate, reducedMotion]);
  useEffect(() => {
    const aspect = size.width / Math.max(1, size.height);
    const distanceScale = aspect < 1.15 ? 1.35 : 1;
    camera.position.set(11 * distanceScale, 15 * distanceScale, 16 * distanceScale);
    controls.target.set(0, 0, 0);
    controls.update();
    invalidate();
  }, [camera, controls, invalidate, resetView, size.width, size.height]);
  useFrame(() => controls.update());
  return null;
}

function UnsupportedGraphics() {
  return <div className="world-loading" role="status">3D is unavailable. Choose 2D map to keep going.</div>;
}

function ContextGuard({ onUnavailable }: { onUnavailable: () => void }) {
  const { gl } = useThree();
  useEffect(() => {
    const lost = (event: Event) => { event.preventDefault(); onUnavailable(); };
    gl.domElement.addEventListener("webglcontextlost", lost);
    return () => gl.domElement.removeEventListener("webglcontextlost", lost);
  }, [gl, onUnavailable]);
  return null;
}

function Label({ text, position, color = "#29382d", width = 3, order = 5 }: { text: string; position: [number, number, number]; color?: string; width?: number; order?: number }) {
  const texture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 96;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "rgba(255,253,245,.94)";
    context.fillRect(0, 0, 512, 96);
    context.font = "600 68px Arial";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillStyle = color;
    const visibleText = text.length > 22 ? `${text.slice(0, 19)}…` : text;
    context.fillText(visibleText, 256, 48, 480);
    const result = new CanvasTexture(canvas);
    result.colorSpace = SRGBColorSpace;
    return result;
  }, [text, color]);
  useEffect(() => () => texture.dispose(), [texture]);
  return <sprite position={position} scale={[width, width * 96 / 512, 1]} renderOrder={order}>
    <spriteMaterial map={texture} depthTest={false} depthWrite={false} transparent />
  </sprite>;
}

type SharedResources = { box: BoxGeometry; wheel: CylinderGeometry; junction: CylinderGeometry; pad: CircleGeometry; materials: Map<string, MeshStandardMaterial> };
const ResourceContext = createContext<SharedResources | null>(null);
function SharedMeshes({ children }: { children: ReactNode }) {
  const resources = useMemo(() => ({ box: new BoxGeometry(1, 1, 1), wheel: new CylinderGeometry(0.1, 0.1, 0.075, 12), junction: new CylinderGeometry(0.25, 0.25, 0.1, 24), pad: new CircleGeometry(1, 32), materials: new Map<string, MeshStandardMaterial>() }), []);
  useEffect(() => () => {
    resources.box.dispose(); resources.wheel.dispose(); resources.junction.dispose(); resources.pad.dispose();
    for (const material of resources.materials.values()) material.dispose();
  }, [resources]);
  return <ResourceContext.Provider value={resources}>{children}</ResourceContext.Provider>;
}

function sharedMaterial(resources: SharedResources, color: string) {
  let material = resources.materials.get(color);
  if (!material) { material = new MeshStandardMaterial({ color, roughness: 0.85 }); resources.materials.set(color, material); }
  return material;
}

function Box({ position, size, color }: { position: [number, number, number]; size: [number, number, number]; color: string }) {
  const resources = useContext(ResourceContext)!;
  const material = sharedMaterial(resources, color);
  return <mesh position={position} scale={size} geometry={resources.box} material={material} dispose={null} castShadow receiveShadow />;
}

const Building = memo(function Building({ location, selected, birth, onSelect, reducedMotion, buildingOffset }: { location: WorldLocation; selected: boolean; birth?: number; onSelect: Props["onSelect"]; reducedMotion?: boolean; buildingOffset: [number, number, number] }) {
  const resources = useContext(ResourceContext)!;
  const group = useRef<Group>(null);
  const { invalidate } = useThree();
  useFrame(() => {
    if (!group.current) return;
    const age = reducedMotion || birth === undefined ? 1 : Math.min(1, (Date.now() - birth) / 650);
    group.current.scale.setScalar(Math.max(0.02, 1 - Math.pow(1 - age, 3)));
    if (age < 1) invalidate();
  });
  const select = (event: ThreeEvent<MouseEvent>) => { event.stopPropagation(); onSelect({ kind: "location", id: location.id }); };
  const home = location.kind === "home";
  const shop = location.kind === "shop";
  const depot = location.kind === "depot";
  const height = depot ? 1.2 : home ? 0.9 : 0.7;
  return <group name={`location:${location.id}`} userData={{ locationId: location.id, kind: location.kind }} position={paperPointToWorld(location.x, location.y)} onClick={select}>
    <group ref={group}>
      <mesh name={`arrival-pad:${location.id}`} position={[0, 0.025, 0]} rotation={[-Math.PI / 2, 0, 0]} scale={selected ? 0.9 : 0.7} geometry={resources.pad} material={sharedMaterial(resources, selected ? "#d4dda0" : "#dce3ca")} dispose={null} receiveShadow />
      {location.kind === "junction" ? <mesh position={[0, 0.07, 0]} geometry={resources.junction} material={sharedMaterial(resources, "#efdfb0")} dispose={null} /> : <group position={buildingOffset}>
        <Box position={[0, height / 2, 0]} size={[depot ? 1.3 : 0.95, height, depot ? 1 : 0.85]} color={depot ? "#e0c290" : shop ? "#aabca6" : "#eedbc0"} />
        {home ? <mesh position={[0, height + 0.22, 0]} rotation={[0, Math.PI / 4, 0]} castShadow><coneGeometry args={[0.8, 0.55, 4]} /><meshStandardMaterial color="#ba7357" /></mesh> : <Box position={[0, height + 0.055, 0]} size={[depot ? 1.45 : 1.1, 0.11, depot ? 1.12 : 1]} color={depot ? "#778578" : "#54776a"} />}
        <Box position={[0, 0.26, 0.44]} size={[depot ? 0.8 : 0.22, 0.52, 0.035]} color={depot ? "#67746a" : "#8d6850"} />
        {!depot ? [-0.3, 0.3].map((x) => <Box key={x} position={[x, 0.52, 0.435]} size={[0.2, 0.22, 0.03]} color="#b3d5d4" />) : null}
        {shop ? <Box position={[0, 0.65, 0.6]} size={[1.05, 0.12, 0.48]} color="#e9b467" /> : null}
      </group>}
    </group>
    <Label text={location.label} position={[buildingOffset[0], location.kind === "junction" ? 1.8 : 2.4, buildingOffset[2]]} />
  </group>;
});

function RoadDashes({ length }: { length: number }) {
  const resources = useContext(ResourceContext)!;
  const mesh = useRef<InstancedMesh>(null);
  const count = Math.min(30, Math.floor(length / 0.7));
  useEffect(() => {
    const instance = mesh.current;
    return () => instance?.dispose();
  }, [count]);
  useLayoutEffect(() => {
    if (!mesh.current) return;
    const matrix = new Matrix4();
    for (let index = 0; index < count; index++) {
      matrix.makeScale(0.025, 0.012, 0.28);
      matrix.setPosition(0, 0.061, -length / 2 + 0.35 + index * 0.7);
      mesh.current.setMatrixAt(index, matrix);
    }
    mesh.current.instanceMatrix.needsUpdate = true;
  }, [length, count]);
  if (!count) return null;
  return <instancedMesh ref={mesh} args={[resources.box, sharedMaterial(resources, "#eee5c8"), count]} dispose={null} />;
}

const Road = memo(function Road({ road, from, to, changed, selected, route, onSelect, animatedAt, birthAt, reducedMotion, showChangeLabel }: { road: WorldRoad; from: WorldLocation; to: WorldLocation; changed?: RoadChangeKind; selected: boolean; route?: string; onSelect: Props["onSelect"]; animatedAt?: number; birthAt?: number; reducedMotion?: boolean; showChangeLabel: boolean }) {
  const pulse = useRef<Group>(null);
  const roadBody = useRef<Group>(null);
  const { invalidate } = useThree();
  useFrame(() => {
    const birthAge = reducedMotion || birthAt === undefined ? 1 : Math.min(1, (Date.now() - birthAt) / 700);
    if (roadBody.current) roadBody.current.scale.z = Math.max(0.001, 1 - Math.pow(1 - birthAge, 3));
    if (birthAge < 1) invalidate();
    if (!pulse.current) return;
    const age = reducedMotion || animatedAt === undefined ? 2 : (Date.now() - animatedAt) / 1400;
    pulse.current.visible = age < 1;
    pulse.current.scale.setScalar(1 + age * 1.8);
    if (age < 1) invalidate();
  });
  const pose = roadPose(from, to);
  if (pose.length < 0.001) return null;
  return <group name={`road:${road.id}`} userData={{ roadId: road.id, from: road.from, to: road.to, closed: road.closed }} position={pose.position} rotation={[0, pose.rotationY, 0]} onClick={(event) => { event.stopPropagation(); onSelect({ kind: "road", id: road.id }); }}>
    <group ref={roadBody}>
    <Box position={[0, 0.012, 0]} size={[0.48, 0.025, pose.length]} color={selected ? "#deb76b" : "#d4cfbc"} />
    <Box position={[0, 0.035, 0]} size={[0.34, 0.04, pose.length]} color={road.closed ? "#a48b7b" : "#87918a"} />
    {route && !road.closed ? <Box position={[0, 0.065, 0]} size={[0.095, 0.012, pose.length]} color={route} /> : null}
    <RoadDashes length={pose.length} />
    </group>
    {road.closed ? <group position={[0, 0.25, 0]}><Box position={[0, 0, 0]} size={[0.85, 0.17, 0.1]} color="#c86246" /><Box position={[-0.28, -0.1, 0]} size={[0.07, 0.36, 0.1]} color="#eee4cc" /><Box position={[0.28, -0.1, 0]} size={[0.07, 0.36, 0.1]} color="#eee4cc" /></group> : null}
    {changed ? <group ref={pulse} position={[0, 0.08, 0]}><mesh rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[0.35, 0.4, 32]} /><meshBasicMaterial color={road.closed ? "#c66c47" : "#6eaa77"} transparent opacity={0.6} /></mesh></group> : null}
    {changed && !showChangeLabel ? <Box position={[0, 0.12, 0]} size={[0.18, 0.08, 0.18]} color={road.closed ? "#c66c47" : "#6eaa77"} /> : null}
    {changed && showChangeLabel ? <Label text={changed === "new" ? "NEW CONNECTION" : road.closed ? "ROAD CLOSED" : "ROAD CHANGED"} position={[0, 0.9, 0]} color={road.closed ? "#a74733" : "#397953"} width={2.2} /> : null}
  </group>;
});

function Vehicle({ courier, index, onSelect, celebration, reducedMotion }: { courier: CourierMarker; index: number; onSelect: Props["onSelect"]; celebration?: number; reducedMotion?: boolean }) {
  const resources = useContext(ResourceContext)!;
  const color = courier.activePackage?.status === "unreachable" ? "#d68149" : index % 2 ? "#577e9c" : "#558869";
  return <group name={`courier:${courier.id}`} userData={{ courierId: courier.id, packageId: courier.activePackage?.id ?? null, pickedUp: courier.activePackage?.pickedUp ?? false }} position={paperPointToWorld(courier.x, courier.y)}>
    <group rotation={[0, courier.heading ?? 0, 0]} onClick={(event) => { event.stopPropagation(); onSelect({ kind: "courier", id: courier.id }); }}>
      {courier.activePackage?.pickedUp ? <><Box position={[0, 0.57, -0.13]} size={[0.23, 0.19, 0.25]} color="#b9905e" /><Box position={[0, 0.67, -0.13]} size={[0.035, 0.012, 0.25]} color="#ead6a9" /></> : null}
      <Box position={[0, 0.3, 0]} size={[0.32, 0.28, 0.6]} color={color} />
      <Box position={[0, 0.46, 0.12]} size={[0.29, 0.16, 0.24]} color="#d3e4df" />
      <Box position={[0, 0.32, 0.32]} size={[0.25, 0.07, 0.02]} color="#faf0ba" />
      {[-0.18, 0.18].flatMap((x) => [-0.18, 0.18].map((z) => <mesh key={`${x}-${z}`} position={[x, 0.16, z]} rotation={[0, 0, Math.PI / 2]} geometry={resources.wheel} material={sharedMaterial(resources, "#333c38")} dispose={null} />))}
    </group>
    <Label text={`${courier.label}${courier.activePackage?.status === "unreachable" ? " · WAITING" : ""}`} position={[index % 2 ? 0.5 : -0.5, 1.05 + (index % 4) * 0.6, 0.9]} color="#29382d" width={2.1} order={10 + index} />
    {courier.activePackage?.status === "unreachable" ? <mesh position={[0, 0.085, 0]} rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[0.35, 0.43, 32]} /><meshBasicMaterial color="#d68b4c" /></mesh> : null}
    {celebration && !reducedMotion ? <Celebration born={celebration} /> : null}
  </group>;
}

function Celebration({ born }: { born: number }) {
  const group = useRef<Group>(null);
  const { invalidate } = useThree();
  useFrame(() => {
    if (!group.current) return;
    const age = (Date.now() - born) / 1600;
    group.current.visible = age < 1;
    group.current.position.y = age * 1.2;
    group.current.scale.setScalar(0.5 + age);
    group.current.rotation.y = age * 2;
    if (age < 1) invalidate();
  });
  return <group ref={group}>{Array.from({ length: 10 }, (_, index) => <mesh key={index} position={[Math.cos(index * Math.PI / 5) * 0.7, 0.6 + index % 3 * 0.15, Math.sin(index * Math.PI / 5) * 0.7]} rotation={[index, index * 0.8, 0]}><boxGeometry args={[0.1, 0.06, 0.14]} /><meshBasicMaterial color={index % 2 ? "#e6b655" : "#679e75"} /></mesh>)}</group>;
}

function Scene(props: Props & { complexMap: boolean }) {
  const showAllChangeLabels = props.roadChanges.size <= 12;
  const byId = useMemo(() => new Map(props.locations.map((location) => [location.id, location])), [props.locations]);
  const offsetCache = props.buildingOffsetCache;
  const buildingOffsets = useMemo(() => new Map(props.locations.map((location) => {
    const birth = props.births.get(location.id);
    const cached = offsetCache.get(location.id);
    if (cached && cached.birth === birth) return [location.id, cached.offset];
    let dx = 0; let dz = 0;
    for (const road of props.roads) {
      const otherId = road.from === location.id ? road.to : road.to === location.id ? road.from : null;
      const other = otherId ? byId.get(otherId) : undefined;
      if (!other) continue;
      const length = Math.hypot(other.x - location.x, other.y - location.y) || 1;
      dx += (other.x - location.x) / length; dz += (other.y - location.y) / length;
    }
    const length = Math.hypot(dx, dz);
    const offset: [number, number, number] = location.kind === "junction" ? [0, 0, 0] : length > 0.001 ? [-dx / length * 1.35, 0, -dz / length * 1.35] : [0, 0, -1.35];
    offsetCache.set(location.id, { birth, offset });
    return [location.id, offset];
  })), [props.locations, props.roads, byId, props.births, offsetCache]);
  const selectedCourier = props.selection?.kind === "courier" ? props.couriers.find((courier) => courier.id === props.selection?.id) : undefined;
  return <>
    <SharedMeshes>
    <color attach="background" args={["#f1f0e6"]} />
    <ambientLight intensity={1.1} />
    <directionalLight position={[-8, 15, 8]} intensity={2.2} castShadow={!props.complexMap} shadow-mapSize={[1024, 1024]} shadow-camera-left={-12} shadow-camera-right={12} shadow-camera-top={12} shadow-camera-bottom={-12} shadow-bias={-0.001} />
    <mesh position={[0, -0.1, 0]} receiveShadow><boxGeometry args={[19, 0.2, 19]} /><meshStandardMaterial color="#e6e6d0" roughness={1} /></mesh>
    <gridHelper args={[18, 18, "#c9d0b7", "#d7dcc8"]} position={[0, 0.002, 0]} />
    {props.roads.map((road) => {
      const from = byId.get(road.from); const to = byId.get(road.to);
      if (!from || !to) return null;
      const active = (selectedCourier ? [selectedCourier] : props.couriers).find((courier) => courier.routeRoadIds?.includes(road.id));
      return <Road showChangeLabel={showAllChangeLabels || (props.selection?.kind === "road" && props.selection.id === road.id)} reducedMotion={props.reducedMotion} key={road.id} road={road} from={from} to={to} changed={props.roadChanges.get(road.id)} animatedAt={props.roadAnimations?.get(road.id)} birthAt={props.roadBirths?.get(road.id)} selected={props.selection?.kind === "road" && props.selection.id === road.id} route={active ? active.routeReplanned ? "#d9a444" : "#76b994" : undefined} onSelect={props.onSelect} />;
    })}
    {props.couriers.filter((courier) => courier.pinnedSegment).map((courier) => {
      const segment = courier.pinnedSegment!;
      const pose = roadPose({ x: segment.fromX, y: segment.fromY }, { x: segment.toX, y: segment.toY });
      return <group key={`trail-${courier.id}`} position={pose.position} rotation={[0, pose.rotationY, 0]}><Box position={[0, 0.04, 0]} size={[0.3, 0.025, pose.length]} color="#c6b9a3" /></group>;
    })}
    {props.locations.map((location) => {
      const offset = buildingOffsets.get(location.id)!;
      return <Building reducedMotion={props.reducedMotion} key={location.id} location={location} buildingOffset={offset} selected={props.selection?.kind === "location" && props.selection.id === location.id} birth={props.births.get(location.id)} onSelect={props.onSelect} />;
    })}
    {props.couriers.map((courier, index) => <Vehicle reducedMotion={props.reducedMotion} key={courier.id} courier={courier} index={index} onSelect={props.onSelect} celebration={props.celebrations.get(courier.id)} />)}
    <Controls reducedMotion={props.reducedMotion} resetView={props.resetView} />
    <ContextGuard onUnavailable={props.onUnavailable} />
    </SharedMeshes>
  </>;
}

export default function DeliveryWorld3D(props: Props) {
  const complexMap = props.locations.length > 12 || props.roads.length > 24;
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const changed = () => setReducedMotion(query.matches);
    query.addEventListener("change", changed);
    return () => query.removeEventListener("change", changed);
  }, []);
  return <CanvasBoundary onUnavailable={props.onUnavailable}>
    <Canvas className="delivery-scene" shadows={!complexMap} frameloop="demand" dpr={[1, 1.5]} camera={{ position: [11, 15, 16], fov: 42, near: 0.1, far: 120 }} gl={{ antialias: true, powerPreference: "low-power" }} fallback={<UnsupportedGraphics />} onPointerMissed={() => props.onSelect(null)}>
      <Scene {...props} complexMap={complexMap} reducedMotion={reducedMotion} />
    </Canvas>
  </CanvasBoundary>;
}
