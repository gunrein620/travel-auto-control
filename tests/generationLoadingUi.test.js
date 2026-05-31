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
