import { getKstHour } from "../src/domain/time.js";
import { searchNearbyPlaces } from "./placeSearchService.js";
import { searchTouristPlaces } from "./touristSearchService.js";

export const SAFE_NATURAL_EDIT_PATCH_KEYS = new Set([
  "title",
  "placeName",
  "address",
  "lat",
  "lng",
  "startsAt",
  "endsAt",
  "transportMode",
  "travelMinutesBefore",
  "category",
  "memo"
]);

const PLACE_QUERIES = [
  {
    keywords: ["역사 관광지", "역사", "문화유산", "유적", "고궁"],
    query: "역사 관광지",
    label: "역사 관광지",
    genericPlaceName: "근처 역사 관광지",
    matchTerms: ["역사", "문화", "유적", "관광지"],
    source: "kto",
    category: "outdoor"
  },
  {
    keywords: ["박물관", "전시", "미술관", "실내 관광", "실내"],
    query: "박물관",
    label: "실내 관광지",
    genericPlaceName: "근처 실내 관광지",
    matchTerms: ["박물관", "미술관", "전시", "문화시설"],
    source: "kto",
    category: "indoor"
  },
  {
    keywords: ["공원", "산책", "야외 관광", "야외"],
    query: "공원",
    label: "야외 관광지",
    genericPlaceName: "근처 야외 관광지",
    matchTerms: ["공원", "산책", "자연", "관광지"],
    source: "kto",
    category: "outdoor"
  },
  {
    keywords: ["관광지", "명소", "가볼만한 곳", "가볼 만한 곳", "볼거리", "방문지"],
    query: "관광지",
    label: "관광지",
    genericPlaceName: "근처 관광지",
    matchTerms: ["관광지", "명소", "문화시설", "여행코스"],
    source: "kto",
    category: "outdoor"
  },
  { keywords: ["송월만두"], query: "송월만두", fallbackQuery: "만두", label: "송월만두", genericPlaceName: "송월만두" },
  {
    keywords: ["삼겹살", "고기", "돼지고기"],
    query: "삼겹살",
    label: "삼겹살",
    genericPlaceName: "근처 삼겹살 맛집",
    matchTerms: ["삼겹살", "고기", "육류", "돼지", "구이"]
  },
  { keywords: ["한식", "백반"], query: "한식", label: "한식", genericPlaceName: "근처 한식당", matchTerms: ["한식", "백반"] },
  { keywords: ["중식", "짜장", "짬뽕"], query: "중식", label: "중식", genericPlaceName: "근처 중식당" },
  { keywords: ["일식", "초밥", "라멘"], query: "일식", label: "일식", genericPlaceName: "근처 일식당" },
  { keywords: ["양식", "파스타", "스테이크"], query: "양식", label: "양식", genericPlaceName: "근처 양식당" },
  { keywords: ["분식", "떡볶이", "김밥"], query: "분식", label: "분식", genericPlaceName: "근처 분식집" },
  { keywords: ["만두"], query: "만두", label: "만두", genericPlaceName: "근처 만두집" },
  { keywords: ["국밥"], query: "국밥", label: "국밥", genericPlaceName: "근처 국밥집" },
  { keywords: ["비빔밥"], query: "비빔밥", label: "비빔밥", genericPlaceName: "근처 비빔밥 식당" },
  { keywords: ["카페", "커피"], query: "카페", label: "카페", genericPlaceName: "근처 카페", matchTerms: ["카페", "커피", "cafe"] }
];

