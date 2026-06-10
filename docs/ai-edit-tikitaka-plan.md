# AI 일정 수정 고도화 계획 — 멀티턴 티키타카 + KTO MCP

> 방향: **KTO MCP 연결**로 정보 정확도 강화, **대화 오케스트레이션은 Ennoia LLM 에이전트에 위임**.
> 목표: 한 번에 끝나는 단발 수정에서, 도메인(식사·관광지·카페·이동·시간)별로 되묻고 선택·조율하는 대화형 수정으로 전환.

---

## 1. 현재 구조와 한계

**흐름 (단발성)**

```
사용자 입력 → POST /api/natural-edits → ennoiaNaturalEditService
  → Ennoia LLM 엔드포인트(messages 1개) → draft(patch + recommendations)
  → 실패 시 scheduleEditAgent(규칙 기반) fallback
  → 프론트 pendingDraft 1개 렌더 → 추천 선택 → /api/natural-edits/apply
```

**핵심 한계**

| 영역 | 현재 | 문제 |
|---|---|---|
| 대화 상태 | `/api/natural-edits`가 매 호출 무상태. `text` + 현재 `items`만 전송 | 이전 발화·선택을 기억 못 함 → 티키타카 불가 |
| 되묻기 | `needsClarification` + `question` 단일 필드 | 한 번 되묻고 끝. 누적된 슬롯을 못 채움 |
| 도메인 분기 | `scheduleEditAgent.js`의 하드코딩 `PLACE_QUERIES` 키워드 매칭 | 식사/관광지 외 확장 어렵고, 도메인별 후속 질문 없음 |
| 장소 정확도 | KTO OpenAPI(`touristSearchService`) + Kakao(`placeSearchService`) **코드 직접 호출** | LLM이 대화 맥락에 맞춰 능동적으로 조회·재질의 못 함 |
| 프론트 | `pendingDraft` 1개 + draft-zone | 대화 스레드가 아니라 단일 결과창 |

---

## 2. 목표 아키텍처

```
┌─ 프론트(app/main.js) ─ 대화 스레드 UI ─────────────┐
│  messages[] (user/assistant/choice)               │
│  선택 칩 · 슬롯 요약 · 추천 카드                      │
└───────────────┬───────────────────────────────────┘
                │ POST /api/natural-edits  { sessionId, text, items }
┌───────────────▼───────────────────────────────────┐
│ Node 서버                                          │
│  · 대화 세션 스토어(sessionId → messages[] + slots) │
│  · 누적 messages를 Ennoia에 전달                    │
└───────────────┬───────────────────────────────────┘
                │ messages[](history 포함)
┌───────────────▼───────────────────────────────────┐
│ Ennoia LLM 에이전트 (ennoia.so studio에서 구성)     │
│  · 시스템 프롬프트: 도메인 분류 + 슬롯필링 + 되묻기   │
│  · Tool: 한국관광공사 MCP (관광지/맛집/실시간 조회)   │
│  · 출력: needsClarification | choices | draft       │
└────────────────────────────────────────────────────┘
```

핵심 변경 3가지:
1. **대화 세션을 Node가 보관**하고 누적 `messages`를 Ennoia에 넘긴다 (위임하더라도 history 전달은 우리 몫).
2. **Ennoia 에이전트에 KTO MCP를 툴로 연결**해, LLM이 필요할 때 관광정보를 직접 조회·재질의한다.
3. **응답 스키마를 도메인-슬롯 기반으로 확장**해 도메인별 되묻기/선택지를 표준화한다.

---

## 3. 단계별 구현 계획

### Phase 0 — KTO MCP 연결 (ennoia.so studio)
- studio MCP 서버 관리에서 이미 등록된 **한국관광공사 MCP**를 해당 자연어수정 에이전트(`KNTO-PROMPTON-2026-544`)의 **Tool로 연결**.
- 노출할 오퍼레이션 정리: 키워드 검색(searchKeyword), 위치기반 검색(locationBasedList), 상세조회(detailCommon/detailIntro — 영업시간·휴무·입장료 등).
- 에이전트가 MCP를 호출하도록 시스템 프롬프트에 "장소·관광지 정보는 반드시 MCP 툴로 조회 후 좌표·주소를 patch에 채운다" 규칙 추가.
- ✅ 산출물: MCP가 붙은 에이전트 hash/endpoint. (`.env`의 `ENNOIA_NATURAL_EDIT_ENDPOINT`/`HASH` 갱신)

### Phase 1 — 서버: 대화 세션 도입
- `server/store.js`에 `conversations` 맵 추가: `sessionId → { messages:[], slots:{}, draft, updatedAt }`.
- `server/index.js`의 `POST /api/natural-edits`:
  - 요청에 `sessionId` 받기(없으면 생성해 응답에 반환).
  - 세션 messages에 user turn append → `draftNaturalLanguageEditWithEnnoia(...)` 호출 시 **history 전체 전달**.
  - 응답(assistant turn: 되묻기/선택지/draft)을 세션에 append.
- 세션 TTL/리셋: 일정 적용 완료 또는 30분 무활동 시 정리. (statePersistence 패턴 재사용)
- ✅ 산출물: 무상태 → 세션 기반 멀티턴.

