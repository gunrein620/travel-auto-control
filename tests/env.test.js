import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

test(".env.example points trip generation at the stable preset judgment engine", async () => {
  const source = await readFile(new URL("../.env.example", import.meta.url), "utf8");

  assert.match(
    source,
    /ENNOIA_TRIP_GENERATION_ENDPOINT=https:\/\/api\.ennoia\.so\/api\/preset\/v2\/chat\/completions/
  );
  assert.match(source, /ENNOIA_PROJECT_ID=KNTO-PROMPTON-2026-544/);
  assert.match(source, /^ENNOIA_API_KEY=$/m);
  assert.match(source, /^ENNOIA_NATURAL_EDIT_CHAT_WAIT_MS=60000$/m);
  assert.match(source, /^ENNOIA_TRIP_GENERATION_HASH=<tripAgentHash>$/m);
  assert.match(source, /^ENNOIA_TRIP_GENERATION_TIMEOUT_MS=60000$/m);
  assert.doesNotMatch(source, /llm-orchestrator\/chat\/stream\/1ff5980a3d/);
});

function restoreEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
