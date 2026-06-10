import assert from "node:assert/strict";
import test from "node:test";
import { draftNaturalLanguageEditWithEnnoia } from "../server/ennoiaNaturalEditService.js";

const items = [
  {
    id: "museum",
    title: "국립중앙박물관 관람",
    placeName: "국립중앙박물관",
    address: "서울 용산구 서빙고로 137",
    lat: 37.5238,
    lng: 126.9804,
    startsAt: "2026-05-30T14:00:00+09:00",
    endsAt: "2026-05-30T16:00:00+09:00",
    transportMode: "subway",
    travelMinutesBefore: 30,
    category: "indoor",
    memo: "전시 관람",
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

test("draftNaturalLanguageEditWithEnnoia returns an Ennoia answer turn without local fallback", async () => {
  const originalFetch = globalThis.fetch;
  const env = snapshotEnv([
    "ENNOIA_NATURAL_EDIT_ENDPOINT",
    "ENNOIA_NATURAL_EDIT_HASH",
    "ENNOIA_API_KEY",
    "ENNOIA_NATURAL_EDIT_CHAT_WAIT_MS",
    "KAKAO_REST_API_KEY"
  ]);

  process.env.ENNOIA_NATURAL_EDIT_ENDPOINT = "https://api.ennoia.test/api/preset/v2/chat/completions";
  process.env.ENNOIA_NATURAL_EDIT_HASH = "edit-agent-hash";
  process.env.ENNOIA_API_KEY = "secret-key";
  process.env.ENNOIA_NATURAL_EDIT_CHAT_WAIT_MS = "200";
  delete process.env.KAKAO_REST_API_KEY;

  globalThis.fetch = async () => ({
    ok: true,
    headers: { get: () => "application/json" },
    json: async () => ({
      output: JSON.stringify({
        turnType: "answer",
        reply: {
          text: "드론 라이트 쇼는 20:35부터 시작해요. 장소는 해운대해수욕장입니다."
        }
      })
    })
  });

  try {
    const result = await draftNaturalLanguageEditWithEnnoia("드론 쇼는 몇시부터야?", items, {
      activeDate: "2026-06-14",
      history: []
    });

    assert.equal(result.turnType, "answer");
    assert.equal(result.draft, null);
    assert.equal(result.reply.type, "answer");
    assert.equal(result.reply.source, "ennoia");
    assert.match(result.reply.text, /20:35/);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnvSnapshot(env);
  }
});

test("draftNaturalLanguageEditWithEnnoia explains missing MCP identity headers", async () => {
  const originalFetch = globalThis.fetch;
  const env = snapshotEnv([
    "ENNOIA_NATURAL_EDIT_ENDPOINT",
    "ENNOIA_NATURAL_EDIT_HASH",
    "ENNOIA_API_KEY",
    "ENNOIA_NATURAL_EDIT_CHAT_WAIT_MS",
    "KAKAO_REST_API_KEY"
  ]);

  process.env.ENNOIA_NATURAL_EDIT_ENDPOINT = "https://api.ennoia.test/api/preset/v2/chat/completions";
  process.env.ENNOIA_NATURAL_EDIT_HASH = "edit-agent-hash";
  process.env.ENNOIA_API_KEY = "secret-key";
  process.env.ENNOIA_NATURAL_EDIT_CHAT_WAIT_MS = "200";
  delete process.env.KAKAO_REST_API_KEY;

  globalThis.fetch = async () => ({
    ok: false,
    status: 400,
    text: async () =>
      JSON.stringify({
        error_type: "MCP_CONNECTION_REQUIRED",
        message:
          "MCP 호출을 위한 userId 전달을 위해 `X-ENNOIA-USER-ID` 또는 인증키 전달을 위한 `x-mcp-{serverName}-authorization` 헤더가 필요합니다."
      })
  });

  try {
    const result = await draftNaturalLanguageEditWithEnnoia("저녁 어디야?", items, {
      activeDate: "2026-05-30",
      history: []
    });

    assert.equal(result.turnType, "answer");
    assert.equal(result.reply.source, "fallback");
    assert.match(result.reply.modelStatus, /X-ENNOIA-USER-ID/);
    assert.match(result.reply.modelStatus, /x-mcp-\{serverAlias\}-authorization/);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnvSnapshot(env);
  }
});

test("draftNaturalLanguageEditWithEnnoia does not fast-abort a chat LLM response", async () => {
  const originalFetch = globalThis.fetch;
  const env = snapshotEnv([
    "ENNOIA_NATURAL_EDIT_ENDPOINT",
    "ENNOIA_NATURAL_EDIT_HASH",
    "ENNOIA_API_KEY",
    "ENNOIA_NATURAL_EDIT_CHAT_WAIT_MS",
    "KAKAO_REST_API_KEY"
  ]);

  process.env.ENNOIA_NATURAL_EDIT_ENDPOINT = "https://api.ennoia.test/api/preset/v2/chat/completions";
  process.env.ENNOIA_NATURAL_EDIT_HASH = "edit-agent-hash";
  process.env.ENNOIA_API_KEY = "secret-key";
  process.env.ENNOIA_NATURAL_EDIT_CHAT_WAIT_MS = "80";
  delete process.env.KAKAO_REST_API_KEY;

  globalThis.fetch = async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
    return {
      ok: true,
      headers: { get: () => "application/json" },
      json: async () => ({
        output: JSON.stringify({
          turnType: "answer",
          reply: { text: "현재 일정 기준으로 답변할게요." }
        })
      })
    };
  };

  try {
    const result = await draftNaturalLanguageEditWithEnnoia("드론 쇼는 몇시부터야?", items, {
      activeDate: "2026-06-14"
    });

    assert.equal(result.turnType, "answer");
    assert.equal(result.reply.source, "ennoia");
    assert.match(result.reply.text, /현재 일정 기준/);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnvSnapshot(env);
  }
});

test("draftNaturalLanguageEditWithEnnoia uses Ennoia JSON patches when configured", async () => {
  const originalFetch = globalThis.fetch;
  const originalEndpoint = process.env.ENNOIA_NATURAL_EDIT_ENDPOINT;
  const originalKey = process.env.ENNOIA_API_KEY;

  process.env.ENNOIA_NATURAL_EDIT_ENDPOINT = "https://api.ennoia.test/natural-edit";
  process.env.ENNOIA_API_KEY = "secret-key";

  globalThis.fetch = async (url, options) => {
    assert.equal(String(url), "https://api.ennoia.test/natural-edit");
    assert.equal(options.headers.apiKey, "secret-key");
    assert.equal(options.headers.project, "KNTO-PROMPTON-2026-544");
    const body = JSON.parse(options.body);
    assert.match(body.messages.at(-1).content[0].text, /현재 플래너 JSON/);
    return {
      ok: true,
      json: async () => ({
        output: JSON.stringify({
          targetItemId: "dinner",
          intent: "replace_meal",
          confidence: 0.92,
          patch: {
            title: "삼겹살 저녁",
            placeName: "성수 삼겹살",
            category: "meal",
            memo: "사용자 요청으로 삼겹살 중심 저녁 변경"
          },
          needsConfirmation: true,
          needsClarification: false,
          confirmationMessage: "비빔밥 저녁을 삼겹살 저녁으로 바꿀까요?"
        })
      })
    };
  };

  try {
    const draft = await draftNaturalLanguageEditWithEnnoia("저녁은 삼겹살로 바꿔줘", items);

    assert.equal(draft.source, "ennoia");
    assert.equal(draft.targetItemId, "dinner");
    assert.equal(draft.patch.title, "삼겹살 저녁");
    assert.equal(JSON.stringify(draft).includes("secret-key"), false);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv("ENNOIA_NATURAL_EDIT_ENDPOINT", originalEndpoint);
    restoreEnv("ENNOIA_API_KEY", originalKey);
  }
});

test("draftNaturalLanguageEditWithEnnoia treats edit_draft with reply metadata as a draft", async () => {
  const originalFetch = globalThis.fetch;
  const env = snapshotEnv(["ENNOIA_NATURAL_EDIT_ENDPOINT", "ENNOIA_API_KEY"]);

  process.env.ENNOIA_NATURAL_EDIT_ENDPOINT = "https://api.ennoia.test/natural-edit";
  process.env.ENNOIA_API_KEY = "secret-key";

  globalThis.fetch = async () => ({
    ok: true,
    headers: { get: () => "application/json" },
    json: async () => ({
      output: JSON.stringify({
        turnType: "edit_draft",
        reply: { text: "" },
        draft: {
          operation: "update",
          stage: "confirm",
          domain: "time",
          filledSlots: { startTime: "20:40", endTime: "21:40" },
          missingSlots: [],
          choices: [],
          targetItemId: "dinner",
          intent: "change_time",
          confidence: 0.99,
          patch: {
            startsAt: "2026-05-30T20:40:00+09:00",
            endsAt: "2026-05-30T21:40:00+09:00"
          },
          needsConfirmation: true,
          needsClarification: false,
          confirmationMessage: "비빔밥 저녁 일정을 20:40~21:40으로 변경할까요?"
        }
      })
    })
  });

  try {
    const draft = await draftNaturalLanguageEditWithEnnoia("저녁을 20시 40분으로 바꿔줘", items);

    assert.equal(draft.source, "ennoia");
    assert.equal(draft.domain, "time");
    assert.equal(draft.intent, "change_time");
    assert.equal(draft.targetItemId, "dinner");
    assert.equal(draft.patch.startsAt, "2026-05-30T20:40:00+09:00");
    assert.equal(draft.needsClarification, false);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnvSnapshot(env);
  }
});

test("draftNaturalLanguageEditWithEnnoia sends accumulated conversation messages and keeps slot fields", async () => {
  const originalFetch = globalThis.fetch;
  const env = snapshotEnv(["ENNOIA_NATURAL_EDIT_ENDPOINT", "ENNOIA_NATURAL_EDIT_HASH", "ENNOIA_API_KEY"]);

  process.env.ENNOIA_NATURAL_EDIT_ENDPOINT = "https://api.ennoia.test/api/preset/v2/chat/completions";
  process.env.ENNOIA_NATURAL_EDIT_HASH = "edit-agent-hash";
  process.env.ENNOIA_API_KEY = "secret-key";

  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    assert.equal(body.messages.length, 4);
    assert.match(body.messages[0].content[0].text, /도메인-슬롯/);
    assert.match(body.messages[0].content[0].text, /한국관광공사 MCP/);
    assert.equal(body.messages[1].role, "user");
    assert.equal(body.messages[1].content[0].text, "저녁 바꿔줘");
    assert.equal(body.messages[2].role, "assistant");
    assert.match(body.messages[2].content[0].text, /음식 종류/);
    assert.equal(body.messages[3].role, "user");
    assert.match(body.messages[3].content[0].text, /사용자 요청: 한식/);
    assert.match(body.messages[3].content[0].text, /현재 플래너 JSON/);

    return {
      ok: true,
      headers: { get: () => "application/json" },
      json: async () => ({
        output: JSON.stringify({
          operation: "update",
          targetItemId: "dinner",
          stage: "clarify",
          domain: "meal",
          filledSlots: { cuisine: "한식" },
          missingSlots: ["budget"],
          choices: [
            { id: "budget-2", label: "2만원대", value: "budget:20000" },
            { id: "budget-3", label: "3만원대", value: "budget:30000" }
          ],
          needsClarification: true,
          needsConfirmation: false,
          question: "예산대는 어느 정도가 좋을까요?",
          patch: {}
        })
      })
    };
  };

  try {
    const draft = await draftNaturalLanguageEditWithEnnoia("한식", items, {
      history: [
        { role: "user", text: "저녁 바꿔줘" },
        { role: "assistant", text: "음식 종류를 골라주세요." },
        { role: "user", text: "한식" }
      ],
      slots: { mealSlot: "dinner" }
    });

    assert.equal(draft.stage, "clarify");
    assert.equal(draft.domain, "meal");
    assert.deepEqual(draft.filledSlots, { cuisine: "한식" });
    assert.deepEqual(draft.missingSlots, ["budget"]);
    assert.equal(draft.choices.length, 2);
    assert.equal(draft.choices[0].label, "2만원대");
    assert.equal(draft.needsClarification, true);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnvSnapshot(env);
  }
});

