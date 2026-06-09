# Final Submission Form Draft

작성일: 2026-06-08 KST

이 문서는 Notion 제출 폼에 옮겨 적을 최종 답안 초안이다. 비밀값은 저장소에 쓰지 않는다. KTO 신청자명과 개인 서비스 인증키는 제출 폼에 직접 입력하고, 이 파일에는 placeholder만 둔다.

## 1. Ennoia 앱 공유 URL

최종 제출값:

```text
https://ennoia.so/apps/openLink/d4c56c7f9185453f8851f8989a8aac9c
```

기존 로그인 앱 경로:

```text
https://ennoia.so/apps/chat/37fb7a3c03-KNTO-PROMPTON-2026-544-14954156ab
```

검증 상태:

- 2026-06-08 18:25 KST 기준 Public 공유 링크 생성 완료.
- 세션당 턴 수: 50.
- 최대 사용자 수: 100명.
- 익명/로그아웃 브라우저에서 로그인 페이지로 리다이렉트되지 않고 `여행 상황 점검` 앱 화면이 바로 열림을 확인했다.
- Public 공유 링크에서 부산 2박 3일 추천 질문 실행 시 `[일정 검토]`, `광안리 M(Marvelous) 드론 라이트쇼`, `API 확인 상태`가 포함된 응답을 확인했다.
- 해당 응답에서 서비스키, 원문 API URL, 원문 JSON 노출은 확인되지 않았다.
- 이 URL을 필수 제출 1번 Ennoia 앱 공유 URL로 사용한다.

공유 링크 생성 후 반영 상태:

1. 시크릿/로그아웃 브라우저에서 최종 공유 URL 접근 확인 완료.
2. [app/main.js](/Users/kunwoopark/WS/prompton/app/main.js)의 `ENNOIA_APP_URL`을 최종 공유 URL로 교체 완료.
3. [index.html](/Users/kunwoopark/WS/prompton/index.html)과 [sw.js](/Users/kunwoopark/WS/prompton/sw.js)의 정적 자산 버전 bump 완료.
4. `sh scripts/test.sh` 실행 후 rpi 재배포 완료.
5. `https://pockets-merely-brake-trainer.trycloudflare.com` 상단의 `Ennoia 앱 열기` 링크가 최종 공유 URL을 가리키는지 확인 완료.

## 2. 서비스 소개서

제출 폼에 문서 또는 설명을 넣을 수 있다면 아래 요약을 사용한다.

```text
서비스명: 여행 상황 점검

한 줄 소개:
여행 일정의 날짜, 지역, 장소, 이동 맥락을 받아 한국관광공사 관광정보/행사정보, 날씨, 주변 장소 정보를 함께 확인하고 유지/주의/우회 판단과 일정 후보를 제안하는 Ennoia Studio 기반 여행 검토 앱입니다.

핵심 가치:
단순 관광 추천이 아니라 여행 전 일정 검토와 여행 중 상황 점검을 한 화면에서 처리합니다. 예를 들어 "6월 23일부터 25일까지 부산 여행"처럼 기간과 지역을 입력하면 KTO 행사정보와 관광정보를 확인해 일정에 넣을 만한 행사 후보를 제안하고, "서울숲 산책인데 비가 오면?"처럼 장소와 시간 조건을 주면 날씨와 주변 실내 대안을 근거로 유지/주의/우회를 판단합니다.

주요 기능:
1. 여행 전 일정 검토: 날짜 범위와 지역을 해석하고 KTO 행사정보, 관광정보 후보를 확인합니다.
2. 여행 중 상황 점검: 장소, 방문 시간, 이동수단을 기준으로 운영정보, 날씨, 주변 대안을 점검합니다.
3. 장소 모호성 처리: "중앙공원"처럼 복수 후보가 있는 이름은 임의로 확정하지 않고 지역 확인을 요청합니다.
4. 자가용/주차 보조: KTO 장소 매칭 후 Kakao Local로 주변 주차장과 카페 후보를 보조 확인합니다.
5. API 상태 표시: KTO, 날씨, Kakao 호출 결과를 성공/부분 성공/실패/미사용으로 분리해 과장하지 않습니다.

제출 중심:
필수 제출의 중심은 Ennoia Studio 앱 "여행 상황 점검"입니다. 외부 웹 데모는 선택 제출용 확장 화면이며, 일정 타임라인과 체크포인트 UX를 보조로 보여줍니다.
```

상세 문서:

- [ennoia-submission-realignment.md](/Users/kunwoopark/WS/prompton/docs/ennoia-submission-realignment.md)
- [submission-compliance-audit.md](/Users/kunwoopark/WS/prompton/docs/submission-compliance-audit.md)
- [ennoia-studio-agent-prompt.md](/Users/kunwoopark/WS/prompton/docs/ennoia-studio-agent-prompt.md)

## 3. KTO OpenAPI 신청자명

최종 제출값:

```text
[KTO OpenAPI 계정의 신청자명]
```

확인 기준:

- Ennoia API 커넥터에 등록한 KTO 개인 서비스키의 계정 정보와 동일해야 한다.
- 저장소 문서나 코드에는 신청자명/서비스키를 남기지 않는다.

