import { createFallbackTrip, normalizeGeneratedTrip, normalizeTripRequest } from "../src/domain/generatedTrip.js";
import { parseBalancedJsonObjects, parseFirstBalancedJsonObject } from "./ennoiaJson.js";
import { hasFestivalIntent, scoutKtoFestivals } from "./festivalScoutService.js";

export async function generateItineraryPlan(input) {
  const request = normalizeTripRequest(input);
  const festivalScout = await scoutFestivalsForRequest(request);
  const endpoint = process.env.ENNOIA_TRIP_GENERATION_ENDPOINT || process.env.ENNOIA_NATURAL_EDIT_ENDPOINT;
  const apiKey = process.env.ENNOIA_API_KEY;
  const timeoutMs = normalizeTimeout(process.env.ENNOIA_TRIP_GENERATION_TIMEOUT_MS, 60_000);

  if (!endpoint || !apiKey) {
    return completeGeneratedTrip(createFallbackTrip(request, "Ennoia 여행관제 판단 엔진 엔드포인트 미설정"), request, festivalScout);
  }

  const endpointConfig = getEndpointConfig(endpoint);
  if (endpointConfig.type === "preset" && !endpointConfig.hash) {
    return completeGeneratedTrip(createFallbackTrip(request, "Ennoia 여행관제 판단 엔진 hash 미설정"), request, festivalScout);
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
        body: JSON.stringify(buildEnnoiaTripRequest(request, endpointConfig, festivalScout))
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
      apiStatus: ["Ennoia 여행관제 판단 엔진 응답 수신", ...retryStatuses, ...festivalScout.apiStatus, ...parsed.apiStatus]
    });
    if (!generation.trip.apiStatus.some((status) => status.includes("여행관제 판단 엔진"))) {
      generation.trip.apiStatus.unshift("Ennoia 여행관제 판단 엔진 응답 수신");
    }
    generation.trip.apiStatus = limitStringList(generation.trip.apiStatus);
    return completeGeneratedTrip(generation, request, festivalScout);
  } catch (error) {
    if (error.name === "AbortError" || error.name === "EnnoiaStreamTimeoutError") {
      return completeGeneratedTrip(createEnnoiaDelayedTrip(request, timeoutMs), request, festivalScout);
    }
    return completeGeneratedTrip(createFallbackTrip(request, "Ennoia 여행 생성 호출 오류 · 로컬 안전 일정 구성"), request, festivalScout);
  } finally {
    clearTimeout(timeout);
  }
}

async function scoutFestivalsForRequest(request) {
  const explicitIntent = hasFestivalIntent(request);
  if (!explicitIntent && !shouldDiscoverLocalFestivalCandidates(request)) {
    return { source: "kto", status: "skipped", events: [], apiStatus: [] };
  }
  try {
    const scout = await scoutKtoFestivals(request);
    return {
      ...scout,
      intent: explicitIntent ? "explicit" : "local-date"
    };
  } catch (error) {
    return {
      source: "kto",
      status: "error",
      events: [],
      apiStatus: [`KTO 행사 스카우트 오류: ${error.message}`]
    };
  }
}

