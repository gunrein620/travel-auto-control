import { coercePlanItemInput } from "./planItemInput.js";

const DEFAULT_CENTER = {
  lat: 37.2636,
  lng: 127.0286
};

const ALLOWED_CATEGORIES = new Set(["indoor", "outdoor", "meal"]);
const ALLOWED_TRANSPORT = new Set(["walk", "subway", "bus", "taxi", "car"]);

export function normalizeTripRequest(input = {}) {
  const startDate = normalizeDate(input.startDate) || "2026-06-27";
  const endDate = normalizeDate(input.endDate) || addDays(startDate, 2);
  const range = buildDateRange(startDate, endDate);

  return {
    region: clean(input.region || input.destination || "수원시"),
    startDate: range[0],
    endDate: range.at(-1),
    travelers: clean(input.travelers || "4인 가족"),
    childrenAges: clean(input.childrenAges || input.children || ""),
    transportMode: normalizeTransport(input.transportMode || "car"),
    pace: clean(input.pace || "보통"),
    interests: clean(input.interests || "관광지, 가족 동선, 근처 맛집"),
    budget: clean(input.budget || ""),
    lodgingArea: clean(input.lodgingArea || ""),
    foodPreferences: clean(input.foodPreferences || ""),
    avoid: clean(input.avoid || ""),
    days: range
  };
}

export function normalizeGeneratedTrip(agentOutput, requestInput, options = {}) {
  const request = normalizeTripRequest(requestInput);
  const rawTrip = agentOutput?.trip || agentOutput || {};
  const rawDays = Array.isArray(rawTrip.days) ? rawTrip.days : [];
  if (rawDays.length === 0) throw new Error("generated trip has no days");

  const items = [];
  const days = [];

  rawDays.forEach((day, dayIndex) => {
    const date = normalizeDate(day.date) || request.days[dayIndex] || request.days.at(-1);
    const rawItems = day.items || day.schedule || day.activities || [];
    if (!Array.isArray(rawItems) || rawItems.length === 0) return;

    const dayItems = refineWalkableCarHops(
      rawItems.map((item, itemIndex) =>
        normalizeGeneratedItem(item, {
          date,
          dayIndex,
          itemIndex,
          region: request.region,
          defaultTransportMode: request.transportMode
        })
      )
    );

    items.push(...dayItems);
    days.push({
      date,
      title: clean(day.title || day.label || `${dayIndex + 1}일차`),
      theme: clean(day.theme || day.summary || ""),
      itemIds: dayItems.map((item) => item.id)
    });
  });

  if (items.length === 0) throw new Error("generated trip has no usable items");

  items.sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());

  return {
    trip: {
      id: `trip-${request.startDate}-${request.region}`,
      title: clean(rawTrip.title || `${request.region} ${request.days.length}일 여행`),
      region: request.region,
      startDate: request.startDate,
      endDate: request.endDate,
      travelers: request.travelers,
      request,
      days,
      generatedAt: new Date().toISOString(),
      source: options.source || "ennoia",
      modelStatus: options.modelStatus || "",
      apiStatus: normalizeStringList(rawTrip.apiStatus || options.apiStatus),
      evidence: normalizeStringList(rawTrip.evidence || options.evidence),
      warnings: normalizeStringList(rawTrip.warnings || options.warnings)
    },
    items
  };
}

export function createFallbackTrip(requestInput, modelStatus = "Ennoia 일정 생성 실패: 로컬 추천안으로 임시 구성") {
  const request = normalizeTripRequest(requestInput);
  const templates = buildFallbackTemplates(request);
  const days = request.days.map((date, index) => {
    const template = templates[index] || templates.at(-1);
    return {
      date,
      title: template.title,
      theme: template.theme,
      items: template.items.map((item) => ({
        ...item,
        startsAt: `${date}T${item.start}:00+09:00`,
        endsAt: `${date}T${item.end}:00+09:00`
      }))
    };
  });

  const result = normalizeGeneratedTrip(
    {
      title: `${request.region} ${request.days.length}일 가족 여행`,
      days,
      apiStatus: [
        modelStatus,
        "KTO/Kakao/날씨는 일정 점검 단계에서 실시간 재확인",
        "식당 현재 영업 중 여부는 단정하지 않음"
      ],
      evidence: [
        "가족 여행 동선이 무리하지 않도록 하루 4~5개 블록으로 구성",
        "야외 일정은 우천 시 실내 대안 점검이 가능하도록 분류"
      ],
      warnings: ["Ennoia 직접 호출이 성공하면 이 로컬 추천안 대신 멀티에이전트 결과가 적용됩니다."]
    },
    request,
    {
      source: "fallback",
      modelStatus,
      apiStatus: [modelStatus]
    }
  );

  result.trip.source = "fallback";
  result.trip.modelStatus = modelStatus;
  return result;
}