test("draftNaturalLanguageEditWithEnnoia calls Ennoia preset edit agent with hash when configured", async () => {
  const originalFetch = globalThis.fetch;
  const env = snapshotEnv([
    "ENNOIA_NATURAL_EDIT_ENDPOINT",
    "ENNOIA_NATURAL_EDIT_HASH",
    "ENNOIA_AGENT_HASH",
    "ENNOIA_API_KEY",
    "ENNOIA_PROJECT_ID"
  ]);

  process.env.ENNOIA_NATURAL_EDIT_ENDPOINT = "https://api.ennoia.test/api/preset/v2/chat/completions";
  process.env.ENNOIA_NATURAL_EDIT_HASH = "edit-agent-hash";
  process.env.ENNOIA_API_KEY = "secret-key";
  process.env.ENNOIA_PROJECT_ID = "KNTO-PROMPTON-2026-544";

  globalThis.fetch = async (url, options) => {
    assert.equal(String(url), "https://api.ennoia.test/api/preset/v2/chat/completions");
    assert.equal(options.headers.apiKey, "secret-key");
    assert.equal(options.headers.project, "KNTO-PROMPTON-2026-544");

    const body = JSON.parse(options.body);
    assert.equal(body.hash, "edit-agent-hash");
    assert.deepEqual(body.params, {});
    assert.equal(body.multiAgentId, undefined);
    assert.match(body.messages[0].content[0].text, /연속 관람/);
    assert.match(body.messages[0].content[0].text, /day2/);
    assert.match(body.messages.at(-1).content[0].text, /현재 플래너 JSON/);
    assert.match(body.messages.at(-1).content[0].text, /operation/);
    assert.match(body.messages.at(-1).content[0].text, /사용자 요청: 이 위치는 송월만두로 바꿀래/);

    return {
      ok: true,
      headers: { get: () => "application/json" },
      json: async () => ({
        choices: [
          {
            message: {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    targetItemId: "dinner",
                    intent: "replace_meal",
                    confidence: 0.94,
                    patch: {
                      title: "한식 점심",
                      placeName: "송월만두",
                      category: "meal",
                      memo: "Kakao 후보 기반 대체 식사"
                    },
                    needsConfirmation: true,
                    needsClarification: false,
                    resolutionMessage: "송월만두 후보를 찾았습니다.",
                    confirmationMessage: "점심을 송월만두로 바꿀까요?"
                  })
                }
              ]
            }
          }
        ]
      })
    };
  };

  try {
    const draft = await draftNaturalLanguageEditWithEnnoia("이 위치는 송월만두로 바꿀래", items);

    assert.equal(draft.source, "ennoia");
    assert.equal(draft.targetItemId, "dinner");
    assert.equal(draft.patch.placeName, "송월만두");
    assert.equal(draft.resolutionMessage, "송월만두 후보를 찾았습니다.");
    assert.equal(JSON.stringify(draft).includes("secret-key"), false);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnvSnapshot(env);
  }
});

