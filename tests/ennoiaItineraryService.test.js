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

test("generateItineraryPlan repairs same-day overlapping items from Ennoia", async () => {
  const originalFetch = globalThis.fetch;
  const env = snapshotEnv([
    "ENNOIA_TRIP_GENERATION_ENDPOINT",
    "ENNOIA_TRIP_GENERATION_HASH",
    "ENNOIA_NATURAL_EDIT_ENDPOINT",
    "ENNOIA_API_KEY",
    "KTO_SERVICE_KEY"
  ]);

  process.env.ENNOIA_TRIP_GENERATION_ENDPOINT = "https://api.ennoia.test/api/preset/v2/chat/completions";
  process.env.ENNOIA_TRIP_GENERATION_HASH = "agent-hash";
  process.env.ENNOIA_API_KEY = "secret-key";
  delete process.env.KTO_SERVICE_KEY;

  globalThis.fetch = async () => ({
    ok: true,
    headers: { get: () => "application/json" },
    json: async () => ({
      choices: [
        {
          message: {
            content: JSON.stringify({
              title: "고양 겹침 보정 일정",
              days: [
                {
                  date: "2026-06-13",
                  title: "행주산성 주변",
                  items: [
                    tripItemForDate("2026-06-13", "15:00", "18:30", "행주산성 역사공원 오후 산책", "행주산성 역사공원", "outdoor"),
                    tripItemForDate("2026-06-13", "17:50", "18:50", "행주산성 카페 휴식", "행주산성 카페 리오리코", "meal")
                  ]
                }
              ],
              eventSuggestions: [],
              warnings: [],
              apiStatus: []
            })
          }
        }
      ]
    })
  });

  try {
    const generation = await generateItineraryPlan({
      region: "고양시",
      startDate: "2026-06-13",
      endDate: "2026-06-13",
      requests: "",
      transportMode: "car"
    });

    const cafe = generation.items.find((item) => item.title === "행주산성 카페 휴식");
    assert.equal(cafe.startsAt, "2026-06-13T18:45:00+09:00");
    assert.equal(cafe.endsAt, "2026-06-13T19:45:00+09:00");
    assert.ok(generation.trip.warnings.some((warning) => /겹친 일정 시간 보정/.test(warning)));
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv(env);
  }
});

