import { parseFirstBalancedJsonObject } from "./ennoiaJson.js";
import { draftScheduleEditWithAgent, sanitizeNaturalEditPatch } from "./scheduleEditAgent.js";

export async function draftNaturalLanguageEditWithEnnoia(text, items, options = {}) {
  const endpoint = process.env.ENNOIA_NATURAL_EDIT_ENDPOINT;
  const apiKey = process.env.ENNOIA_API_KEY;

  if (!endpoint || !apiKey) {
    return fallbackDraft(text, items, "Ennoia 자연어 수정 엔드포인트 미설정", options);
  }

  const endpointConfig = getEndpointConfig(endpoint);
  if (endpointConfig.type === "preset" && !endpointConfig.hash) {
    return fallbackDraft(text, items, "Ennoia 자연어 수정 에이전트 hash 미설정", options);
  }

  const timeoutMs = naturalEditTimeoutMs();
  const controller = new AbortController();
  let timeout;

  try {
    timeout = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        project: process.env.ENNOIA_PROJECT_ID || "KNTO-PROMPTON-2026-544",
        apiKey
      },
      signal: controller.signal,
      body: JSON.stringify(buildEnnoiaRequest(text, items, options, endpointConfig))
    });

    if (!response.ok) {
      return fallbackDraft(text, items, `Ennoia 호출 실패(${response.status})`, options);
    }

    const assistantText = await extractAssistantText(response);
    const parsed = parseFirstBalancedJsonObject(assistantText);
    const safeDraft = sanitizeDraft(parsed, items);

    if (safeDraft.needsClarification) {
      return rescueClearEdit(text, items, options, safeDraft);
    }

    const placeRescue = await rescueDistantPlaceDraft(text, items, options, safeDraft);
    if (placeRescue) return placeRescue;

    return {
      ...safeDraft,
      source: "ennoia",
      modelStatus: "Ennoia LLM 자연어 수정 초안"
    };
  } catch (error) {
    if (error.name === "AbortError") {
      return fallbackDraft(text, items, `Ennoia 호출 시간 초과(${timeoutMs}ms)`, options);
    }
    return fallbackDraft(text, items, `Ennoia 호출 오류: ${error.message}`, options);
  } finally {
    clearTimeout(timeout);
  }
}

function naturalEditTimeoutMs() {
  const value = Number(process.env.ENNOIA_NATURAL_EDIT_TIMEOUT_MS);
  if (Number.isFinite(value) && value > 0) return value;
  return 20000;
}

