# AI Schedule Edit LLM-First Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 자연어 일정수정 채팅이 규칙 기반 초안 반복이 아니라 LLM이 대화 맥락을 판단해 답변, 재질문, 수정 draft를 결정하도록 바꾼다.

**Architecture:** `/api/natural-edits`는 먼저 LLM turn planner를 호출하고, LLM 결과의 `turnType`에 따라 `reply` 또는 `draft`를 반환한다. 로컬 규칙 엔진은 Ennoia/MCP가 없거나 실패했을 때만 쓰되, 최근 draft/assistant 질문/부정 표현을 읽어 같은 clarification을 반복하지 않는 안전망으로 제한한다.

**Tech Stack:** Node.js ESM HTTP server, Ennoia preset/orchestrator API, existing `node:test` suites, vanilla JS frontend.

---

## Root Cause

- `server/ennoiaNaturalEditService.js`의 `draftNaturalLanguageEditWithEnnoia()`가 Ennoia와 로컬 초안을 동시에 시작하고 `ENNOIA_NATURAL_EDIT_FAST_FIRST_MS=1500` 이후 Ennoia를 abort한다. 대화형 수정에서는 1.5초가 너무 짧아 로컬 규칙이 기본 응답처럼 보인다.
- Ennoia가 400 MCP connection required를 반환하면 곧바로 `fallbackDraft()`가 `draftScheduleEditWithAgent()`를 호출한다. 이 로컬 엔진은 “아니 식사 말고” 같은 맥락 부정/정정을 이해하지 못하고 이전 target의 meal domain 질문을 반복한다.
- 현재 질문 응답도 `server/naturalEditQuestionService.js`가 규칙으로 선처리한다. 사용자가 원하는 동작은 LLM이 우선 답하고, 단순 플래너 필드 답변은 LLM 불가 시 fallback으로만 쓰는 것이다.
- API 응답 스키마는 사실상 draft 중심이다. `reply`는 추가됐지만, LLM 프롬프트와 sanitizer는 아직 `answer | clarify | draft` 턴을 명시적으로 모델링하지 않는다.

## File Structure

- Modify: `server/ennoiaNaturalEditService.js`
  - LLM-first turn planner 스키마 추가.
  - `fast-first`를 대화형 턴에서는 Ennoia abort 기준으로 쓰지 않도록 조정.
  - Ennoia 400/MCP 실패 시 반복 clarification 방지 fallback으로 변경.
- Modify: `server/index.js`
  - 규칙 질문 선처리 제거 또는 fallback-only로 이동.
  - LLM service 결과의 `reply`/`draft` union을 그대로 저장 및 반환.
- Modify: `server/naturalEditQuestionService.js`
  - 기본 선처리 모듈에서 fallback-only 답변 모듈로 역할 축소.
- Modify: `server/scheduleEditAgent.js`
  - `draftScheduleEditWithAgent()`에 `previousDraft`, `history`, `slots`를 반영한 맥락 fallback 보정 추가.
  - “아니 X 말고”/“그거 말고” 같은 부정 턴에서 이전 질문 반복 금지.
- Modify: `app/main.js`
  - 이미 있는 `reply` 렌더링은 유지.
  - `reply.source === "ennoia"`/`fallback` 표시가 필요하면 텍스트 말풍선에는 노출하지 않고 개발 상태만 저장.
- Test: `tests/ennoiaNaturalEditService.test.js`
  - LLM-first 및 MCP 실패 fallback 테스트.
- Test: `tests/naturalEditApplyApi.test.js`
  - API 대화 맥락 테스트.
- Test: `tests/generationLoadingUi.test.js`
  - 답변 메시지에 draft 카드/선택칩/적용 버튼이 없는지 유지 테스트.

---

### Task 1: LLM Turn Union 스키마를 테스트로 고정

**Files:**
- Modify: `tests/ennoiaNaturalEditService.test.js`

- [ ] **Step 1: Write failing tests for LLM-first answer and clarification**

Add these tests near the existing Ennoia natural edit tests:

```js
test("draftNaturalLanguageEditWithEnnoia returns an Ennoia answer turn without local fallback", async () => {
  withEnv({
    ENNOIA_NATURAL_EDIT_ENDPOINT: "https://ennoia.test/api/preset/edit?hash=edit-hash",
    ENNOIA_API_KEY: "test-key",
    ENNOIA_NATURAL_EDIT_FAST_FIRST_MS: "10",
    ENNOIA_NATURAL_EDIT_CHAT_WAIT_MS: "200"
  });
  global.fetch = async () =>
    new Response(
      JSON.stringify({
        output: JSON.stringify({
          turnType: "answer",
          reply: {
            text: "드론 라이트 쇼는 20:35부터 시작해요. 장소는 해운대해수욕장입니다."
          }
        })
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );

  const draft = await draftNaturalLanguageEditWithEnnoia("드론 쇼는 몇시부터야?", qaItems, {
    activeDate: "2026-06-14",
    history: []
  });

  assert.equal(draft.turnType, "answer");
  assert.equal(draft.draft, null);
  assert.equal(draft.reply.type, "answer");
  assert.equal(draft.reply.source, "ennoia");
  assert.match(draft.reply.text, /20:35/);
});

test("draftNaturalLanguageEditWithEnnoia does not fast-abort a chat LLM response at 1500ms", async () => {
  withEnv({
    ENNOIA_NATURAL_EDIT_ENDPOINT: "https://ennoia.test/api/preset/edit?hash=edit-hash",
    ENNOIA_API_KEY: "test-key",
    ENNOIA_NATURAL_EDIT_FAST_FIRST_MS: "1",
    ENNOIA_NATURAL_EDIT_CHAT_WAIT_MS: "80"
  });
  global.fetch = async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
    return new Response(
      JSON.stringify({
        output: JSON.stringify({
          turnType: "answer",
          reply: { text: "현재 일정 기준으로 답변할게요." }
        })
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };

  const result = await draftNaturalLanguageEditWithEnnoia("드론 쇼는 몇시부터야?", qaItems, {
    activeDate: "2026-06-14"
  });

  assert.equal(result.turnType, "answer");
  assert.equal(result.reply.source, "ennoia");
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
node --test --test-name-pattern "Ennoia answer turn|fast-abort" tests/ennoiaNaturalEditService.test.js
```

Expected: FAIL because the service currently returns draft-shaped objects and aborts after `fast-first`.

---

### Task 2: Replace draft-only LLM schema with turn planner schema

**Files:**
- Modify: `server/ennoiaNaturalEditService.js`

- [ ] **Step 1: Add normalized turn result helpers**

Add helpers after `sanitizeDraft()`:

```js
function normalizeTurnResult(parsed, items, originalDraftText = "") {
  const turnType = clean(parsed?.turnType || parsed?.type);
  if (turnType === "answer" || parsed?.reply) {
    return {
      turnType: "answer",
      reply: {
        type: "answer",
        text: clean(parsed.reply?.text || parsed.text || originalDraftText),
        source: "ennoia",
        modelStatus: "Ennoia LLM 답변"
      },
      draft: null
    };
  }

  const draftPayload = parsed?.draft && typeof parsed.draft === "object" ? parsed.draft : parsed;
  const safeDraft = sanitizeDraft(draftPayload, items);
  return {
    turnType: safeDraft.needsClarification ? "clarify" : "draft",
    draft: {
      ...safeDraft,
      source: "ennoia",
      modelStatus: safeDraft.needsClarification ? "Ennoia LLM 도메인 슬롯 확인" : "Ennoia LLM 자연어 수정 초안"
    },
    reply: null
  };
}

function unwrapDraftResult(result) {
  if (result?.turnType === "answer") return result;
  if (result?.draft) return result.draft;
  return result;
}
```

- [ ] **Step 2: Update `draftWithEnnoia()` to return union**

Replace the body after `const parsed = parseFirstBalancedJsonObject(assistantText);` with:

```js
const turnResult = normalizeTurnResult(parsed, items, assistantText);
if (turnResult.turnType === "answer") return turnResult;

const safeDraft = turnResult.draft;
if (safeDraft.needsClarification) {
  if (isStructuredClarification(safeDraft)) return safeDraft;
  return rescueClearEdit(text, items, options, safeDraft);
}

const placeRescue = await rescueDistantPlaceDraft(text, items, options, safeDraft);
if (placeRescue) return placeRescue;
return safeDraft;
```

- [ ] **Step 3: Update prompt schema**

In `buildEnnoiaRequest()`, add these system prompt lines:

```js
"먼저 사용자의 이번 턴이 answer, edit_draft, clarify 중 무엇인지 판단한다.",
"질문이면 플래너 JSON과 대화 맥락에서 바로 답하고 turnType=answer, reply.text를 반환한다.",
"수정이면 turnType=edit_draft와 draft 객체를 반환한다.",
"추가 정보가 필요하면 turnType=clarify와 draft.needsClarification=true를 반환한다.",
"사용자가 '아니', '말고', '그거 말고'로 정정하면 직전 assistant 질문과 직전 draft를 기준으로 제외 조건을 반영한다.",
```

Replace the return schema object root with:

```js
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
    recommendations: [],
    alternatives: [],
    confirmationMessage: "string"
  }
}
```

- [ ] **Step 4: Run Task 1 tests**

Run:

```bash
node --test --test-name-pattern "Ennoia answer turn|fast-abort" tests/ennoiaNaturalEditService.test.js
```

Expected: PASS.

---

### Task 3: Stop using 1500ms fast-first as the default chat decision

**Files:**
- Modify: `server/ennoiaNaturalEditService.js`

- [ ] **Step 1: Add chat wait budget**

Add after `naturalEditFastFirstMs()`:

```js
function naturalEditChatWaitMs() {
  const value = Number(process.env.ENNOIA_NATURAL_EDIT_CHAT_WAIT_MS);
  if (Number.isFinite(value) && value > 0) return value;
  return 6000;
}
```

- [ ] **Step 2: Change `draftNaturalLanguageEditWithEnnoia()` race**

Replace the `Promise.race([... fastFirst ...])` block with:

```js
const chatWaitMs = naturalEditChatWaitMs();
const first = await Promise.race([
  ennoiaDraftPromise,
  delay(chatWaitMs).then(() => ({ type: "chat-timeout" }))
]);

if (first.type === "ennoia") return unwrapDraftResult(first.draft);

controller.abort();
if (first.type === "fallback") {
  return fallbackDraft(fallbackText, items, first.status, options);
}
return localDraftPromise;
```

Keep `localDraftPromise` started early so the UI can still get a quick fallback after the chat budget, but do not abort LLM at 1500ms.

- [ ] **Step 3: Adjust old fast-first test expectations**

In `tests/ennoiaNaturalEditService.test.js`, change the old “returns a local draft after the fast-first budget” test to use `ENNOIA_NATURAL_EDIT_CHAT_WAIT_MS` as the timeout trigger. Expected modelStatus should mention chat timeout or Ennoia response delay, but not assert that 1500ms is the hard chat path.

- [ ] **Step 4: Run Ennoia tests**

Run:

```bash
node --test tests/ennoiaNaturalEditService.test.js
```

Expected: PASS.

---

### Task 4: Demote rule-based question answering to fallback-only

**Files:**
- Modify: `server/index.js`
- Modify: `server/naturalEditQuestionService.js`
- Modify: `tests/naturalEditApplyApi.test.js`

- [ ] **Step 1: Write failing API test proving Ennoia is called for questions**

Add a test in `tests/naturalEditApplyApi.test.js` that starts the server with a mock Ennoia endpoint returning:

```json
{
  "output": "{\"turnType\":\"answer\",\"reply\":{\"text\":\"LLM이 플래너를 보고 답했어요.\"}}"
}
```

Then POST:

```js
body: { text: "드론 쇼는 몇시부터야?", activeDate: "2026-06-14" }
```

Assert:

```js
assert.equal(response.draft, null);
assert.equal(response.reply.source, "ennoia");
assert.match(response.reply.text, /LLM이 플래너를 보고 답했어요/);
```