test("generateItineraryPlan injects a matching KTO festival highlight when Ennoia omits festival items", async () => {
  const originalFetch = globalThis.fetch;
  const env = snapshotEnv([
    "ENNOIA_TRIP_GENERATION_ENDPOINT",
    "ENNOIA_TRIP_GENERATION_HASH",
    "ENNOIA_NATURAL_EDIT_ENDPOINT",
    "ENNOIA_API_KEY",
    "KTO_SERVICE_KEY"
  ]);

  process.env.ENNOIA_TRIP_GENERATION_ENDPOINT = "https://api.ennoia.test/api/preset/v2/chat/completions";
  process.env.ENNOIA_TRIP_GENERATION_HASH = "agent-hash";
  process.env.ENNOIA_API_KEY = "secret-key";
  process.env.KTO_SERVICE_KEY = "kto-key";

  globalThis.fetch = async (url, options = {}) => {
    const parsed = new URL(url);
    if (parsed.hostname === "apis.data.go.kr") {
      if (parsed.pathname.endsWith("/searchFestival2") && parsed.searchParams.get("areaCode") === "31") {
        return ktoResponse({ totalCount: 0, item: [] });
      }

      if (parsed.pathname.endsWith("/searchFestival2")) {
        return ktoResponse({
          totalCount: 1,
          item: {
            contentid: "530450",
            contenttypeid: "15",
            title: "고양행주문화제",
            addr1: "경기도 고양시 덕양구 행주로15번길 89 (행주외동)",
            eventstartdate: "20260613",
            eventenddate: "20260614",
            mapx: "126.8245886711",
            mapy: "37.6004267743",
            areacode: "",
            sigungucode: ""
          }
        });
      }

      if (parsed.pathname.endsWith("/searchKeyword2")) {
        return ktoResponse({ totalCount: 0, item: [] });
      }

      if (parsed.pathname.endsWith("/detailIntro2")) {
        return ktoResponse({
          totalCount: 1,
          item: {
            contentid: "530450",
            eventstartdate: "20260613",
            eventenddate: "20260614",
            playtime: "15:00~21:00",
            eventplace: "행주산성역사공원 및 행주산성 일원",
            program: "대표프로그램, 공연프로그램, 체험 프로그램",
            usetimefestival: "무료"
          }
        });
      }
    }

    assert.equal(String(url), "https://api.ennoia.test/api/preset/v2/chat/completions");
    const body = JSON.parse(options.body);
    assert.match(body.messages[0].content[0].text, /고양행주문화제/);
    assert.match(body.messages[0].content[0].text, /행주 드론불꽃쇼/);

    return {
      ok: true,
      headers: { get: () => "application/json" },
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                title: "고양시 축제 공연 중심 2박3일",
                days: [
                  {
                    date: "2026-06-13",
                    title: "행주산성 주변 적응",
                    items: [
                      tripItemForDate("2026-06-13", "10:00", "12:00", "행주산성 산책", "행주산성", "outdoor"),
                      tripItemForDate("2026-06-13", "12:20", "13:20", "행주산성 인근 점심", "원조국수집", "meal"),
                      tripItemForDate("2026-06-13", "15:00", "17:00", "역사공원 산책", "행주산성역사공원", "outdoor"),
                      tripItemForDate("2026-06-13", "18:00", "19:00", "저녁 식사", "행주산성 원조국수집", "meal")
                    ]
                  },
                  {
                    date: "2026-06-14",
                    title: "고양 문화시설",
                    items: [tripItemForDate("2026-06-14", "10:00", "12:00", "고양아람누리 관람", "고양아람누리", "indoor")]
                  },
                  {
                    date: "2026-06-15",
                    title: "귀가 전 정리",
                    items: [tripItemForDate("2026-06-15", "10:00", "11:30", "마두역 주변 정리", "마두역", "indoor")]
                  }
                ],
                evidence: ["KTO 관광정보만 반영"],
                warnings: [],
                eventSuggestions: [],
                apiStatus: ["KTO 관광정보 성공", "KTO 행사정보 0건"]
              })
            }
          }
        ]
      })
    };
  };

  try {
    const generation = await generateItineraryPlan({
      region: "고양시",
      startDate: "2026-06-13",
      endDate: "2026-06-15",
      requests: "축제 공연 중심 여행, 드론 불꽃쇼도 보고 싶어",
      transportMode: "car"
    });

    assert.ok(generation.trip.eventSuggestions.some((event) => event.title === "고양행주문화제"));
    const drone = generation.items.find((item) => item.title === "행주 드론불꽃쇼 관람");
    assert.ok(drone, "드론불꽃쇼 일정 item이 생성되어야 합니다.");
    assert.equal(drone.startsAt, "2026-06-13T20:20:00+09:00");
    assert.equal(drone.endsAt, "2026-06-13T21:10:00+09:00");
    assert.equal(drone.placeName, "행주산성역사공원");
    assert.ok(generation.trip.apiStatus.some((status) => /전국 재검색/.test(status)));
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv(env);
  }
});