function buildEnnoiaRequest(text, items, options = {}, endpointConfig = getEndpointConfig()) {
  const planner = items.map((item) => ({
    id: item.id,
    title: item.title,
    placeName: item.placeName,
    address: item.address,
    lat: item.lat,
    lng: item.lng,
    startsAt: item.startsAt,
    endsAt: item.endsAt,
    transportMode: item.transportMode,
    travelMinutesBefore: item.travelMinutesBefore,
    category: item.category,
    memo: item.memo,
    status: item.status
  }));

  const systemPrompt = [
    "너는 여행 플래너 자연어 수정 에이전트다.",
    "사용자 요청과 현재 플래너 JSON을 보고 하나의 일정 수정 초안을 만든다.",
    "음식, 관광지, 카페, 실내/야외 대안, 시간 변경, 이동수단 변경 요청을 해석한다.",
    "플래너 전체를 다시 짜지 말고 targetItemId 하나와 patch만 반환한다.",
    "targetItemId는 반드시 현재 플래너에 존재하는 id여야 한다.",
    "mode가 add_or_update이고 현재 일정에서 수정 대상을 찾을 수 없을 때만 operation=add로 새 일정 초안을 반환한다.",
    "애매하면 needsClarification=true와 question만 반환한다.",
    "반드시 JSON 객체만 반환한다. 마크다운, 설명, 코드블록은 금지한다.",
    "허용 patch 필드: title, placeName, address, lat, lng, startsAt, endsAt, transportMode, travelMinutesBefore, category, memo.",
    "식당의 현재 영업 중 여부는 확정하지 않는다."
  ].join("\n");

  const userPrompt = [
    `사용자 요청: ${text}`,
    `mode: ${options.mode || "update"}`,
    `activeDate: ${options.activeDate || ""}`,
    "현재 플래너 JSON:",
    JSON.stringify(planner, null, 2),
    "반환 스키마:",
    JSON.stringify(
      {
        operation: "update | add",
        targetItemId: "string | optional",
        intent: "replace_meal | replace_place | change_time | change_transport | other",
        confidence: 0.0,
        patch: {
          title: "string",
          placeName: "string",
          address: "string",
          lat: 0,
          lng: 0,
          startsAt: "YYYY-MM-DDTHH:mm:ss+09:00",
          endsAt: "YYYY-MM-DDTHH:mm:ss+09:00",
          transportMode: "walk | subway | bus | taxi",
          travelMinutesBefore: 20,
          category: "meal | indoor | outdoor",
          memo: "string"
        },
        needsConfirmation: true,
        needsClarification: false,
        question: "string | optional",
        resolutionMessage: "string | optional",
        recommendations: [
          {
            id: "string",
            name: "string",
            address: "string",
            distanceLabel: "string",
            source: "ennoia | kto | kakao",
            reason: "string",
            patch: {
              title: "string",
              placeName: "string",
              address: "string",
              lat: 0,
              lng: 0,
              startsAt: "YYYY-MM-DDTHH:mm:ss+09:00",
              endsAt: "YYYY-MM-DDTHH:mm:ss+09:00",
              transportMode: "walk | subway | bus | taxi",
              travelMinutesBefore: 20,
              category: "meal | indoor | outdoor",
              memo: "string"
            }
          }
        ],
        alternatives: [],
        confirmationMessage: "string"
      },
      null,
      2
    )
  ].join("\n\n");

  const messages = [
    {
      role: "user",
      content: [
        {
          type: "text",
          text: `${systemPrompt}\n\n${userPrompt}`
        }
      ]
    }
  ];

  if (endpointConfig.type === "preset") {
    return {
      hash: endpointConfig.hash,
      params: {},
      messages
    };
  }

  return {
    ...endpointConfig.ids,
    messages
  };
}

function getEndpointConfig(endpoint = process.env.ENNOIA_NATURAL_EDIT_ENDPOINT) {
  const endpointText = String(endpoint || "");
  const isPreset = endpointText.includes("/api/preset/");
  return {
    type: isPreset ? "preset" : "orchestrator",
    hash:
      process.env.ENNOIA_NATURAL_EDIT_HASH ||
      process.env.ENNOIA_AGENT_HASH ||
      extractHashFromEndpoint(endpointText),
    ids: extractEndpointIds(endpointText)
  };
}

function extractHashFromEndpoint(endpoint = "") {
  try {
    return new URL(endpoint).searchParams.get("hash") || "";
  } catch {
    return "";
  }
}

function extractEndpointIds(endpoint = "") {
  const match = String(endpoint).match(/\/stream\/([^/]+)\/([^/?]+)/);
  if (!match) return {};
  return {
    multiAgentId: match[1],
    multiAgentVersion: match[2]
  };
}

async function extractAssistantText(response) {
  const contentType = response.headers?.get?.("content-type") || "";
  if (contentType.includes("text/event-stream")) {
    return parseSseText(await response.text());
  }

  const payload = await response.json();
  return (
    extractTextContent(payload.output) ||
    extractTextContent(payload.text) ||
    extractTextContent(payload.content) ||
    extractTextContent(payload.message?.content) ||
    extractTextContent(payload.choices?.[0]?.message?.content) ||
    extractTextContent(payload.choices?.[0]?.delta?.content) ||
    JSON.stringify(payload)
  );
}

