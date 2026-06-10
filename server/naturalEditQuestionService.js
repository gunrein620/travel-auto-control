import { formatClock, getKstHour } from "../src/domain/time.js";

const EDIT_INTENT_PATTERN =
  /바꿔|바꾸|변경|수정|고쳐|추가|넣어|넣자|빼|빼줘|삭제|제외|스킵|skip|말고|대신|적용|추천해서\s*추가|옮겨|미뤄|당겨|제거|취소|없애/i;

const QUESTION_INTENT_PATTERN =
  /몇\s*시|몇\s*분|언제|어디|장소|주소|시간|뭐야|무엇|뭘|뭐\s*먹|알려줘|확인해줘|시작|끝|부터|까지|이동|소요|걸려/i;

const QUESTION_TARGET_TERMS = [
  "드론불꽃쇼",
  "드론쇼",
  "불꽃쇼",
  "드론",
  "불꽃",
  "축제",
  "공연",
  "라이트쇼",
  "쇼",
  "사찰",
  "관광",
  "명소",
  "박물관",
  "미술관",
  "전시",
  "공원",
  "산책",
  "실내",
  "야외",
  "쇼핑",
  "휴식",
  "카페"
];

export function answerNaturalEditQuestion(text, items = [], options = {}) {
  const requestText = clean(text);
  if (!shouldAnswerPlannerQuestion(requestText)) return null;

  const sortedItems = [...items].sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
  if (sortedItems.length === 0) {
    return plannerReply("현재 플래너에 확인할 일정이 없어요. 먼저 일정을 만든 뒤 다시 물어봐 주세요.", "플래너 질문 답변");
  }

  const targets = findQuestionTargets(requestText, sortedItems, options.activeDate);
  if (targets.length === 0) {
    return plannerReply("어떤 일정인지 조금만 더 알려주세요. 예: 드론쇼 시간, 점심 장소처럼 물어봐 주세요.", "질문 대상 확인 필요");
  }

  if (targets.length > 1) {
    return plannerReply(answerForTargets(requestText, targets), "플래너 맥락 답변");
  }

  const target = targets[0];
  return plannerReply(answerForTarget(requestText, target), "플래너 맥락 답변");
}

export function shouldAnswerPlannerQuestion(text) {
  const requestText = clean(text);
  if (!requestText) return false;
  if (EDIT_INTENT_PATTERN.test(requestText)) return false;
  return QUESTION_INTENT_PATTERN.test(requestText);
}

function plannerReply(text, modelStatus) {
  return {
    type: "answer",
    text,
    source: "agent",
    modelStatus
  };
}

function answerForTarget(text, item = {}) {
  const questionType = questionTypeFor(text);
  if (questionType === "movement") return movementAnswer(item);
  if (questionType === "place") return placeAnswer(item);
  if (questionType === "time") return timeAnswer(item, text);
  if (questionType === "meal") return mealAnswer(item);
  return overviewAnswer(item);
}

function answerForTargets(text, targets = []) {
  const questionType = questionTypeFor(text);
  if (questionType === "time") return multiTimeAnswer(targets, text);
  if (questionType === "place") return multiPlaceAnswer(targets);
  return multiOverviewAnswer(targets);
}

function questionTypeFor(text) {
  if (/이동|몇\s*분|소요|걸려|교통|대중교통|버스|지하철|택시|도보|걸어|차로/.test(text)) return "movement";
  if (/어디|장소|주소|위치/.test(text)) return "place";
  if (/몇\s*시|언제|시간|시작|끝|부터|까지/.test(text)) return "time";
  if (/뭐\s*먹|뭘\s*먹|음식|식사|메뉴|맛집/.test(text)) return "meal";
  return "overview";
}

function timeAnswer(item = {}, text = "") {
  const range = timeRangeLabel(item);
  const place = clean(item.placeName);
  const eventTime = eventTimeHint(item, text);
  const eventDetail = eventTime ? ` 메모 기준 관련 행사 시간은 ${eventTime}로 표시돼 있어요.` : "";
  return `${itemTitle(item)}은 ${dateLabel(item.startsAt)} ${range}예요.${eventDetail}${place ? ` 장소는 ${place}입니다.` : ""}`;
}

