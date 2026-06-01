import assert from "node:assert/strict";
import test from "node:test";
import { draftScheduleEditWithAgent } from "../server/scheduleEditAgent.js";

const items = [
  {
    id: "d1-lunch",
    title: "연경 차이나타운본점 점심",
    placeName: "연경 차이나타운본점",
    address: "인천 중구 차이나타운로 41",
    lat: 37.4759,
    lng: 126.6191,
    startsAt: "2026-06-27T13:00:00+09:00",
    endsAt: "2026-06-27T14:00:00+09:00",
    transportMode: "walk",
    travelMinutesBefore: 10,
    category: "meal",
    memo: "중식",
    status: "unchecked"
  },
  {
    id: "d1-dinner",
    title: "맥도날드 저녁",
    placeName: "맥도날드 인천월미도점",
    address: "인천 중구 월미문화로 43",
    lat: 37.4713,
    lng: 126.5989,
    startsAt: "2026-06-27T18:30:00+09:00",
    endsAt: "2026-06-27T19:20:00+09:00",
    transportMode: "walk",
    travelMinutesBefore: 10,
    category: "meal",
    memo: "간단 식사",
    status: "unchecked"
  },
  {
    id: "d2-museum",
    title: "개항장 박물관 관람",
    placeName: "인천개항박물관",
    address: "인천 중구 신포로23번길 89",
    lat: 37.4735,
    lng: 126.6218,
    startsAt: "2026-06-28T10:00:00+09:00",
    endsAt: "2026-06-28T11:00:00+09:00",
    transportMode: "walk",
    travelMinutesBefore: 15,
    category: "indoor",
    memo: "역사 체험",
    status: "unchecked"
  }
];

test("draftScheduleEditWithAgent replaces only the first-day lunch meal with a Korean food candidate", async () => {
  const calls = [];
  const draft = await draftScheduleEditWithAgent({
    text: "첫날 점심 중식인데 한식으로 바꿀래",
    items,
    mode: "update",
    searchPlaces: async (request) => {
      calls.push(request);
      return {
        source: "kakao",
        status: "ok",
        items: [
          {
            id: "korean-1",
            name: "개항로 한식당",
            address: "인천 중구 개항로 12",
            lat: 37.4761,
            lng: 126.6201,
            distanceMeters: 220,
            distanceLabel: "220m",
            placeUrl: "https://place.map.kakao.com/korean-1",
            category: "place"
          }
        ],
        message: "Kakao Local 장소 검색 완료"
      };
    }
  });

  assert.equal(calls[0].query, "한식");
  assert.equal(calls[0].lat, items[0].lat);
  assert.equal(draft.operation, "update");
  assert.equal(draft.targetItemId, "d1-lunch");
  assert.equal(draft.patch.placeName, "개항로 한식당");
  assert.equal(draft.patch.startsAt, items[0].startsAt);
  assert.equal(draft.patch.endsAt, items[0].endsAt);
  assert.equal(draft.patch.category, "meal");
  assert.match(draft.confirmationMessage, /연경 차이나타운본점 점심/);
});

test("draftScheduleEditWithAgent falls back from a missing exact restaurant to a similar dumpling place", async () => {
  const calls = [];
  const draft = await draftScheduleEditWithAgent({
    text: "이 위치 맥도날드 추천해줬는데 이곳은 송월만두를 점심에 먹는게 유명하다고 그러는데 수정할래",
    items,
    mode: "add_or_update",
    searchPlaces: async (request) => {
      calls.push(request);
      if (request.query === "송월만두") {
        return { source: "kakao", status: "empty", items: [], message: "결과 없음" };
      }
      return {
        source: "kakao",
        status: "ok",
        items: [
          {
            id: "mandu-1",
            name: "월미만두",
            address: "인천 중구 월미문화로 55",
            lat: 37.4718,
            lng: 126.5995,
            distanceMeters: 160,
            distanceLabel: "160m",
            placeUrl: "https://place.map.kakao.com/mandu-1",
            category: "place"
          }
        ],
        message: "Kakao Local 장소 검색 완료"
      };
    }
  });

  assert.deepEqual(calls.map((call) => call.query), ["송월만두", "만두"]);
  assert.equal(draft.operation, "update");
  assert.equal(draft.targetItemId, "d1-dinner");
  assert.equal(draft.patch.placeName, "월미만두");
  assert.match(draft.resolutionMessage, /송월만두.*못 찾/);
  assert.match(draft.resolutionMessage, /만두/);
});