test("generateItineraryPlan aligns an existing festival item to the precise KTO highlight time", async () => {
  const originalFetch = globalThis.fetch;
  const env = snapshotEnv([
    "ENNOIA_TRIP_GENERATION_ENDPOINT",
    "ENNOIA_TRIP_GENERATION_HASH",
    "ENNOIA_NATURAL_EDIT_ENDPOINT",
    "ENNOIA_API_KEY",
    "KTO_SERVICE_KEY"
  ]);

  process.env.ENNOIA_TRIP_GENERATION_ENDPOINT = "https://api.ennoia.test/api/preset/v2/chat/completions";
  process.env.ENNOIA_TRIP_GENERATION_HASH = "agent-hash";
  process.env.ENNOIA_API_KEY = "secret-key";
  process.env.KTO_SERVICE_KEY = "kto-key";

  globalThis.fetch = async (url) => {
    const parsed = new URL(url);
    if (parsed.hostname === "apis.data.go.kr") {
      if (parsed.pathname.endsWith("/searchFestival2") && parsed.searchParams.get("areaCode") === "31") {
        return ktoResponse({ totalCount: 0, item: [] });
      }

      if (parsed.pathname.endsWith("/searchFestival2")) {
        return ktoResponse({
          totalCount: 1,
          item: {
            contentid: "530450",
            contenttypeid: "15",
            title: "고양행주문화제",
            addr1: "경기도 고양시 덕양구 행주로15번길 89 (행주외동)",
            eventstartdate: "20260613",
            eventenddate: "20260614",
            mapx: "126.8245886711",
            mapy: "37.6004267743"
          }
        });
      }

      if (parsed.pathname.endsWith("/searchKeyword2")) {
        return ktoResponse({ totalCount: 0, item: [] });
      }

      if (parsed.pathname.endsWith("/detailIntro2")) {
        return ktoResponse({
          totalCount: 1,
          item: {
            contentid: "530450",
            eventstartdate: "20260613",
            eventenddate: "20260614",
            playtime: "15:00~21:00",
            eventplace: "행주산성역사공원 및 행주산성 일원",
            program: "대표프로그램, 공연프로그램, 체험 프로그램"
          }
        });
      }
    }

    return {
      ok: true,
      headers: { get: () => "application/json" },
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                title: "고양시 고양행주문화제 중심 2박3일",
                days: [
                  {
                    date: "2026-06-13",
                    title: "행주 야간 축제",
                    items: [
                      tripItemForDate("2026-06-13", "10:00", "12:00", "행주산성 산책", "행주산성", "outdoor"),
                      tripItemForDate("2026-06-13", "12:10", "13:10", "행주산성 점심", "행주산성먹거리촌", "meal"),
                      tripItemForDate("2026-06-13", "15:00", "18:30", "고양행주문화제 즐기기", "행주산성역사공원", "outdoor"),
                      tripItemForDate("2026-06-13", "19:30", "21:10", "행주 드론불꽃쇼 관람 및 야간 간단 식사", "행주산성역사공원", "meal")
                    ]
                  },
                  {
                    date: "2026-06-14",
                    title: "고양 여유",
                    items: [
                      tripItemForDate("2026-06-14", "10:00", "12:00", "행주산성 재방문", "행주산성", "outdoor"),
                      tripItemForDate("2026-06-14", "17:30", "21:10", "고양행주문화제 2일차와 드론불꽃쇼", "행주산성역사공원", "outdoor")
                    ]
                  },
                  {
                    date: "2026-06-15",
                    title: "귀가",
                    items: [tripItemForDate("2026-06-15", "10:00", "11:30", "카페 브런치", "행주산성역사공원", "meal")]
                  }
                ],
                eventSuggestions: [],
                warnings: [],
                apiStatus: []
              })
            }
          }
        ]
      })
    };
  };

  try {
    const generation = await generateItineraryPlan({
      region: "고양시",
      startDate: "2026-06-13",
      endDate: "2026-06-15",
      requests: "축제 공연 중심 여행. 드론불꽃쇼는 밤 8시 35분경으로 맞춰줘",
      transportMode: "car"
    });

    const droneItems = generation.items.filter((item) => /드론불꽃쇼/.test(item.title));
    assert.equal(droneItems.length, 2);
    assert.ok(
      droneItems.some((item) => item.title === "행주 드론불꽃쇼 관람" && item.startsAt === "2026-06-13T20:20:00+09:00" && item.endsAt === "2026-06-13T21:10:00+09:00")
    );
    assert.ok(
      droneItems.some((item) => item.title === "행주 드론불꽃쇼 관람" && item.startsAt === "2026-06-14T20:20:00+09:00" && item.endsAt === "2026-06-14T21:10:00+09:00")
    );
    assert.ok(generation.trip.warnings.some((warning) => /행사 시간 보정/.test(warning)));
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv(env);
  }
});