function normalizeGeneratedItem(item, context) {
  const startsAt = normalizeDateTime(item.startsAt || item.startTime || item.time, context.date, "10:00");
  const endsAt = normalizeDateTime(item.endsAt || item.endTime, context.date, fallbackEndTime(startsAt));
  const placeName = clean(item.placeName || item.place || item.name || item.title);
  const category = normalizeCategory(item.category);
  const repaired = repairVagueSuwonPlace(
    {
      title: clean(item.title || placeName),
      placeName,
      address: clean(item.address || `${context.region}`),
      lat: toNumber(item.lat ?? item.latitude, DEFAULT_CENTER.lat),
      lng: toNumber(item.lng ?? item.longitude ?? item.lon, DEFAULT_CENTER.lng),
      category,
      memo: clean(item.memo || item.reason || item.note || "")
    },
    context
  );

  return {
    id: normalizeItemId(item.id, context.dayIndex, context.itemIndex),
    ...coercePlanItemInput({
      title: repaired.title,
      placeName: repaired.placeName,
      address: repaired.address,
      lat: repaired.lat,
      lng: repaired.lng,
      startsAt,
      endsAt,
      transportMode: normalizeTransport(item.transportMode || context.defaultTransportMode),
      travelMinutesBefore: toNumber(item.travelMinutesBefore, 25),
      category: repaired.category,
      memo: repaired.memo
    })
  };
}

function buildFallbackTemplates(request) {
  if (request.region.includes("수원")) return suwonTemplates(request);
  return genericTemplates(request);
}

function refineWalkableCarHops(items) {
  return items.map((item, index) => {
    if (index === 0 || item.transportMode !== "car") return item;
    const previous = items[index - 1];
    const distanceKm = haversineKm(previous, item);
    if (!Number.isFinite(distanceKm) || distanceKm > 0.8) return item;

    return {
      ...item,
      transportMode: "walk",
      travelMinutesBefore: Math.min(Number(item.travelMinutesBefore) || 15, 15),
      memo: appendMemo(item.memo, "주차 후 도보 이동 권장")
    };
  });
}

function repairVagueSuwonPlace(item, context) {
  if (!context.region.includes("수원")) return item;
  const text = `${item.title} ${item.placeName}`.replace(/\s+/g, " ");
  const repair = SUWON_PLACE_REPAIRS.find((candidate) => candidate.match(text, item));
  if (!repair) return item;
  return {
    ...item,
    title: repair.title || item.title.replace(item.placeName, repair.placeName),
    placeName: repair.placeName,
    address: repair.address,
    lat: repair.lat,
    lng: repair.lng,
    category: repair.category || item.category,
    memo: appendMemo(item.memo, "장소명 보정")
  };
}

const SUWON_PLACE_REPAIRS = [
  {
    match: (text) => text.includes("수원화성 행궁") || text.includes("화성행궁") && text.includes("일대"),
    title: "화성행궁 관람",
    placeName: "화성행궁",
    address: "경기 수원시 팔달구 정조로 825",
    lat: 37.2819,
    lng: 127.0142,
    category: "outdoor"
  },
  {
    match: (text) => text.includes("수원화성 일대") || text.includes("장안문~화홍문"),
    title: "화홍문 성곽 산책",
    placeName: "화홍문",
    address: "경기 수원시 팔달구 수원천로 377",
    lat: 37.2879,
    lng: 127.0188,
    category: "outdoor"
  },
  {
    match: (text) => text.includes("연무대 일대"),
    title: "연무대 성곽 체험",
    placeName: "연무대",
    address: "경기 수원시 팔달구 창룡대로103번길 20",
    lat: 37.2873,
    lng: 127.0235,
    category: "outdoor"
  },
  {
    match: (text, item) => item.category === "meal" && text.includes("행궁동") && /인근|한식|분식|맛집|식당/.test(text),
    title: "점심 먹을터 식사",
    placeName: "먹을터",
    address: "경기 수원시 팔달구 정조로801번길 16",
    lat: 37.27976980345755,
    lng: 127.01579757641547,
    category: "meal"
  },
  {
    match: (text, item) => item.category === "meal" && text.includes("인계동") && /한식|분식|패밀리|식사|점심/.test(text),
    title: "인계동 바르다김선생 식사",
    placeName: "바르다김선생 인계나혜석거리점",
    address: "경기 수원시 팔달구 권광로 184",
    lat: 37.2638790977565,
    lng: 127.033022509606,
    category: "meal"
  },
  {
    match: (text, item) => item.category === "indoor" && text.includes("인계동") && /카페 거리|카페/.test(text),
    title: "이디야커피 수원인계점 휴식",
    placeName: "이디야커피 수원인계점",
    address: "경기 수원시 팔달구 권광로 169",
    lat: 37.26273236254436,
    lng: 127.0319600557824,
    category: "indoor"
  },
  {
    match: (text) => /쇼핑몰|마트/.test(text) && /수원 시내|수원역|쇼핑/.test(text),
    title: "AK플라자 수원 쇼핑",
    placeName: "AK플라자 수원",
    address: "경기 수원시 팔달구 덕영대로 924",
    lat: 37.2655920786361,
    lng: 127.000180381035,
    category: "indoor"
  }
];

