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
  searchPlaces = searchNearbyPlaces,
  searchTouristPlaces: searchTouristPlacesFn = searchTouristPlaces
} = {}) {
  const requestText = clean(text);
  const sortedItems = [...items].sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
  if (!requestText) {
    return clarification("수정하거나 추가할 내용을 입력해 주세요.");
  }

  const referencedItem = findTargetItem(requestText, sortedItems);
  const target = hasExplicitAddIntent(requestText) && mode === "add_or_update" ? null : referencedItem;
  const operation = target ? "update" : mode === "add_or_update" ? "add" : "update";
  if (operation === "update" && !target) {
    return clarification("어떤 일정을 바꿀까요? 예: 첫날 점심, 저녁 일정, 장소명처럼 알려주세요.");
  }

  const desired = extractDesiredPlaceQuery(requestText);
  if (!desired) {
    return clarification(
      operation === "add"
        ? "어떤 장소나 음식을 추가할까요? 예: 둘째날 점심에 한식집 추가처럼 알려주세요."
        : `${target.title}을 무엇으로 바꿀까요? 원하는 음식이나 장소를 알려주세요.`
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
  const primary = await searchPrimary({ ...searchContext, radius: desired.source === "kto" ? 5000 : searchContext.radius });
  const primaryItems = relevantPlaces(primary.items, desired);
  let selected = primaryItems[0];
  let resolutionMessage = "";
  let searchSource = primary;
  const alternatives = [...primaryItems];

  if (!selected && fallbackQueryFor(desired)) {
    const fallbackQuery = fallbackQueryFor(desired);
    const fallback = await searchPlaces({ ...searchContext, query: fallbackQuery });
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

  const patch =
    operation === "add"
      ? buildAddPatch({
          selected,
          desired,
          date,
          mealSlot,
          anchor,
          resolutionMessage,
          afterAnchor: hasAfterReference(requestText)
        })
      : buildUpdatePatch({ selected, desired, target, mealSlot, resolutionMessage });

  return {
    operation,
    targetItemId: operation === "update" ? target.id : undefined,
    intent: intentFor(operation, desired),
    confidence: selected.id?.startsWith("generic-") ? 0.58 : 0.82,
    patch: sanitizeNaturalEditPatch(patch, target),
    alternatives: dedupeAlternatives(alternatives).slice(0, 2),
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

function findTargetItem(text, items) {
  const mentioned = items.find((item) => itemMentioned(text, item));
  if (mentioned) return mentioned;

  const date = requestedDate(text, items);
  const candidates = date ? items.filter((item) => dateKey(item.startsAt) === date) : items;
  const slot = requestedMealSlot(text);

  if (["breakfast", "lunch", "dinner"].includes(slot)) {
    const meal = candidates.find((item) => item.category === "meal" && itemInMealSlot(item, slot));
    if (meal) return meal;
  }

  if (/저녁|이따|밤|dinner/i.test(text)) {
    const dinner = candidates.find((item) => item.category === "meal" && getKstHour(item.startsAt) >= 17);
    if (dinner) return dinner;
  }

  if (/점심|lunch/i.test(text)) {
    const lunch = candidates.find((item) => item.category === "meal");
    if (lunch) return lunch;
  }

  const tourismTarget = text.match(/박물관|미술관|전시|관광지|명소|공원|실내|야외|방문지/);
  if (tourismTarget) {
    return (
      candidates.find((item) => normalizeMatchText([item.title, item.placeName, item.memo].join(" ")).includes(tourismTarget[0])) ||
      candidates.find((item) => item.category && item.category !== "meal")
    );
  }

  return null;
}

function hasExplicitAddIntent(text) {
  return /추가|넣어|넣을래|넣자|하나 더|새 일정/.test(text);
}

function hasAfterReference(text) {
  return /뒤|다음|끝나고|직후|이후|(?<!오)후에|(?<!오)후로|(?<!오)후\s/u.test(text);
}

function itemMentioned(text, item) {
  return itemAliases(item).some((alias) => alias && text.includes(alias));
}

function itemAliases(item) {
  const values = [item.title, item.placeName];
  for (const value of [item.title, item.placeName]) {
    const cleanValue = clean(value);
    if (!cleanValue) continue;
    values.push(cleanValue.split(/\s+/)[0]);
    values.push(cleanValue.replace(/(본점|점|지점|인천|서울|부산|대구|수원|전주|월미도|차이나타운)/g, ""));
  }
  return [...new Set(values.map(clean).filter((value) => value.length >= 2))].sort((a, b) => b.length - a.length);
}

function extractDesiredPlaceQuery(text) {
  return PLACE_QUERIES.find((entry) => entry.keywords.some((keyword) => text.includes(keyword))) || null;
}

function requestedDate(text, items = [], activeDate, target) {
  if (target) return dateKey(target.startsAt);
  const dates = [...new Set(items.map((item) => dateKey(item.startsAt)).filter(Boolean))].sort();
  if (/첫날|첫째/.test(text)) return dates[0] || activeDate;
  if (/둘째|두번째|2일/.test(text)) return dates[1] || activeDate || dates[0];
  if (/셋째|세번째|3일/.test(text)) return dates[2] || activeDate || dates[0];
  return activeDate || dates[0];
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

function dedupeAlternatives(items = []) {
  const seen = new Set();
  return items.filter((item) => {
    const key = `${item.name}-${item.address}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function clarification(question) {
  return {
    operation: "update",
    needsConfirmation: false,
    needsClarification: true,
    question,
    patch: {}
  };
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
