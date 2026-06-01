import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("natural language edit apply mutates only the targeted schedule item", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "prompton-natural-edit-"));
  const stateFile = join(tempDir, "state.json");
  const port = String(await getFreePort());
  const server = spawn(process.execPath, ["server/index.js"], {
    cwd: new URL("..", import.meta.url),
    env: {
      ...process.env,
      PORT: port,
      STATE_FILE: stateFile,
      LIVE_WEATHER: "0",
      ENNOIA_NATURAL_EDIT_ENDPOINT: "",
      ENNOIA_API_KEY: "",
      KTO_SERVICE_KEY: "",
      KAKAO_REST_API_KEY: ""
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  try {
    await waitForServer(server, port);
    const baseUrl = `http://localhost:${port}`;

    const before = await api(baseUrl, "/api/state");
    const draftResponse = await api(baseUrl, "/api/natural-edits", {
      method: "POST",
      body: { text: "아 지금 삼겹살이 더 먹고싶으니까 이따 저녁일정 바꾸고 플래너에 적용해줘" }
    });
    assert.equal(draftResponse.draft.targetItemId, "dinner");

    const beforeNonTargets = before.plan.items
      .filter((item) => item.id !== draftResponse.draft.targetItemId)
      .map((item) => JSON.stringify(item));

    const applied = await api(baseUrl, "/api/natural-edits/apply", {
      method: "POST",
      body: draftResponse.draft
    });
    const afterNonTargets = applied.state.plan.items
      .filter((item) => item.id !== draftResponse.draft.targetItemId)
      .map((item) => JSON.stringify(item));
    const target = applied.state.plan.items.find((item) => item.id === draftResponse.draft.targetItemId);

    assert.equal(target.title, "삼겹살 저녁");
    assert.equal(target.placeName, "근처 삼겹살 맛집");
    assert.deepEqual(afterNonTargets, beforeNonTargets);
    assert.deepEqual(applied.rechecked, []);
  } finally {
    server.kill();
    await onceExit(server);
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("natural language edit apply can add a single drafted schedule item", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "prompton-natural-add-"));
  const stateFile = join(tempDir, "state.json");
  const port = String(await getFreePort());
  const server = spawn(process.execPath, ["server/index.js"], {
    cwd: new URL("..", import.meta.url),
    env: {
      ...process.env,
      PORT: port,
      STATE_FILE: stateFile,
      LIVE_WEATHER: "0",
      ENNOIA_NATURAL_EDIT_ENDPOINT: "",
      ENNOIA_API_KEY: "",
      KTO_SERVICE_KEY: "",
      KAKAO_REST_API_KEY: ""
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  try {
    await waitForServer(server, port);
    const baseUrl = `http://localhost:${port}`;

    const before = await api(baseUrl, "/api/state");
    const applied = await api(baseUrl, "/api/natural-edits/apply", {
      method: "POST",
      body: {
        operation: "add",
        patch: {
          title: "신포 한식 점심",
          placeName: "신포 한식",
          address: "인천 중구 신포로 20",
          lat: 37.4729,
          lng: 126.623,
          startsAt: "2026-06-28T12:00:00+09:00",
          endsAt: "2026-06-28T13:00:00+09:00",
          transportMode: "walk",
          category: "meal",
          memo: "자연어 요청으로 추가"
        }
      }
    });

    assert.equal(applied.operation, "add");
    assert.equal(applied.state.plan.items.length, before.plan.items.length + 1);
    assert.equal(applied.item.placeName, "신포 한식");
    assert.ok(applied.state.plan.items.some((item) => item.id === applied.item.id));
  } finally {
    server.kill();
    await onceExit(server);
    await rm(tempDir, { recursive: true, force: true });
  }
});

async function api(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method || "GET",
    headers: options.body ? { "content-type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  if (!response.ok) throw new Error(`${path} failed with ${response.status}`);
  return response.json();
}

async function waitForServer(server, port) {
  let output = "";
  server.stdout.on("data", (chunk) => {
    output += chunk;
  });
  server.stderr.on("data", (chunk) => {
    output += chunk;
  });

  const deadline = Date.now() + 5000;
  while (!output.includes(`http://localhost:${port}`)) {
    if (server.exitCode !== null) throw new Error(`server exited early: ${output}`);
    if (Date.now() > deadline) throw new Error(`server did not start: ${output}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function onceExit(server) {
  if (server.exitCode !== null || server.signalCode !== null) return;
  await new Promise((resolve) => server.once("exit", resolve));
}

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}
