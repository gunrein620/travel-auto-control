import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const STRIPPED_KEYS = new Set(["rawApiJson", "rawApiResponse", "serviceKey", "apiKey", "authorization"]);

export function createInitialState(seedItems = []) {
  return {
    plan: {
      id: "today",
      title: "",
      date: "",
      items: structuredClone(seedItems)
    },
    notifications: [],
    inspectionHistory: [],
    pushSubscriptions: []
  };
}

export async function loadState(filePath, seedItems) {
  if (process.env.DISABLE_FILE_STORE === "1") return createInitialState(seedItems);

  try {
    const saved = JSON.parse(await readFile(filePath, "utf8"));
    return normalizeState(saved, seedItems);
  } catch {
    return createInitialState(seedItems);
  }
}

export async function saveState(filePath, state) {
  if (process.env.DISABLE_FILE_STORE === "1") return;

  const safeState = stripUnsafeFields(state);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(safeState, null, 2)}\n`, "utf8");
}

export function stripUnsafeFields(value) {
  if (Array.isArray(value)) return value.map(stripUnsafeFields);
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !STRIPPED_KEYS.has(key))
      .map(([key, child]) => [key, stripUnsafeFields(child)])
  );
}

function normalizeState(saved, seedItems) {
  const initial = createInitialState(seedItems);
  return {
    ...initial,
    ...stripUnsafeFields(saved),
    plan: {
      ...initial.plan,
      ...(saved.plan ? stripUnsafeFields(saved.plan) : {}),
      items: Array.isArray(saved.plan?.items) && saved.plan.items.length ? stripUnsafeFields(saved.plan.items) : initial.plan.items
    },
    notifications: Array.isArray(saved.notifications) ? stripUnsafeFields(saved.notifications) : [],
    inspectionHistory: Array.isArray(saved.inspectionHistory) ? stripUnsafeFields(saved.inspectionHistory) : [],
    pushSubscriptions: Array.isArray(saved.pushSubscriptions) ? stripUnsafeFields(saved.pushSubscriptions) : []
  };
}
