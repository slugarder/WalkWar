export type Raid = {
  steps: number;
  hp: number;
  points: number;
  wins: number;
  equipped: boolean;
  x: number;
  y: number;
  rewardOpen: boolean;
};
export const initialRaid: Raid = {
  steps: 7000,
  hp: 388,
  points: 0,
  wins: 0,
  equipped: false,
  x: 50,
  y: 61,
  rewardOpen: false,
};
export type Action =
  | { type: "move"; dx: number; dy: number }
  | { type: "buy" }
  | { type: "next" }
  | { type: "center" };
export function raidReducer(s: Raid, a: Action): Raid {
  if (a.type === "buy")
    return s.points >= 30 && !s.equipped
      ? { ...s, points: s.points - 30, equipped: true }
      : s;
  if (a.type === "next")
    return { ...s, hp: s.hp === 0 ? 720 : s.hp, rewardOpen: false };
  if (a.type === "center") return { ...s, x: 50, y: 61 };
  if (s.hp === 0) return s;
  const x = Math.max(8, Math.min(92, s.x + a.dx * 2)),
    y = Math.max(42, Math.min(78, s.y + a.dy * 1.5));
  if (x === s.x && y === s.y) return s;
  const hp = Math.max(0, s.hp - 8),
    win = hp === 0;
  return {
    ...s,
    x,
    y,
    steps: s.steps + 8,
    hp,
    points: s.points + (win ? 100 : 0),
    wins: s.wins + (win ? 1 : 0),
    rewardOpen: win,
  };
}
