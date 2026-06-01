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

export function normalizeTripRequest(input = {}) {
  const startDate = normalizeDate(input.startDate) || "2026-06-27";
  const endDate = normalizeDate(input.endDate) || addDays(startDate, 2);
  const range = buildDateRange(startDate, endDate);
  const queryRegion = clean(input.region || input.destination || input.resolvedRegion?.queryRegion || "");
  const resolvedRegion = resolveTripRegion(queryRegion || input.resolvedRegion?.region || "");

  return {
    region: queryRegion || resolvedRegion.region,
    resolvedRegion,
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
  const qualityWarnings = [];

  rawDays.forEach((day, dayIndex) => {
    const date = normalizeDate(day.date) || request.days[dayIndex] || request.days.at(-1);
    const rawItems = day.items || day.schedule || day.activities || [];
    if (!Array.isArray(rawItems) || rawItems.length === 0) return;
    const selectedItems = rawItems.slice(0, 4);

    const dayItems = refineWalkableCarHops(
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
        "지역을 더 구체화해 주세요. v1 지원 지역은 수원, 부산, 대구, 전주입니다."
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
    warning: `${fallbackRegion}은 v1 지원 지역이 아닙니다. 수원, 부산, 대구, 전주처럼 지역을 더 구체화해 주세요.`
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
  const category = normalizeCategory(item.category);
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
    case "대구":
      return daeguTemplates();
    case "전주":
      return jeonjuTemplates();
    default:
      return [];
  }
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
        item("12:10", "13:10", "먹을터 점심", "먹을터", "경기 수원시 팔달구 정조로801번길 16", 37.27976980345755, 127.01579757641547, "meal", "행궁동 도보권 식사"),
        item("13:40", "15:00", "화성행궁 관람", "화성행궁", "경기 수원시 팔달구 정조로 825", 37.2819, 127.0142, "outdoor", "운영/휴무는 KTO 상세정보로 재점검"),
        item("15:20", "16:10", "정지영커피로스터즈 휴식", "정지영커피로스터즈 행궁본점", "경기 수원시 팔달구 신풍로23번길 63", 37.2831, 127.0147, "meal", "아이 휴식과 화장실 확보")
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
        item("14:10", "15:30", "부산시립미술관 관람", "부산시립미술관", "부산 해운대구 APEC로 58", 35.1667, 129.1389, "indoor", "우천 시에도 유지하기 쉬운 실내 일정")
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
        item("15:20", "16:20", "수성못 산책", "수성못", "대구 수성구 두산동", 35.8287, 128.6176, "outdoor", "피곤하면 카페 휴식으로 짧게 전환")
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
        item("14:20", "15:00", "전동성당 외관 관람", "전동성당", "전북 전주시 완산구 태조로 51", 35.8136, 127.1498, "outdoor", "예식·행사 여부를 현장 확인")
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
