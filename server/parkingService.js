const KAKAO_LOCAL_CATEGORY_URL = "https://dapi.kakao.com/v2/local/search/category.json";

export async function fetchNearbyParking({ lat, lng, radius = 800, size = 5 } = {}) {
  const key = process.env.KAKAO_REST_API_KEY;
  const point = normalizePoint({ lat, lng });

  if (!key) {
    return {
      source: "fallback",
      status: "missing-key",
      items: [],
      message: "Kakao Local 주차장 API 키가 없어 지도 앱에서 직접 확인이 필요합니다."
    };
  }

  if (!point) {
    return {
      source: "fallback",
      status: "invalid-coordinate",
      items: [],
      message: "도착지 좌표가 없어 주변 주차장을 조회하지 못했습니다."
    };
  }

  const url = new URL(KAKAO_LOCAL_CATEGORY_URL);
  url.searchParams.set("category_group_code", "PK6");
  url.searchParams.set("x", String(point.lng));
  url.searchParams.set("y", String(point.lat));
  url.searchParams.set("radius", String(clampNumber(radius, 100, 20000, 800)));
  url.searchParams.set("sort", "distance");
  url.searchParams.set("size", String(clampNumber(size, 1, 15, 5)));

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `KakaoAK ${key}`
      }
    });

    if (!response.ok) {
      return {
        source: "kakao",
        status: `error-${response.status}`,
        items: [],
        message: `Kakao Local 주차장 조회 실패(${response.status}). 지도 앱에서 재확인이 필요합니다.`
      };
    }

    const payload = await response.json();
    const items = normalizeParkingDocuments(payload.documents || [], point);
    return {
      source: "kakao",
      status: items.length ? "ok" : "empty",
      items,
      message: items.length ? "Kakao Local PK6 주차장 조회 완료" : "도착지 주변 주차장 결과가 비어 있습니다."
    };
  } catch (error) {
    return {
      source: "kakao",
      status: "network-error",
      items: [],
      message: `Kakao Local 주차장 조회 오류: ${error.message}`
    };
  }
}

export function normalizeParkingDocuments(documents = [], fallbackPoint = {}) {
  return documents
    .map((document) => {
      const lat = toNumber(document.y, fallbackPoint.lat);
      const lng = toNumber(document.x, fallbackPoint.lng);
      return {
        id: clean(document.id) || `parking-${lat}-${lng}`,
        name: clean(document.place_name) || "주차장",
        address: clean(document.road_address_name || document.address_name),
        phone: clean(document.phone),
        lat,
        lng,
        distanceMeters: Math.round(toNumber(document.distance, 0)),
        distanceLabel: formatDistanceMeters(toNumber(document.distance, 0)),
        placeUrl: clean(document.place_url),
        category: "parking"
      };
    })
    .filter((item) => item.name && Number.isFinite(item.lat) && Number.isFinite(item.lng))
    .slice(0, 5);
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

function formatDistanceMeters(value) {
  const meters = Number(value);
  if (!Number.isFinite(meters)) return "거리 미확인";
  if (meters <= 0) return "도착지 인접";
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
