import { createReadStream, existsSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { getDueCheckpoints } from "../src/domain/checkpoints.js";
import { createNotificationForDecision } from "../src/domain/notifications.js";
import { loadEnvFile } from "./env.js";
import { generateItineraryPlan } from "./ennoiaItineraryService.js";
import { draftNaturalLanguageEditWithEnnoia } from "./ennoiaNaturalEditService.js";
import { inspectItem } from "./inspectionService.js";
import { fetchNearbyParking } from "./parkingService.js";
import { fetchRouteGeometry } from "./routeService.js";
import { sanitizeNaturalEditPatch } from "./scheduleEditAgent.js";
import {
  addItem,
  addNotification,
  addPushSubscription,
  applyNotificationPatch,
  deleteItem,
  dismissNotification,
  findItem,
  getState,
  recordInspection,
  replacePlanWithGeneratedTrip,
  updateItem
} from "./store.js";

const rootDir = join(fileURLToPath(new URL("..", import.meta.url)));
await loadEnvFile(join(rootDir, ".env"));
const port = Number(process.env.PORT || 8787);

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (url.pathname.startsWith("/api")) {
      await handleApi(request, response, url);
      return;
    }
    await serveStatic(response, url.pathname);
  } catch (error) {
    sendJson(response, 500, { error: "서버 내부 오류", detail: error.message });
  }
});

server.listen(port, () => {
  console.log(`Travel ops planner running at http://localhost:${port}`);
});

async function handleApi(request, response, url) {
  if (request.method === "GET" && url.pathname === "/api/state") {
    sendJson(response, 200, getState());
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/items") {
    sendJson(response, 201, { item: addItem(await readJson(request)), state: getState() });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/parking/nearby") {
    const parking = await fetchNearbyParking({
      lat: url.searchParams.get("lat"),
      lng: url.searchParams.get("lng"),
      radius: url.searchParams.get("radius") || 800,
      size: url.searchParams.get("size") || 5
    });
    sendJson(response, 200, parking);
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/routes/segment") {
    const route = await fetchRouteGeometry({
      fromLat: url.searchParams.get("fromLat"),
      fromLng: url.searchParams.get("fromLng"),
      toLat: url.searchParams.get("toLat"),
      toLng: url.searchParams.get("toLng"),
      mode: url.searchParams.get("mode") || "walk",
      departAt: url.searchParams.get("departAt") || ""
    });
    sendJson(response, 200, route);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/trips/generate") {
    const generation = await generateItineraryPlan(await readJson(request));
    if (!hasGeneratedItems(generation)) {
      sendJson(response, 422, {
        error: buildEmptyGenerationMessage(generation),
        generation,
        state: getState()
      });
      return;
    }
    replacePlanWithGeneratedTrip(generation);
    sendJson(response, 200, { generation, state: getState() });
    return;
  }

  const itemPatchMatch = url.pathname.match(/^\/api\/items\/([^/]+)$/);
  if (request.method === "PATCH" && itemPatchMatch) {
    const item = updateItem(itemPatchMatch[1], await readJson(request));
    sendJson(response, item ? 200 : 404, item ? { item, state: getState() } : { error: "일정을 찾을 수 없습니다." });
    return;
  }

  if (request.method === "DELETE" && itemPatchMatch) {
    const deleted = deleteItem(itemPatchMatch[1]);
    sendJson(response, deleted ? 200 : 404, deleted ? { state: getState() } : { error: "일정을 찾을 수 없습니다." });
    return;
  }

  const inspectMatch = url.pathname.match(/^\/api\/items\/([^/]+)\/inspect$/);
  if (request.method === "POST" && inspectMatch) {
    const result = await inspectAndRecord(inspectMatch[1]);
    sendJson(response, result ? 200 : 404, result || { error: "일정을 찾을 수 없습니다." });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/inspect/all") {
    const state = getState();
    const results = [];
    for (const item of state.plan.items) {
      results.push(await inspectAndRecord(item.id));
    }
    sendJson(response, 200, { results, state: getState() });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/inspect/due") {
    const state = getState();
    const now = url.searchParams.get("now") || new Date().toISOString();
    const dueCheckpoints = getDueCheckpoints(state.plan.items, now, 10);
    const dueItemIds = [...new Set(dueCheckpoints.map((checkpoint) => checkpoint.itemId))];
    const results = [];
    for (const itemId of dueItemIds) {
      results.push(await inspectAndRecord(itemId));
    }
    sendJson(response, 200, { dueCheckpoints, results, state: getState() });
    return;
  }

  const notificationApplyMatch = url.pathname.match(/^\/api\/notifications\/([^/]+)\/apply$/);
  if (request.method === "POST" && notificationApplyMatch) {
    const item = applyNotificationPatch(notificationApplyMatch[1]);
    sendJson(response, item ? 200 : 404, item ? { item, state: getState() } : { error: "적용할 우회안이 없습니다." });
    return;
  }

  const notificationDismissMatch = url.pathname.match(/^\/api\/notifications\/([^/]+)\/dismiss$/);
  if (request.method === "POST" && notificationDismissMatch) {
    const notice = dismissNotification(notificationDismissMatch[1]);
    sendJson(response, notice ? 200 : 404, notice ? { notification: notice, state: getState() } : { error: "알림이 없습니다." });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/natural-edits") {
    const body = await readJson(request);
    const draft = await draftNaturalLanguageEditWithEnnoia(body.text || "", getState().plan.items, {
      mode: body.mode || "update",
      activeDate: body.activeDate || getState().plan.date
    });
    sendJson(response, 200, { draft });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/natural-edits/apply") {
    const body = await readJson(request);
    const patch = selectedNaturalEditPatch(body);
    if (body.operation === "add") {
      const item = addItem(sanitizeNaturalEditPatch(patch, {}));
      sendJson(response, 201, { operation: "add", item, rechecked: [], state: getState() });
      return;
    }

    const target = body.targetItemId ? findItem(body.targetItemId) : null;
    const item = target ? updateItem(target.id, sanitizeNaturalEditPatch(patch, target)) : null;
    sendJson(
      response,
      item ? 200 : 404,
      item ? { operation: "update", item, rechecked: [], state: getState() } : { error: "대상 일정이 없습니다." }
    );
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/push-subscriptions") {
    const saved = addPushSubscription(await readJson(request));
    sendJson(response, 201, { subscription: { id: saved.id, createdAt: saved.createdAt } });
    return;
  }

  sendJson(response, 404, { error: "API 경로를 찾을 수 없습니다." });
}

