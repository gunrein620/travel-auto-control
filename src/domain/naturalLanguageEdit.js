import { getKstHour } from "./time.js";

export function draftNaturalLanguageEdit(text, items) {
  const target = findTargetItem(text, items);
  if (!target) {
    return {
      needsConfirmation: false,
      needsClarification: true,
      question: "어떤 일정으로 바꿀까요? 예: 저녁, 오후 일정, 두 번째 일정처럼 알려주세요.",
      patch: {}
    };
  }

  const food = extractFood(text);
  if (!food) {
    return {
      targetItemId: target.id,
      needsConfirmation: false,
      needsClarification: true,
      question: `${target.title}을 무엇으로 바꿀까요? 원하는 음식이나 장소를 알려주세요.`,
      patch: {}
    };
  }

  const patch = {
    title: `${food.label} 저녁`,
    placeName: food.placeName,
    address: target.address,
    lat: target.lat,
    lng: target.lng,
    category: "meal",
    memo: `자연어 요청 반영: ${food.label} 중심으로 저녁 일정 변경`
  };

  return {
    targetItemId: target.id,
    needsConfirmation: true,
    needsClarification: false,
    patch,
    confirmationMessage: `${target.title}을 ${patch.title}으로 바꾸고, 변경된 일정과 다음 1~2개 일정만 다시 점검할게요.`
  };
}

function findTargetItem(text, items) {
  if (/저녁|이따|밤|dinner/i.test(text)) {
    const dinner = items.find((item) => item.category === "meal" && getKstHour(item.startsAt) >= 17);
    if (dinner) return dinner;
  }

  if (/점심|lunch/i.test(text)) {
    const lunch = items.find((item) => item.category === "meal");
    if (lunch) return lunch;
  }

  return items.find((item) => text.includes(item.placeName) || text.includes(item.title));
}

function extractFood(text) {
  const foods = [
    { keywords: ["삼겹살", "고기", "돼지고기"], label: "삼겹살", placeName: "근처 삼겹살 맛집" },
    { keywords: ["비빔밥"], label: "비빔밥", placeName: "근처 비빔밥 식당" },
    { keywords: ["카페", "커피"], label: "카페", placeName: "근처 카페" },
    { keywords: ["국밥"], label: "국밥", placeName: "근처 국밥집" },
    { keywords: ["한식"], label: "한식", placeName: "근처 한식당" }
  ];

  return foods.find((food) => food.keywords.some((keyword) => text.includes(keyword)));
}
