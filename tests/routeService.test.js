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
  } finally {
    globalThis.fetch = originalFetch;
  }
});

