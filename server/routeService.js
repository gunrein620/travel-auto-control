import { estimateTravelMinutes } from "../src/domain/routeSegments.js";

const OSRM_BASE_URL = "https://router.project-osrm.org";
const KAKAO_DIRECTIONS_URL = "https://apis-navi.kakaomobility.com/v1/directions";

const MODE_TO_PROFILE = {
  walk: "foot",
  car: "driving",
  taxi: "driving",
  bus: "driving",
  subway: "driving"
};

const CAR_LIKE_MODES = new Set(["car", "taxi"]);

export async function fetchRouteGeometry({ fromLat, fromLng, toLat, toLng, mode = "walk", departAt } = {}) {
  const coordinates = [fromLat, fromLng, toLat, toLng].map(Number);
  if (!coordinates.every(Number.isFinite)) {
    return {
      source: "osrm",
      status: "invalid-coordinate",
      profile: profileForMode(mode),
      points: [],
      message: "경로 좌표가 부족합니다."
    };
  }

  const [startLat, startLng, endLat, endLng] = coordinates;
  const profile = profileForMode(mode);
  const coordinatePair = `${coordinate(startLng)},${coordinate(startLat)};${coordinate(endLng)},${coordinate(endLat)}`;
  const requestUrl = new URL(`/route/v1/${profile}/${coordinatePair}`, OSRM_BASE_URL);
  requestUrl.searchParams.set("overview", "full");
  requestUrl.searchParams.set("geometries", "geojson");
  requestUrl.searchParams.set("steps", "false");
  requestUrl.searchParams.set("alternatives", "false");

  try {
    const response = await fetch(requestUrl);
    if (!response.ok) {
      return {
        source: "osrm",
        status: `error-${response.status}`,
        profile,
        points: [],
        message: "도로 경로 조회에 실패했습니다."
      };
    }
    const route = normalizeOsrmRoute(await response.json(), profile);
    return decorateWithRealisticDuration(route, {
      mode,
      departAt,
      fromLat: startLat,
      fromLng: startLng,
      toLat: endLat,
      toLng: endLng
    });
  } catch (error) {
    return {
      source: "osrm",
      status: "network-error",
      profile,
      points: [],
      message: error.message
    };
  }
}

export function normalizeOsrmRoute(payload, profile = "foot") {
  const route = payload?.code === "Ok" ? payload.routes?.[0] : null;
  const coordinates = route?.geometry?.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length < 2) {
    return {
      source: "osrm",
      status: "empty",
      profile,
      points: [],
      distanceMeters: 0,
      durationSeconds: 0
    };
  }

  const points = coordinates
    .map(([lng, lat]) => ({ lat: Number(lat), lng: Number(lng) }))
    .filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng));

  if (points.length < 2) {
    return {
      source: "osrm",
      status: "empty",
      profile,
      points: [],
      distanceMeters: 0,
      durationSeconds: 0
    };
  }

  return {
    source: "osrm",
    status: "ok",
    profile,
    distanceMeters: Math.round(Number(route.distance) || 0),
    durationSeconds: Math.round(Number(route.duration) || 0),
    points
  };
}

// OSRM 도로 거리는 신뢰하되, 시간은 현실적으로 재계산한다.
// - OSRM 데모 서버는 보행 프로파일이 없어 보행시간이 차량속도로 나오므로 항상 추정 모델로 덮어쓴다.
// - 자가용/택시는 Kakao 모빌리티 실시간 ETA가 있으면 우선 사용한다.
async function decorateWithRealisticDuration(route, ctx) {
  if (route.status !== "ok" || !(route.distanceMeters > 0)) {
    return { ...route, osrmDurationSeconds: route.durationSeconds ?? 0, durationSource: "estimate" };
  }

  const distanceKm = route.distanceMeters / 1000;
  let durationSeconds = estimateTravelMinutes({ distanceKm, mode: ctx.mode, departAt: ctx.departAt }) * 60;
  let durationSource = "estimate";

  if (CAR_LIKE_MODES.has(String(ctx.mode || "").trim())) {
    const kakao = await resolveCarEta(ctx);
    if (kakao && Number.isFinite(kakao.durationSeconds) && kakao.durationSeconds > 0) {
      durationSeconds = kakao.durationSeconds;
      durationSource = "kakao";
    }
  }

  return {
    ...route,
    osrmDurationSeconds: route.durationSeconds,
    durationSeconds,
    durationSource
  };
}

// Kakao 모빌리티 길찾기로 실시간 교통이 반영된 자가용 ETA를 조회한다.
async function resolveCarEta({ fromLat, fromLng, toLat, toLng }) {
  const key = process.env.KAKAO_REST_API_KEY;
  if (!key) return null;

  const url = new URL(KAKAO_DIRECTIONS_URL);
  url.searchParams.set("origin", `${coordinate(fromLng)},${coordinate(fromLat)}`);
  url.searchParams.set("destination", `${coordinate(toLng)},${coordinate(toLat)}`);
  url.searchParams.set("priority", "RECOMMEND");

  try {
    const response = await fetch(url, { headers: { Authorization: `KakaoAK ${key}` } });
    if (!response.ok) return null;
    const payload = await response.json();
    const route = payload?.routes?.[0];
    if (!route || route.result_code !== 0) return null;
    const summary = route.summary;
    if (!summary) return null;
    return {
      durationSeconds: Math.round(Number(summary.duration) || 0),
      distanceMeters: Math.round(Number(summary.distance) || 0)
    };
  } catch {
    return null;
  }
}

function profileForMode(mode) {
  return MODE_TO_PROFILE[String(mode || "").trim()] || "foot";
}

function coordinate(value) {
  return Number(value).toFixed(7).replace(/0+$/, "").replace(/\.$/, "");
}
