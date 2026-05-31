import { formatClock } from "./time.js";

const STATUS_TEXT = {
  keep: "유지",
  watch: "주의",
  reroute: "우회"
};

export function decideInspection(context) {
  const issues = [];
  const evidence = [];
  const apiStatus = [];
  const alternatives = context.local.alternatives ?? [];

  collectApiStatus(apiStatus, context);
  collectEvidence(evidence, context);

  if (context.kto.closedToday) {
    issues.push("확인된 휴무일입니다.");
  }

  const outsideOperation = isOutsideOperationHours(context.item.startsAt, context.kto.operationHours);
  if (outsideOperation) {
    issues.push(`방문 시간 ${formatClock(context.item.startsAt)}이 운영시간(${context.kto.operationHours}) 밖입니다.`);
  }

  const placeFailed = !context.kto.matched && !context.local.placeMatched;
  if (placeFailed) {
    issues.push("KTO와 Kakao 모두에서 핵심 장소 매칭이 불완전합니다.");
  } else if (!context.kto.matched || !context.local.placeMatched) {
    issues.push("일부 API에서 장소 매칭이 불확실합니다.");
  }

  if (!context.kto.operationHours) {
    issues.push("운영시간 정보가 누락되어 방문 가능 여부를 단정하기 어렵습니다.");
  }

  const rainRisk = context.weather.precipitationProbability >= 50 || context.weather.precipitationMm >= 3;
  if (rainRisk) {
    issues.push(`방문 시간대 강수확률 ${context.weather.precipitationProbability}%로 날씨 리스크가 있습니다.`);
  }

  const isOutdoor = context.item.category === "outdoor";
  const hardReroute = context.kto.closedToday || outsideOperation || placeFailed;
  const weatherReroute = isOutdoor && rainRisk && alternatives.length > 0;

  if (hardReroute || weatherReroute) {
    const firstAlternative = alternatives[0];
    return {
      status: "reroute",
      checkedAt: new Date().toISOString(),
      summary: `${STATUS_TEXT.reroute}: ${context.item.title}은 일정 변경을 권장합니다.`,
      reason: issues.join(" "),
      evidence,
      recommendedAction: firstAlternative
        ? `${firstAlternative.placeName}로 바꾸고 다음 일정 전 여유 시간을 다시 확인하세요.`
        : "방문 전 공식 채널로 운영 여부를 확인하고 가까운 대체 장소를 선택하세요.",
      alternatives,
      suggestedPatch: firstAlternative
        ? {
            title: firstAlternative.title,
            placeName: firstAlternative.placeName,
            address: firstAlternative.address,
            lat: firstAlternative.lat,
            lng: firstAlternative.lng,
            category: firstAlternative.category,
            memo: `${context.item.memo ? `${context.item.memo} / ` : ""}${firstAlternative.reason}`
          }
        : undefined,
      apiStatus
    };
  }

  if (issues.length > 0) {
    return {
      status: "watch",
      checkedAt: new Date().toISOString(),
      summary: `${STATUS_TEXT.watch}: ${context.item.title}은 진행 가능하지만 확인이 필요합니다.`,
      reason: issues.join(" "),
      evidence,
      recommendedAction: "출발 전 지도 상세, 전화, 공식 홈페이지 중 하나로 마지막 확인을 하세요.",
      alternatives,
      apiStatus
    };
  }

  return {
    status: "keep",
    checkedAt: new Date().toISOString(),
    summary: `${STATUS_TEXT.keep}: ${context.item.title}은 원래 계획대로 진행해도 됩니다.`,
    reason: "장소 매칭, 운영정보, 방문 시간대 날씨에서 큰 리스크가 확인되지 않았습니다.",
    evidence,
    recommendedAction: "현재 일정 유지",
    alternatives: [],
    apiStatus
  };
}

function collectApiStatus(apiStatus, context) {
  apiStatus.push(context.kto.apiStatus);
  apiStatus.push(`날씨: ${context.weather.condition}, 강수확률 ${context.weather.precipitationProbability}%`);
  apiStatus.push(context.local.apiStatus);
}

function collectEvidence(evidence, context) {
  evidence.push(`KTO 장소: ${context.kto.placeName || "매칭 없음"}`);
  evidence.push(`운영정보: ${context.kto.operationHours || "누락"}`);
  evidence.push(`날씨: ${context.weather.condition}, ${context.weather.temperatureC}°C`);
  evidence.push(`Kakao 장소 매칭: ${context.local.placeMatched ? "성공" : "불확실"}`);
}

function isOutsideOperationHours(startsAt, operationHours) {
  if (!operationHours) return false;
  const match = operationHours.match(/(\d{1,2}):(\d{2})\s*[~-]\s*(\d{1,2}):(\d{2})/);
  if (!match) return false;
  const visitMinutes = clockToMinutes(formatClock(startsAt));
  const openMinutes = Number(match[1]) * 60 + Number(match[2]);
  const closeMinutes = Number(match[3]) * 60 + Number(match[4]);
  return visitMinutes < openMinutes || visitMinutes > closeMinutes;
}

function clockToMinutes(clock) {
  const [hour, minute] = clock.split(":").map(Number);
  return hour * 60 + minute;
}
