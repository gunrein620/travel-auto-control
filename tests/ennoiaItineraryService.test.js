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
    assert.match(body.messages[0].content[0].text, /추천형 여행 일정/);
    assert.match(body.messages[0].content[0].text, /여행관제 판단 엔진/);
    assert.doesNotMatch(body.messages[0].content[0].text, /요청 해석 에이전트/);
    assert.doesNotMatch(body.messages[0].content[0].text, /답변 QA·보안 감사 에이전트/);
    assert.match(body.messages[0].content[0].text, /KTO 행사정보/);
    assert.match(body.messages[0].content[0].text, /eventSuggestions/);
    assert.match(body.messages[0].content[0].text, /6\.23-25/);
    assert.match(body.messages[0].content[0].text, /YYYYMMDD/);
    assert.match(body.messages[0].content[0].text, /역사투어 위주, 맛집투어/);
    assert.match(body.messages[0].content[0].text, /날짜별 items는 오전\/점심\/오후\/저녁 중심 4개 이하/);
    assert.match(body.messages[0].content[0].text, /Kakao Local PK6 주차장 후보/);
    assert.match(body.messages[0].content[0].text, /placeName은 실제 장소명/);
    assert.match(body.messages[0].content[0].text, /한 번 주차 후 800m 안쪽은 walk/);
    assert.match(body.messages[0].content[0].text, /맛집|카페|식당|쇼핑몰\/마트 같은 범용명/);
    assert.match(body.messages[0].content[0].text, /식사.*저녁.*category.*meal/s);

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
                    eventSuggestions: [
                      {
                        id: "festival-1",
                        title: "수원 문화유산 야행",
                        dateRange: "2026-06-27~2026-06-28",
                        area: "경기 수원시 팔달구",
                        reason: "화성행궁 야간 동선과 맞는 KTO 행사 후보"
                      }
                    ],
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
      requests: "역사투어 위주, 맛집투어",
      transportMode: "car"
    });

    assert.equal(generation.trip.source, "ennoia");
    assert.equal(generation.trip.title, "수원 1일 가족 여행");
    assert.equal(generation.items[0].placeName, "화성행궁");
    assert.equal(generation.trip.eventSuggestions[0].title, "수원 문화유산 야행");
    assert.ok(generation.trip.apiStatus.some((status) => status.includes("여행관제 판단 엔진")));
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

test("generateItineraryPlan retries transient Ennoia network failures before falling back", async () => {
  const originalFetch = globalThis.fetch;
  const env = snapshotEnv([
    "ENNOIA_TRIP_GENERATION_ENDPOINT",
    "ENNOIA_TRIP_GENERATION_HASH",
    "ENNOIA_NATURAL_EDIT_ENDPOINT",
    "ENNOIA_API_KEY",
    "ENNOIA_PROJECT_ID"
  ]);
  let calls = 0;

  process.env.ENNOIA_TRIP_GENERATION_ENDPOINT = "https://api.ennoia.test/api/preset/v2/chat/completions";
  process.env.ENNOIA_TRIP_GENERATION_HASH = "agent-hash";
  process.env.ENNOIA_API_KEY = "secret-key";
  process.env.ENNOIA_PROJECT_ID = "KNTO-PROMPTON-2026-544";

  globalThis.fetch = async () => {
    calls += 1;
    if (calls < 3) {
      return new Response(
        JSON.stringify({
          error_type: "FAIL_AGENT_NETWORK",
          message: "Dispatch API error: REDIS_ERROR"
        }),
        { status: 500, headers: { "content-type": "application/json" } }
      );
    }

    return {
      ok: true,
      headers: { get: () => "application/json" },
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                title: "부산 3일 여행",
                days: [
                  {
                    date: "2026-06-23",
                    title: "부산 1일차",
                    items: [
                      {
                        title: "광안리 해변 산책",
                        placeName: "광안리해수욕장",
                        startsAt: "2026-06-23T10:00:00+09:00",
                        endsAt: "2026-06-23T11:30:00+09:00",
                        transportMode: "walk",
                        category: "outdoor"
                      }
                    ]
                  }
                ],
                apiStatus: ["KTO 행사정보 성공"],
                evidence: [],
                warnings: []
              })
            }
          }
        ]
      })
    };
  };

  try {
    const generation = await generateItineraryPlan({
      requests: "6.23-25 부산 여행",
      referenceDate: "2026-06-09"
    });

    assert.equal(calls, 3);
    assert.equal(generation.trip.source, "ennoia");
    assert.ok(generation.trip.apiStatus.some((status) => /일시 오류\(500\) 재시도/.test(status)));
    assert.equal(JSON.stringify(generation).includes("secret-key"), false);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv(env);
  }
});