test("generateItineraryPlan still returns a KTO festival item for unsupported regions", async () => {
  const originalFetch = globalThis.fetch;
  const env = snapshotEnv([
    "ENNOIA_TRIP_GENERATION_ENDPOINT",
    "ENNOIA_TRIP_GENERATION_HASH",
    "ENNOIA_NATURAL_EDIT_ENDPOINT",
    "ENNOIA_API_KEY",
    "KTO_SERVICE_KEY"
  ]);

  delete process.env.ENNOIA_TRIP_GENERATION_ENDPOINT;
  delete process.env.ENNOIA_NATURAL_EDIT_ENDPOINT;
  delete process.env.ENNOIA_API_KEY;
  process.env.KTO_SERVICE_KEY = "kto-key";

  globalThis.fetch = async (url) => {
    const parsed = new URL(url);
    if (parsed.hostname !== "apis.data.go.kr") throw new Error(`unexpected URL: ${url}`);

    if (parsed.pathname.endsWith("/searchFestival2") && parsed.searchParams.get("areaCode") === "36") {
      return ktoResponse({
        totalCount: 1,
        item: {
          contentid: "2755016",
          contenttypeid: "15",
          title: "강주해바라기 축제",
          addr1: "경상남도 함안군 강주4길 16",
          eventstartdate: "20260618",
          eventenddate: "20260702",
          mapx: "128.4142",
          mapy: "35.3315"
        }
      });
    }

    if (parsed.pathname.endsWith("/searchFestival2")) {
      return ktoResponse({ totalCount: 0, item: [] });
    }

    if (parsed.pathname.endsWith("/searchKeyword2")) {
      return ktoResponse({ totalCount: 0, item: [] });
    }

    if (parsed.pathname.endsWith("/detailIntro2")) {
      return ktoResponse({
        totalCount: 1,
        item: {
          contentid: "2755016",
          eventstartdate: "20260618",
          eventenddate: "20260702",
          playtime: "09:00~18:00",
          eventplace: "강주마을 일원",
          program: "해바라기 관람 및 체험 프로그램"
        }
      });
    }

    throw new Error(`unexpected KTO URL: ${url}`);
  };

  try {
    const generation = await generateItineraryPlan({
      region: "함안군",
      startDate: "2026-06-18",
      endDate: "2026-06-19",
      requests: "경상남도 함안군 강주해바라기 축제 가고 싶어",
      transportMode: "car"
    });

    assert.equal(generation.trip.source, "fallback");
    assert.ok(generation.trip.eventSuggestions.some((event) => event.title === "강주해바라기 축제"));
    assert.ok(generation.items.some((item) => item.title === "강주해바라기 축제 관람"));
    assert.ok(generation.trip.apiStatus.some((status) => /KTO 행사 주소 필터/.test(status)));
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv(env);
  }
});

test("generateItineraryPlan auto-attaches the only local festival candidate for date and region requests", async () => {
  const originalFetch = globalThis.fetch;
  const env = snapshotEnv([
    "ENNOIA_TRIP_GENERATION_ENDPOINT",
    "ENNOIA_TRIP_GENERATION_HASH",
    "ENNOIA_NATURAL_EDIT_ENDPOINT",
    "ENNOIA_API_KEY",
    "KTO_SERVICE_KEY"
  ]);

  delete process.env.ENNOIA_TRIP_GENERATION_ENDPOINT;
  delete process.env.ENNOIA_NATURAL_EDIT_ENDPOINT;
  delete process.env.ENNOIA_API_KEY;
  process.env.KTO_SERVICE_KEY = "kto-key";

  globalThis.fetch = async (url) => {
    const parsed = new URL(url);
    if (parsed.hostname !== "apis.data.go.kr") throw new Error(`unexpected URL: ${url}`);

    if (parsed.pathname.endsWith("/searchFestival2") && parsed.searchParams.get("areaCode") === "31") {
      return ktoResponse({ totalCount: 0, item: [] });
    }

    if (parsed.pathname.endsWith("/searchFestival2")) {
      return ktoResponse({
        totalCount: 1,
        item: {
          contentid: "530450",
          contenttypeid: "15",
          title: "고양행주문화제",
          addr1: "경기도 고양시 덕양구 행주로15번길 89 (행주외동)",
          eventstartdate: "20260613",
          eventenddate: "20260614",
          mapx: "126.8245886711",
          mapy: "37.6004267743"
        }
      });
    }

    if (parsed.pathname.endsWith("/searchKeyword2")) {
      return ktoResponse({ totalCount: 0, item: [] });
    }

    if (parsed.pathname.endsWith("/detailIntro2")) {
      return ktoResponse({
        totalCount: 1,
        item: {
          contentid: "530450",
          eventstartdate: "20260613",
          eventenddate: "20260614",
          playtime: "15:00~21:00",
          eventplace: "행주산성역사공원 및 행주산성 일원",
          program: "대표프로그램, 공연프로그램, 체험 프로그램"
        }
      });
    }

    throw new Error(`unexpected KTO URL: ${url}`);
  };

  try {
    const generation = await generateItineraryPlan({
      region: "고양시",
      startDate: "2026-06-13",
      endDate: "2026-06-15",
      requests: "",
      transportMode: "car"
    });

    assert.ok(generation.trip.eventSuggestions.some((event) => event.title === "고양행주문화제"));
    const droneItems = generation.items.filter((item) => item.title === "행주 드론불꽃쇼 관람");
    assert.equal(droneItems.length, 2);
    assert.ok(droneItems.some((item) => item.startsAt === "2026-06-13T20:20:00+09:00"));
    assert.ok(droneItems.some((item) => item.startsAt === "2026-06-14T20:20:00+09:00"));
    assert.ok(generation.trip.apiStatus.some((status) => /KTO searchFestival2 전국 재검색 결과 1건/.test(status)));
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv(env);
  }
});

