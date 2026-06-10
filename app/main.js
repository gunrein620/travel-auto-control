import { buildParkingRouteLinks, buildRouteSegments, timingTone } from "../src/domain/routeSegments.js";

const app = document.querySelector("#root");
const ENNOIA_APP_URL = "https://ennoia.so/apps/openLink/d4c56c7f9185453f8851f8989a8aac9c";

let currentState = null;
let pendingDraft = null;
let activeDate = null;
let generationBusy = false;
let generationError = "";
let inspectBusy = false;
let naturalEditBusy = false;
let draftApplyBusy = false;
let naturalEditError = "";
let naturalEditText = "";
let naturalAddText = "";
let naturalSessionId = "";
let naturalChatMessages = [];
let naturalSlots = {};
let draftApplyRecommendationId = "";
let recentlyEditedItemId = null;
let recentlyEditedTimer = null;
let chatbotOpen = false;
let itineraryCollapsed = readItineraryCollapsed();
const parkingCache = new Map();
const routeSegmentCache = new Map();
const routeGeometryCache = new Map();

const statusMeta = {
  unchecked: { label: "미점검", tone: "neutral" },
  keep: { label: "유지", tone: "keep" },
  watch: { label: "주의", tone: "watch" },
  reroute: { label: "우회", tone: "reroute" }
};

await refresh();
registerServiceWorker();

async function refresh() {
  currentState = await api("/api/state");
  ensureActiveDate();
  render();
}

function render() {
  const activeAlerts = currentState.notifications.filter((notice) => !notice.dismissed);
  const days = getPlanDays();
  const activeDay = days.find((day) => day.date === activeDate) || days[0];
  routeSegmentCache.clear();

  app.innerHTML = `
    <header class="topbar">
      <div class="topbar-lead">
        <div>
          <p class="eyebrow">CONTROL PLAN</p>
          <h1>자동화 플래너</h1>
        </div>
      </div>
      <div class="topbar-actions">
        <a class="submission-link" href="${ENNOIA_APP_URL}" target="_blank" rel="noopener">Ennoia 앱 열기</a>
        <button class="soft-button" data-action="open-trip" ${generationDisabledAttr()}>${generationActionLabel("AI 일정 설계")}</button>
        <button class="icon-button" data-action="refresh" aria-label="새로고침">↻</button>
      </div>
    </header>

    <main class="shell">
      ${renderHome(activeAlerts.length)}
      ${renderGenerationStatus()}
      ${renderInspectionStatus()}

      ${renderPlannerBoard(days, activeDay)}

      <section class="insight-grid">
        <section class="alerts" aria-label="앱 안 알림">
          <div class="section-title">
            <h2>앱 안 알림</h2>
            <span>${activeAlerts.length}</span>
          </div>
          ${activeAlerts.length ? activeAlerts.map(renderNotification).join("") : `<p class="empty">아직 위험 알림이 없습니다.</p>`}
        </section>

        <section class="history" aria-label="여행기록 데이터">
          <div class="section-title">
            <h2>여행기록 데이터</h2>
            <span>${currentState.inspectionHistory.length}</span>
          </div>
          ${
            currentState.inspectionHistory.length
              ? currentState.inspectionHistory.slice(0, 5).map(renderHistory).join("")
              : `<p class="empty">점검을 실행하면 판단 결과가 기록됩니다.</p>`
          }
        </section>
      </section>
    </main>

    ${renderNaturalEditChatbot()}

    ${renderTripDialog()}
    ${renderAddAgentDialog()}
    ${renderAddDialog()}
    ${renderEditDialog()}
  `;

  hydrateRouteMaps();
  hydrateRouteParking();

  document.body.classList.toggle("chatbot-open", chatbotOpen);

  if (!document.body.classList.contains("app-ready")) {
    requestAnimationFrame(() => document.body.classList.add("app-ready"));
  }
}

function renderNaturalEditChatbot() {
  return `
    <section class="chatbot-widget${chatbotOpen ? " open" : ""}" aria-label="자연어 일정 수정 도우미">
      <section id="naturalChatbotPanel" class="chatbot-panel" aria-hidden="${!chatbotOpen}">
        <div class="chatbot-head">
          <div>
            <p class="eyebrow">AI Schedule Edit</p>
            <h2>AI 일정 검토 & 수정하기</h2>
          </div>
          <button type="button" class="icon-button" data-action="close-chatbot" aria-label="챗봇 닫기">×</button>
        </div>
        <div class="chatbot-messages">
          ${renderNaturalSlotSummary()}
          <div class="chat-message assistant">
            <small>Ennoia Agent</small>
            <p>바꾸고 싶은 일정등 편하게 물어보세요 바꿔드릴게요.</p>
          </div>
          <div class="draft-zone" aria-live="polite">
            ${naturalChatMessages.map(renderNaturalChatMessage).join("")}
            ${naturalEditBusy ? `<p class="draft pending">${thinkingDots()}<span class="thinking-label">AI 가 생각중</span></p>` : ""}
          </div>
        </div>
        ${naturalEditError ? `<p class="natural-error" role="alert">${escapeHtml(naturalEditError)}</p>` : ""}
        <form class="composer chatbot-composer" data-role="natural-form" aria-busy="${naturalEditBusy}">
          <div class="composer-row">
            <input id="naturalText" name="naturalText" aria-label="자연어로 일정 수정" placeholder="예: 이따 저녁은 삼겹살로 바꾸고 플래너에 적용해줘" autocomplete="off" value="${escapeHtml(naturalEditText)}" ${naturalEditInputDisabledAttr()} />
            <button type="submit" ${naturalEditDisabledAttr()}>${naturalEditSubmitLabel()}</button>
          </div>
        </form>
      </section>
      <button
        class="chatbot-launcher"
        type="button"
        data-action="toggle-chatbot"
        aria-label="${chatbotOpen ? "자연어 일정 수정 챗봇 닫기" : "자연어 일정 수정 챗봇 열기"}"
        aria-expanded="${chatbotOpen}"
        aria-controls="naturalChatbotPanel"
      >
        <span class="chatbot-launcher-icon" aria-hidden="true">✎</span>
        <span>AI 일정 수정</span>
      </button>
    </section>
  `;
}

function renderNaturalSlotSummary() {
  const entries = Object.entries(naturalSlots).filter(([, value]) => value !== undefined && value !== null && value !== "");
  if (entries.length === 0) return "";
  return `
    <div class="slot-summary" aria-label="현재 조율 조건">
      ${entries.map(([key, value]) => `<span>${escapeHtml(slotLabel(key, value))}</span>`).join("")}
    </div>
  `;
}

function renderNaturalChatMessage(message = {}) {
  const role = message.role === "user" ? "user" : "assistant";
  if (role === "assistant" && message.draft) return renderDraft(message.draft);
  return `
    <div class="chat-message ${role}">
      <small>${escapeHtml(naturalChatMessageLabel(message, role))}</small>
      <p>${escapeHtml(message.text || "")}</p>
    </div>
  `;
}

function naturalChatMessageLabel(message = {}, role = "assistant") {
  if (role === "user") return "나";
  if (message.source === "ennoia") return "Ennoia Agent";
  if (message.source === "fallback" || message.source === "agent") return "로컬 플래너 답변";
  return "Ennoia Agent";
}

function slotLabel(key, value) {
  const labels = {
    cuisine: "음식",
    headcount: "인원",
    budget: "예산",
    mood: "분위기",
    timeSlot: "시간대",
    indoorOutdoor: "환경",
    theme: "테마",
    duration: "소요",
    companion: "동행",
    placeType: "유형",
    transportMode: "이동",
    startTime: "출발",
    endTime: "도착"
  };
  const displayValue = Array.isArray(value) ? value.join(", ") : String(value);
  return `${labels[key] || key}: ${displayValue}`;
}

function setChatbotOpen(open) {
  chatbotOpen = open;
  document.body.classList.toggle("chatbot-open", open);
  const widget = document.querySelector(".chatbot-widget");
  widget?.classList.toggle("open", open);
  document.querySelector("#naturalChatbotPanel")?.setAttribute("aria-hidden", String(!open));
  const toggle = document.querySelector(".chatbot-launcher");
  if (toggle) {
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute("aria-label", open ? "자연어 일정 수정 챗봇 닫기" : "자연어 일정 수정 챗봇 열기");
  }
  if (open) focusNaturalEditInput();
}