## 4. KTO OpenAPI 개인 서비스 인증키

최종 제출값:

```text
[Ennoia API 커넥터에 등록한 KTO 개인 서비스 인증키]
```

주의:

- 제출 폼에만 직접 입력한다.
- README, docs, 코드, 테스트 로그, 스크린샷에는 원문 키를 남기지 않는다.
- Ennoia 앱 답변에도 서비스키, 원문 URL, 원문 JSON, 내부 프롬프트가 노출되지 않아야 한다.

## 5. KTO OpenAPI 활용 서비스

제출 폼에서 선택할 서비스:

```text
국문 관광정보 서비스
```

실제 확인한 KTO 계열 커넥터:

- `한국관광공사 국문 관광정보 서비스 키워드 검색 조회` / `KorService2/searchKeyword2`
- `KTO 행사정보 조회` / `KorService2/searchFestival2`
- `KTO 위치기반 관광조회` / `KorService2/locationBasedList2`
- `KTO 공통정보 상세조회` / `KorService2/detailCommon2`
- `KTO 소개정보 상세조회` / `KorService2/detailIntro2`

선택하지 않을 서비스:

- 영문 관광정보 서비스
- 일문 관광정보 서비스
- 중문 간체 관광정보 서비스
- 중문 번체 관광정보 서비스
- 독어 관광정보 서비스
- 불어 관광정보 서비스
- 서어 관광정보 서비스
- 노어 관광정보 서비스
- 무장애 여행 정보 서비스
- 관광사진 정보 서비스
- 고캠핑 정보 조회 서비스
- 관광지 오디오 가이드 정보 서비스
- 관광 빅데이터 정보 서비스
- 두루누비 정보 서비스
- 관광인 채용 정보 서비스
- 반려동물 동반여행 서비스
- 기초지자체 중심관광지 정보 서비스
- 관광지별 연관관광지 정보 서비스
- 관광지 집중률 방문자 추이 예측 정보 서비스
- 의료 관광정보 서비스
- 웰니스 관광정보 서비스
- 관광공모전(사진) 수상작 정보 서비스
- 지역별 관광 다양성 정보 서비스
- 지역별 관광 수요 강도 정보 서비스
- 지역별 관광 자원 수요 정보 서비스

선택하지 않는 이유:

```text
현재 Ennoia Studio 앱에 실제 연결되어 검증한 KTO 커넥터는 KorService2 계열 국문 관광정보 서비스다. 다국어, 무장애, 사진, 고캠핑, 빅데이터, 두루누비, 반려동물, 의료/웰니스, 수요 정보 계열은 실제 앱 커넥터로 사용 확인하지 않았으므로 제출서에는 선택하지 않는다.
```

## 선택 제출 URL

보조 웹 데모:

```text
https://pockets-merely-brake-trainer.trycloudflare.com
```

설명:

```text
Ennoia Studio 앱의 핵심 판단 흐름을 보조로 보여주는 선택 제출용 확장 화면입니다. 일정 타임라인, 체크포인트, 자연어 일정 수정, 우회안 적용 UX를 시연합니다. 필수 심사 기능은 Ennoia Studio 앱 공유 URL에서 확인합니다.
```

## 제출 직전 검증 질문

Ennoia 앱 공유 URL에서 아래 질문을 새 대화로 실행한다.

```text
6월 23일부터 25일까지 부산으로 2박 3일 여행을 가려고 해. KTO 행사정보까지 확인해서 일정에 넣을 만한 축제나 행사가 있으면 같이 제안해줘.
```

```text
내일 오후 2시에 서울숲에서 산책하려고 해. 비가 오면 근처 실내 대안으로 우회해야 할지 판단해줘.
```

```text
내일 오후 1시에 수원 화성행궁을 자가용으로 가려고 해. 주차와 주변 대체 코스까지 같이 점검해줘.
```

```text
내일 오후 3시에 중앙공원에 가려고 해. 어느 지역인지 애매하면 어떻게 판단하는지 보여줘.
```

통과 기준:

- 부산 일정 질문에서 `[일정 검토]` 형식과 KTO 행사정보 후보가 나온다.
- 서울숲 질문에서 날씨와 실내 대안을 근거로 유지/주의/우회를 판단한다.
- 수원 화성행궁 질문에서 KTO 장소 매칭과 Kakao 주차장 후보를 분리한다.
- 중앙공원 질문에서 복수 후보를 임의로 하나로 확정하지 않는다.
- 모든 응답에서 API 상태가 성공/부분 성공/실패/미사용으로 분리된다.
- 서비스키, 원문 API URL, 원문 JSON, 내부 프롬프트가 노출되지 않는다.

## 현재 남은 제출 입력

```text
KTO OpenAPI 신청자명과 개인 서비스 인증키는 제출 폼에만 직접 입력한다.
```

공유 URL, 서비스 소개, 활용 API 목록은 이 문서 기준으로 입력하면 된다. 비밀키 원문은 코드, 문서, 테스트 로그에 남기지 않는다.