export async function draftScheduleEditWithAgent({
  text,
  items = [],
  mode = "update",
  activeDate,
  previousDraft,
  searchPlaces = searchNearbyPlaces,
  searchTouristPlaces: searchTouristPlacesFn = searchTouristPlaces,
  searchBudgetMs = 0
} = {}) {
  const requestText = clean(text);
  const sortedItems = [...items].sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
  if (!requestText) {
    return clarification("수정하거나 추가할 내용을 입력해 주세요.", { domain: "other" });
  }

  const followUp = followUpContext(requestText, previousDraft, sortedItems);
  const effectiveText = followUp.effectiveText || requestText;
  const referencedItem =
    findTargetItem(requestText, sortedItems, activeDate) || findTargetItem(effectiveText, sortedItems, activeDate) || followUp.target;
  const target = hasExplicitAddIntent(effectiveText) && mode === "add_or_update" ? null : referencedItem;
  const operation = target ? "update" : mode === "add_or_update" ? "add" : "update";
  const avoidanceDraft = draftEventAvoidance({ text: effectiveText, items: sortedItems, activeDate, target });
  if (avoidanceDraft) return avoidanceDraft;

  const timeChangeDraft = operation === "update" && target ? draftTimeChange({ text: effectiveText, target }) : null;
  if (timeChangeDraft) return timeChangeDraft;

  if (operation === "update" && !target) {
    return clarification("어떤 일정을 바꿀까요? 예: 첫날 점심, 저녁 일정, 장소명처럼 알려주세요.", {
      domain: inferDomainForClarification(effectiveText),
      choices: choicesForDomain(inferDomainForClarification(effectiveText))
    });
  }

  const desired = extractDesiredPlaceQuery(effectiveText);
  if (!desired) {
    if (followUp.excludedDomain) {
      const domain = preferredDomainAfterNegation(effectiveText, followUp.excludedDomain);
      return clarification(negationClarificationQuestion(followUp.excludedDomain, domain), {
        domain,
        targetItemId: target?.id,
        intent: domain === "meal" ? "replace_meal" : "replace_place",
        confidence: 0.62,
        filledSlots: {
          ...previousDraft?.filledSlots,
          excludedDomain: followUp.excludedDomain
        },
        choices: choicesExcludingDomain(followUp.excludedDomain)
      });
    }

    const domain = inferDomainForClarification(effectiveText, target);
    return clarification(
      operation === "add"
        ? "어떤 장소나 음식을 추가할까요? 예: 둘째날 점심에 한식집 추가처럼 알려주세요."
        : `${target.title}${objectParticle(target.title)} 무엇으로 바꿀까요? 원하는 음식이나 장소를 알려주세요.`,
      {
        domain,
        targetItemId: target?.id,
        intent: target?.category === "meal" ? "replace_meal" : "replace_place",
        confidence: 0.66,
        filledSlots: slotsForRequest(effectiveText, null, requestedMealSlot(requestText, target)),
        choices: choicesForDomain(domain)
      }
    );
  }

  const date = requestedDate(requestText, sortedItems, activeDate, target);
  const mealSlot = requestedMealSlot(requestText, target || referencedItem);
  const anchor = target || referencedItem || nearestAnchorItem(sortedItems, date) || sortedItems[0];
  const searchContext = {
    query: desired.query,
    lat: anchor?.lat,
    lng: anchor?.lng,
    radius: 1500,
    size: 5
  };

  const searchPrimary = desired.source === "kto" ? searchTouristPlacesFn : searchPlaces;
  const primary = await searchWithBudget(
    searchPrimary,
    { ...searchContext, radius: desired.source === "kto" ? 5000 : searchContext.radius },
    searchBudgetMs,
    searchTimeoutResult(desired)
  );
  const primaryItems = relevantPlaces(primary.items, desired);
  let selected = primaryItems[0];
  let resolutionMessage = "";
  let searchSource = primary;
  const alternatives = [...primaryItems];

  if (!selected && fallbackQueryFor(desired)) {
    const fallbackQuery = fallbackQueryFor(desired);
    const fallback = await searchWithBudget(
      searchPlaces,
      { ...searchContext, query: fallbackQuery },
      searchBudgetMs,
      searchTimeoutResult({ ...desired, query: fallbackQuery })
    );
    const fallbackItems = relevantPlaces(fallback.items, { ...desired, query: fallbackQuery });
    searchSource = fallback;
    selected = fallbackItems[0];
    alternatives.push(...fallbackItems);
    if (selected) {
      resolutionMessage =
        desired.source === "kto"
          ? `KTO에서 가까운 ${desired.label} 후보를 확정하지 못해 Kakao 후보인 ${selected.name}을 보조 제안했어요.`
          : `${desired.query}를 근처에서 못 찾았어요. 대신 ${fallbackQuery} 후보인 ${selected.name}을 제안했어요.`;
    }
  }

  if (!selected) {
    selected = genericCandidate(desired, anchor);
    resolutionMessage =
      primary.items?.length > 0
        ? `${desired.query}와 명확히 맞는 후보를 근처에서 찾지 못해 ${selected.name}으로 임시 제안했어요. 지도 상세에서 재확인하세요.`
        : primary.message ||
          `${desired.query} 후보를 근처에서 찾지 못해 일반 장소명으로 임시 제안했어요. 지도 상세에서 재확인하세요.`;
  }

  const afterAnchor = hasAfterReference(requestText);
  const recommendations = buildRecommendations({
    candidates: recommendationCandidates(alternatives, selected),
    operation,
    target,
    desired,
    date,
    mealSlot,
    anchor,
    resolutionMessage,
    afterAnchor,
    source: searchSource.source
  });
  const patch = recommendations[0]?.patch || sanitizeNaturalEditPatch(
    operation === "add"
      ? buildAddPatch({ selected, desired, date, mealSlot, anchor, resolutionMessage, afterAnchor })
      : buildUpdatePatch({ selected, desired, target, mealSlot, resolutionMessage }),
    target || {}
  );

  return {
    operation,
    targetItemId: operation === "update" ? target.id : undefined,
    stage: "propose",
    domain: domainForDesired(desired),
    filledSlots: slotsForRequest(effectiveText, desired, mealSlot),
    missingSlots: [],
    choices: [],
    intent: intentFor(operation, desired),
    confidence: selected.id?.startsWith("generic-") ? 0.58 : 0.82,
    patch,
    recommendations,
    alternatives: dedupeAlternatives(alternatives).slice(0, 5),
    resolutionMessage,
    needsConfirmation: true,
    needsClarification: false,
    source: ["kakao", "kto"].includes(searchSource.source) ? "agent" : "fallback",
    modelStatus:
      searchSource.source === "kto"
        ? "일정수정 에이전트 KTO 관광정보 초안"
        : searchSource.source === "kakao"
          ? "일정수정 에이전트 장소 검색 초안"
          : "일정수정 에이전트 fallback 초안",
    confirmationMessage: confirmationMessage(operation, target, patch)
  };
}

