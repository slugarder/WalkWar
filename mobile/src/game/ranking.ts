import type { Ranking } from "./types.ts";

export type PersonalRankingInput = {
  id: string;
  name: string;
  contribution: number;
  active: boolean;
};

export type PersonalRecord = {
  name: string;
  rank: number | null;
  contribution: number;
  rankLabel: string;
};

/** Keeps the personal contribution authoritative even before it enters the rank list. */
export function derivePersonalRecord(
  rows: Ranking[],
  self: PersonalRankingInput,
): PersonalRecord {
  const ranked = rows.find((row) => row.id === self.id);
  return {
    name: self.name,
    rank: ranked?.rank ?? null,
    contribution: self.contribution,
    rankLabel: ranked ? `${ranked.rank}위` : self.active ? "순위 집계 전" : "공략 전",
  };
}
