import { createFallbackTrip, normalizeGeneratedTrip, normalizeTripRequest } from "../src/domain/generatedTrip.js";
import { parseBalancedJsonObjects, parseFirstBalancedJsonObject } from "./ennoiaJson.js";

export async function generateItineraryPlan(input) {
  const request = normalizeTripRequest(input);
  const endpoint = process.env.ENNOIA_TRIP_GENERATION_ENDPOINT || process.env.ENNOIA_NATURAL_EDIT_ENDPOINT;
  const apiKey = process.env.ENNOIA_API_KEY;
  const timeoutMs = normalizeTimeout(process.env.ENNOIA_TRIP_GENERATION_TIMEOUT_MS, 60_000);

  if (!endpoint || !apiKey) {
    return createFallbackTrip(request, "Ennoia 여행관제 판단 엔진 엔드포인트 미설정");
  }

  const endpointConfig = getEndpointConfig(endpoint);
  if (endpointConfig.type === "preset" && !endpointConfig.hash) {
    return createFallbackTrip(request, "Ennoia 여행관제 판단 엔진 hash 미설정");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const retryStatuses = [];
  const maxAttempts = 3;
  try {
    let response;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      response = await fetch(endpoint, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          project: process.env.ENNOIA_PROJECT_ID || "KNTO-PROMPTON-2026-544",
          apiKey
        },
        body: JSON.stringify(buildEnnoiaTripRequest(request, endpointConfig))
      });

      if (response.ok) break;

      const errorText = await safeReadResponseText(response);
      if (!shouldRetryEnnoiaResponse(response.status, errorText) || attempt >= maxAttempts) {
        return createFallbackTrip(request, `Ennoia 여행 생성 호출 실패(${response.status})`);
      }

      retryStatuses.push(`Ennoia 일시 오류(${response.status}) 재시도 ${attempt}`);
      await waitForRetry(attempt * 1_500, controller.signal);
    }

    const assistantText = await extractAssistantText(response, timeoutMs);
    const parsed = parseTripResponse(assistantText, request);
    const generation = normalizeGeneratedTrip(parsed.trip, request, {
      source: "ennoia",
      modelStatus: parsed.modelStatus,
      apiStatus: ["Ennoia 여행관제 판단 엔진 응답 수신", ...retryStatuses, ...parsed.apiStatus]
    });
    if (!generation.trip.apiStatus.some((status) => status.includes("여행관제 판단 엔진"))) {
      generation.trip.apiStatus.unshift("Ennoia 여행관제 판단 엔진 응답 수신");
    }
    generation.trip.apiStatus = limitStringList(generation.trip.apiStatus);
    return completeGeneratedTrip(generation, request);
  } catch (error) {
    if (error.name === "AbortError" || error.name === "EnnoiaStreamTimeoutError") {
      return createEnnoiaDelayedTrip(request, timeoutMs);
    }
    return createFallbackTrip(request, "Ennoia 여행 생성 호출 오류 · 로컬 안전 일정 구성");
  } finally {
    clearTimeout(timeout);
  }
}

function createEnnoiaDelayedTrip(request, timeoutMs) {
  const seconds = Math.round(timeoutMs / 1000);
  const generation = createFallbackTrip(request, `Ennoia 최종 응답 지연(${seconds}초)`);
  generation.trip.source = "fallback";
  generation.trip.modelStatus = `Ennoia 판단 엔진 응답 지연(${seconds}초) · 로컬 안전 일정 구성`;
  generation.trip.apiStatus = limitStringList([
    "Ennoia 여행관제 판단 엔진 연결 확인",
    `구조화 응답 ${seconds}초 초과`,
    "로컬 안전 일정으로 임시 구성",
    ...(generation.trip.apiStatus || []).filter((status) => !/시간 초과|fallback|엔드포인트 미설정|hash 미설정/i.test(status))
  ]);
  generation.trip.evidence = limitStringList([
    "Ennoia 판단 엔진 응답이 지연되어 로컬 안전 일정을 표시합니다.",
    ...(generation.trip.evidence || [])
  ]);
  generation.trip.warnings = limitStringList([
    "Ennoia 판단 엔진 응답이 지연되어 임시 로컬 안전안을 표시합니다.",
    ...(generation.trip.warnings || []).filter((warning) => !/로컬 추천안|직접 호출/i.test(warning))
  ]);
  return generation;
}

