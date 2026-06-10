# 여행 상황 점검

한국관광공사 2026 프롬프톤 제출을 위해 만든 여행 체크포인트 관제 서비스입니다.

현재 방향은 명확합니다. 필수 제출물의 중심은 외부 웹앱이 아니라 Ennoia Studio 안에서 완결되는 `여행 상황 점검` 앱입니다. 이 저장소의 Node/HTML 웹앱은 선택 제출 또는 보조 시연용 확장 데모로 둡니다.

## 제출용 Ennoia 앱

- 메인 앱: `여행 상황 점검`
- 메인 에이전트: `여행 상황 점검 에이전트`
- 최신 배포 버전: `v0.9-kto`
- 앱 공유 URL: https://ennoia.so/apps/openLink/d4c56c7f9185453f8851f8989a8aac9c
- 현재 접근 상태: Public 공유 링크 생성 완료, 익명/로그아웃 브라우저 접근 확인 완료

핵심 기능은 사용자의 여행 지역, 날짜 범위, 장소, 시간, 이동 맥락을 받아 KTO 관광정보와 행사정보, 날씨, Kakao Local 보조 정보를 확인하고 `[유지/주의/우회]`를 판정하거나 여행 전 일정 후보를 같이 검토하는 것입니다. 심사용 Public 링크는 레거시 단일 에이전트 앱으로 유지하고, 멀티에이전트 확장은 별도 앱으로 분리해 검증합니다.

## Ennoia 멀티에이전트 확장

- 멀티에이전트: `여행 관제팀 멀티 에이전트`
- 멀티에이전트 ID: `1ff5980a3d`
- 배포 버전: `v1 운영중`
- 연결 앱: `여행 관제팀 멀티`
- 앱 공유 상태: `공유 안 함`

이 확장 앱은 `여행 관제 오케스트레이터`와 14개 전문 에이전트 구조를 분리해서 보여주는 보조 검증용입니다. 현재 캔버스에서 `Start -> 여행 관제 오케스트레이터 -> 요청 해석 에이전트 -> 지역·장소 모호성 판별 에이전트` 기본 체인을 확인했고, 나머지 전문 노드는 같은 멀티에이전트 안에 등록해 후속 라우팅 확장 근거로 둡니다.

## Ennoia 커넥터

KTO 커넥터는 심사 검증의 중심입니다. 개인 KTO 서비스키는 Ennoia API 커넥터 안에 직접 등록되어야 하며, 외부 서버 호출만으로는 필수 조건 검증 근거가 약합니다.

현재 제출 앱에 연결한 커넥터:

- `한국관광공사 국문 관광정보 서비스 키워드 검색 조회`
- `KTO 행사정보 조회`
- `KTO 위치기반 관광조회`
- `KTO 공통정보 상세조회`
- `KTO 소개정보 상세조회`
- `날씨 예보 조회`
- `Kakao 장소 키워드 검색`
- `Kakao 주변 카테고리 검색`

제출서의 KTO OpenAPI 활용 서비스는 현재 확인 기준 `국문 관광정보 서비스`만 선택합니다. 다국어, 무장애, 관광사진, 고캠핑, 오디오 가이드, 빅데이터, 두루누비, 채용, 반려동물, 의료, 웰니스, 지역별 수요/다양성 계열 API는 아직 실제 Ennoia 커넥터로 사용하지 않았습니다.

Kakao Local은 주차장, 카페, 주변 실내 후보 확인용 보조 근거입니다. 현재 Ennoia 앱에서 실시간 교통 ETA, 도로 정체, 주차 가능 대수는 확인했다고 말하지 않습니다.

## 검증한 범용 시나리오 축

- 날짜 범위 기반 일정 검토: `6.23-25 부산 여행`처럼 기간과 지역을 받으면 KTO 행사정보 후보를 확인하고 일정에 넣을 만한 축제/공연/행사를 제안함.
- 장소명 모호성 처리: `중앙공원`처럼 여러 지역에 있는 이름은 KTO 복수 후보를 찾고, 날씨와 주변 대안을 단정하지 않으며 지역 확인을 요청함.
- 자가용/주차/주변 대안형 질의: `{관광지}` 자가용 방문에서 KTO 장소 매칭, 운영시간, 날씨, Kakao 주변 주차장/카페 후보를 함께 확인함.
- 야외+날씨 리스크형 질의: `{공원/해변/야외 관광지}` 방문에서 비/소나기 위험을 우회로 판정하고 실내 대안을 제시함.
- 운영시간/휴무 불확실성 처리: `{궁궐/박물관/전시관}` 상세정보가 부족하면 유지로 단정하지 않고 주의로 판정함.