function haversineKm(from, to) {
  const fromLat = Number(from.lat);
  const fromLng = Number(from.lng);
  const toLat = Number(to.lat);
  const toLng = Number(to.lng);
  if (![fromLat, fromLng, toLat, toLng].every(Number.isFinite)) return NaN;
  const dLat = toRadians(toLat - fromLat);
  const dLng = toRadians(toLng - fromLng);
  const lat1 = toRadians(fromLat);
  const lat2 = toRadians(toLat);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRadians(degrees) {
  return (degrees * Math.PI) / 180;
}

function appendMemo(memo, addition) {
  const current = clean(memo);
  if (!current) return addition;
  if (current.includes(addition)) return current;
  return `${current} · ${addition}`;
}

function suwonTemplates(request) {
  return [
    {
      title: "수원화성·행궁동 적응",
      theme: "대표 관광지와 짧은 도보 동선",
      items: [
        item("10:30", "11:50", "수원화성 산책", "수원화성", "경기 수원시 장안구 영화동", 37.2878, 127.0112, "outdoor", "성곽 구간은 아이 컨디션에 맞춰 짧게 선택"),
        item("12:10", "13:10", "행궁동 가족 점심", "행궁동 맛집", "경기 수원시 팔달구 행궁동", 37.2828, 127.0146, "meal", "Kakao Local로 근처 음식점 후보를 재확인"),
        item("13:40", "15:00", "화성행궁 관람", "화성행궁", "경기 수원시 팔달구 정조로 825", 37.2819, 127.0142, "outdoor", "운영/휴무는 KTO 상세정보로 재점검"),
        item("15:20", "16:10", "행궁동 카페 휴식", "행궁동 카페", "경기 수원시 팔달구 행궁동", 37.2826, 127.016, "meal", "아이 휴식과 화장실 확보"),
        item("17:20", "18:00", "숙소 체크인", request.lodgingArea || "수원시 숙소", "경기 수원시", 37.2636, 127.0286, "indoor", "짐 정리 후 저녁 동선 재확인")
      ]
    },
    {
      title: "광교·실내 대안 균형",
      theme: "야외 산책과 우천 대체가 쉬운 동선",
      items: [
        item("09:50", "11:20", "광교호수공원 산책", "광교호수공원", "경기 수원시 영통구 하동", 37.283, 127.065, "outdoor", "비 예보가 있으면 실내 일정으로 우회"),
        item("11:45", "12:45", "광교 점심", "광교 가족 식당", "경기 수원시 영통구", 37.288, 127.057, "meal", "전화/지도 URL로 영업 여부 확인"),
        item("13:20", "14:50", "수원박물관 관람", "수원박물관", "경기 수원시 영통구 창룡대로 265", 37.2977, 127.0523, "indoor", "우천 시 핵심 대안"),
        item("15:30", "17:00", "스타필드 수원 휴식", "스타필드 수원", "경기 수원시 장안구 수성로 175", 37.2895, 126.9928, "indoor", "실내 휴식, 쇼핑, 간식"),
        item("18:00", "19:10", "수원 갈비 저녁", "수원 갈비 식당", "경기 수원시 팔달구", 37.2748, 127.0167, "meal", "Kakao Local 후보 중 거리와 리뷰를 비교")
      ]
    },
    {
      title: "시장·가벼운 마무리",
      theme: "귀가 전 짧은 체류와 식사",
      items: [
        item("10:00", "11:00", "방화수류정 산책", "방화수류정", "경기 수원시 팔달구 수원천로392번길 44-6", 37.2883, 127.0189, "outdoor", "날씨가 나쁘면 카페/박물관으로 우회"),
        item("11:30", "12:40", "팔달문시장 점심", "팔달문시장", "경기 수원시 팔달구 팔달문로", 37.2765, 127.0174, "meal", "혼잡하면 인근 식당으로 변경"),
        item("13:10", "14:00", "수원 카페 정리 시간", "수원역 근처 카페", "경기 수원시 팔달구 덕영대로", 37.266, 127.0001, "meal", "영수증·사진·여행기록 정리"),
        item("14:20", "15:00", "귀가 전 교통 점검", "수원역", "경기 수원시 팔달구 덕영대로 924", 37.2657, 126.9996, "indoor", "교통 혼잡 시 출발 시간 조정")
      ]
    }
  ];
}

function genericTemplates(request) {
  return [
    {
      title: `${request.region} 첫날 핵심 관광`,
      theme: "대표 장소 중심",
      items: [
        item("10:30", "12:00", "대표 관광지 방문", `${request.region} 대표 관광지`, request.region, DEFAULT_CENTER.lat, DEFAULT_CENTER.lng, "outdoor", "KTO 후보 검색 후 실제 장소로 치환 필요"),
        item("12:20", "13:20", "근처 점심", `${request.region} 가족 식당`, request.region, DEFAULT_CENTER.lat, DEFAULT_CENTER.lng, "meal", "Kakao Local 후보 확인"),
        item("14:00", "15:30", "실내 문화시설", `${request.region} 문화시설`, request.region, DEFAULT_CENTER.lat, DEFAULT_CENTER.lng, "indoor", "우천 대안"),
        item("16:00", "17:00", "카페 휴식", `${request.region} 카페`, request.region, DEFAULT_CENTER.lat, DEFAULT_CENTER.lng, "meal", "아이 휴식")
      ]
    }
  ];
}

function item(start, end, title, placeName, address, lat, lng, category, memo) {
  return {
    start,
    end,
    title,
    placeName,
    address,
    lat,
    lng,
    category,
    memo,
    travelMinutesBefore: category === "meal" ? 15 : 25
  };
}

function buildDateRange(startDate, endDate) {
  const start = normalizeDate(startDate) || "2026-06-27";
  const end = normalizeDate(endDate) || addDays(start, 2);
  const days = [];
  const maxDays = 7;
  let cursor = start;
  for (let index = 0; index < maxDays; index += 1) {
    days.push(cursor);
    if (cursor === end) break;
    cursor = addDays(cursor, 1);
    if (new Date(`${cursor}T00:00:00+09:00`) > new Date(`${end}T00:00:00+09:00`)) break;
  }
  return days;
}

function normalizeDateTime(value, date, fallbackTime) {
  const text = clean(value);
  if (!text) return `${date}T${fallbackTime}:00+09:00`;
  if (/^\d{2}:\d{2}/.test(text)) return `${date}T${text.slice(0, 5)}:00+09:00`;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(text)) {
    if (/[zZ]|[+-]\d{2}:\d{2}$/.test(text)) return text;
    return `${text.length === 16 ? `${text}:00` : text}+09:00`;
  }
  return `${date}T${fallbackTime}:00+09:00`;
}