test("draftScheduleEditWithAgent drafts an add operation when add mode has no existing target", async () => {
  const draft = await draftScheduleEditWithAgent({
    text: "둘째날 점심에 한식집 하나 추가해줘",
    items,
    mode: "add_or_update",
    activeDate: "2026-06-28",
    searchPlaces: async () => ({
      source: "kakao",
      status: "ok",
      items: [
        {
          id: "korean-2",
          name: "신포 한식",
          address: "인천 중구 신포로 20",
          lat: 37.4729,
          lng: 126.623,
          distanceMeters: 300,
          distanceLabel: "300m",
          placeUrl: "https://place.map.kakao.com/korean-2",
          category: "place"
        }
      ],
      message: "Kakao Local 장소 검색 완료"
    })
  });

  assert.equal(draft.operation, "add");
  assert.equal(draft.targetItemId, undefined);
  assert.equal(draft.patch.placeName, "신포 한식");
  assert.equal(draft.patch.startsAt, "2026-06-28T12:00:00+09:00");
  assert.equal(draft.patch.endsAt, "2026-06-28T13:00:00+09:00");
  assert.match(draft.confirmationMessage, /새 일정/);
});

test("draftScheduleEditWithAgent returns clickable Kakao recommendations with apply-ready patches", async () => {
  const draft = await draftScheduleEditWithAgent({
    text: "둘째날 점심에 한식집 하나 추가해줘",
    items,
    mode: "add_or_update",
    activeDate: "2026-06-28",
    searchPlaces: async () => ({
      source: "kakao",
      status: "ok",
      items: [
        {
          id: "korean-2",
          name: "신포 한식",
          address: "인천 중구 신포로 20",
          lat: 37.4729,
          lng: 126.623,
          distanceMeters: 300,
          distanceLabel: "300m",
          placeUrl: "https://place.map.kakao.com/korean-2",
          category: "place"
        },
        {
          id: "korean-3",
          name: "개항로 밥상",
          address: "인천 중구 개항로 30",
          lat: 37.4733,
          lng: 126.6227,
          distanceMeters: 360,
          distanceLabel: "360m",
          placeUrl: "https://place.map.kakao.com/korean-3",
          category: "place",
          categoryDetail: "음식점 > 한식"
        },
        {
          id: "korean-4",
          name: "신포 백반",
          address: "인천 중구 신포로 31",
          lat: 37.4734,
          lng: 126.6224,
          distanceMeters: 390,
          distanceLabel: "390m",
          placeUrl: "https://place.map.kakao.com/korean-4",
          category: "place"
        }
      ],
      message: "Kakao Local 장소 검색 완료"
    })
  });

  assert.equal(draft.recommendations.length, 3);
  assert.equal(draft.recommendations[0].source, "kakao");
  assert.equal(draft.recommendations[0].name, "신포 한식");
  assert.equal(draft.recommendations[0].patch.placeName, "신포 한식");
  assert.equal(draft.recommendations[1].patch.placeName, "개항로 밥상");
  assert.equal(draft.recommendations[2].patch.startsAt, "2026-06-28T12:00:00+09:00");
  assert.deepEqual(draft.patch, draft.recommendations[0].patch);
  assert.equal(new Set(draft.recommendations.map((recommendation) => recommendation.id)).size, 3);
});

test("draftScheduleEditWithAgent treats explicit add wording as add even when a meal slot exists", async () => {
  const draft = await draftScheduleEditWithAgent({
    text: "점심에 한식집 하나 추가해줘",
    items,
    mode: "add_or_update",
    activeDate: "2026-06-27",
    searchPlaces: async () => ({
      source: "fallback",
      status: "missing-key",
      items: [],
      message: "Kakao Local API 키가 없어 일반 장소명으로 임시 제안합니다."
    })
  });

  assert.equal(draft.operation, "add");
  assert.equal(draft.targetItemId, undefined);
  assert.equal(draft.patch.placeName, "근처 한식당");
  assert.match(draft.confirmationMessage, /새 일정/);
});