function parseSseText(text) {
  let content = "";
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const data = trimmed.slice(5).trim();
    if (!data || data === "[DONE]") continue;
    try {
      const payload = JSON.parse(data);
      content +=
        extractTextContent(payload.output) ||
        extractTextContent(payload.text) ||
        extractTextContent(payload.content) ||
        extractTextContent(payload.message?.content) ||
        extractTextContent(payload.choices?.[0]?.delta?.content) ||
        extractTextContent(payload.choices?.[0]?.message?.content) ||
        "";
    } catch {
      if (!["reserved", "start", "connected", "end"].includes(data)) content += data;
    }
  }
  return content;
}

function extractTextContent(content) {
  if (!content) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part?.type === "text" && typeof part.text === "string") return part.text;
        if (typeof part?.text === "string") return part.text;
        return "";
      })
      .join("");
  }
  if (typeof content.text === "string") return content.text;
  return "";
}

function sanitizeDraft(draft, items) {
  if (draft.operation === "add") {
    const patch = sanitizeNaturalEditPatch(draft.patch || {}, {});
    const recommendations = normalizeRecommendations(draft, {}, "add", patch);
    const finalPatch = recommendations[0]?.patch || patch;
    if (Object.keys(finalPatch).length === 0) {
      return {
        source: "ennoia",
        modelStatus: "Ennoia LLM 추가 초안이 비어 있음",
        operation: "add",
        needsConfirmation: false,
        needsClarification: true,
        question: "어떤 일정을 추가할까요? 날짜, 시간대, 장소나 음식을 더 알려주세요.",
        patch: {}
      };
    }

    return {
      operation: "add",
      intent: draft.intent || "add",
      confidence: Number.isFinite(Number(draft.confidence)) ? Number(draft.confidence) : 0.7,
      patch: finalPatch,
      recommendations,
      alternatives: Array.isArray(draft.alternatives) ? draft.alternatives.slice(0, 5) : [],
      resolutionMessage: draft.resolutionMessage || "",
      needsConfirmation: draft.needsConfirmation !== false,
      needsClarification: false,
      confirmationMessage: draft.confirmationMessage || `새 일정으로 ${finalPatch.title || finalPatch.placeName || "요청한 일정"}을 추가할게요.`
    };
  }

  const targetItem = items.find((item) => item.id === draft.targetItemId);
  if (!targetItem) {
    return {
      source: "ennoia",
      modelStatus: "Ennoia LLM이 수정 대상을 특정하지 못함",
      needsConfirmation: false,
      needsClarification: true,
      question: draft.question || "어떤 일정을 바꿀까요? 예: 저녁 일정, 오후 관광 일정처럼 알려주세요.",
      patch: {}
    };
  }

  const patch = sanitizeNaturalEditPatch(draft.patch || {}, targetItem);
  const recommendations = normalizeRecommendations(draft, targetItem, "update", patch);
  const finalPatch = recommendations[0]?.patch || patch;
  if (Object.keys(finalPatch).length === 0) {
    return {
      source: "ennoia",
      modelStatus: "Ennoia LLM 수정 초안이 비어 있음",
      targetItemId: targetItem.id,
      needsConfirmation: false,
      needsClarification: true,
      question: `${targetItem.title}을 어떻게 바꿀까요? 원하는 장소, 음식, 시간 중 하나를 더 알려주세요.`,
      patch: {}
    };
  }

  return {
    targetItemId: targetItem.id,
    operation: "update",
    intent: draft.intent || "other",
    confidence: Number.isFinite(Number(draft.confidence)) ? Number(draft.confidence) : 0.7,
    patch: finalPatch,
    recommendations,
    alternatives: Array.isArray(draft.alternatives) ? draft.alternatives.slice(0, 5) : [],
    resolutionMessage: draft.resolutionMessage || "",
    needsConfirmation: draft.needsConfirmation !== false,
    needsClarification: false,
    confirmationMessage:
      draft.confirmationMessage ||
      `${targetItem.title}을 ${finalPatch.title || finalPatch.placeName || "요청한 내용"}으로 바꾸고 영향받는 일정을 다시 점검할게요.`
  };
}