function multiTimeAnswer(items = [], text = "") {
  const title = sharedTitle(items);
  const schedules = items
    .map((item) => {
      const eventTime = eventTimeHint(item, text);
      const hint = eventTime ? `, 메모상 ${eventTime}경` : "";
      return `${dateLabel(item.startsAt)} ${timeRangeLabel(item)}${hint}`;
    })
    .join(", ");
  const places = uniqueClean(items.map((item) => item.placeName));
  const placeText = places.length === 1 ? ` 장소는 ${places[0]}입니다.` : places.length > 1 ? ` 장소는 ${places.join(", ")}입니다.` : "";
  return `${title}은 ${schedules}로 잡혀 있어요.${placeText}`;
}

function placeAnswer(item = {}) {
  const place = clean(item.placeName || item.title);
  const address = clean(item.address);
  const time = hasTime(item) ? ` 시간은 ${timeRangeLabel(item)}예요.` : "";
  return `${itemTitle(item)} 장소는 ${place || "플래너에 장소명이 아직 없어요"}입니다.${address ? ` 주소는 ${address}입니다.` : ""}${time}`;
}

function multiPlaceAnswer(items = []) {
  const title = sharedTitle(items);
  const places = uniqueClean(items.map((item) => item.placeName || item.title));
  const addresses = uniqueClean(items.map((item) => item.address));
  const dateText = items.map((item) => `${dateLabel(item.startsAt)} ${timeRangeLabel(item)}`).join(", ");
  return `${title} 장소는 ${places.join(", ") || "플래너에 장소명이 아직 없어요"}입니다.${addresses.length === 1 ? ` 주소는 ${addresses[0]}입니다.` : ""} 시간은 ${dateText}예요.`;
}

function movementAnswer(item = {}) {
  const mode = transportLabel(item.transportMode);
  const minutes = Number(item.travelMinutesBefore);
  if (Number.isFinite(minutes) && minutes > 0) {
    return `${itemTitle(item)} 전 이동은 ${mode} 기준 약 ${minutes}분으로 잡혀 있어요.`;
  }
  return `${itemTitle(item)} 이동 시간은 플래너에 아직 분 단위로 잡혀 있지 않아요.${mode ? ` 이동 수단은 ${mode}로 표시돼 있어요.` : ""}`;
}

function mealAnswer(item = {}) {
  const place = clean(item.placeName);
  const range = hasTime(item) ? ` 시간은 ${timeRangeLabel(item)}예요.` : "";
  return `${itemTitle(item)}은 ${place ? `${place}에서` : "플래너에 표시된 장소에서"} 잡혀 있어요.${range}`;
}

function overviewAnswer(item = {}) {
  const parts = [`${itemTitle(item)}은`];
  if (hasTime(item)) parts.push(`${dateLabel(item.startsAt)} ${timeRangeLabel(item)}`);
  if (clean(item.placeName)) parts.push(`${clean(item.placeName)}에서`);
  return `${parts.join(" ")} 진행돼요.`;
}

function multiOverviewAnswer(items = []) {
  const title = sharedTitle(items);
  const schedules = items.map((item) => `${dateLabel(item.startsAt)} ${timeRangeLabel(item)}`).join(", ");
  const places = uniqueClean(items.map((item) => item.placeName));
  return `${title}은 ${schedules}에 진행돼요.${places.length === 1 ? ` 장소는 ${places[0]}입니다.` : ""}`;
}

function findQuestionTarget(text, items = [], activeDate) {
  return findQuestionTargets(text, items, activeDate)[0] || null;
}

