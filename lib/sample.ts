import { createSimulation } from "./simulation";
import type { PaperMap } from "./schema";

export const samplePaperMap: PaperMap = {
  locations: [
    { id: "A", label: "Paperworld Depot", kind: "depot", x: 12, y: 50 },
    { id: "J", label: "Main Junction", kind: "junction", x: 48, y: 50 },
    { id: "B", label: "North Home", kind: "home", x: 82, y: 20 },
    { id: "C", label: "South Shop", kind: "shop", x: 82, y: 80 },
  ],
  roads: [
    { id: "A-J", from: "A", to: "J", closed: false },
    { id: "J-B", from: "J", to: "B", closed: false },
    { id: "J-C", from: "J", to: "C", closed: true },
  ],
};

export const sampleSimulation = createSimulation(samplePaperMap);

