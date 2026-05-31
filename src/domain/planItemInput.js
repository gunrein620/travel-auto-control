export function coercePlanItemInput(input) {
  return {
    title: clean(input.title || input.placeName),
    placeName: clean(input.placeName),
    address: clean(input.address),
    lat: toNumber(input.lat, 37.5665),
    lng: toNumber(input.lng, 126.978),
    startsAt: toKstDateTime(input.startsAt),
    endsAt: toKstDateTime(input.endsAt),
    transportMode: clean(input.transportMode || "walk"),
    travelMinutesBefore: toNumber(input.travelMinutesBefore, 20),
    category: clean(input.category || "indoor"),
    memo: clean(input.memo),
    status: "unchecked"
  };
}

export function toDatetimeLocalValue(isoString) {
  return String(isoString).replace(":00+09:00", "").slice(0, 16);
}

function clean(value) {
  return String(value ?? "").trim();
}

function toNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function toKstDateTime(value) {
  const text = clean(value);
  if (!text) return "";
  if (/[zZ]|[+-]\d{2}:\d{2}$/.test(text)) return text;
  return `${text.length === 16 ? `${text}:00` : text}+09:00`;
}
