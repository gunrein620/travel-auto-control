import { createFallbackTrip, normalizeGeneratedTrip, normalizeTripRequest } from "../src/domain/generatedTrip.js";

export async function generateItineraryPlan(input) {
  const request = normalizeTripRequest(input);
  const endpoint = process.env.ENNOIA_TRIP_GENERATION_ENDPOINT || process.env.ENNOIA_NATURAL_EDIT_ENDPOINT;
  const apiKey = process.env.ENNOIA_API_KEY;

  if (!endpoint || !apiKey) {
    return createFallbackTrip(request, "Ennoia 여행 일정 설계 에이전트 엔드포인트 미설정");
  }

  const endpointConfig = getEndpointConfig(endpoint);
  if (endpointConfig.type === "preset" && !endpointConfig.hash) {
    return createFallbackTrip(request, "Ennoia 여행 일정 설계 에이전트 hash 미설정");
  }

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        project: process.env.ENNOIA_PROJECT_ID || "KNTO-PROMPTON-2026-544",
        apiKey
      },
      body: JSON.stringify(buildEnnoiaTripRequest(request, endpointConfig))
    });

    if (!response.ok) {
      return createFallbackTrip(request, `Ennoia 여행 생성 호출 실패(${response.status})`);
    }

    const assistantText = await extractAssistantText(response);
    const parsed = parseTripResponse(assistantText, request);
    const generation = normalizeGeneratedTrip(parsed.trip, request, {
      source: "ennoia",
      modelStatus: parsed.modelStatus,
      apiStatus: ["Ennoia 여행 일정 설계 에이전트 응답 수신", ...parsed.apiStatus]
    });
    if (!generation.trip.apiStatus.some((status) => status.includes("여행 일정 설계 에이전트"))) {
      generation.trip.apiStatus.unshift("Ennoia 여행 일정 설계 에이전트 응답 수신");
    }
    return completeMissingDays(generation, request);
  } catch (error) {
    return createFallbackTrip(request, `Ennoia 여행 생성 호출 오류: ${error.message}`);
  }
}

function completeMissingDays(generation, request) {
  const existingDates = new Set(generation.trip.days.map((day) => day.date));
  const missingDates = request.days.filter((date) => !existingDates.has(date));
  if (missingDates.length === 0) return generation;

  const fallback = createFallbackTrip(request, "Ennoia 응답 누락 날짜 보강");
  const fallbackDays = fallback.trip.days.filter((day) => missingDates.includes(day.date));
  const fallbackItemIds = new Set(fallbackDays.flatMap((day) => day.itemIds));
  const fallbackItems = fallback.items.filter((item) => fallbackItemIds.has(item.id));

  const existingIds = new Set(generation.items.map((item) => item.id));
  const safeFallbackItems = fallbackItems.map((item) => {
    if (!existingIds.has(item.id)) return item;
    return { ...item, id: `${item.id}-fallback` };
  });

  generation.trip.days.push(...fallbackDays);
  generation.trip.days.sort((a, b) => a.date.localeCompare(b.date));
  generation.items.push(...safeFallbackItems);
  generation.items.sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
  generation.trip.modelStatus = `${generation.trip.modelStatus} · 누락 날짜 보강`;
  generation.trip.apiStatus.push(`누락 날짜 보강: ${missingDates.join(", ")}`);
  generation.trip.warnings.push("Ennoia가 일부 날짜를 구조화하지 못해 안전 템플릿으로 보강했습니다.");
  return generation;
}

function parseTripResponse(text, request) {
  try {
    return {
      trip: parseJsonObject(text),
      modelStatus: "Ennoia 여행 일정 설계 에이전트 일정 생성 완료",
      apiStatus: []
    };
  } catch (error) {
    const looseTrip = extractLooseTrip(text, request);
    if (!looseTrip.days.length) throw error;
    return {
      trip: looseTrip,
      modelStatus: "Ennoia 여행 일정 설계 에이전트 응답 JSON 보정 후 일정 생성",
      apiStatus: ["Ennoia 응답이 엄격한 JSON이 아니어서 일정 블록만 보정 추출"]
    };
  }
}

