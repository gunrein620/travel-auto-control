import assert from "node:assert/strict";
import test from "node:test";
import { hasFestivalIntent, scoutKtoFestivals } from "../server/festivalScoutService.js";

test("scoutKtoFestivals falls back to nationwide search when KTO area filtering drops a local festival", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.KTO_SERVICE_KEY;
  process.env.KTO_SERVICE_KEY = "test-kto-key";

  const calls = [];
  globalThis.fetch = async (url) => {
    const parsed = new URL(url);
    calls.push({
      endpoint: parsed.pathname.split("/").at(-1),
      areaCode: parsed.searchParams.get("areaCode"),
      keyword: parsed.searchParams.get("keyword"),
      contentId: parsed.searchParams.get("contentId")
    });

    if (parsed.pathname.endsWith("/searchFestival2") && parsed.searchParams.get("areaCode") === "31") {
      return ktoResponse({ totalCount: 0, item: [] });
    }

    if (parsed.pathname.endsWith("/searchFestival2")) {
      return ktoResponse({
        totalCount: 2,
        item: [
          festivalItem({
            contentid: "530450",
            title: "고양행주문화제",
            addr1: "경기도 고양시 덕양구 행주로15번길 89 (행주외동)",
            mapx: "126.8245886711",
            mapy: "37.6004267743",
            areacode: "",
            sigungucode: ""
          }),
          festivalItem({
            contentid: "3486730",
            title: "경기미 김밥페스타",
            addr1: "경기도 수원시 영통구 광교중앙로 140 (하동)"
          })
        ]
      });
    }

    if (parsed.pathname.endsWith("/detailIntro2")) {
      return ktoResponse({
        totalCount: 1,
        item: {
          contentid: "530450",
          eventstartdate: "20260613",
          eventenddate: "20260614",
          playtime: "15:00~21:00",
          eventplace: "행주산성역사공원 및 행주산성 일원",
          usetimefestival: "무료",
          program: "대표프로그램, 공연프로그램, 체험 프로그램"
        }
      });
    }

    throw new Error(`unexpected KTO URL: ${url}`);
  };

  try {
    const result = await scoutKtoFestivals({
      region: "고양시",
      resolvedRegion: {
        region: "고양",
        queryRegion: "고양시",
        addressHints: ["경기 고양시 덕양구", "경기 고양시 일산동구"]
      },
      startDate: "2026-06-13",
      endDate: "2026-06-15",
      days: ["2026-06-13", "2026-06-14", "2026-06-15"],
      requests: "축제 공연 중심 여행"
    });

    assert.equal(result.status, "ok");
    assert.equal(result.events.length, 1);
    assert.equal(result.events[0].title, "고양행주문화제");
    assert.equal(result.events[0].dateRange, "2026-06-13~2026-06-14");
    assert.equal(result.events[0].placeName, "행주산성역사공원");
    assert.ok(result.events[0].highlights.some((highlight) => highlight.title === "행주 드론불꽃쇼 관람"));
    assert.ok(calls.some((call) => call.endpoint === "searchFestival2" && call.areaCode === "31"));
    assert.ok(calls.some((call) => call.endpoint === "searchFestival2" && call.areaCode === null));
    assert.ok(result.apiStatus.some((status) => /전국 재검색/.test(status)));
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.KTO_SERVICE_KEY;
    else process.env.KTO_SERVICE_KEY = originalKey;
  }
});

test("scoutKtoFestivals creates a schedulable visit slot for ordinary festival results", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.KTO_SERVICE_KEY;
  process.env.KTO_SERVICE_KEY = "test-kto-key";

  globalThis.fetch = async (url) => {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith("/searchFestival2") && parsed.searchParams.get("areaCode") === "6") {
      return ktoResponse({
        totalCount: 1,
        item: festivalItem({
          contentid: "2786391",
          title: "광안리 M(Marvelous) 드론 라이트쇼",
          addr1: "부산광역시 수영구 광안해변로 219 (광안동)",
          eventstartdate: "20260101",
          eventenddate: "20261231",
          mapx: "129.1186",
          mapy: "35.1532",
          areacode: "6",
          sigungucode: "12"
        })
      });
    }

    if (parsed.pathname.endsWith("/searchFestival2")) {
      return ktoResponse({ totalCount: 0, item: [] });
    }

    if (parsed.pathname.endsWith("/detailIntro2")) {
      return ktoResponse({
        totalCount: 1,
        item: {
          contentid: "2786391",
          eventstartdate: "20260101",
          eventenddate: "20261231",
          playtime: "20:00~21:00",
          eventplace: "광안리해수욕장 일원",
          program: "드론 라이트쇼"
        }
      });
    }

    throw new Error(`unexpected KTO URL: ${url}`);
  };

  try {
    const result = await scoutKtoFestivals({
      region: "부산",
      startDate: "2026-06-23",
      endDate: "2026-06-25",
      days: ["2026-06-23", "2026-06-24", "2026-06-25"],
      requests: "축제 행사도 보고 싶어"
    });

    assert.equal(result.status, "ok");
    assert.equal(result.events[0].title, "광안리 M(Marvelous) 드론 라이트쇼");
    assert.equal(result.events[0].highlights[0].title, "광안리 M(Marvelous) 드론 라이트쇼 관람");
    assert.equal(result.events[0].highlights[0].startsAt, "2026-06-23T20:00:00+09:00");
    assert.equal(result.events[0].highlights[0].endsAt, "2026-06-23T21:00:00+09:00");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.KTO_SERVICE_KEY;
    else process.env.KTO_SERVICE_KEY = originalKey;
  }
});

