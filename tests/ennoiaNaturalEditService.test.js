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
    assert.match(body.messages.at(-1).content[0].text, /현재 플래너 JSON/);
    assert.match(body.messages.at(-1).content[0].text, /operation/);

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
