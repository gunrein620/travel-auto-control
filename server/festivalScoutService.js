const KTO_SEARCH_FESTIVAL_URL = "https://apis.data.go.kr/B551011/KorService2/searchFestival2";
const KTO_SEARCH_KEYWORD_URL = "https://apis.data.go.kr/B551011/KorService2/searchKeyword2";
const KTO_DETAIL_INTRO_URL = "https://apis.data.go.kr/B551011/KorService2/detailIntro2";

const KTO_AREA_CODES = [
  ["서울", "1"],
  ["인천", "2"],
  ["대전", "3"],
  ["대구", "4"],
  ["광주", "5"],
  ["부산", "6"],
  ["울산", "7"],
  ["세종", "8"],
  ["경기", "31"],
  ["수원", "31"],
  ["고양", "31"],
  ["성남", "31"],
  ["용인", "31"],
  ["강원", "32"],
  ["충북", "33"],
  ["충청북", "33"],
  ["충남", "34"],
  ["충청남", "34"],
  ["경북", "35"],
  ["경상북", "35"],
  ["경남", "36"],
  ["경상남", "36"],
  ["전북", "37"],
  ["전라북", "37"],
  ["전남", "38"],
  ["전라남", "38"],
  ["제주", "39"]
];

const BROAD_REGION_TOKENS = new Set([
  "서울",
  "인천",
  "대전",
  "대구",
  "광주",
  "부산",
  "울산",
  "세종",
  "경기",
  "강원",
  "충북",
  "충청북",
  "충남",
  "충청남",
  "경북",
  "경상북",
  "경남",
  "경상남",
  "전북",
  "전라북",
  "전남",
  "전라남",
  "제주"
]);

const EVENT_NAME_SUFFIX_PATTERN =
  "(?:문화제|축제|페스티벌|불꽃쇼|드론(?:라이트)?쇼|콘서트|공연|도서전|영화제|음악회|엑스포|박람회|페스타|아트페어|야시장|마켓|전시)";

const GENERIC_EVENT_TERMS = new Set([
  "축제",
  "행사",
  "공연",
  "페스티벌",
  "콘서트",
  "관람",
  "가고",
  "싶어",
  "여행",
  "일정",
  "중심",
  "추천",
  "서울",
  "부산",
  "대구",
  "경기",
  "경남",
  "경상남도",
  "전북",
  "전라북도",
  "제주"
]);

export function hasFestivalIntent(request = {}) {
  const text = clean(
    [
      request.requests,
      request.interests,
      request.title,
      request.theme,
      request.pace,
      request.region,
      request.resolvedRegion?.queryRegion
    ].join(" ")
  );
  return new RegExp(`축제|행사|공연|페스티벌|festival|show|콘서트|드론|불꽃|${EVENT_NAME_SUFFIX_PATTERN}`, "i").test(text);
}

export async function scoutKtoFestivals(request = {}) {
  const key = process.env.KTO_SERVICE_KEY;
  if (!key) {
    return {
      source: "kto",
      status: "missing-key",
      events: [],
      apiStatus: ["KTO 행사정보 API 키 미설정"]
    };
  }

  const dateRange = normalizeRequestDateRange(request);
  if (!dateRange.startDate || !dateRange.endDate) {
    return {
      source: "kto",
      status: "invalid-date",
      events: [],
      apiStatus: ["KTO 행사정보 날짜 범위 누락"]
    };
  }

  const areaCode = inferKtoAreaCode(request);
  const apiStatus = [];
  const fetched = [];

  if (areaCode) {
    const local = await searchFestival({ key, startDate: dateRange.startDate, endDate: dateRange.endDate, areaCode });
    apiStatus.push(`KTO searchFestival2 areaCode=${areaCode} 결과 ${local.items.length}건`);
    fetched.push(...local.items);
  }

  const nationwide = await searchFestival({ key, startDate: dateRange.startDate, endDate: dateRange.endDate });
  apiStatus.push(`KTO searchFestival2 전국 재검색 결과 ${nationwide.items.length}건`);
  fetched.push(...nationwide.items);

  const keywordItems = await searchKeywordFallbacks({ key, request, dateRange });
  if (keywordItems.length > 0) apiStatus.push(`KTO searchKeyword2 행사명 보조검색 ${keywordItems.length}건`);
  fetched.push(...keywordItems);

  const deduped = dedupeFestivalItems(fetched);
  const regionMatched = deduped.filter((item) => overlapsTripDates(item, dateRange) && matchesRequestedRegion(item, request, areaCode));
  apiStatus.push(`KTO 행사 주소 필터 ${clean(request.region || request.resolvedRegion?.queryRegion || request.resolvedRegion?.region || "요청지역")} ${regionMatched.length}건`);

  const detailed = [];
  for (const item of rankFestivalMatches(regionMatched, request).slice(0, 5)) {
    detailed.push(await enrichFestival({ key, item, dateRange, request }));
  }

  return {
    source: "kto",
    status: detailed.length ? "ok" : "empty",
    events: detailed,
    apiStatus: uniqueStrings(apiStatus)
  };
}

