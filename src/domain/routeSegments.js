const EARTH_RADIUS_KM = 6371;

const ROUTE_MODE = {
  walk: {
    label: "도보",
    kakao: "foot",
    naver: "walk",
    speedKmh: 4.2,
    baseMinutes: 3
  },
  car: {
    label: "자가용",
    kakao: "car",
    naver: "car",
    speedKmh: 24,
    baseMinutes: 8
  },
  taxi: {
    label: "택시",
    kakao: "car",
    naver: "car",
    speedKmh: 26,
    baseMinutes: 7
  },
  bus: {
    label: "버스",
    kakao: "publictransit",
    naver: "transit",
    speedKmh: 17,
    baseMinutes: 12
  },
  subway: {
    label: "지하철",
    kakao: "publictransit",
    naver: "transit",
    speedKmh: 22,
    baseMinutes: 12
  }
};

export function buildRouteSegments(items = []) {
  const sorted = [...items].sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
  const segments = [];

  for (let index = 1; index < sorted.length; index += 1) {
    const from = sorted[index - 1];
    const to = sorted[index];
    const requestedMode = normalizeRouteMode(to.transportMode);
    const distanceKm = haversineKm(from, to);
    const mode = chooseSegmentMode(requestedMode, distanceKm);
    const minutes = estimateMinutes(to, distanceKm, mode);
    const availableMinutes = minutesBetween(from.endsAt, to.startsAt);
    const modeAdjusted = mode !== requestedMode;

    segments.push({
      id: `route-${from.id || index - 1}-${to.id || index}`,
      fromId: from.id,
      toId: to.id,
      fromName: clean(from.placeName || from.title),
      toName: clean(to.placeName || to.title),
      from,
      to,
      requestedMode,
      mode,
      modeLabel: ROUTE_MODE[mode].label,
      modeAdjusted,
      modeReason: modeAdjusted ? "가까운 구간은 주차 후 도보 이동이 자연스러움" : "",
      distanceKm,
      distanceLabel: formatDistance(distanceKm),
      minutes,
      timeLabel: `${minutes}분`,
      availableMinutes,
      availableLabel: formatAvailableMinutes(availableMinutes),
      timingTone: timingTone(minutes, availableMinutes),
      needsParking: requestedMode === "car" && mode === "car",
      parkingQuery:
        requestedMode === "car" && mode === "car"
          ? {
              lat: toNumber(to.lat, NaN),
              lng: toNumber(to.lng, NaN),
              placeName: clean(to.placeName || to.title)
            }
          : null,
      kakaoUrl: buildKakaoRouteUrl(from, to, mode),
      naverUrl: buildNaverRouteUrl(from, to, mode),
      mapEmbedUrl: buildMapEmbedUrl(from, to, mode),
      mapProvider: mapProvider(mode)
    });
  }

  return segments;
}

export function routeModeMeta(mode) {
  return ROUTE_MODE[normalizeRouteMode(mode)];
}

export function buildParkingRouteLinks(segment, parking) {
  if (!segment || !parking) return null;
  const parkingPoint = {
    title: clean(parking.name || "주차장"),
    placeName: clean(parking.name || "주차장"),
    lat: toNumber(parking.lat, NaN),
    lng: toNumber(parking.lng, NaN)
  };

  if (!Number.isFinite(parkingPoint.lat) || !Number.isFinite(parkingPoint.lng)) return null;

  return {
    parkingName: parkingPoint.placeName,
    parkingAddress: clean(parking.address),
    parkingDistanceLabel: clean(parking.distanceLabel),
    parkingPlaceUrl: clean(parking.placeUrl),
    parkingLat: parkingPoint.lat,
    parkingLng: parkingPoint.lng,
    destinationName: clean(segment.toName || segment.to?.placeName || segment.to?.title),
    carToParkingUrl: buildKakaoWebRouteUrl(segment.from, parkingPoint, "car"),
    walkToDestinationUrl: buildKakaoWebRouteUrl(parkingPoint, segment.to, "walk")
  };
}