- [ ] **Step 2: Remove pre-LLM rule answer in `server/index.js`**

Delete this block before `draftNaturalLanguageEditWithEnnoia()`:

```js
const reply = answerNaturalEditQuestion(text, state.plan.items, {
  activeDate: body.activeDate || state.plan.date
});
if (reply) {
  appendNaturalEditMessage(conversation.sessionId, assistantMessageFromReply(reply));
  sendJson(response, 200, {
    sessionId: conversation.sessionId,
    reply,
    draft: null,
    conversation: summarizeNaturalEditConversation(conversation.sessionId)
  });
  return;
}
```

- [ ] **Step 3: Handle service union result**

After calling `draftNaturalLanguageEditWithEnnoia()`, insert:

```js
if (result?.turnType === "answer") {
  appendNaturalEditMessage(conversation.sessionId, assistantMessageFromReply(result.reply));
  sendJson(response, 200, {
    sessionId: conversation.sessionId,
    reply: result.reply,
    draft: null,
    conversation: summarizeNaturalEditConversation(conversation.sessionId)
  });
  return;
}

const draft = result?.draft || result;
```

Then keep the existing draft storage path.

- [ ] **Step 4: Keep `answerNaturalEditQuestion()` for no-Ennoia fallback**

Inside `draftNaturalLanguageEditWithEnnoia()`, before local `fallbackDraft()` only when `!endpoint || !apiKey || MCP 400`, call:

```js
const fallbackAnswer = answerNaturalEditQuestion(text, items, options);
if (fallbackAnswer) {
  return {
    turnType: "answer",
    reply: { ...fallbackAnswer, source: "fallback" },
    draft: null
  };
}
```

- [ ] **Step 5: Run API tests**

Run:

```bash
node --test tests/naturalEditApplyApi.test.js
```

Expected: PASS.

---

### Task 5: Fix contextual fallback for “아니 X 말고”

**Files:**
- Modify: `tests/naturalEditApplyApi.test.js`
- Modify: `server/scheduleEditAgent.js`
- Modify: `server/ennoiaNaturalEditService.js`

- [ ] **Step 1: Write failing test for repeated meal clarification**

Add this API test:

```js
test("natural language edit fallback handles negation without repeating the same meal question", async () => {
  const firstTurn = await api(baseUrl, "/api/natural-edits", {
    method: "POST",
    body: { text: "광안리해변 인근 점심 식사를 바꾸고 싶어", activeDate: "2026-06-23" }
  });
  assert.equal(firstTurn.draft.needsClarification, true);
  assert.equal(firstTurn.draft.domain, "meal");

  const secondTurn = await api(baseUrl, "/api/natural-edits", {
    method: "POST",
    body: {
      sessionId: firstTurn.sessionId,
      text: "아니 식사 말고",
      activeDate: "2026-06-23"
    }
  });

  assert.equal(secondTurn.draft.needsClarification, true);
  assert.notEqual(secondTurn.draft.domain, "meal");
  assert.doesNotMatch(secondTurn.draft.question, /점심 식사를 무엇으로 바꿀까요/);
  assert.match(secondTurn.draft.question, /식사 말고|어떤 유형|관광|카페|휴식/);
  assert.equal(secondTurn.draft.choices.some((choice) => choice.label === "한식"), false);
});
```

- [ ] **Step 2: Pass previous draft into fallback**

In `server/index.js`, add `previousDraft: conversationBeforeDraft.draft` to the options passed into `draftNaturalLanguageEditWithEnnoia()`.

In `fallbackDraft()`, pass through `previousDraft` to `draftScheduleEditWithAgent()`.

- [ ] **Step 3: Add negation detection to `scheduleEditAgent.js`**

Add near intent helpers:

```js
function hasDomainNegation(text) {
  return /아니|말고|그거\s*말고|식사\s*말고|음식\s*말고|밥\s*말고/.test(text);
}

function negatedDomain(text, previousDraft = {}) {
  if (/식사\s*말고|음식\s*말고|밥\s*말고/.test(text)) return "meal";
  if (/관광\s*말고|실내\s*말고|야외\s*말고/.test(text)) return previousDraft.domain || "attraction";
  return previousDraft.domain || "";
}
```

