import test from "node:test";
import assert from "node:assert/strict";
import { parsePreferences, layoutFor, defaults } from "../src/theme.ts";
import { initialRaid, raidReducer } from "../src/state/raid.ts";
test("corrupt or outdated saved settings recover safely", () => {
  for (const raw of [
    null,
    "broken",
    "null",
    "[]",
    '{"size":"unknown","highContrast":"yes"}',
  ])
    assert.deepEqual(parsePreferences(raw), defaults);
  assert.deepEqual(parsePreferences('{"size":"large","highContrast":true}'), {
    size: "large",
    highContrast: true,
  });
});
test("all sizes keep touch targets and adapt to OS large text / narrow phones", () => {
  for (const size of ["compact", "standard", "large"] as const) {
    for (const width of [320, 393, 430])
      for (const fontScale of [1, 1.5, 2, 3]) {
        const m = layoutFor(size, width, fontScale);
        assert.ok(m.touchTarget >= 48);
        if (fontScale >= 1.5 || width === 320)
          assert.equal(m.collapseRanking, true);
      }
  }
  assert.ok(
    layoutFor("large", 393, 1).text(14) > layoutFor("compact", 393, 1).text(14),
  );
});
test("raid win pays once, stops damage during reward and blocks duplicate purchase", () => {
  let s = initialRaid;
  for (let i = 0; i < 100; i++)
    s = raidReducer(s, { type: "move", dx: i % 2 ? 1 : -1, dy: 0 });
  assert.equal(s.hp, 0);
  assert.equal(s.wins, 1);
  assert.equal(s.points, 100);
  assert.equal(s.rewardOpen, true);
  s = raidReducer(s, { type: "buy" });
  assert.equal(s.points, 70);
  assert.equal(s.equipped, true);
  s = raidReducer(s, { type: "buy" });
  assert.equal(s.points, 70);
  s = raidReducer(s, { type: "next" });
  assert.equal(s.hp, 720);
  assert.equal(s.rewardOpen, false);
});
test("stationary boundary movement and insufficient balance do not progress", () => {
  const s = { ...initialRaid, x: 92 };
  assert.deepEqual(raidReducer(s, { type: "move", dx: 1, dy: 0 }), s);
  assert.deepEqual(raidReducer(initialRaid, { type: "buy" }), initialRaid);
});
