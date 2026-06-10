import { coercePlanItemInput } from "./planItemInput.js";

const DEFAULT_CENTER = {
  lat: 37.2636,
  lng: 127.0286
};

const REGION_DEFINITIONS = {
  suwon: {
    region: "수원",
    center: DEFAULT_CENTER,
    bounds: { minLat: 37.18, maxLat: 37.34, minLng: 126.91, maxLng: 127.12 },
    addressHints: ["경기 수원시"]
  },
  busan: {
    region: "부산",
    center: { lat: 35.1796, lng: 129.0756 },
    bounds: { minLat: 35.02, maxLat: 35.32, minLng: 128.78, maxLng: 129.31 },
    addressHints: ["부산 해운대구", "부산 중구", "부산 수영구"]
  },
  seoul: {
    region: "서울",
    center: { lat: 37.5665, lng: 126.978 },
    bounds: { minLat: 37.42, maxLat: 37.7, minLng: 126.76, maxLng: 127.19 },
    addressHints: ["서울 성동구", "서울 종로구", "서울 용산구"]
  },
  goyang: {
    region: "고양",
    center: { lat: 37.6584, lng: 126.832 },
    bounds: { minLat: 37.56, maxLat: 37.72, minLng: 126.72, maxLng: 126.93 },
    addressHints: ["경기 고양시 덕양구", "경기 고양시 일산동구", "경기 고양시 일산서구"]
  },
  daegu: {
    region: "대구",
    center: { lat: 35.8714, lng: 128.6014 },
    bounds: { minLat: 35.74, maxLat: 36.02, minLng: 128.43, maxLng: 128.77 },
    addressHints: ["대구 중구", "대구 수성구", "대구 북구"]
  },
  jeonju: {
    region: "전주",
    center: { lat: 35.8242, lng: 127.148 },
    bounds: { minLat: 35.75, maxLat: 35.91, minLng: 127.03, maxLng: 127.25 },
    addressHints: ["전북 전주시 완산구", "전북 전주시 덕진구"]
  }
};

const ALLOWED_CATEGORIES = new Set(["indoor", "outdoor", "meal"]);
const ALLOWED_TRANSPORT = new Set(["walk", "subway", "bus", "taxi", "car"]);
const WALKABLE_HOP_TRANSPORT = new Set(["car", "subway", "bus"]);