function normalizeRouteMode(mode) {
  const text = clean(mode);
  if (ROUTE_MODE[text]) return text;
  if (text.includes("버스")) return "bus";
  if (text.includes("지하철") || text.includes("대중")) return "subway";
  if (text.includes("택시")) return "taxi";
  if (text.includes("차") || text.includes("자가")) return "car";
  return "walk";
}

function chooseSegmentMode(requestedMode, distanceKm) {
  if (requestedMode === "car" && Number.isFinite(distanceKm) && distanceKm <= 0.8) return "walk";
  return requestedMode;
}

function estimateMinutes(item, distanceKm, mode) {
  const explicit = Number(item.travelMinutesBefore);
  if (Number.isFinite(explicit) && explicit > 0) return Math.round(explicit);
  const meta = ROUTE_MODE[mode];
  if (!Number.isFinite(distanceKm)) return meta.baseMinutes;
  return Math.max(3, Math.round(meta.baseMinutes + (distanceKm / meta.speedKmh) * 60));
}

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
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function buildKakaoRouteUrl(from, to, mode) {
  const kakaoMode = ROUTE_MODE[normalizeRouteMode(mode)].kakao;
  const params = new URLSearchParams({
    sp: `${coordinate(from.lat)},${coordinate(from.lng)}`,
    ep: `${coordinate(to.lat)},${coordinate(to.lng)}`,
    by: kakaoMode
  });
  return `https://m.map.kakao.com/scheme/route?${params.toString()}`;
}

function buildKakaoWebRouteUrl(from, to, mode) {
  const kakaoWebMode = mode === "walk" ? "walk" : "car";
  return `https://map.kakao.com/link/by/${kakaoWebMode}/${encodeKakaoRoutePoint(from)}/${encodeKakaoRoutePoint(to)}`;
}

function buildNaverRouteUrl(from, to, mode) {
  const naverMode = ROUTE_MODE[normalizeRouteMode(mode)].naver;
  const fromPart = `${coordinate(from.lng)},${coordinate(from.lat)},${encodeRouteName(from)},,`;
  const toPart = `${coordinate(to.lng)},${coordinate(to.lat)},${encodeRouteName(to)},,`;
  return `https://map.naver.com/p/directions/${fromPart}/${toPart}/${naverMode}?c=15.00,0,0,0,dh`;
}

function buildMapEmbedUrl(from, to, mode) {
  const normalized = normalizeRouteMode(mode);
  if (normalized === "bus" || normalized === "subway") return buildNaverRouteUrl(from, to, normalized);
  return buildKakaoWebRouteUrl(from, to, normalized);
}

function mapProvider(mode) {
  const normalized = normalizeRouteMode(mode);
  return normalized === "bus" || normalized === "subway" ? "naver" : "kakao";
}

function encodeKakaoRoutePoint(item) {
  return `${encodeRouteName(item)},${coordinate(item.lat)},${coordinate(item.lng)}`;
}

function encodeRouteName(item) {
  return encodeURIComponent(clean(item.placeName || item.title || "장소"));
}

function coordinate(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Number(number.toFixed(7)) : "";
}

function minutesBetween(fromIso, toIso) {
  const from = new Date(fromIso).getTime();
  const to = new Date(toIso).getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return Math.max(0, Math.round((to - from) / 60000));
}

function timingTone(minutes, availableMinutes) {
  if (!Number.isFinite(availableMinutes)) return "normal";
  if (availableMinutes < minutes) return "tight";
  if (availableMinutes >= minutes + 15) return "relaxed";
  return "normal";
}

function formatDistance(distanceKm) {
  if (!Number.isFinite(distanceKm)) return "거리 계산 불가";
  if (distanceKm < 1) return `${Math.max(50, Math.round((distanceKm * 1000) / 50) * 50)}m`;
  return `${distanceKm.toFixed(distanceKm < 10 ? 1 : 0)}km`;
}

function formatAvailableMinutes(minutes) {
  if (!Number.isFinite(minutes)) return "여유 시간 미확인";
  return `일정 간격 ${minutes}분`;
}

function toRadians(degrees) {
  return (degrees * Math.PI) / 180;
}

function toNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clean(value) {
  return String(value ?? "").trim();
}