test("draftNaturalLanguageEditWithEnnoia forwards configured MCP identity headers", async () => {
  const originalFetch = globalThis.fetch;
  const env = snapshotEnv([
    "ENNOIA_NATURAL_EDIT_ENDPOINT",
    "ENNOIA_NATURAL_EDIT_HASH",
    "ENNOIA_API_KEY",
    "ENNOIA_NATURAL_EDIT_USER_ID",
    "ENNOIA_NATURAL_EDIT_MCP_AUTHORIZATION_HEADER",
    "ENNOIA_NATURAL_EDIT_MCP_AUTHORIZATION",
    "ENNOIA_MCP_KTO_AUTHORIZATION"
  ]);

  process.env.ENNOIA_NATURAL_EDIT_ENDPOINT = "https://api.ennoia.test/api/preset/v2/chat/completions";
  process.env.ENNOIA_NATURAL_EDIT_HASH = "edit-agent-hash";
  process.env.ENNOIA_API_KEY = "secret-key";
  process.env.ENNOIA_NATURAL_EDIT_USER_ID = "ennoia-user-123";
  process.env.ENNOIA_NATURAL_EDIT_MCP_AUTHORIZATION_HEADER = "x-mcp-korea-tourism-authorization";
  process.env.ENNOIA_NATURAL_EDIT_MCP_AUTHORIZATION = "Bearer mcp-token";
  process.env.ENNOIA_MCP_KTO_AUTHORIZATION = "Bearer kto-token";

  globalThis.fetch = async (_url, options) => {
    assert.equal(options.headers["X-ENNOIA-USER-ID"], "ennoia-user-123");
    assert.equal(options.headers["x-mcp-korea-tourism-authorization"], "Bearer mcp-token");
    assert.equal(options.headers["x-mcp-kto-authorization"], "Bearer kto-token");
    return {
      ok: true,
      headers: { get: () => "application/json" },
      json: async () => ({
        output: JSON.stringify({
          operation: "update",
          targetItemId: "dinner",
          intent: "replace_meal",
          confidence: 0.9,
          patch: { title: "한식 저녁", placeName: "한식당", category: "meal" },
          needsConfirmation: true,
          needsClarification: false,
          confirmationMessage: "저녁을 한식당으로 바꿀까요?"
        })
      })
    };
  };

  try {
    const draft = await draftNaturalLanguageEditWithEnnoia("저녁을 한식으로 바꿔줘", items);

    assert.equal(draft.source, "ennoia");
    assert.equal(JSON.stringify(draft).includes("mcp-token"), false);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnvSnapshot(env);
  }
});

