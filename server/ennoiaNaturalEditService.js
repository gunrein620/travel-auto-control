import { draftNaturalLanguageEdit } from "../src/domain/naturalLanguageEdit.js";

const SAFE_PATCH_KEYS = new Set([
  "title",
  "placeName",
  "address",
  "lat",
  "lng",
  "startsAt",
  "endsAt",
  "transportMode",
  "travelMinutesBefore",
  "category",
  "memo"
]);

export async function draftNaturalLanguageEditWithEnnoia(text, items) {
  const endpoint = process.env.ENNOIA_NATURAL_EDIT_ENDPOINT;
  const apiKey = process.env.ENNOIA_API_KEY;

  if (!endpoint || !apiKey) {
    return {
      ...draftNaturalLanguageEdit(text, items),
      source: "fallback",
      modelStatus: "Ennoia 자연어 수정 엔드포인트 미설정"
    };
  }

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        project: process.env.ENNOIA_PROJECT_ID || "KNTO-PROMPTON-2026-544",
        apiKey
      },
      body: JSON.stringify(buildEnnoiaRequest(text, items))
    });

    if (!response.ok) {
      return fallbackDraft(text, items, `Ennoia 호출 실패(${response.status})`);
    }

    const assistantText = await extractAssistantText(response);
    const parsed = parseJsonObject(assistantText);
    const safeDraft = sanitizeDraft(parsed, items);

    if (safeDraft.needsClarification) return safeDraft;

    return {
      ...safeDraft,
      source: "ennoia",
      modelStatus: "Ennoia LLM 자연어 수정 초안"
    };
  } catch (error) {
    return fallbackDraft(text, items, `Ennoia 호출 오류: ${error.message}`);
  }
}

function buildEnnoiaRequest(text, items) {
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
    "애매하면 needsClarification=true와 question만 반환한다.",
    "반드시 JSON 객체만 반환한다. 마크다운, 설명, 코드블록은 금지한다.",
    "허용 patch 필드: title, placeName, address, lat, lng, startsAt, endsAt, transportMode, travelMinutesBefore, category, memo.",
    "식당의 현재 영업 중 여부는 확정하지 않는다."
  ].join("\n");

  const userPrompt = [
    `사용자 요청: ${text}`,
    "현재 플래너 JSON:",
    JSON.stringify(planner, null, 2),
    "반환 스키마:",
    JSON.stringify(
      {
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
        confirmationMessage: "string"
      },
      null,
      2
    )
  ].join("\n\n");

  return {
    ...extractEndpointIds(process.env.ENNOIA_NATURAL_EDIT_ENDPOINT),
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `${systemPrompt}\n\n${userPrompt}`
          }
        ]
      }
    ]
  };
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
    payload.output ||
    payload.text ||
    payload.content ||
    payload.message?.content ||
    payload.choices?.[0]?.message?.content ||
    payload.choices?.[0]?.delta?.content ||
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
        payload.output ||
        payload.text ||
        payload.content ||
        payload.message?.content ||
        payload.choices?.[0]?.delta?.content ||
        payload.choices?.[0]?.message?.content ||
        "";
    } catch {
      if (!["reserved", "start", "connected"].includes(data)) content += data;
    }
  }
  return content;
}

function parseJsonObject(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) throw new Error("empty Ennoia response");
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Ennoia response did not include JSON");
    return JSON.parse(match[0]);
  }
}

function sanitizeDraft(draft, items) {
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

  const patch = sanitizePatch(draft.patch || {}, targetItem);
  if (Object.keys(patch).length === 0) {
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
    intent: draft.intent || "other",
    confidence: Number.isFinite(Number(draft.confidence)) ? Number(draft.confidence) : 0.7,
    patch,
    needsConfirmation: draft.needsConfirmation !== false,
    needsClarification: false,
    confirmationMessage:
      draft.confirmationMessage ||
      `${targetItem.title}을 ${patch.title || patch.placeName || "요청한 내용"}으로 바꾸고 영향받는 일정을 다시 점검할게요.`
  };
}

function sanitizePatch(patch, targetItem) {
  const safe = {};
  for (const [key, value] of Object.entries(patch)) {
    if (!SAFE_PATCH_KEYS.has(key)) continue;
    if (value === undefined || value === null || value === "") continue;
    safe[key] = value;
  }

  if (safe.lat !== undefined) safe.lat = Number(safe.lat);
  if (safe.lng !== undefined) safe.lng = Number(safe.lng);
  if (safe.travelMinutesBefore !== undefined) safe.travelMinutesBefore = Number(safe.travelMinutesBefore);
  if (safe.category && !["meal", "indoor", "outdoor"].includes(safe.category)) safe.category = targetItem.category;
  if (safe.transportMode && !["walk", "subway", "bus", "taxi"].includes(safe.transportMode)) {
    safe.transportMode = targetItem.transportMode;
  }

  if (safe.placeName && !safe.title) {
    safe.title = targetItem.category === "meal" ? `${safe.placeName} 식사` : safe.placeName;
  }

  return safe;
}

function fallbackDraft(text, items, modelStatus) {
  return {
    ...draftNaturalLanguageEdit(text, items),
    source: "fallback",
    modelStatus
  };
}
