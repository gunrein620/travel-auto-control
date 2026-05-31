import { buildParkingRouteLinks, buildRouteSegments } from "../src/domain/routeSegments.js";

const app = document.querySelector("#root");

let currentState = null;
let pendingDraft = null;
let activeDate = null;
let generationBusy = false;
let generationError = "";
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
      <div>
        <p class="eyebrow">JUNGLE Compass</p>
        <h1>여행 관제 플래너</h1>
      </div>
      <div class="topbar-actions">
        <button class="soft-button" data-action="open-trip">AI 일정 설계</button>
        <button class="icon-button" data-action="refresh" aria-label="새로고침">↻</button>
      </div>
    </header>

    <main class="shell">
      ${renderHome(activeAlerts.length)}
      ${renderGenerationStatus()}

      <section class="planner-board" aria-label="여행 타임테이블">
        <div class="board-head">
          <div>
            <p class="eyebrow">Planner</p>
            <h2>${escapeHtml(currentState.plan.title)}</h2>
            <p>${escapeHtml(planRangeLabel())} · ${currentState.plan.items.length}개 일정</p>
          </div>
          <button class="primary" data-action="inspect-all">전체 점검</button>
        </div>
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
      </section>

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

    <form class="composer" data-role="natural-form">
      <label for="naturalText">자연어로 일정 수정</label>
      <div class="composer-row">
        <input id="naturalText" name="naturalText" placeholder="예: 이따 저녁은 삼겹살로 바꾸고 플래너에 적용해줘" autocomplete="off" />
        <button type="submit">보내기</button>
      </div>
      <div class="draft-zone">${pendingDraft ? renderDraft(pendingDraft) : ""}</div>
    </form>

    ${renderTripDialog()}
    ${renderAddDialog()}
    ${renderEditDialog()}
  `;

  hydrateRouteMaps();
  hydrateRouteParking();
}

function renderHome(alertCount) {
  const source = currentState.plan.generation?.source === "ennoia" ? "Ennoia" : "연결 대기";
  return `
    <section class="home-hero">
      <div class="hero-copy">
        <span class="date-pill">${escapeHtml(source)} 주도형</span>
        <h2>여행 조건을 넣으면 일정이 타임테이블로 들어오고, 이동 중에는 계속 점검됩니다.</h2>
        <p>${escapeHtml(currentState.plan.region || "서울")} · ${escapeHtml(currentState.plan.travelers || "여행자")} · 알림 ${alertCount}개</p>
      </div>
      <div class="hero-actions">
        <button class="primary large" data-action="open-trip">AI로 일정 설계하기</button>
        <button class="soft-button large" data-action="inspect-all">현재 일정 점검</button>
      </div>
    </section>
  `;
}

function renderGenerationStatus() {
  if (generationBusy) {
    return `
      <section class="generation-panel busy">
        <div>
          <p class="eyebrow">Ennoia Agent</p>
          <h2>관광지, 맛집, 날씨 조건을 분석하는 중</h2>
          <p>생성 결과가 오면 플래너에 바로 반영합니다.</p>
        </div>
        <span class="loader" aria-label="분석 중"></span>
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
  return `
    <section class="generation-panel">
      <div>
        <p class="eyebrow">${generation.source === "ennoia" ? "Ennoia Agent" : "Fallback"}</p>
        <h2>${escapeHtml(generation.modelStatus || "일정 생성 상태")}</h2>
        <p>${escapeHtml((generation.evidence || [])[0] || "생성된 일정은 점검 단계에서 API로 재확인합니다.")}</p>
      </div>
      <div class="api-chips">
        ${apiStatus.map((status) => `<span>${escapeHtml(status)}</span>`).join("")}
      </div>
    </section>
  `;
}

