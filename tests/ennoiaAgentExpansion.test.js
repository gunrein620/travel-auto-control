import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const expansionSource = await readFile(new URL("../docs/ennoia-agent-expansion-plan.md", import.meta.url), "utf8");
const readmeSource = await readFile(new URL("../README.md", import.meta.url), "utf8");
const studioPromptSource = await readFile(new URL("../docs/ennoia-studio-agent-prompt.md", import.meta.url), "utf8");

const specialistAgents = [
  "여행 관제 오케스트레이터",
  "요청 해석 에이전트",
  "지역·장소 모호성 판별 에이전트",
  "KTO 관광지 후보 수집 에이전트",
  "KTO 상세정보 검증 에이전트",
  "KTO 행사·축제 스카우트",
  "날씨 리스크 에이전트",
  "실내 대안 에이전트",
  "주차·자가용 동선 에이전트",
  "맛집·카페 큐레이터",
  "일정 구성 에이전트",
  "유지·주의·우회 판정 에이전트",
  "자연어 일정 수정 에이전트",
  "답변 QA·보안 감사 에이전트"
];

const validationQuestions = [
  "6.23-25 부산 여행",
  "서울숲 비/우회",
  "수원 화성행궁 자가용/주차",
  "중앙공원 모호성",
  "비 오는 날 부산 해운대 대신 실내 코스 추천",
  "아이 동반 수원 1일 코스, 주차 적은 동선",
  "둘째 날 저녁을 광안리 근처 해산물로 바꿔줘",
  "행사 없으면 KTO 기준 후보 없음이라고 말해줘"
];

test("agent expansion document defines the complete specialist team", () => {
  assert.match(readmeSource, /ennoia-agent-expansion-plan\.md/);
  assert.match(studioPromptSource, /여행 관제 오케스트레이터/);
  assert.match(studioPromptSource, /14개 전문 에이전트/);

  for (const agentName of specialistAgents) {
    assert.match(expansionSource, new RegExp(escapeRegExp(agentName)));
  }

  assert.match(expansionSource, /Ennoia Public 앱 URL/);
  assert.match(expansionSource, /https:\/\/ennoia\.so\/apps\/openLink\/d4c56c7f9185453f8851f8989a8aac9c/);
  assert.match(expansionSource, /\[일정 검토\]/);
  assert.match(expansionSource, /\[판정: 유지\/주의\/우회\]/);
});

test("agent expansion preserves the legacy public app and records the new multi-agent app", () => {
  assert.match(readmeSource, /메인 에이전트: `여행 상황 점검 에이전트`/);
  assert.match(readmeSource, /멀티에이전트: `여행 관제팀 멀티 에이전트`/);
  assert.match(readmeSource, /연결 앱: `여행 관제팀 멀티`/);
  assert.match(expansionSource, /기존 Public 앱 `여행 상황 점검`은 레거시 제출 앱/);
  assert.match(expansionSource, /연결 에이전트를 `여행 상황 점검 에이전트`로 유지/);
  assert.match(expansionSource, /멀티에이전트 ID: `1ff5980a3d`/);
  assert.match(expansionSource, /배포 버전: `v1 운영중`/);
  assert.match(expansionSource, /별도 앱: `여행 관제팀 멀티`/);
  assert.match(expansionSource, /앱 공유 상태: `공유 안 함`/);
  assert.match(expansionSource, /Start -> 여행 관제 오케스트레이터 -> 요청 해석 에이전트 -> 지역·장소 모호성 판별 에이전트/);
  assert.doesNotMatch(expansionSource, /선택 에이전트를 `여행 관제 오케스트레이터`로 변경/);
});

test("agent expansion keeps KTO connector policy and validation suite explicit", () => {
  assert.match(expansionSource, /국문 관광정보 서비스만 사용/);
  assert.match(expansionSource, /실제 커넥터 생성·응답 검증 전까지 제출서에 추가하지 않는다/);
  assert.match(expansionSource, /KTO 관광정보 성공\/부분 성공\/실패/);
  assert.match(expansionSource, /서비스키, 원문 API URL, 원문 JSON 미노출/);
  assert.doesNotMatch(expansionSource, /영문 관광정보 서비스.*사용/s);
  assert.doesNotMatch(expansionSource, /고캠핑 정보 조회 서비스.*사용/s);

  for (const question of validationQuestions) {
    assert.match(expansionSource, new RegExp(escapeRegExp(question)));
  }
});

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