test("generateItineraryPlan times out hanging Ennoia calls before the public tunnel does", async () => {
  const originalFetch = globalThis.fetch;
  const env = snapshotEnv([
    "ENNOIA_TRIP_GENERATION_ENDPOINT",
    "ENNOIA_TRIP_GENERATION_HASH",
    "ENNOIA_NATURAL_EDIT_ENDPOINT",
    "ENNOIA_API_KEY",
    "ENNOIA_PROJECT_ID",
    "ENNOIA_TRIP_GENERATION_TIMEOUT_MS"
  ]);

  process.env.ENNOIA_TRIP_GENERATION_ENDPOINT = "https://api.ennoia.test/api/llm-orchestrator/chat/stream/1ff5980a3d/1";
  delete process.env.ENNOIA_TRIP_GENERATION_HASH;
  process.env.ENNOIA_API_KEY = "secret-key";
  process.env.ENNOIA_TRIP_GENERATION_TIMEOUT_MS = "1000";

  globalThis.fetch = async (_url, options) => {
    await new Promise((resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
      setTimeout(resolve, 10_000);
    });
    throw new Error("fetch should have been aborted");
  };

  try {
    const generation = await generateItineraryPlan({
      region: "부산시",
      startDate: "2026-06-27",
      endDate: "2026-06-27",
      travelers: "2인",
      transportMode: "bus"
    });

    assert.equal(generation.trip.source, "fallback");
    assert.match(generation.trip.modelStatus, /Ennoia 판단 엔진 응답 지연/);
    assert.match(generation.trip.modelStatus, /로컬 안전 일정 구성/);
    assert.doesNotMatch(generation.trip.modelStatus, /엔드포인트 미설정|hash 미설정/);
    assert.ok(generation.trip.apiStatus.some((status) => /여행관제 판단 엔진 연결 확인/.test(status)));
    assert.equal(JSON.stringify(generation).includes("secret-key"), false);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv(env);
  }
});

test("generateItineraryPlan times out a quiet SSE stream without waiting for close", async () => {
  const originalFetch = globalThis.fetch;
  const env = snapshotEnv([
    "ENNOIA_TRIP_GENERATION_ENDPOINT",
    "ENNOIA_TRIP_GENERATION_HASH",
    "ENNOIA_NATURAL_EDIT_ENDPOINT",
    "ENNOIA_API_KEY",
    "ENNOIA_PROJECT_ID",
    "ENNOIA_TRIP_GENERATION_TIMEOUT_MS"
  ]);

  process.env.ENNOIA_TRIP_GENERATION_ENDPOINT = "https://api.ennoia.test/api/llm-orchestrator/chat/stream/1ff5980a3d/1";
  delete process.env.ENNOIA_TRIP_GENERATION_HASH;
  process.env.ENNOIA_API_KEY = "secret-key";
  process.env.ENNOIA_TRIP_GENERATION_TIMEOUT_MS = "1000";

  globalThis.fetch = async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode("event:connected\n"));
        controller.enqueue(encoder.encode('data:{"status":"connected"}\n\n'));
      }
    });

    return {
      ok: true,
      headers: { get: () => "text/event-stream" },
      body
    };
  };

  try {
    const generation = await generateItineraryPlan({
      region: "부산시",
      startDate: "2026-06-27",
      endDate: "2026-06-27",
      travelers: "2인",
      transportMode: "bus"
    });

    assert.equal(generation.trip.source, "fallback");
    assert.match(generation.trip.modelStatus, /판단 엔진 응답 지연/);
    assert.ok(generation.items.length > 0);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv(env);
  }
});

