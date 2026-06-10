import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const mainSource = await readFile(new URL("../app/main.js", import.meta.url), "utf8");
const stylesSource = await readFile(new URL("../app/styles.css", import.meta.url), "utf8");
const indexSource = await readFile(new URL("../index.html", import.meta.url), "utf8");
const serviceWorkerSource = await readFile(new URL("../sw.js", import.meta.url), "utf8");

test("browser bundle is syntactically valid before deploy", async () => {
  await execFileAsync(process.execPath, ["--check", fileURLToPath(new URL("../app/main.js", import.meta.url))]);
});

test("public demo exposes the Ennoia app handoff", () => {
  assert.match(mainSource, /const ENNOIA_APP_URL = "https:\/\/ennoia\.so\/apps\/openLink\/d4c56c7f9185453f8851f8989a8aac9c"/);
  assert.match(mainSource, /href="\$\{ENNOIA_APP_URL\}"/);
  assert.match(mainSource, /Ennoia 앱 열기/);
  assert.doesNotMatch(mainSource, /이 웹 데모는 선택 제출용 확장 화면/);
  assert.doesNotMatch(mainSource, /실제 심사 핵심 기능은 Ennoia Studio 앱에서 확인합니다/);
  assert.match(stylesSource, /\.submission-link/);
  assert.doesNotMatch(stylesSource, /\.submission-note/);
});

test("static asset versions are bumped together", () => {
  assert.match(indexSource, /\/app\/styles\.css\?v=37/);
  assert.match(indexSource, /\/app\/main\.js\?v=37/);
  assert.match(serviceWorkerSource, /travel-ops-shell-v28/);
  assert.match(serviceWorkerSource, /\/app\/main\.js\?v=37/);
  assert.match(serviceWorkerSource, /\/app\/styles\.css\?v=37/);
});

test("trip generation busy state shows progress stages", () => {
  assert.match(mainSource, /여행 일정을 짓는 중이에요/);
  assert.match(mainSource, /관광지와 행사 후보, 맛집, 이동 동선을 모아/);
  assert.match(mainSource, /관광 정보 수집/);
  assert.match(mainSource, /KTO 행사정보 확인/);
  assert.match(mainSource, /주변 맛집·카페 매칭/);
  assert.match(mainSource, /이동 동선·주차 점검/);
  assert.match(mainSource, /타임테이블 구성/);
});

test("trip generation result renders KTO event suggestions", () => {
  assert.match(mainSource, /generation\.eventSuggestions/);
  assert.match(mainSource, /renderEventSuggestions/);
  assert.match(mainSource, /aria-label="KTO 행사 후보"/);
  assert.match(mainSource, /KTO 행사 후보/);
  assert.match(stylesSource, /\.event-suggestions/);
});

test("trip generation controls prevent duplicate submissions while busy", () => {
  assert.match(mainSource, /generationActionLabel/);
  assert.match(mainSource, /generationDisabledAttr/);
  assert.match(mainSource, /생성 중\.\.\./);
  assert.match(mainSource, /scrollGenerationPanelIntoView/);
});

test("trip generation dialog uses neutral regional placeholders", () => {
  assert.doesNotMatch(mainSource, /name="region" required value="수원시"/);
  assert.doesNotMatch(mainSource, /name="quickRequest"/);
  assert.doesNotMatch(mainSource, /한 줄 요청/);
  assert.match(mainSource, /name="region" placeholder="예: 부산시, 대구시, 전주"/);
  assert.match(mainSource, /value="\$\{escapeHtml\(defaultTripRegion\(\)\)\}"/);
  assert.match(mainSource, /name="startDate" type="date"/);
  assert.match(mainSource, /name="endDate" type="date"/);
  assert.doesNotMatch(mainSource, /value="\$\{escapeHtml\(defaultTripStartDate\(\)\)\}"/);
  assert.doesNotMatch(mainSource, /value="\$\{escapeHtml\(defaultTripEndDate\(\)\)\}"/);
  assert.doesNotMatch(mainSource, /function defaultTripStartDate/);
  assert.doesNotMatch(mainSource, /function defaultTripEndDate/);
  assert.match(mainSource, /function showTripDialog\(\)/);
  assert.match(mainSource, /startDateInput\.value = ""/);
  assert.match(mainSource, /endDateInput\.value = ""/);
  assert.match(mainSource, /if \(action === "open-trip" && !generationBusy\) showTripDialog\(\);/);
  assert.match(mainSource, /name="lodgingArea" placeholder="예: 부산 해운대구 해운대해변로 264"/);
  assert.doesNotMatch(mainSource, /name="startDate" type="date" required/);
  assert.doesNotMatch(mainSource, /name="endDate" type="date" required/);
});

