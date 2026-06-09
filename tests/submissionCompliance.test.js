import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const auditSource = await readFile(new URL("../docs/submission-compliance-audit.md", import.meta.url), "utf8");
const readmeSource = await readFile(new URL("../README.md", import.meta.url), "utf8");
const realignmentSource = await readFile(new URL("../docs/ennoia-submission-realignment.md", import.meta.url), "utf8");
const formDraftSource = await readFile(new URL("../docs/final-submission-form-draft.md", import.meta.url), "utf8");

const unusedKtoServices = [
  "영문 관광정보 서비스",
  "일문 관광정보 서비스",
  "중문 간체 관광정보 서비스",
  "중문 번체 관광정보 서비스",
  "독어 관광정보 서비스",
  "불어 관광정보 서비스",
  "서어 관광정보 서비스",
  "노어 관광정보 서비스",
  "무장애 여행 정보 서비스",
  "관광사진 정보 서비스",
  "고캠핑 정보 조회 서비스",
  "관광지 오디오 가이드 정보 서비스",
  "관광 빅데이터 정보 서비스",
  "두루누비 정보 서비스",
  "관광인 채용 정보 서비스",
  "반려동물 동반여행 서비스",
  "기초지자체 중심관광지 정보 서비스",
  "관광지별 연관관광지 정보 서비스",
  "관광지 집중률 방문자 추이 예측 정보 서비스",
  "의료 관광정보 서비스",
  "웰니스 관광정보 서비스",
  "관광공모전(사진) 수상작 정보 서비스",
  "지역별 관광 다양성 정보 서비스",
  "지역별 관광 수요 강도 정보 서비스",
  "지역별 관광 자원 수요 정보 서비스"
];

test("submission docs only mark the verified Korean tourism service as used", () => {
  assert.match(auditSource, /\| 국문 관광정보 서비스 \| 사용 \| 제출서에 선택 \|/);
  assert.match(readmeSource, /KTO OpenAPI 활용 서비스는 현재 확인 기준 `국문 관광정보 서비스`만 선택/);
  assert.match(realignmentSource, /서비스 체크박스는 현재 기준 `국문 관광정보 서비스`만 선택/);
  assert.match(formDraftSource, /제출 폼에서 선택할 서비스:\n\n```text\n국문 관광정보 서비스\n```/);

  for (const serviceName of unusedKtoServices) {
    assert.match(auditSource, new RegExp(`\\| ${escapeRegExp(serviceName)} \\| 미사용 \\| 선택하지 않음 \\|`));
    assert.match(formDraftSource, new RegExp(`- ${escapeRegExp(serviceName)}`));
  }
});

test("submission docs record public share access and web handoff", () => {
  assert.match(auditSource, /https:\/\/ennoia\.so\/apps\/openLink\/d4c56c7f9185453f8851f8989a8aac9c/);
  assert.match(formDraftSource, /https:\/\/ennoia\.so\/apps\/openLink\/d4c56c7f9185453f8851f8989a8aac9c/);
  assert.match(auditSource, /Ennoia 제출 앱 채팅 확인: `6월 23일부터 25일까지 부산/);
  assert.match(realignmentSource, /2026-06-08 제출 앱 부산 일정\+KTO 행사/);
  assert.match(realignmentSource, /광안리 M\(Marvelous\) 드론 라이트쇼/);
  assert.match(readmeSource, /Public 공유 링크 생성 완료, 익명\/로그아웃 브라우저 접근 확인 완료/);
  assert.match(auditSource, /https:\/\/pockets-merely-brake-trainer\.trycloudflare\.com/);
  assert.match(readmeSource, /Ennoia 앱 열기/);
  assert.match(readmeSource, /현재 공유 상태: `Public 공유 활성`/);
  assert.match(readmeSource, /final-submission-form-draft\.md/);
  assert.match(auditSource, /익명\/로그아웃 브라우저 확인: 로그인 페이지로 리다이렉트되지 않고/);
  assert.match(auditSource, /Public 공유 링크 응답 확인: 익명 브라우저에서 부산 2박 3일 추천 질문 실행/);
  assert.match(realignmentSource, /Public 공유 URL 응답 재확인/);
  assert.match(formDraftSource, /Public 공유 링크 생성 완료/);
  assert.match(formDraftSource, /부산 2박 3일 추천 질문 실행 시 `\[일정 검토\]`/);
  assert.match(formDraftSource, /KTO OpenAPI 신청자명과 개인 서비스 인증키는 제출 폼에만 직접 입력/);
  assert.match(formDraftSource, /https:\/\/pockets-merely-brake-trainer\.trycloudflare\.com/);
  assert.doesNotMatch(realignmentSource, /최대 토큰: `4096`/);
});

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
