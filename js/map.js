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
//  地名・店名検索
//   1) Nominatim（OpenStreetMap 公式・無料・APIキー不要）
//   2) 見つからないときは Photon（Komoot 提供・無料・APIキー不要）で再挑戦
//  どちらも利用ポリシー上、連続した大量リクエストは避ける必要があるため
//  呼び出し側でボタン操作のみに限定している。
// ---------------------------------------------------------------------

/** 場所の種別を日本語の短いラベルにする */
function kindLabel(r) {
  const t = r.type || "";
  const c = r.category || r.class || "";
  const table = {
    restaurant: "レストラン", cafe: "カフェ", fast_food: "ファストフード",
    bar: "バー", pub: "居酒屋", bakery: "パン屋", confectionery: "菓子店",
    hotel: "ホテル", hostel: "宿", ryokan: "旅館", guest_house: "民宿",
    supermarket: "スーパー", convenience: "コンビニ", department_store: "百貨店",
    mall: "ショッピングモール", clothes: "衣料品", books: "書店",
    museum: "博物館", gallery: "美術館", attraction: "観光地",
    viewpoint: "展望", theme_park: "テーマパーク", zoo: "動物園",
    aquarium: "水族館", castle: "城", temple: "寺", shrine: "神社",
    park: "公園", garden: "庭園", beach: "浜", peak: "山",
    station: "駅", bus_stop: "バス停", airport: "空港",
    onsen: "温泉", spa: "スパ", public_bath: "銭湯",
    city: "市", town: "町", village: "村", suburb: "地区",
    neighbourhood: "地区", hamlet: "集落", quarter: "地区",
  };
  return table[t] || table[c] || "";
}

/** 現在の地図表示範囲（検索で近くを優先するため） */
function viewboxParam() {
  if (!map) return "";
  try {
    const b = map.getBounds();
    // 左,上,右,下 の順
    return `&viewbox=${b.getWest()},${b.getNorth()},${b.getEast()},${b.getSouth()}`;
  } catch {
    return "";
  }
}

/** 同じ場所を指す結果をまとめる */
function dedupe(rows) {
  const seen = new Set();
  return rows.filter((r) => {
    if (!Number.isFinite(r.lat) || !Number.isFinite(r.lng)) return false;
    // 約10m四方を同一とみなす
    const key = `${r.lat.toFixed(4)},${r.lng.toFixed(4)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function searchNominatim(q, { nearby = true } = {}) {
  const url = "https://nominatim.openstreetmap.org/search"
    + "?format=jsonv2&limit=10&addressdetails=1&accept-language=ja"
    + `&q=${encodeURIComponent(q)}`
    + (nearby ? viewboxParam() : "");
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error("検索に失敗しました");
  const rows = await res.json();
  return rows.map((r) => ({
    name: (r.name || String(r.display_name || "").split(",")[0] || "").trim(),
    addr: r.display_name || "",
    kind: kindLabel(r),
    lat: parseFloat(r.lat),
    lng: parseFloat(r.lon),
  }));
}

/** Nominatim で見つからない店名の救済用（表記ゆれに強い） */
async function searchPhoton(q) {
  let url = "https://photon.komoot.io/api/?limit=10&lang=default"
    + `&q=${encodeURIComponent(q)}`;
  if (map) {
    try {
      const c = map.getCenter();
      url += `&lat=${c.lat}&lon=${c.lng}`; // 近い順に並べてもらう
    } catch { /* noop */ }
  }
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error("検索に失敗しました");
  const j = await res.json();
  return (j.features || []).map((f) => {
    const p = f.properties || {};
    const parts = [p.name, p.street, p.district, p.city, p.state, p.country]
      .filter(Boolean);
    return {
      name: (p.name || p.street || "").trim(),
      addr: parts.join(", "),
      kind: kindLabel(p),
      lat: f.geometry?.coordinates?.[1],
      lng: f.geometry?.coordinates?.[0],
    };
  });
}

/**
 * 名前で場所を検索する。
 * 地図の表示範囲の近くを優先し、見つからなければ範囲外・別サービスへ広げる。
 * @returns {Promise<Array<{name,addr,kind,lat,lng}>>}
 */
export async function geocode(q) {
  const query = String(q || "").trim();
  if (!query) return [];

  // 1) 地図の近くを優先して検索
  let rows = [];
  try { rows = await searchNominatim(query, { nearby: true }); }
  catch { /* 次の手段へ */ }

  // 2) 近くに無ければ範囲を広げる
  if (!rows.length) {
    try { rows = await searchNominatim(query, { nearby: false }); }
    catch { /* 次の手段へ */ }
  }

  // 3) それでも無ければ別サービスで再挑戦（店名の表記ゆれに強い）
  if (!rows.length) {
    try { rows = await searchPhoton(query); }
    catch { /* 空で返す */ }
  }

  return dedupe(rows.filter((r) => r.name)).slice(0, 8);
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
