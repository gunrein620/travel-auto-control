import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

// 첫 진입 시드는 비어 있으므로, 일정 편집을 검증하는 테스트는 자체 픽스처 상태를 심는다.
const FIXTURE_ITEMS = [
  {
    id: "ddp",
    title: "DDP 전시 둘러보기",
    placeName: "동대문디자인플라자",
    address: "서울 중구 을지로 281",
    lat: 37.5661,
    lng: 127.0096,
    startsAt: "2026-05-30T15:00:00+09:00",
    endsAt: "2026-05-30T16:20:00+09:00",
    transportMode: "subway",
    travelMinutesBefore: 20,
    category: "indoor",
    memo: "전시 운영시간 확인",
    status: "unchecked"
  },
  {
    id: "forest",
    title: "서울숲 산책",
    placeName: "서울숲",
    address: "서울 성동구 뚝섬로 273",
    lat: 37.5446,
    lng: 127.0374,
    startsAt: "2026-05-30T17:00:00+09:00",
    endsAt: "2026-05-30T18:20:00+09:00",
    transportMode: "subway",
    travelMinutesBefore: 18,
    category: "outdoor",
    memo: "비 오면 실내 대안 필요",
    status: "unchecked"
  },
  {
    id: "dinner",
    title: "비빔밥 저녁",
    placeName: "전주비빔밥",
    address: "서울 중구",
    lat: 37.56,
    lng: 126.98,
    startsAt: "2026-05-30T19:00:00+09:00",
    endsAt: "2026-05-30T20:00:00+09:00",
    transportMode: "walk",
    travelMinutesBefore: 10,
    category: "meal",
    memo: "저녁 식사",
    status: "unchecked"
  }
];

const QA_FIXTURE_ITEMS = [
  {
    id: "temple",
    title: "해동용궁사 해안 사찰 탐방",
    placeName: "해동용궁사",
    address: "부산 기장군 기장읍 용궁길 86",
    lat: 35.1883,
    lng: 129.2232,
    startsAt: "2026-06-14T16:00:00+09:00",
    endsAt: "2026-06-14T17:20:00+09:00",
    transportMode: "bus",
    travelMinutesBefore: 35,
    category: "outdoor",
    memo: "해안 사찰 산책",
    status: "unchecked"
  },
  {
    id: "drone-show",
    title: "드론 라이트 쇼 관람",
    placeName: "해운대해수욕장",
    address: "부산 해운대구 우동",
    lat: 35.1587,
    lng: 129.1604,
    startsAt: "2026-06-14T20:35:00+09:00",
    endsAt: "2026-06-14T21:00:00+09:00",
    transportMode: "walk",
    travelMinutesBefore: 20,
    category: "outdoor",
    memo: "야간 드론 쇼",
    status: "unchecked"
  },
  {
    id: "lunch",
    title: "밀면 점심",
    placeName: "해운대밀면",
    address: "부산 해운대구 중동",
    lat: 35.1629,
    lng: 129.1635,
    startsAt: "2026-06-14T12:30:00+09:00",
    endsAt: "2026-06-14T13:20:00+09:00",
    transportMode: "walk",
    travelMinutesBefore: 10,
    category: "meal",
    memo: "점심 식사",
    status: "unchecked"
  }
];