async function searchFestival({ key, startDate, endDate, areaCode }) {
  const url = new URL(KTO_SEARCH_FESTIVAL_URL);
  addKtoCommonParams(url, key);
  url.searchParams.set("eventStartDate", compactDate(startDate));
  url.searchParams.set("eventEndDate", compactDate(endDate));
  url.searchParams.set("numOfRows", "100");
  url.searchParams.set("arrange", "A");
  if (areaCode) url.searchParams.set("areaCode", areaCode);
  return fetchKtoItems(url);
}

async function searchKeywordFallbacks({ key, request, dateRange }) {
  const keywords = eventKeywords(request);
  const results = [];
  for (const keyword of keywords.slice(0, 4)) {
    const url = new URL(KTO_SEARCH_KEYWORD_URL);
    addKtoCommonParams(url, key);
    url.searchParams.set("keyword", keyword);
    url.searchParams.set("contentTypeId", "15");
    url.searchParams.set("numOfRows", "20");
    const { items } = await fetchKtoItems(url);
    results.push(...items.filter((item) => overlapsTripDates(item, dateRange)));
  }
  return results;
}

async function enrichFestival({ key, item, dateRange, request }) {
  const detail = await fetchFestivalIntro({ key, contentId: item.contentid });
  const merged = { ...item, ...detail };
  const startDate = normalizeCompactDate(merged.eventstartdate) || dateRange.startDate;
  const endDate = normalizeCompactDate(merged.eventenddate) || startDate;
  const placeName = primaryFestivalPlace(merged.eventplace || merged.addr1 || merged.title);
  const event = {
    id: clean(merged.contentid) || `festival-${clean(merged.title)}`,
    title: clean(merged.title),
    startDate,
    endDate,
    dateRange: [startDate, endDate].filter(Boolean).join("~"),
    area: clean(merged.addr1 || merged.eventplace),
    address: clean(merged.addr1 || merged.eventplace),
    placeName,
    lat: toNumber(merged.mapy, NaN),
    lng: toNumber(merged.mapx, NaN),
    playtime: clean(merged.playtime),
    program: clean(merged.program || merged.subevent || merged.overview),
    price: clean(merged.usetimefestival),
    reason: festivalReason(merged, request),
    highlights: []
  };
  event.highlights = buildFestivalHighlights(event, dateRange);
  return event;
}

async function fetchFestivalIntro({ key, contentId }) {
  const id = clean(contentId);
  if (!id) return {};
  const url = new URL(KTO_DETAIL_INTRO_URL);
  addKtoCommonParams(url, key);
  url.searchParams.set("contentId", id);
  url.searchParams.set("contentTypeId", "15");
  const { items } = await fetchKtoItems(url);
  return items[0] || {};
}

async function fetchKtoItems(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) return { items: [], status: `error-${response.status}` };
    const payload = await response.json();
    return {
      items: normalizeKtoItems(payload?.response?.body?.items?.item),
      status: payload?.response?.header?.resultCode || "ok"
    };
  } catch (error) {
    return { items: [], status: "network-error", message: error.message };
  }
}

function addKtoCommonParams(url, key) {
  url.searchParams.set("serviceKey", key);
  url.searchParams.set("MobileOS", "ETC");
  url.searchParams.set("MobileApp", "PromptonTravelOps");
  url.searchParams.set("_type", "json");
}

function normalizeRequestDateRange(request) {
  return {
    startDate: normalizeDate(request.startDate || request.days?.[0]),
    endDate: normalizeDate(request.endDate || request.days?.at?.(-1) || request.days?.[request.days.length - 1])
  };
}