function focusNaturalEditInput() {
  window.setTimeout(() => {
    const input = document.querySelector("#naturalText");
    if (!input || input.disabled) return;
    input.focus({ preventScroll: true });
  }, 80);
}

function readItineraryCollapsed() {
  try {
    return localStorage.getItem("itineraryCollapsed") === "1";
  } catch {
    return false;
  }
}

// 여행 일정(타임테이블)을 접었다 폈다 한다. 전체 재렌더 없이 클래스만 토글해
// 경로 지도 인스턴스를 보존하고, 펼칠 때 Leaflet 타일 크기를 다시 계산한다.
function setItineraryCollapsed(collapsed) {
  itineraryCollapsed = collapsed;
  try {
    localStorage.setItem("itineraryCollapsed", collapsed ? "1" : "0");
  } catch {
    // localStorage 미사용 환경은 무시
  }

  const board = document.querySelector(".planner-board");
  board?.classList.toggle("collapsed", collapsed);

  const toggle = board?.querySelector(".board-toggle");
  if (toggle) {
    toggle.setAttribute("aria-expanded", String(!collapsed));
    toggle.setAttribute("aria-label", collapsed ? "여행 일정 펼치기" : "여행 일정 접기");
  }

  if (!collapsed) {
    // 숨겨졌다 다시 보이는 지도는 타일이 깨지므로 크기를 재계산.
    requestAnimationFrame(() => {
      for (const canvas of document.querySelectorAll(".route-map-canvas")) {
        canvas._leafletMap?.invalidateSize();
      }
    });
  }
}

function heroSubline(alertCount) {
  const region = currentState.plan.region;
  if (!region) return `여행지를 입력해 일정을 만들어 보세요 · 알림 ${alertCount}개`;
  const travelers = currentState.plan.travelers;
  return `${region}${travelers ? ` · ${travelers}` : ""} · 알림 ${alertCount}개`;
}

function renderPlannerBoard(days, activeDay) {
  const hasPlan = currentState.plan.items.length > 0;

  if (!hasPlan) {
    return `
      <section class="planner-board empty" aria-label="여행 타임테이블">
        <div class="board-head">
          <div>
            <p class="eyebrow">Planner</p>
            <h2>여행 일정</h2>
          </div>
        </div>
        <div class="planner-empty">
          <p>아직 만든 일정이 없어요. 여행 조건을 입력하면 타임테이블이 채워집니다.</p>
          <button class="primary" data-action="open-trip" ${generationDisabledAttr()}>${generationActionLabel("AI로 일정 설계하기")}</button>
        </div>
      </section>
    `;
  }

  return `
    <section class="planner-board${itineraryCollapsed ? " collapsed" : ""}" aria-label="여행 타임테이블">
      <div class="board-head">
        <div>
          <p class="eyebrow">Planner</p>
          <h2>${escapeHtml(currentState.plan.title || "여행 일정")}</h2>
          <p>${escapeHtml(planRangeLabel())} · ${currentState.plan.items.length}개 일정</p>
        </div>
        <div class="board-head-actions">
          <button class="primary" data-action="inspect-all" ${inspectDisabledAttr()}>${inspectActionLabel("전체 점검")}</button>
          <button
            class="icon-button board-toggle"
            data-action="toggle-itinerary"
            aria-expanded="${!itineraryCollapsed}"
            aria-controls="plannerBody"
            aria-label="${itineraryCollapsed ? "여행 일정 펼치기" : "여행 일정 접기"}"
          >⌄</button>
        </div>
      </div>
      <div class="planner-body" id="plannerBody">
        <div class="day-tabs" role="tablist">
          ${days.map(renderDayTab).join("")}
        </div>
        <div class="quick-panel">
          <button data-action="show-add" class="soft-button">일정 추가</button>
          <button data-action="run-due" class="soft-button">체크포인트 실행</button>
          <button data-action="enable-push" class="soft-button">앱 알림 준비</button>
        </div>
        <section class="timeline" aria-label="${escapeHtml(activeDay?.date || "일정")}">
          ${activeDay?.items.length ? renderTimeline(activeDay.items) : `<p class="empty">이 날짜에는 아직 일정이 없습니다.</p>`}
        </section>
      </div>
    </section>
  `;
}

function renderHome(alertCount) {
  const source = generationSourceLabel(currentState.plan.generation);
  return `
    <section class="home-hero">
      <div class="hero-copy">
        <span class="date-pill">${escapeHtml(source)} 주도형</span>
        <h2>페스타루트에서 여행 일정을 설계하고, 검토하세요. 이동 중에는 계속 점검됩니다.</h2>
        <p>${escapeHtml(heroSubline(alertCount))}</p>
      </div>
      <div class="hero-actions">
        <button class="primary large" data-action="open-trip" ${generationDisabledAttr()}>${generationActionLabel("AI로 일정 설계하기")}</button>
        <button class="soft-button large" data-action="inspect-all" ${inspectDisabledAttr()}>${inspectActionLabel("현재 일정 점검")}</button>
      </div>
    </section>
  `;
}

function generationSourceLabel(generation) {
  if (!generation) return "연결 대기";
  if (generation.source === "ennoia") return "Ennoia";
  return "로컬 안전안";
}

function renderGenerationStatus() {
  if (generationBusy) {
    const steps = ["관광 정보 수집", "KTO 행사정보 확인", "주변 맛집·카페 매칭", "이동 동선·주차 점검", "타임테이블 구성"];
    return `
      <section class="generation-panel busy" aria-live="polite">
        <div class="gen-orbs" aria-hidden="true">
          <span class="gen-orb a"></span>
          <span class="gen-orb b"></span>
          <span class="gen-orb c"></span>
        </div>
        <div class="gen-busy-inner">
          <div class="gen-busy-copy">
            <span class="gen-chip"><span class="gen-chip-dot"></span>Ennoia AI</span>
            <h2>여행 일정을 짓는 중이에요</h2>
            <p>관광지와 행사 후보, 맛집, 이동 동선을 모아 가장 자연스러운 하루를 구성하고 있어요.</p>
            <ul class="gen-track" aria-label="일정 생성 진행 단계">
              ${steps
                .map(
                  (label, index) => `
                    <li style="--i: ${index}">
                      <span class="gen-track-dot" aria-hidden="true"></span>
                      ${escapeHtml(label)}
                    </li>
                  `
                )
                .join("")}
            </ul>
            <div class="gen-bar" aria-hidden="true"><span></span></div>
          </div>
          <div class="gen-skeleton" aria-hidden="true">
            ${[0, 1, 2]
              .map(
                () => `
                  <div class="gen-skel-row">
                    <span class="gen-skel-time"></span>
                    <span class="gen-skel-lines"><i></i><i></i></span>
                  </div>
                `
              )
              .join("")}
          </div>
        </div>
      </section>
    `;
  }

  if (generationError) {
    return `
      <section class="generation-panel error">
        <div>
          <p class="eyebrow">Generation</p>
          <h2>일정 생성 실패</h2>
          <p>${escapeHtml(generationError)}</p>
        </div>
      </section>
    `;
  }

  const generation = currentState.plan.generation;
  if (!generation) return "";
  const apiStatus = (generation.apiStatus || []).slice(0, 3);
  const events = (generation.eventSuggestions || []).slice(0, 3);
  return `
      <section class="generation-panel">
        <div>
        <p class="eyebrow">${generation.source === "ennoia" ? "Ennoia Agent" : "로컬 안전안"}</p>
        <h2>${escapeHtml(generation.modelStatus || "일정 생성 상태")}</h2>
        <p>${escapeHtml((generation.evidence || [])[0] || "생성된 일정은 점검 단계에서 API로 재확인합니다.")}</p>
        ${events.length ? renderEventSuggestions(events) : ""}
      </div>
      <div class="api-chips">
        ${apiStatus.map((status) => `<span>${escapeHtml(status)}</span>`).join("")}
      </div>
    </section>
  `;
}

