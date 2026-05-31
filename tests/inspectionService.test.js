import assert from "node:assert/strict";
import test from "node:test";
import { inspectItem } from "../server/inspectionService.js";

const item = {
  id: "ddp",
  title: "DDP 전시",
  placeName: "동대문디자인플라자",
  address: "서울 중구 을지로 281",
  lat: 37.5661,
  lng: 127.0096,
  startsAt: "2026-05-30T15:00:00+09:00",
  endsAt: "2026-05-30T16:00:00+09:00",
  transportMode: "subway",
  travelMinutesBefore: 20,
  category: "indoor",
  memo: "",
  status: "unchecked"
};

test("inspectItem calls KTO and Kakao APIs on each inspection without caching raw payloads", async () => {
  const originalFetch = globalThis.fetch;
  const originalKto = process.env.KTO_SERVICE_KEY;
  const originalKakao = process.env.KAKAO_REST_API_KEY;
  let ktoCalls = 0;
  let kakaoCalls = 0;

  process.env.KTO_SERVICE_KEY = "fake-kto-key";
  process.env.KAKAO_REST_API_KEY = "fake-kakao-key";
  delete process.env.LIVE_WEATHER;

  globalThis.fetch = async (url) => {
    const href = String(url);
    if (href.includes("apis.data.go.kr")) {
      ktoCalls += 1;
      return {
        ok: true,
        text: async () => JSON.stringify({ response: { body: { items: [{ title: "동대문디자인플라자" }] } } })
      };
    }
    if (href.includes("dapi.kakao.com")) {
      kakaoCalls += 1;
      return {
        ok: true,
        json: async () => ({ documents: [{ place_name: "동대문디자인플라자" }] })
      };
    }
    throw new Error(`unexpected fetch ${href}`);
  };

  try {
    const first = await inspectItem(item);
    const second = await inspectItem(item);
    const combined = JSON.stringify([first, second]);

    assert.equal(ktoCalls, 2);
    assert.equal(kakaoCalls, 2);
    assert.equal(combined.includes("fake-kto-key"), false);
    assert.equal(combined.includes("fake-kakao-key"), false);
    assert.equal(combined.includes("response"), false);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv("KTO_SERVICE_KEY", originalKto);
    restoreEnv("KAKAO_REST_API_KEY", originalKakao);
  }
});

function restoreEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
