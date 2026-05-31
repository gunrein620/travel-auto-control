#!/bin/sh
set -eu

NODE_BIN="${NODE_BIN:-/Users/kunwoopark/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node}"

if [ ! -x "$NODE_BIN" ]; then
  NODE_BIN="$(command -v node)"
fi

STATE_FILE="$(mktemp /tmp/travel-ops-verify.XXXXXX.json)"
PORT="${PORT:-8792}"
BASE_URL="http://localhost:$PORT"

PORT="$PORT" \
STATE_FILE="$STATE_FILE" \
LIVE_WEATHER=0 \
ENNOIA_NATURAL_EDIT_ENDPOINT= \
ENNOIA_API_KEY= \
KTO_SERVICE_KEY= \
KAKAO_REST_API_KEY= \
"$NODE_BIN" server/index.js >/tmp/travel-ops-verify.log 2>&1 &
PID=$!

cleanup() {
  kill "$PID" >/dev/null 2>&1 || true
  wait "$PID" 2>/dev/null || true
  rm -f "$STATE_FILE"
}
trap cleanup EXIT

sleep 0.6

"$NODE_BIN" - "$BASE_URL" <<'NODE'
const baseUrl = process.argv[2];

async function api(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method || "GET",
    headers: options.body ? { "content-type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  if (!response.ok) {
    throw new Error(`${path} failed with ${response.status}`);
  }
  return response.json();
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const state = await api("/api/state");
assert(state.plan.items.length >= 3, "expected at least 3 seeded plan items");
assert(state.plan.checkpoints.length >= 9, "expected checkpoint schedule");

const generated = await api("/api/trips/generate", {
  method: "POST",
  body: {
    region: "수원시",
    startDate: "2026-06-27",
    endDate: "2026-06-29",
    travelers: "4인 가족",
    transportMode: "car",
    pace: "보통",
    interests: "역사 관광지, 가족 맛집"
  }
});
assert(generated.state.plan.startDate === "2026-06-27", "expected generated plan start date");
assert(generated.state.plan.endDate === "2026-06-29", "expected generated plan end date");
assert(generated.state.plan.items.length >= 12, "expected generated multi-day itinerary items");
assert(generated.state.plan.generation.source === "fallback", "expected deterministic fallback generation in verify mode");
assert(generated.state.plan.items.some((item) => item.placeName === "화성행궁"), "expected Suwon tourist item");

const forestItem = generated.state.plan.items.find((item) => item.placeName === "광교호수공원");
assert(forestItem, "expected outdoor generated item");
const forest = await api(`/api/items/${forestItem.id}/inspect`, { method: "POST", body: {} });
assert(forest.decision.status === "reroute", "expected outdoor rainy plan to reroute");
assert(forest.notification?.severity === "reroute", "expected reroute notification");

const applied = await api(`/api/notifications/${forest.notification.id}/apply`, { method: "POST", body: {} });
assert(applied.item.id === forestItem.id, "expected reroute patch to affect only inspected item");
assert(applied.item.placeName === "성수 아트센터", "expected indoor alternative to apply");

const palaceItem = generated.state.plan.items.find((item) => item.placeName === "화성행궁");
assert(palaceItem, "expected palace item");
const edited = await api(`/api/items/${palaceItem.id}`, {
  method: "PATCH",
  body: {
    title: "화성행궁 야간 방문",
    placeName: "화성행궁",
    address: "경기 수원시 팔달구 정조로 825",
    lat: "37.2819",
    lng: "127.0142",
    startsAt: "2026-05-30T21:00:00+09:00",
    endsAt: "2026-05-30T22:00:00+09:00",
    transportMode: "car",
    travelMinutesBefore: "20",
    category: "outdoor",
    memo: "운영시간 외 테스트"
  }
});
assert(edited.item.title === "화성행궁 야간 방문", "expected manual edit to save");

const ddp = await api(`/api/items/${palaceItem.id}/inspect`, { method: "POST", body: {} });
assert(ddp.decision.status === "reroute", "expected operation-hours reroute");
assert(ddp.decision.reason.includes("운영시간"), "expected operation-hours evidence");

const draft = await api("/api/natural-edits", {
  method: "POST",
  body: { text: "아 지금 삼겹살이 더 먹고싶으니까 이따 저녁일정 바꾸고 플래너에 적용해줘" }
});
assert(draft.draft.targetItemId, "expected natural language edit to target dinner");
assert(draft.draft.patch.title === "삼겹살 저녁", "expected natural language edit patch");

const natural = await api("/api/natural-edits/apply", { method: "POST", body: draft.draft });
assert(natural.item.title === "삼겹살 저녁", "expected natural language edit to apply");
assert(natural.rechecked.length >= 1, "expected changed item to be rechecked");

const due = await api("/api/inspect/due?now=2026-06-28T09:21:00%2B09:00", { method: "POST", body: {} });
assert(due.dueCheckpoints.length === 1, "expected due checkpoint filtering");
assert(due.dueCheckpoints[0].itemId, "expected due item id");

const push = await api("/api/push-subscriptions", {
  method: "POST",
  body: { endpoint: "verify-endpoint", userVisibleOnly: true }
});
assert(push.subscription.id, "expected push subscription record");

const manifestResponse = await fetch(`${baseUrl}/manifest.webmanifest`);
const manifest = await manifestResponse.json();
assert(manifest.display === "standalone", "expected PWA standalone display");
assert(manifest.icons.length >= 2, "expected PWA icons");

const finalState = await api("/api/state");
const finalText = JSON.stringify(finalState);
assert(!finalText.includes("rawApiJson"), "state must not expose raw API payloads");
assert(!finalText.includes("KakaoAK"), "state must not expose API authorization");
assert(!finalText.includes("SERVICE_KEY"), "state must not expose service key names");

console.log("MVP verification passed");
NODE