test("draftScheduleEditWithAgent uses KTO first when adding a tourist attraction", async () => {
  const ktoCalls = [];
  const kakaoCalls = [];
  const draft = await draftScheduleEditWithAgent({
    text: "둘째날 오후에 역사 관광지 하나 추가해줘",
    items,
    mode: "add_or_update",
    activeDate: "2026-06-28",
    searchPlaces: async (request) => {
      kakaoCalls.push(request);
      return { source: "kakao", status: "empty", items: [], message: "Kakao 호출됨" };
    },
    searchTouristPlaces: async (request) => {
      ktoCalls.push(request);
      return {
        source: "kto",
        status: "ok",
        items: [
          {
            id: "kto-1",
            name: "인천개항장문화지구",
            address: "인천 중구 신포로27번길 80",
            lat: 37.4728,
            lng: 126.6216,
            distanceMeters: 90,
            distanceLabel: "90m",
            placeUrl: "https://korean.visitkorea.or.kr/detail/ms_detail.do?cotid=kto-1",
            category: "관광지",
            categoryDetail: "역사관광지"
          }
        ],
        message: "KTO 관광정보 검색 완료"
      };
    }
  });

  assert.equal(kakaoCalls.length, 0);
  assert.equal(ktoCalls.length, 1);
  assert.equal(ktoCalls[0].query, "역사 관광지");
  assert.equal(ktoCalls[0].lat, items[2].lat);
  assert.equal(draft.operation, "add");
  assert.equal(draft.intent, "add_place");
  assert.equal(draft.patch.placeName, "인천개항장문화지구");
  assert.equal(draft.patch.category, "outdoor");
  assert.equal(draft.patch.startsAt, "2026-06-28T14:00:00+09:00");
  assert.equal(draft.patch.endsAt, "2026-06-28T15:30:00+09:00");
  assert.equal(draft.source, "agent");
  assert.match(draft.modelStatus, /KTO/);
  assert.match(draft.patch.memo, /KTO 관광정보/);
});

test("draftScheduleEditWithAgent uses KTO when replacing an existing tourist attraction", async () => {
  const ktoCalls = [];
  const draft = await draftScheduleEditWithAgent({
    text: "둘째날 박물관 말고 역사 관광지로 바꿔줘",
    items,
    mode: "update",
    activeDate: "2026-06-28",
    searchPlaces: async () => {
      throw new Error("관광지 수정은 Kakao 검색을 먼저 쓰면 안 됩니다.");
    },
    searchTouristPlaces: async (request) => {
      ktoCalls.push(request);
      return {
        source: "kto",
        status: "ok",
        items: [
          {
            id: "kto-history-2",
            name: "인천중구생활사전시관",
            address: "인천 중구 신포로23번길 97",
            lat: 37.4731,
            lng: 126.6214,
            distanceMeters: 70,
            distanceLabel: "70m",
            placeUrl: "https://korean.visitkorea.or.kr/detail/ms_detail.do?cotid=kto-history-2",
            category: "관광지",
            categoryDetail: "역사관광지"
          }
        ],
        message: "KTO 관광정보 검색 완료"
      };
    }
  });

  assert.equal(ktoCalls.length, 1);
  assert.equal(ktoCalls[0].query, "역사 관광지");
  assert.equal(draft.operation, "update");
  assert.equal(draft.targetItemId, "d2-museum");
  assert.equal(draft.patch.placeName, "인천중구생활사전시관");
  assert.equal(draft.patch.startsAt, items[2].startsAt);
  assert.equal(draft.patch.endsAt, items[2].endsAt);
  assert.equal(draft.intent, "replace_place");
});