export function sanitizeNaturalEditPatch(patch = {}, targetItem = {}) {
  const safe = {};
  for (const [key, value] of Object.entries(patch)) {
    if (!SAFE_NATURAL_EDIT_PATCH_KEYS.has(key)) continue;
    if (value === undefined || value === null || value === "") continue;
    safe[key] = value;
  }

  if (safe.lat !== undefined) safe.lat = Number(safe.lat);
  if (safe.lng !== undefined) safe.lng = Number(safe.lng);
  if (safe.travelMinutesBefore !== undefined) safe.travelMinutesBefore = Number(safe.travelMinutesBefore);
  if (safe.category && !["meal", "indoor", "outdoor"].includes(safe.category)) safe.category = targetItem.category || "meal";
  if (safe.transportMode && !["walk", "subway", "bus", "taxi", "car"].includes(safe.transportMode)) {
    safe.transportMode = targetItem.transportMode || "walk";
  }

  if (safe.placeName && !safe.title) {
    safe.title = safe.category === "meal" ? `${safe.placeName} 식사` : safe.placeName;
  }

  return safe;
}

function recommendationCandidates(alternatives = [], selected) {
  const candidates = alternatives.length ? alternatives : [selected];
  return dedupeAlternatives(candidates.filter(Boolean)).slice(0, 5);
}

function buildRecommendations({
  candidates = [],
  operation,
  target,
  desired,
  date,
  mealSlot,
  anchor,
  resolutionMessage,
  afterAnchor,
  source
}) {
  return candidates.slice(0, 5).map((candidate, index) => {
    const recommendationSource = sourceForRecommendation(candidate, source);
    const rawPatch =
      operation === "add"
        ? buildAddPatch({
            selected: candidate,
            desired,
            date,
            mealSlot,
            anchor,
            resolutionMessage,
            afterAnchor
          })
        : buildUpdatePatch({ selected: candidate, desired, target, mealSlot, resolutionMessage });
    return {
      id: recommendationId(candidate, index, recommendationSource),
      name: candidate.name || candidate.placeName || "장소 후보",
      address: candidate.address || "",
      distanceLabel: candidate.distanceLabel || "",
      source: recommendationSource,
      reason: recommendationReason(recommendationSource, desired),
      patch: sanitizeNaturalEditPatch(rawPatch, target || {}),
      placeUrl: candidate.placeUrl || ""
    };
  });
}

function sourceForRecommendation(candidate = {}, source) {
  if (candidate.id?.startsWith("generic-")) return "fallback";
  if (source === "kto") return "kto";
  if (source === "kakao") return "kakao";
  return source || "fallback";
}

function recommendationId(candidate = {}, index, source) {
  const raw = clean(candidate.id || candidate.name || candidate.placeName || String(index + 1));
  const slug = raw.replace(/\s+/g, "-").replace(/[^a-zA-Z0-9가-힣_.:-]/g, "");
  return `${source || "candidate"}-${slug || index + 1}`;
}

function recommendationReason(source, desired = {}) {
  if (source === "kto") return `KTO 관광정보에서 찾은 ${desired.label || "장소"} 후보`;
  if (source === "kakao") return `Kakao Local에서 찾은 ${desired.label || "장소"} 후보`;
  return `${desired.label || "장소"} 검색 결과가 부족해 만든 임시 후보`;
}

function searchWithBudget(searchFn, context, budgetMs, timeoutResult) {
  const ms = Number(budgetMs);
  if (!Number.isFinite(ms) || ms <= 0) return searchFn(context);

  let timeout;
  const searchPromise = Promise.resolve().then(() => searchFn(context));
  const timeoutPromise = new Promise((resolve) => {
    timeout = setTimeout(() => resolve(timeoutResult), ms);
  });

  return Promise.race([searchPromise, timeoutPromise]).finally(() => clearTimeout(timeout));
}

function searchTimeoutResult(desired = {}) {
  const query = clean(desired.query || desired.label || "장소");
  return {
    source: "fallback",
    status: "timeout",
    items: [],
    message: `${query} 검색 응답 지연 · 빠른 로컬 초안으로 임시 제안합니다.`
  };
}

function followUpContext(text, previousDraft = {}, items = []) {
  const target = previousDraft?.targetItemId ? items.find((item) => item.id === previousDraft.targetItemId) || null : null;
  const excludedDomain = negatedDomainForText(text, previousDraft);
  const effectiveText = stripNegatedDomainText(text, excludedDomain);
  const shouldCarryTarget =
    target &&
    (excludedDomain ||
      /^(아니|아냐|아니야|그거|이거|대신|그럼|응|좋아|싫어)\b/.test(clean(text)) ||
      clean(text).length <= 20);

  return {
    target: shouldCarryTarget ? target : null,
    excludedDomain,
    effectiveText
  };
}

function negatedDomainForText(text, previousDraft = {}) {
  const value = clean(text).replace(/\s+/g, " ");
  if (!value) return "";
  if (/(식사|음식|밥|먹거리|맛집|식당|먹는\s*거)\s*(은|는)?\s*말고/.test(value)) return "meal";
  if (/(카페|커피|디저트|브런치)\s*(은|는)?\s*말고/.test(value)) return "cafe";
  if (/(관광|명소|박물관|미술관|전시|공원|산책|실내|야외|방문지|축제|공연|드론|불꽃|쇼핑|휴식)\s*(은|는)?\s*말고/.test(value)) {
    return "attraction";
  }
  if (/^(아니|아냐|아니야)\b/.test(value) || /그거\s*말고|이거\s*말고/.test(value)) return previousDraft?.domain || "";
  return "";
}