// Reuses the same busy panel as itinerary generation so inspection feels familiar.
function renderInspectionStatus() {
  if (!inspectBusy) return "";
  const steps = ["날씨·운영시간 확인", "KTO 행사정보 대조", "이동 동선·교통 점검", "주차 여유 확인", "위험 신호 정리"];
  return `
    <section class="generation-panel busy" aria-live="polite">
      <div class="gen-orbs" aria-hidden="true">
        <span class="gen-orb a"></span>
        <span class="gen-orb b"></span>
        <span class="gen-orb c"></span>
      </div>
      <div class="gen-busy-inner">
        <div class="gen-busy-copy">
          <span class="gen-chip"><span class="gen-chip-dot"></span>Ennoia AI</span>
          <h2>현재 일정을 점검하는 중이에요</h2>
          <p>날씨와 운영시간, 행사 정보, 이동 동선과 주차 여유를 실시간 API로 다시 확인하고 있어요.</p>
          <ul class="gen-track" aria-label="일정 점검 진행 단계">
            ${steps
              .map(
                (label, index) => `
                  <li style="--i: ${index}">
                    <span class="gen-track-dot" aria-hidden="true"></span>
                    ${escapeHtml(label)}
                  </li>
                `
              )
              .join("")}
          </ul>
          <div class="gen-bar" aria-hidden="true"><span></span></div>
        </div>
        <div class="gen-skeleton" aria-hidden="true">
          ${[0, 1, 2]
            .map(
              () => `
                <div class="gen-skel-row">
                  <span class="gen-skel-time"></span>
                  <span class="gen-skel-lines"><i></i><i></i></span>
                </div>
              `
            )
            .join("")}
        </div>
      </div>
    </section>
  `;
}

function renderEventSuggestions(events) {
  return `
    <div class="event-suggestions" aria-label="KTO 행사 후보">
      <strong>KTO 행사 후보</strong>
      <ul>
        ${events
          .map(
            (event) => `
              <li>
                <span>${escapeHtml(event.title)}</span>
                <small>${escapeHtml([event.dateRange, event.area, event.reason].filter(Boolean).join(" · "))}</small>
              </li>
            `
          )
          .join("")}
      </ul>
    </div>
  `;
}

function renderDayTab(day, index) {
  const selected = day.date === activeDate;
  return `
    <button class="day-tab ${selected ? "active" : ""}" data-action="select-day" data-date="${day.date}" role="tab" aria-selected="${selected}">
      <strong>Day ${String(index + 1).padStart(2, "0")}</strong>
      <span>${escapeHtml(formatDayLabel(day.date))}</span>
    </button>
  `;
}

function renderTimeline(items) {
  const routeSegments = buildRouteSegments(items);
  routeSegments.forEach((segment) => routeSegmentCache.set(segment.id, segment));
  return items
    .map((item, index) => {
      const route = routeSegments[index];
      return `${renderItem(item, index)}${route ? renderRouteSegment(route) : ""}`;
    })
    .join("");
}

function renderItem(item, index) {
  const meta = statusMeta[item.status] || statusMeta.unchecked;
  const editedClass = item.id === recentlyEditedItemId ? " just-edited" : "";
  return `
    <article class="plan-item ${meta.tone}${editedClass}" data-item-id="${escapeHtml(item.id)}">
      <div class="time-rail">
        <span class="order">${String(index + 1).padStart(2, "0")}</span>
        <strong>${clock(item.startsAt)}</strong>
        <span>${clock(item.endsAt)}</span>
      </div>
      <div class="item-body">
        <div class="item-head">
          <div>
            <h3>${escapeHtml(item.title)}</h3>
            <p>${escapeHtml(item.placeName)} · ${transportLabel(item.transportMode)} · ${categoryLabel(item.category)}</p>
          </div>
          <span class="badge ${meta.tone}">${meta.label}</span>
        </div>
        <p class="memo">${escapeHtml(item.memo || "메모 없음")}</p>
        ${item.lastInspection ? `<p class="inspection-summary">${escapeHtml(item.lastInspection.summary)}</p>` : ""}
        <div class="actions">
          <button data-action="inspect" data-id="${item.id}">지금 점검</button>
          <button data-action="show-edit" data-id="${item.id}" class="ghost">수정</button>
          <button data-action="delete" data-id="${item.id}" class="ghost">삭제</button>
        </div>
      </div>
    </article>
  `;
}

function renderRouteSegment(segment) {
  return `
    <article class="route-card ${segment.mode} ${segment.timingTone}" data-route-segment data-route-id="${escapeHtml(segment.id)}" data-available-minutes="${escapeHtml(String(segment.availableMinutes ?? ""))}">
      <div class="route-rail">
        <span class="route-icon" aria-hidden="true">${routeIcon(segment.mode)}</span>
        <strong>${escapeHtml(segment.modeLabel)}</strong>
        <span>${escapeHtml(segment.timeLabel)}</span>
      </div>
      <div class="route-body">
        <div class="route-head">
          <div>
            <p class="eyebrow">이동 경로</p>
            <h3>${escapeHtml(segment.fromName)} → ${escapeHtml(segment.toName)}</h3>
            <p class="route-detail">${escapeHtml(segment.distanceLabel)} · 예상 ${escapeHtml(segment.timeLabel)} · ${escapeHtml(segment.availableLabel)}</p>
            ${segment.modeReason ? `<p class="route-reason">${escapeHtml(segment.modeReason)}</p>` : ""}
          </div>
          <span class="route-badge ${segment.timingTone}">${escapeHtml(routeTimingLabel(segment.timingTone))}</span>
        </div>
        <div class="route-map" data-route-map>
          <div class="route-map-toolbar">
            <span>실제 도로 경로</span>
            <strong>${escapeHtml(routeMapProviderLabel(segment.mode))}</strong>
          </div>
          ${renderRouteMapCanvas({
            from: segment.from,
            to: segment.to,
            mode: segment.mode,
            label: `${segment.fromName}에서 ${segment.toName}까지 ${segment.modeLabel} 경로`,
            externalUrl: segment.mapProvider === "naver" ? segment.naverUrl : segment.mapEmbedUrl,
            departAt: segment.from?.endsAt,
            primary: true
          })}
        </div>
        ${
          segment.needsParking
            ? `<div class="parking-panel" data-parking-panel data-parking-key="${escapeHtml(segment.id)}" data-lat="${escapeHtml(segment.parkingQuery.lat)}" data-lng="${escapeHtml(segment.parkingQuery.lng)}" data-place="${escapeHtml(segment.parkingQuery.placeName)}">
                <div class="parking-head">
                  <strong>도착지 주변 주차장</strong>
                  <span>PK6 조회 준비</span>
                </div>
                <p>자가용 이동이라 도착지 주변 주차장 정보를 확인합니다.</p>
              </div>`
            : ""
        }
        <div class="route-meta-grid">
          <span>출발 ${escapeHtml(clock(segment.from.endsAt))}</span>
          <span>도착 ${escapeHtml(clock(segment.to.startsAt))}</span>
          <span>${escapeHtml(routeTimingDescription(segment))}</span>
        </div>
        <div class="route-actions">
          <a href="${escapeHtml(segment.kakaoUrl)}" target="_blank" rel="noopener noreferrer">카카오맵으로 열기</a>
          <a href="${escapeHtml(segment.naverUrl)}" target="_blank" rel="noopener noreferrer">네이버맵으로 열기</a>
        </div>
      </div>
    </article>
  `;
}

function routeTimingDescription(segment) {
  if (segment.timingTone === "tight") return "이동 시간이 일정 간격보다 길거나 같아 출발 시간 조정 필요";
  if (segment.timingTone === "relaxed") return "이동 후 여유 시간 확보";
  return "일정 간격 안에서 이동 가능";
}

function hydrateRouteParking() {
  const panels = [...document.querySelectorAll("[data-parking-panel]")];
  for (const panel of panels) {
    const lat = panel.dataset.lat;
    const lng = panel.dataset.lng;
    const place = panel.dataset.place || "도착지";
    const cacheKey = `${lat},${lng}`;
    if (parkingCache.has(cacheKey)) {
      panel.outerHTML = renderParkingResult(parkingCache.get(cacheKey), place);
      continue;
    }
    loadParkingPanel(panel, { lat, lng, place, cacheKey });
  }
}

async function loadParkingPanel(panel, { lat, lng, place, cacheKey }) {
  const status = panel.querySelector(".parking-head span");
  if (status) status.textContent = "PK6 조회 중";
  try {
    const result = await api(`/api/parking/nearby?lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}&radius=900&size=4`);
    parkingCache.set(cacheKey, result);
    updateRouteMapForParking(panel.dataset.parkingKey, result.items?.[0]);
    if (panel.isConnected) panel.outerHTML = renderParkingResult(result, place);
  } catch (error) {
    const result = {
      status: "client-error",
      items: [],
      message: `주차장 조회 실패: ${error.message}`
    };
    parkingCache.set(cacheKey, result);
    if (panel.isConnected) panel.outerHTML = renderParkingResult(result, place);
  }
}

