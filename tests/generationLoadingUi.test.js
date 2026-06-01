import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const mainSource = await readFile(new URL("../app/main.js", import.meta.url), "utf8");
const stylesSource = await readFile(new URL("../app/styles.css", import.meta.url), "utf8");

test("trip generation busy state shows progress stages", () => {
  assert.match(mainSource, /여행 일정을 짓는 중이에요/);
  assert.match(mainSource, /관광지와 맛집, 이동 동선을 모아/);
  assert.match(mainSource, /관광 정보 수집/);
  assert.match(mainSource, /주변 맛집·카페 매칭/);
  assert.match(mainSource, /이동 동선·주차 점검/);
  assert.match(mainSource, /타임테이블 구성/);
});

test("trip generation controls prevent duplicate submissions while busy", () => {
  assert.match(mainSource, /generationActionLabel/);
  assert.match(mainSource, /generationDisabledAttr/);
  assert.match(mainSource, /생성 중\.\.\./);
  assert.match(mainSource, /scrollGenerationPanelIntoView/);
});

test("trip generation dialog uses neutral regional placeholders", () => {
  assert.doesNotMatch(mainSource, /name="region" required value="수원시"/);
  assert.match(mainSource, /name="region" required placeholder="예: 부산시, 대구시, 전주"/);
  assert.match(mainSource, /name="lodgingArea" placeholder="예: 해운대역 근처, 동성로 근처, 전주 한옥마을 근처"/);
});

test("natural edit draft stays pending until apply succeeds", () => {
  assert.match(mainSource, /await mutate\("\/api\/natural-edits\/apply", draft\);\s+pendingDraft = null;/);
});

test("natural edit composer shows loading, live draft, and local errors", () => {
  assert.match(mainSource, /let naturalEditBusy = false/);
  assert.match(mainSource, /let draftApplyBusy = false/);
  assert.match(mainSource, /let naturalEditError = ""/);
  assert.match(mainSource, /수정안 만드는 중\.\.\./);
  assert.match(mainSource, /class="spinner"/);
  assert.match(mainSource, /class="draft-zone" aria-live="polite"/);
  assert.match(mainSource, /class="natural-error"/);
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

test("natural edit draft renders operation, resolution, and alternatives", () => {
  assert.match(mainSource, /draft\.operation === "add"/);
  assert.match(mainSource, /resolutionMessage/);
  assert.match(mainSource, /renderDraftAlternatives/);
  assert.match(stylesSource, /\.draft-alternatives/);
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
