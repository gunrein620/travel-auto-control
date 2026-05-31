import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const mainSource = await readFile(new URL("../app/main.js", import.meta.url), "utf8");
const stylesSource = await readFile(new URL("../app/styles.css", import.meta.url), "utf8");

test("trip generation busy state shows agent progress stages", () => {
  assert.match(mainSource, /AI 여행 설계 중/);
  assert.match(mainSource, /관광지, 맛집, 이동 동선을 확인하고 있습니다\./);
  assert.match(mainSource, /KTO 관광정보 확인/);
  assert.match(mainSource, /근처 맛집·카페 후보 탐색/);
  assert.match(mainSource, /이동 동선·주차 연결 점검/);
  assert.match(mainSource, /플래너 타임테이블 반영 준비/);
});

test("trip generation controls prevent duplicate submissions while busy", () => {
  assert.match(mainSource, /generationActionLabel/);
  assert.match(mainSource, /generationDisabledAttr/);
  assert.match(mainSource, /생성 중\.\.\./);
  assert.match(mainSource, /scrollGenerationPanelIntoView/);
});

test("loading animation respects reduced-motion users", () => {
  assert.match(stylesSource, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(stylesSource, /agent-step/);
  assert.match(stylesSource, /agent-signal/);
  assert.match(stylesSource, /animation: none/);
});

test("trip generation busy state uses a dynamic ops visual instead of plain step cards", () => {
  assert.match(mainSource, /agent-loading-layout/);
  assert.match(mainSource, /agent-flow-visual/);
  assert.match(mainSource, /agent-signal/);
  assert.match(mainSource, /agent-progress-track/);
  assert.match(stylesSource, /@keyframes agent-signal-travel/);
  assert.match(stylesSource, /@keyframes agent-track-fill/);
  assert.doesNotMatch(stylesSource, /@keyframes agent-step-shimmer[\s\S]*background-position/);
});