test("trip generation errors use Korean server messages instead of raw HTTP labels", () => {
  assert.match(mainSource, /function apiErrorMessage/);
  assert.doesNotMatch(mainSource, /API error/);
  assert.match(mainSource, /요청 처리 중 오류가 발생했습니다/);
});

test("trip generation dialog offers a car or public-transit transport toggle", () => {
  assert.match(mainSource, /<fieldset class="transport-toggle"/);
  assert.match(mainSource, /legend>이동 방식<\/legend>/);
  assert.match(mainSource, /name="transportMode" value="car" checked/);
  assert.match(mainSource, /name="transportMode" value="subway"/);
  assert.match(mainSource, />자가용</);
  assert.match(mainSource, />대중교통</);
  assert.match(stylesSource, /\.transport-toggle/);
  assert.match(stylesSource, /\.transport-option/);
  assert.match(stylesSource, /\.transport-option input:checked \+ span/);
});

test("itinerary board is collapsible and renders an empty-state CTA", () => {
  assert.match(mainSource, /data-action="toggle-itinerary"/);
  assert.match(mainSource, /class="planner-body" id="plannerBody"/);
  assert.match(mainSource, /function setItineraryCollapsed/);
  assert.match(mainSource, /localStorage\.setItem\("itineraryCollapsed"/);
  assert.match(mainSource, /planner-empty/);
  assert.match(mainSource, /아직 만든 일정이 없어요/);
  assert.match(stylesSource, /\.planner-board\.collapsed \.planner-body/);
});

test("natural edit draft stays pending until apply succeeds", () => {
  assert.match(mainSource, /await mutate\("\/api\/natural-edits\/apply", draft\);\s+pendingDraft = null;/);
});

test("natural edit composer shows loading, live draft, and local errors", () => {
  assert.match(mainSource, /let naturalEditBusy = false/);
  assert.match(mainSource, /let draftApplyBusy = false/);
  assert.match(mainSource, /let naturalEditError = ""/);
  assert.match(mainSource, /AI 가 생각중/);
  assert.match(mainSource, /thinking-dots/);
  assert.match(stylesSource, /@keyframes thinking-bounce/);
  assert.match(mainSource, /class="draft-zone" aria-live="polite"/);
  assert.match(mainSource, /class="natural-error"/);
});

test("natural edit submit button does not render a second loading animation", () => {
  const submitLabelFunction = mainSource.match(/function naturalEditSubmitLabel\(\) \{[\s\S]*?\n\}/)?.[0] || "";
  assert.match(submitLabelFunction, /return "보내기";/);
  assert.doesNotMatch(submitLabelFunction, /thinkingDots|naturalEditBusy|AI 가 생각중|수정안 만드는 중/);
  assert.match(mainSource, /naturalEditBusy \? `<p class="draft pending">/);
});

test("natural edit chat only scrolls when messages are appended", () => {
  assert.match(mainSource, /function scrollNaturalChatToBottom/);
  assert.match(mainSource, /naturalChatMessages\.push\(\{ role: "user", text: userText \}\);\s+render\(\);\s+scrollNaturalChatToBottom\(\);/);
  assert.match(mainSource, /naturalEditBusy = false;\s+render\(\);\s+scrollNaturalChatToBottom\(\);/);
  assert.doesNotMatch(mainSource, /function scrollNaturalDraftIntoView/);
  assert.doesNotMatch(mainSource, /\.draft-zone"\)\?\.scrollIntoView/);
});

test("natural edit composer lives in a bottom-right chatbot widget", () => {
  assert.match(mainSource, /let chatbotOpen = false/);
  assert.match(mainSource, /renderNaturalEditChatbot/);
  assert.match(mainSource, /data-action="toggle-chatbot"/);
  assert.match(mainSource, /class="chatbot-widget/);
  assert.match(mainSource, /class="chatbot-launcher"/);
  assert.match(mainSource, /class="chatbot-panel"/);
  assert.match(mainSource, /classList\.toggle\("chatbot-open"/);
  assert.match(mainSource, /function focusNaturalEditInput/);
  assert.match(mainSource, /class="composer chatbot-composer" data-role="natural-form"/);
  assert.match(stylesSource, /\.chatbot-widget/);
  assert.match(stylesSource, /\.chatbot-panel/);
  assert.match(stylesSource, /\.chatbot-launcher/);
  assert.match(stylesSource, /@media \(max-width: 560px\)[\s\S]*\.chatbot-widget/);
});

test("natural edit chatbot keeps a session thread with slot summary and choice chips", () => {
  assert.match(mainSource, /let naturalSessionId = ""/);
  assert.match(mainSource, /let naturalChatMessages = \[\]/);
  assert.match(mainSource, /let naturalSlots = \{\}/);
  assert.match(mainSource, /renderNaturalChatMessage/);
  assert.match(mainSource, /renderNaturalSlotSummary/);
  assert.match(mainSource, /renderDraftChoices/);
  assert.match(mainSource, /data-action="apply-choice"/);
  assert.match(mainSource, /sessionId: naturalSessionId/);
  assert.match(mainSource, /naturalChatMessages\.push/);
  assert.match(stylesSource, /\.slot-summary/);
  assert.match(stylesSource, /\.choice-chips/);
  assert.match(stylesSource, /\.chat-message\.user/);
});

test("trip generation success resets natural edit chat without closing the chatbot", () => {
  assert.match(mainSource, /function resetNaturalEditChat\(\)/);
  const resetFunction = mainSource.match(/function resetNaturalEditChat\(\) \{[\s\S]*?\n\}/)?.[0] || "";
  assert.match(resetFunction, /pendingDraft = null/);
  assert.match(resetFunction, /naturalSessionId = ""/);
  assert.match(resetFunction, /naturalChatMessages = \[\]/);
  assert.match(resetFunction, /naturalSlots = \{\}/);
  assert.match(resetFunction, /naturalEditError = ""/);
  assert.match(resetFunction, /naturalEditText = ""/);
  assert.match(resetFunction, /naturalAddText = ""/);
  assert.match(resetFunction, /draftApplyRecommendationId = ""/);
  assert.match(resetFunction, /draftApplyBusy = false/);
  assert.doesNotMatch(resetFunction, /chatbotOpen/);
  assert.match(
    mainSource,
    /currentState = result\.state;\s+activeDate = currentState\.plan\.startDate \|\| currentState\.plan\.date;\s+resetNaturalEditChat\(\);/
  );
  const catchBlock = mainSource.match(/catch \(error\) \{\s+generationError = error\.message;\s+\}/)?.[0] || "";
  assert.doesNotMatch(catchBlock, /resetNaturalEditChat/);
});

test("natural edit chatbot renders planner answers as plain assistant messages", () => {
  assert.match(mainSource, /result\.reply/);
  assert.match(mainSource, /source: result\.reply\.source/);
  assert.match(mainSource, /modelStatus: result\.reply\.modelStatus/);
  assert.match(mainSource, /naturalChatMessageLabel/);
  assert.match(mainSource, /message\.source === "ennoia"/);
  assert.match(mainSource, /로컬 플래너 답변/);
  assert.match(mainSource, /if \(role === "assistant" && message\.draft\) return renderDraft\(message\.draft\);/);
  assert.doesNotMatch(mainSource, /draft:\s*result\.reply/);
});

test("natural edit chatbot does not render a page-blocking backdrop", () => {
  assert.doesNotMatch(mainSource, /sidebar-backdrop/);
  assert.doesNotMatch(stylesSource, /\.sidebar-backdrop/);
  assert.doesNotMatch(stylesSource, /body\.sidebar-open/);
});

test("natural edit apply scrolls to the updated item and highlights it", () => {
  assert.match(mainSource, /let recentlyEditedItemId = null/);
  assert.match(mainSource, /data-item-id="\$\{escapeHtml\(item\.id\)\}"/);
  assert.match(mainSource, /just-edited/);
  assert.match(mainSource, /highlightEditedItem\(result\.item\)/);
  assert.match(mainSource, /function scrollEditedItemIntoView/);
  assert.match(mainSource, /scrollIntoView\(\{\s*behavior: "smooth",\s*block: "center"\s*\}\);/);
  assert.match(stylesSource, /\.plan-item\.just-edited/);
  assert.match(stylesSource, /@keyframes edited-item-pulse/);
});

test("add schedule button opens the AI-first natural edit dialog with manual fallback", () => {
  assert.match(mainSource, /renderAddAgentDialog/);
  assert.match(mainSource, /data-role="natural-add-form"/);
  assert.match(mainSource, /showAddAgentDialog/);
  assert.match(mainSource, /showManualAddDialog/);
  assert.match(mainSource, /mode: "add_or_update"/);
  assert.match(mainSource, /직접 입력/);
});

test("natural edit draft renders operation, resolution, and clickable recommendations", () => {
  assert.match(mainSource, /draft\.operation === "add"/);
  assert.match(mainSource, /resolutionMessage/);
  assert.match(mainSource, /renderDraftRecommendations/);
  assert.match(mainSource, /data-action="apply-recommendation"/);
  assert.match(mainSource, /selectedRecommendationId/);
  assert.match(stylesSource, /\.draft-recommendations/);
}
);

test("natural edit draft labels Ennoia, agent, and fallback sources distinctly", () => {
  assert.match(mainSource, /draft\.source === "ennoia"/);
  assert.match(mainSource, /draft\.source === "agent"/);
  assert.match(mainSource, /일정수정 에이전트 초안/);
  assert.match(mainSource, /규칙 기반 fallback/);
});

test("loading animation respects reduced-motion users", () => {
  assert.match(stylesSource, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(stylesSource, /\.gen-orb/);
  assert.match(stylesSource, /\.gen-bar span/);
  assert.match(stylesSource, /animation: none/);
});

test("trip generation busy state uses an ambient loader instead of plain step cards", () => {
  // markup: drifting aurora orbs, sequential step track, gradient bar, shimmer skeleton
  assert.match(mainSource, /gen-orbs/);
  assert.match(mainSource, /class="gen-orb a"/);
  assert.match(mainSource, /gen-track/);
  assert.match(mainSource, /gen-bar/);
  assert.match(mainSource, /gen-skeleton/);
  // styles: the loader is actually animated
  assert.match(stylesSource, /@keyframes orb-drift-a/);
  assert.match(stylesSource, /@keyframes bar-slide/);
  assert.match(stylesSource, /@keyframes shimmer/);
});

test("route maps show start and arrival flags without the OSM disclaimer box", () => {
  assert.match(mainSource, /window\.L\.divIcon/);
  assert.match(mainSource, /routeEndpointIcon\("start", "출발"\)/);
  assert.match(mainSource, /routeEndpointIcon\("finish", "도착"\)/);
  assert.match(mainSource, /class="route-marker \$\{type\}"/);
  assert.match(mainSource, /padding: \[72, 72\]/);
  assert.doesNotMatch(mainSource, /도로선과 거리는 OSM 기준/);
  assert.match(stylesSource, /\.route-marker/);
  assert.match(stylesSource, /\.route-marker\.finish/);
  assert.match(stylesSource, /\.map-summary\s*\{[^}]*top: auto;[^}]*bottom: 12px;/s);
});