function normalizeRecommendations(draft = {}, targetItem = {}, operation = "update", basePatch = {}) {
  const candidates = recommendationCandidatesFromDraft(draft, basePatch);
  return candidates.slice(0, 5).map((candidate, index) => {
    const patch = recommendationPatch(candidate, targetItem, operation, basePatch);
    return {
      id: clean(candidate.id) || recommendationId(candidate, index),
      name: clean(candidate.name || candidate.placeName || patch.placeName) || "장소 후보",
      address: clean(candidate.address || patch.address),
      distanceLabel: clean(candidate.distanceLabel),
      source: clean(candidate.source) || "ennoia",
      reason: clean(candidate.reason) || "Ennoia LLM 추천 후보",
      patch
    };
  });
}

function recommendationCandidatesFromDraft(draft = {}, basePatch = {}) {
  if (Array.isArray(draft.recommendations) && draft.recommendations.length > 0) {
    return draft.recommendations;
  }
  if (Array.isArray(draft.alternatives) && draft.alternatives.length > 0) {
    return draft.alternatives;
  }
  if (Object.keys(basePatch || {}).length > 0) {
    return [
      {
        id: "primary",
        name: basePatch.placeName,
        address: basePatch.address,
        source: "ennoia",
        reason: "Ennoia LLM 기본 추천",
        patch: basePatch
      }
    ];
  }
  return [];
}

function recommendationPatch(candidate = {}, targetItem = {}, operation, basePatch = {}) {
  const candidatePatch = candidate.patch && typeof candidate.patch === "object" ? candidate.patch : {};
  const candidateName = clean(candidate.name || candidate.placeName || candidatePatch.placeName);
  const merged = {
    ...defaultPatchForOperation(targetItem, operation),
    ...basePatch,
    ...candidatePatch
  };

  if (candidateName) {
    merged.placeName = candidateName;
    if (!candidatePatch.title) {
      merged.title = titleFromPlaceName(candidateName, merged.category || targetItem.category);
    }
  }
  if (candidate.address) merged.address = candidate.address;
  if (candidate.lat !== undefined) merged.lat = candidate.lat;
  if (candidate.lng !== undefined) merged.lng = candidate.lng;

  return sanitizeNaturalEditPatch(merged, targetItem || {});
}

function defaultPatchForOperation(targetItem = {}, operation) {
  if (operation !== "update" || !targetItem?.id) return {};
  return {
    startsAt: targetItem.startsAt,
    endsAt: targetItem.endsAt,
    transportMode: targetItem.transportMode || "walk",
    travelMinutesBefore: targetItem.travelMinutesBefore ?? 15,
    category: targetItem.category || "meal"
  };
}

function titleFromPlaceName(placeName, category) {
  if (!placeName) return "";
  return category === "meal" ? `${placeName} 식사` : placeName;
}

function recommendationId(candidate = {}, index) {
  const raw = clean(candidate.name || candidate.placeName || candidate.patch?.placeName || String(index + 1));
  const slug = raw.replace(/\s+/g, "-").replace(/[^a-zA-Z0-9가-힣_.:-]/g, "");
  return `ennoia-${slug || index + 1}`;
}

function fallbackDraft(text, items, modelStatus, options = {}) {
  return draftScheduleEditWithAgent({ text, items, ...options }).then((draft) => ({
    ...draft,
    source: "fallback",
    modelStatus: draft.modelStatus ? `${modelStatus} · ${draft.modelStatus}` : modelStatus
  }));
}

async function rescueClearEdit(text, items, options, ennoiaDraft) {
  const draft = await fallbackDraft(text, items, ennoiaDraft.modelStatus || "Ennoia LLM 확인 필요", options);
  if (draft.needsClarification || Object.keys(draft.patch || {}).length === 0) return ennoiaDraft;

  return {
    ...draft,
    modelStatus: `${ennoiaDraft.modelStatus || "Ennoia LLM 확인 필요"} · ${draft.modelStatus || "일정수정 에이전트 보정"}`
  };
}