function updateRouteMapForParking(routeId, parking) {
  const segment = routeSegmentCache.get(routeId);
  const linked = buildParkingRouteLinks(segment, parking);
  if (!linked) return;
  const routeCard = [...document.querySelectorAll("[data-route-segment]")].find((element) => element.dataset.routeId === routeId);
  const map = routeCard?.querySelector("[data-route-map]");
  if (!map) return;
  map.classList.add("linked-parking");
  map.innerHTML = renderParkingLinkedMap(segment, linked);
  hydrateRouteMaps(map);
}

function renderParkingLinkedMap(segment, linked) {
  return `
    <div class="route-map-toolbar">
      <span>주차 연계 도로 경로</span>
      <strong>OSM ROUTE</strong>
    </div>
    <div class="route-leg-list">
      <section class="route-leg">
        <div class="route-leg-head">
          <strong>1. 차량 주차 경로</strong>
          <span>${escapeHtml(segment.fromName)} → ${escapeHtml(linked.parkingName)}</span>
        </div>
        ${renderRouteMapCanvas({
          from: segment.from,
          to: { placeName: linked.parkingName, lat: linked.parkingLat, lng: linked.parkingLng },
          mode: "car",
          label: `${segment.fromName}에서 ${linked.parkingName}까지 차량 주차 경로`,
          externalUrl: linked.carToParkingUrl
        })}
      </section>
      <section class="route-leg">
        <div class="route-leg-head">
          <strong>2. 주차 후 도보 연결</strong>
          <span>${escapeHtml(linked.parkingName)} → ${escapeHtml(linked.destinationName)} ${linked.parkingDistanceLabel ? `· ${escapeHtml(linked.parkingDistanceLabel)}` : ""}</span>
        </div>
        ${renderRouteMapCanvas({
          from: { placeName: linked.parkingName, lat: linked.parkingLat, lng: linked.parkingLng },
          to: segment.to,
          mode: "walk",
          label: `${linked.parkingName}에서 ${linked.destinationName}까지 도보 경로`,
          externalUrl: linked.walkToDestinationUrl
        })}
      </section>
    </div>
    <p class="route-map-fallback">
      실시간 교통과 만차 여부는
      <a href="${escapeHtml(linked.carToParkingUrl)}" target="_blank" rel="noopener noreferrer">차량 경로</a>
      또는
      <a href="${escapeHtml(linked.walkToDestinationUrl)}" target="_blank" rel="noopener noreferrer">도보 연결</a>
      에서 최종 확인하세요.
    </p>
  `;
}

function renderRouteMapCanvas({ from, to, mode, label, externalUrl, departAt, primary }) {
  return `
    <div
      class="route-map-canvas"
      data-live-route-map
      data-route-mode="${escapeHtml(mode)}"
      data-route-label="${escapeHtml(label)}"
      data-external-url="${escapeHtml(externalUrl)}"
      data-depart-at="${escapeHtml(departAt || "")}"
      data-route-primary="${primary ? "true" : ""}"
      data-from-lat="${escapeHtml(routeCoordinate(from?.lat))}"
      data-from-lng="${escapeHtml(routeCoordinate(from?.lng))}"
      data-to-lat="${escapeHtml(routeCoordinate(to?.lat))}"
      data-to-lng="${escapeHtml(routeCoordinate(to?.lng))}"
    >
      <span class="map-loading">도로 경로 불러오는 중</span>
    </div>
  `;
}

async function hydrateRouteMaps(root = document) {
  const maps = [...root.querySelectorAll("[data-live-route-map]:not([data-route-hydrated])")];
  for (const mapElement of maps) {
    mapElement.dataset.routeHydrated = "true";
    loadRouteMap(mapElement);
  }
}

async function loadRouteMap(mapElement) {
  if (!window.L) {
    renderRouteMapStatus(mapElement, "지도 라이브러리를 불러오지 못했습니다.");
    return;
  }

  const params = new URLSearchParams({
    fromLat: mapElement.dataset.fromLat || "",
    fromLng: mapElement.dataset.fromLng || "",
    toLat: mapElement.dataset.toLat || "",
    toLng: mapElement.dataset.toLng || "",
    mode: mapElement.dataset.routeMode || "walk",
    departAt: mapElement.dataset.departAt || ""
  });
  const cacheKey = params.toString();

  try {
    if (!routeGeometryCache.has(cacheKey)) {
      routeGeometryCache.set(cacheKey, api(`/api/routes/segment?${cacheKey}`));
    }
    const route = await routeGeometryCache.get(cacheKey);
    if (route.status !== "ok" || !Array.isArray(route.points) || route.points.length < 2) {
      renderRouteMapStatus(mapElement, route.message || "경로선을 만들 좌표가 부족합니다.");
      return;
    }
    drawRouteMap(mapElement, route);
  } catch (error) {
    renderRouteMapStatus(mapElement, `경로 조회 실패: ${error.message}`);
  }
}

function drawRouteMap(mapElement, route) {
  mapElement.innerHTML = "";
  mapElement.classList.add("ready");

  const latLngs = route.points.map((point) => [point.lat, point.lng]);
  const map = window.L.map(mapElement, {
    zoomControl: false,
    scrollWheelZoom: false,
    boxZoom: false,
    keyboard: false,
    attributionControl: true
  });

  window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap"
  }).addTo(map);

  const color = routeColor(mapElement.dataset.routeMode);
  const polyline = window.L.polyline(latLngs, {
    color,
    weight: 6,
    opacity: 0.9,
    lineCap: "round",
    lineJoin: "round"
  }).addTo(map);

  window.L.marker(latLngs[0], {
    icon: routeEndpointIcon("start", "출발"),
    interactive: false,
    keyboard: false,
    zIndexOffset: 600
  }).addTo(map);
  window.L.marker(latLngs[latLngs.length - 1], {
    icon: routeEndpointIcon("finish", "도착"),
    interactive: false,
    keyboard: false,
    zIndexOffset: 700
  }).addTo(map);

  map.fitBounds(polyline.getBounds(), { padding: [72, 72], maxZoom: 16 });
  setTimeout(() => map.invalidateSize(), 60);
  // 접기/펼치기 토글 후 타일 재계산을 위해 인스턴스를 보관.
  mapElement._leafletMap = map;

  const sourceLabel = route.durationSource === "kakao" ? "Kakao 실시간" : "추정";
  const summary = document.createElement("div");
  summary.className = "map-summary";
  summary.textContent = `${routeProfileLabel(route.profile)} · ${formatMeters(route.distanceMeters)} · 약 ${formatSeconds(route.durationSeconds)} · ${sourceLabel}`;
  mapElement.append(summary);

  // 헤더 통일을 위해 도로 실측치를 지도 요소에 보관.
  mapElement.dataset.roadDistanceMeters = String(route.distanceMeters || 0);
  mapElement.dataset.roadDurationSeconds = String(route.durationSeconds || 0);
  mapElement.dataset.roadDurationSource = route.durationSource || "estimate";

  const card = mapElement.closest(".route-card");
  if (mapElement.dataset.routePrimary === "true") {
    // 기본 경로: 도로 거리/현실화 시간으로 헤더를 통일.
    if (route.distanceMeters > 0 && route.durationSeconds > 0) {
      writeCardEstimate(card, {
        distanceMeters: route.distanceMeters,
        durationSeconds: route.durationSeconds,
        sourceLabel
      });
    }
  } else if (mapElement.closest(".linked-parking")) {
    // 주차 연계 경로: 차량(출발→주차장)+도보(주차장→목적지) 합산을 door-to-door로 표시.
    applyParkingTotalToCard(card);
  }
}

function routeEndpointIcon(type, label) {
  return window.L.divIcon({
    className: "route-marker-icon",
    html: `<span class="route-marker ${type}" aria-hidden="true"><span class="route-marker-flag">${escapeHtml(label)}</span><span class="route-marker-pole"></span></span>`,
    iconSize: [54, 42],
    iconAnchor: [9, 38]
  });
}

