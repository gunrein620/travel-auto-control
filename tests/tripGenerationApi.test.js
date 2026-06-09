import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("trip generation API accepts one-line compressed date request and stores KTO event suggestions", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "prompton-trip-generation-"));
  const stateFile = join(tempDir, "state.json");
  const appPort = String(await getFreePort());
  const mockPort = String(await getFreePort());
  const mockServer = await startMockEnnoiaServer(Number(mockPort));
  const appServer = spawn(process.execPath, ["server/index.js"], {
    cwd: new URL("..", import.meta.url),
    env: {
      ...process.env,
      PORT: appPort,
      STATE_FILE: stateFile,
      LIVE_WEATHER: "0",
      ENNOIA_TRIP_GENERATION_ENDPOINT: `http://127.0.0.1:${mockPort}/api/preset/v2/chat/completions`,
      ENNOIA_TRIP_GENERATION_HASH: "agent-hash",
      ENNOIA_API_KEY: "test-key",
      ENNOIA_PROJECT_ID: "KNTO-PROMPTON-2026-544",
      KTO_SERVICE_KEY: "",
      KAKAO_REST_API_KEY: ""
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  try {
    await waitForServer(appServer, appPort);
    const generated = await api(`http://localhost:${appPort}`, "/api/trips/generate", {
      method: "POST",
      body: {
        requests: "6.23-25 부산 여행, KTO 행사정보까지 확인해서 축제나 행사도 제안해줘",
        referenceDate: "2026-06-03"
      }
    });

    assert.equal(generated.state.plan.region, "부산");
    assert.equal(generated.state.plan.startDate, "2026-06-23");
    assert.equal(generated.state.plan.endDate, "2026-06-25");
    assert.deepEqual(
      generated.state.plan.days.map((day) => day.date),
      ["2026-06-23", "2026-06-24", "2026-06-25"]
    );
    assert.equal(generated.state.plan.generation.eventSuggestions[0].title, "부산 바다 축제");
    assert.equal(generated.state.plan.generation.eventSuggestions[0].dateRange, "2026-06-23~2026-06-25");
    assert.ok(generated.state.plan.generation.apiStatus.some((status) => status.includes("KTO 행사정보 성공")));
    assert.equal(JSON.stringify(generated).includes("test-key"), false);
  } finally {
    appServer.kill();
    await onceExit(appServer);
    await new Promise((resolve) => mockServer.close(resolve));
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("trip generation API does not replace the current plan with an empty ambiguous-region result", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "prompton-trip-generation-empty-"));
  const stateFile = join(tempDir, "state.json");
  const appPort = String(await getFreePort());
  const appServer = spawn(process.execPath, ["server/index.js"], {
    cwd: new URL("..", import.meta.url),
    env: {
      ...process.env,
      PORT: appPort,
      STATE_FILE: stateFile,
      LIVE_WEATHER: "0",
      ENNOIA_TRIP_GENERATION_ENDPOINT: "",
      ENNOIA_TRIP_GENERATION_HASH: "",
      ENNOIA_API_KEY: "",
      KTO_SERVICE_KEY: "",
      KAKAO_REST_API_KEY: ""
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  try {
    await waitForServer(appServer, appPort);
    const before = await api(`http://localhost:${appPort}`, "/api/state");
    const response = await fetch(`http://localhost:${appPort}/api/trips/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        requests: "중앙공원 모호성",
        referenceDate: "2026-06-03"
      })
    });
    const payload = await response.json();
    const after = await api(`http://localhost:${appPort}`, "/api/state");

    assert.equal(response.status, 422);
    assert.match(payload.error, /지역|구체화|일정/);
    assert.equal(payload.generation.items.length, 0);
    assert.equal(after.plan.items.length, before.plan.items.length);
    assert.deepEqual(
      after.plan.items.map((item) => item.id),
      before.plan.items.map((item) => item.id)
    );
  } finally {
    appServer.kill();
    await onceExit(appServer);
    await rm(tempDir, { recursive: true, force: true });
  }
});

async function startMockEnnoiaServer(port) {
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    const parsed = JSON.parse(body || "{}");
    assert.equal(parsed.hash, "agent-hash");
    assert.match(parsed.messages?.[0]?.content?.[0]?.text || "", /6\.23-25 부산 여행/);
    assert.match(parsed.messages?.[0]?.content?.[0]?.text || "", /KTO 행사정보/);

    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(mockTripResponse()) } }] }));
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  return server;
}

function mockTripResponse() {
  return {
    title: "부산 자연어 행사 검토 여행",
    days: [
      {
        date: "2026-06-23",
        title: "1일차 해운대",
        theme: "한 줄 요청에서 날짜와 지역 해석",
        items: [
          tripItem("2026-06-23", "10:00", "11:20", "해운대해수욕장 산책", "해운대해수욕장", "outdoor"),
          tripItem("2026-06-23", "12:00", "13:10", "해운대 점심", "해운대암소갈비집", "meal"),
          tripItem("2026-06-23", "14:00", "15:20", "부산시립미술관 관람", "부산시립미술관", "indoor"),
          tripItem("2026-06-23", "17:40", "18:50", "해운대 저녁", "해운대암소갈비집", "meal")
        ]
      },
      {
        date: "2026-06-24",
        title: "2일차 중구",
        theme: "행사 후보와 중구 동선",
        items: [
          tripItem("2026-06-24", "10:00", "11:20", "감천문화마을 산책", "감천문화마을", "outdoor"),
          tripItem("2026-06-24", "12:10", "13:20", "자갈치시장 점심", "자갈치시장", "meal"),
          tripItem("2026-06-24", "14:00", "15:20", "부산근현대역사관 관람", "부산근현대역사관", "indoor"),
          tripItem("2026-06-24", "17:30", "18:40", "광복동 저녁", "개미집 본점", "meal")
        ]
      },
      {
        date: "2026-06-25",
        title: "3일차 마무리",
        theme: "귀가 전 짧은 산책",
        items: [
          tripItem("2026-06-25", "10:00", "11:00", "동백섬 산책", "동백섬", "outdoor"),
          tripItem("2026-06-25", "12:00", "13:10", "센텀 점심", "신세계백화점 센텀시티", "meal"),
          tripItem("2026-06-25", "14:00", "15:00", "부산시민공원 산책", "부산시민공원", "outdoor")
        ]
      }
    ],
    eventSuggestions: [
      {
        id: "evt-1",
        title: "부산 바다 축제",
        dateRange: "20260623~20260625",
        area: "부산 해운대구",
        reason: "한 줄 요청의 6.23-25 기간과 해운대 동선이 맞는 KTO 행사 후보"
      }
    ],
    evidence: ["한 줄 요청에서 날짜와 지역을 해석하고 KTO 행사 후보 검토"],
    warnings: ["행사 세부 시간과 예약 여부는 방문 전 재확인"],
    apiStatus: ["KTO 관광정보 성공", "KTO 행사정보 성공", "날씨 미사용", "Kakao 부분 성공"]
  };
}

function tripItem(date, start, end, title, placeName, category) {
  return {
    title,
    placeName,
    address: "부산 해운대구",
    lat: 35.1587,
    lng: 129.1604,
    startsAt: `${date}T${start}:00+09:00`,
    endsAt: `${date}T${end}:00+09:00`,
    transportMode: "car",
    travelMinutesBefore: 25,
    category,
    memo: "KTO 행사정보와 관광정보 후보 기준"
  };
}

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
    const server = createNetServer();
    server.once("error", reject);
    server.listen(0, () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}
