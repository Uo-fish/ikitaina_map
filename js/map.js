// =====================================================================
//  地図の描画（Leaflet + OpenStreetMap タイル／どちらも無料）
// =====================================================================
import { DEFAULT_CENTER, DEFAULT_ZOOM, catOf } from "./config.js";
import { esc } from "./ui.js";

let map = null;
let markerLayer = null;
let routeLine = null;
const markers = new Map(); // spotId -> L.Marker
let handlers = {};

/** 地図を作る。handlers = { onMapClick, onSelect, onOpen } */
export function initMap(el, h = {}) {
  handlers = h;
  map = L.map(el, {
    center: DEFAULT_CENTER,
    zoom: DEFAULT_ZOOM,
    zoomControl: true,
    attributionControl: true,
  });

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);

  markerLayer = L.layerGroup().addTo(map);
  map.on("click", (e) => handlers.onMapClick?.(e.latlng));
  return map;
}

export const getMap = () => map;

export function setView(center, zoom) {
  if (!map) return;
  map.setView(center || DEFAULT_CENTER, zoom ?? DEFAULT_ZOOM);
}

/** 追加モード中はカーソルを十字にする */
export function setAddCursor(on) {
  map?.getContainer()?.style.setProperty("cursor", on ? "crosshair" : "");
}

function pinIcon(spot, num, selected) {
  const c = catOf(spot.cat);
  const cls = ["pin-wrap", selected ? "sel" : "", spot.done ? "done" : ""].join(" ").trim();
  return L.divIcon({
    className: "",
    html: `<div class="${cls}">
             <div class="pin" style="background:${c.color}"><span>${c.icon}</span></div>
             ${num ? `<div class="pin-num">${num}</div>` : ""}
           </div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 30],
    popupAnchor: [0, -30],
  });
}

function popupHtml(spot, canEditNow) {
  const c = catOf(spot.cat);
  const votes = Object.keys(spot.votes || {}).length;
  return `
    <b>${esc(spot.name)}</b><br />
    <span style="color:#6b7684;font-size:12px">
      ${c.icon} ${esc(c.label)}${votes ? ` ・ ❤️ ${votes}` : ""}${spot.done ? " ・ ✅ 訪問済み" : ""}
    </span>
    ${spot.note ? `<div style="margin-top:6px;white-space:pre-wrap">${esc(String(spot.note).slice(0, 140))}</div>` : ""}
    <div class="popup-actions">
      <button class="btn sm primary" type="button" data-open="${esc(spot.id)}">
        ${canEditNow ? "詳細・編集" : "詳細"}
      </button>
    </div>`;
}

/**
 * スポット一覧をマーカーとして描き直す。
 * @param {Array}  spots        表示対象（フィルタ後）
 * @param {object} o            { selectedId, showRoute, canEdit, orderMap }
 */
export function renderMarkers(spots, o = {}) {
  if (!map) return;

  // 更新でマーカーを作り直すと吹き出しが閉じてしまうので、開いていたものを覚えておく
  let reopenId = null;
  for (const [id, mk] of markers) if (mk.isPopupOpen()) { reopenId = id; break; }

  markerLayer.clearLayers();
  markers.clear();

  spots.forEach((s) => {
    if (typeof s.lat !== "number" || typeof s.lng !== "number") return;
    const num = o.orderMap?.get(s.id);
    const m = L.marker([s.lat, s.lng], {
      icon: pinIcon(s, num, s.id === o.selectedId),
      title: s.name,
      keyboard: true,
      alt: s.name,
    });
    m.bindPopup(popupHtml(s, o.canEdit));
    m.on("click", () => handlers.onSelect?.(s.id));
    m.on("popupopen", (e) => {
      e.popup.getElement()
        ?.querySelector("[data-open]")
        ?.addEventListener("click", () => handlers.onOpen?.(s.id));
    });
    m.addTo(markerLayer);
    markers.set(s.id, m);
  });

  drawRoute(o.showRoute ? spots : []);
  if (reopenId) markers.get(reopenId)?.openPopup();
}

function drawRoute(spots) {
  if (routeLine) { routeLine.remove(); routeLine = null; }
  const pts = spots
    .filter((s) => typeof s.lat === "number" && typeof s.lng === "number")
    .map((s) => [s.lat, s.lng]);
  if (pts.length < 2) return;
  routeLine = L.polyline(pts, {
    color: "#2f6df6", weight: 3, opacity: .7, dashArray: "6 8",
  }).addTo(map);
}

/** 指定スポットへ寄る */
export function focusSpot(id, zoom = 16) {
  const m = markers.get(id);
  if (!m) return;
  map.setView(m.getLatLng(), Math.max(map.getZoom(), zoom), { animate: true });
  m.openPopup();
}

/** 表示位置は変えずに吹き出しだけ開く（マーカー再生成後の復帰用） */
export function openPopupOf(id) {
  markers.get(id)?.openPopup();
}

/** 全スポットが入るように表示範囲を合わせる */
export function fitAll(spots) {
  const pts = spots
    .filter((s) => typeof s.lat === "number" && typeof s.lng === "number")
    .map((s) => [s.lat, s.lng]);
  if (!pts.length) return false;
  if (pts.length === 1) { map.setView(pts[0], 15); return true; }
  map.fitBounds(L.latLngBounds(pts).pad(0.15));
  return true;
}

/** 追加位置を示す一時マーカー */
let ghost = null;
export function showGhost(latlng) {
  clearGhost();
  ghost = L.marker(latlng, {
    icon: L.divIcon({
      className: "",
      html: `<div class="pin-wrap"><div class="pin" style="background:#1d2430"><span>＋</span></div></div>`,
      iconSize: [30, 30], iconAnchor: [15, 30],
    }),
    interactive: false,
  }).addTo(map);
}
export function clearGhost() {
  if (ghost) { ghost.remove(); ghost = null; }
}

/** コンテナのサイズが変わったとき（サイドバー開閉など）に呼ぶ */
export function refresh() {
  setTimeout(() => map?.invalidateSize(), 220);
}

// ---------------------------------------------------------------------
//  地名検索（Nominatim / 無料・APIキー不要）
//  利用ポリシー上、連続リクエストは避ける必要があるため呼び出し側で間引く
// ---------------------------------------------------------------------
export async function geocode(q) {
  const url = "https://nominatim.openstreetmap.org/search"
    + `?format=jsonv2&limit=6&accept-language=ja&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error("検索に失敗しました");
  const rows = await res.json();
  return rows.map((r) => ({
    name: (r.name || r.display_name || "").split(",")[0],
    addr: r.display_name || "",
    lat: parseFloat(r.lat),
    lng: parseFloat(r.lon),
  }));
}

/** 座標 → 住所（スポット追加時に住所を自動で埋める） */
export async function reverseGeocode(lat, lng) {
  try {
    const url = "https://nominatim.openstreetmap.org/reverse"
      + `?format=jsonv2&accept-language=ja&lat=${lat}&lon=${lng}`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) return "";
    const j = await res.json();
    return j.display_name || "";
  } catch {
    return "";
  }
}