test("draftScheduleEditWithAgent returns clickable KTO recommendations with apply-ready patches", async () => {
  const draft = await draftScheduleEditWithAgent({
    text: "둘째날 오후에 역사 관광지 하나 추가해줘",
    items,
    mode: "add_or_update",
    activeDate: "2026-06-28",
    searchPlaces: async () => {
      throw new Error("KTO 후보가 있으면 Kakao 보조 검색을 쓰지 않아야 합니다.");
    },
    searchTouristPlaces: async () => ({
      source: "kto",
      status: "ok",
      items: [
        {
          id: "kto-1",
          name: "인천개항장문화지구",
          address: "인천 중구 신포로27번길 80",
          lat: 37.4728,
          lng: 126.6216,
          distanceMeters: 90,
          distanceLabel: "90m",
          placeUrl: "https://korean.visitkorea.or.kr/detail/ms_detail.do?cotid=kto-1",
          category: "관광지",
          categoryDetail: "역사관광지"
        },
        {
          id: "kto-2",
          name: "인천중구생활사전시관",
          address: "인천 중구 신포로23번길 97",
          lat: 37.4731,
          lng: 126.6214,
          distanceMeters: 120,
          distanceLabel: "120m",
          placeUrl: "https://korean.visitkorea.or.kr/detail/ms_detail.do?cotid=kto-2",
          category: "관광지",
          categoryDetail: "역사관광지"
        }
      ],
      message: "KTO 관광정보 검색 완료"
    })
  });

  assert.equal(draft.recommendations.length, 2);
  assert.equal(draft.recommendations[0].source, "kto");
  assert.equal(draft.recommendations[0].patch.category, "outdoor");
  assert.equal(draft.recommendations[0].patch.memo.includes("KTO 관광정보"), true);
  assert.equal(draft.recommendations[1].patch.placeName, "인천중구생활사전시관");
  assert.deepEqual(draft.patch, draft.recommendations[0].patch);
});

test("draftScheduleEditWithAgent adds cafe after a referenced dinner without labeling it dinner", async () => {
  const draft = await draftScheduleEditWithAgent({
    text: "첫날 저녁 후 카페 하나 추가해줘",
    items,
    mode: "add_or_update",
    activeDate: "2026-06-27",
    searchPlaces: async () => ({
      source: "kakao",
      status: "ok",
      items: [
        {
          id: "cafe-1",
          name: "티살롱바이팔레드신",
          address: "서울 중구 퇴계로 67",
          lat: 37.5605,
          lng: 126.981,
          distanceMeters: 52,
          distanceLabel: "52m",
          placeUrl: "https://place.map.kakao.com/cafe-1",
          category: "cafe"
        }
      ],
      message: "Kakao Local 장소 검색 완료"
    })
  });

  assert.equal(draft.operation, "add");
  assert.equal(draft.patch.title, "티살롱바이팔레드신 카페");
  assert.equal(draft.patch.category, "indoor");
  assert.equal(draft.patch.startsAt, "2026-06-27T19:40:00+09:00");
  assert.equal(draft.patch.endsAt, "2026-06-27T20:40:00+09:00");
  assert.doesNotMatch(draft.confirmationMessage, /저녁/);
});

test("draftScheduleEditWithAgent avoids unrelated place candidates for a specific food request", async () => {
  const draft = await draftScheduleEditWithAgent({
    text: "첫날 저녁을 삼겹살로 바꿀래",
    items,
    mode: "update",
    activeDate: "2026-06-27",
    searchPlaces: async () => ({
      source: "kakao",
      status: "ok",
      items: [
        {
          id: "chinese-1",
          name: "팔레드신",
          address: "서울 중구 퇴계로 67",
          lat: 37.5597,
          lng: 126.9795,
          distanceMeters: 50,
          distanceLabel: "50m",
          placeUrl: "https://place.map.kakao.com/chinese-1",
          category: "음식점",
          categoryDetail: "음식점 > 중식"
        }
      ],
      message: "Kakao Local 장소 검색 완료"
    })
  });

  assert.equal(draft.operation, "update");
  assert.equal(draft.targetItemId, "d1-dinner");
  assert.equal(draft.patch.placeName, "근처 삼겹살 맛집");
  assert.match(draft.resolutionMessage, /삼겹살.*명확히 맞는 후보/);
  assert.equal(draft.alternatives.length, 0);
});
