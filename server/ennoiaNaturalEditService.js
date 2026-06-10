import { parseFirstBalancedJsonObject } from "./ennoiaJson.js";
import { answerNaturalEditQuestion } from "./naturalEditQuestionService.js";
import { draftScheduleEditWithAgent, sanitizeNaturalEditPatch } from "./scheduleEditAgent.js";

export async function draftNaturalLanguageEditWithEnnoia(text, items, options = {}) {
  const endpoint = process.env.ENNOIA_NATURAL_EDIT_ENDPOINT;
  const apiKey = process.env.ENNOIA_API_KEY;
  const fallbackText = fallbackTextForConversation(text, options);

  if (!endpoint || !apiKey) {
    const answer = fallbackAnswerTurn(text, items, "Ennoia 자연어 수정 엔드포인트 미설정", options);
    if (answer) return answer;
    return fallbackDraft(fallbackText, items, "Ennoia 자연어 수정 엔드포인트 미설정", options);
  }

  const endpointConfig = getEndpointConfig(endpoint);
  if (endpointConfig.type === "preset" && !endpointConfig.hash) {
    const answer = fallbackAnswerTurn(text, items, "Ennoia 자연어 수정 에이전트 hash 미설정", options);
    if (answer) return answer;
    return fallbackDraft(fallbackText, items, "Ennoia 자연어 수정 에이전트 hash 미설정", options);
  }

  const chatWaitMs = naturalEditChatWaitMs();
  const controller = new AbortController();
  const localStatus = `Ennoia 응답 대기(${chatWaitMs}ms) 초과 · 빠른 로컬 초안`;
  const localDraftPromise = Promise.resolve(fallbackAnswerTurn(text, items, localStatus, options) || fallbackDraft(fallbackText, items, localStatus, options)).catch((error) =>
    localDraftFailure(error)
  );
  const ennoiaDraftPromise = draftWithEnnoia(text, items, options, {
    endpoint,
    endpointConfig,
    apiKey,
    controller
  }).then(
    (draft) => ({ type: "ennoia", draft }),
    (error) => ({
      type: "fallback",
      status: error.fallbackStatus || `Ennoia 호출 오류: ${error.message}`
    })
  );

  const first = await Promise.race([
    ennoiaDraftPromise,
    delay(chatWaitMs).then(() => ({ type: "chat-timeout" }))
  ]);

  if (first.type === "ennoia") return unwrapDraftResult(first.draft);

  controller.abort();
  if (first.type === "fallback") {
    const answer = fallbackAnswerTurn(text, items, first.status, options);
    if (answer) return answer;
    return fallbackDraft(fallbackText, items, first.status, options);
  }
  return localDraftPromise;
}

async function draftWithEnnoia(text, items, options, { endpoint, endpointConfig, apiKey, controller }) {
  const timeoutMs = naturalEditTimeoutMs();
  let timeout;

  try {
    timeout = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(endpoint, {
      method: "POST",
      headers: ennoiaNaturalEditHeaders(apiKey),
      signal: controller.signal,
      body: JSON.stringify(buildEnnoiaRequest(text, items, options, endpointConfig))
    });

    if (!response.ok) {
      throw new EnnoiaFallbackError(await ennoiaFailureStatus(response));
    }

    const assistantText = await extractAssistantText(response, timeoutMs);
    const parsed = parseFirstBalancedJsonObject(assistantText);
    const turnResult = normalizeTurnResult(parsed, items, assistantText);
    if (turnResult.turnType === "answer") return turnResult;

    const safeDraft = turnResult.draft;

    if (safeDraft.needsClarification) {
      if (isStructuredClarification(safeDraft)) {
        return safeDraft;
      }
      return rescueClearEdit(text, items, options, safeDraft);
    }

    const placeRescue = await rescueDistantPlaceDraft(text, items, options, safeDraft);
    if (placeRescue) return placeRescue;

    return safeDraft;
  } catch (error) {
    if (error.name === "EnnoiaFallbackError") {
      throw error;
    }
    if (error.name === "AbortError") {
      throw new EnnoiaFallbackError(`Ennoia 호출 시간 초과(${timeoutMs}ms)`);
    }
    if (error.name === "EnnoiaStreamTimeoutError") {
      throw new EnnoiaFallbackError(`Ennoia 호출 시간 초과(${timeoutMs}ms)`);
    }
    throw new EnnoiaFallbackError(`Ennoia 호출 오류: ${error.message}`);
  } finally {
    clearTimeout(timeout);
  }
}