test("generateItineraryPlan prioritizes the requested event title over generic show matches", async () => {
  const originalFetch = globalThis.fetch;
  const env = snapshotEnv([
    "ENNOIA_TRIP_GENERATION_ENDPOINT",
    "ENNOIA_TRIP_GENERATION_HASH",
    "ENNOIA_NATURAL_EDIT_ENDPOINT",
    "ENNOIA_API_KEY",
    "KTO_SERVICE_KEY"
  ]);

  delete process.env.ENNOIA_TRIP_GENERATION_ENDPOINT;
  delete process.env.ENNOIA_NATURAL_EDIT_ENDPOINT;
  delete process.env.ENNOIA_API_KEY;
  process.env.KTO_SERVICE_KEY = "kto-key";

  globalThis.fetch = async (url) => {
    const parsed = new URL(url);
    if (parsed.hostname !== "apis.data.go.kr") throw new Error(`unexpected URL: ${url}`);

    if (parsed.pathname.endsWith("/searchFestival2") && parsed.searchParams.get("areaCode") === "6") {
      return ktoResponse({
        totalCount: 2,
        item: [
          {
            contentid: "2390168",
            contenttypeid: "15",
            title: "부산원아시아페스티벌(BOF) with NOL",
            addr1: "부산광역시 연제구 월드컵대로 344 (거제동)",
            eventstartdate: "20260627",
            eventenddate: "20260628",
            mapx: "129.0603",
            mapy: "35.191"
          },
          {
            contentid: "2786391",
            contenttypeid: "15",
            title: "광안리 M(Marvelous) 드론 라이트쇼",
            addr1: "부산광역시 수영구 광안해변로 219 (광안동)",
            eventstartdate: "20260101",
            eventenddate: "20261231",
            mapx: "129.1186",
            mapy: "35.1532"
          }
        ]
      });
    }

    if (parsed.pathname.endsWith("/searchFestival2")) {
      return ktoResponse({ totalCount: 0, item: [] });
    }

    if (parsed.pathname.endsWith("/searchKeyword2")) {
      return ktoResponse({ totalCount: 0, item: [] });
    }

    if (parsed.pathname.endsWith("/detailIntro2")) {
      const contentId = parsed.searchParams.get("contentId");
      return ktoResponse({
        totalCount: 1,
        item: {
          contentid: contentId,
          eventstartdate: contentId === "2390168" ? "20260627" : "20260101",
          eventenddate: contentId === "2390168" ? "20260628" : "20261231",
          playtime: contentId === "2390168" ? "13:00~21:00" : "20:00~22:00",
          eventplace: contentId === "2390168" ? "부산아시아드주경기장" : "광안리 해변 일원",
          program: contentId === "2390168" ? "K-POP 공연" : "드론 라이트쇼"
        }
      });
    }

    throw new Error(`unexpected KTO URL: ${url}`);
  };

  try {
    const generation = await generateItineraryPlan({
      region: "부산",
      startDate: "2026-06-27",
      endDate: "2026-06-28",
      requests: "부산원아시아페스티벌 공연 중심 여행으로 만들어줘",
      transportMode: "car"
    });

    assert.ok(generation.trip.eventSuggestions.some((event) => /부산원아시아페스티벌/.test(event.title)));
    assert.ok(generation.items.some((item) => /부산원아시아페스티벌/.test(item.title)));
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv(env);
  }
});

