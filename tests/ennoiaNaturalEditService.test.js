import assert from "node:assert/strict";
import test from "node:test";
import { draftNaturalLanguageEditWithEnnoia } from "../server/ennoiaNaturalEditService.js";

const items = [
  {
    id: "museum",
    title: "국립중앙박물관 관람",
    placeName: "국립중앙박물관",
    address: "서울 용산구 서빙고로 137",
    lat: 37.5238,
    lng: 126.9804,
    startsAt: "2026-05-30T14:00:00+09:00",
    endsAt: "2026-05-30T16:00:00+09:00",
    transportMode: "subway",
    travelMinutesBefore: 30,
    category: "indoor",
    memo: "전시 관람",
    status: "unchecked"
  },
  {
    id: "dinner",
    title: "비빔밥 저녁",
    placeName: "전주비빔밥",
    address: "서울 중구",
    lat: 37.56,
    lng: 126.98,
    startsAt: "2026-05-30T19:00:00+09:00",
    endsAt: "2026-05-30T20:00:00+09:00",
    transportMode: "walk",
    travelMinutesBefore: 10,
    category: "meal",
    memo: "저녁 식사",
    status: "unchecked"
  }
];

test("draftNaturalLanguageEditWithEnnoia uses Ennoia JSON patches when configured", async () => {
  const originalFetch = globalThis.fetch;
  const originalEndpoint = process.env.ENNOIA_NATURAL_EDIT_ENDPOINT;
  const originalKey = process.env.ENNOIA_API_KEY;

  process.env.ENNOIA_NATURAL_EDIT_ENDPOINT = "https://api.ennoia.test/natural-edit";
  process.env.ENNOIA_API_KEY = "secret-key";

  globalThis.fetch = async (url, options) => {
    assert.equal(String(url), "https://api.ennoia.test/natural-edit");
    assert.equal(options.headers.apiKey, "secret-key");
    assert.equal(options.headers.project, "KNTO-PROMPTON-2026-544");
    const body = JSON.parse(options.body);
    assert.match(body.messages.at(-1).content[0].text, /현재 플래너 JSON/);
    return {
      ok: true,
      json: async () => ({
        output: JSON.stringify({
          targetItemId: "dinner",
          intent: "replace_meal",
          confidence: 0.92,
          patch: {
            title: "삼겹살 저녁",
            placeName: "성수 삼겹살",
            category: "meal",
            memo: "사용자 요청으로 삼겹살 중심 저녁 변경"
          },
          needsConfirmation: true,
          needsClarification: false,
          confirmationMessage: "비빔밥 저녁을 삼겹살 저녁으로 바꿀까요?"
        })
      })
    };
  };

  try {
    const draft = await draftNaturalLanguageEditWithEnnoia("저녁은 삼겹살로 바꿔줘", items);

    assert.equal(draft.source, "ennoia");
    assert.equal(draft.targetItemId, "dinner");
    assert.equal(draft.patch.title, "삼겹살 저녁");
    assert.equal(JSON.stringify(draft).includes("secret-key"), false);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv("ENNOIA_NATURAL_EDIT_ENDPOINT", originalEndpoint);
    restoreEnv("ENNOIA_API_KEY", originalKey);
  }
});

test("draftNaturalLanguageEditWithEnnoia rejects unsafe target ids and asks a clarification", async () => {
  const originalFetch = globalThis.fetch;
  const originalEndpoint = process.env.ENNOIA_NATURAL_EDIT_ENDPOINT;
  const originalKey = process.env.ENNOIA_API_KEY;

  process.env.ENNOIA_NATURAL_EDIT_ENDPOINT = "https://api.ennoia.test/natural-edit";
  process.env.ENNOIA_API_KEY = "secret-key";

  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      output: JSON.stringify({
        targetItemId: "not-in-plan",
        patch: { title: "삭제", placeName: "알 수 없음" },
        needsConfirmation: true,
        needsClarification: false
      })
    })
  });

  try {
    const draft = await draftNaturalLanguageEditWithEnnoia("일정 바꿔줘", items);

    assert.equal(draft.needsClarification, true);
    assert.equal(draft.patch && Object.keys(draft.patch).length, 0);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv("ENNOIA_NATURAL_EDIT_ENDPOINT", originalEndpoint);
    restoreEnv("ENNOIA_API_KEY", originalKey);
  }
});

function restoreEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