function buildEnnoiaTripRequest(request, endpointConfig) {
  const systemPrompt = [
    "너는 한국관광공사 2026 프롬프톤용 여행 일정 설계 에이전트다.",
    "반드시 KTO 관광정보, Kakao Local, 날씨/현장 변수의 실시간 조회 결과를 근거로 가족 여행 일정을 만든다.",
    "식당의 현재 영업 중 여부는 Kakao Local만으로 확정하지 말고, 전화/지도 URL 확인 필요로 표시한다.",
    "자가용 일정은 Kakao Local PK6 주차장 후보를 확인하고, 요금·만차·운영시간은 현장/지도 상세 재확인 필요로 표시한다.",
    "자가용 여행은 한 번 주차 후 800m 안쪽은 walk로 이어가는 클러스터 동선을 우선한다.",
    "placeName은 실제 장소명이어야 하며, 맛집·카페·식당·쇼핑몰/마트 같은 범용명이나 후보/근처/일대만 있는 이름은 금지한다.",
    "주차장은 목적지가 아니라 차량 도착 지점이고, 목적지까지 도보 연결이 자연스러운지 memo에 짧게 남긴다.",
    "일정은 날짜별 타임테이블 형태로 만들고, 각 일정은 장소명, 시간, 분류, 좌표, 판단 메모를 포함한다.",
    "운영정보/휴무/날씨/동선 리스크가 있으면 memo와 warnings에 남긴다.",
    "반드시 JSON 객체만 반환한다. 마크다운, 코드블록, 설명 문장은 금지한다.",
    "API 원문 JSON과 서비스 키는 절대 반환하지 않는다."
  ].join("\n");

  const userPrompt = [
    "다음 조건으로 추천형 가족 여행 일정을 생성해줘.",
    JSON.stringify(request, null, 2),
    "중요 제한:",
    [
      "- request.days의 모든 날짜를 반드시 포함한다.",
      "- 날짜별 items는 오전/점심/오후/저녁 중심 4개 이하로 제한한다.",
      "- placeName은 실제 장소명만 사용한다. '행궁동 맛집', '근처 카페', '가족 식당', '수원 시내 쇼핑몰/마트 같은 범용명'은 금지한다.",
      "- 자가용 기준 같은 권역에서 한 번 주차 후 800m 안쪽은 walk로 연결하고, 짧은 구간을 반복 운전하게 만들지 않는다.",
      "- 각 날짜는 권역을 1~2개로 묶고, 주차장 후보와 마지막 목적지의 도보 연결이 자연스럽게 이어져야 한다.",
      "- 각 memo는 80자 이하로 쓰고 API 근거와 불확실성만 짧게 남긴다.",
      "- evidence, warnings, apiStatus는 각각 5개 이하, 항목당 60자 이하로 제한한다.",
      "- 전체 응답은 중간에 잘리지 않도록 간결한 JSON 객체 하나로만 반환한다."
    ].join("\n"),
    "반환 스키마:",
    JSON.stringify(
      {
        title: "string",
        days: [
          {
            date: "YYYY-MM-DD",
            title: "1일차 제목",
            theme: "동선/판단 요약",
            items: [
              {
                title: "string",
                placeName: "string",
                address: "string",
                lat: 37.2636,
                lng: 127.0286,
                startsAt: "YYYY-MM-DDTHH:mm:ss+09:00",
                endsAt: "YYYY-MM-DDTHH:mm:ss+09:00",
                transportMode: "walk | subway | bus | taxi | car",
                travelMinutesBefore: 25,
                category: "indoor | outdoor | meal",
                memo: "KTO/Kakao/날씨 근거와 불확실성"
              }
            ]
          }
        ],
        evidence: ["KTO/Kakao/날씨 확인 요약"],
        warnings: ["불확실한 정보"],
        apiStatus: ["각 API 확인 상태"]
      },
      null,
      2
    )
  ].join("\n\n");

  const messages = [
    {
      role: "user",
      content: [
        {
          type: "text",
          text: `${systemPrompt}\n\n${userPrompt}`
        }
      ]
    }
  ];

  if (endpointConfig.type === "preset") {
    return {
      hash: endpointConfig.hash,
      params: {},
      messages
    };
  }

  return {
    ...endpointConfig.ids,
    messages
  };
}

function getEndpointConfig(endpoint = "") {
  const endpointText = String(endpoint || "");
  const isPreset = endpointText.includes("/api/preset/");
  return {
    type: isPreset ? "preset" : "orchestrator",
    hash:
      process.env.ENNOIA_TRIP_GENERATION_HASH ||
      process.env.ENNOIA_AGENT_HASH ||
      extractHashFromEndpoint(endpointText),
    ids: extractEndpointIds(endpointText)
  };
}