function selectedNaturalEditPatch(draft = {}) {
  if (!draft.selectedRecommendationId) return draft.patch || {};
  const selected = Array.isArray(draft.recommendations)
    ? draft.recommendations.find((recommendation) => recommendation.id === draft.selectedRecommendationId)
    : null;
  return selected?.patch || draft.patch || {};
}

async function inspectAndRecord(itemId) {
  const item = findItem(itemId);
  if (!item) return null;
  const decision = await inspectItem(item);
  const updatedItem = recordInspection(itemId, decision);
  const notification = addNotification(createNotificationForDecision(updatedItem, decision));
  return { item: updatedItem, decision, notification, state: getState() };
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(body));
}

function hasGeneratedItems(generation) {
  return Array.isArray(generation?.items) && generation.items.length > 0;
}

function buildEmptyGenerationMessage(generation) {
  const warnings = generation?.trip?.warnings || [];
  const regionHint = warnings.find((warning) => /지역|구체화|지원 지역/.test(warning));
  return regionHint || "일정을 만들 수 있는 장소가 확정되지 않았습니다. 지역이나 여행지를 더 구체화해 주세요.";
}

async function serveStatic(response, pathname) {
  const cleanPath = normalize(pathname === "/" ? "/index.html" : pathname).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(rootDir, cleanPath);
  if (!filePath.startsWith(rootDir) || !existsSync(filePath)) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }
  const type = contentType(extname(filePath));
  const cacheControl = filePath.endsWith("index.html") || filePath.endsWith("sw.js") ? "no-store" : "public, max-age=60";
  response.writeHead(200, {
    "Content-Type": type,
    "Cache-Control": cacheControl
  });
  createReadStream(filePath).pipe(response);
}

function contentType(extension) {
  return (
    {
      ".html": "text/html; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".webmanifest": "application/manifest+json; charset=utf-8",
      ".svg": "image/svg+xml"
    }[extension] || "application/octet-stream"
  );
}
