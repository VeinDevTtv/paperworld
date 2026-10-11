/** One geometry transform for roads, stops, and authoritative courier positions. */
export function paperPointToWorld(x: number, y: number): [number, number, number] {
  return [(x - 50) * 0.16, 0, (y - 50) * 0.16];
}

export function roadPose(from: { x: number; y: number }, to: { x: number; y: number }) {
  const start = paperPointToWorld(from.x, from.y);
  const end = paperPointToWorld(to.x, to.y);
  const dx = end[0] - start[0];
  const dz = end[2] - start[2];
  return {
    position: [(start[0] + end[0]) / 2, 0, (start[2] + end[2]) / 2] as [number, number, number],
    length: Math.hypot(dx, dz),
    rotationY: Math.atan2(dx, dz),
  };
}