// 주차 연계 구간의 두 다리(차량+도보) 실측치를 합산해 헤더를 통일한다.
function applyParkingTotalToCard(card) {
  if (!card) return;
  const legs = [...card.querySelectorAll(".linked-parking [data-live-route-map]")].filter(
    (leg) => leg.dataset.roadDurationSeconds
  );
  if (!legs.length) return;

  let distanceMeters = 0;
  let durationSeconds = 0;
  let hasKakao = false;
  for (const leg of legs) {
    distanceMeters += Number(leg.dataset.roadDistanceMeters) || 0;
    durationSeconds += Number(leg.dataset.roadDurationSeconds) || 0;
    if (leg.dataset.roadDurationSource === "kakao") hasKakao = true;
  }
  if (!(durationSeconds > 0)) return;

  writeCardEstimate(card, {
    distanceMeters,
    durationSeconds,
    sourceLabel: hasKakao ? "Kakao 실시간 포함" : "추정"
  });
}

// 카드 헤더 상세·레일 시간·여유 뱃지를 실측 기반 값으로 통일.
function writeCardEstimate(card, { distanceMeters, durationSeconds, sourceLabel }) {
  if (!card) return;
  const distanceText = formatMeters(distanceMeters);
  const minutes = Math.max(1, Math.round(durationSeconds / 60));
  const timeText = `${minutes}분`;

  const available = Number(card.dataset.availableMinutes);
  const availableLabel = Number.isFinite(available) ? `일정 간격 ${available}분` : "여유 시간 미확인";

  const detail = card.querySelector(".route-detail");
  if (detail) {
    detail.textContent = `${distanceText} · 예상 ${timeText} · ${availableLabel} · ${sourceLabel}`;
  }

  const rail = card.querySelector(".route-rail span:last-child");
  if (rail) rail.textContent = timeText;

  if (Number.isFinite(available)) {
    const tone = timingTone(minutes, available);
    card.classList.remove("tight", "normal", "relaxed");
    card.classList.add(tone);
    const badge = card.querySelector(".route-badge");
    if (badge) {
      badge.classList.remove("tight", "normal", "relaxed");
      badge.classList.add(tone);
      badge.textContent = routeTimingLabel(tone);
    }
  }
}

function renderRouteMapStatus(mapElement, message) {
  const externalUrl = mapElement.dataset.externalUrl || "#";
  mapElement.innerHTML = `
    <div class="map-error">
      <strong>지도 경로 확인 필요</strong>
      <span>${escapeHtml(message)}</span>
      <a href="${escapeHtml(externalUrl)}" target="_blank" rel="noopener noreferrer">지도 앱에서 열기</a>
    </div>
  `;
}

function renderParkingResult(result, placeName) {
  const items = Array.isArray(result.items) ? result.items.slice(0, 3) : [];
  if (!items.length) {
    return `
      <div class="parking-panel empty-parking">
        <div class="parking-head">
          <strong>도착지 주변 주차장</strong>
          <span>${escapeHtml(parkingStatusLabel(result.status))}</span>
        </div>
        <p>${escapeHtml(result.message || `${placeName} 주변 주차장은 지도 앱에서 최종 확인이 필요합니다.`)}</p>
      </div>
    `;
  }

  return `
    <div class="parking-panel ready">
      <div class="parking-head">
        <strong>도착지 주변 주차장</strong>
        <span>Kakao PK6 ${items.length}곳</span>
      </div>
      <div class="parking-list">
        ${items
          .map(
            (item, index) => `
              <a class="parking-option ${index === 0 ? "recommended" : ""}" href="${escapeHtml(item.placeUrl || "#")}" target="_blank" rel="noopener noreferrer">
                <span>
                  <strong>${index === 0 ? "추천 주차장 · " : ""}${escapeHtml(item.name)}</strong>
                  <small>${escapeHtml(item.address || "주소 미확인")}</small>
                </span>
                <em>${escapeHtml(item.distanceLabel)}</em>
              </a>
            `
          )
          .join("")}
      </div>
      <p class="parking-note">첫 번째 주차장을 차량 경로 목적지로 연결했습니다. 요금·만차·운영시간은 지도 상세/전화로 확인하세요.</p>
    </div>
  `;
}

function parkingStatusLabel(status) {
  if (status === "missing-key") return "키 미설정";
  if (status === "empty") return "결과 없음";
  if (status === "invalid-coordinate") return "좌표 없음";
  if (String(status || "").startsWith("error")) return "API 오류";
  return "확인 필요";
}

function renderNotification(notice) {
  return `
    <article class="notice ${notice.severity}">
      <div>
        <h3>${escapeHtml(notice.title)}</h3>
        <p>${escapeHtml(notice.message)}</p>
        <small>${escapeHtml(notice.reason)}</small>
      </div>
      <div class="notice-actions">
        ${
          notice.suggestedPatch
            ? `<button data-action="apply-notice" data-id="${notice.id}">${notice.actionLabel}</button>`
            : `<button data-action="dismiss-notice" data-id="${notice.id}">${notice.actionLabel}</button>`
        }
        <button class="ghost" data-action="dismiss-notice" data-id="${notice.id}">무시</button>
      </div>
    </article>
  `;
}

function renderHistory(entry) {
  const item = currentState.plan.items.find((planItem) => planItem.id === entry.itemId);
  return `
    <article class="history-row">
      <span class="badge ${(entry.decision.status || "unchecked")}">${statusMeta[entry.decision.status]?.label || "점검"}</span>
      <div>
        <strong>${escapeHtml(item?.title || "삭제된 일정")}</strong>
        <p>${escapeHtml(entry.decision.reason)}</p>
      </div>
    </article>
  `;
}

function renderDraft(draft) {
  const sourceLabel =
    draft.source === "ennoia" ? "Ennoia LLM 초안" : draft.source === "agent" ? "일정수정 에이전트 초안" : "규칙 기반 fallback";
  const statusLine = draft.modelStatus ? `<small>${escapeHtml(sourceLabel)} · ${escapeHtml(draft.modelStatus)}</small>` : `<small>${escapeHtml(sourceLabel)}</small>`;
  const applyLabel = draftApplyBusy ? `${thinkingDots("solid")}<span>적용 중...</span>` : "플래너에 적용";
  if (draft.needsClarification) {
    return `
      <div class="draft">
        ${statusLine}
        <p>${escapeHtml(draft.question)}</p>
        ${renderDraftChoices(draft)}
      </div>
    `;
  }
  const operationLabel = draft.operation === "add" ? "새 일정 추가" : "기존 일정 수정";
  return `
    <div class="draft">
      ${statusLine}
      <span class="draft-mode">${operationLabel}</span>
      <p>${escapeHtml(draft.confirmationMessage)}</p>
      ${draft.resolutionMessage ? `<p class="draft-resolution">${escapeHtml(draft.resolutionMessage)}</p>` : ""}
      ${renderDraftRecommendations(draft)}
      <button type="button" data-action="apply-draft" ${draftApplyBusy ? 'disabled aria-busy="true"' : ""}>${applyLabel}</button>
    </div>
  `;
}