test("draftNaturalLanguageEditWithEnnoia labels MCP connection failures and keeps agent drafts", async () => {
  const originalFetch = globalThis.fetch;
  const env = snapshotEnv([
    "ENNOIA_NATURAL_EDIT_ENDPOINT",
    "ENNOIA_NATURAL_EDIT_HASH",
    "ENNOIA_API_KEY",
    "KAKAO_REST_API_KEY"
  ]);

  process.env.ENNOIA_NATURAL_EDIT_ENDPOINT = "https://api.ennoia.test/api/preset/v2/chat/completions";
  process.env.ENNOIA_NATURAL_EDIT_HASH = "edit-agent-hash";
  process.env.ENNOIA_API_KEY = "secret-key";
  delete process.env.KAKAO_REST_API_KEY;

  const festivalItems = [
    ...items,
    {
      id: "d2-dinner",
      title: "웨스턴돔 저녁",
      placeName: "웨스턴돔",
      address: "경기 고양시 일산동구 정발산로 24",
      lat: 37.6553,
      lng: 126.7728,
      startsAt: "2026-06-14T17:30:00+09:00",
      endsAt: "2026-06-14T18:40:00+09:00",
      transportMode: "walk",
      travelMinutesBefore: 10,
      category: "meal",
      memo: "식사 선택지가 많은 권역"
    },
    {
      id: "d2-drone",
      title: "행주 드론불꽃쇼 관람",
      placeName: "행주산성역사공원",
      address: "경기 고양시 덕양구 행주로15번길 89",
      lat: 37.6009,
      lng: 126.8253,
      startsAt: "2026-06-14T20:20:00+09:00",
      endsAt: "2026-06-14T21:10:00+09:00",
      transportMode: "walk",
      travelMinutesBefore: 20,
      category: "outdoor",
      memo: "고양행주문화제 야간 대표 프로그램, 20:35경 시작"
    }
  ];

  globalThis.fetch = async () => ({
    ok: false,
    status: 400,
    text: async () =>
      JSON.stringify({
        error_code: 40065,
        error_type: "MCP_CONNECTION_REQUIRED",
        message: "MCP connection missing or expired for: 한국관광공사 MCP"
      })
  });

  try {
    const draft = await draftNaturalLanguageEditWithEnnoia("나 day2 에도 연속해서 드론쇼를 보고싶지는 않아", festivalItems, {
      activeDate: "2026-06-14"
    });

    assert.equal(draft.source, "agent");
    assert.equal(draft.targetItemId, "d2-drone");
    assert.equal(draft.needsClarification, false);
    assert.equal(draft.patch.title, "야간 여유 휴식");
    assert.match(draft.modelStatus, /MCP 연결 필요/);
    assert.match(draft.modelStatus, /한국관광공사 MCP 연결 누락\/만료/);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnvSnapshot(env);
  }
});

test("draftNaturalLanguageEditWithEnnoia does not let prior answer questions pollute fallback edit choices", async () => {
  const originalFetch = globalThis.fetch;
  const env = snapshotEnv([
    "ENNOIA_NATURAL_EDIT_ENDPOINT",
    "ENNOIA_NATURAL_EDIT_HASH",
    "ENNOIA_API_KEY",
    "KAKAO_REST_API_KEY"
  ]);

  process.env.ENNOIA_NATURAL_EDIT_ENDPOINT = "https://api.ennoia.test/api/preset/v2/chat/completions";
  process.env.ENNOIA_NATURAL_EDIT_HASH = "edit-agent-hash";
  process.env.ENNOIA_API_KEY = "secret-key";
  delete process.env.KAKAO_REST_API_KEY;

  const festivalItems = [
    {
      id: "d2-lunch",
      title: "원당역 인근 점심",
      placeName: "원당역",
      address: "경기 고양시 덕양구 고양대로 1429",
      lat: 37.6531,
      lng: 126.8422,
      startsAt: "2026-06-14T12:20:00+09:00",
      endsAt: "2026-06-14T13:20:00+09:00",
      transportMode: "walk",
      travelMinutesBefore: 10,
      category: "meal",
      memo: "역 주변 식당 다수"
    },
    {
      id: "d2-drone",
      title: "행주 드론불꽃쇼 관람",
      placeName: "행주산성역사공원",
      address: "경기 고양시 덕양구 행주로15번길 89",
      lat: 37.6009,
      lng: 126.8253,
      startsAt: "2026-06-14T20:20:00+09:00",
      endsAt: "2026-06-14T21:10:00+09:00",
      transportMode: "walk",
      travelMinutesBefore: 20,
      category: "outdoor",
      memo: "고양행주문화제 야간 대표 프로그램, 20:35경 시작"
    }
  ];

  globalThis.fetch = async () => ({
    ok: false,
    status: 400,
    text: async () =>
      JSON.stringify({
        error_type: "MCP_CONNECTION_REQUIRED",
        message: "MCP connection missing or expired for: 한국관광공사 MCP"
      })
  });

  try {
    const draft = await draftNaturalLanguageEditWithEnnoia("점심 식사를 바꾸고 싶어", festivalItems, {
      activeDate: "2026-06-14",
      history: [{ role: "user", text: "드론 쇼는 몇시부터야?" }]
    });

    assert.equal(draft.source, "fallback");
    assert.equal(draft.targetItemId, "d2-lunch");
    assert.equal(draft.domain, "meal");
    assert.equal(draft.choices.some((choice) => choice.label === "한식"), true);
    assert.equal(draft.choices.some((choice) => choice.label === "실내"), false);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnvSnapshot(env);
  }
});

test("draftNaturalLanguageEditWithEnnoia rejects unsafe target ids and asks a clarification", async () => {
  const originalFetch = globalThis.fetch;
  const originalEndpoint = process.env.ENNOIA_NATURAL_EDIT_ENDPOINT;
  const originalKey = process.env.ENNOIA_API_KEY;

  process.env.ENNOIA_NATURAL_EDIT_ENDPOINT = "https://api.ennoia.test/natural-edit";
  process.env.ENNOIA_API_KEY = "secret-key";

  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      output: JSON.stringify({
        targetItemId: "not-in-plan",
        patch: { title: "삭제", placeName: "알 수 없음" },
        needsConfirmation: true,
        needsClarification: false
      })
    })
  });

  try {
    const draft = await draftNaturalLanguageEditWithEnnoia("일정 바꿔줘", items);

    assert.equal(draft.needsClarification, true);
    assert.equal(draft.patch && Object.keys(draft.patch).length, 0);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv("ENNOIA_NATURAL_EDIT_ENDPOINT", originalEndpoint);
    restoreEnv("ENNOIA_API_KEY", originalKey);
  }
});