export function normalizeTripRequest(input = {}) {
  const requestText = clean(input.requests || input.query || input.prompt || input.text || "");
  const textDateRange = extractDateRangeFromText(requestText, input.referenceDate);
  const startDate = normalizeDate(input.startDate) || textDateRange?.startDate || "2026-06-27";
  const endDate = normalizeDate(input.endDate) || textDateRange?.endDate || addDays(startDate, 2);
  const range = buildDateRange(startDate, endDate);
  const queryRegion = clean(input.region || input.destination || input.resolvedRegion?.queryRegion || inferRegionFromText(requestText) || "");
  const resolvedRegion = resolveTripRegion(queryRegion || input.resolvedRegion?.region || "");

  return {
    region: queryRegion || resolvedRegion.region,
    resolvedRegion,
    startDate: range[0],
    endDate: range.at(-1),
    requests: requestText,
    travelers: clean(input.travelers || ""),
    childrenAges: clean(input.childrenAges || input.children || ""),
    transportMode: normalizeTransport(input.transportMode || "car"),
    pace: clean(input.pace || "보통"),
    interests: clean(input.interests || ""),
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
  const qualityWarnings = [];

  rawDays.forEach((day, dayIndex) => {
    const date = normalizeDate(day.date) || request.days[dayIndex] || request.days.at(-1);
    const rawItems = day.items || day.schedule || day.activities || [];
    if (!Array.isArray(rawItems) || rawItems.length === 0) return;
    const selectedItems = rawItems.slice(0, 4);

    const dayItems = refineWalkableHops(
      selectedItems.map((item, itemIndex) => {
        const normalized = normalizeGeneratedItem(item, {
          date,
          dayIndex,
          itemIndex,
          region: request.region,
          resolvedRegion: request.resolvedRegion,
          defaultTransportMode: request.transportMode
        });
        qualityWarnings.push(...validateGeneratedTripQuality(normalized, item, request));
        return normalized;
      })
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
      apiStatus: normalizeStringList([options.apiStatus, rawTrip.apiStatus]),
      evidence: normalizeStringList([rawTrip.evidence, options.evidence]),
      eventSuggestions: normalizeEventSuggestions(rawTrip.eventSuggestions || rawTrip.events || rawTrip.festivals),
      warnings: normalizeStringList([rawTrip.warnings, options.warnings, request.resolvedRegion.warning, qualityWarnings])
    },
    items
  };
}

export function createFallbackTrip(requestInput, modelStatus = "Ennoia 일정 생성 실패: 로컬 추천안으로 임시 구성") {
  const request = normalizeTripRequest(requestInput);
  if (!request.resolvedRegion.center) {
    return createUnsupportedRegionFallbackTrip(request, modelStatus);
  }

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
      title: `${request.region} ${request.days.length}일 여행`,
      days,
      apiStatus: [
        modelStatus,
        "KTO/Kakao/날씨는 일정 점검 단계에서 실시간 재확인",
        "KTO 행사정보는 Ennoia 연결 시 날짜 범위로 재확인",
        "식당 현재 영업 중 여부는 단정하지 않음"
      ],
      evidence: [
        "가족 여행 동선이 무리하지 않도록 하루 4~5개 블록으로 구성",
        "야외 일정은 우천 시 실내 대안 점검이 가능하도록 분류"
      ],
      warnings: ["Ennoia 직접 호출이 성공하면 이 로컬 추천안 대신 멀티에이전트 결과가 적용됩니다."]
    },
    requestInput,
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

function createUnsupportedRegionFallbackTrip(request, modelStatus) {
  return {
    trip: {
      id: `trip-${request.startDate}-${request.region}`,
      title: `${request.region} 여행 지역 구체화 필요`,
      region: request.region,
      startDate: request.startDate,
      endDate: request.endDate,
      travelers: request.travelers,
      request,
      days: request.days.map((date, index) => ({
        date,
        title: `${index + 1}일차`,
        theme: "지원 지역을 더 구체화하면 일정이 생성됩니다.",
        itemIds: []
      })),
      generatedAt: new Date().toISOString(),
      source: "fallback",
      modelStatus,
      apiStatus: normalizeStringList([modelStatus]),
      evidence: [],
      warnings: normalizeStringList([
        request.resolvedRegion.warning,
        "지역을 더 구체화해 주세요. v1 지원 지역은 서울, 수원, 고양, 부산, 대구, 전주입니다."
      ])
    },
    items: []
  };
}

function resolveTripRegion(inputRegion) {
  const queryRegion = clean(inputRegion);
  const compact = queryRegion.replace(/\s+/g, "");

  if (/^(전라도|전라북도|전북)$/.test(compact)) {
    const region = buildResolvedRegion("jeonju", queryRegion || "전라도");
    return {
      ...region,
      ambiguous: true,
      warning: "넓은 지역 입력이라 전주 중심으로 구성합니다. 더 정확한 일정은 시/군/구를 구체화해 주세요."
    };
  }

  if (compact.includes("수원")) return buildResolvedRegion("suwon", queryRegion);
  if (compact.includes("서울")) return buildResolvedRegion("seoul", queryRegion);
  if (compact.includes("고양")) return buildResolvedRegion("goyang", queryRegion);
  if (compact.includes("부산")) return buildResolvedRegion("busan", queryRegion);
  if (compact.includes("대구")) return buildResolvedRegion("daegu", queryRegion);
  if (compact.includes("전주")) return buildResolvedRegion("jeonju", queryRegion);

  const fallbackRegion = queryRegion || "지역 미지정";
  return {
    region: fallbackRegion,
    queryRegion,
    center: null,
    bounds: null,
    addressHints: [],
    ambiguous: true,
    warning: `${fallbackRegion}은 v1 지원 지역이 아닙니다. 서울, 수원, 고양, 부산, 대구, 전주처럼 지역을 더 구체화해 주세요.`
  };
}

function buildResolvedRegion(key, queryRegion) {
  const definition = REGION_DEFINITIONS[key];
  return {
    region: definition.region,
    queryRegion,
    center: { ...definition.center },
    bounds: { ...definition.bounds },
    addressHints: [...definition.addressHints],
    ambiguous: false,
    warning: ""
  };
}

function normalizeGeneratedItem(item, context) {
  const startsAt = normalizeDateTime(item.startsAt || item.startTime || item.time, context.date, "10:00");
  const endsAt = normalizeDateTime(item.endsAt || item.endTime, context.date, fallbackEndTime(startsAt));
  const placeName = clean(item.placeName || item.place || item.name || item.title);
  const category = repairMealCategory(normalizeCategory(item.category), item);
  const fallbackCenter = context.resolvedRegion?.center;
  const repaired = repairVagueSuwonPlace(
    {
      title: clean(item.title || placeName),
      placeName,
      address: clean(item.address || context.resolvedRegion?.addressHints?.[0] || `${context.region}`),
      lat: toNumber(item.lat ?? item.latitude, fallbackCenter?.lat),
      lng: toNumber(item.lng ?? item.longitude ?? item.lon, fallbackCenter?.lng),
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

function validateGeneratedTripQuality(item, rawItem, request) {
  const warnings = [];
  const label = item.placeName || item.title || "일정";

  if (isGenericPlaceName(item.placeName)) {
    warnings.push(`범용 장소명 감지: ${label}`);
  }

  if (isMissingCoordinate(rawItem)) {
    warnings.push(`좌표 누락: ${label}`);
  }

  if (!isChronological(item.startsAt, item.endsAt)) {
    warnings.push(`종료 시간이 시작 시간보다 빠르거나 같습니다: ${label}`);
  }

  if (request.resolvedRegion.bounds && hasFiniteCoordinates(item) && !isInsideRegionBounds(item, request.resolvedRegion.bounds)) {
    warnings.push(`지역 범위 밖 좌표 감지: ${label}`);
  }

  return warnings;
}

function isGenericPlaceName(placeName) {
  return /대표 관광지|가족 식당|문화시설|맛집|근처|일대|시내|쇼핑몰\/마트|식당$|카페$/.test(clean(placeName));
}

function isMissingCoordinate(rawItem) {
  return !Number.isFinite(Number(rawItem.lat ?? rawItem.latitude)) || !Number.isFinite(Number(rawItem.lng ?? rawItem.longitude ?? rawItem.lon));
}

function isChronological(startsAt, endsAt) {
  const startMs = new Date(startsAt).getTime();
  const endMs = new Date(endsAt).getTime();
  return Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs;
}

function hasFiniteCoordinates(item) {
  return Number.isFinite(Number(item.lat)) && Number.isFinite(Number(item.lng));
}

function isInsideRegionBounds(item, bounds) {
  const lat = Number(item.lat);
  const lng = Number(item.lng);
  return lat >= bounds.minLat && lat <= bounds.maxLat && lng >= bounds.minLng && lng <= bounds.maxLng;
}

function buildFallbackTemplates(request) {
  switch (request.resolvedRegion.region) {
    case "수원":
      return suwonTemplates(request);
    case "부산":
      return busanTemplates();
    case "서울":
      return seoulTemplates();
    case "고양":
      return goyangTemplates();
    case "대구":
      return daeguTemplates();
    case "전주":
      return jeonjuTemplates();
    default:
      return [];
  }
}

function refineWalkableHops(items) {
  return items.map((item, index) => {
    if (index === 0 || !WALKABLE_HOP_TRANSPORT.has(item.transportMode)) return item;
    const previous = items[index - 1];
    const distanceKm = haversineKm(previous, item);
    if (!Number.isFinite(distanceKm) || distanceKm > 0.8) return item;
    const memo = item.transportMode === "car" ? "주차 후 도보 이동 권장" : "가까운 구간 도보 이동 권장";

    return {
      ...item,
      transportMode: "walk",
      travelMinutesBefore: Math.min(Number(item.travelMinutesBefore) || 15, 15),
      memo: appendMemo(item.memo, memo)
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
        item("12:10", "13:10", "먹을터 점심", "먹을터", "경기 수원시 팔달구 정조로801번길 16", 37.27976980345755, 127.01579757641547, "meal", "행궁동 도보권 식사"),
        item("13:40", "15:00", "화성행궁 관람", "화성행궁", "경기 수원시 팔달구 정조로 825", 37.2819, 127.0142, "outdoor", "운영/휴무는 KTO 상세정보로 재점검"),
        item("17:40", "18:50", "가보정 저녁", "가보정", "경기 수원시 팔달구 장다리로 282", 37.2686, 127.0337, "meal", "저녁 대기와 예약 가능 여부 확인")
      ]
    },
    {
      title: "광교·실내 대안 균형",
      theme: "야외 산책과 우천 대체가 쉬운 동선",
      items: [
        item("09:50", "11:20", "광교호수공원 산책", "광교호수공원", "경기 수원시 영통구 하동", 37.283, 127.065, "outdoor", "비 예보가 있으면 실내 일정으로 우회"),
        item("11:45", "12:45", "아웃백스테이크하우스 광교점 점심", "아웃백스테이크하우스 광교점", "경기 수원시 영통구 센트럴타운로 85", 37.289, 127.0515, "meal", "전화/지도 URL로 영업 여부 확인"),
        item("13:20", "14:50", "수원박물관 관람", "수원박물관", "경기 수원시 영통구 창룡대로 265", 37.2977, 127.0523, "indoor", "우천 시 핵심 대안"),
        item("17:40", "18:50", "가보정 저녁", "가보정", "경기 수원시 팔달구 장다리로 282", 37.2686, 127.0337, "meal", "저녁 대기와 예약 가능 여부 확인")
      ]
    },
    {
      title: "시장·가벼운 마무리",
      theme: "귀가 전 짧은 체류와 식사",
      items: [
        item("10:00", "11:00", "방화수류정 산책", "방화수류정", "경기 수원시 팔달구 수원천로392번길 44-6", 37.2883, 127.0189, "outdoor", "날씨가 나쁘면 카페/박물관으로 우회"),
        item("11:30", "12:40", "용성통닭 점심", "용성통닭 본점", "경기 수원시 팔달구 정조로800번길 15", 37.2796, 127.0176, "meal", "혼잡하면 대기 시간을 재확인"),
        item("13:10", "14:00", "AK플라자 수원 쇼핑", "AK플라자 수원", "경기 수원시 팔달구 덕영대로 924", 37.2655920786361, 127.000180381035, "indoor", "영수증·사진·여행기록 정리"),
        item("14:20", "15:00", "귀가 전 교통 점검", "수원역", "경기 수원시 팔달구 덕영대로 924", 37.2657, 126.9996, "indoor", "교통 혼잡 시 출발 시간 조정")
      ]
    }
  ];
}

function busanTemplates() {
  return [
    {
      title: "해운대·센텀 핵심 동선",
      theme: "바다 산책과 실내 대안",
      items: [
        item("10:00", "11:10", "해운대해수욕장 산책", "해운대해수욕장", "부산 해운대구 우동", 35.1587, 129.1604, "outdoor", "바다 산책은 풍속과 우천을 재확인"),
        item("11:30", "12:20", "동백섬 산책", "동백섬", "부산 해운대구 우동 710-1", 35.1535, 129.1527, "outdoor", "해운대에서 짧게 이어지는 도보권"),
        item("12:40", "13:30", "송정3대국밥 점심", "송정3대국밥", "부산 해운대구 구남로8번길 33", 35.1628, 129.1635, "meal", "영업 여부와 대기 시간을 재확인"),
        item("17:30", "18:40", "해운대암소갈비집 저녁", "해운대암소갈비집", "부산 해운대구 중동2로10번길 32-10", 35.1624, 129.1666, "meal", "저녁 대기와 영업 여부 재확인")
      ]
    }
  ];
}

function seoulTemplates() {
  return [
    {
      title: "서울숲·용산·종로 균형",
      theme: "야외 산책과 우천 대체가 쉬운 실내 관람",
      items: [
        item("10:00", "11:10", "서울숲 산책", "서울숲", "서울 성동구 뚝섬로 273", 37.5444, 127.0374, "outdoor", "비가 강하면 산책 시간을 줄이고 실내로 우회"),
        item("12:00", "13:00", "광장시장 점심", "광장시장", "서울 종로구 창경궁로 88", 37.5701, 126.9996, "meal", "혼잡하면 식사 시간을 앞당겨 재조정"),
        item("13:50", "15:40", "국립중앙박물관 관람", "국립중앙박물관", "서울 용산구 서빙고로 137", 37.5238, 126.9805, "indoor", "우천 시 안정적인 핵심 실내 대안"),
        item("17:40", "18:40", "명동교자 본점 저녁", "명동교자 본점", "서울 중구 명동10길 29", 37.5635, 126.985, "meal", "대기와 영업 여부는 지도 상세로 재확인")
      ]
    },
    {
      title: "북촌·광화문 실내 대안",
      theme: "도보권 역사 산책과 미술관 우회",
      items: [
        item("10:00", "11:10", "북촌한옥마을 산책", "북촌한옥마을", "서울 종로구 계동길 37", 37.5826, 126.9836, "outdoor", "비 예보가 있으면 짧게 통과"),
        item("11:40", "12:40", "토속촌삼계탕 점심", "토속촌삼계탕", "서울 종로구 자하문로5길 5", 37.5777, 126.9716, "meal", "점심 대기 시간을 재확인"),
        item("13:10", "14:40", "국립현대미술관 서울 관람", "국립현대미술관 서울", "서울 종로구 삼청로 30", 37.5796, 126.9808, "indoor", "우천 시 핵심 관람지"),
        item("17:30", "18:40", "광화문미진 저녁", "광화문미진", "서울 종로구 종로 19", 37.5708, 126.9794, "meal", "저녁 영업과 혼잡도를 재확인")
      ]
    },
    {
      title: "여의도·한강 짧은 마무리",
      theme: "귀가 전 실내와 한강 전망 조합",
      items: [
        item("10:00", "11:10", "더현대 서울 휴식", "더현대 서울", "서울 영등포구 여의대로 108", 37.5259, 126.9284, "indoor", "비 오는 날 쇼핑·휴식 대안"),
        item("11:40", "12:40", "진주집 점심", "진주집", "서울 영등포구 국제금융로6길 33", 37.5201, 126.9293, "meal", "식사 대기 시간을 재확인"),
        item("13:10", "14:20", "여의도한강공원 산책", "여의도한강공원", "서울 영등포구 여의동로 330", 37.5284, 126.933, "outdoor", "비나 강풍이면 실내 체류로 전환"),
        item("14:50", "15:40", "IFC몰 교통 정리", "IFC몰", "서울 영등포구 국제금융로 10", 37.5252, 126.9255, "indoor", "귀가 전 교통·짐 정리")
      ]
    }
  ];
}

function goyangTemplates() {
  return [
    {
      title: "행주산성·행주문화제 권역",
      theme: "행주산성 역사 산책과 축제장 접근",
      items: [
        item("10:00", "12:00", "행주산성 역사 탐방", "행주산성", "경기 고양시 덕양구 행주로15번길 89", 37.5961203, 126.8264702, "outdoor", "행주산성·행주문화제 권역을 여유 있게 시작"),
        item("12:10", "13:20", "행주산성 먹거리촌 점심", "행주산성먹거리촌", "경기 고양시 덕양구 행주산성로 97", 37.5962592, 126.8261007, "meal", "개별 식당 영업시간과 대기 여부 확인"),
        item("15:00", "17:20", "행주산성역사공원 산책", "행주산성역사공원", "경기 고양시 덕양구 행주외동 140-8", 37.5982699, 126.8197596, "outdoor", "축제장·야간 관람 동선 사전 확인"),
        item("17:50", "18:50", "행주산성 카페 휴식", "행주산성 카페 리오리코", "경기 고양시 덕양구 행주산성로 127", 37.5968, 126.8239, "meal", "야간 행사 전 휴식과 간단한 식사 대안")
      ]
    },
    {
      title: "일산 호수공원·문화시설",
      theme: "느린 산책과 실내 관람",
      items: [
        item("10:00", "11:30", "일산호수공원 산책", "일산호수공원", "경기 고양시 일산동구 호수로 595", 37.662, 126.7666, "outdoor", "비가 강하면 산책 시간을 줄이고 실내로 우회"),
        item("12:00", "13:00", "포폴로피자 점심", "포폴로피자", "경기 고양시 일산동구 정발산로 43-20", 37.6576, 126.772, "meal", "식당 영업과 웨이팅은 지도 상세 확인"),
        item("13:30", "15:00", "고양아람누리 관람", "고양아람누리", "경기 고양시 일산동구 중앙로 1286", 37.6617, 126.7746, "indoor", "공연·전시 일정은 당일 재확인"),
        item("17:30", "18:40", "웨스턴돔 저녁", "웨스턴돔", "경기 고양시 일산동구 정발산로 24", 37.6546, 126.7729, "meal", "식사 선택지가 많은 권역")
      ]
    },
    {
      title: "삼송·귀가 전 실내 여유",
      theme: "출발 전 쇼핑·휴식과 교통 정리",
      items: [
        item("10:00", "11:30", "스타필드 고양 휴식", "스타필드 고양", "경기 고양시 덕양구 고양대로 1955", 37.647, 126.8958, "indoor", "더운 날·우천 시 안정적인 실내 체류"),
        item("11:50", "12:50", "스타필드 고양 점심", "이마트 트레이더스 스타필드고양점", "경기 고양시 덕양구 고양대로 1955", 37.647, 126.8958, "meal", "귀가 전 식사와 장보기 결합"),
        item("13:20", "14:20", "삼송역 교통 정리", "삼송역", "경기 고양시 덕양구 삼송로 194", 37.6531, 126.8956, "indoor", "귀가 교통과 짐 정리"),
        item("14:40", "15:30", "창릉천 산책", "창릉천", "경기 고양시 덕양구 동산동", 37.6509, 126.906, "outdoor", "날씨가 좋을 때만 짧게 선택")
      ]
    }
  ];
}

function daeguTemplates() {
  return [
    {
      title: "중구 골목·시장·박물관",
      theme: "도심 산책과 실내 관람",
      items: [
        item("10:00", "11:10", "김광석다시그리기길 산책", "김광석다시그리기길", "대구 중구 달구벌대로450길 27", 35.8609, 128.6075, "outdoor", "골목 산책은 날씨에 따라 짧게 조정"),
        item("11:40", "12:50", "서문시장 점심", "서문시장", "대구 중구 큰장로26길 45", 35.8694, 128.5807, "meal", "혼잡하면 점심 시간을 앞당김"),
        item("13:30", "14:50", "국립대구박물관 관람", "국립대구박물관", "대구 수성구 청호로 321", 35.8458, 128.6376, "indoor", "우천 대안으로 안정적인 실내 관람"),
        item("17:30", "18:40", "왕거미식당 저녁", "왕거미식당", "대구 중구 국채보상로 696-8", 35.8715, 128.6086, "meal", "저녁 영업 여부와 대기 시간을 재확인")
      ]
    }
  ];
}

function jeonjuTemplates() {
  return [
    {
      title: "한옥마을·경기전 중심",
      theme: "전주 대표 권역을 짧게 묶은 동선",
      items: [
        item("10:00", "11:10", "전주한옥마을 산책", "전주한옥마을", "전북 전주시 완산구 기린대로 99", 35.8151, 127.153, "outdoor", "한옥마을은 혼잡 시간을 피해 짧게 순환"),
        item("11:30", "12:30", "베테랑 칼국수 점심", "베테랑 칼국수", "전북 전주시 완산구 경기전길 135", 35.8153, 127.1519, "meal", "대기 시간이 길면 식사 순서를 조정"),
        item("13:00", "14:00", "경기전 관람", "경기전", "전북 전주시 완산구 태조로 44", 35.8155, 127.1499, "outdoor", "운영 시간과 휴무를 재확인"),
        item("17:20", "18:30", "한국집 저녁", "한국집", "전북 전주시 완산구 어진길 119", 35.8159, 127.1513, "meal", "저녁 영업 여부와 대기 시간을 재확인")
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

function extractDateRangeFromText(value, referenceDate) {
  const text = clean(value);
  const match = text.match(
    /(?:(\d{4})\s*[.\-/년]\s*)?(\d{1,2})\s*(?:[.\-/]|월)\s*(\d{1,2})(?:일)?\s*(?:-|~|부터|–|—|to)\s*(?:(\d{1,2})\s*(?:[.\-/]|월)\s*)?(\d{1,2})(?:일|까지)?/
  );
  if (!match) return null;

  const reference = normalizeDate(referenceDate) || currentKstDate();
  const explicitYear = match[1] ? Number(match[1]) : null;
  const startMonth = Number(match[2]);
  const startDay = Number(match[3]);
  let endMonth = match[4] ? Number(match[4]) : startMonth;
  const endDay = Number(match[5]);
  let startYear = explicitYear || Number(reference.slice(0, 4));

  let startDate = buildIsoDate(startYear, startMonth, startDay);
  if (!explicitYear && startDate && startDate < reference) {
    startYear += 1;
    startDate = buildIsoDate(startYear, startMonth, startDay);
  }
  if (!startDate) return null;

  if (!match[4] && endDay < startDay) endMonth += 1;
  let endYear = startYear;
  if (endMonth > 12) {
    endMonth = 1;
    endYear += 1;
  }
  let endDate = buildIsoDate(endYear, endMonth, endDay);
  if (endDate && endDate < startDate) endDate = buildIsoDate(endYear + 1, endMonth, endDay);
  if (!endDate) return null;

  return { startDate, endDate };
}

function inferRegionFromText(value) {
  const text = clean(value);
  if (!text) return "";
  const candidate = Object.values(REGION_DEFINITIONS).find((region) => text.includes(region.region));
  return candidate?.region || "";
}

function buildIsoDate(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return "";
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function currentKstDate() {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, "0")}-${String(kst.getUTCDate()).padStart(2, "0")}`;
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

function repairMealCategory(category, item) {
  const text = clean(`${item.title || ""} ${item.placeName || ""} ${item.memo || item.reason || item.note || ""}`);
  if (/아침|조식|점심|저녁|식사|브런치|breakfast|lunch|dinner/i.test(text)) return "meal";
  return category;
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

function normalizeStringList(value, limit = 5) {
  if (!value) return [];
  const seen = new Set();
  const result = [];
  for (const entry of flattenList(value)) {
    const text = clean(entry);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    result.push(text);
    if (result.length >= limit) break;
  }
  return result;
}

function normalizeEventSuggestions(value, limit = 5) {
  const seen = new Set();
  const result = [];
  for (const event of flattenList(value || [])) {
    if (!event || typeof event !== "object") continue;
    const title = clean(event.title || event.name || event.eventName);
    if (!title || seen.has(title)) continue;
    seen.add(title);
    result.push({
      id: clean(event.id || event.contentId || event.contentid || `event-${result.length + 1}`),
      title,
      dateRange: normalizeEventDateRange(event),
      area: clean(event.area || event.region || event.addr1 || event.address),
      reason: clean(event.reason || event.fit || event.memo || event.description)
    });
    if (result.length >= limit) break;
  }
  return result;
}

function normalizeEventDateRange(event) {
  const direct = clean(event.dateRange || event.period);
  if (direct) return direct.replace(/\d{8}/g, (value) => normalizeCompactDate(value) || value);
  const start = normalizeCompactDate(event.eventStartDate || event.eventstartdate);
  const end = normalizeCompactDate(event.eventEndDate || event.eventenddate);
  return [start, end].filter(Boolean).join("~");
}

function normalizeCompactDate(value) {
  const text = clean(value);
  const compact = text.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;
  return normalizeDate(text);
}

function flattenList(value) {
  if (Array.isArray(value)) return value.flatMap(flattenList);
  return [value];
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
