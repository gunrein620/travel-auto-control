const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export function addMinutes(isoString, minutes) {
  return new Date(new Date(isoString).getTime() + minutes * 60 * 1000);
}

export function formatKst(date) {
  return new Date(date.getTime() + KST_OFFSET_MS).toISOString().replace("Z", "+09:00");
}

export function getKstHour(isoString) {
  return new Date(new Date(isoString).getTime() + KST_OFFSET_MS).getUTCHours();
}

export function formatClock(isoString) {
  const date = new Date(new Date(isoString).getTime() + KST_OFFSET_MS);
  return `${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}`;
}

export function formatDateLabel(isoString) {
  const date = new Date(new Date(isoString).getTime() + KST_OFFSET_MS);
  return `${date.getUTCFullYear()}.${String(date.getUTCMonth() + 1).padStart(2, "0")}.${String(
    date.getUTCDate()
  ).padStart(2, "0")}`;
}