test("draftNaturalLanguageEditWithEnnoia sanitizes recommendations and limits them to five", async () => {
  const originalFetch = globalThis.fetch;
  const originalEndpoint = process.env.ENNOIA_NATURAL_EDIT_ENDPOINT;
  const originalKey = process.env.ENNOIA_API_KEY;

  process.env.ENNOIA_NATURAL_EDIT_ENDPOINT = "https://api.ennoia.test/natural-edit";
  process.env.ENNOIA_API_KEY = "secret-key";

  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      output: JSON.stringify({
        targetItemId: "dinner",
        operation: "update",
        intent: "replace_meal",
        confidence: 0.88,
        patch: {
          title: "첫 후보 저녁",
          placeName: "첫 후보",
          category: "meal"
        },
        recommendations: Array.from({ length: 6 }, (_, index) => ({
          id: `rec-${index + 1}`,
          name: `${index + 1}번 후보`,
          address: `서울 중구 ${index + 1}`,
          distanceLabel: `${index + 1}00m`,
          source: "ennoia",
          reason: "Ennoia 후보",
          patch: {
            title: `${index + 1}번 후보 저녁`,
            placeName: `${index + 1}번 후보`,
            address: `서울 중구 ${index + 1}`,
            lat: 37.56 + index / 1000,
            lng: 126.98 + index / 1000,
            category: "meal",
            unsafeField: "drop-me"
          }
        })),
        needsConfirmation: true,
        needsClarification: false
      })
    })
  });

  try {
    const draft = await draftNaturalLanguageEditWithEnnoia("저녁 후보 추천해줘", items);

    assert.equal(draft.recommendations.length, 5);
    assert.equal(draft.recommendations[0].id, "rec-1");
    assert.equal(draft.recommendations[4].id, "rec-5");
    assert.equal(draft.recommendations[0].patch.placeName, "1번 후보");
    assert.equal(draft.recommendations[0].patch.unsafeField, undefined);
    assert.deepEqual(draft.patch, draft.recommendations[0].patch);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv("ENNOIA_NATURAL_EDIT_ENDPOINT", originalEndpoint);
    restoreEnv("ENNOIA_API_KEY", originalKey);
  }
});

test("draftNaturalLanguageEditWithEnnoia converts alternatives into clickable recommendations", async () => {
  const originalFetch = globalThis.fetch;
  const originalEndpoint = process.env.ENNOIA_NATURAL_EDIT_ENDPOINT;
  const originalKey = process.env.ENNOIA_API_KEY;

  process.env.ENNOIA_NATURAL_EDIT_ENDPOINT = "https://api.ennoia.test/natural-edit";
  process.env.ENNOIA_API_KEY = "secret-key";

  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      output: JSON.stringify({
        targetItemId: "dinner",
        operation: "update",
        intent: "replace_meal",
        confidence: 0.82,
        patch: {
          title: "조개공장 저녁",
          placeName: "조개공장",
          address: "강원 강릉시 해안로 280",
          lat: 37.79,
          lng: 128.91,
          category: "meal"
        },
        alternatives: [
          {
            name: "경성조개포차",
            address: "강원 강릉시 해안로 280",
            distanceLabel: "250m",
            lat: 37.791,
            lng: 128.912
          },
          {
            name: "다이닝조개 본점",
            address: "강원 강릉시 해안로 280",
            distanceLabel: "420m",
            lat: 37.792,
            lng: 128.913
          }
        ],
        needsConfirmation: true,
        needsClarification: false
      })
    })
  });

  try {
    const draft = await draftNaturalLanguageEditWithEnnoia("저녁 조개구이 후보로 바꿔줘", items);

    assert.equal(draft.recommendations.length, 2);
    assert.equal(draft.recommendations[0].name, "경성조개포차");
    assert.equal(draft.recommendations[0].patch.placeName, "경성조개포차");
    assert.equal(draft.recommendations[0].patch.startsAt, items[1].startsAt);
    assert.equal(draft.recommendations[1].patch.placeName, "다이닝조개 본점");
    assert.deepEqual(draft.patch, draft.recommendations[0].patch);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv("ENNOIA_NATURAL_EDIT_ENDPOINT", originalEndpoint);
    restoreEnv("ENNOIA_API_KEY", originalKey);
  }
});

test("draftNaturalLanguageEditWithEnnoia rescues clear edits when Ennoia asks for clarification", async () => {
  const originalFetch = globalThis.fetch;
  const env = snapshotEnv([
    "ENNOIA_NATURAL_EDIT_ENDPOINT",
    "ENNOIA_NATURAL_EDIT_HASH",
    "ENNOIA_API_KEY",
    "KAKAO_REST_API_KEY"
  ]);

  process.env.ENNOIA_NATURAL_EDIT_ENDPOINT = "https://api.ennoia.test/natural-edit";
  process.env.ENNOIA_NATURAL_EDIT_HASH = "edit-agent-hash";
  process.env.ENNOIA_API_KEY = "secret-key";
  delete process.env.KAKAO_REST_API_KEY;

  globalThis.fetch = async () => ({
    ok: true,
    headers: { get: () => "application/json" },
    json: async () => ({
      output: JSON.stringify({
        operation: "update",
        intent: "other",
        confidence: 0.2,
        patch: {},
        needsConfirmation: false,
        needsClarification: true,
        question: "어떤 일정을 바꿀까요?"
      })
    })
  });

  try {
    const draft = await draftNaturalLanguageEditWithEnnoia("첫날 저녁 비빔밥을 한식 다른 식당으로 바꿀래", items);

    assert.equal(draft.source, "fallback");
    assert.equal(draft.targetItemId, "dinner");
    assert.equal(draft.needsClarification, false);
    assert.equal(draft.patch.placeName, "근처 한식당");
    assert.match(draft.modelStatus, /Ennoia LLM이 수정 대상을 특정하지 못함/);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnvSnapshot(env);
  }
});

