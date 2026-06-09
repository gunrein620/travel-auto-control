import assert from "node:assert/strict";
import test from "node:test";
import { fetchRouteGeometry, normalizeOsrmRoute } from "../server/routeService.js";

test("normalizeOsrmRoute converts OSRM coordinates into planner route points", () => {
  const result = normalizeOsrmRoute(
    {
      code: "Ok",
      routes: [
        {
          distance: 1367.7,
          duration: 420.2,
          geometry: {
            type: "LineString",
            coordinates: [
              [127.0176, 37.2796],
              [127.0188, 37.2879]
            ]
          }
        }
      ]
    },
    "driving"
  );

  assert.equal(result.status, "ok");
  assert.equal(result.profile, "driving");
  assert.equal(result.distanceMeters, 1368);
  assert.equal(result.durationSeconds, 420);
  assert.deepEqual(result.points[0], { lat: 37.2796, lng: 127.0176 });
});

test("fetchRouteGeometry calls OSRM with live coordinates and no API key", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const requestUrl = new URL(String(url));
    assert.equal(requestUrl.origin + requestUrl.pathname, "https://router.project-osrm.org/route/v1/foot/127.0146,37.2828;127.0112,37.2878");
    assert.equal(requestUrl.searchParams.get("overview"), "full");
    assert.equal(requestUrl.searchParams.get("geometries"), "geojson");
    assert.equal(String(url).includes("key="), false);
    return {
      ok: true,
      json: async () => ({
        code: "Ok",
        routes: [
          {
            distance: 800,
            duration: 600,
            geometry: {
              coordinates: [
                [127.0146, 37.2828],
                [127.0112, 37.2878]
              ]
            }
          }
        ]
      })
    };
  };

  try {
    const result = await fetchRouteGeometry({
      fromLat: 37.2828,
      fromLng: 127.0146,
      toLat: 37.2878,
      toLng: 127.0112,
      mode: "walk"
    });

    assert.equal(result.status, "ok");
    assert.equal(result.profile, "foot");
    assert.equal(result.points.length, 2);
    // OSRM 데모는 보행시간을 차량속도(600s)로 내므로 도로거리 기반으로 재추정한다.
    assert.equal(result.osrmDurationSeconds, 600);
    assert.equal(result.durationSource, "estimate");
    assert.ok(result.durationSeconds > 600, `walk 800m should be slower than OSRM car-speed, got ${result.durationSeconds}`);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchRouteGeometry uses Kakao Mobility ETA for car routes when a key is set", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.KAKAO_REST_API_KEY;
  process.env.KAKAO_REST_API_KEY = "test-key";

  globalThis.fetch = async (url, options) => {
    const target = String(url);
    if (target.includes("router.project-osrm.org")) {
      return {
        ok: true,
        json: async () => ({
          code: "Ok",
          routes: [
            {
              distance: 5000,
              duration: 300,
              geometry: { coordinates: [[129.06, 35.17], [129.1, 35.18]] }
            }
          ]
        })
      };
    }
    if (target.includes("apis-navi.kakaomobility.com")) {
      assert.equal(options.headers.Authorization, "KakaoAK test-key");
      return {
        ok: true,
        json: async () => ({ routes: [{ result_code: 0, summary: { duration: 1200, distance: 5200 } }] })
      };
    }
    throw new Error(`unexpected url ${target}`);
  };

  try {
    const result = await fetchRouteGeometry({
      fromLat: 35.17,
      fromLng: 129.06,
      toLat: 35.18,
      toLng: 129.1,
      mode: "car",
      departAt: "2026-06-29T18:00:00+09:00"
    });

    assert.equal(result.status, "ok");
    assert.equal(result.durationSource, "kakao");
    assert.equal(result.durationSeconds, 1200);
    assert.equal(result.distanceMeters, 5000);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.KAKAO_REST_API_KEY;
    else process.env.KAKAO_REST_API_KEY = originalKey;
  }
});

test("fetchRouteGeometry falls back to a heuristic car estimate without a Kakao key", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.KAKAO_REST_API_KEY;
  delete process.env.KAKAO_REST_API_KEY;

  let kakaoCalls = 0;
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.includes("apis-navi.kakaomobility.com")) kakaoCalls += 1;
    if (target.includes("router.project-osrm.org")) {
      return {
        ok: true,
        json: async () => ({
          code: "Ok",
          routes: [
            {
              distance: 5000,
              duration: 300,
              geometry: { coordinates: [[129.06, 35.17], [129.1, 35.18]] }
            }
          ]
        })
      };
    }
    throw new Error(`unexpected url ${target}`);
  };

  try {
    const result = await fetchRouteGeometry({
      fromLat: 35.17,
      fromLng: 129.06,
      toLat: 35.18,
      toLng: 129.1,
      mode: "car",
      departAt: "2026-06-29T18:00:00+09:00"
    });

    assert.equal(result.durationSource, "estimate");
    assert.equal(kakaoCalls, 0);
    assert.ok(result.durationSeconds > 0);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.KAKAO_REST_API_KEY;
    else process.env.KAKAO_REST_API_KEY = originalKey;
  }
});

