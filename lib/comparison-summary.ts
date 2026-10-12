import type { RoadComparisonResult } from "./road-comparison";

/** Describe observed branch outcomes, never estimate a real-world improvement. */
export function summarizeRoadComparison(result: RoadComparisonResult): string {
  const without = new Map(result.withoutChange.packages.map((pkg) => [pkg.id, pkg]));
  const withEdit = new Map(result.withChange.packages.map((pkg) => [pkg.id, pkg]));
  const gains: string[] = [];
  const losses: string[] = [];
  for (const [id, after] of withEdit) {
    const before = without.get(id);
    if (!before) continue;
    if (after.status === "delivered" && before.status !== "delivered") gains.push(id);
    if (before.status === "delivered" && after.status !== "delivered") losses.push(id);
  }
  const list = (ids: string[]) => {
    const sorted = [...ids].sort((a, b) => a.localeCompare(b));
    return sorted.slice(0, 3).join(", ") + (sorted.length > 3 ? ` and ${sorted.length - 3} more` : "");
  };
  const window = `${result.intervalSeconds} simulated seconds after the captured edit`;
  const parts: string[] = [];
  if (gains.length) {
    const blocked = gains.every((id) => without.get(id)?.status === "unreachable");
    parts.push(`With this road change, ${list(gains)} ${gains.length === 1 ? "completes" : "complete"} within ${window}; without it, ${blocked ? (gains.length === 1 ? "it remains blocked" : "they remain blocked") : (gains.length === 1 ? "it has not completed in that interval" : "they have not completed in that interval")}.`);
  }
  if (losses.length) {
    const blocked = losses.every((id) => withEdit.get(id)?.status === "unreachable");
    parts.push(`Without this road change, ${list(losses)} ${losses.length === 1 ? "completes" : "complete"} within ${window}; with it, ${blocked ? (losses.length === 1 ? "it remains blocked" : "they remain blocked") : (losses.length === 1 ? "it has not completed in that interval" : "they have not completed in that interval")}.`);
  }
  if (!parts.length) {
    parts.push(`The same packages complete in both versions within ${window}.`);
    if (result.withMetrics.waiting !== result.withoutMetrics.waiting) {
      parts.push(`Blocked at the end: ${result.withoutMetrics.waiting} without the change, ${result.withMetrics.waiting} with it.`);
    } else {
      parts.push("There is no difference in completed or blocked package outcomes in this interval.");
    }
  }
  return parts.join(" ");
}