function normalizeTimeout(value, fallback) {
  const timeout = Number(value);
  if (!Number.isFinite(timeout) || timeout < 1_000) return fallback;
  return Math.min(timeout, 110_000);
}

async function safeReadResponseText(response) {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

function shouldRetryEnnoiaResponse(status, text) {
  if (status === 429) return true;
  if (status < 500) return false;
  return /FAIL_AGENT_NETWORK|REDIS_ERROR|Proxy chat error|Dispatch API error/i.test(String(text || "")) || status >= 500;
}

function waitForRetry(ms, signal) {
  if (signal.aborted) {
    return Promise.reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
  }
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
      },
      { once: true }
    );
  });
}

function completeGeneratedTrip(generation, request) {
  return extendEarlyEndingDays(completeMissingDays(generation, request), request);
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
  generation.trip.apiStatus = limitStringList(generation.trip.apiStatus);
  generation.trip.warnings = limitStringList(generation.trip.warnings);
  return generation;
}

function extendEarlyEndingDays(generation, request) {
  let fallback;
  const existingIds = new Set(generation.items.map((item) => item.id));

  generation.trip.days.forEach((day, dayIndex) => {
    const dayItems = getDayItems(generation, day);
    if (!needsFullDayCoverage(dayItems, request, dayIndex)) return;

    fallback ||= createFallbackTrip(request, "Ennoia 조기 종료 일정 보강");
    const dinner = findFallbackDinner(fallback, day.date);
    if (!dinner) return;

    removeUtilityParkingItems(generation, day);

    const safeDinner = withUniqueId(dinner, existingIds, "evening");
    existingIds.add(safeDinner.id);
    generation.items.push(safeDinner);
    day.itemIds.push(safeDinner.id);
    sortDayItemIds(generation, day);
    generation.items.sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
    generation.trip.modelStatus = appendStatus(generation.trip.modelStatus, "저녁 일정 보강");
    generation.trip.apiStatus.unshift(`조기 종료 보강: ${day.date}`);
    generation.trip.warnings.unshift("저녁 일정 보강: Ennoia 일정이 너무 일찍 끝나 안전 템플릿을 추가했습니다.");
  });

  generation.trip.apiStatus = limitStringList(generation.trip.apiStatus);
  generation.trip.warnings = limitStringList(generation.trip.warnings);
  return generation;
}

function getDayItems(generation, day) {
  const itemsById = new Map(generation.items.map((item) => [item.id, item]));
  return day.itemIds.map((id) => itemsById.get(id)).filter(Boolean);
}

function needsFullDayCoverage(dayItems, request, dayIndex) {
  if (!dayItems.length) return false;
  const hasEveningMeal = dayItems.some(isEveningMeal);
  const latestEnd = Math.max(...dayItems.map((item) => minutesOfDay(item.endsAt)).filter(Number.isFinite));
  const shouldIncludeDinner = request.days.length === 1 || dayIndex < request.days.length - 1;
  if (shouldIncludeDinner && !hasEveningMeal) return true;
  const minimumEnd = shouldIncludeDinner ? 18 * 60 : 15 * 60;
  return Number.isFinite(latestEnd) && latestEnd < minimumEnd;
}

function findFallbackDinner(fallback, date) {
  const fallbackDay = fallback.trip.days.find((day) => day.date === date);
  if (!fallbackDay) return null;
  const itemsById = new Map(fallback.items.map((item) => [item.id, item]));
  return fallbackDay.itemIds
    .map((id) => itemsById.get(id))
    .find((item) => item && isEveningMeal(item));
}

function isEveningMeal(item) {
  if (item.category !== "meal") return false;
  const start = minutesOfDay(item.startsAt);
  const end = minutesOfDay(item.endsAt);
  const text = `${item.title} ${item.placeName} ${item.memo}`;
  return start >= 17 * 60 || (/저녁|dinner/i.test(text) && end >= 18 * 60);
}

function removeUtilityParkingItems(generation, day) {
  const removableIds = new Set(getDayItems(generation, day).filter(isUtilityParkingItem).map((item) => item.id));
  if (removableIds.size === 0) return;
  day.itemIds = day.itemIds.filter((id) => !removableIds.has(id));
  generation.items = generation.items.filter((item) => !removableIds.has(item.id));
}

