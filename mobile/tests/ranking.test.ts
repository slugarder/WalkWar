import assert from "node:assert/strict";
import test from "node:test";
import { derivePersonalRecord } from "../src/game/ranking.ts";
import type { Ranking } from "../src/game/types.ts";

const row = (id: string, rank: number, steps: number): Ranking => ({
  id, rank, steps, name: id, teamId: "team", teamName: "team", simulated: false,
  country: null, title: null, frame: null,
});
const self = { id: "me", name: "나", contribution: 17, active: true };

test("personal record uses a real top-three rank and authoritative contribution", () => {
  assert.deepEqual(derivePersonalRecord([row("me", 2, 999)], self), {
    name: "나", rank: 2, contribution: 17, rankLabel: "2위",
  });
});

test("personal record remains pinned when ranked outside the compact top three", () => {
  assert.deepEqual(derivePersonalRecord([row("a", 1, 9), row("me", 7, 99)], self), {
    name: "나", rank: 7, contribution: 17, rankLabel: "7위",
  });
});

test("unranked active and inactive records never invent rank zero", () => {
  assert.deepEqual(derivePersonalRecord([], { ...self, contribution: 0, active: true }), {
    name: "나", rank: null, contribution: 0, rankLabel: "순위 집계 전",
  });
  assert.deepEqual(derivePersonalRecord([], { ...self, contribution: 0, active: false }), {
    name: "나", rank: null, contribution: 0, rankLabel: "공략 전",
  });
});
