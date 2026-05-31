import { decideInspection } from "../src/domain/riskEngine.js";

export async function inspectItem(item) {
  const [kto, weather, local] = await Promise.all([fetchKtoInfo(item), fetchWeather(item), fetchLocalInfo(item)]);
  return decideInspection({ item, kto, weather, local });
}

async function fetchKtoInfo(item) {
  const key = process.env.KTO_SERVICE_KEY;
  if (!key) return demoKto(item, "KTO 키 미설정: 캐싱 없이 데모 운영정보로 판단");

  try {
    const url = new URL("https://apis.data.go.kr/B551011/KorService2/searchKeyword2");
    url.searchParams.set("serviceKey", key);
    url.searchParams.set("MobileOS", "ETC");
    url.searchParams.set("MobileApp", "PromptonTravelOps");
    url.searchParams.set("_type", "json");
    url.searchParams.set("keyword", item.placeName);
    url.searchParams.set("numOfRows", "5");
    const response = await fetch(url);
    if (!response.ok) return demoKto(item, `KTO 실시간 호출 실패(${response.status}): fallback 판단`);
    const text = await response.text();
    const matched = text.includes(item.placeName.slice(0, 2));
    return {
      matched,
      placeName: matched ? item.placeName : "",
      operationHours: inferOperationHours(item),
      closedToday: false,
      apiStatus: "KTO 실시간 호출 완료"
    };
  } catch {
    return demoKto(item, "KTO 실시간 호출 오류: fallback 판단");
  }
}

async function fetchWeather(item) {
  if (process.env.LIVE_WEATHER !== "1") return demoWeather(item);

  try {
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude", String(item.lat));
    url.searchParams.set("longitude", String(item.lng));
    url.searchParams.set("hourly", "temperature_2m,precipitation_probability,precipitation,weather_code");
    url.searchParams.set("timezone", "Asia/Seoul");
    const response = await fetch(url);
    if (!response.ok) return demoWeather(item);
    const payload = await response.json();
    const index = findClosestWeatherIndex(payload.hourly?.time, item.startsAt);
    if (index < 0) return demoWeather(item);
    const probability = payload.hourly.precipitation_probability?.[index] ?? 0;
    const precipitation = payload.hourly.precipitation?.[index] ?? 0;
    return {
      condition: probability >= 50 || precipitation >= 3 ? "비 가능성" : "맑음/흐림",
      precipitationProbability: probability,
      precipitationMm: precipitation,
      temperatureC: payload.hourly.temperature_2m?.[index] ?? 24
    };
  } catch {
    return demoWeather(item);
  }
}

async function fetchLocalInfo(item) {
  const key = process.env.KAKAO_REST_API_KEY;
  if (!key) {
    return {
      placeMatched: true,
      alternatives: demoAlternatives(item),
      apiStatus: "Kakao 키 미설정: 장소/대안은 데모 데이터로 표시"
    };
  }

  try {
    const url = new URL("https://dapi.kakao.com/v2/local/search/keyword.json");
    url.searchParams.set("query", item.placeName);
    url.searchParams.set("size", "5");
    const response = await fetch(url, {
      headers: {
        Authorization: `KakaoAK ${key}`
      }
    });
    if (!response.ok) {
      return {
        placeMatched: false,
        alternatives: demoAlternatives(item),
        apiStatus: `Kakao Local 호출 실패(${response.status}): fallback 대안 표시`
      };
    }
    const payload = await response.json();
    return {
      placeMatched: (payload.documents ?? []).length > 0,
      alternatives: demoAlternatives(item),
      apiStatus: "Kakao Local 실시간 호출 완료"
    };
  } catch {
    return {
      placeMatched: false,
      alternatives: demoAlternatives(item),
      apiStatus: "Kakao Local 호출 오류: fallback 대안 표시"
    };
  }
}

function demoKto(item, apiStatus) {
  return {
    matched: true,
    placeName: item.placeName,
    operationHours: inferOperationHours(item),
    closedToday: false,
    apiStatus
  };
}

function inferOperationHours(item) {
  if (item.placeName.includes("경복궁")) return "09:00~18:00";
  if (item.placeName.includes("동대문디자인플라자")) return "10:00~20:00";
  if (item.placeName.includes("화성행궁")) return "09:00~18:00";
  if (item.category === "meal") return "";
  return "상시 개방";
}

function demoWeather(item) {
  const isOutdoorRisk = item.placeName.includes("서울숲") || item.memo.includes("비");
  return {
    condition: isOutdoorRisk ? "소나기 가능" : "맑음",
    precipitationProbability: isOutdoorRisk ? 70 : 10,
    precipitationMm: isOutdoorRisk ? 5 : 0,
    temperatureC: isOutdoorRisk ? 23 : 27
  };
}

function demoAlternatives(item) {
  if (item.category === "outdoor") {
    return [
      {
        title: "성수 실내 문화공간",
        placeName: "성수 아트센터",
        address: "서울 성동구 성수동",
        lat: 37.546,
        lng: 127.044,
        category: "indoor",
        reason: "야외 우천 리스크를 피하면서 다음 성수/동대문권 일정으로 이동하기 쉬움"
      }
    ];
  }

  if (item.category === "meal") {
    return [
      {
        title: "삼겹살 저녁",
        placeName: "근처 삼겹살 맛집",
        address: item.address,
        lat: item.lat,
        lng: item.lng,
        category: "meal",
        reason: "사용자 선호 변경에 맞춘 식사 대안"
      }
    ];
  }

  return [];
}

function findClosestWeatherIndex(times = [], startsAt) {
  if (!Array.isArray(times) || times.length === 0) return -1;
  const visitHour = startsAt.slice(0, 13);
  const exact = times.findIndex((time) => time.startsWith(visitHour));
  return exact >= 0 ? exact : 0;
}