function isUtilityParkingItem(item) {
  const text = `${item.title} ${item.placeName} ${item.memo}`.toLowerCase();
  const duration = minutesOfDay(item.endsAt) - minutesOfDay(item.startsAt);
  return /주차|parking|차량 도착|도보 이동/.test(text) && Number.isFinite(duration) && duration <= 45;
}

function withUniqueId(item, existingIds, suffix) {
  const base = item.id || suffix;
  let id = base;
  let counter = 1;
  while (existingIds.has(id)) {
    id = `${base}-${suffix}-${counter}`;
    counter += 1;
  }
  return { ...item, id };
}

function sortDayItemIds(generation, day) {
  const itemsById = new Map(generation.items.map((item) => [item.id, item]));
  day.itemIds.sort((a, b) => {
    const aTime = new Date(itemsById.get(a)?.startsAt || 0).getTime();
    const bTime = new Date(itemsById.get(b)?.startsAt || 0).getTime();
    return aTime - bTime;
  });
}

function minutesOfDay(value) {
  const match = String(value || "").match(/T(\d{2}):(\d{2})/);
  if (!match) return NaN;
  return Number(match[1]) * 60 + Number(match[2]);
}

function appendStatus(current, addition) {
  const text = String(current || "").trim();
  if (!text) return addition;
  if (text.includes(addition)) return text;
  return `${text} · ${addition}`;
}

function parseTripResponse(text, request) {
  try {
    const parsed = parseTripJsonObject(text);
    return {
      trip: parsed,
      modelStatus: "Ennoia 여행관제 판단 엔진 일정 생성 완료",
      apiStatus: []
    };
  } catch (error) {
    const looseTrip = extractLooseTrip(text, request);
    if (!looseTrip.days.length) throw error;
    return {
      trip: looseTrip,
      modelStatus: "Ennoia 여행관제 판단 엔진 응답 JSON 보정 후 일정 생성",
      apiStatus: ["Ennoia 응답이 엄격한 JSON이 아니어서 일정 블록만 보정 추출"]
    };
  }
}