function findQuestionTargets(text, items = [], activeDate) {
  const explicitDate = explicitRequestedDate(text, items);
  const preferredDate = explicitDate || activeDate || "";
  const slot = requestedMealSlot(text);
  const scored = items
    .map((item, index) => ({
      item,
      index,
      score: questionTargetScore({ text, item, explicitDate, preferredDate, slot })
    }))
    .filter((candidate) => candidate.score >= 45)
    .sort((a, b) => b.score - a.score || a.index - b.index);

  if (scored.length === 0) return [];
  if (explicitDate) {
    const explicitDateCandidates = scored.filter((candidate) => dateKey(candidate.item.startsAt) === explicitDate);
    return explicitDateCandidates.length > 0 ? [explicitDateCandidates[0].item] : [scored[0].item];
  }
  if (activeDate) return [scored[0].item];

  const top = scored[0];
  return scored
    .filter((candidate) => candidate.score >= top.score - 6 && sameQuestionTargetFamily(top.item, candidate.item))
    .slice(0, 4)
    .map((candidate) => candidate.item);
}

function questionTargetScore({ text, item, explicitDate, preferredDate, slot }) {
  const normalizedText = normalizeMatchText(text);
  const itemText = normalizeMatchText([item.title, item.placeName, item.address, item.memo].join(" "));
  const itemDate = dateKey(item.startsAt);
  let score = 0;

  if (explicitDate) {
    score += itemDate === explicitDate ? 28 : -60;
  } else if (preferredDate) {
    score += itemDate === preferredDate ? 6 : -8;
  }

  score += aliasMentionScore(normalizedText, valueAliases(item.title), 68, 28);
  score += aliasMentionScore(normalizedText, valueAliases(item.placeName), 54, 24);

  for (const term of mentionedTargetTerms(text)) {
    const normalizedTerm = normalizeMatchText(term);
    if (normalizedTerm && itemText.includes(normalizedTerm)) score += term.length <= 1 ? 8 : 46;
  }

  if (slot) {
    if (item.category === "meal" && itemInMealSlot(item, slot)) score += 72;
    else if (item.category === "meal") score -= 12;
    else score -= 18;
  }

  const meaningfulTokens = queryTokens(text);
  for (const token of meaningfulTokens) {
    if (itemText.includes(normalizeMatchText(token))) score += 18;
  }

  return score;
}

function aliasMentionScore(normalizedText, aliases, fullScore, partialScore) {
  let score = 0;
  for (const alias of aliases) {
    const normalizedAlias = normalizeMatchText(alias);
    if (!normalizedAlias || !normalizedText.includes(normalizedAlias)) continue;
    score = Math.max(score, alias === aliases[0] ? fullScore : partialScore);
  }
  return score;
}

function mentionedTargetTerms(text) {
  return QUESTION_TARGET_TERMS.filter((term) => text.includes(term));
}

function queryTokens(text) {
  return clean(text)
    .replace(QUESTION_INTENT_PATTERN, " ")
    .replace(/은|는|이|가|을|를|에|에서|부터|까지|야|요|좀|그|저|몇|시|분|일정/g, " ")
    .split(/\s+/)
    .map(clean)
    .filter((token) => token.length >= 2);
}

function requestedMealSlot(text) {
  if (/아침|조식|breakfast/i.test(text)) return "breakfast";
  if (/점심|lunch/i.test(text)) return "lunch";
  if (/저녁|밤|dinner/i.test(text)) return "dinner";
  return "";
}

function itemInMealSlot(item, slot) {
  const hour = getKstHour(item.startsAt);
  if (slot === "breakfast") return hour < 11;
  if (slot === "lunch") return hour >= 10 && hour < 17;
  if (slot === "dinner") return hour >= 17;
  return false;
}