function fallbackEndTime(startsAt) {
  const start = new Date(startsAt);
  const end = new Date(start.getTime() + 70 * 60 * 1000);
  const kst = new Date(end.getTime() + 9 * 60 * 60 * 1000);
  return `${String(kst.getUTCHours()).padStart(2, "0")}:${String(kst.getUTCMinutes()).padStart(2, "0")}`;
}

function normalizeDate(value) {
  const match = clean(value).match(/\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : "";
}

function addDays(date, days) {
  const next = new Date(`${date}T00:00:00+09:00`);
  next.setUTCDate(next.getUTCDate() + days);
  const kst = new Date(next.getTime() + 9 * 60 * 60 * 1000);
  return `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, "0")}-${String(kst.getUTCDate()).padStart(2, "0")}`;
}

function normalizeCategory(category) {
  const text = clean(category);
  if (ALLOWED_CATEGORIES.has(text)) return text;
  if (text.includes("식") || text.includes("카페") || text.includes("음식")) return "meal";
  if (text.includes("야외") || text.includes("공원") || text.includes("산책")) return "outdoor";
  return "indoor";
}

function normalizeTransport(mode) {
  const text = clean(mode);
  if (ALLOWED_TRANSPORT.has(text)) return text;
  if (text.includes("차") || text.includes("자가") || text.includes("렌터")) return "car";
  if (text.includes("지하철") || text.includes("대중")) return "subway";
  if (text.includes("버스")) return "bus";
  if (text.includes("택시")) return "taxi";
  return "walk";
}

function normalizeStringList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(clean).filter(Boolean).slice(0, 8);
  return [clean(value)].filter(Boolean);
}

function toNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clean(value) {
  return String(value ?? "").trim();
}

function normalizeItemId(value, dayIndex, itemIndex) {
  const cleaned = clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 28);
  return cleaned || `gen-${dayIndex + 1}-${itemIndex + 1}`;
}