async function writeFixtureState(stateFile) {
  const state = {
    plan: { id: "today", title: "서울 하루 여행", date: "2026-05-30", items: FIXTURE_ITEMS },
    notifications: [],
    inspectionHistory: [],
    pushSubscriptions: []
  };
  await writeFile(stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

async function writeQaFixtureState(stateFile) {
  const state = {
    plan: { id: "qa", title: "부산 2일차 여행", date: "2026-06-14", items: QA_FIXTURE_ITEMS },
    notifications: [],
    inspectionHistory: [],
    pushSubscriptions: []
  };
  await writeFile(stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

test("natural language edit apply mutates only the targeted schedule item", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "prompton-natural-edit-"));
  const stateFile = join(tempDir, "state.json");
  await writeFixtureState(stateFile);
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

test("natural language edit API keeps a session and uses prior turns for fallback drafts", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "prompton-natural-session-"));
  const stateFile = join(tempDir, "state.json");
  await writeFixtureState(stateFile);
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

    const firstTurn = await api(baseUrl, "/api/natural-edits", {
      method: "POST",
      body: { text: "저녁 바꿔줘" }
    });

    assert.match(firstTurn.sessionId, /^natural-/);
    assert.equal(firstTurn.draft.stage, "clarify");
    assert.equal(firstTurn.draft.domain, "meal");
    assert.equal(firstTurn.draft.needsClarification, true);
    assert.equal(firstTurn.draft.choices.some((choice) => choice.label === "한식"), true);
    assert.equal(firstTurn.conversation.messages.length, 2);

    const secondTurn = await api(baseUrl, "/api/natural-edits", {
      method: "POST",
      body: { sessionId: firstTurn.sessionId, text: "한식" }
    });

    assert.equal(secondTurn.sessionId, firstTurn.sessionId);
    assert.equal(secondTurn.draft.stage, "propose");
    assert.equal(secondTurn.draft.domain, "meal");
    assert.equal(secondTurn.draft.needsClarification, false);
    assert.equal(secondTurn.draft.targetItemId, "dinner");
    assert.equal(secondTurn.draft.patch.placeName, "근처 한식당");
    assert.equal(secondTurn.conversation.messages.length, 4);
    assert.equal(secondTurn.conversation.slots.cuisine, "한식");
  } finally {
    server.kill();
    await onceExit(server);
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("natural language edit API answers planner questions without creating a draft", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "prompton-natural-answer-"));
  const stateFile = join(tempDir, "state.json");
  await writeQaFixtureState(stateFile);
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

    const answer = await api(baseUrl, "/api/natural-edits", {
      method: "POST",
      body: { text: "드론 쇼는 몇시부터야?", activeDate: "2026-06-14" }
    });

    assert.equal(answer.draft, null);
    assert.equal(answer.reply.type, "answer");
    assert.match(answer.reply.text, /드론 라이트 쇼 관람/);
    assert.match(answer.reply.text, /20:35부터 21:00까지/);
    assert.match(answer.reply.text, /해운대해수욕장/);
    assert.equal(answer.conversation.messages.length, 2);
    assert.match(answer.conversation.messages.at(-1).text, /20:35/);

    const edit = await api(baseUrl, "/api/natural-edits", {
      method: "POST",
      body: { sessionId: answer.sessionId, text: "드론쇼 빼줘", activeDate: "2026-06-14" }
    });

    assert.equal(edit.reply, undefined);
    assert.equal(edit.draft.targetItemId, "drone-show");
    assert.equal(edit.draft.needsClarification, false);
    assert.equal(edit.draft.patch.title, "야간 여유 휴식");
  } finally {
    server.kill();
    await onceExit(server);
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("natural language edit API asks Ennoia before answering planner questions", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "prompton-natural-ennoia-answer-"));
  const stateFile = join(tempDir, "state.json");
  await writeQaFixtureState(stateFile);
  const ennoia = await startMockEnnoia(() => ({
    output: JSON.stringify({
      turnType: "answer",
      reply: { text: "LLM이 플래너를 보고 답했어요. 드론 쇼는 20:35부터예요." }
    })
  }));
  const { server, baseUrl } = await spawnPlannerServer(stateFile, {
    ENNOIA_NATURAL_EDIT_ENDPOINT: `${ennoia.url}/api/preset/v2/chat/completions`,
    ENNOIA_NATURAL_EDIT_HASH: "edit-agent-hash",
    ENNOIA_API_KEY: "secret-key",
    ENNOIA_NATURAL_EDIT_CHAT_WAIT_MS: "200"
  });

  try {
    const answer = await api(baseUrl, "/api/natural-edits", {
      method: "POST",
      body: { text: "드론 쇼는 몇시부터야?", activeDate: "2026-06-14" }
    });

    assert.equal(ennoia.requests.length, 1);
    assert.equal(ennoia.requests[0].hash, "edit-agent-hash");
    assert.equal(answer.draft, null);
    assert.equal(answer.reply.type, "answer");
    assert.equal(answer.reply.source, "ennoia");
    assert.match(answer.reply.text, /LLM이 플래너를 보고 답했어요/);
  } finally {
    server.kill();
    await onceExit(server);
    await closeServer(ennoia.server);
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("natural language edit API keeps an existing draft when a follow-up question is answered", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "prompton-natural-answer-keeps-draft-"));
  const stateFile = join(tempDir, "state.json");
  await writeFixtureState(stateFile);
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

    const draftTurn = await api(baseUrl, "/api/natural-edits", {
      method: "POST",
      body: { text: "저녁은 삼겹살로 바꿔줘" }
    });

    assert.equal(draftTurn.draft.targetItemId, "dinner");

    const answerTurn = await api(baseUrl, "/api/natural-edits", {
      method: "POST",
      body: { sessionId: draftTurn.sessionId, text: "저녁은 몇시야?" }
    });

    assert.equal(answerTurn.draft, null);
    assert.match(answerTurn.reply.text, /비빔밥 저녁/);
    assert.match(answerTurn.reply.text, /19:00부터 20:00까지/);
    assert.equal(answerTurn.conversation.draft.targetItemId, "dinner");
  } finally {
    server.kill();
    await onceExit(server);
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("natural language edit API answers place questions and asks plain clarification for unknown targets", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "prompton-natural-place-answer-"));
  const stateFile = join(tempDir, "state.json");
  await writeQaFixtureState(stateFile);
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

    const placeAnswer = await api(baseUrl, "/api/natural-edits", {
      method: "POST",
      body: { text: "점심 어디야?", activeDate: "2026-06-14" }
    });

    assert.equal(placeAnswer.draft, null);
    assert.equal(placeAnswer.reply.type, "answer");
    assert.match(placeAnswer.reply.text, /밀면 점심/);
    assert.match(placeAnswer.reply.text, /해운대밀면/);
    assert.match(placeAnswer.reply.text, /부산 해운대구 중동/);

    const unknownAnswer = await api(baseUrl, "/api/natural-edits", {
      method: "POST",
      body: { sessionId: placeAnswer.sessionId, text: "기념품 쇼핑은 어디야?", activeDate: "2026-06-14" }
    });

    assert.equal(unknownAnswer.draft, null);
    assert.equal(unknownAnswer.reply.type, "answer");
    assert.match(unknownAnswer.reply.text, /어떤 일정인지 조금만 더 알려주세요/);
    assert.doesNotMatch(unknownAnswer.reply.text, /무엇으로 바꿀까요/);
  } finally {
    server.kill();
    await onceExit(server);
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("natural language edit fallback handles negation without repeating the same meal question", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "prompton-natural-negation-"));
  const stateFile = join(tempDir, "state.json");
  await writeQaFixtureState(stateFile);
  const { server, baseUrl } = await spawnPlannerServer(stateFile);

  try {
    const firstTurn = await api(baseUrl, "/api/natural-edits", {
      method: "POST",
      body: { text: "점심 식사를 바꾸고 싶어", activeDate: "2026-06-14" }
    });

    assert.equal(firstTurn.draft.needsClarification, true);
    assert.equal(firstTurn.draft.domain, "meal");
    assert.equal(firstTurn.draft.targetItemId, "lunch");

    const secondTurn = await api(baseUrl, "/api/natural-edits", {
      method: "POST",
      body: {
        sessionId: firstTurn.sessionId,
        text: "아니 식사 말고",
        activeDate: "2026-06-14"
      }
    });

    assert.equal(secondTurn.draft.needsClarification, true);
    assert.notEqual(secondTurn.draft.domain, "meal");
    assert.doesNotMatch(secondTurn.draft.question, /밀면 점심을 무엇으로 바꿀까요/);
    assert.match(secondTurn.draft.question, /식사 말고|어떤 유형|관광|카페|휴식/);
    assert.equal(secondTurn.draft.choices.some((choice) => choice.label === "한식"), false);
  } finally {
    server.kill();
    await onceExit(server);
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("natural language edit fallback turns negated meal into attraction draft when user gives a concrete domain", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "prompton-natural-negation-attraction-"));
  const stateFile = join(tempDir, "state.json");
  await writeQaFixtureState(stateFile);
  const { server, baseUrl } = await spawnPlannerServer(stateFile);

  try {
    const firstTurn = await api(baseUrl, "/api/natural-edits", {
      method: "POST",
      body: { text: "점심 식사를 바꾸고 싶어", activeDate: "2026-06-14" }
    });

    const secondTurn = await api(baseUrl, "/api/natural-edits", {
      method: "POST",
      body: {
        sessionId: firstTurn.sessionId,
        text: "아니 식사 말고 실내 관광",
        activeDate: "2026-06-14"
      }
    });

    assert.equal(secondTurn.draft.needsClarification, false);
    assert.equal(secondTurn.draft.domain, "attraction");
    assert.match(secondTurn.draft.patch.title, /실내|박물관|관광|방문/);
    assert.doesNotMatch(secondTurn.draft.patch.title, /식사|점심|한식|중식|일식/);
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

test("natural language edit apply uses the selected recommendation patch", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "prompton-natural-recommendation-"));
  const stateFile = join(tempDir, "state.json");
  await writeFixtureState(stateFile);
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
    const dinner = before.plan.items.find((item) => item.id === "dinner");
    const applied = await api(baseUrl, "/api/natural-edits/apply", {
      method: "POST",
      body: {
        operation: "update",
        targetItemId: "dinner",
        selectedRecommendationId: "second-choice",
        patch: {
          title: "첫 후보 저녁",
          placeName: "첫 후보",
          category: "meal"
        },
        recommendations: [
          {
            id: "first-choice",
            name: "첫 후보",
            patch: {
              title: "첫 후보 저녁",
              placeName: "첫 후보",
              category: "meal"
            }
          },
          {
            id: "second-choice",
            name: "선택 후보",
            patch: {
              title: "선택 후보 저녁",
              placeName: "선택 후보",
              address: "서울 중구 선택로 2",
              lat: 37.562,
              lng: 126.982,
              startsAt: dinner.startsAt,
              endsAt: dinner.endsAt,
              transportMode: "walk",
              category: "meal",
              memo: "사용자가 추천 후보를 클릭해 선택"
            }
          }
        ]
      }
    });

    const target = applied.state.plan.items.find((item) => item.id === "dinner");
    assert.equal(applied.operation, "update");
    assert.equal(target.placeName, "선택 후보");
    assert.equal(target.address, "서울 중구 선택로 2");
    assert.equal(target.lat, 37.562);
    assert.equal(target.title, "선택 후보 저녁");
  } finally {
    server.kill();
    await onceExit(server);
    await rm(tempDir, { recursive: true, force: true });
  }
});

async function spawnPlannerServer(stateFile, envOverrides = {}) {
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
      KAKAO_REST_API_KEY: "",
      ...envOverrides
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  await waitForServer(server, port);
  return { server, baseUrl: `http://localhost:${port}` };
}

async function startMockEnnoia(payloadForRequest) {
  const requests = [];
  const server = createHttpServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const bodyText = Buffer.concat(chunks).toString("utf8");
    requests.push(bodyText ? JSON.parse(bodyText) : {});
    const payload = payloadForRequest(requests.at(-1), request);
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(payload));
  });
  await listen(server, 0);
  const address = server.address();
  return {
    server,
    requests,
    url: `http://localhost:${address.port}`
  };
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
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
    const server = createServer();
    server.once("error", reject);
    server.listen(0, () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}