function explicitRequestedDate(text, items = []) {
  const dates = [...new Set(items.map((item) => dateKey(item.startsAt)).filter(Boolean))].sort();
  const monthDay = String(text || "").match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
  if (monthDay) {
    const month = Number(monthDay[1]);
    const day = Number(monthDay[2]);
    const matched = dates.find((date) => {
      const [, , dateMonth, dateDay] = date.match(/^(\d{4})-(\d{2})-(\d{2})$/) || [];
      return Number(dateMonth) === month && Number(dateDay) === day;
    });
    if (matched) return matched;
  }

  const isoDate = String(text || "").match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (isoDate) {
    const normalized = `${isoDate[1]}-${String(Number(isoDate[2])).padStart(2, "0")}-${String(Number(isoDate[3])).padStart(2, "0")}`;
    if (dates.includes(normalized)) return normalized;
  }

  if (/첫날|첫째|day\s*0?1|d\s*0?1/i.test(text)) return dates[0] || "";
  if (/둘째|두번째|2일|day\s*0?2|d\s*0?2/i.test(text)) return dates[1] || "";
  if (/셋째|세번째|3일|day\s*0?3|d\s*0?3/i.test(text)) return dates[2] || "";
  return "";
}

function valueAliases(value) {
  const cleanValue = clean(value);
  if (!cleanValue) return [];
  const values = [cleanValue];
  values.push(cleanValue.split(/\s+/)[0]);
  values.push(cleanValue.replace(/(관람|탐방|방문|식사|점심|저녁|아침|휴식|일정|본점|지점|점)$/g, ""));
  values.push(cleanValue.replace(/\s+/g, ""));
  return [...new Set(values.map(clean).filter((entry) => entry.length >= 2))].sort((a, b) => b.length - a.length);
}

function sameQuestionTargetFamily(a = {}, b = {}) {
  const aTitle = normalizeFamilyText(a.title || a.placeName);
  const bTitle = normalizeFamilyText(b.title || b.placeName);
  if (aTitle && aTitle === bTitle) return true;

  const aPlace = normalizeFamilyText(a.placeName || a.title);
  const bPlace = normalizeFamilyText(b.placeName || b.title);
  if (aPlace && aPlace === bPlace && a.category && a.category === b.category) return true;
  return Boolean(aPlace && aPlace === bPlace && normalizeFamilyText(a.title).includes(normalizeFamilyText(b.title).slice(0, 4)));
}

function normalizeFamilyText(value) {
  return normalizeMatchText(value).replace(/(관람|탐방|방문|일정|식사|점심|저녁|아침)$/g, "");
}

function sharedTitle(items = []) {
  const titles = uniqueClean(items.map((item) => itemTitle(item)));
  if (titles.length === 1) return titles[0];
  const firstTitle = titles[0] || "해당 일정";
  return `${firstTitle} 등 관련 일정`;
}

function uniqueClean(values = []) {
  return [...new Set(values.map(clean).filter(Boolean))];
}

function transportLabel(mode) {
  return (
    {
      walk: "도보",
      subway: "지하철",
      bus: "버스",
      taxi: "택시",
      car: "차량"
    }[mode] || "이동"
  );
}

function itemTitle(item = {}) {
  return clean(item.title || item.placeName || "해당 일정");
}

function timeRangeLabel(item = {}) {
  if (!hasTime(item)) return "시간 정보가 아직 없어요";
  const start = formatClock(item.startsAt);
  const end = formatClock(item.endsAt);
  return `${start}부터 ${end}까지`;
}

function eventTimeHint(item = {}, text = "") {
  if (!/드론|불꽃|공연|축제|쇼/.test(text)) return "";
  const memo = clean(item.memo);
  if (!memo) return "";
  const matches = [...memo.matchAll(/(\d{1,2})\s*시(?:\s*(\d{1,2})\s*분)?/g)];
  const labels = matches
    .map((match) => `${String(Number(match[1])).padStart(2, "0")}:${String(match[2] ? Number(match[2]) : 0).padStart(2, "0")}`)
    .filter((label) => label !== "00:00");
  return [...new Set(labels)].join(", ");
}

function hasTime(item = {}) {
  return Boolean(item.startsAt && item.endsAt);
}

function dateLabel(isoString) {
  const match = String(isoString || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return "해당 날짜";
  return `${Number(match[2])}월 ${Number(match[3])}일`;
}

function dateKey(isoString) {
  return String(isoString || "").slice(0, 10);
}

function normalizeMatchText(value) {
  return clean(value)
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

function clean(value) {
  return String(value || "").trim();
}