function renderDraftChoices(draft = {}) {
  const choices = Array.isArray(draft.choices) ? draft.choices : [];
  if (choices.length === 0) return "";
  return `
    <div class="choice-chips" role="list" aria-label="선택지">
      ${choices
        .map((choice, index) => {
          const label = choice.label || choice.value || `선택 ${index + 1}`;
          const value = choice.value || label;
          return `
            <button
              type="button"
              data-action="apply-choice"
              data-value="${escapeHtml(value)}"
              role="listitem"
              ${naturalEditBusy ? 'disabled aria-busy="true"' : ""}
            >${escapeHtml(label)}</button>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderDraftRecommendations(draft = {}) {
  const recommendations = Array.isArray(draft.recommendations) && draft.recommendations.length > 0 ? draft.recommendations : [];
  if (recommendations.length === 0) return "";
  return `
    <div class="draft-recommendations" role="list" aria-label="추천 후보">
      ${recommendations
        .map(
          (item, index) => {
            const recommendationId = item.id || `recommendation-${index}`;
            const isApplying = draftApplyBusy && draftApplyRecommendationId === recommendationId;
            return `
              <button
                type="button"
                class="draft-recommendation"
                data-action="apply-recommendation"
                data-id="${escapeHtml(recommendationId)}"
                ${draftApplyBusy ? 'disabled aria-busy="true"' : ""}
                role="listitem"
              >
                <span class="draft-rec-index">${index + 1}</span>
                <span class="draft-rec-copy">
                  <strong>${escapeHtml(item.name || item.placeName || "장소 후보")}</strong>
                  <span>${escapeHtml([item.address, item.distanceLabel].filter(Boolean).join(" · "))}</span>
                  ${item.reason ? `<small>${escapeHtml(item.reason)}</small>` : ""}
                </span>
                <span class="draft-rec-action">${isApplying ? `${thinkingDots("solid")}<span>적용 중...</span>` : "이 후보 적용"}</span>
              </button>
            `;
          }
        )
        .join("")}
    </div>
  `;
}

function renderTripDialog() {
  return `
    <dialog id="tripDialog" class="dialog trip-dialog">
      <form method="dialog" data-role="trip-form">
        <div class="dialog-head">
          <div>
            <p class="eyebrow">AI Planner</p>
            <h2>추천형 일정 설계</h2>
          </div>
          <button type="button" data-action="close-dialog" class="icon-button" aria-label="닫기">×</button>
        </div>
        <div class="grid-2">
          <label>여행 지역 <input name="region" placeholder="예: 부산시, 대구시, 전주" value="${escapeHtml(defaultTripRegion())}" /></label>
          <label>숙소 주소 <input name="lodgingArea" placeholder="예: 부산 해운대구 해운대해변로 264" /></label>
        </div>
        <div class="grid-2">
          <label>시작일 <input name="startDate" type="date" /></label>
          <label>종료일 <input name="endDate" type="date" /></label>
        </div>
        <fieldset class="transport-toggle" aria-label="이동 방식">
          <legend>이동 방식</legend>
          <label class="transport-option">
            <input type="radio" name="transportMode" value="car" checked />
            <span>자가용</span>
          </label>
          <label class="transport-option">
            <input type="radio" name="transportMode" value="subway" />
            <span>대중교통</span>
          </label>
        </fieldset>
        <label>요청사항
          <textarea name="requests" rows="5" placeholder="예: 4인 가족(초등학생 2명), 역사 관광지 위주, 아이가 지루하지 않은 동선, 맛집투어, 긴 대기 피하기"></textarea>
        </label>
        <button class="primary full" type="submit" ${generationDisabledAttr()}>${generationActionLabel("Ennoia로 일정 생성")}</button>
      </form>
    </dialog>
  `;
}

function defaultTripRegion() {
  return currentState?.plan?.region || "";
}

function showTripDialog() {
  const tripDialog = document.querySelector("#tripDialog");
  if (!tripDialog) return;
  const startDateInput = tripDialog.querySelector('[name="startDate"]');
  const endDateInput = tripDialog.querySelector('[name="endDate"]');
  if (startDateInput) startDateInput.value = "";
  if (endDateInput) endDateInput.value = "";
  tripDialog.showModal();
}

function renderAddAgentDialog() {
  return `
    <dialog id="addAgentDialog" class="dialog">
      <form method="dialog" data-role="natural-add-form">
        <div class="dialog-head">
          <div>
            <p class="eyebrow">AI Schedule Edit</p>
            <h2>자연어로 일정 추가</h2>
          </div>
          <button type="button" data-action="close-dialog" class="icon-button" aria-label="닫기">×</button>
        </div>
        <label>추가하거나 바꿀 내용
          <textarea name="naturalAddText" rows="4" placeholder="예: 둘째날 점심에 한식집 하나 추가해줘">${escapeHtml(naturalAddText)}</textarea>
        </label>
        <div class="dialog-actions">
          <button class="primary full" type="submit" ${naturalEditDisabledAttr()}>${naturalEditSubmitLabel()}</button>
          <button class="ghost full" type="button" data-action="show-manual-add">직접 입력</button>
        </div>
      </form>
    </dialog>
  `;
}

function renderAddDialog() {
  return `
    <dialog id="addDialog" class="dialog">
      <form method="dialog" data-role="add-form">
        <div class="dialog-head">
          <h2>직접 일정 추가</h2>
          <button type="button" data-action="close-dialog" class="icon-button" aria-label="닫기">×</button>
        </div>
        <label>제목 <input name="title" required placeholder="예: 경복궁 관람" /></label>
        <label>장소 <input name="placeName" required placeholder="장소명" /></label>
        <label>주소 <input name="address" placeholder="주소" /></label>
        <div class="grid-2">
          <label>시작 <input name="startsAt" type="datetime-local" required /></label>
          <label>종료 <input name="endsAt" type="datetime-local" required /></label>
        </div>
        <div class="grid-2">
          <label>이동수단
            <select name="transportMode">
              <option value="walk">도보</option>
              <option value="subway">지하철</option>
              <option value="bus">버스</option>
              <option value="taxi">택시</option>
              <option value="car">자가용</option>
            </select>
          </label>
          <label>분류
            <select name="category">
              <option value="indoor">실내</option>
              <option value="outdoor">야외</option>
              <option value="meal">식사</option>
            </select>
          </label>
        </div>
        <label>메모 <textarea name="memo" rows="3" placeholder="조건이나 선호"></textarea></label>
        <button class="primary full" type="submit">추가하기</button>
      </form>
    </dialog>
  `;
}

function renderEditDialog() {
  return `
    <dialog id="editDialog" class="dialog">
      <form method="dialog" data-role="edit-form">
        <div class="dialog-head">
          <h2>일정 수정</h2>
          <button type="button" data-action="close-dialog" class="icon-button" aria-label="닫기">×</button>
        </div>
        <input type="hidden" name="id" />
        <label>제목 <input name="title" required /></label>
        <label>장소 <input name="placeName" required /></label>
        <label>주소 <input name="address" /></label>
        <div class="grid-2">
          <label>위도 <input name="lat" inputmode="decimal" /></label>
          <label>경도 <input name="lng" inputmode="decimal" /></label>
        </div>
        <div class="grid-2">
          <label>시작 <input name="startsAt" type="datetime-local" required /></label>
          <label>종료 <input name="endsAt" type="datetime-local" required /></label>
        </div>
        <div class="grid-2">
          <label>이동수단
            <select name="transportMode">
              <option value="walk">도보</option>
              <option value="subway">지하철</option>
              <option value="bus">버스</option>
              <option value="taxi">택시</option>
              <option value="car">자가용</option>
            </select>
          </label>
          <label>분류
            <select name="category">
              <option value="indoor">실내</option>
              <option value="outdoor">야외</option>
              <option value="meal">식사</option>
            </select>
          </label>
        </div>
        <label>이동 준비 시간(분) <input name="travelMinutesBefore" type="number" min="0" max="240" /></label>
        <label>메모 <textarea name="memo" rows="3"></textarea></label>
        <button class="primary full" type="submit">수정 저장</button>
      </form>
    </dialog>
  `;
}

document.addEventListener("click", async (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  const action = button.dataset.action;
  const id = button.dataset.id;
  if (!action) return;

  if (action === "refresh") await refresh();
  if (action === "toggle-chatbot") setChatbotOpen(!chatbotOpen);
  if (action === "close-chatbot") setChatbotOpen(false);
  if (action === "toggle-itinerary") setItineraryCollapsed(!itineraryCollapsed);
  if (action === "close-dialog") button.closest("dialog")?.close();
  if (action === "open-trip" && !generationBusy) showTripDialog();
  if (action === "select-day") {
    activeDate = button.dataset.date;
    render();
  }
  if (action === "show-add") showAddAgentDialog();
  if (action === "show-manual-add") showManualAddDialog();
  if (action === "show-edit") showEditDialog(id);
  if (action === "inspect") await mutate(`/api/items/${id}/inspect`, {});
  if (action === "inspect-all" && !inspectBusy) await runInspectAll();
  if (action === "run-due") await mutate(`/api/inspect/due?now=${encodeURIComponent(new Date().toISOString())}`, {});
  if (action === "delete") await remove(`/api/items/${id}`);
  if (action === "apply-notice") await mutate(`/api/notifications/${id}/apply`, {});
  if (action === "dismiss-notice") await mutate(`/api/notifications/${id}/dismiss`, {});
  if (action === "apply-choice" && !naturalEditBusy) await requestNaturalDraft(button.dataset.value || button.textContent || "", { mode: "update", fromChoice: true });
  if (action === "apply-draft" && pendingDraft && !draftApplyBusy) await applyPendingDraft();
  if (action === "apply-recommendation" && pendingDraft && !draftApplyBusy) await applyPendingDraft(id);
  if (action === "enable-push") await preparePush();
});

document.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.target;

  if (form.dataset.role === "trip-form") {
    if (generationBusy) return;
    const body = Object.fromEntries(new FormData(form).entries());
    body.requests = String(body.requests || "").trim();
    document.querySelector("#tripDialog").close();
    generationBusy = true;
    generationError = "";
    render();
    scrollGenerationPanelIntoView();
    try {
      const result = await api("/api/trips/generate", { method: "POST", body });
      currentState = result.state;
      activeDate = currentState.plan.startDate || currentState.plan.date;
      resetNaturalEditChat();
    } catch (error) {
      generationError = error.message;
    } finally {
      generationBusy = false;
      ensureActiveDate();
      render();
    }
  }

  if (form.dataset.role === "natural-form") {
    const text = new FormData(form).get("naturalText")?.toString() || "";
    naturalEditText = text;
    if (!text.trim()) {
      naturalEditError = "수정할 내용을 입력해 주세요.";
      render();
      return;
    }
    await requestNaturalDraft(text, { mode: "update" });
  }

  if (form.dataset.role === "natural-add-form") {
    const text = new FormData(form).get("naturalAddText")?.toString() || "";
    naturalAddText = text;
    if (!text.trim()) {
      naturalEditError = "추가할 내용을 입력해 주세요.";
      render();
      return;
    }
    document.querySelector("#addAgentDialog")?.close();
    await requestNaturalDraft(text, { mode: "add_or_update" });
  }

  if (form.dataset.role === "add-form") {
    const data = Object.fromEntries(new FormData(form).entries());
    data.startsAt = `${data.startsAt}:00+09:00`;
    data.endsAt = `${data.endsAt}:00+09:00`;
    await mutate("/api/items", data);
    document.querySelector("#addDialog").close();
  }

  if (form.dataset.role === "edit-form") {
    const data = Object.fromEntries(new FormData(form).entries());
    const id = data.id;
    delete data.id;
    data.startsAt = `${data.startsAt}:00+09:00`;
    data.endsAt = `${data.endsAt}:00+09:00`;
    await patch(`/api/items/${id}`, data);
    document.querySelector("#editDialog").close();
  }
});