function stripNegatedDomainText(text, excludedDomain) {
  let value = clean(text)
    .replace(/^(아니|아냐|아니야)\s*/g, "")
    .replace(/그거\s*말고|이거\s*말고/g, "");

  const domainPatterns = {
    meal: /(식사|음식|밥|먹거리|맛집|식당|먹는\s*거)\s*(은|는)?\s*말고/g,
    cafe: /(카페|커피|디저트|브런치)\s*(은|는)?\s*말고/g,
    attraction: /(관광|명소|박물관|미술관|전시|공원|산책|실내|야외|방문지|축제|공연|드론|불꽃|쇼핑|휴식)\s*(은|는)?\s*말고/g
  };
  if (excludedDomain && domainPatterns[excludedDomain]) value = value.replace(domainPatterns[excludedDomain], "");
  return clean(value.replace(/\s+/g, " "));
}

function preferredDomainAfterNegation(text, excludedDomain) {
  const inferred = inferDomainForClarification(text);
  if (inferred !== "other" && inferred !== excludedDomain) return inferred;
  if (excludedDomain === "meal") return "attraction";
  if (excludedDomain === "attraction") return "meal";
  if (excludedDomain === "cafe") return "attraction";
  return "other";
}

function negationClarificationQuestion(excludedDomain, nextDomain) {
  if (excludedDomain === "meal") {
    return "식사 말고 어떤 유형으로 바꿀까요? 카페, 실내 관광, 야외 산책, 휴식처럼 알려주세요.";
  }
  if (excludedDomain === "cafe") {
    return "카페 말고 어떤 유형으로 바꿀까요? 식사, 실내 관광, 야외 산책처럼 알려주세요.";
  }
  if (excludedDomain === "attraction") {
    return "관광 일정 말고 어떤 유형으로 바꿀까요? 식사, 카페, 휴식처럼 알려주세요.";
  }
  if (nextDomain === "meal") return "어떤 음식이나 식당으로 바꿀까요?";
  return "어떤 유형으로 바꿀까요? 원하는 장소나 활동을 알려주세요.";
}

function choicesExcludingDomain(excludedDomain) {
  if (excludedDomain === "meal") {
    return [
      { id: "non-meal-cafe", label: "카페", value: "카페" },
      ...choicesForDomain("attraction"),
      { id: "non-meal-rest", label: "휴식", value: "휴식" }
    ];
  }
  if (excludedDomain === "attraction") {
    return [
      ...choicesForDomain("meal").slice(0, 3),
      { id: "non-attraction-cafe", label: "카페", value: "카페" },
      { id: "non-attraction-rest", label: "휴식", value: "휴식" }
    ];
  }
  if (excludedDomain === "cafe") {
    return [...choicesForDomain("attraction"), ...choicesForDomain("meal").slice(0, 3)];
  }
  return [];
}

function findTargetItem(text, items, activeDate) {
  const explicitDate = explicitRequestedDate(text, items);
  const preferredDate = explicitDate || activeDate || "";
  const slot = requestedMealSlot(text);
  const scored = items
    .map((item, index) => ({
      item,
      index,
      score: targetItemScore({ text, item, explicitDate, preferredDate, slot })
    }))
    .filter((candidate) => candidate.score >= 35)
    .sort((a, b) => b.score - a.score || a.index - b.index);

  return scored[0]?.item || null;
}

function targetItemScore({ text, item, explicitDate, preferredDate, slot }) {
  const normalizedText = normalizeMatchText(text);
  const itemText = normalizeMatchText([item.title, item.placeName, item.memo].join(" "));
  const itemDate = dateKey(item.startsAt);
  let score = 0;

  if (explicitDate) {
    score += itemDate === explicitDate ? 42 : -60;
  } else if (preferredDate) {
    score += itemDate === preferredDate ? 18 : -12;
  }

  score += aliasMentionScore(normalizedText, valueAliases(item.title), 74, 50);
  score += aliasMentionScore(normalizedText, valueAliases(item.placeName), 24, 36);

  if (hasMealTargetIntent(text)) {
    if (item.category === "meal") score += 18;
    else score -= 12;
  }

  if (["breakfast", "lunch", "dinner"].includes(slot)) {
    if (item.category === "meal" && itemInMealSlot(item, slot)) score += 48;
    else if (item.category === "meal") score -= 10;
    if (slotTermForItem(slot) && itemText.includes(slotTermForItem(slot))) score += 20;
  }

  for (const term of activityTargetTerms(text)) {
    if (itemText.includes(normalizeMatchText(term))) score += 42;
  }

  if (hasAttractionTargetIntent(text)) {
    if (item.category && item.category !== "meal") score += 18;
    else score -= 8;
    if (/산책|공원|야외/.test(text) && item.category === "outdoor") score += 16;
    if (/실내|쇼핑|휴식/.test(text) && item.category === "indoor") score += 16;
  }

  return score;
}

function aliasMentionScore(normalizedText, aliases, fullScore, partialScore) {
  let score = 0;
  for (const alias of aliases) {
    const normalizedAlias = normalizeMatchText(alias);
    if (!normalizedAlias || !normalizedText.includes(normalizedAlias)) continue;
    score = Math.max(score, alias === aliases[0] ? fullScore : partialScore);
  }
  return score;
}

function hasMealTargetIntent(text) {
  return /아침|조식|점심|저녁|브런치|먹거리|식사|음식|맛집|밥|먹|lunch|dinner|breakfast/i.test(text);
}

function hasAttractionTargetIntent(text) {
  return /관광|명소|박물관|미술관|전시|공원|산책|실내|야외|방문지|축제|공연|드론|불꽃|쇼핑|휴식/.test(text);
}