function naturalEditTimeoutMs() {
  const value = Number(process.env.ENNOIA_NATURAL_EDIT_TIMEOUT_MS);
  if (Number.isFinite(value) && value > 0) return value;
  return 60000;
}

function naturalEditChatWaitMs() {
  const value = Number(process.env.ENNOIA_NATURAL_EDIT_CHAT_WAIT_MS);
  if (Number.isFinite(value) && value > 0) return value;
  return 60000;
}

function naturalEditLocalSearchBudgetMs() {
  const value = Number(process.env.ENNOIA_NATURAL_EDIT_LOCAL_SEARCH_BUDGET_MS);
  if (Number.isFinite(value) && value > 0) return value;
  return 1000;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class EnnoiaFallbackError extends Error {
  constructor(fallbackStatus) {
    super(fallbackStatus);
    this.name = "EnnoiaFallbackError";
    this.fallbackStatus = fallbackStatus;
  }
}

class EnnoiaStreamTimeoutError extends Error {
  constructor(content = "") {
    super("Ennoia stream did not finish before timeout");
    this.name = "EnnoiaStreamTimeoutError";
    this.content = content;
  }
}

function localDraftFailure(error) {
  return {
    source: "fallback",
    operation: "update",
    stage: "clarify",
    domain: "other",
    filledSlots: {},
    missingSlots: [],
    choices: [],
    patch: {},
    needsConfirmation: false,
    needsClarification: true,
    question: "수정 초안을 빠르게 만들지 못했어요. 바꿀 일정과 원하는 장소나 음식을 조금 더 구체적으로 알려주세요.",
    modelStatus: `빠른 로컬 초안 오류: ${error.message}`
  };
}

function ennoiaNaturalEditHeaders(apiKey) {
  const headers = {
    "Content-Type": "application/json",
    project: process.env.ENNOIA_PROJECT_ID || "KNTO-PROMPTON-2026-544",
    apiKey
  };

  const userId = clean(process.env.ENNOIA_NATURAL_EDIT_USER_ID || process.env.ENNOIA_USER_ID);
  if (userId) headers["X-ENNOIA-USER-ID"] = userId;

  const explicitMcpHeaderName = clean(process.env.ENNOIA_NATURAL_EDIT_MCP_AUTHORIZATION_HEADER || process.env.ENNOIA_MCP_AUTHORIZATION_HEADER);
  const explicitMcpAuthorization = clean(process.env.ENNOIA_NATURAL_EDIT_MCP_AUTHORIZATION || process.env.ENNOIA_MCP_AUTHORIZATION);
  if (explicitMcpHeaderName && explicitMcpAuthorization) {
    headers[explicitMcpHeaderName] = explicitMcpAuthorization;
  }

  for (const [key, value] of Object.entries(process.env)) {
    const match = key.match(/^ENNOIA_MCP_(.+)_AUTHORIZATION$/);
    if (!match || !clean(value)) continue;
    const serverToken = mcpServerHeaderToken(match[1]);
    if (serverToken) headers[`x-mcp-${serverToken}-authorization`] = value;
  }

  return headers;
}

function mcpServerHeaderToken(value) {
  return clean(value)
    .toLowerCase()
    .replace(/_/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

async function ennoiaFailureStatus(response) {
  const status = response.status || "unknown";
  let bodyText = "";
  try {
    bodyText = await response.text();
  } catch {
    return `Ennoia 호출 실패(${status})`;
  }

  const parsed = parseJsonSafely(bodyText);
  const errorType = clean(parsed?.error_type || parsed?.errorType);
  const message = clean(parsed?.message);
  if (errorType === "MCP_CONNECTION_REQUIRED") {
    return `Ennoia MCP 연결 필요(${status}${mcpFailureDetail(message)})`;
  }
  if (errorType) return `Ennoia 호출 실패(${status}: ${errorType})`;
  if (/MCP connection|x-mcp-|X-ENNOIA-USER-ID/i.test(message || bodyText)) {
    return `Ennoia MCP 연결 필요(${status}${mcpFailureDetail(message || bodyText)})`;
  }
  return `Ennoia 호출 실패(${status})`;
}

function parseJsonSafely(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function mcpFailureDetail(message = "") {
  const text = clean(message);
  if (!text) return "";
  if (/X-ENNOIA-USER-ID|x-mcp-\{?(serverName|serverAlias)\}?-authorization/i.test(text)) {
    return ": X-ENNOIA-USER-ID 또는 x-mcp-{serverAlias}-authorization 헤더 필요";
  }
  const missingConnection = text.match(/missing or expired for:\s*([^.;]+)/i);
  if (missingConnection?.[1]) {
    return `: ${missingConnection[1].trim()} 연결 누락/만료`;
  }
  const missingAlias = text.match(/header for:\s*([^.;]+)/i);
  if (missingAlias?.[1]) {
    return `: ${missingAlias[1].trim()} MCP 인증 헤더 필요`;
  }
  return "";
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
    "사용자 요청과 현재 플래너 JSON을 보고 이번 턴이 answer, edit_draft, clarify 중 무엇인지 먼저 판단한다.",
    "질문이면 플래너 JSON과 대화 맥락에서 바로 답하고 turnType=answer, reply.text를 반환한다.",
    "수정이면 turnType=edit_draft와 draft 객체를 반환한다.",
    "추가 정보가 필요하면 turnType=clarify와 draft.needsClarification=true를 반환한다.",
    "음식, 관광지, 카페, 실내/야외 대안, 시간 변경, 이동수단 변경 요청을 해석한다.",
    "시간 변경 요청(예: '20시 40분으로 바꿔줘', '오후 8:30으로 미뤄줘')은 추가 질문하지 말고 turnType=edit_draft, domain=time, intent=change_time으로 반환한다.",
    "시간 변경 patch는 대상 일정의 날짜와 기존 소요시간을 유지해 startsAt/endsAt을 모두 채운다.",
    "대화가 여러 턴이면 이전 user/assistant 메시지에서 이미 채운 조건을 기억하고 다음 질문 또는 추천에 반영한다.",
    "사용자가 '아니', '말고', '그거 말고'로 정정하면 직전 assistant 질문과 직전 draft를 기준으로 제외 조건을 반영한다.",
    "도메인-슬롯 방식으로 meal, attraction, cafe, transport, time 중 하나를 고르고 filledSlots와 missingSlots를 갱신한다.",
    "식사 도메인은 cuisine, headcount, budget, mood, timeSlot을 우선 확인한다.",
    "관광지 도메인은 indoorOutdoor, theme, duration, companion을 우선 확인한다.",
    "카페 도메인은 dessertOrBrunch, mood, openingHours를 우선 확인한다.",
    "이동/시간 도메인은 transportMode, startTime, endTime을 우선 확인한다.",
    "장소, 관광지, 맛집, 카페 정보는 Ennoia Studio에 연결된 한국관광공사 MCP 툴로 조회한 뒤 좌표, 주소, 상세 메모를 patch에 채운다.",
    "플래너 전체를 다시 짜지 말고 targetItemId 하나와 patch만 반환한다.",
    "targetItemId는 반드시 현재 플래너에 존재하는 id여야 한다.",
    "day2, d2, 둘째날은 현재 플래너 날짜 중 두 번째 날짜를 뜻한다. activeDate가 있으면 해당 날짜를 우선한다.",
    "사용자가 연속 관람을 원하지 않거나 드론쇼/불꽃쇼/축제/공연을 빼달라고 하면, 해당 날짜의 드론/불꽃/축제/공연 일정 하나를 targetItemId로 고르고 같은 시간대의 여유 휴식 patch를 만든다.",
    "mode가 add_or_update이고 현재 일정에서 수정 대상을 찾을 수 없을 때만 operation=add로 새 일정 초안을 반환한다.",
    "애매하면 needsClarification=true, stage=clarify, question, choices, filledSlots, missingSlots를 반환한다.",
    "반드시 JSON 객체만 반환한다. 마크다운, 설명, 코드블록은 금지한다.",
    "허용 patch 필드: title, placeName, address, lat, lng, startsAt, endsAt, transportMode, travelMinutesBefore, category, memo.",
    "식당의 현재 영업 중 여부는 확정하지 않는다."
  ].join("\n");

  const userPrompt = [
    `사용자 요청: ${text}`,
    `mode: ${options.mode || "update"}`,
    `activeDate: ${options.activeDate || ""}`,
    "현재 플래너 JSON:",
    JSON.stringify(planner),
    "반환 스키마:",
    JSON.stringify(
      {
        turnType: "answer | edit_draft | clarify",
        reply: {
          text: "질문에 대한 자연어 답변. turnType=answer일 때 필수"
        },
        draft: {
          operation: "update | add",
          stage: "clarify | propose | confirm",
          domain: "meal | attraction | cafe | transport | time | other",
          filledSlots: {},
          missingSlots: ["budget"],
          choices: [{ id: "string", label: "string", value: "string" }],
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
        }
      },
    )
  ].join("\n\n");

  const history = Array.isArray(options.history) && options.history.length > 0 ? normalizeMessageHistory(options.history, text) : [];
  const messages = [
    ennoiaMessage("user", systemPrompt),
    ...history.map((message) => ennoiaMessage(message.role, message.text)),
    ennoiaMessage("user", userPrompt)
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

function ennoiaMessage(role, text) {
  return {
    role: role === "assistant" ? "assistant" : "user",
    content: [
      {
        type: "text",
        text
      }
    ]
  };
}

function normalizeMessageHistory(history = [], currentText = "") {
  const current = clean(currentText);
  const messages = Array.isArray(history)
    ? history
        .map((message) => ({
          role: message.role === "assistant" ? "assistant" : "user",
          text: clean(message.text || message.content)
        }))
        .filter((message) => message.text)
    : [];
  while (current && messages.at(-1)?.role === "user" && messages.at(-1)?.text === current) {
    messages.pop();
  }
  return messages.slice(-4);
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

async function extractAssistantText(response, timeoutMs = naturalEditTimeoutMs()) {
  const contentType = response.headers?.get?.("content-type") || "";
  if (contentType.includes("text/event-stream")) {
    return readSseAssistantText(response, timeoutMs);
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

async function readSseAssistantText(response, timeoutMs) {
  if (!response.body?.getReader) return parseSseText(await response.text());

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const deadline = Date.now() + timeoutMs;
  let buffer = "";
  let content = "";

  while (true) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      await reader.cancel().catch(() => {});
      throw new EnnoiaStreamTimeoutError(content);
    }

    let readResult;
    try {
      readResult = await readStreamChunk(reader, remainingMs, content);
    } catch (error) {
      await reader.cancel().catch(() => {});
      throw error;
    }

    const { value, done } = readResult;
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    content += consumeSseLines(lines);

    if (hasBalancedJsonObject(content)) {
      await reader.cancel().catch(() => {});
      return content;
    }
  }

  buffer += decoder.decode();
  content += consumeSseLines(buffer.split(/\r?\n/));
  return content;
}

function readStreamChunk(reader, timeoutMs, content) {
  let timeout;
  const timeoutPromise = new Promise((_, reject) => {
    timeout = setTimeout(() => reject(new EnnoiaStreamTimeoutError(content)), timeoutMs);
  });
  return Promise.race([reader.read(), timeoutPromise]).finally(() => clearTimeout(timeout));
}

function parseSseText(text) {
  return consumeSseLines(String(text || "").split(/\r?\n/));
}

function consumeSseLines(lines) {
  let content = "";
  for (const line of lines) {
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

function hasBalancedJsonObject(text) {
  try {
    parseFirstBalancedJsonObject(text);
    return true;
  } catch {
    return false;
  }
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
      return withConversationFields(
        {
          source: "ennoia",
          modelStatus: "Ennoia LLM 추가 초안이 비어 있음",
          operation: "add",
          needsConfirmation: false,
          needsClarification: true,
          question: draft.question || "어떤 일정을 추가할까요? 날짜, 시간대, 장소나 음식을 더 알려주세요.",
          patch: {}
        },
        draft
      );
    }

    return withConversationFields(
      {
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
      },
      draft
    );
  }

  const targetItem = items.find((item) => item.id === draft.targetItemId);
  if (!targetItem) {
    return withConversationFields(
      {
        source: "ennoia",
        modelStatus: "Ennoia LLM이 수정 대상을 특정하지 못함",
        needsConfirmation: false,
        needsClarification: true,
        question: draft.question || "어떤 일정을 바꿀까요? 예: 저녁 일정, 오후 관광 일정처럼 알려주세요.",
        patch: {}
      },
      draft
    );
  }

  const patch = sanitizeNaturalEditPatch(draft.patch || {}, targetItem);
  const recommendations = normalizeRecommendations(draft, targetItem, "update", patch);
  const finalPatch = recommendations[0]?.patch || patch;
  if (Object.keys(finalPatch).length === 0) {
    return withConversationFields(
      {
        source: "ennoia",
        modelStatus: "Ennoia LLM 수정 초안이 비어 있음",
        targetItemId: targetItem.id,
        needsConfirmation: false,
        needsClarification: true,
        question: draft.question || `${targetItem.title}을 어떻게 바꿀까요? 원하는 장소, 음식, 시간 중 하나를 더 알려주세요.`,
        patch: {}
      },
      draft
    );
  }

  return withConversationFields(
    {
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
    },
    draft
  );
}

function normalizeTurnResult(parsed, items, originalText = "") {
  const turnType = clean(parsed?.turnType || parsed?.type);
  const hasDraftPayload = parsed?.draft && typeof parsed.draft === "object" && !Array.isArray(parsed.draft);
  if (turnType === "answer" || (parsed?.reply && !hasDraftPayload && turnType !== "edit_draft" && turnType !== "clarify")) {
    const replyText = clean(parsed?.reply?.text || parsed?.text || originalText);
    return {
      turnType: "answer",
      reply: {
        type: "answer",
        text: replyText || "현재 플래너 기준으로 답변할 수 있는 정보가 없어요.",
        source: "ennoia",
        modelStatus: "Ennoia LLM 답변"
      },
      draft: null
    };
  }

  const draftPayload = hasDraftPayload ? parsed.draft : parsed;
  const safeDraft = sanitizeDraft(draftPayload, items);
  return {
    turnType: safeDraft.needsClarification ? "clarify" : "draft",
    reply: null,
    draft: {
      ...safeDraft,
      source: "ennoia",
      modelStatus: safeDraft.modelStatus || (safeDraft.needsClarification ? "Ennoia LLM 도메인 슬롯 확인" : "Ennoia LLM 자연어 수정 초안")
    }
  };
}

function unwrapDraftResult(result) {
  if (result?.turnType === "answer") return result;
  if (result?.draft) return result.draft;
  return result;
}

function withConversationFields(result = {}, draft = {}) {
  return {
    ...result,
    stage: normalizeStage(draft.stage, result),
    domain: normalizeDomain(draft.domain || result.intent || result.patch?.category),
    filledSlots: normalizeSlots(draft.filledSlots),
    missingSlots: normalizeStringList(draft.missingSlots).slice(0, 8),
    choices: normalizeChoices(draft.choices).slice(0, 8)
  };
}

function normalizeStage(stage, draft = {}) {
  const value = clean(stage);
  if (["clarify", "propose", "confirm"].includes(value)) return value;
  if (draft.needsClarification) return "clarify";
  if (draft.needsConfirmation === false) return "confirm";
  return "propose";
}

function normalizeDomain(domain) {
  const value = clean(domain);
  if (["meal", "attraction", "cafe", "transport", "time", "other"].includes(value)) return value;
  if (/meal|식사|lunch|dinner|breakfast/.test(value)) return "meal";
  if (/place|tour|관광|indoor|outdoor/.test(value)) return "attraction";
  if (/cafe|카페/.test(value)) return "cafe";
  if (/transport|bus|taxi|subway|walk|car/.test(value)) return "transport";
  if (/time|시각|시간/.test(value)) return "time";
  return "other";
}

function normalizeSlots(slots = {}) {
  if (!slots || typeof slots !== "object" || Array.isArray(slots)) return {};
  return Object.fromEntries(
    Object.entries(slots)
      .map(([key, value]) => [clean(key), normalizeSlotValue(value)])
      .filter(([key, value]) => key && value !== undefined && value !== null && value !== "")
  );
}

function normalizeSlotValue(value) {
  if (Array.isArray(value)) return value.map((entry) => clean(entry)).filter(Boolean);
  if (typeof value === "number" || typeof value === "boolean") return value;
  return clean(value);
}

function normalizeStringList(value) {
  if (!Array.isArray(value)) return [];
  return value.map(clean).filter(Boolean);
}

function normalizeChoices(choices = []) {
  if (!Array.isArray(choices)) return [];
  return choices
    .map((choice, index) => {
      if (typeof choice === "string") {
        const label = clean(choice);
        return label ? { id: `choice-${index + 1}`, label, value: label } : null;
      }
      const label = clean(choice?.label || choice?.name || choice?.value);
      if (!label) return null;
      return {
        id: clean(choice.id) || `choice-${index + 1}`,
        label,
        value: clean(choice.value || label)
      };
    })
    .filter(Boolean);
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

function fallbackAnswerTurn(text, items, modelStatus, options = {}) {
  const reply = answerNaturalEditQuestion(text, items, options);
  if (!reply) return null;
  return {
    turnType: "answer",
    reply: {
      ...reply,
      source: "fallback",
      modelStatus
    },
    draft: null
  };
}

function fallbackDraft(text, items, modelStatus, options = {}) {
  return draftScheduleEditWithAgent({
    text,
    items,
    ...options,
    searchBudgetMs: options.searchBudgetMs ?? naturalEditLocalSearchBudgetMs()
  }).then((draft) => ({
    ...draft,
    source: draft.source === "agent" ? "agent" : "fallback",
    modelStatus: draft.modelStatus ? `${modelStatus} · ${draft.modelStatus}` : modelStatus
  }));
}

async function rescueClearEdit(text, items, options, ennoiaDraft) {
  const draft = await fallbackDraft(text, items, ennoiaDraft.modelStatus || "Ennoia LLM 확인 필요", options);
  if (shouldPreferLocalClarification(draft, ennoiaDraft)) {
    return {
      ...draft,
      source: "agent",
      modelStatus: "일정수정 에이전트 대상 보정"
    };
  }
  if (draft.needsClarification || Object.keys(draft.patch || {}).length === 0) return ennoiaDraft;

  return {
    ...draft,
    modelStatus: `${ennoiaDraft.modelStatus || "Ennoia LLM 확인 필요"} · ${draft.modelStatus || "일정수정 에이전트 보정"}`
  };
}

function shouldPreferLocalClarification(localDraft = {}, ennoiaDraft = {}) {
  if (!localDraft.needsClarification) return false;
  if (ennoiaDraft.targetItemId && !localDraft.targetItemId) return false;

  const localChoices = Array.isArray(localDraft.choices) ? localDraft.choices.length : 0;
  const ennoiaChoices = Array.isArray(ennoiaDraft.choices) ? ennoiaDraft.choices.length : 0;
  const localHasTarget = Boolean(localDraft.targetItemId);
  const localHasDomain = localDraft.domain && localDraft.domain !== "other";

  if (localHasTarget && !ennoiaDraft.targetItemId) return true;
  if (localHasDomain && localChoices > ennoiaChoices && isGenericClarificationQuestion(ennoiaDraft.question)) return true;
  if (localHasTarget && isGenericClarificationQuestion(ennoiaDraft.question)) return true;

  return false;
}

function isGenericClarificationQuestion(question) {
  const value = clean(question);
  if (!value) return true;
  return /어떤\s*일정|어느\s*일정|수정\s*대상|무엇을\s*바꿀|어떤\s*내용/.test(value);
}

async function rescueDistantPlaceDraft(text, items, options, ennoiaDraft) {
  if (!shouldRescueDistantPlaceDraft(ennoiaDraft, items, options)) return null;

  const draft = await draftScheduleEditWithAgent({
    text: fallbackTextForConversation(text, options),
    items,
    ...options,
    searchBudgetMs: options.searchBudgetMs ?? naturalEditLocalSearchBudgetMs()
  });
  if (draft.needsClarification || Object.keys(draft.patch || {}).length === 0) return null;

  return {
    ...draft,
    modelStatus: `Ennoia LLM 후보 위치 보정 · ${draft.modelStatus || "일정수정 에이전트 초안"}`
  };
}

function isStructuredClarification(draft = {}) {
  return (
    (Array.isArray(draft.choices) && draft.choices.length > 0) ||
    (Array.isArray(draft.missingSlots) && draft.missingSlots.length > 0) ||
    (draft.filledSlots && Object.keys(draft.filledSlots).length > 0)
  );
}

function fallbackTextForConversation(text, options = {}) {
  const current = clean(text);
  if (!shouldUseFallbackConversationHistory(current)) return current;

  const historyText = Array.isArray(options.history)
    ? options.history
        .filter((message) => message.role !== "assistant")
        .map((message) => clean(message.text || message.content))
        .filter(Boolean)
    : [];
  if (historyText.length === 0) return current;
  if (current && historyText.at(-1) !== current) historyText.push(current);
  return historyText.slice(-4).join("\n");
}

function shouldUseFallbackConversationHistory(text) {
  const value = clean(text);
  if (!value) return false;
  return /^(아니|아냐|아니야|그거|이거|대신|그럼|응|좋아|싫어)\b/.test(value) || value.length <= 8;
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