function renderDayTab(day, index) {
  const selected = day.date === activeDate;
  return `
    <button class="day-tab ${selected ? "active" : ""}" data-action="select-day" data-date="${day.date}" role="tab" aria-selected="${selected}">
      <strong>Day ${index + 1}</strong>
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
  return `
    <article class="plan-item ${meta.tone}">
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
    <article class="route-card ${segment.mode} ${segment.timingTone}" data-route-segment data-route-id="${escapeHtml(segment.id)}">
      <div class="route-rail">
        <span class="route-icon" aria-hidden="true">${escapeHtml(routeIcon(segment.mode))}</span>
        <strong>${escapeHtml(segment.modeLabel)}</strong>
        <span>${escapeHtml(segment.timeLabel)}</span>
      </div>
      <div class="route-body">
        <div class="route-head">
          <div>
            <p class="eyebrow">이동 경로</p>
            <h3>${escapeHtml(segment.fromName)} → ${escapeHtml(segment.toName)}</h3>
            <p>${escapeHtml(segment.distanceLabel)} · 예상 ${escapeHtml(segment.timeLabel)} · ${escapeHtml(segment.availableLabel)}</p>
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
            externalUrl: segment.mapProvider === "naver" ? segment.naverUrl : segment.mapEmbedUrl
          })}
          <p class="route-map-fallback">
            도로 경로는 실제 교통상황을 반영하지 않은 참고선입니다.
            <a href="${escapeHtml(segment.mapProvider === "naver" ? segment.naverUrl : segment.mapEmbedUrl)}" target="_blank" rel="noopener noreferrer">새 창에서 열기</a>
          </p>
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

function renderRouteMapCanvas({ from, to, mode, label, externalUrl }) {
  return `
    <div
      class="route-map-canvas"
      data-live-route-map
      data-route-mode="${escapeHtml(mode)}"
      data-route-label="${escapeHtml(label)}"
      data-external-url="${escapeHtml(externalUrl)}"
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
    mode: mapElement.dataset.routeMode || "walk"
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

  window.L.circleMarker(latLngs[0], {
    radius: 6,
    color,
    weight: 3,
    fillColor: "#ffffff",
    fillOpacity: 1
  }).addTo(map);
  window.L.circleMarker(latLngs[latLngs.length - 1], {
    radius: 7,
    color: "#17181c",
    weight: 3,
    fillColor: color,
    fillOpacity: 1
  }).addTo(map);

  map.fitBounds(polyline.getBounds(), { padding: [28, 28], maxZoom: 16 });
  setTimeout(() => map.invalidateSize(), 60);

  const summary = document.createElement("div");
  summary.className = "map-summary";
  summary.textContent = `${routeProfileLabel(route.profile)} · ${formatMeters(route.distanceMeters)} · 약 ${formatSeconds(route.durationSeconds)}`;
  mapElement.append(summary);
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
  const sourceLabel = draft.source === "ennoia" ? "Ennoia LLM 초안" : "규칙 기반 fallback";
  const statusLine = draft.modelStatus ? `<small>${escapeHtml(sourceLabel)} · ${escapeHtml(draft.modelStatus)}</small>` : `<small>${escapeHtml(sourceLabel)}</small>`;
  if (draft.needsClarification) {
    return `<p class="draft">${statusLine}<br />${escapeHtml(draft.question)}</p>`;
  }
  return `
    <div class="draft">
      ${statusLine}
      <p>${escapeHtml(draft.confirmationMessage)}</p>
      <button type="button" data-action="apply-draft">플래너에 적용</button>
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
          <label>여행 지역 <input name="region" required value="수원시" /></label>
          <label>인원/구성 <input name="travelers" required value="4인 가족" /></label>
        </div>
        <div class="grid-2">
          <label>시작일 <input name="startDate" type="date" required value="2026-06-27" /></label>
          <label>종료일 <input name="endDate" type="date" required value="2026-06-29" /></label>
        </div>
        <div class="grid-2">
          <label>아이/동행 특성 <input name="childrenAges" placeholder="예: 초등학생 2명, 부모 2명" /></label>
          <label>숙소 위치 <input name="lodgingArea" placeholder="예: 수원역 근처" /></label>
        </div>
        <div class="grid-2">
          <label>이동수단
            <select name="transportMode">
              <option value="car">자가용</option>
              <option value="subway">대중교통</option>
              <option value="taxi">택시</option>
              <option value="walk">도보 중심</option>
            </select>
          </label>
          <label>여행 템포
            <select name="pace">
              <option value="보통">보통</option>
              <option value="여유">여유</option>
              <option value="촘촘">촘촘</option>
            </select>
          </label>
        </div>
        <label>관심사 <textarea name="interests" rows="2">역사 관광지, 아이가 지루하지 않은 동선, 근처 맛집</textarea></label>
        <div class="grid-2">
          <label>음식 선호 <input name="foodPreferences" placeholder="예: 한식, 고기, 아이 메뉴" /></label>
          <label>예산 <input name="budget" placeholder="예: 중간" /></label>
        </div>
        <label>피하고 싶은 것 <input name="avoid" placeholder="예: 긴 대기, 너무 긴 도보, 늦은 저녁" /></label>
        <button class="primary full" type="submit">Ennoia로 일정 생성</button>
      </form>
    </dialog>
  `;
}

function renderAddDialog() {
  return `
    <dialog id="addDialog" class="dialog">
      <form method="dialog" data-role="add-form">
        <div class="dialog-head">
          <h2>일정 추가</h2>
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
  if (action === "close-dialog") button.closest("dialog")?.close();
  if (action === "open-trip") document.querySelector("#tripDialog").showModal();
  if (action === "select-day") {
    activeDate = button.dataset.date;
    render();
  }
  if (action === "show-add") showAddDialog();
  if (action === "show-edit") showEditDialog(id);
  if (action === "inspect") await mutate(`/api/items/${id}/inspect`, {});
  if (action === "inspect-all") await mutate("/api/inspect/all", {});
  if (action === "run-due") await mutate(`/api/inspect/due?now=${encodeURIComponent(new Date().toISOString())}`, {});
  if (action === "delete") await remove(`/api/items/${id}`);
  if (action === "apply-notice") await mutate(`/api/notifications/${id}/apply`, {});
  if (action === "dismiss-notice") await mutate(`/api/notifications/${id}/dismiss`, {});
  if (action === "apply-draft" && pendingDraft) {
    const draft = pendingDraft;
    pendingDraft = null;
    await mutate("/api/natural-edits/apply", draft);
    render();
  }
  if (action === "enable-push") await preparePush();
});

