# 여행 관제형 웹앱 MVP

여행 일정을 타임라인으로 관리하고, 체크포인트마다 일정 상태를 `유지`, `주의`, `우회`로 판단하는 로컬 MVP입니다. 프론트엔드와 백엔드는 외부 패키지 없이 Node.js 내장 서버로 동작합니다.

## 실행

```bash
sh scripts/dev.sh
```

브라우저에서 `http://localhost:8787`을 엽니다.

로컬 비밀값은 `.env`에 넣습니다. `.env`는 git에 올라가지 않습니다.

```bash
cp .env.example .env
```

## 테스트

```bash
sh scripts/test.sh
```

전체 MVP 흐름 검증:

```bash
sh scripts/verify-mvp.sh
```

## 현재 구현 범위

- 여행 일정 생성, 삭제, 타임라인 표시
- 여행 일정 수정 및 서버 재시작 후 상태 복구
- 일정별 60분 전, 30분 전, 이동 직전 체크포인트 계산
- 특정 일정 또는 전체 일정 점검
- `유지`, `주의`, `우회` 상태 저장
- 위험 판정 시 앱 안 알림 생성
- 우회안 적용 시 해당 일정만 수정
- 자연어 일정 수정 초안 생성 및 적용
- 일정 추가 버튼의 AI 우선 자연어 추가/수정 흐름
- 변경된 일정과 다음 1~2개 일정 재점검 구조
- 여행기록 데이터 저장
- PWA 매니페스트, 서비스 워커, 푸시 구독 저장 모델

## 외부 API 연결

기본 실행은 데모 fallback으로 동작합니다. 실제 호출을 켜려면 서버 실행 전 환경변수를 설정합니다.

```bash
export KTO_SERVICE_KEY="..."
export KAKAO_REST_API_KEY="..."
export LIVE_WEATHER=1
sh scripts/dev.sh
```

- KTO 데이터는 서버에서 호출하고 캐싱하지 않습니다.
- Kakao Local은 장소 매칭과 주변 대안 확인에 사용합니다.
- 날씨는 `LIVE_WEATHER=1`일 때 Open-Meteo 실시간 예보를 호출합니다.
- API 키와 원문 JSON은 사용자 화면에 노출하지 않습니다.

## Ennoia 자연어 일정 수정 연결

자연어 일정 수정은 Ennoia LLM을 우선 호출하고, 설정이 없거나 실패하면 규칙 기반 fallback으로 동작합니다.

```bash
export ENNOIA_NATURAL_EDIT_ENDPOINT="https://api.ennoia.so/api/preset/v2/chat/completions"
export ENNOIA_NATURAL_EDIT_HASH="<editAgentHash>"
export ENNOIA_NATURAL_EDIT_TIMEOUT_MS=20000
export ENNOIA_API_KEY="..."
sh scripts/dev.sh
```

Ennoia Studio에는 `여행 일정 수정 에이전트`를 배포하고, 해당 에이전트 기반의 `여행 일정 수정` 앱을 연결합니다. 자연어 수정 에이전트는 Kakao 장소 키워드 검색 커넥터를 사용하며 아래 JSON만 반환하도록 구성합니다.

```json
{
  "operation": "update",
  "targetItemId": "dinner",
  "intent": "replace_meal",
  "confidence": 0.92,
  "patch": {
    "title": "삼겹살 저녁",
    "placeName": "성수 삼겹살",
    "category": "meal",
    "memo": "사용자 요청으로 삼겹살 중심 저녁 변경"
  },
  "alternatives": [],
  "resolutionMessage": "",
  "needsConfirmation": true,
  "needsClarification": false,
  "confirmationMessage": "비빔밥 저녁을 삼겹살 저녁으로 바꿀까요?"
}
```

서버는 Ennoia 응답을 그대로 적용하지 않고 현재 플래너에 존재하는 `targetItemId`인지 확인한 뒤, 허용된 patch 필드만 반영합니다. `operation`이 `add`일 때만 새 일정을 1개 추가합니다. Ennoia가 수정 대상을 못 잡거나 설정이 없거나 실패하거나 `ENNOIA_NATURAL_EDIT_TIMEOUT_MS` 안에 응답하지 않으면 일정수정 에이전트 fallback이 Kakao Local 장소 검색을 시도하고, 정확 후보가 없으면 유사 후보 또는 일반 장소명으로 대체했다는 안내를 draft에 포함합니다.

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