function activityTargetTerms(text) {
  const terms = [
    "드론불꽃쇼",
    "불꽃쇼",
    "드론쇼",
    "드론",
    "불꽃",
    "축제",
    "공연",
    "관광지",
    "관광",
    "명소",
    "박물관",
    "미술관",
    "전시",
    "공원",
    "산책",
    "실내",
    "야외",
    "방문지",
    "쇼핑",
    "휴식",
    "카페"
  ];
  return terms.filter((term) => text.includes(term));
}

function slotTermForItem(slot) {
  return {
    breakfast: "아침",
    lunch: "점심",
    dinner: "저녁"
  }[slot];
}

function draftEventAvoidance({ text, items = [], activeDate, target }) {
  if (!hasAvoidanceIntent(text)) return null;
  const eventTerms = eventAvoidanceTerms(text);
  if (eventTerms.length === 0) return null;

  const date = requestedDate(text, items, activeDate, target);
  const sameDayItems = date ? items.filter((item) => dateKey(item.startsAt) === date) : items;
  const candidates = (sameDayItems.length ? sameDayItems : items).filter((item) => eventTerms.length === 0 || eventTerms.some((term) => itemMatchesTerm(item, term)));
  const eventTarget = target && (eventTerms.length === 0 || eventTerms.some((term) => itemMatchesTerm(target, term))) ? target : candidates[0];
  if (!eventTarget) return null;

  const anchor = previousSameDayItem(items, eventTarget) || eventTarget;
  const anchorPlace = clean(anchor.placeName || anchor.title);
  const patch = sanitizeNaturalEditPatch(
    {
      title: "야간 여유 휴식",
      placeName: anchorPlace ? `${anchorPlace} 주변 휴식` : "숙소 또는 근처 휴식지",
      address: anchor.address || eventTarget.address,
      lat: anchor.lat ?? eventTarget.lat,
      lng: anchor.lng ?? eventTarget.lng,
      startsAt: eventTarget.startsAt,
      endsAt: eventTarget.endsAt,
      transportMode: anchor.transportMode || eventTarget.transportMode || "walk",
      travelMinutesBefore: eventTarget.travelMinutesBefore ?? 15,
      category: "indoor",
      memo: `${eventTarget.title} 연속 관람 제외 요청 반영 · 혼잡을 피해 휴식/복귀 시간으로 확보`
    },
    eventTarget
  );

  return {
    operation: "update",
    targetItemId: eventTarget.id,
    stage: "propose",
    domain: "attraction",
    filledSlots: {
      avoidEvent: clean(eventTerms[0] || eventTarget.title),
      timeSlot: requestedMealSlot(text, eventTarget)
    },
    missingSlots: [],
    choices: [],
    intent: "replace_place",
    confidence: 0.86,
    patch,
    recommendations: [],
    alternatives: [],
    resolutionMessage: `${eventTarget.title}은 제외하고 같은 시간대를 여유 일정으로 바꾸는 초안입니다.`,
    needsConfirmation: true,
    needsClarification: false,
    source: "agent",
    modelStatus: "일정수정 에이전트 중복 행사 조정 초안",
    confirmationMessage: `${eventTarget.title}을 ${patch.title}으로 바꿀게요.`
  };
}

function hasAvoidanceIntent(text) {
  return /안\s*봐|안\s*보고|보고\s*싶지|보고싶지|보지\s*않|빼|제외|삭제|스킵|skip|말고|그만|연속/.test(text);
}

function draftTimeChange({ text, target }) {
  const clock = requestedClockTime(text);
  if (!clock) return null;

  const startParts = parseDateTimeParts(target.startsAt);
  if (!startParts) return null;

  const startsAt = dateTimeAtMinute(startParts.date, clock.totalMinutes, startParts.zone);
  const duration = durationMinutes(target.startsAt, target.endsAt) || 60;
  const endsAt = addMinutesToDateTime(startsAt, duration);
  const patch = sanitizeNaturalEditPatch(
    {
      startsAt,
      endsAt,
      memo: joinMemo([target.memo, `자연어 요청 반영: 시작 시간을 ${clock.label}로 변경`])
    },
    target
  );

  return {
    operation: "update",
    targetItemId: target.id,
    stage: "propose",
    domain: "time",
    filledSlots: {
      startTime: startsAt,
      endTime: endsAt
    },
    missingSlots: [],
    choices: [],
    intent: "change_time",
    confidence: 0.88,
    patch,
    recommendations: [],
    alternatives: [],
    resolutionMessage: `${target.title} 시작 시간을 ${clock.label}로 바꾸는 초안입니다.`,
    needsConfirmation: true,
    needsClarification: false,
    source: "agent",
    modelStatus: "일정수정 에이전트 시간 변경 초안",
    confirmationMessage: `${target.title} 시작 시간을 ${clock.label}로 바꿀게요.`
  };
}

function requestedClockTime(text) {
  const colon = clean(text).match(/(?:^|[^\d])(\d{1,2}):(\d{2})(?:[^\d]|$)/);
  if (colon) return normalizeClock(Number(colon[1]), Number(colon[2]), text);

  const korean = clean(text).match(/(오전|오후|저녁|밤|새벽)?\s*(\d{1,2})\s*시(?:\s*(\d{1,2})\s*분?)?/);
  if (!korean) return null;
  return normalizeClock(Number(korean[2]), Number(korean[3] || 0), text, korean[1]);
}