test("generateItineraryPlan labels delayed Ennoia output as fallback and still builds a Seoul timetable", async () => {
  const originalFetch = globalThis.fetch;
  const env = snapshotEnv([
    "ENNOIA_TRIP_GENERATION_ENDPOINT",
    "ENNOIA_TRIP_GENERATION_HASH",
    "ENNOIA_NATURAL_EDIT_ENDPOINT",
    "ENNOIA_API_KEY",
    "ENNOIA_PROJECT_ID",
    "ENNOIA_TRIP_GENERATION_TIMEOUT_MS"
  ]);

  process.env.ENNOIA_TRIP_GENERATION_ENDPOINT = "https://api.ennoia.test/api/llm-orchestrator/chat/stream/1ff5980a3d/1";
  delete process.env.ENNOIA_TRIP_GENERATION_HASH;
  process.env.ENNOIA_API_KEY = "secret-key";
  process.env.ENNOIA_TRIP_GENERATION_TIMEOUT_MS = "1000";

  globalThis.fetch = async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode("event:connected\n"));
        controller.enqueue(encoder.encode('data:{"status":"connected"}\n\n'));
      }
    });

    return {
      ok: true,
      headers: { get: () => "text/event-stream" },
      body
    };
  };

  try {
    const generation = await generateItineraryPlan({
      requests: "서울숲 비 오는 날 우회 코스",
      startDate: "2026-06-23",
      endDate: "2026-06-24",
      transportMode: "subway"
    });

    assert.equal(generation.trip.source, "fallback");
    assert.match(generation.trip.modelStatus, /Ennoia 판단 엔진 응답 지연/);
    assert.doesNotMatch(generation.trip.modelStatus, /Ennoia 연결 확인/);
    assert.equal(generation.trip.region, "서울");
    assert.ok(generation.items.length > 0);
    assert.ok(generation.items.some((item) => item.placeName === "서울숲"));
    assert.equal(JSON.stringify(generation).includes("secret-key"), false);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv(env);
  }
});

test("generateItineraryPlan unwraps orchestrator response envelopes before normalizing", async () => {
  const originalFetch = globalThis.fetch;
  const env = snapshotEnv([
    "ENNOIA_TRIP_GENERATION_ENDPOINT",
    "ENNOIA_TRIP_GENERATION_HASH",
    "ENNOIA_NATURAL_EDIT_ENDPOINT",
    "ENNOIA_API_KEY",
    "ENNOIA_PROJECT_ID"
  ]);

  process.env.ENNOIA_TRIP_GENERATION_ENDPOINT = "https://api.ennoia.test/api/llm-orchestrator/chat/stream/1ff5980a3d/1";
  delete process.env.ENNOIA_TRIP_GENERATION_HASH;
  process.env.ENNOIA_API_KEY = "secret-key";
  process.env.ENNOIA_PROJECT_ID = "KNTO-PROMPTON-2026-544";

  globalThis.fetch = async (url, options) => {
    assert.equal(String(url), "https://api.ennoia.test/api/llm-orchestrator/chat/stream/1ff5980a3d/1");
    assert.equal(options.headers.apiKey, "secret-key");

    const body = JSON.parse(options.body);
    assert.equal(body.multiAgentId, "1ff5980a3d");
    assert.equal(body.multiAgentVersion, "1");
    assert.equal(body.hash, undefined);

    return {
      ok: true,
      headers: { get: () => "application/json" },
      json: async () => ({
        result: {
          runId: "run-1",
          data: {
            output: [
              {
                type: "text",
                text: JSON.stringify({
                  title: "부산 멀티 에이전트 일정",
                  days: [
                    {
                      date: "2026-06-27",
                      title: "부산 첫날",
                      theme: "orchestrator envelope unwrapped",
                      items: [
                        {
                          title: "해운대해수욕장 산책",
                          placeName: "해운대해수욕장",
                          address: "부산 해운대구 우동",
                          lat: 35.1587,
                          lng: 129.1604,
                          startsAt: "2026-06-27T10:00:00+09:00",
                          endsAt: "2026-06-27T11:00:00+09:00",
                          transportMode: "bus",
                          travelMinutesBefore: 25,
                          category: "outdoor",
                          memo: "KTO/Kakao 후보"
                        }
                      ]
                    }
                  ],
                  evidence: ["멀티 에이전트 래퍼 해제"],
                  warnings: [],
                  apiStatus: ["KTO 후보 확인"]
                })
              }
            ]
          }
        }
      })
    };
  };

  try {
    const generation = await generateItineraryPlan({
      region: "부산시",
      startDate: "2026-06-27",
      endDate: "2026-06-27",
      travelers: "2인",
      transportMode: "bus"
    });

    assert.equal(generation.trip.source, "ennoia");
    assert.equal(generation.trip.title, "부산 멀티 에이전트 일정");
    assert.equal(generation.items[0].placeName, "해운대해수욕장");
    assert.ok(generation.trip.evidence.includes("멀티 에이전트 래퍼 해제"));
    assert.equal(JSON.stringify(generation).includes("secret-key"), false);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv(env);
  }
});