function buildEnnoiaTripRequest(request, endpointConfig) {
  const systemPrompt = [
    "너는 한국관광공사 2026 프롬프톤용 여행관제 판단 엔진이다.",
    "사용자의 여행 조건을 해석하고 KTO 관광정보, KTO 행사정보, Kakao Local, 날씨/현장 변수 근거를 종합해 일정 생성용 구조화 JSON을 만든다.",
    "여행 날짜 범위가 있으면 KTO 행사정보로 해당 기간·지역의 축제/공연/행사를 확인하고 eventSuggestions에 제안한다.",
    "사용자가 6.23-25, 6/23~25, 6월 23일부터 25일처럼 연도 없는 기간을 쓰면 현재 KST 기준 가장 가까운 미래 날짜로 YYYY-MM-DD 범위를 해석한다.",
    "KTO 행사정보의 eventstartdate/eventenddate가 YYYYMMDD 형태면 eventSuggestions.dateRange에는 YYYY-MM-DD~YYYY-MM-DD로 변환해 넣는다.",
    "자가용은 Kakao Local PK6 주차장 후보와 800m 안쪽 walk 클러스터를 우선하고, 주차장은 독립 일정 item으로 만들지 않는다.",
    "placeName은 실제 장소명만 사용하고 범용명은 금지한다. 운영정보/휴무/날씨/동선 리스크는 memo와 warnings에 짧게 남긴다.",
    "반드시 JSON 객체만 반환한다. 마크다운, 코드블록, API 원문 JSON, 서비스 키는 금지한다."
  ].join("\n");

  const userPrompt = [
    "다음 조건으로 추천형 여행 일정을 생성해줘.",
    JSON.stringify(request),
    "중요 제한:",
    [
      "- request.requests는 사용자가 자연어로 적은 핵심 요청(인원/구성, 관심사, 맛집투어, 역사투어 등)이므로 최우선으로 반영한다.",
      "- request.days의 모든 날짜를 반드시 포함한다.",
      "- 사용자가 requests에 6.23-25 같은 압축 기간을 다시 적었으면 request.startDate/request.endDate와 충돌하지 않는지 확인하고, 답변에는 YYYY-MM-DD로 정리한다.",
      "- request.startDate~request.endDate 기간의 KTO 행사정보를 확인하고, 지역/기간/취향이 맞는 행사는 eventSuggestions에 최대 5개 넣는다.",
      "- 행사 후보를 일정에 넣지 않는 경우에도 왜 후보인지 reason에 짧게 남긴다.",
      "- 날짜별 items는 오전/점심/오후/저녁 중심 4개 이하로 제한한다.",
      "- 1일 여행과 마지막 날이 아닌 날짜는 오전 관광, 점심, 오후 관광/휴식, 저녁 식사를 모두 포함한다.",
      "- 1일 여행과 마지막 날이 아닌 날짜의 마지막 일정은 18:00 이전에 끝나면 안 된다.",
      "- 마지막 날도 사용자가 조기 귀가를 요청하지 않았다면 15:00 이전에 끝내지 않는다.",
      "- 주차장, 차량 도착, 도보 이동만을 독립 item으로 만들지 말고 목적지 memo에 넣는다.",
      "- 식사/아침/점심/저녁/브런치가 포함된 일정은 category를 반드시 meal로 둔다.",
      "- placeName은 실제 장소명만 사용한다. '행궁동 맛집', '근처 카페', '가족 식당', '수원 시내 쇼핑몰/마트 같은 범용명'은 금지한다.",
      "- 자가용 기준 같은 권역에서 한 번 주차 후 800m 안쪽은 walk로 연결하고, 짧은 구간을 반복 운전하게 만들지 않는다.",
      "- 각 날짜는 권역을 1~2개로 묶고, 주차장 후보와 마지막 목적지의 도보 연결이 자연스럽게 이어져야 한다.",
      "- 각 memo는 80자 이하로 쓰고 API 근거와 불확실성만 짧게 남긴다.",
      "- evidence, warnings, apiStatus는 각각 5개 이하, 항목당 60자 이하로 제한한다.",
      "- 전체 응답은 중간에 잘리지 않도록 간결한 JSON 객체 하나로만 반환한다."
    ].join("\n"),
    "반환 스키마:",
    JSON.stringify({
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
      eventSuggestions: [{ id: "KTO contentId 또는 event id", title: "행사명", dateRange: "YYYY-MM-DD~YYYY-MM-DD", area: "지역/주소", reason: "이 일정에 어울리는 이유 또는 확인 필요점" }],
      apiStatus: ["각 API 확인 상태"]
    })
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

async function extractAssistantText(response, timeoutMs) {
  const contentType = response.headers?.get?.("content-type") || "";
  if (contentType.includes("text/event-stream")) {
    return readSseAssistantText(response, timeoutMs);
  }

  const payload = await response.json();
  return extractAssistantTextFromPayload(payload) || JSON.stringify(payload);
}

async function readSseAssistantText(response, timeoutMs) {
  if (!response.body?.getReader) return parseSseText(await response.text());

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  const deadline = Date.now() + timeoutMs;

  while (true) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      await reader.cancel().catch(() => {});
      throw new EnnoiaStreamTimeoutError(content);
    }

    let readResult;
    try {
      readResult = await readStreamChunk(reader, remainingMs, content);
    } catch (error) {
      await reader.cancel().catch(() => {});
      throw error;
    }
    const { value, done } = readResult;
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";

    const result = consumeSseLines(lines);
    content += result.content;
    if (findUsableTripObjectInText(content) || result.done) {
      await reader.cancel().catch(() => {});
      return content;
    }
  }

  buffer += decoder.decode();
  const result = consumeSseLines(buffer.split(/\r?\n/));
  return content + result.content;
}

class EnnoiaStreamTimeoutError extends Error {
  constructor(content) {
    super("Ennoia stream did not finish before timeout");
    this.name = "EnnoiaStreamTimeoutError";
    this.content = content;
  }
}

function readStreamChunk(reader, timeoutMs, content) {
  let timeout;
  const timeoutPromise = new Promise((_, reject) => {
    timeout = setTimeout(() => reject(new EnnoiaStreamTimeoutError(content)), timeoutMs);
  });
  return Promise.race([reader.read(), timeoutPromise]).finally(() => clearTimeout(timeout));
}

function parseSseText(text) {
  return consumeSseLines(String(text || "").split("\n")).content;
}

