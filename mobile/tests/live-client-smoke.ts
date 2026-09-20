/**
 * Opt-in smoke for the fixed Railway production server.
 * It is intentionally not named *.test.ts, so `npm test` never contacts a server.
 */
import assert from "node:assert/strict";
import { GameClient, type GameStorage } from "../src/game/client.ts";
import type { RegionsResponse, Snapshot } from "../src/game/types.ts";

class EphemeralStorage implements GameStorage {
  private values = new Map<string, string>();
  async getItem(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }
  async setItem(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function main(): Promise<void> {
  const client = new GameClient({ storage: new EphemeralStorage(), platform: "web" });
  client.start();
  try {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    assert.equal(await client.connect(`Smoke ${suffix}`, "virtual"), true);
    assert.ok(client.snapshot, "connect should return a confirmed snapshot");
    assert.equal(client.snapshot?.raid, null, "joining must create a browsing session, not a target raid");
    assert.equal(client.snapshot?.player.regionId, null, "joining must not auto-select a region");

    const regions = await client.read<RegionsResponse>("regions?level=emd&limit=1");
    const region = regions.regions[0];
    assert.ok(region?.id, "server should offer an explicit selectable EMD region");
    assert.equal(await client.selectRegion(region.id), true);
    assert.equal(client.snapshot?.player.regionId, region.id, "only the explicit selection may set the target");
    assert.ok(client.snapshot?.raid, "the selected region should have a raid");

    const beforeWalk = client.snapshot?.player.totalSteps ?? 0;
    client.setMovementEnabled(true);
    client.setDirection(1, 0);
    await sleep(2_600);
    const afterWalk = client.snapshot?.player.totalSteps ?? 0;
    assert.ok(afterWalk > beforeWalk, `virtual input should increase steps (${beforeWalk} -> ${afterWalk})`);

    client.setForeground(false);
    await sleep(1_100); // permit the server's 750ms input expiry before taking the baseline
    const playerId = client.snapshot?.player.id;
    assert.ok(playerId);
    const stopped = await client.read<Snapshot>(`players/${encodeURIComponent(playerId)}/state`);
    await sleep(1_300);
    const stillStopped = await client.read<Snapshot>(`players/${encodeURIComponent(playerId)}/state`);
    assert.equal(stillStopped.player.totalSteps, stopped.player.totalSteps, "backgrounding must release virtual movement");

    client.setForeground(true);
    client.setDirection(1, 0);
    await sleep(80);
    client.disconnect();
    await sleep(1_250);
    assert.equal(client.snapshot, null, "a late timer response must not restore a disconnected session");
    console.log(`Live game-client smoke passed: playerId=${playerId} totalSteps=${stillStopped.player.totalSteps}`);
  } finally {
    client.disconnect();
    client.dispose();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