test("scoutKtoFestivals treats named event formats as festival intent and prioritizes the requested title", async () => {
  assert.equal(
    hasFestivalIntent({
      region: "서울",
      requests: "서울국제도서전 가고 싶어"
    }),
    true
  );

  const originalFetch = globalThis.fetch;
  const originalKey = process.env.KTO_SERVICE_KEY;
  process.env.KTO_SERVICE_KEY = "test-kto-key";

  globalThis.fetch = async (url) => {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith("/searchFestival2") && parsed.searchParams.get("areaCode") === "1") {
      return ktoResponse({ totalCount: 0, item: [] });
    }

    if (parsed.pathname.endsWith("/searchFestival2")) {
      return ktoResponse({
        totalCount: 2,
        item: [
          festivalItem({
            contentid: "4060434",
            title: "국악공연 진연",
            addr1: "서울특별시 종로구 인사동5길 10 (인사동)",
            eventstartdate: "20260101",
            eventenddate: "20261231"
          }),
          festivalItem({
            contentid: "228985",
            title: "2026 서울국제도서전",
            addr1: "서울특별시 강남구 영동대로 513 (삼성동)",
            eventstartdate: "20260624",
            eventenddate: "20260628"
          })
        ]
      });
    }

    if (parsed.pathname.endsWith("/searchKeyword2")) {
      return ktoResponse({
        totalCount: 1,
        item: festivalItem({
          contentid: "228985",
          title: "2026 서울국제도서전",
          addr1: "서울특별시 강남구 영동대로 513 (삼성동)",
          eventstartdate: "20260624",
          eventenddate: "20260628"
        })
      });
    }

    if (parsed.pathname.endsWith("/detailIntro2")) {
      return ktoResponse({
        totalCount: 1,
        item: {
          contentid: parsed.searchParams.get("contentId"),
          eventstartdate: parsed.searchParams.get("contentId") === "228985" ? "20260624" : "20260101",
          eventenddate: parsed.searchParams.get("contentId") === "228985" ? "20260628" : "20261231",
          playtime: "10:00~18:00",
          eventplace: parsed.searchParams.get("contentId") === "228985" ? "코엑스" : "인사동"
        }
      });
    }

    throw new Error(`unexpected KTO URL: ${url}`);
  };

  try {
    const result = await scoutKtoFestivals({
      region: "서울",
      startDate: "2026-06-24",
      endDate: "2026-06-25",
      days: ["2026-06-24", "2026-06-25"],
      requests: "서울국제도서전 가고 싶어"
    });

    assert.equal(result.status, "ok");
    assert.equal(result.events[0].title, "2026 서울국제도서전");
    assert.equal(result.events[0].highlights[0].startsAt, "2026-06-24T10:00:00+09:00");
    assert.ok(result.apiStatus.some((status) => /행사명 보조검색/.test(status)));
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.KTO_SERVICE_KEY;
    else process.env.KTO_SERVICE_KEY = originalKey;
  }
});

test("scoutKtoFestivals expands zero-length event times into a usable visit slot", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.KTO_SERVICE_KEY;
  process.env.KTO_SERVICE_KEY = "test-kto-key";

  globalThis.fetch = async (url) => {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith("/searchFestival2")) {
      return ktoResponse({
        totalCount: 1,
        item: festivalItem({
          contentid: "2987489",
          title: "2026 고흥 녹동항 드론쇼",
          addr1: "전라남도 고흥군 도양읍 봉암리",
          eventstartdate: "20260404",
          eventenddate: "20261031"
        })
      });
    }

    if (parsed.pathname.endsWith("/searchKeyword2")) {
      return ktoResponse({ totalCount: 0, item: [] });
    }

    if (parsed.pathname.endsWith("/detailIntro2")) {
      return ktoResponse({
        totalCount: 1,
        item: {
          contentid: "2987489",
          eventstartdate: "20260404",
          eventenddate: "20261031",
          playtime: "매주 토요일 21:00~21:00",
          eventplace: "녹동항 일원",
          program: "드론쇼"
        }
      });
    }

    throw new Error(`unexpected KTO URL: ${url}`);
  };

  try {
    const result = await scoutKtoFestivals({
      region: "고흥군",
      startDate: "2026-06-20",
      endDate: "2026-06-21",
      days: ["2026-06-20", "2026-06-21"],
      requests: "고흥 녹동항 드론쇼 보러 가는 여행"
    });

    assert.equal(result.status, "ok");
    assert.equal(result.events[0].highlights[0].startsAt, "2026-06-20T21:00:00+09:00");
    assert.equal(result.events[0].highlights[0].endsAt, "2026-06-20T21:30:00+09:00");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.KTO_SERVICE_KEY;
    else process.env.KTO_SERVICE_KEY = originalKey;
  }
});

function festivalItem(overrides = {}) {
  return {
    contentid: "festival",
    contenttypeid: "15",
    title: "축제",
    addr1: "경기도 고양시",
    eventstartdate: "20260613",
    eventenddate: "20260614",
    mapx: "126.8245",
    mapy: "37.6004",
    areacode: "31",
    sigungucode: "",
    ...overrides
  };
}

function ktoResponse({ totalCount = 0, item = [] } = {}) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      response: {
        header: { resultCode: "0000", resultMsg: "OK" },
        body: {
          totalCount,
          items: { item }
        }
      }
    })
  };
}