상세 제출 전략과 테스트 로그는 [docs/ennoia-submission-realignment.md](/Users/kunwoopark/WS/prompton/docs/ennoia-submission-realignment.md)를 봅니다. 최신 제출 적합성 점검표는 [docs/submission-compliance-audit.md](/Users/kunwoopark/WS/prompton/docs/submission-compliance-audit.md), Notion 제출 폼 답안 초안은 [docs/final-submission-form-draft.md](/Users/kunwoopark/WS/prompton/docs/final-submission-form-draft.md), 14개 전문 에이전트 확장 설계는 [docs/ennoia-agent-expansion-plan.md](/Users/kunwoopark/WS/prompton/docs/ennoia-agent-expansion-plan.md), Studio에 붙여넣을 최종 프롬프트는 [docs/ennoia-studio-agent-prompt.md](/Users/kunwoopark/WS/prompton/docs/ennoia-studio-agent-prompt.md), 실제 반영 체크리스트는 [docs/ennoia-studio-apply-checklist.md](/Users/kunwoopark/WS/prompton/docs/ennoia-studio-apply-checklist.md)에 정리했습니다.

## 로컬 선택 데모

로컬 웹앱은 외부 선택 제출물 또는 서비스 확장 예시입니다. 일정 타임라인, 체크포인트, 우회안 적용, 자연어 일정 수정 흐름을 보여주는 보조 화면으로 사용합니다.

배포된 보조 데모: https://pockets-merely-brake-trainer.trycloudflare.com

보조 데모 상단에는 Ennoia 앱으로 이동하는 `Ennoia 앱 열기` 링크가 있습니다. 현재 공유 상태: `Public 공유 활성`이며, 링크는 최종 Ennoia 공유 URL을 가리킵니다.

```bash
sh scripts/dev.sh
```

브라우저에서 `http://localhost:8787`을 엽니다.

로컬 비밀값은 `.env`에 넣습니다. `.env`는 git에 올라가지 않습니다.

```bash
cp .env.example .env
```

실제 로컬 API 호출을 켜려면 서버 실행 전 환경변수를 설정합니다.

```bash
export KTO_SERVICE_KEY="..."
export KAKAO_REST_API_KEY="..."
export LIVE_WEATHER=1
sh scripts/dev.sh
```

로컬 환경변수는 보조 데모용입니다. 공모전 필수 검증을 위해서는 Ennoia Studio API 커넥터에 KTO 개인 인증키를 직접 등록해야 합니다.

## 테스트

```bash
sh scripts/test.sh
```

전체 MVP 흐름 검증:

```bash
sh scripts/verify-mvp.sh
```

최근 로컬 테스트 결과: `sh scripts/test.sh` 기준 100개 통과, 0개 실패.

## Ennoia 자연어 일정 수정 연결

로컬 선택 데모의 자연어 일정 수정은 Ennoia LLM을 우선 호출하고, 설정이 없거나 실패하면 규칙 기반 fallback으로 동작합니다.

```bash
export ENNOIA_NATURAL_EDIT_ENDPOINT="https://api.ennoia.so/api/preset/v2/chat/completions"
export ENNOIA_NATURAL_EDIT_HASH="<editAgentHash>"
export ENNOIA_NATURAL_EDIT_TIMEOUT_MS=60000
export ENNOIA_NATURAL_EDIT_CHAT_WAIT_MS=60000
export ENNOIA_NATURAL_EDIT_LOCAL_SEARCH_BUDGET_MS=1000
export ENNOIA_API_KEY="..."
sh scripts/dev.sh
```

서버는 Ennoia 응답을 그대로 적용하지 않고 현재 플래너에 존재하는 `targetItemId`인지 확인한 뒤, 허용된 patch 필드만 반영합니다. 자연어 수정은 Ennoia Studio에 설정된 수정 에이전트가 질문/수정/추가질문을 먼저 판단하고, `ENNOIA_NATURAL_EDIT_CHAT_WAIT_MS` 안에 응답하지 못하거나 호출이 실패할 때만 로컬 fallback 초안을 반환합니다. API 키와 원문 JSON은 사용자 화면에 노출하지 않습니다.

자연어 수정 에이전트에 MCP 툴이 연결되어 있으면 Ennoia API가 MCP 연결 소유자를 알아야 합니다. 운영 환경에는 아래 중 하나를 추가로 설정합니다.

```bash
# Ennoia Studio에서 한국관광공사 MCP 연결을 보유한 사용자 id를 전달하는 방식
export ENNOIA_NATURAL_EDIT_USER_ID="<ennoiaUserId>"

# 또는 Ennoia가 안내하는 정확한 MCP 인증 헤더명을 명시하는 방식
export ENNOIA_NATURAL_EDIT_MCP_AUTHORIZATION_HEADER="x-mcp-<serverAlias>-authorization"
export ENNOIA_NATURAL_EDIT_MCP_AUTHORIZATION="<mcpAuthToken>"
```

이 값이 없으면 Ennoia는 `MCP_CONNECTION_REQUIRED`를 반환하고, 앱은 로컬 안전 답변/초안으로 fallback합니다.

## 로컬 저장

플래너 상태는 `data/app-state.json`에 저장됩니다. 이 파일은 사용자가 만든 일정, 점검 기록, 앱 안 알림, 푸시 구독 준비 정보를 담습니다. 공공데이터 API 응답 원문이나 API 키는 저장하지 않습니다.

테스트나 임시 실행에서 저장 파일을 바꾸려면:

```bash
STATE_FILE=/tmp/travel-ops-state.json sh scripts/dev.sh
```

저장을 끄려면:

```bash
DISABLE_FILE_STORE=1 sh scripts/dev.sh
```