test("generateItineraryPlan shifts following items to keep a buffer after fixed festival times", async () => {
  const originalFetch = globalThis.fetch;
  const env = snapshotEnv([
    "ENNOIA_TRIP_GENERATION_ENDPOINT",
    "ENNOIA_TRIP_GENERATION_HASH",
    "ENNOIA_NATURAL_EDIT_ENDPOINT",
    "ENNOIA_API_KEY",
    "KTO_SERVICE_KEY"
  ]);

  process.env.ENNOIA_TRIP_GENERATION_ENDPOINT = "https://api.ennoia.test/api/preset/v2/chat/completions";
  process.env.ENNOIA_TRIP_GENERATION_HASH = "agent-hash";
  process.env.ENNOIA_API_KEY = "secret-key";
  process.env.KTO_SERVICE_KEY = "kto-key";

  globalThis.fetch = async (url) => {
    const parsed = new URL(url);
    if (parsed.hostname === "apis.data.go.kr") {
      if (parsed.pathname.endsWith("/searchFestival2")) {
        return ktoResponse({
          totalCount: 1,
          item: {
            contentid: "2390168",
            contenttypeid: "15",
            title: "부산원아시아페스티벌(BOF) with NOL",
            addr1: "부산광역시 연제구 월드컵대로 344 (거제동)",
            eventstartdate: "20260627",
            eventenddate: "20260628",
            mapx: "129.0603",
            mapy: "35.191"
          }
        });
      }

      if (parsed.pathname.endsWith("/searchKeyword2")) {
        return ktoResponse({ totalCount: 0, item: [] });
      }

      if (parsed.pathname.endsWith("/detailIntro2")) {
        return ktoResponse({
          totalCount: 1,
          item: {
            contentid: "2390168",
            eventstartdate: "20260627",
            eventenddate: "20260628",
            playtime: "13:00~21:00",
            eventplace: "부산아시아드주경기장",
            program: "K-POP 공연"
          }
        });
      }
    }

    return {
      ok: true,
      headers: { get: () => "application/json" },
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                title: "부산 BOF 여행",
                days: [
                  {
                    date: "2026-06-27",
                    title: "BOF 관람",
                    items: [
                      tripItemForDate("2026-06-27", "11:30", "12:30", "부산 도착 및 점심", "센텀시티", "meal"),
                      tripItemForDate("2026-06-27", "13:00", "21:00", "부산원아시아페스티벌(BOF) with NOL 관람", "부산아시아드주경기장", "outdoor"),
                      tripItemForDate("2026-06-27", "21:00", "22:00", "광안리 저녁 식사", "광안리해수욕장", "meal")
                    ]
                  },
                  {
                    date: "2026-06-28",
                    title: "귀가",
                    items: [tripItemForDate("2026-06-28", "10:00", "11:00", "해운대 산책", "해운대해수욕장", "outdoor")]
                  }
                ],
                eventSuggestions: [],
                warnings: [],
                apiStatus: []
              })
            }
          }
        ]
      })
    };
  };

  try {
    const generation = await generateItineraryPlan({
      region: "부산",
      startDate: "2026-06-27",
      endDate: "2026-06-28",
      requests: "부산원아시아페스티벌 공연 중심 여행으로 만들어줘",
      transportMode: "car"
    });

    const dinner = generation.items.find((item) => item.title === "광안리 저녁 식사");
    assert.equal(dinner.startsAt, "2026-06-27T21:30:00+09:00");
    assert.equal(dinner.endsAt, "2026-06-27T22:30:00+09:00");
    assert.ok(generation.trip.warnings.some((warning) => /행사 후 이동 여유 보정/.test(warning)));
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

function tripItemForDate(date, start, end, title, placeName, category) {
  return {
    title,
    placeName,
    address: "경기 고양시",
    lat: 37.6004,
    lng: 126.8245,
    startsAt: `${date}T${start}:00+09:00`,
    endsAt: `${date}T${end}:00+09:00`,
    transportMode: "car",
    travelMinutesBefore: 25,
    category,
    memo: "KTO/Kakao 후보"
  };
}

function ktoResponse({ totalCount = 0, item = [] } = {}) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      response: {
        header: { resultCode: "0000", resultMsg: "OK" },
        body: {
          totalCount,
          items: { item }
        }
      }
    })
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