test("generateItineraryPlan selects the trip JSON after intermediate agent objects", async () => {
  const originalFetch = globalThis.fetch;
  const env = snapshotEnv([
    "ENNOIA_TRIP_GENERATION_ENDPOINT",
    "ENNOIA_TRIP_GENERATION_HASH",
    "ENNOIA_NATURAL_EDIT_ENDPOINT",
    "ENNOIA_API_KEY",
    "ENNOIA_PROJECT_ID"
  ]);

  process.env.ENNOIA_TRIP_GENERATION_ENDPOINT = "https://api.ennoia.test/api/llm-orchestrator/chat/stream/1ff5980a3d/1";
  delete process.env.ENNOIA_TRIP_GENERATION_HASH;
  process.env.ENNOIA_API_KEY = "secret-key";

  globalThis.fetch = async () => ({
    ok: true,
    headers: { get: () => "text/event-stream" },
    text: async () =>
      [
        "data: connected",
        `data: ${JSON.stringify({ content: JSON.stringify({ agent: "요청 해석 에이전트", region: "부산", days: [] }) })}`,
        `data: ${JSON.stringify({
          content: JSON.stringify({
            title: "부산 최종 관제 일정",
            days: [
              {
                date: "2026-06-27",
                title: "부산 최종일",
                theme: "intermediate objects ignored",
                items: [
                  {
                    title: "감천문화마을 산책",
                    placeName: "감천문화마을",
                    address: "부산 사하구 감내2로 203",
                    lat: 35.0975,
                    lng: 129.0106,
                    startsAt: "2026-06-27T10:00:00+09:00",
                    endsAt: "2026-06-27T11:30:00+09:00",
                    transportMode: "bus",
                    travelMinutesBefore: 30,
                    category: "outdoor",
                    memo: "KTO/Kakao 후보"
                  }
                ]
              }
            ],
            evidence: ["최종 일정 JSON 선택"],
            warnings: [],
            apiStatus: ["멀티 에이전트 최종 응답"]
          })
        })}`,
        "data: [DONE]"
      ].join("\n")
  });

  try {
    const generation = await generateItineraryPlan({
      region: "부산시",
      startDate: "2026-06-27",
      endDate: "2026-06-27",
      travelers: "2인",
      transportMode: "bus"
    });

    assert.equal(generation.trip.source, "ennoia");
    assert.equal(generation.trip.title, "부산 최종 관제 일정");
    assert.equal(generation.items[0].placeName, "감천문화마을");
    assert.ok(generation.trip.evidence.includes("최종 일정 JSON 선택"));
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv(env);
  }
});