### Phase 2 — Ennoia 요청/응답 스키마 확장
- `ennoiaNaturalEditService.js`의 `buildEnnoiaRequest`:
  - 단일 user 메시지 → **누적 messages 배열** 전달.
  - 시스템 프롬프트에 도메인-슬롯 정의 추가:
    - `meal`: 음식종류 · 인원 · 예산대 · 분위기 · 시간대
    - `attraction`: 실내/야외 · 테마(역사/자연/체험) · 소요시간 · 동행(아이/연인)
    - `cafe`: 디저트/브런치 · 분위기 · 영업시간
    - `transport`/`time`: 이동수단 · 출발/도착 시각
  - 응답 스키마에 필드 추가:
    ```jsonc
    {
      "stage": "clarify | propose | confirm",
      "domain": "meal | attraction | cafe | transport | time",
      "filledSlots": { ... },
      "missingSlots": ["budget", "headcount"],
      "question": "되묻는 문장",
      "choices": [ { "id", "label", "value" } ],   // 선택 칩
      "recommendations": [ ... 기존 구조 ... ],
      "patch": { ... },
      "needsClarification": bool,
      "needsConfirmation": bool
    }
    ```
- `sanitizeDraft`/`normalizeRecommendations`에 `stage`·`domain`·`choices` 정규화 추가. 기존 `patch`/`recommendations` 호환 유지.
- ✅ 산출물: 도메인 인지형 되묻기·선택지 표준 응답.

### Phase 3 — 프론트: 대화 스레드 UI
- `app/main.js`:
  - `pendingDraft`(단일) → `chatMessages[]`(스레드)로 전환. 각 메시지: `{ role, text, choices?, recommendations?, draft? }`.
  - `requestNaturalDraft`에 `sessionId` 동봉, 응답을 스레드에 append.
  - `stage`에 따라 렌더 분기:
    - `clarify` → 질문 + **선택 칩**(탭하면 그 값으로 다음 턴 전송) + 자유 입력
    - `propose` → 추천 카드(기존 `draft-recommendation` 재사용)
    - `confirm` → 확정 버튼
  - 선택 칩 클릭 = 그 라벨을 user turn으로 전송하는 핸들러(`apply-choice`).
  - 슬롯 요약 바("한식 · 4인 · 2만원대") 상단 표시로 조율 맥락 노출.
- `app/styles.css`: 말풍선·칩 스타일 추가.
- ✅ 산출물: 묻고-선택하고-조율하는 대화창.

### Phase 4 — fallback 정합성
- `scheduleEditAgent.js`(규칙 기반 fallback)도 새 스키마 형태로 최소 응답(`stage:"propose"`)을 내도록 래핑. MCP/Ennoia 장애 시에도 단발 추천은 동작.
- ✅ 산출물: 장애 시 graceful degradation.

### Phase 5 — 검증
- 단위: `tests/`에 세션 누적·슬롯필링·스키마 정규화 케이스 추가.
- 시나리오(수동/통합):
  1. "저녁 바꿔줘" → 도메인=meal, 음식종류 되묻기 → "한식" 선택 → 예산 되묻기 → 추천 → 확정
  2. "둘째날 오후에 관광지 넣어줘" → 실내/야외 되묻기 → MCP 조회 추천 → 확정
  3. MCP 다운 시 fallback 추천 정상
- MCP 응답의 좌표/주소가 patch에 정확히 반영되는지 확인(거리 보정 `rescueDistantPlaceDraft` 회귀 체크).
- ✅ 산출물: 회귀 없는 멀티턴 동작 확인.

---

## 4. 변경 파일 요약

| 파일 | 변경 |
|---|---|
| ennoia.so studio | 에이전트에 KTO MCP 툴 연결, 시스템 프롬프트 갱신 |
| `.env` | MCP 붙은 에이전트 endpoint/hash 갱신 |
| `server/store.js` | `conversations` 세션 스토어 추가 |
| `server/index.js` | `/api/natural-edits`에 sessionId·history 처리 |
| `server/ennoiaNaturalEditService.js` | messages 누적 전달, 도메인-슬롯 프롬프트/스키마 확장, sanitize 확장 |
| `server/scheduleEditAgent.js` | fallback을 새 스키마로 래핑 |
| `app/main.js` | 단일 draft → 대화 스레드, 선택 칩, 슬롯 요약 |
| `app/styles.css` | 말풍선·칩 스타일 |
| `tests/` | 세션·슬롯·스키마 테스트 |

---

## 5. 리스크 & 결정 필요

- **MCP 레이턴시**: LLM이 MCP를 여러 번 호출하면 응답 지연. `ENNOIA_NATURAL_EDIT_TIMEOUT_MS`는 30s 기준으로 올렸고, 스트리밍 중 "조회 중" 표시가 있으면 더 자연스럽다.
- **세션 저장소**: 현재 인메모리 store 기준. 다중 인스턴스/재시작 대비가 필요하면 `statePersistence`처럼 디스크/DB 백업 고려.
- **MCP 권한 범위**: 어떤 KTO 오퍼레이션까지 에이전트에 노출할지(상세 영업시간 포함 여부) 확정 필요.
- **되묻기 횟수 상한**: 무한 되묻기 방지 위해 도메인당 최대 2~3턴 후 추천 강제 전환 규칙 권장.

---

## 6. 권장 진행 순서

Phase 0(MCP 연결) → Phase 1(세션) → Phase 2(스키마) → Phase 3(UI) 가 의존 사슬의 핵심.
**최소 동작 데모는 Phase 0~3까지**면 "식사면 식사, 관광지면 관광지"로 되묻고 선택하는 티키타카가 작동합니다. Phase 4~5는 안정화 단계.