test("draftNaturalLanguageEditWithEnnoia rescues far Ennoia add candidates with nearby agent search", async () => {
  const originalFetch = globalThis.fetch;
  const env = snapshotEnv([
    "ENNOIA_NATURAL_EDIT_ENDPOINT",
    "ENNOIA_NATURAL_EDIT_HASH",
    "ENNOIA_API_KEY",
    "KAKAO_REST_API_KEY"
  ]);

  process.env.ENNOIA_NATURAL_EDIT_ENDPOINT = "https://api.ennoia.test/natural-edit";
  process.env.ENNOIA_NATURAL_EDIT_HASH = "edit-agent-hash";
  process.env.ENNOIA_API_KEY = "secret-key";
  process.env.KAKAO_REST_API_KEY = "kakao-key";

  let kakaoRequestUrl;
  globalThis.fetch = async (url) => {
    const urlText = String(url);
    if (urlText.includes("api.ennoia.test")) {
      return {
        ok: true,
        headers: { get: () => "application/json" },
        json: async () => ({
          output: JSON.stringify({
            operation: "add",
            intent: "other",
            confidence: 0.76,
            patch: {
              title: "먼 지역 카페",
              placeName: "먼카페",
              address: "서울 다른 지역",
              lat: 37.12,
              lng: 127.42,
              startsAt: "2026-05-30T20:20:00+09:00",
              endsAt: "2026-05-30T21:20:00+09:00",
              transportMode: "taxi",
              travelMinutesBefore: 30,
              category: "indoor",
              memo: "다른 지역 후보라 확인 필요"
            },
            needsConfirmation: true,
            needsClarification: false,
            resolutionMessage: "근처가 아닌 서울 다른 지역 카페라 확인이 필요합니다.",
            confirmationMessage: "먼 지역 카페를 추가할까요?"
          })
        })
      };
    }

    if (urlText.includes("dapi.kakao.com")) {
      kakaoRequestUrl = new URL(urlText);
      return {
        ok: true,
        json: async () => ({
          documents: [
            {
              id: "nearby-cafe",
              place_name: "근처좋은카페",
              road_address_name: "서울 중구 가까운길 1",
              x: "126.981",
              y: "37.561",
              distance: "120",
              place_url: "https://place.example/nearby-cafe",
              category_group_name: "카페",
              category_name: "음식점 > 카페"
            }
          ]
        })
      };
    }

    throw new Error(`unexpected fetch ${urlText}`);
  };

  try {
    const draft = await draftNaturalLanguageEditWithEnnoia(
      "첫날 마지막 일정 뒤에 분위기 좋은 카페 하나 추천해서 추가해줘",
      items,
      { mode: "add_or_update", activeDate: "2026-05-30" }
    );

    assert.equal(draft.source, "agent");
    assert.equal(draft.operation, "add");
    assert.equal(draft.patch.placeName, "근처좋은카페");
    assert.equal(kakaoRequestUrl.searchParams.get("query"), "카페");
    assert.match(draft.modelStatus, /후보 위치 보정/);
    assert.doesNotMatch(draft.modelStatus, /시간 초과/);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnvSnapshot(env);
  }
});

test("draftNaturalLanguageEditWithEnnoia rescues vague Ennoia place additions with concrete nearby candidates", async () => {
  const originalFetch = globalThis.fetch;
  const env = snapshotEnv([
    "ENNOIA_NATURAL_EDIT_ENDPOINT",
    "ENNOIA_NATURAL_EDIT_HASH",
    "ENNOIA_API_KEY",
    "KAKAO_REST_API_KEY"
  ]);

  process.env.ENNOIA_NATURAL_EDIT_ENDPOINT = "https://api.ennoia.test/natural-edit";
  process.env.ENNOIA_NATURAL_EDIT_HASH = "edit-agent-hash";
  process.env.ENNOIA_API_KEY = "secret-key";
  process.env.KAKAO_REST_API_KEY = "kakao-key";

  globalThis.fetch = async (url) => {
    const urlText = String(url);
    if (urlText.includes("api.ennoia.test")) {
      return {
        ok: true,
        headers: { get: () => "application/json" },
        json: async () => ({
          output: JSON.stringify({
            operation: "add",
            intent: "other",
            confidence: 0.8,
            patch: {
              title: "카페 타임",
              placeName: "카페 (현장 선택)",
              startsAt: "2026-05-30T20:20:00+09:00",
              endsAt: "2026-05-30T21:20:00+09:00",
              category: "indoor",
              memo: "분위기 좋은 카페를 현장에서 선택"
            },
            alternatives: [],
            needsConfirmation: true,
            needsClarification: false,
            confirmationMessage: "분위기 좋은 카페 일정을 추가할까요?"
          })
        })
      };
    }

    if (urlText.includes("dapi.kakao.com")) {
      return {
        ok: true,
        json: async () => ({
          documents: [
            {
              id: "concrete-cafe",
              place_name: "구체적인카페",
              road_address_name: "서울 중구 가까운길 2",
              x: "126.982",
              y: "37.562",
              distance: "180",
              place_url: "https://place.example/concrete-cafe",
              category_group_name: "카페",
              category_name: "음식점 > 카페"
            }
          ]
        })
      };
    }

    throw new Error(`unexpected fetch ${urlText}`);
  };

  try {
    const draft = await draftNaturalLanguageEditWithEnnoia(
      "첫날 마지막 일정 뒤에 분위기 좋은 카페 하나 추천해서 추가해줘",
      items,
      { mode: "add_or_update", activeDate: "2026-05-30" }
    );

    assert.equal(draft.source, "agent");
    assert.equal(draft.patch.placeName, "구체적인카페");
    assert.equal(draft.patch.lat, 37.562);
    assert.match(draft.modelStatus, /후보 위치 보정/);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnvSnapshot(env);
  }
});

test("draftNaturalLanguageEditWithEnnoia keeps clarification when neither Ennoia nor fallback can identify the edit", async () => {
  const originalFetch = globalThis.fetch;
  const env = snapshotEnv(["ENNOIA_NATURAL_EDIT_ENDPOINT", "ENNOIA_API_KEY", "KAKAO_REST_API_KEY"]);

  process.env.ENNOIA_NATURAL_EDIT_ENDPOINT = "https://api.ennoia.test/natural-edit";
  process.env.ENNOIA_API_KEY = "secret-key";
  delete process.env.KAKAO_REST_API_KEY;

  globalThis.fetch = async () => ({
    ok: true,
    headers: { get: () => "application/json" },
    json: async () => ({
      output: JSON.stringify({
        operation: "update",
        patch: {},
        needsConfirmation: false,
        needsClarification: true,
        question: "어떤 일정을 바꿀까요?"
      })
    })
  });

  try {
    const draft = await draftNaturalLanguageEditWithEnnoia("일정 좀 바꿔줘", items);

    assert.equal(draft.source, "ennoia");
    assert.equal(draft.needsClarification, true);
    assert.equal(draft.patch && Object.keys(draft.patch).length, 0);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnvSnapshot(env);
  }
});