async function rescueDistantPlaceDraft(text, items, options, ennoiaDraft) {
  if (!shouldRescueDistantPlaceDraft(ennoiaDraft, items, options)) return null;

  const draft = await draftScheduleEditWithAgent({ text, items, ...options });
  if (draft.needsClarification || Object.keys(draft.patch || {}).length === 0) return null;

  return {
    ...draft,
    modelStatus: `Ennoia LLM 후보 위치 보정 · ${draft.modelStatus || "일정수정 에이전트 초안"}`
  };
}

function shouldRescueDistantPlaceDraft(draft, items, options = {}) {
  if (!draft || draft.needsClarification) return false;
  if (!["add", "update"].includes(draft.operation || "update")) return false;

  const patch = draft.patch || {};
  const anchor = anchorForDraft(draft, items, options);
  const distanceMeters = distanceBetweenMeters(anchor, patch);
  const message = `${draft.resolutionMessage || ""} ${patch.memo || ""}`;
  const admitsBadArea = /다른\s*지역|근처가\s*아닌|위치.*확인|동선.*확인/.test(message);

  return (Number.isFinite(distanceMeters) && distanceMeters > 3000) || admitsBadArea || isVaguePlaceDraft(draft);
}

function isVaguePlaceDraft(draft) {
  const patch = draft.patch || {};
  const intent = String(draft.intent || "");
  const placeText = `${patch.placeName || ""} ${patch.title || ""}`;
  const wantsConcretePlace =
    /place|meal/.test(intent) ||
    /카페|커피|맛집|식당|한식|중식|일식|양식|분식|만두|삼겹살|국밥|비빔밥/.test(placeText);
  if (!wantsConcretePlace) return false;

  const hasCoordinates = Number.isFinite(Number(patch.lat)) && Number.isFinite(Number(patch.lng));
  const genericPlaceName = /(현장\s*선택|근처|인근|후보|추천|카페\s*\(|카페\s*타임|식당\s*선택)/.test(placeText);
  const lacksCandidates = draft.operation === "add" && (!Array.isArray(draft.alternatives) || draft.alternatives.length === 0);

  if (draft.operation !== "add") return genericPlaceName && !hasCoordinates;
  return !hasCoordinates || genericPlaceName || lacksCandidates;
}

function anchorForDraft(draft, items = [], options = {}) {
  if (draft.operation !== "add") {
    return items.find((item) => item.id === draft.targetItemId);
  }

  const sortedItems = [...items].sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
  const patchDate = dateKey(draft.patch?.startsAt) || options.activeDate || dateKey(sortedItems[0]?.startsAt);
  const sameDayItems = sortedItems.filter((item) => dateKey(item.startsAt) === patchDate);
  if (sameDayItems.length === 0) return sortedItems.at(-1);

  const patchStart = new Date(draft.patch?.startsAt).getTime();
  if (Number.isFinite(patchStart)) {
    const previous = sameDayItems
      .filter((item) => new Date(item.endsAt || item.startsAt).getTime() <= patchStart)
      .at(-1);
    if (previous) return previous;
  }

  return sameDayItems.at(-1);
}

function distanceBetweenMeters(a = {}, b = {}) {
  const aLat = Number(a?.lat);
  const aLng = Number(a?.lng);
  const bLat = Number(b?.lat);
  const bLng = Number(b?.lng);
  if (![aLat, aLng, bLat, bLng].every(Number.isFinite)) return NaN;

  const earthRadiusMeters = 6371000;
  const latDelta = toRadians(bLat - aLat);
  const lngDelta = toRadians(bLng - aLng);
  const fromLat = toRadians(aLat);
  const toLat = toRadians(bLat);
  const haversine =
    Math.sin(latDelta / 2) ** 2 +
    Math.cos(fromLat) * Math.cos(toLat) * Math.sin(lngDelta / 2) ** 2;
  return 2 * earthRadiusMeters * Math.asin(Math.sqrt(haversine));
}

function toRadians(degrees) {
  return (degrees * Math.PI) / 180;
}

function dateKey(value) {
  return String(value || "").slice(0, 10);
}

function clean(value) {
  return String(value ?? "").trim();
}