function shouldDiscoverLocalFestivalCandidates(request = {}) {
  return Boolean(
    request.startDate &&
      request.endDate &&
      (request.region || request.resolvedRegion?.queryRegion || request.resolvedRegion?.region) &&
      request.resolvedRegion?.region
  );
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

function completeGeneratedTrip(generation, request, festivalScout = {}) {
  return repairSameDayTimelineConflicts(
    applyFestivalScoutToGeneration(extendEarlyEndingDays(completeMissingDays(generation, request), request), request, festivalScout)
  );
}

function applyFestivalScoutToGeneration(generation, request, festivalScout = {}) {
  const events = Array.isArray(festivalScout.events) ? festivalScout.events : [];
  if (events.length === 0) {
    generation.trip.apiStatus = limitStringList([...(generation.trip.apiStatus || []), ...(festivalScout.apiStatus || [])]);
    return generation;
  }

  generation.trip.eventSuggestions = mergeEventSuggestions(generation.trip.eventSuggestions, events);
  generation.trip.apiStatus = limitStringList([...(festivalScout.apiStatus || []), ...(generation.trip.apiStatus || [])]);

  const explicitIntent = hasFestivalIntent(request);
  const autoAttach = !explicitIntent && shouldAutoAttachDiscoveredFestival(request, festivalScout, events);
  if (!explicitIntent && !autoAttach) return generation;

  const highlights = selectFestivalHighlights(events, request, generation, { autoAttach });
  if (!highlights.length) return generation;

  const warningUpdates = [];
  for (const highlight of highlights) {
    if (alignScheduledHighlight(generation, highlight, events)) {
      warningUpdates.push(`행사 시간 보정: ${highlight.title}`);
      continue;
    }

    if (hasScheduledHighlight(generation, highlight, events)) continue;

    injectFestivalHighlight(generation, request, highlight);
    warningUpdates.push(`행사 일정 보강: ${highlight.title}`);
  }
  warningUpdates.push(...protectPostFestivalBuffers(generation, highlights, events));
  if (warningUpdates.length) {
    generation.trip.warnings = limitStringList([...warningUpdates, ...(generation.trip.warnings || [])]);
  }
  return generation;
}

function shouldAutoAttachDiscoveredFestival(request = {}, festivalScout = {}, events = []) {
  if (festivalScout.intent !== "local-date") return false;
  if (events.length !== 1) return false;
  const event = events[0];
  if (!Array.isArray(event.highlights) || event.highlights.length === 0) return false;
  return event.highlights.some((highlight) => request.days.includes(highlight.date));
}

function mergeEventSuggestions(existing = [], events = []) {
  const seen = new Set();
  const result = [];
  for (const event of [...(existing || []), ...events]) {
    const title = String(event?.title || "").trim();
    if (!title || seen.has(title)) continue;
    seen.add(title);
    result.push({
      id: String(event.id || event.contentId || event.contentid || `event-${result.length + 1}`).trim(),
      title,
      dateRange: event.dateRange || [event.startDate, event.endDate].filter(Boolean).join("~"),
      area: event.area || event.address || event.placeName || "",
      reason: event.reason || event.playtime || ""
    });
    if (result.length >= 5) break;
  }
  return result;
}

function selectFestivalHighlights(events, request, generation, options = {}) {
  const requestText = `${request.requests || ""} ${request.interests || ""}`;
  const highlights = events
    .flatMap((event) => (event.highlights || []).map((highlight) => ({ ...highlight, eventId: event.id, eventTitle: event.title })))
    .filter((highlight) => request.days.includes(highlight.date));

  if (!highlights.length) return [];
  if (options.autoAttach) {
    const primaryEventId = events[0]?.id;
    return highlights.filter((highlight) => highlight.eventId === primaryEventId && !hasScheduledHighlight(generation, highlight, events));
  }

  const requested = highlights
    .map((highlight) => ({ highlight, score: requestedHighlightScore(highlight, request) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);
  if (requested.length) {
    const bestScore = requested[0].score;
    const best = requested.filter((entry) => entry.score === bestScore).map((entry) => entry.highlight);
    if (/드론|불꽃/.test(requestText) && best.some((highlight) => /드론|불꽃/.test(`${highlight.title} ${highlight.memo}`))) {
      return best.filter((highlight) => /드론|불꽃/.test(`${highlight.title} ${highlight.memo}`));
    }
    return [best.find((highlight) => !hasScheduledHighlight(generation, highlight, events)) || best[0]];
  }

  const direct = highlights.filter((highlight) => {
    const text = `${highlight.title} ${highlight.memo}`;
    return (/드론|불꽃/.test(requestText) && /드론|불꽃/.test(text)) || (/공연/.test(requestText) && /공연|쇼/.test(text));
  });
  if (direct.length) return direct;

  const unscheduled = highlights.find((highlight) => !hasScheduledHighlight(generation, highlight, events));
  return [unscheduled || highlights[0]];
}

function requestedHighlightScore(highlight, request) {
  const text = compactMatchText(`${highlight.eventTitle || ""} ${highlight.title || ""}`);
  let score = 0;
  for (const term of requestedEventTerms(request)) {
    const compact = compactMatchText(term);
    if (!compact || compact.length < 3) continue;
    if (text.includes(compact)) score += compact.length >= 7 ? 120 : 24;
  }
  return score;
}

function requestedEventTerms(request) {
  const text = `${request.requests || ""} ${request.interests || ""}`;
  const explicit = text.match(/[가-힣A-Za-z0-9]+(?:문화제|축제|페스티벌|불꽃쇼|드론(?:라이트)?쇼|콘서트|공연|도서전|영화제|음악회|엑스포|박람회|페스타|아트페어|야시장|마켓|전시)/g) || [];
  const loose = text
    .split(/[^가-힣A-Za-z0-9]+/)
    .map((term) => term.trim())
    .filter((term) => term.length >= 3 && !/^(축제|행사|공연|여행|일정|중심|관람|보고|가고|싶어|만들어줘)$/.test(term));
  return [...new Set([...explicit, ...loose])];
}

function compactMatchText(value) {
  return String(value || "").replace(/\s+/g, "");
}

function protectPostFestivalBuffers(generation, highlights, events = []) {
  const warnings = [];
  for (const highlight of highlights) {
    const fixedItem = findMatchingHighlightItem(generation, highlight, events);
    if (!fixedItem?.endsAt) continue;
    const day = generation.trip.days.find((candidate) => candidate.date === highlight.date);
    if (!day) continue;

    const dayItems = getDayItems(generation, day).sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
    const fixedIndex = dayItems.findIndex((item) => item.id === fixedItem.id);
    if (fixedIndex < 0 || fixedIndex >= dayItems.length - 1) continue;

    const nextItem = dayItems[fixedIndex + 1];
    const desiredStart = minutesOfDay(fixedItem.endsAt) + Math.max(30, Number(nextItem.travelMinutesBefore) || 25);
    const nextStart = minutesOfDay(nextItem.startsAt);
    if (!Number.isFinite(desiredStart) || !Number.isFinite(nextStart) || nextStart >= desiredStart) continue;

    shiftDayItems(dayItems.slice(fixedIndex + 1), desiredStart - nextStart);
    sortDayItemIds(generation, day);
    warnings.push(`행사 후 이동 여유 보정: ${fixedItem.title}`);
  }

  if (warnings.length) generation.items.sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
  return warnings;
}

function repairSameDayTimelineConflicts(generation) {
  const warnings = [];
  for (const day of generation.trip.days || []) {
    const dayItems = getDayItems(generation, day).sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
    let cursor = null;
    for (const item of dayItems) {
      const start = minutesOfDay(item.startsAt);
      const end = minutesOfDay(item.endsAt);
      if (!Number.isFinite(start) || !Number.isFinite(end)) continue;

      if (Number.isFinite(cursor) && start < cursor) {
        const smallTravelGap = Math.min(15, Math.max(0, Number(item.travelMinutesBefore) || 0));
        const desiredStart = Math.min(23 * 60 + 59, cursor + smallTravelGap);
        const delta = desiredStart - start;
        item.startsAt = shiftDateTime(item.startsAt, delta);
        item.endsAt = shiftDateTime(item.endsAt, delta);
        warnings.push(`겹친 일정 시간 보정: ${item.title}`);
      }
      cursor = Math.max(cursor ?? -Infinity, minutesOfDay(item.endsAt));
    }
    sortDayItemIds(generation, day);
  }

  if (warnings.length) {
    generation.items.sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
    generation.trip.warnings = limitStringList([...warnings, ...(generation.trip.warnings || [])]);
  }
  return generation;
}

function shiftDayItems(items, deltaMinutes) {
  for (const item of items) {
    item.startsAt = shiftDateTime(item.startsAt, deltaMinutes);
    item.endsAt = shiftDateTime(item.endsAt, deltaMinutes);
  }
}

function shiftDateTime(value, deltaMinutes) {
  const match = String(value || "").match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(:\d{2})?(.*)$/);
  if (!match) return value;
  const total = Number(match[2]) * 60 + Number(match[3]) + deltaMinutes;
  const capped = Math.min(23 * 60 + 59, Math.max(0, total));
  const hour = Math.floor(capped / 60);
  const minute = capped % 60;
  return `${match[1]}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}${match[4] || ":00"}${match[5] || ""}`;
}

function hasScheduledHighlight(generation, highlight, events = []) {
  return Boolean(findMatchingHighlightItem(generation, highlight, events));
}

function alignScheduledHighlight(generation, highlight, events = []) {
  if (!highlight?.startsAt || !highlight?.endsAt) return false;
  const item = findMatchingHighlightItem(generation, highlight, events);
  if (!item) return false;
  if (item.startsAt === highlight.startsAt && item.endsAt === highlight.endsAt) return false;

  item.title = highlight.title || item.title;
  item.placeName = highlight.placeName || item.placeName;
  item.address = highlight.address || item.address || "";
  item.lat = Number.isFinite(Number(highlight.lat)) ? Number(highlight.lat) : item.lat;
  item.lng = Number.isFinite(Number(highlight.lng)) ? Number(highlight.lng) : item.lng;
  item.startsAt = highlight.startsAt;
  item.endsAt = highlight.endsAt;
  item.category = highlight.category || item.category || "outdoor";
  item.memo = highlight.memo
    ? `${highlight.memo} · KTO 행사 하이라이트 시간대로 보정`
    : `${item.memo || "KTO 행사정보 기반 일정"} · KTO 행사 하이라이트 시간대로 보정`;

  generation.items.sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
  for (const day of generation.trip.days || []) {
    sortDayItemIds(generation, day);
  }
  return true;
}

function findMatchingHighlightItem(generation, highlight, events = []) {
  const eventTitles = new Set(events.map((event) => event.title).filter(Boolean));
  const items = (generation.items || []).filter((item) => !highlight.date || String(item.startsAt || "").startsWith(`${highlight.date}T`));
  const textFor = (item) => `${item.title} ${item.placeName} ${item.memo}`;
  return (
    items.find((item) => highlight.title && textFor(item).includes(highlight.title)) ||
    items.find((item) => /드론|불꽃/.test(highlight.title || "") && /드론|불꽃/.test(textFor(item))) ||
    items.find((item) => [...eventTitles].some((title) => textFor(item).includes(title)))
  );
}

function injectFestivalHighlight(generation, request, highlight) {
  const existingIds = new Set(generation.items.map((item) => item.id));
  const id = uniqueId(highlight.id || `festival-highlight-${highlight.date}`, existingIds);
  const item = {
    id,
    title: highlight.title,
    placeName: highlight.placeName,
    address: highlight.address || "",
    lat: Number(highlight.lat),
    lng: Number(highlight.lng),
    startsAt: highlight.startsAt,
    endsAt: highlight.endsAt,
    transportMode: request.transportMode || "car",
    travelMinutesBefore: 45,
    category: highlight.category || "outdoor",
    memo: highlight.memo || "KTO 행사정보 기반 일정 보강"
  };

  generation.items.push(item);
  generation.items.sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());

  let day = generation.trip.days.find((candidate) => candidate.date === highlight.date);
  if (!day) {
    day = {
      date: highlight.date,
      title: `${generation.trip.days.length + 1}일차`,
      theme: "KTO 행사 일정 보강",
      itemIds: []
    };
    generation.trip.days.push(day);
    generation.trip.days.sort((a, b) => a.date.localeCompare(b.date));
  }

  if (!day.itemIds.includes(id)) day.itemIds.push(id);
  sortDayItemIds(generation, day);
}

function uniqueId(base, existingIds) {
  const cleaned = String(base || "festival-highlight")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "festival-highlight";
  let id = cleaned;
  let index = 1;
  while (existingIds.has(id)) {
    id = `${cleaned}-${index}`;
    index += 1;
  }
  return id;
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

function buildEnnoiaTripRequest(request, endpointConfig, festivalScout = {}) {
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
      "- 서버 사전 KTO 행사 스카우트에 events/highlights가 있으면 그 행사는 일정 item에도 반드시 편성한다.",
      "- 축제/행사/공연 요청에서 highlight.startsAt/endsAt가 제공되면 그 시간대를 우선한다.",
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
    festivalScoutForPrompt(festivalScout),
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

function festivalScoutForPrompt(festivalScout = {}) {
  const events = (festivalScout.events || []).map((event) => ({
    id: event.id,
    title: event.title,
    dateRange: event.dateRange,
    area: event.area,
    placeName: event.placeName,
    playtime: event.playtime,
    reason: event.reason,
    highlights: (event.highlights || []).map((highlight) => ({
      title: highlight.title,
      date: highlight.date,
      startsAt: highlight.startsAt,
      endsAt: highlight.endsAt,
      placeName: highlight.placeName,
      memo: highlight.memo
    }))
  }));
  if (!events.length) return "서버 사전 KTO 행사 스카우트: 확인된 지역 행사 후보 없음";
  return `서버 사전 KTO 행사 스카우트:\n${JSON.stringify({ status: festivalScout.status, events }, null, 2)}`;
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
