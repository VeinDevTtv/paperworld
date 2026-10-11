import { loadEnvConfig } from "@next/env";
import { mkdir, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { applyCommands, createSimulation } from "../lib/simulation";
import type { Command, SimulationState } from "../lib/schema";
import { proposeCommand } from "../server/providers";

loadEnvConfig(process.cwd());
// This harness never permits the optional paid adapter, even if local flags exist.
process.env.PAPERWORLD_ALLOW_PAID_API = "false";
process.env.PAPERWORLD_OPENAI_PROVIDER = "codex";
const base = createSimulation({ locations: [
  { id: "D", label: "Depot", kind: "depot", x: 10, y: 50 },
  { id: "J", label: "Junction", kind: "junction", x: 45, y: 50 },
  { id: "H", label: "Home", kind: "home", x: 80, y: 20 },
  { id: "S", label: "Shop", kind: "shop", x: 80, y: 80 },
], roads: [
  { id: "D-J", from: "D", to: "J", closed: false },
  { id: "J-H", from: "J", to: "H", closed: false },
  { id: "J-S", from: "J", to: "S", closed: false },
] });
const seed = applyCommands(base, [{ type: "create-package", from: "D", to: "H", priority: "normal" }]);
if (!seed.accepted) throw new Error(seed.error);
const initial = seed.state;
type Case = { id: string; group: string; text: string; clarify?: boolean; check?: (state: SimulationState) => boolean };
// Fixed before execution. Held-out wording is not used in implementation tuning.
const cases: Case[] = [
  { id: "simple-priority", group: "simple", text: "Set package pkg-1 to urgent", check: s => s.packages[0].priority === "urgent" && s.packages.length === 1 },
  { id: "simple-road", group: "simple", text: "Close road J-H", check: s => s.map.roads.find(r => r.id === "J-H")?.closed === true && s.packages.length === 1 },
  { id: "simple-dispatch", group: "simple", text: "Send an urgent delivery from Depot to Shop", check: s => s.packages.length === 2 && s.packages[1].from === "D" && s.packages[1].to === "S" && s.packages[1].priority === "urgent" && s.packages[1].courierId !== null },
  { id: "compound-two", group: "compound", text: "Set package pkg-1 to urgent and close road J-H", check: s => s.packages[0].priority === "urgent" && s.map.roads.find(r => r.id === "J-H")?.closed === true },
  { id: "compound-dispatch", group: "compound", text: "Close road J-H, then send a normal delivery from Depot to Shop", check: s => s.map.roads.find(r => r.id === "J-H")?.closed === true && s.packages.length === 2 && s.packages[1].to === "S" && s.packages[1].courierId !== null },
  { id: "ambiguous-destination", group: "ambiguous", text: "Send a delivery from Depot", clarify: true },
  { id: "ambiguous-package", group: "ambiguous", text: "Change a package priority", clarify: true },
  { id: "invalid-stop", group: "invalid", text: "Send a delivery from Depot to Atlantis", clarify: true },
  { id: "invalid-operation", group: "invalid", text: "Delete every courier and launch a rocket", clarify: true },
  { id: "heldout-priority", group: "held-out", text: "Please bump pkg-1 up to urgent priority", check: s => s.packages.length === 1 && s.packages[0].priority === "urgent" },
  { id: "heldout-dispatch", group: "held-out", text: "Have a courier take a normal parcel from Depot over to Shop", check: s => s.packages.length === 2 && s.packages[1].from === "D" && s.packages[1].to === "S" && s.packages[1].priority === "normal" && s.packages[1].courierId !== null },
  { id: "heldout-ambiguous", group: "held-out", text: "Could you ship something out of Depot?", clarify: true },
];
const priority: Command = { type: "set-priority", packageId: "pkg-1", priority: "urgent" };
const closure: Command = { type: "set-road", roadId: "J-H", closed: true };
const dispatch = (urgent = false): Command => ({ type: "dispatch-delivery", from: "D", to: "S", priority: urgent ? "urgent" : "normal", courierId: null });
const expectedCommands: Record<string, Command[]> = {
  "simple-priority": [priority], "simple-road": [closure], "simple-dispatch": [dispatch(true)],
  "compound-two": [priority, closure], "compound-dispatch": [closure, dispatch()],
  "heldout-priority": [priority], "heldout-dispatch": [dispatch()],
};
function exactEffect(id: string, state: SimulationState): boolean {
  const expected = applyCommands(structuredClone(initial), expectedCommands[id] ?? []);
  return expected.accepted && JSON.stringify(state) === JSON.stringify(expected.state);
}

async function main() {
  if (!process.argv.includes("--live")) throw new Error("Pass --live to run subscription Codex and Jev requests; no paid API calls.");
  const repeats = Number(process.env.PAPERWORLD_BENCHMARK_REPEATS ?? 1);
  if (!Number.isInteger(repeats) || repeats < 1 || repeats > 5) throw new Error("Repeats must be 1–5.");
  const rows: Record<string, unknown>[] = [];
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  await mkdir("docs/evidence", { recursive: true });
  const output = `docs/evidence/benchmark-${stamp}.json`;
  for (let repeat = 0; repeat < repeats; repeat++) for (const [index, item] of cases.entries()) {
    const order = (index + repeat) % 2 ? ["codex", "auto"] : ["auto", "codex"];
    for (const mode of order) {
      const startingState = structuredClone(initial);
      const started = performance.now();
      let row: Record<string, unknown>;
      try {
        const proposal = await proposeCommand({ text: item.text, mode, map: startingState.map, packages: startingState.packages, couriers: startingState.couriers });
        const mutation = proposal.clarification ? null : applyCommands(startingState, proposal.commands);
        const passed = item.clarify
          ? Boolean(proposal.clarification && proposal.commands.length === 0)
          : Boolean(!proposal.clarification && mutation?.accepted && item.check?.(mutation.state) && exactEffect(item.id, mutation.state));
        row = { case: item.id, group: item.group, text: item.text, repeat, mode, passed, clarification: Boolean(proposal.clarification), wallLatencyMs: Math.round(performance.now() - started), attempts: 1, retries: 0,
          model: /not reported/i.test(proposal.model) ? "not reported" : proposal.model, usage: proposal.usage ?? "not reported", routerModel: proposal.routerModel ?? "not reported", routerUsage: proposal.routerUsage ?? "not reported", proposal, validation: mutation ? (mutation.accepted ? "accepted" : mutation.error) : "clarification", startingState, resultingState: mutation?.state ?? startingState };
      } catch (error) {
        row = { case: item.id, group: item.group, text: item.text, repeat, mode, passed: false, clarification: false, wallLatencyMs: Math.round(performance.now() - started), attempts: 1, retries: 0, model: "not reported", error: error instanceof Error ? error.message : "unknown error", startingState };
      }
      rows.push(row);
      await writeFile(output, JSON.stringify({ evidence: "live providers / synthetic frozen state", createdAt: stamp, repeats, caseCount: cases.length, retries: "none; failed attempts retained", criteria: "same typed server validation and atomic applyCommands; exact full final state against expected commands, or clarification", rows }, null, 2));
      console.log(`${item.id} ${mode}: ${row.passed ? "PASS" : "FAIL"} ${row.wallLatencyMs}ms`);
    }
  }
  console.log(`Saved ${rows.length} outcomes to ${output}`);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
