import assert from "node:assert/strict";
import test from "node:test";
import { generateItineraryPlan } from "../server/ennoiaItineraryService.js";

test("generateItineraryPlan calls Ennoia preset agent with hash when configured", async () => {
  const originalFetch = globalThis.fetch;
  const env = snapshotEnv([
    "ENNOIA_TRIP_GENERATION_ENDPOINT",
    "ENNOIA_TRIP_GENERATION_HASH",
    "ENNOIA_NATURAL_EDIT_ENDPOINT",
    "ENNOIA_API_KEY",
    "ENNOIA_PROJECT_ID"
  ]);

  process.env.ENNOIA_TRIP_GENERATION_ENDPOINT = "https://api.ennoia.test/api/preset/v2/chat/completions";
  process.env.ENNOIA_TRIP_GENERATION_HASH = "agent-hash";
  process.env.ENNOIA_API_KEY = "secret-key";
  process.env.ENNOIA_PROJECT_ID = "KNTO-PROMPTON-2026-544";

  globalThis.fetch = async (url, options) => {
    assert.equal(String(url), "https://api.ennoia.test/api/preset/v2/chat/completions");
    assert.equal(options.headers.apiKey, "secret-key");
    assert.equal(options.headers.project, "KNTO-PROMPTON-2026-544");

    const body = JSON.parse(options.body);
    assert.equal(body.hash, "agent-hash");
    assert.deepEqual(body.params, {});
    assert.equal(body.multiAgentId, undefined);
    assert.match(body.messages[0].content[0].text, /추천형 가족 여행 일정/);
    assert.match(body.messages[0].content[0].text, /날짜별 items는 오전\/점심\/오후\/저녁 중심 4개 이하/);
    assert.match(body.messages[0].content[0].text, /자가용 일정은 Kakao Local PK6 주차장 후보/);
    assert.match(body.messages[0].content[0].text, /placeName은 실제 장소명/);
    assert.match(body.messages[0].content[0].text, /한 번 주차 후 800m 안쪽은 walk/);
    assert.match(body.messages[0].content[0].text, /맛집|카페|식당|쇼핑몰\/마트 같은 범용명/);

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
                    title: "수원 1일 가족 여행",
                    days: [
                      {
                        date: "2026-06-27",
                        title: "수원 핵심 동선",
                        theme: "KTO와 Kakao 후보 기반",
                        items: [
                          {
                            title: "화성행궁 관람",
                            placeName: "화성행궁",
                            address: "경기 수원시 팔달구 정조로 825",
                            lat: 37.2821,
                            lng: 127.0146,
                            startsAt: "2026-06-27T10:00:00+09:00",
                            endsAt: "2026-06-27T11:30:00+09:00",
                            transportMode: "car",
                            travelMinutesBefore: 20,
                            category: "outdoor",
                            memo: "KTO 장소 후보와 Kakao 좌표 기반"
                          }
                        ]
                      }
                    ],
                    evidence: ["KTO/Kakao/날씨 확인 요약"],
                    warnings: [],
                    apiStatus: ["KTO 호출", "Kakao 호출"]
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
    const generation = await generateItineraryPlan({
      region: "수원시",
      startDate: "2026-06-27",
      endDate: "2026-06-27",
      travelers: "4인 가족",
      transportMode: "car"
    });

    assert.equal(generation.trip.source, "ennoia");
    assert.equal(generation.trip.title, "수원 1일 가족 여행");
    assert.equal(generation.items[0].placeName, "화성행궁");
    assert.ok(generation.trip.apiStatus.some((status) => status.includes("여행 일정 설계 에이전트")));
    assert.equal(JSON.stringify(generation).includes("secret-key"), false);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv(env);
  }
});

test("generateItineraryPlan falls back when preset endpoint is missing an agent hash", async () => {
  const env = snapshotEnv([
    "ENNOIA_TRIP_GENERATION_ENDPOINT",
    "ENNOIA_TRIP_GENERATION_HASH",
    "ENNOIA_NATURAL_EDIT_ENDPOINT",
    "ENNOIA_API_KEY"
  ]);

  process.env.ENNOIA_TRIP_GENERATION_ENDPOINT = "https://api.ennoia.test/api/preset/v2/chat/completions";
  delete process.env.ENNOIA_TRIP_GENERATION_HASH;
  delete process.env.ENNOIA_NATURAL_EDIT_ENDPOINT;
  process.env.ENNOIA_API_KEY = "secret-key";

  try {
    const generation = await generateItineraryPlan({
      region: "수원시",
      startDate: "2026-06-27",
      endDate: "2026-06-27",
      travelers: "4인 가족"
    });

    assert.equal(generation.trip.source, "fallback");
    assert.match(generation.trip.modelStatus, /hash 미설정/);
  } finally {
    restoreEnv(env);
  }
});

test("generateItineraryPlan parses the first balanced JSON object before trailing text", async () => {
  const originalFetch = globalThis.fetch;
  const env = snapshotEnv([
    "ENNOIA_TRIP_GENERATION_ENDPOINT",
    "ENNOIA_TRIP_GENERATION_HASH",
    "ENNOIA_NATURAL_EDIT_ENDPOINT",
    "ENNOIA_API_KEY",
    "ENNOIA_PROJECT_ID"
  ]);

  process.env.ENNOIA_TRIP_GENERATION_ENDPOINT = "https://api.ennoia.test/api/preset/v2/chat/completions";
  process.env.ENNOIA_TRIP_GENERATION_HASH = "agent-hash";
  process.env.ENNOIA_API_KEY = "secret-key";

  globalThis.fetch = async () => ({
    ok: true,
    headers: { get: () => "application/json" },
    json: async () => ({
      output: [
        "```json",
        JSON.stringify({
          title: "부산 JSON 뒤 설명 일정",
          days: [
            {
              date: "2026-06-27",
              title: "부산 첫날",
              theme: "balanced JSON extraction",
              items: [
                {
                  title: "해운대해수욕장 산책",
                  placeName: "해운대해수욕장",
                  address: "부산 해운대구 우동",
                  lat: 35.1587,
                  lng: 129.1604,
                  startsAt: "2026-06-27T10:00:00+09:00",
                  endsAt: "2026-06-27T11:00:00+09:00",
                  transportMode: "car",
                  travelMinutesBefore: 20,
                  category: "outdoor",
                  memo: "좌표와 장소명 확인"
                }
              ]
            }
          ],
          evidence: ["balanced JSON evidence"],
          warnings: [],
          apiStatus: ["KTO 호출"]
        }),
        "```",
        "설명: 이 뒤의 {not json} 과 end 이벤트는 무시해야 합니다.",
        "end"
      ].join("\n")
    })
  });

  try {
    const generation = await generateItineraryPlan({
      region: "부산시",
      startDate: "2026-06-27",
      endDate: "2026-06-27",
      travelers: "4인 가족"
    });

    assert.equal(generation.trip.source, "ennoia");
    assert.equal(generation.trip.title, "부산 JSON 뒤 설명 일정");
    assert.ok(generation.trip.evidence.includes("balanced JSON evidence"));
    assert.equal(generation.items[0].placeName, "해운대해수욕장");
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv(env);
  }
});

function snapshotEnv(names) {
  return Object.fromEntries(names.map((name) => [name, process.env[name]]));
}

function restoreEnv(snapshot) {
  for (const [name, value] of Object.entries(snapshot)) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
}