function consumeSseLines(lines) {
  let content = "";
  let done = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const data = trimmed.slice(5).trim();
    if (!data) continue;
    if (data === "[DONE]") {
      done = true;
      continue;
    }
    try {
      const payload = JSON.parse(data);
      content += extractAssistantTextFromPayload(payload) || "";
    } catch {
      if (!["reserved", "start", "connected", "end"].includes(data)) content += data;
    }
  }
  return { content, done };
}

function extractAssistantTextFromPayload(payload) {
  return (
    extractTextContent(payload?.output) ||
    extractTextContent(payload?.text) ||
    extractTextContent(payload?.content) ||
    extractTextContent(payload?.message?.content) ||
    extractTextContent(payload?.choices?.[0]?.message?.content) ||
    extractTextContent(payload?.choices?.[0]?.delta?.content) ||
    extractNestedAssistantText(payload)
  );
}

function extractNestedAssistantText(value, seen = new Set()) {
  if (!value || typeof value !== "object") return "";
  if (seen.has(value)) return "";
  seen.add(value);

  if (Array.isArray(value)) {
    for (const entry of value) {
      const text = extractTextContent(entry) || extractNestedAssistantText(entry, seen);
      if (text) return text;
    }
    return "";
  }

  const keys = ["result", "data", "response", "answer", "payload", "event", "delta", "message", "messages", "output", "content", "text", "choices"];
  for (const key of keys) {
    const child = value[key];
    const text = extractTextContent(child) || extractNestedAssistantText(child, seen);
    if (text) return text;
  }
  return "";
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
  return parseFirstBalancedJsonObject(text);
}

function parseTripJsonObject(text) {
  const tripObject = findUsableTripObjectInText(text);
  if (tripObject) return tripObject;
  const objects = parseBalancedJsonObjects(text);
  if (objects.length > 0) return unwrapTripObject(objects[0]) || objects[0];
  return parseJsonObject(text);
}

function findUsableTripObjectInText(text) {
  let objects;
  try {
    objects = parseBalancedJsonObjects(text);
  } catch {
    return null;
  }
  for (const object of objects) {
    const trip = unwrapTripObject(object);
    if (isUsableTripObject(trip)) return trip;
  }
  return null;
}

function unwrapTripObject(value, seen = new Set()) {
  if (!value) return null;

  if (typeof value === "string") {
    try {
      return unwrapTripObject(parseJsonObject(value), seen);
    } catch {
      return null;
    }
  }

  if (typeof value !== "object") return null;
  if (seen.has(value)) return null;
  seen.add(value);

  if (Array.isArray(value)) {
    for (const entry of value) {
      const trip = unwrapTripObject(entry, seen);
      if (trip) return trip;
    }
    return null;
  }

  if (isTripContainer(value)) return value;

  const keys = ["trip", "result", "data", "response", "answer", "payload", "output", "text", "content", "message", "messages", "choices"];
  for (const key of keys) {
    const trip = unwrapTripObject(value[key], seen);
    if (trip) return trip;
  }
  return null;
}

function isTripContainer(value) {
  if (!value || typeof value !== "object") return false;
  return Array.isArray(value.days) || Array.isArray(value.trip?.days);
}

function isUsableTripObject(value) {
  if (!isTripContainer(value)) return false;
  const rawTrip = value.trip || value;
  return rawTrip.days.some((day) => {
    const items = day?.items || day?.schedule || day?.activities;
    return Array.isArray(items) && items.length > 0;
  });
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
    evidence: ["Ennoia 여행관제 판단 엔진이 생성한 일정 블록을 파싱"],
    warnings: ["응답이 엄격한 JSON이 아니면 일부 설명 필드는 제외될 수 있음"]
  };
}

function matchProperty(text, key) {
  const stringMatch = String(text).match(new RegExp(`"${key}"\\s*:\\s*"([^"]*)"`, "u"));
  if (stringMatch) return stringMatch[1];
  const numberMatch = String(text).match(new RegExp(`"${key}"\\s*:\\s*(-?\\d+(?:\\.\\d+)?)`, "u"));
  return numberMatch ? numberMatch[1] : "";
}

function limitStringList(value, limit = 5) {
  const seen = new Set();
  const result = [];
  for (const entry of value || []) {
    const text = String(entry || "").trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    result.push(text);
    if (result.length >= limit) break;
  }
  return result;
}