function generationActionLabel(label) {
  return generationBusy ? "생성 중..." : label;
}

function generationDisabledAttr() {
  return generationBusy ? 'disabled aria-busy="true"' : "";
}

// Show the same busy panel as itinerary generation, keep it visible for a beat
// even when the API answers quickly, and avoid a mid-animation re-render: call
// the API directly, then swap results in with a single render once both resolve.
async function runInspectAll() {
  inspectBusy = true;
  render();
  scrollGenerationPanelIntoView();
  const minVisible = new Promise((resolve) => setTimeout(resolve, 1100));
  try {
    const [result] = await Promise.all([
      api("/api/inspect/all", { method: "POST", body: {} }),
      minVisible
    ]);
    currentState = result.state || (await api("/api/state"));
    ensureActiveDate();
  } finally {
    inspectBusy = false;
    render();
  }
}

function inspectActionLabel(label) {
  return inspectBusy ? "점검 중..." : label;
}

function inspectDisabledAttr() {
  return inspectBusy ? 'disabled aria-busy="true"' : "";
}

function resetNaturalEditChat() {
  pendingDraft = null;
  naturalSessionId = "";
  naturalChatMessages = [];
  naturalSlots = {};
  naturalEditError = "";
  naturalEditText = "";
  naturalAddText = "";
  draftApplyRecommendationId = "";
  draftApplyBusy = false;
}

function naturalEditSubmitLabel() {
  return "보내기";
}

// Playful "thinking" dots that replace the old plain spinner during AI edits.
function thinkingDots(modifier = "") {
  const cls = modifier ? `thinking-dots ${modifier}` : "thinking-dots";
  return `<span class="${cls}" aria-hidden="true"><i></i><i></i><i></i></span>`;
}

function naturalEditDisabledAttr() {
  return naturalEditBusy || draftApplyBusy ? 'disabled aria-busy="true"' : "";
}

function naturalEditInputDisabledAttr() {
  return naturalEditBusy ? 'disabled aria-busy="true"' : "";
}

function scrollGenerationPanelIntoView() {
  requestAnimationFrame(() => {
    document.querySelector(".generation-panel.busy")?.scrollIntoView({
      behavior: "smooth",
      block: "center"
    });
  });
}

function highlightEditedItem(item) {
  if (!item?.id) {
    render();
    return;
  }
  const itemId = item.id;
  const itemDate = dateKey(item.startsAt);
  if (itemDate) activeDate = itemDate;
  recentlyEditedItemId = itemId;
  render();
  scrollEditedItemIntoView(itemId);
  if (recentlyEditedTimer) clearTimeout(recentlyEditedTimer);
  recentlyEditedTimer = setTimeout(() => {
    if (recentlyEditedItemId === itemId) {
      recentlyEditedItemId = null;
      render();
    }
  }, 2200);
}

function scrollEditedItemIntoView(itemId) {
  requestAnimationFrame(() => {
    const safeItemId = window.CSS?.escape ? CSS.escape(itemId) : itemId.replaceAll('"', '\\"');
    document.querySelector(`[data-item-id="${safeItemId}"]`)?.scrollIntoView({
      behavior: "smooth",
      block: "center"
    });
  });
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    method: options.method || "GET",
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(apiErrorMessage(payload, response.status));
  return payload;
}

function apiErrorMessage(payload, status) {
  const serverMessage = String(payload?.error || payload?.message || "").trim();
  if (serverMessage) return serverMessage;
  return `요청 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요. (${status})`;
}

async function applyPendingDraft(selectedRecommendationId = "") {
  const draft = selectedRecommendationId ? { ...pendingDraft, selectedRecommendationId, sessionId: naturalSessionId } : { ...pendingDraft, sessionId: naturalSessionId };
  draftApplyBusy = true;
  draftApplyRecommendationId = selectedRecommendationId;
  naturalEditError = "";
  render();
  try {
    const result = await mutate("/api/natural-edits/apply", draft);
    pendingDraft = null;
    naturalSessionId = "";
    naturalSlots = {};
    naturalChatMessages.push({ role: "assistant", text: "플래너에 적용했어요." });
    draftApplyBusy = false;
    draftApplyRecommendationId = "";
    render();
    highlightEditedItem(result.item);
  } catch (error) {
    draftApplyBusy = false;
    draftApplyRecommendationId = "";
    naturalEditError = error.message;
    render();
  }
}

async function requestNaturalDraft(text, options = {}) {
  const userText = String(text || "").trim();
  chatbotOpen = true;
  naturalEditBusy = true;
  naturalEditError = "";
  draftApplyRecommendationId = "";
  naturalChatMessages.push({ role: "user", text: userText });
  render();
  scrollNaturalChatToBottom();
  try {
    const result = await api("/api/natural-edits", {
      method: "POST",
      body: {
        sessionId: naturalSessionId,
        text: userText,
        mode: options.mode || "update",
        activeDate
      }
    });
    naturalSessionId = result.sessionId || naturalSessionId;
    naturalSlots = result.conversation?.slots || result.draft?.filledSlots || naturalSlots;
    if (result.reply) {
      naturalChatMessages.push({
        role: "assistant",
        text: result.reply.text,
        source: result.reply.source,
        modelStatus: result.reply.modelStatus
      });
    } else if (result.draft) {
      pendingDraft = result.draft;
      naturalChatMessages.push({ role: "assistant", text: naturalDraftText(result.draft), draft: result.draft });
    }
    if (options.mode === "add_or_update") {
      naturalAddText = "";
    } else {
      naturalEditText = "";
    }
    return result.draft || null;
  } catch (error) {
    naturalEditError = error.message;
    return null;
  } finally {
    naturalEditBusy = false;
    render();
    scrollNaturalChatToBottom();
  }
}

function naturalDraftText(draft = {}) {
  return draft.question || draft.confirmationMessage || draft.resolutionMessage || "수정 초안을 만들었어요.";
}

async function mutate(path, body) {
  const result = await api(path, { method: "POST", body });
  currentState = result.state || (await api("/api/state"));
  ensureActiveDate();
  render();
  return result;
}

async function patch(path, body) {
  const result = await api(path, { method: "PATCH", body });
  currentState = result.state || (await api("/api/state"));
  ensureActiveDate();
  render();
}

