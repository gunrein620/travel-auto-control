import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadEnvFile } from "../server/env.js";

test("loadEnvFile loads .env values without overriding existing process env", async () => {
  const dir = await mkdtemp(join(tmpdir(), "travel-env-"));
  const envPath = join(dir, ".env");
  const originalEndpoint = process.env.ENNOIA_NATURAL_EDIT_ENDPOINT;
  const originalKey = process.env.ENNOIA_API_KEY;

  process.env.ENNOIA_API_KEY = "already-set";

  try {
    await writeFile(
      envPath,
      [
        "ENNOIA_NATURAL_EDIT_ENDPOINT=https://api.ennoia.example/stream",
        "ENNOIA_API_KEY=from-file",
        "LIVE_WEATHER=1",
        ""
      ].join("\n"),
      "utf8"
    );

    const loaded = await loadEnvFile(envPath);

    assert.equal(loaded.ENNOIA_NATURAL_EDIT_ENDPOINT, "https://api.ennoia.example/stream");
    assert.equal(process.env.ENNOIA_NATURAL_EDIT_ENDPOINT, "https://api.ennoia.example/stream");
    assert.equal(process.env.ENNOIA_API_KEY, "already-set");
    assert.equal(process.env.LIVE_WEATHER, "1");
  } finally {
    restoreEnv("ENNOIA_NATURAL_EDIT_ENDPOINT", originalEndpoint);
    restoreEnv("ENNOIA_API_KEY", originalKey);
    delete process.env.LIVE_WEATHER;
    await rm(dir, { recursive: true, force: true });
  }
});

function restoreEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