function inferKtoAreaCode(request) {
  const text = clean([request.region, request.resolvedRegion?.queryRegion, request.resolvedRegion?.region, request.requests].join(" "));
  const compact = text.replace(/\s+/g, "");
  return KTO_AREA_CODES.find(([label]) => compact.includes(label))?.[1] || "";
}

function eventKeywords(request) {
  const text = clean([request.requests, request.interests, request.region, request.resolvedRegion?.queryRegion].join(" "));
  const keywords = [];
  const explicit = text.match(new RegExp(`[가-힣A-Za-z0-9]+${EVENT_NAME_SUFFIX_PATTERN}`, "g")) || [];
  keywords.push(...explicit);
  if (/고양|행주/.test(text)) keywords.push("고양행주문화제", "행주문화제");
  return uniqueStrings(keywords);
}

function rankFestivalMatches(items, request) {
  const keywords = eventKeywords(request).map(compactText);
  const terms = requestEventTerms(request).map(compactText);
  return [...items].sort((a, b) => festivalMatchScore(b, keywords, terms) - festivalMatchScore(a, keywords, terms));
}

function festivalMatchScore(item, keywords, terms) {
  const title = compactText(item.title);
  let score = 0;
  for (const keyword of keywords) {
    if (!keyword) continue;
    if (title.includes(keyword)) score += 100;
    else if (keyword.includes(title) && title.length >= 4) score += 80;
  }
  for (const term of terms) {
    if (term.length >= 3 && title.includes(term)) score += 12;
  }
  return score;
}

function requestEventTerms(request) {
  const text = clean([request.requests, request.interests].join(" "));
  return uniqueStrings(
    text
      .split(/[^가-힣A-Za-z0-9]+/)
      .map((token) => token.replace(/(특별시|광역시|특례시|자치시|도|시|군|구)$/g, ""))
      .filter((token) => token.length >= 2 && !GENERIC_EVENT_TERMS.has(token))
  );
}