test("draftNaturalLanguageEditWithEnnoia rescues generic Ennoia clarification with a targeted local question", async () => {
  const originalFetch = globalThis.fetch;
  const env = snapshotEnv(["ENNOIA_NATURAL_EDIT_ENDPOINT", "ENNOIA_API_KEY", "KAKAO_REST_API_KEY"]);

  process.env.ENNOIA_NATURAL_EDIT_ENDPOINT = "https://api.ennoia.test/natural-edit";
  process.env.ENNOIA_API_KEY = "secret-key";
  delete process.env.KAKAO_REST_API_KEY;

  globalThis.fetch = async () => ({
    ok: true,
    headers: { get: () => "application/json" },
    json: async () => ({
      output: JSON.stringify({
        operation: "update",
        patch: {},
        needsConfirmation: false,
        needsClarification: true,
        question: "어떤 일정을 바꿀까요?"
      })
    })
  });

  try {
    const draft = await draftNaturalLanguageEditWithEnnoia("저녁 일정 바꾸고 싶어", items, {
      activeDate: "2026-05-30"
    });

    assert.equal(draft.source, "agent");
    assert.equal(draft.modelStatus, "일정수정 에이전트 대상 보정");
    assert.equal(draft.needsClarification, true);
    assert.equal(draft.targetItemId, "dinner");
    assert.match(draft.question, /비빔밥 저녁을 무엇으로/);
    assert.equal(draft.domain, "meal");
    assert.equal(draft.choices.some((choice) => choice.label === "한식"), true);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnvSnapshot(env);
  }
});

test("draftNaturalLanguageEditWithEnnoia rescues Ennoia clarification into a time change draft", async () => {
  const originalFetch = globalThis.fetch;
  const env = snapshotEnv(["ENNOIA_NATURAL_EDIT_ENDPOINT", "ENNOIA_API_KEY", "KAKAO_REST_API_KEY"]);

  process.env.ENNOIA_NATURAL_EDIT_ENDPOINT = "https://api.ennoia.test/natural-edit";
  process.env.ENNOIA_API_KEY = "secret-key";
  delete process.env.KAKAO_REST_API_KEY;

  const festivalItems = [
    ...items,
    {
      id: "drone-show",
      title: "행주 드론불꽃쇼 관람",
      placeName: "행주산성역사공원",
      address: "경기도 고양시 덕양구 행주외동",
      lat: 37.6006,
      lng: 126.8247,
      startsAt: "2026-06-14T20:20:00+09:00",
      endsAt: "2026-06-14T21:10:00+09:00",
      transportMode: "walk",
      travelMinutesBefore: 20,
      category: "festival",
      memo: "드론불꽃쇼",
      status: "unchecked"
    }
  ];

  globalThis.fetch = async () => ({
    ok: true,
    headers: { get: () => "application/json" },
    json: async () => ({
      output: JSON.stringify({
        operation: "update",
        patch: {},
        needsConfirmation: false,
        needsClarification: true,
        question: "어떤 일정을 바꿀까요?"
      })
    })
  });

  try {
    const draft = await draftNaturalLanguageEditWithEnnoia("6월 14일 드론쇼 시작 시간을 20시 40분으로 바꿔줘", festivalItems, {
      activeDate: "2026-06-14"
    });

    assert.equal(draft.needsClarification, false);
    assert.equal(draft.domain, "time");
    assert.equal(draft.intent, "change_time");
    assert.equal(draft.targetItemId, "drone-show");
    assert.equal(draft.patch.startsAt, "2026-06-14T20:40:00+09:00");
    assert.equal(draft.patch.endsAt, "2026-06-14T21:30:00+09:00");
    assert.doesNotMatch(draft.question || "", /음식|장소|무엇으로/);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnvSnapshot(env);
  }
});

test("draftNaturalLanguageEditWithEnnoia returns a local draft after the chat wait budget", async () => {
  const originalFetch = globalThis.fetch;
  const env = snapshotEnv([
    "ENNOIA_NATURAL_EDIT_ENDPOINT",
    "ENNOIA_NATURAL_EDIT_TIMEOUT_MS",
    "ENNOIA_NATURAL_EDIT_CHAT_WAIT_MS",
    "ENNOIA_API_KEY",
    "KAKAO_REST_API_KEY"
  ]);

  process.env.ENNOIA_NATURAL_EDIT_ENDPOINT = "https://api.ennoia.test/natural-edit";
  process.env.ENNOIA_NATURAL_EDIT_TIMEOUT_MS = "250";
  process.env.ENNOIA_NATURAL_EDIT_CHAT_WAIT_MS = "20";
  process.env.ENNOIA_API_KEY = "secret-key";
  delete process.env.KAKAO_REST_API_KEY;

  let aborted = false;
  globalThis.fetch = async (_url, options) => {
    assert.ok(options.signal);
    return new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => {
        aborted = true;
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      });
    });
  };

  try {
    const startedAt = performance.now();
    const draft = await Promise.race([
      draftNaturalLanguageEditWithEnnoia("저녁은 삼겹살로 바꿔줘", items),
      new Promise((_, reject) => setTimeout(() => reject(new Error("natural edit chat wait budget exceeded")), 120))
    ]);

    assert.equal(draft.source, "fallback");
    assert.equal(draft.targetItemId, "dinner");
    assert.equal(draft.patch.placeName, "근처 삼겹살 맛집");
    assert.match(draft.modelStatus, /응답 대기\(20ms\) 초과/);
    assert.equal(aborted, true);
    assert.ok(performance.now() - startedAt < 120);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnvSnapshot(env);
  }
});

test("draftNaturalLanguageEditWithEnnoia falls back when Ennoia takes too long", async () => {
  const originalFetch = globalThis.fetch;
  const env = snapshotEnv([
    "ENNOIA_NATURAL_EDIT_ENDPOINT",
    "ENNOIA_NATURAL_EDIT_TIMEOUT_MS",
    "ENNOIA_API_KEY",
    "KAKAO_REST_API_KEY"
  ]);

  process.env.ENNOIA_NATURAL_EDIT_ENDPOINT = "https://api.ennoia.test/natural-edit";
  process.env.ENNOIA_NATURAL_EDIT_TIMEOUT_MS = "5";
  process.env.ENNOIA_API_KEY = "secret-key";
  delete process.env.KAKAO_REST_API_KEY;

  globalThis.fetch = async (_url, options) => {
    assert.ok(options.signal);
    return new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      });
    });
  };

  try {
    const draft = await draftNaturalLanguageEditWithEnnoia("저녁은 삼겹살로 바꿔줘", items);

    assert.equal(draft.source, "fallback");
    assert.equal(draft.targetItemId, "dinner");
    assert.equal(draft.needsClarification, false);
    assert.equal(draft.patch.placeName, "근처 삼겹살 맛집");
    assert.match(draft.modelStatus, /시간 초과/);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnvSnapshot(env);
  }
});