test("generateItineraryPlan returns from SSE as soon as final trip JSON is available", async () => {
  const originalFetch = globalThis.fetch;
  const env = snapshotEnv([
    "ENNOIA_TRIP_GENERATION_ENDPOINT",
    "ENNOIA_TRIP_GENERATION_HASH",
    "ENNOIA_NATURAL_EDIT_ENDPOINT",
    "ENNOIA_API_KEY",
    "ENNOIA_PROJECT_ID"
  ]);

  process.env.ENNOIA_TRIP_GENERATION_ENDPOINT = "https://api.ennoia.test/api/llm-orchestrator/chat/stream/1ff5980a3d/1";
  delete process.env.ENNOIA_TRIP_GENERATION_HASH;
  process.env.ENNOIA_API_KEY = "secret-key";

  globalThis.fetch = async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode("data: connected\n\n"));
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: JSON.stringify({ agent: "요청 해석 에이전트", region: "부산" }) })}\n\n`));
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              content: JSON.stringify({
                title: "부산 조기 반환 일정",
                days: [
                  {
                    date: "2026-06-27",
                    title: "부산 스트림",
                    theme: "return before stream closes",
                    items: [
                      {
                        title: "부산시립미술관 관람",
                        placeName: "부산시립미술관",
                        address: "부산 해운대구 APEC로 58",
                        lat: 35.1666,
                        lng: 129.137,
                        startsAt: "2026-06-27T10:00:00+09:00",
                        endsAt: "2026-06-27T11:30:00+09:00",
                        transportMode: "bus",
                        travelMinutesBefore: 20,
                        category: "indoor",
                        memo: "KTO/Kakao 후보"
                      }
                    ]
                  }
                ],
                evidence: ["스트림 조기 반환"],
                warnings: [],
                apiStatus: ["멀티 에이전트 최종 응답"]
              })
            })}\n\n`
          )
        );
      }
    });

    return {
      ok: true,
      headers: { get: () => "text/event-stream" },
      body,
      text: async () => new Promise(() => {})
    };
  };

  try {
    const generation = await Promise.race([
      generateItineraryPlan({
        region: "부산시",
        startDate: "2026-06-27",
        endDate: "2026-06-27",
        travelers: "2인",
        transportMode: "bus"
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("SSE response did not return early")), 500))
    ]);

    assert.equal(generation.trip.source, "ennoia");
    assert.equal(generation.trip.title, "부산 조기 반환 일정");
    assert.equal(generation.items[0].placeName, "부산시립미술관");
  } finally {
    globalThis.fetch = originalFetch;
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

test("generateItineraryPlan repairs Ennoia days that end after lunch without dinner", async () => {
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
      choices: [
        {
          message: {
            content: JSON.stringify({
              title: "수원 조기 종료 일정",
              days: [
                {
                  date: "2026-06-27",
                  title: "수원 반나절처럼 끝난 일정",
                  theme: "주차와 점심까지만 구성됨",
                  items: [
                    {
                      title: "주차 및 도보 이동",
                      placeName: "팔달중앙주차장",
                      address: "경기 수원시 팔달구",
                      lat: 37.281,
                      lng: 127.015,
                      startsAt: "2026-06-27T09:30:00+09:00",
                      endsAt: "2026-06-27T09:45:00+09:00",
                      transportMode: "car",
                      travelMinutesBefore: 20,
                      category: "indoor",
                      memo: "주차장 후보"
                    },
                    {
                      title: "화성행궁 관람",
                      placeName: "화성행궁",
                      address: "경기 수원시 팔달구 정조로 825",
                      lat: 37.2819,
                      lng: 127.0142,
                      startsAt: "2026-06-27T10:00:00+09:00",
                      endsAt: "2026-06-27T11:30:00+09:00",
                      transportMode: "walk",
                      travelMinutesBefore: 15,
                      category: "outdoor",
                      memo: "KTO 후보"
                    },
                    {
                      title: "행궁동 점심",
                      placeName: "먹을터",
                      address: "경기 수원시 팔달구 정조로801번길 16",
                      lat: 37.2797,
                      lng: 127.0157,
                      startsAt: "2026-06-27T12:10:00+09:00",
                      endsAt: "2026-06-27T13:30:00+09:00",
                      transportMode: "walk",
                      travelMinutesBefore: 10,
                      category: "meal",
                      memo: "점심 후보"
                    }
                  ]
                }
              ],
              evidence: ["KTO/Kakao 후보"],
              warnings: [],
              apiStatus: ["KTO 호출", "Kakao 호출"]
            })
          }
        }
      ]
    })
  });

  try {
    const generation = await generateItineraryPlan({
      region: "수원시",
      startDate: "2026-06-27",
      endDate: "2026-06-27",
      travelers: "4인 가족",
      transportMode: "car"
    });
    const dayItems = generation.trip.days[0].itemIds.map((id) => generation.items.find((item) => item.id === id));
    const lastEnd = new Date(dayItems.at(-1).endsAt).getTime();
    const minDinnerEnd = new Date("2026-06-27T18:00:00+09:00").getTime();

    assert.ok(dayItems.length <= 4);
    assert.ok(dayItems.some((item) => item.category === "meal" && item.startsAt.includes("T17:")));
    assert.ok(lastEnd >= minDinnerEnd);
    assert.equal(dayItems.some((item) => /주차/.test(`${item.title} ${item.placeName}`)), false);
    assert.ok(generation.trip.warnings.some((warning) => /저녁 일정 보강/.test(warning)));
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv(env);
  }
});