function dedupeFestivalItems(items) {
  const seen = new Set();
  const result = [];
  for (const item of items || []) {
    const key = clean(item.contentid) || `${clean(item.title)}-${clean(item.addr1)}`;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function matchesRequestedRegion(item, request, areaCode) {
  const haystack = clean([item.title, item.addr1, item.addr2, item.eventplace].join(" ")).replace(/\s+/g, "");
  const itemAreaCode = clean(item.areacode);
  const tokens = regionTokens(request);
  const hasTokenMatch = tokens.some((token) => token.length >= 2 && haystack.includes(token));
  if (hasTokenMatch) return true;

  if (areaCode && itemAreaCode && itemAreaCode === areaCode && isBroadAreaRequest(tokens)) return true;
  return false;
}

function regionTokens(request) {
  const baseCandidates = [
    request.region,
    request.resolvedRegion?.queryRegion,
    request.resolvedRegion?.region
  ];
  const baseTokens = tokensFromRegionValues(baseCandidates);
  if (isBroadAreaRequest(baseTokens)) return baseTokens;

  const tokens = uniqueStrings([...baseTokens, ...tokensFromRegionValues(request.resolvedRegion?.addressHints || [])]);
  const specificTokens = tokens.filter((token) => !BROAD_REGION_TOKENS.has(token));
  return specificTokens.length ? specificTokens : tokens;
}

function tokensFromRegionValues(values) {
  return uniqueStrings(
    values
      .flatMap((value) => clean(value).split(/[,\s]+/))
      .flatMap((value) => [value, value.replace(/(특별시|광역시|특례시|자치시|도|시|군|구)$/g, "")])
      .map((value) => value.replace(/[^가-힣A-Za-z0-9]/g, ""))
      .filter(Boolean)
  );
}

function isBroadAreaRequest(tokens) {
  const meaningful = tokens.filter((token) => token.length >= 2);
  return meaningful.length > 0 && meaningful.every((token) => BROAD_REGION_TOKENS.has(token));
}

function overlapsTripDates(item, dateRange) {
  const start = normalizeCompactDate(item.eventstartdate) || dateRange.startDate;
  const end = normalizeCompactDate(item.eventenddate) || start;
  return start <= dateRange.endDate && end >= dateRange.startDate;
}

function festivalReason(item, request) {
  const region = clean(request.region || request.resolvedRegion?.queryRegion || request.resolvedRegion?.region || "요청 지역");
  const dateRange = [normalizeCompactDate(item.eventstartdate), normalizeCompactDate(item.eventenddate)].filter(Boolean).join("~");
  return `${region} 여행 기간과 겹치는 KTO 축제공연행사 후보${dateRange ? ` (${dateRange})` : ""}`;
}

function buildFestivalHighlights(event, dateRange) {
  if (/고양행주문화제/.test(event.title)) {
    return overlappingDates(event, dateRange).map((date) => ({
      id: `${event.id}-drone-fireworks-${date}`,
      title: "행주 드론불꽃쇼 관람",
      date,
      startsAt: `${date}T20:20:00+09:00`,
      endsAt: `${date}T21:10:00+09:00`,
      placeName: "행주산성역사공원",
      address: event.address || "경기도 고양시 덕양구 행주로15번길 89",
      lat: Number.isFinite(event.lat) ? event.lat : 37.6004267743,
      lng: Number.isFinite(event.lng) ? event.lng : 126.8245886711,
      category: "outdoor",
      memo: "고양행주문화제 야간 대표 프로그램, 20:35경 시작"
    }));
  }

  const slot = festivalVisitSlot(event, dateRange);
  return slot ? [slot] : [];
}

function festivalVisitSlot(event, dateRange) {
  const date = overlappingDates(event, dateRange)[0];
  if (!date) return null;
  const [start, end] = parsePlaytime(event.playtime);
  return {
    id: `${event.id}-festival-visit-${date}`,
    title: `${event.title} 관람`,
    date,
    startsAt: `${date}T${start}:00+09:00`,
    endsAt: `${date}T${end}:00+09:00`,
    placeName: event.placeName || event.title,
    address: event.address,
    lat: event.lat,
    lng: event.lng,
    category: "outdoor",
    memo: `${event.title} 행사 운영시간 기준 편성`
  };
}

function overlappingDates(event, dateRange) {
  const dates = [];
  let cursor = maxDate(event.startDate, dateRange.startDate);
  const end = minDate(event.endDate, dateRange.endDate);
  for (let index = 0; cursor && cursor <= end && index < 7; index += 1) {
    dates.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return dates;
}

function parsePlaytime(playtime) {
  const matches = clean(playtime).match(/(\d{1,2}):(\d{2}).*?(\d{1,2}):(\d{2})/);
  if (!matches) return ["19:00", "21:00"];
  const start = `${matches[1].padStart(2, "0")}:${matches[2]}`;
  const end = `${matches[3].padStart(2, "0")}:${matches[4]}`;
  return end > start ? [start, end] : [start, addMinutesToTime(start, 30)];
}

function primaryFestivalPlace(value) {
  const text = clean(value);
  if (/행주산성역사공원/.test(text)) return "행주산성역사공원";
  return text.split(/\s*(?:및|,|·|\/)\s*/)[0] || text;
}

function normalizeKtoItems(item) {
  if (!item) return [];
  return Array.isArray(item) ? item : [item];
}

function compactDate(value) {
  return normalizeDate(value).replaceAll("-", "");
}

function normalizeCompactDate(value) {
  const text = clean(value);
  const compact = text.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;
  return normalizeDate(text);
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

function maxDate(a, b) {
  if (!a) return b;
  if (!b) return a;
  return a >= b ? a : b;
}

function minDate(a, b) {
  if (!a) return b;
  if (!b) return a;
  return a <= b ? a : b;
}

function uniqueStrings(values) {
  return [...new Set((values || []).map((value) => clean(value)).filter(Boolean))];
}

function toNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clean(value) {
  return String(value ?? "").trim();
}

function compactText(value) {
  return clean(value).replace(/\s+/g, "");
}

function addMinutesToTime(time, minutes) {
  const [hour, minute] = time.split(":").map(Number);
  const total = hour * 60 + minute + minutes;
  const nextHour = Math.min(23, Math.floor(total / 60));
  const nextMinute = total >= 24 * 60 ? 59 : total % 60;
  return `${String(nextHour).padStart(2, "0")}:${String(nextMinute).padStart(2, "0")}`;
}