- [ ] **Step 4: Use negation before normal clarification**

Inside `draftScheduleEditWithAgent()` after `referencedItem` is computed:

```js
if (hasDomainNegation(requestText) && options.previousDraft?.needsClarification) {
  const rejected = negatedDomain(requestText, options.previousDraft);
  const target = options.previousDraft.targetItemId
    ? sortedItems.find((item) => item.id === options.previousDraft.targetItemId)
    : referencedItem;
  const domain = rejected === "meal" ? "attraction" : "other";
  return clarification(
    rejected === "meal"
      ? "식사 말고 어떤 유형으로 바꿀까요? 카페, 실내 관광, 야외 산책, 휴식 중에서 골라주세요."
      : "그 방향은 제외할게요. 대신 어떤 유형으로 바꿀까요?",
    {
      domain,
      targetItemId: target?.id,
      intent: "replace_place",
      confidence: 0.62,
      filledSlots: {
        ...(options.previousDraft.filledSlots || {}),
        excludedDomain: rejected
      },
      choices: choicesForDomain(domain)
    }
  );
}
```

Use the existing `clarification()` helper.

- [ ] **Step 5: Run targeted test**

Run:

```bash
node --test --test-name-pattern "negation without repeating" tests/naturalEditApplyApi.test.js
```

Expected: PASS.

---

### Task 6: Allow corrected concrete request to become a draft

**Files:**
- Modify: `tests/naturalEditApplyApi.test.js`
- Modify: `server/scheduleEditAgent.js`

- [ ] **Step 1: Write failing test for “아니 식사 말고 실내 관광”**

Add:

```js
test("natural language edit fallback turns negated meal into attraction draft when user gives a concrete domain", async () => {
  const firstTurn = await api(baseUrl, "/api/natural-edits", {
    method: "POST",
    body: { text: "광안리해변 인근 점심 식사를 바꾸고 싶어", activeDate: "2026-06-23" }
  });

  const secondTurn = await api(baseUrl, "/api/natural-edits", {
    method: "POST",
    body: {
      sessionId: firstTurn.sessionId,
      text: "아니 식사 말고 실내 관광",
      activeDate: "2026-06-23"
    }
  });

  assert.equal(secondTurn.draft.needsClarification, false);
  assert.equal(secondTurn.draft.domain, "attraction");
  assert.match(secondTurn.draft.patch.title, /실내|박물관|관광|방문/);
  assert.doesNotMatch(secondTurn.draft.patch.title, /식사|점심|한식|중식|일식/);
});
```

- [ ] **Step 2: Reinterpret request with previous target but new domain**

In `draftScheduleEditWithAgent()`, before `const desired = extractDesiredPlaceQuery(requestText);`, add:

```js
const previousTarget = options.previousDraft?.targetItemId
  ? sortedItems.find((item) => item.id === options.previousDraft.targetItemId)
  : null;
const contextualText = hasDomainNegation(requestText) && previousTarget
  ? requestText.replace(/아니|식사\s*말고|음식\s*말고|밥\s*말고|그거\s*말고/g, "").trim()
  : requestText;
const desired = extractDesiredPlaceQuery(contextualText);
```

Replace later `extractDesiredPlaceQuery(requestText)` usage with `desired` and use `contextualText` for domain inference where needed.

- [ ] **Step 3: Preserve target from previous draft**

Change target selection:

```js
const target = hasExplicitAddIntent(requestText) && mode === "add_or_update" ? null : referencedItem || previousTarget;
```

- [ ] **Step 4: Run targeted test**

Run:

```bash
node --test --test-name-pattern "negated meal into attraction draft" tests/naturalEditApplyApi.test.js
```

Expected: PASS.

---

### Task 7: UI status cleanup for LLM-first behavior

**Files:**
- Modify: `app/main.js`
- Modify: `tests/generationLoadingUi.test.js`

- [ ] **Step 1: Add static test that answer messages hide fallback status**

In `tests/generationLoadingUi.test.js`, add:

```js
test("natural edit answer messages render only natural text", () => {
  assert.match(mainSource, /if \(result\.reply\) \{/);
  assert.match(mainSource, /naturalChatMessages\.push\(\{ role: "assistant", text: result\.reply\.text \}\);/);
  assert.doesNotMatch(mainSource, /text: `\\$\\{result\\.reply\\.modelStatus/);
});
```

- [ ] **Step 2: Keep frontend as simple text renderer**

No UI code change is needed if `requestNaturalDraft()` still pushes:

```js
naturalChatMessages.push({ role: "assistant", text: result.reply.text });
```

If code has drifted, restore exactly that.

- [ ] **Step 3: Run UI tests**

Run:

```bash
node --test tests/generationLoadingUi.test.js
```

Expected: PASS.

---

### Task 8: Full verification and public deploy

**Files:**
- Modify: `index.html`
- Modify: `sw.js`

- [ ] **Step 1: Bump static asset version**

If `app/main.js` changes, bump:

```html
<link rel="stylesheet" href="/app/styles.css?v=34" />
<script type="module" src="/app/main.js?v=34"></script>
```

and:

```js
const CACHE_NAME = "travel-ops-shell-v25";
const SHELL = ["/", "/app/main.js?v=34", "/app/styles.css?v=34", "/manifest.webmanifest"];
```

- [ ] **Step 2: Run full local verification**

Run:

```bash
node --test tests/ennoiaNaturalEditService.test.js
node --test tests/scheduleEditAgent.test.js
node --test tests/naturalEditApplyApi.test.js
node --test tests/generationLoadingUi.test.js
node --test tests/**/*.test.js
```

Expected: all tests PASS.

- [ ] **Step 3: Deploy changed runtime files**

Run:

```bash
scp server/index.js server/ennoiaNaturalEditService.js server/scheduleEditAgent.js server/naturalEditQuestionService.js rpi:/home/user/prompton-deploy/current/server/
scp app/main.js rpi:/home/user/prompton-deploy/current/app/main.js
scp index.html sw.js rpi:/home/user/prompton-deploy/current/
ssh rpi 'cd /home/user/prompton-deploy/current && (lsof -ti tcp:8787 | xargs -r kill 2>/dev/null || true); nohup env PORT=8787 node server/index.js > server.log 2>&1 < /dev/null &'
```

- [ ] **Step 4: Verify public behavior**

Run:

```bash
curl -fsS https://sep-club-nations-luck.trycloudflare.com/ | rg 'main\.js|styles\.css'
```

Then in Chrome:

1. Ask `드론 쇼는 몇시부터야?`
2. Expected: normal assistant answer, no draft card.
3. Ask `광안리해변 인근 점심 식사를 바꾸고 싶어`
4. Expected: if LLM available, LLM clarification. If fallback, meal clarification is acceptable for this first ambiguous turn.
5. Ask `아니 식사 말고`
6. Expected: no repeated meal clarification. The assistant asks for non-meal category or proposes non-meal options.
7. Ask `아니 식사 말고 실내 관광`
8. Expected: attraction/indoor draft, not meal choices.

---

## Execution Notes

- Do not delete local fallback. Keep it for no endpoint, no API key, MCP 400, and timeout cases.
- Do not expose `규칙 기반 fallback` status in normal answer bubbles.
- Do not let `ENNOIA_NATURAL_EDIT_FAST_FIRST_MS` decide conversational correctness. Use it only as a local draft preparation budget; final chat wait should use `ENNOIA_NATURAL_EDIT_CHAT_WAIT_MS`.
- Keep `/api/natural-edits` response backward compatible:
  - Answer: `{ sessionId, reply, draft: null, conversation }`
  - Draft: `{ sessionId, draft, conversation }`

## Self-Review

- Spec coverage: LLM-first behavior, question answering, negation correction, fallback safety, UI rendering, and deployment are covered.
- Placeholder scan: no TBD/TODO/fill-in-later placeholders remain.
- Type consistency: the plan consistently uses `turnType`, `reply`, `draft`, `previousDraft`, `history`, and existing `sessionId`.