test("generateItineraryPlan does not duplicate an Ennoia dinner that starts before 17 and ends in the evening", async () => {
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
      choices: [
        {
          message: {
            content: JSON.stringify({
              title: "수원 저녁 포함 일정",
              days: [
                {
                  date: "2026-06-27",
                  title: "수원 저녁까지 이어지는 일정",
                  items: [
                    tripItem("10:00", "12:00", "화성행궁", "화성행궁", "outdoor"),
                    tripItem("12:00", "13:30", "낙원갈비집 수원남문점 점심", "낙원갈비집 수원남문점", "meal"),
                    tripItem("13:30", "16:00", "방화수류정 산책", "방화수류정", "outdoor"),
                    tripItem("16:00", "18:30", "카페 휴식 및 간단 저녁", "행궁다과", "meal")
                  ]
                }
              ],
              evidence: ["KTO/Kakao 후보"],
              warnings: [],
              apiStatus: ["KTO 호출", "Kakao 호출"]
            })
          }
        }
      ]
    })
  });

  try {
    const generation = await generateItineraryPlan({
      region: "수원시",
      startDate: "2026-06-27",
      endDate: "2026-06-27",
      travelers: "4인 가족",
      transportMode: "car"
    });
    const dayItems = generation.trip.days[0].itemIds.map((id) => generation.items.find((item) => item.id === id));

    assert.equal(dayItems.length, 4);
    assert.equal(dayItems.filter((item) => /저녁/.test(item.title)).length, 1);
    assert.equal(dayItems.some((item) => item.placeName === "가보정"), false);
    assert.equal(generation.trip.warnings.some((warning) => /저녁 일정 보강/.test(warning)), false);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv(env);
  }
});

test("generateItineraryPlan treats an evening dinner block as covered even when Ennoia mislabels the category", async () => {
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
      choices: [
        {
          message: {
            content: JSON.stringify({
              title: "수원 저녁 category 오분류 일정",
              days: [
                {
                  date: "2026-06-27",
                  title: "수원 저녁까지 이어지는 일정",
                  items: [
                    tripItem("10:00", "12:00", "화성행궁", "화성행궁", "outdoor"),
                    tripItem("12:10", "13:30", "먹을터 점심", "먹을터", "meal"),
                    tripItem("13:40", "16:30", "행궁동 벽화마을 산책", "행궁동 벽화마을", "outdoor"),
                    tripItem("16:40", "19:00", "카페 휴식 및 저녁 식사", "91COFFEE 행궁점", "indoor")
                  ]
                }
              ],
              evidence: ["KTO/Kakao 후보"],
              warnings: [],
              apiStatus: ["KTO 호출", "Kakao 호출"]
            })
          }
        }
      ]
    })
  });

  try {
    const generation = await generateItineraryPlan({
      region: "수원시",
      startDate: "2026-06-27",
      endDate: "2026-06-27",
      travelers: "4인 가족",
      transportMode: "car"
    });
    const dayItems = generation.trip.days[0].itemIds.map((id) => generation.items.find((item) => item.id === id));

    assert.equal(dayItems.length, 4);
    assert.equal(dayItems.some((item) => item.placeName === "가보정"), false);
    assert.equal(dayItems.at(-1).endsAt, "2026-06-27T19:00:00+09:00");
    assert.equal(dayItems.at(-1).category, "meal");
    assert.equal(generation.trip.warnings.some((warning) => /저녁 일정 보강/.test(warning)), false);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv(env);
  }
});

function tripItem(start, end, title, placeName, category) {
  return {
    title,
    placeName,
    address: "경기 수원시 팔달구",
    lat: 37.2819,
    lng: 127.0142,
    startsAt: `2026-06-27T${start}:00+09:00`,
    endsAt: `2026-06-27T${end}:00+09:00`,
    transportMode: "walk",
    travelMinutesBefore: 15,
    category,
    memo: "KTO/Kakao 후보"
  };
}

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
