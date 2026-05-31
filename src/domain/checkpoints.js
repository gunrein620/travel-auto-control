import { addMinutes, formatKst } from "./time.js";

export function calculateCheckpoints(item) {
  const travelMinutes = Number.isFinite(item.travelMinutesBefore) ? item.travelMinutesBefore : 20;
  return [
    {
      id: `${item.id}-60m`,
      itemId: item.id,
      kind: "sixtyMinutesBefore",
      runAt: formatKst(addMinutes(item.startsAt, -60))
    },
    {
      id: `${item.id}-30m`,
      itemId: item.id,
      kind: "thirtyMinutesBefore",
      runAt: formatKst(addMinutes(item.startsAt, -30))
    },
    {
      id: `${item.id}-departure`,
      itemId: item.id,
      kind: "departure",
      runAt: formatKst(addMinutes(item.startsAt, -travelMinutes))
    }
  ];
}

export function calculatePlanCheckpoints(items) {
  return items.flatMap((item) => calculateCheckpoints(item));
}

export function getDueCheckpoints(items, nowIso = new Date().toISOString(), lookbackMinutes = 10) {
  const now = new Date(nowIso).getTime();
  const lookbackStart = now - lookbackMinutes * 60 * 1000;
  return calculatePlanCheckpoints(items).filter((checkpoint) => {
    const runAt = new Date(checkpoint.runAt).getTime();
    return runAt <= now && runAt >= lookbackStart;
  });
}