async function remove(path) {
  const response = await fetch(path, { method: "DELETE" });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(apiErrorMessage(result, response.status));
  currentState = result.state;
  ensureActiveDate();
  render();
}

async function preparePush() {
  if (!("serviceWorker" in navigator)) {
    alert("이 브라우저는 서비스 워커를 지원하지 않습니다.");
    return;
  }
  const registration = await navigator.serviceWorker.ready;
  await api("/api/push-subscriptions", {
    method: "POST",
    body: {
      endpoint: `demo-${registration.scope}`,
      userVisibleOnly: true
    }
  });
  alert("알림 받을 기기 정보를 저장했습니다. 실제 푸시 발송 연결은 다음 단계에서 붙이면 됩니다.");
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }
}

function showAddAgentDialog() {
  const dialog = document.querySelector("#addAgentDialog");
  if (!dialog) return;
  naturalEditError = "";
  dialog.showModal();
}

function showManualAddDialog() {
  document.querySelector("#addAgentDialog")?.close();
  const dialog = document.querySelector("#addDialog");
  const form = dialog.querySelector("form");
  const date = activeDate || currentState.plan.date || new Date().toISOString().slice(0, 10);
  form.elements.startsAt.value = `${date}T12:00`;
  form.elements.endsAt.value = `${date}T13:00`;
  dialog.showModal();
}

function scrollNaturalChatToBottom() {
  requestAnimationFrame(() => {
    const messages = document.querySelector(".chatbot-messages");
    if (messages) messages.scrollTo({ top: messages.scrollHeight, behavior: "smooth" });
  });
}

function showEditDialog(id) {
  const item = currentState.plan.items.find((entry) => entry.id === id);
  if (!item) return;
  const dialog = document.querySelector("#editDialog");
  const form = dialog.querySelector("form");
  form.elements.id.value = item.id;
  form.elements.title.value = item.title;
  form.elements.placeName.value = item.placeName;
  form.elements.address.value = item.address || "";
  form.elements.lat.value = item.lat ?? "";
  form.elements.lng.value = item.lng ?? "";
  form.elements.startsAt.value = toDatetimeLocal(item.startsAt);
  form.elements.endsAt.value = toDatetimeLocal(item.endsAt);
  form.elements.transportMode.value = item.transportMode;
  form.elements.category.value = item.category;
  form.elements.travelMinutesBefore.value = item.travelMinutesBefore;
  form.elements.memo.value = item.memo || "";
  dialog.showModal();
}

function getPlanDays() {
  const groups = new Map();
  for (const item of currentState.plan.items) {
    const date = dateKey(item.startsAt);
    if (!groups.has(date)) groups.set(date, []);
    groups.get(date).push(item);
  }

  const metadata = new Map((currentState.plan.days || []).map((day) => [day.date, day]));
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, items]) => ({
      date,
      title: metadata.get(date)?.title || date,
      theme: metadata.get(date)?.theme || "",
      items: items.sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())
    }));
}

function ensureActiveDate() {
  const days = getPlanDays();
  if (!days.length) {
    activeDate = currentState.plan.date;
    return;
  }
  if (!activeDate || !days.some((day) => day.date === activeDate)) activeDate = days[0].date;
}

function planRangeLabel() {
  const days = getPlanDays();
  const start = currentState.plan.startDate || currentState.plan.date || days[0]?.date;
  const end = currentState.plan.endDate || currentState.plan.date || days.at(-1)?.date;
  if (!start) return "일정 날짜 미정";
  return start === end || !end ? formatDayLabel(start) : `${formatDayLabel(start)} - ${formatDayLabel(end)}`;
}

function dateKey(isoString) {
  return String(isoString || "").slice(0, 10);
}

function clock(isoString) {
  const date = new Date(isoString);
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

function formatDayLabel(dateString) {
  const date = new Date(`${dateString}T00:00:00+09:00`);
  const monthDay = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "numeric",
    day: "numeric"
  }).format(date);
  const weekday = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    weekday: "short"
  }).format(date);
  return `${monthDay} ${weekday}`;
}

function transportLabel(mode) {
  return (
    {
      walk: "도보",
      subway: "대중교통",
      bus: "버스",
      taxi: "택시",
      car: "자가용"
    }[mode] || mode
  );
}

function routeIcon(mode) {
  const icons = {
    walk: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <circle cx="13.5" cy="4.5" r="1.8" fill="currentColor" stroke="none"/>
      <path d="M9.5 21l2.2-5.4 2.6 2.4 2 3"/>
      <path d="M7 12.5l3.2-3.2 2.6 1.5 2.3-1.8 2.4 3.4"/>
    </svg>`,
    car: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M4 15.5v-2.1l1.5-4.1A2 2 0 0 1 7.4 8h9.2a2 2 0 0 1 1.9 1.3l1.5 4.1v2.1"/>
      <path d="M3.6 15.5h16.8" />
      <circle cx="7.3" cy="16.6" r="1.6" fill="currentColor" stroke="none"/>
      <circle cx="16.7" cy="16.6" r="1.6" fill="currentColor" stroke="none"/>
    </svg>`,
    taxi: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect x="9.5" y="4" width="5" height="2.2" rx="0.6" fill="currentColor" stroke="none"/>
      <path d="M4 15.5v-2.1l1.5-4.1A2 2 0 0 1 7.4 8h9.2a2 2 0 0 1 1.9 1.3l1.5 4.1v2.1"/>
      <path d="M3.6 15.5h16.8" />
      <circle cx="7.3" cy="16.6" r="1.6" fill="currentColor" stroke="none"/>
      <circle cx="16.7" cy="16.6" r="1.6" fill="currentColor" stroke="none"/>
    </svg>`,
    bus: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect x="5" y="4" width="14" height="13" rx="2.2"/>
      <path d="M5 11h14"/>
      <path d="M8 17v1.5M16 17v1.5"/>
      <circle cx="8.4" cy="14.3" r="1" fill="currentColor" stroke="none"/>
      <circle cx="15.6" cy="14.3" r="1" fill="currentColor" stroke="none"/>
    </svg>`,
    subway: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect x="5.5" y="3.5" width="13" height="14" rx="3"/>
      <path d="M5.5 11.5h13"/>
      <path d="M8.5 17.5l-1.4 2M15.5 17.5l1.4 2"/>
      <circle cx="9" cy="14.5" r="1" fill="currentColor" stroke="none"/>
      <circle cx="15" cy="14.5" r="1" fill="currentColor" stroke="none"/>
    </svg>`
  };
  return (
    icons[mode] ||
    `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M5 17c3-6 7-6 7-9a3 3 0 0 1 6 0"/>
      <path d="M5 17l-1.5 2.5M5 17l2.5 0"/>
    </svg>`
  );
}

function routeTimingLabel(tone) {
  return (
    {
      relaxed: "여유",
      normal: "보통",
      tight: "촉박"
    }[tone] || "보통"
  );
}

function routeMapProviderLabel(mode) {
  if (mode === "bus" || mode === "subway") return "OSM 참고 경로";
  return "OSM ROUTE";
}

function routeColor(mode) {
  return (
    {
      walk: "#7b6fe8",
      car: "#3c315b",
      taxi: "#1c1c1c",
      bus: "#ab9ff2",
      subway: "#ab9ff2"
    }[mode] || "#ab9ff2"
  );
}

function routeProfileLabel(profile) {
  return profile === "foot" ? "도보 경로" : "도로 경로";
}

function formatMeters(meters) {
  const value = Number(meters);
  if (!Number.isFinite(value) || value <= 0) return "거리 미확인";
  if (value < 1000) return `${Math.round(value / 10) * 10}m`;
  return `${(value / 1000).toFixed(value < 10000 ? 1 : 0)}km`;
}

function formatSeconds(seconds) {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value <= 0) return "시간 미확인";
  return `${Math.max(1, Math.round(value / 60))}분`;
}

function routeCoordinate(value) {
  const number = Number(value);
  return Number.isFinite(number) ? String(Number(number.toFixed(7))) : "";
}

function categoryLabel(category) {
  return (
    {
      indoor: "실내",
      outdoor: "야외",
      meal: "식사"
    }[category] || category
  );
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function toDatetimeLocal(isoString) {
  return String(isoString).replace(":00+09:00", "").slice(0, 16);
}