document.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.target;

  if (form.dataset.role === "trip-form") {
    const body = Object.fromEntries(new FormData(form).entries());
    document.querySelector("#tripDialog").close();
    generationBusy = true;
    generationError = "";
    render();
    try {
      const result = await api("/api/trips/generate", { method: "POST", body });
      currentState = result.state;
      activeDate = currentState.plan.startDate || currentState.plan.date;
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
    const result = await api("/api/natural-edits", { method: "POST", body: { text } });
    pendingDraft = result.draft;
    form.reset();
    render();
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

async function api(path, options = {}) {
  const response = await fetch(path, {
    method: options.method || "GET",
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  if (!response.ok) throw new Error(`API error ${response.status}`);
  return response.json();
}

async function mutate(path, body) {
  const result = await api(path, { method: "POST", body });
  currentState = result.state || (await api("/api/state"));
  ensureActiveDate();
  render();
}

async function patch(path, body) {
  const result = await api(path, { method: "PATCH", body });
  currentState = result.state || (await api("/api/state"));
  ensureActiveDate();
  render();
}

async function remove(path) {
  const response = await fetch(path, { method: "DELETE" });
  if (!response.ok) throw new Error(`API error ${response.status}`);
  const result = await response.json();
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

function showAddDialog() {
  const dialog = document.querySelector("#addDialog");
  const form = dialog.querySelector("form");
  const date = activeDate || currentState.plan.date || new Date().toISOString().slice(0, 10);
  form.elements.startsAt.value = `${date}T12:00`;
  form.elements.endsAt.value = `${date}T13:00`;
  dialog.showModal();
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
  const start = currentState.plan.startDate || currentState.plan.date;
  const end = currentState.plan.endDate || currentState.plan.date;
  return start === end ? formatDayLabel(start) : `${formatDayLabel(start)} - ${formatDayLabel(end)}`;
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
  return (
    {
      walk: "도",
      car: "차",
      taxi: "택",
      bus: "버",
      subway: "철"
    }[mode] || "길"
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
      walk: "#14804a",
      car: "#2563eb",
      taxi: "#2563eb",
      bus: "#7c3aed",
      subway: "#7c3aed"
    }[mode] || "#2563eb"
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