function extractHashFromEndpoint(endpoint = "") {
  try {
    return new URL(endpoint).searchParams.get("hash") || "";
  } catch {
    return "";
  }
}

function extractEndpointIds(endpoint = "") {
  const match = String(endpoint).match(/\/stream\/([^/]+)\/([^/?]+)/);
  if (!match) return {};
  return {
    multiAgentId: match[1],
    multiAgentVersion: match[2]
  };
}

async function extractAssistantText(response) {
  const contentType = response.headers?.get?.("content-type") || "";
  if (contentType.includes("text/event-stream")) {
    return parseSseText(await response.text());
  }

  const payload = await response.json();
  return (
    extractTextContent(payload.output) ||
    extractTextContent(payload.text) ||
    extractTextContent(payload.content) ||
    extractTextContent(payload.message?.content) ||
    extractTextContent(payload.choices?.[0]?.message?.content) ||
    extractTextContent(payload.choices?.[0]?.delta?.content) ||
    JSON.stringify(payload)
  );
}

function parseSseText(text) {
  let content = "";
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const data = trimmed.slice(5).trim();
    if (!data || data === "[DONE]") continue;
    try {
      const payload = JSON.parse(data);
      content +=
        extractTextContent(payload.output) ||
        extractTextContent(payload.text) ||
        extractTextContent(payload.content) ||
        extractTextContent(payload.message?.content) ||
        extractTextContent(payload.choices?.[0]?.delta?.content) ||
        extractTextContent(payload.choices?.[0]?.message?.content) ||
        "";
    } catch {
      if (!["reserved", "start", "connected"].includes(data)) content += data;
    }
  }
  return content;
}

function extractTextContent(content) {
  if (!content) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part?.type === "text" && typeof part.text === "string") return part.text;
        if (typeof part?.text === "string") return part.text;
        return "";
      })
      .join("");
  }
  if (typeof content.text === "string") return content.text;
  return "";
}

function parseJsonObject(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) throw new Error("empty Ennoia response");
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Ennoia response did not include JSON");
    return JSON.parse(match[0]);
  }
}

function extractLooseTrip(text, request) {
  const title = matchProperty(text, "title") || `${request.region} ${request.days.length}일 여행`;
  const dayMap = new Map(request.days.map((date, index) => [date, { date, title: `${index + 1}일차`, items: [] }]));
  const itemBlocks = String(text).match(/\{[^{}]*"title"\s*:\s*"[^"]+"[^{}]*"placeName"\s*:\s*"[^"]+"[^{}]*"startsAt"\s*:\s*"[^"]+"[^{}]*"endsAt"\s*:\s*"[^"]+"[^{}]*\}/g) || [];

  for (const block of itemBlocks) {
    const startsAt = matchProperty(block, "startsAt");
    const date = startsAt?.slice(0, 10);
    if (!date || !dayMap.has(date)) continue;
    dayMap.get(date).items.push({
      title: matchProperty(block, "title"),
      placeName: matchProperty(block, "placeName"),
      address: matchProperty(block, "address"),
      lat: matchProperty(block, "lat"),
      lng: matchProperty(block, "lng"),
      startsAt,
      endsAt: matchProperty(block, "endsAt"),
      transportMode: matchProperty(block, "transportMode") || request.transportMode,
      travelMinutesBefore: matchProperty(block, "travelMinutesBefore") || 25,
      category: matchProperty(block, "category") || "indoor",
      memo: matchProperty(block, "memo") || "Ennoia 응답에서 일정 블록을 추출"
    });
  }

  return {
    title,
    days: [...dayMap.values()].filter((day) => day.items.length > 0),
    apiStatus: ["Ennoia 응답 보정 추출"],
    evidence: ["Ennoia 여행 일정 설계 에이전트가 생성한 일정 블록을 파싱"],
    warnings: ["응답이 엄격한 JSON이 아니면 일부 설명 필드는 제외될 수 있음"]
  };
}

function matchProperty(text, key) {
  const stringMatch = String(text).match(new RegExp(`"${key}"\\s*:\\s*"([^"]*)"`, "u"));
  if (stringMatch) return stringMatch[1];
  const numberMatch = String(text).match(new RegExp(`"${key}"\\s*:\\s*(-?\\d+(?:\\.\\d+)?)`, "u"));
  return numberMatch ? numberMatch[1] : "";
}
