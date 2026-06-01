const KTO_SEARCH_KEYWORD_URL = "https://apis.data.go.kr/B551011/KorService2/searchKeyword2";
const KTO_DETAIL_URL_BASE = "https://korean.visitkorea.or.kr/detail/ms_detail.do";

export async function searchTouristPlaces({ query, lat, lng, radius = 5000, size = 5 } = {}) {
  const key = process.env.KTO_SERVICE_KEY;
  const cleanQuery = clean(query);
  const point = normalizePoint({ lat, lng });

  if (!cleanQuery) {
    return {
      source: "fallback",
      status: "invalid-query",
      items: [],
      message: "검색어가 없어 KTO 관광정보를 조회하지 못했습니다."
    };
  }

  if (!key) {
    return {
      source: "fallback",
      status: "missing-key",
      items: [],
      message: "KTO API 키가 없어 관광정보 후보를 조회하지 못했습니다."
    };
  }

  const url = new URL(KTO_SEARCH_KEYWORD_URL);
  url.searchParams.set("serviceKey", key);
  url.searchParams.set("MobileOS", "ETC");
  url.searchParams.set("MobileApp", "PromptonTravelOps");
  url.searchParams.set("_type", "json");
  url.searchParams.set("keyword", cleanQuery);
  url.searchParams.set("numOfRows", String(clampNumber(size, 1, 20, 5)));

  try {
    const response = await fetch(url);
    if (!response.ok) {
      return {
        source: "kto",
        status: `error-${response.status}`,
        items: [],
        message: `KTO 관광정보 검색 실패(${response.status}). Kakao 후보로 보조 확인합니다.`
      };
    }

    const payload = await response.json();
    const documents = normalizeKtoItems(payload?.response?.body?.items?.item);
    const items = normalizeTouristDocuments(documents, point, radius);
    return {
      source: "kto",
      status: items.length ? "ok" : "empty",
      items,
      message: items.length ? "KTO 관광정보 검색 완료" : "KTO 관광정보 검색 결과가 비어 있습니다."
    };
  } catch (error) {
    return {
      source: "kto",
      status: "network-error",
      items: [],
      message: `KTO 관광정보 검색 오류: ${error.message}`
    };
  }
}

export function normalizeTouristDocuments(documents = [], point = null, radius = 5000) {
  const normalized = documents
    .map((document) => {
      const lat = toNumber(document.mapy, NaN);
      const lng = toNumber(document.mapx, NaN);
      const distanceMeters = point ? distanceBetweenMeters(point, { lat, lng }) : 0;
      return {
        id: clean(document.contentid) || `kto-${lat}-${lng}`,
        name: clean(document.title) || "관광지",
        address: clean([document.addr1, document.addr2].filter(Boolean).join(" ")),
        lat,
        lng,
        distanceMeters,
        distanceLabel: formatDistanceMeters(distanceMeters),
        placeUrl: detailUrl(document.contentid),
        category: "관광지",
        categoryDetail: contentTypeName(document.contenttypeid)
      };
    })
    .filter((item) => item.name && Number.isFinite(item.lat) && Number.isFinite(item.lng));

  return normalized
    .filter((item) => !point || !Number.isFinite(radius) || item.distanceMeters <= radius)
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
    .slice(0, 5);
}

function normalizeKtoItems(item) {
  if (!item) return [];
  return Array.isArray(item) ? item : [item];
}

function detailUrl(contentId) {
  const id = clean(contentId);
  if (!id) return "";
  const url = new URL(KTO_DETAIL_URL_BASE);
  url.searchParams.set("cotid", id);
  return url.toString();
}

function contentTypeName(contentTypeId) {
  const id = String(contentTypeId || "");
  return (
    {
      12: "관광지",
      14: "문화시설",
      15: "축제공연행사",
      25: "여행코스",
      28: "레포츠",
      32: "숙박",
      38: "쇼핑",
      39: "음식점"
    }[id] || "관광지"
  );
}

function normalizePoint(point) {
  const lat = toNumber(point.lat, NaN);
  const lng = toNumber(point.lng, NaN);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

function distanceBetweenMeters(a, b) {
  if (!Number.isFinite(a.lat) || !Number.isFinite(a.lng) || !Number.isFinite(b.lat) || !Number.isFinite(b.lng)) return 0;
  const earthRadius = 6371000;
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return Math.round(earthRadius * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)));
}

function toRadians(value) {
  return (value * Math.PI) / 180;
}

function formatDistanceMeters(value) {
  const meters = Number(value);
  if (!Number.isFinite(meters) || meters <= 0) return "거리 미확인";
  if (meters < 1000) return `${Math.round(meters)}m`;
  return `${(meters / 1000).toFixed(meters < 10000 ? 1 : 0)}km`;
}

function toNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clean(value) {
  return String(value ?? "").trim();
}
