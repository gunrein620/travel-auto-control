const OSRM_BASE_URL = "https://router.project-osrm.org";

const MODE_TO_PROFILE = {
  walk: "foot",
  car: "driving",
  taxi: "driving",
  bus: "driving",
  subway: "driving"
};

export async function fetchRouteGeometry({ fromLat, fromLng, toLat, toLng, mode = "walk" } = {}) {
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
    return normalizeOsrmRoute(await response.json(), profile);
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

function profileForMode(mode) {
  return MODE_TO_PROFILE[String(mode || "").trim()] || "foot";
}

function coordinate(value) {
  return Number(value).toFixed(7).replace(/0+$/, "").replace(/\.$/, "");
}