function normalizeClock(hour, minute, text, period = "") {
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 24 || minute < 0 || minute > 59) return null;
  let normalizedHour = hour;
  const hasPm = /오후|저녁|밤/.test(period || text);
  const hasAm = /오전|새벽/.test(period || text);
  if (hasPm && normalizedHour < 12) normalizedHour += 12;
  if (hasAm && normalizedHour === 12) normalizedHour = 0;
  if (normalizedHour === 24 && minute > 0) return null;
  if (normalizedHour === 24) normalizedHour = 0;
  const label = `${String(normalizedHour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  return {
    totalMinutes: normalizedHour * 60 + minute,
    label
  };
}

function parseDateTimeParts(value) {
  const match = String(value || "").match(/^(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}(?::\d{2})?((?:[+-]\d{2}:\d{2})|Z)?$/);
  if (!match) return null;
  return {
    date: match[1],
    zone: match[2] || "+09:00"
  };
}

function durationMinutes(startsAt, endsAt) {
  const start = new Date(startsAt).getTime();
  const end = new Date(endsAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return Math.round((end - start) / 60000);
}

function dateTimeAtMinute(date, minuteOfDay, zone = "+09:00") {
  const dayOffset = Math.floor(minuteOfDay / 1440);
  const normalized = ((minuteOfDay % 1440) + 1440) % 1440;
  const hour = Math.floor(normalized / 60);
  const minute = normalized % 60;
  return `${addDays(date, dayOffset)}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00${zone}`;
}

function addMinutesToDateTime(value, minutes) {
  const match = String(value || "").match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::\d{2})?((?:[+-]\d{2}:\d{2})|Z)?$/);
  if (!match) return value;
  const [, date, hourText, minuteText, zone = "+09:00"] = match;
  return dateTimeAtMinute(date, Number(hourText) * 60 + Number(minuteText) + minutes, zone);
}

function eventAvoidanceTerms(text) {
  const terms = [];
  if (/드론|불꽃|불꽃쇼|드론쇼/.test(text)) terms.push("드론", "불꽃");
  if (/공연/.test(text)) terms.push("공연");
  if (/축제/.test(text)) terms.push("축제");
  return [...new Set(terms)];
}

function itemMatchesTerm(item = {}, term) {
  return normalizeMatchText([item.title, item.placeName, item.memo].join(" ")).includes(normalizeMatchText(term));
}

function previousSameDayItem(items = [], target = {}) {
  const targetDate = dateKey(target.startsAt);
  const targetTime = new Date(target.startsAt).getTime();
  return items
    .filter((item) => item.id !== target.id && dateKey(item.startsAt) === targetDate && new Date(item.startsAt).getTime() < targetTime)
    .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())
    .at(-1);
}

function hasExplicitAddIntent(text) {
  return /추가|넣어|넣을래|넣자|하나 더|새 일정/.test(text);
}

function hasAfterReference(text) {
  return /뒤|다음|끝나고|직후|이후|(?<!오)후에|(?<!오)후로|(?<!오)후\s/u.test(text);
}

function itemAliases(item) {
  return [...new Set([...valueAliases(item.title), ...valueAliases(item.placeName)])].sort((a, b) => b.length - a.length);
}

function valueAliases(value) {
  const cleanValue = clean(value);
  if (!cleanValue) return [];
  const values = [cleanValue];
  values.push(cleanValue.split(/\s+/)[0]);
  values.push(cleanValue.replace(/(본점|점|지점|인천|서울|부산|대구|수원|전주|월미도|차이나타운|고양|일산|행주)/g, ""));
  return [...new Set(values.map(clean).filter((entry) => entry.length >= 2))].sort((a, b) => b.length - a.length);
}

function extractDesiredPlaceQuery(text) {
  return PLACE_QUERIES.find((entry) => entry.keywords.some((keyword) => text.includes(keyword))) || null;
}

function requestedDate(text, items = [], activeDate, target) {
  if (target) return dateKey(target.startsAt);
  const explicitDate = explicitRequestedDate(text, items);
  if (explicitDate) return explicitDate;
  const dates = [...new Set(items.map((item) => dateKey(item.startsAt)).filter(Boolean))].sort();
  return activeDate || dates[0];
}

function explicitRequestedDate(text, items = []) {
  const dates = [...new Set(items.map((item) => dateKey(item.startsAt)).filter(Boolean))].sort();
  if (/첫날|첫째|day\s*0?1|d\s*0?1/i.test(text)) return dates[0] || "";
  if (/둘째|두번째|2일|day\s*0?2|d\s*0?2/i.test(text)) return dates[1] || "";
  if (/셋째|세번째|3일|day\s*0?3|d\s*0?3/i.test(text)) return dates[2] || "";
  return "";
}

function requestedMealSlot(text, target) {
  if (/오전|아침 관광|morning/i.test(text)) return "morning";
  if (/오후|낮|afternoon/i.test(text)) return "afternoon";
  if (/아침|조식|breakfast/i.test(text)) return "breakfast";
  if (/점심|lunch/i.test(text)) return "lunch";
  if (/저녁|밤|dinner/i.test(text)) return "dinner";
  if (target?.category === "meal") {
    const hour = getKstHour(target.startsAt);
    if (hour < 11) return "breakfast";
    if (hour < 17) return "lunch";
    return "dinner";
  }
  return "meal";
}

function itemInMealSlot(item, slot) {
  const hour = getKstHour(item.startsAt);
  if (slot === "breakfast") return hour < 11;
  if (slot === "lunch") return hour >= 10 && hour < 17;
  if (slot === "dinner") return hour >= 17;
  return item.category === "meal";
}

function nearestAnchorItem(items, date) {
  return items.find((item) => item.category === "meal" && dateKey(item.startsAt) === date) || items.find((item) => dateKey(item.startsAt) === date);
}

function genericCandidate(desired, anchor = {}) {
  return {
    id: `generic-${desired.query}`,
    name: desired.genericPlaceName || `근처 ${desired.query}`,
    address: anchor.address || "",
    lat: anchor.lat,
    lng: anchor.lng,
    distanceMeters: 0,
    distanceLabel: "거리 미확인",
    placeUrl: "",
    category: desired.source === "kto" ? "관광지" : "place",
    categoryDetail: desired.source === "kto" ? desired.label : ""
  };
}

function relevantPlaces(items = [], desired = {}) {
  return items.filter((item) => candidateMatchesDesired(item, desired));
}

function candidateMatchesDesired(item = {}, desired = {}) {
  if (!item) return false;
  if (item.id?.startsWith("generic-")) return true;

  const haystack = normalizeMatchText([item.name, item.address, item.category, item.categoryDetail].join(" "));
  const terms = [desired.query, desired.fallbackQuery, desired.label, ...(desired.keywords || []), ...(desired.matchTerms || [])]
    .map(normalizeMatchText)
    .filter(Boolean);

  return terms.some((term) => haystack.includes(term));
}

function fallbackQueryFor(desired = {}) {
  if (desired.fallbackQuery && desired.fallbackQuery !== desired.query) return desired.fallbackQuery;
  if (desired.source === "kto") return desired.query;
  return "";
}

function intentFor(operation, desired = {}) {
  if (desired.source === "kto") return operation === "add" ? "add_place" : "replace_place";
  return operation === "add" ? "add_meal" : "replace_meal";
}

function domainForDesired(desired = {}) {
  if (desired.query === "카페") return "cafe";
  if (desired.source === "kto") return "attraction";
  return "meal";
}

function inferDomainForClarification(text, target) {
  if (/카페|커피|디저트|브런치/.test(text)) return "cafe";
  if (/시간|몇\s*시|오전|오후|시작|종료|출발|도착|늦춰|미뤄|앞당겨|조정/.test(text)) return "time";
  if (/이동|교통|택시|버스|지하철|도보|자가용/.test(text)) return "transport";
  if (/관광|명소|박물관|미술관|전시|공원|산책|실내|야외|방문지|축제|공연|드론|불꽃|쇼핑|휴식/.test(text)) return "attraction";
  if (/아침|점심|저녁|밤|먹거리|식사|음식|맛집|밥/.test(text) || target?.category === "meal") return "meal";
  return "other";
}

function slotsForRequest(text, desired, mealSlot) {
  const slots = {};
  if (["breakfast", "lunch", "dinner"].includes(mealSlot)) slots.timeSlot = mealSlot;
  if (!desired) return slots;

  if (domainForDesired(desired) === "meal") {
    slots.cuisine = desired.label;
  } else if (domainForDesired(desired) === "cafe") {
    slots.placeType = "카페";
  } else if (domainForDesired(desired) === "attraction") {
    if (/실내|박물관|미술관|전시/.test(text)) slots.indoorOutdoor = "실내";
    if (/야외|공원|산책/.test(text)) slots.indoorOutdoor = "야외";
    slots.theme = desired.label;
  }
  return slots;
}

function choicesForDomain(domain) {
  if (domain === "meal") {
    return [
      { id: "meal-korean", label: "한식", value: "한식" },
      { id: "meal-chinese", label: "중식", value: "중식" },
      { id: "meal-japanese", label: "일식", value: "일식" },
      { id: "meal-western", label: "양식", value: "양식" },
      { id: "meal-casual", label: "분식", value: "분식" },
      { id: "meal-meat", label: "삼겹살", value: "삼겹살" }
    ];
  }
  if (domain === "attraction") {
    return [
      { id: "attraction-indoor", label: "실내", value: "실내 관광" },
      { id: "attraction-outdoor", label: "야외", value: "야외 관광" },
      { id: "attraction-history", label: "역사", value: "역사 관광지" },
      { id: "attraction-park", label: "공원", value: "공원" }
    ];
  }
  if (domain === "cafe") {
    return [
      { id: "cafe-dessert", label: "디저트", value: "디저트 카페" },
      { id: "cafe-brunch", label: "브런치", value: "브런치 카페" },
      { id: "cafe-quiet", label: "조용한 곳", value: "조용한 카페" }
    ];
  }
  return [];
}

function categoryFor(selected = {}, desired = {}) {
  if (desired.source !== "kto") return desired.query === "카페" ? "indoor" : "meal";
  const haystack = normalizeMatchText([selected.name, selected.category, selected.categoryDetail, desired.label].join(" "));
  if (/박물관|미술관|전시|문화시설|실내/.test(haystack)) return "indoor";
  return desired.category || "outdoor";
}

function buildUpdatePatch({ selected, desired, target, mealSlot, resolutionMessage }) {
  return {
    title: titleFor(selected.name, desired.label, mealSlot),
    placeName: selected.name,
    address: selected.address || target.address,
    lat: selected.lat ?? target.lat,
    lng: selected.lng ?? target.lng,
    startsAt: target.startsAt,
    endsAt: target.endsAt,
    transportMode: target.transportMode || "walk",
    travelMinutesBefore: target.travelMinutesBefore ?? 15,
    category: categoryFor(selected, desired),
    memo: joinMemo([
      `자연어 요청 반영: ${desired.label} 중심으로 일정 변경`,
      desired.source === "kto" ? "KTO 관광정보 기반 후보" : "",
      resolutionMessage
    ])
  };
}

function buildAddPatch({ selected, desired, date, mealSlot, anchor, resolutionMessage, afterAnchor }) {
  const [start, end] = timeRangeForSlot(mealSlot);
  const afterRange = afterAnchor && anchor?.endsAt ? dateTimeRangeAfter(anchor.endsAt) : null;
  return {
    title: titleFor(selected.name, desired.label, mealSlot),
    placeName: selected.name,
    address: selected.address || anchor?.address || "",
    lat: selected.lat ?? anchor?.lat,
    lng: selected.lng ?? anchor?.lng,
    startsAt: afterRange?.startsAt || `${date}T${start}:00+09:00`,
    endsAt: afterRange?.endsAt || `${date}T${end}:00+09:00`,
    transportMode: anchor?.transportMode || "walk",
    travelMinutesBefore: 15,
    category: categoryFor(selected, desired),
    memo: joinMemo([
      `자연어 요청 반영: ${desired.label} 일정 추가`,
      desired.source === "kto" ? "KTO 관광정보 기반 후보" : "",
      resolutionMessage
    ])
  };
}

function titleFor(placeName, label, slot) {
  if (/관광지|명소|박물관|전시|공원/.test(label)) {
    return placeName.startsWith("근처") ? `${placeName} 방문` : `${placeName} 방문`;
  }

  if (label === "카페") {
    return placeName.startsWith("근처") ? placeName : `${placeName} 카페`;
  }

  const suffix = { breakfast: "아침", lunch: "점심", dinner: "저녁", meal: "식사" }[slot] || "식사";
  const base = placeName.startsWith("근처") ? label : placeName;
  return `${base} ${suffix}`;
}

function dateTimeRangeAfter(value) {
  const match = String(value || "").match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::\d{2})?((?:[+-]\d{2}:\d{2})|Z)?$/);
  if (!match) return null;

  const [, date, hourText, minuteText, zone = "+09:00"] = match;
  const startTotalMinutes = Number(hourText) * 60 + Number(minuteText) + 20;
  const endTotalMinutes = startTotalMinutes + 60;
  const startDayOffset = Math.floor(startTotalMinutes / 1440);
  const endDayOffset = Math.floor(endTotalMinutes / 1440);
  const startMinutesOfDay = startTotalMinutes % 1440;
  const endMinutesOfDay = endTotalMinutes % 1440;
  const startHour = Math.floor(startMinutesOfDay / 60);
  const startMinute = startMinutesOfDay % 60;
  const endHour = Math.floor(endMinutesOfDay / 60);
  const endMinute = endMinutesOfDay % 60;
  const startDate = addDays(date, startDayOffset);
  const endDate = addDays(date, endDayOffset);
  return {
    startsAt: `${startDate}T${String(startHour).padStart(2, "0")}:${String(startMinute).padStart(2, "0")}:00${zone}`,
    endsAt: `${endDate}T${String(endHour).padStart(2, "0")}:${String(endMinute).padStart(2, "0")}:00${zone}`
  };
}

function addDays(date, days) {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return date;
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function timeRangeForSlot(slot) {
  if (slot === "morning") return ["10:00", "11:30"];
  if (slot === "afternoon") return ["14:00", "15:30"];
  if (slot === "breakfast") return ["09:00", "10:00"];
  if (slot === "dinner") return ["18:00", "19:00"];
  return ["12:00", "13:00"];
}

function confirmationMessage(operation, target, patch) {
  if (operation === "add") {
    return `새 일정으로 ${patch.title || patch.placeName}을 추가할게요.`;
  }
  return `${target.title}을 ${patch.title || patch.placeName}으로 바꿀게요.`;
}

function objectParticle(value) {
  const chars = [...clean(value)];
  const last = chars.at(-1);
  if (!last) return "을";
  const code = last.charCodeAt(0);
  if (code < 0xac00 || code > 0xd7a3) return "을";
  return (code - 0xac00) % 28 === 0 ? "를" : "을";
}

function dedupeAlternatives(items = []) {
  const seen = new Set();
  return items.filter((item) => {
    const key = `${item.name}-${item.address}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function clarification(question, options = {}) {
  const draft = {
    operation: "update",
    stage: "clarify",
    domain: options.domain || "other",
    filledSlots: options.filledSlots || {},
    missingSlots: options.missingSlots || [],
    choices: options.choices || [],
    needsConfirmation: false,
    needsClarification: true,
    question,
    patch: {}
  };
  if (options.targetItemId) draft.targetItemId = options.targetItemId;
  if (options.intent) draft.intent = options.intent;
  if (Number.isFinite(Number(options.confidence))) draft.confidence = Number(options.confidence);
  return draft;
}

function dateKey(value) {
  return String(value || "").slice(0, 10);
}

function joinMemo(parts) {
  return parts.map(clean).filter(Boolean).join(" · ");
}

function clean(value) {
  return String(value ?? "").trim();
}

function normalizeMatchText(value) {
  return clean(value).toLowerCase().replace(/\s+/g, "");
}
