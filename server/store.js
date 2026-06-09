import { calculatePlanCheckpoints } from "../src/domain/checkpoints.js";
import { applySuggestedPatch } from "../src/domain/notifications.js";
import { coercePlanItemInput } from "../src/domain/planItemInput.js";
import { seedItems } from "./seed.js";
import { loadState, saveState } from "./statePersistence.js";

const stateFilePath = process.env.STATE_FILE || new URL("../data/app-state.json", import.meta.url).pathname;
const state = await loadState(stateFilePath, seedItems);

export function getState() {
  return {
    ...state,
    plan: {
      ...state.plan,
      checkpoints: calculatePlanCheckpoints(state.plan.items)
    }
  };
}

export function addItem(input) {
  const normalized = coercePlanItemInput(input);
  const item = {
    id: `item-${Date.now()}`,
    ...normalized
  };
  state.plan.items.push(item);
  sortItems();
  persistState();
  return item;
}

export function replacePlanWithGeneratedTrip(generation) {
  state.plan = {
    id: generation.trip.id,
    title: generation.trip.title,
    date: generation.trip.startDate,
    startDate: generation.trip.startDate,
    endDate: generation.trip.endDate,
    region: generation.trip.region,
    travelers: generation.trip.travelers,
    days: generation.trip.days,
    generation: {
      source: generation.trip.source,
      modelStatus: generation.trip.modelStatus,
      apiStatus: generation.trip.apiStatus,
      evidence: generation.trip.evidence,
      eventSuggestions: generation.trip.eventSuggestions || [],
      warnings: generation.trip.warnings,
      generatedAt: generation.trip.generatedAt
    },
    items: generation.items
  };
  state.notifications = [];
  state.inspectionHistory = [];
  persistState();
  return state.plan;
}

export function updateItem(id, patch) {
  const index = state.plan.items.findIndex((item) => item.id === id);
  if (index < 0) return null;
  const normalized = patch.startsAt || patch.endsAt || patch.placeName ? coercePlanItemInput({ ...state.plan.items[index], ...patch }) : patch;
  state.plan.items[index] = {
    ...state.plan.items[index],
    ...normalized,
    status: normalized.status || "unchecked",
    lastInspection: undefined
  };
  sortItems();
  persistState();
  return findItem(id);
}

export function deleteItem(id) {
  const before = state.plan.items.length;
  state.plan.items = state.plan.items.filter((item) => item.id !== id);
  state.notifications = state.notifications.filter((notice) => notice.itemId !== id);
  const deleted = before !== state.plan.items.length;
  if (deleted) persistState();
  return deleted;
}

export function findItem(id) {
  return state.plan.items.find((item) => item.id === id);
}

export function recordInspection(itemId, decision) {
  const item = findItem(itemId);
  if (!item) return null;
  item.status = decision.status;
  item.lastInspection = decision;
  state.inspectionHistory.unshift({
    id: `history-${Date.now()}`,
    itemId,
    decision,
    createdAt: decision.checkedAt
  });
  persistState();
  return item;
}

export function addNotification(notification) {
  if (!notification) return null;
  state.notifications.unshift(notification);
  persistState();
  return notification;
}

export function dismissNotification(id) {
  const notification = state.notifications.find((notice) => notice.id === id);
  if (!notification) return null;
  notification.dismissed = true;
  persistState();
  return notification;
}

export function applyNotificationPatch(id) {
  const notification = state.notifications.find((notice) => notice.id === id);
  if (!notification?.suggestedPatch) return null;
  const item = findItem(notification.itemId);
  if (!item) return null;
  const patched = applySuggestedPatch(item, notification.suggestedPatch);
  updateItem(item.id, patched);
  notification.dismissed = true;
  persistState();
  return patched;
}

export function addPushSubscription(subscription) {
  const existing = state.pushSubscriptions.find((entry) => entry.endpoint === subscription.endpoint);
  if (existing) return existing;
  const saved = {
    ...subscription,
    id: `push-${Date.now()}`,
    createdAt: new Date().toISOString()
  };
  state.pushSubscriptions.push(saved);
  persistState();
  return saved;
}

function sortItems() {
  state.plan.items.sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
}

function persistState() {
  saveState(stateFilePath, state).catch((error) => {
    console.error("Failed to persist planner state", error);
  });
}