test("draftNaturalLanguageEditWithEnnoia keeps fast Ennoia results when they win the race", async () => {
  const originalFetch = globalThis.fetch;
  const env = snapshotEnv([
    "ENNOIA_NATURAL_EDIT_ENDPOINT",
    "ENNOIA_API_KEY",
    "KAKAO_REST_API_KEY"
  ]);

  process.env.ENNOIA_NATURAL_EDIT_ENDPOINT = "https://api.ennoia.test/natural-edit";
  process.env.ENNOIA_API_KEY = "secret-key";
  delete process.env.KAKAO_REST_API_KEY;

  globalThis.fetch = async () => ({
    ok: true,
    headers: { get: () => "application/json" },
    json: async () => ({
      output: JSON.stringify({
        targetItemId: "dinner",
        intent: "replace_meal",
        confidence: 0.9,
        patch: {
          title: "몽탄 저녁",
          placeName: "몽탄",
          category: "meal"
        },
        needsConfirmation: true,
        needsClarification: false,
        confirmationMessage: "저녁을 몽탄으로 바꿀까요?"
      })
    })
  });

  try {
    const draft = await draftNaturalLanguageEditWithEnnoia("저녁을 몽탄으로", items);

    assert.equal(draft.source, "ennoia");
    assert.equal(draft.targetItemId, "dinner");
    assert.equal(draft.patch.placeName, "몽탄");
    assert.equal(draft.modelStatus, "Ennoia LLM 자연어 수정 초안");
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnvSnapshot(env);
  }
});

test("draftNaturalLanguageEditWithEnnoia returns early from SSE once a balanced JSON draft arrives", async () => {
  const originalFetch = globalThis.fetch;
  const env = snapshotEnv([
    "ENNOIA_NATURAL_EDIT_ENDPOINT",
    "ENNOIA_API_KEY",
    "KAKAO_REST_API_KEY"
  ]);

  process.env.ENNOIA_NATURAL_EDIT_ENDPOINT = "https://api.ennoia.test/natural-edit";
  process.env.ENNOIA_API_KEY = "secret-key";
  delete process.env.KAKAO_REST_API_KEY;

  let streamCancelled = false;
  globalThis.fetch = async () => {
    const encoder = new TextEncoder();
    const ennoiaPayload = {
      output: JSON.stringify({
        targetItemId: "dinner",
        intent: "replace_meal",
        confidence: 0.91,
        patch: {
          placeName: "몽탄",
          category: "meal"
        },
        needsConfirmation: true,
        needsClarification: false
      })
    };
    return {
      ok: true,
      headers: { get: () => "text/event-stream" },
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(ennoiaPayload)}\n\n`));
        },
        cancel() {
          streamCancelled = true;
        }
      })
    };
  };

  try {
    const draft = await Promise.race([
      draftNaturalLanguageEditWithEnnoia("저녁을 몽탄으로", items),
      new Promise((_, reject) => setTimeout(() => reject(new Error("SSE draft did not return early")), 120))
    ]);

    assert.equal(draft.source, "ennoia");
    assert.equal(draft.patch.placeName, "몽탄");
    assert.equal(streamCancelled, true);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnvSnapshot(env);
  }
});

test("draftNaturalLanguageEditWithEnnoia caps slow local place searches", async () => {
  const env = snapshotEnv([
    "ENNOIA_NATURAL_EDIT_ENDPOINT",
    "ENNOIA_NATURAL_EDIT_LOCAL_SEARCH_BUDGET_MS",
    "ENNOIA_API_KEY"
  ]);

  delete process.env.ENNOIA_NATURAL_EDIT_ENDPOINT;
  process.env.ENNOIA_NATURAL_EDIT_LOCAL_SEARCH_BUDGET_MS = "20";
  process.env.ENNOIA_API_KEY = "secret-key";

  try {
    const startedAt = performance.now();
    const draft = await Promise.race([
      draftNaturalLanguageEditWithEnnoia("저녁은 삼겹살로 바꿔줘", items, {
        searchPlaces: async () => new Promise(() => {})
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("local search budget exceeded")), 120))
    ]);

    assert.equal(draft.source, "fallback");
    assert.equal(draft.targetItemId, "dinner");
    assert.equal(draft.patch.placeName, "근처 삼겹살 맛집");
    assert.ok(performance.now() - startedAt < 120);
  } finally {
    restoreEnvSnapshot(env);
  }
});

test("draftNaturalLanguageEditWithEnnoia parses the first balanced JSON object only", async () => {
  const originalFetch = globalThis.fetch;
  const originalEndpoint = process.env.ENNOIA_NATURAL_EDIT_ENDPOINT;
  const originalKey = process.env.ENNOIA_API_KEY;

  process.env.ENNOIA_NATURAL_EDIT_ENDPOINT = "https://api.ennoia.test/natural-edit";
  process.env.ENNOIA_API_KEY = "secret-key";

  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      output: [
        "```json",
        JSON.stringify({
          targetItemId: "dinner",
          intent: "replace_meal",
          confidence: 0.88,
          patch: {
            placeName: "몽탄",
            category: "meal",
            memo: "JSON 뒤 설명이 붙은 응답"
          },
          needsConfirmation: true,
          needsClarification: false
        }),
        "```",
        "설명: 이 뒤의 {not json} 과 end 이벤트는 무시해야 합니다.",
        "end"
      ].join("\n")
    })
  });

  try {
    const draft = await draftNaturalLanguageEditWithEnnoia("저녁을 몽탄으로", items);

    assert.equal(draft.source, "ennoia");
    assert.equal(draft.targetItemId, "dinner");
    assert.equal(draft.patch.placeName, "몽탄");
    assert.equal(draft.patch.title, "몽탄 식사");
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv("ENNOIA_NATURAL_EDIT_ENDPOINT", originalEndpoint);
    restoreEnv("ENNOIA_API_KEY", originalKey);
  }
});

function restoreEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

function snapshotEnv(names) {
  return Object.fromEntries(names.map((name) => [name, process.env[name]]));
}

function restoreEnvSnapshot(snapshot) {
  for (const [name, value] of Object.entries(snapshot)) {
    restoreEnv(name, value);
  }
}
