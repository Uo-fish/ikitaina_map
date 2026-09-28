// =====================================================================
//  Google マップの URL からスポット情報（座標・名前）を取り出す
//
//  対応している形の例:
//   https://www.google.com/maps/place/清水寺/@34.9948,135.7850,17z/data=...!3d34.9948!4d135.7850
//   https://www.google.com/maps/@35.6812,139.7671,15z
//   https://www.google.com/maps/search/?api=1&query=35.6812,139.7671
//   https://maps.google.com/?q=清水寺
//   https://www.google.com/maps/dir/?api=1&destination=35.68,139.76
//   35.681236, 139.767125  （座標を直接貼り付け）
//
//  maps.app.goo.gl の短縮 URL は、ブラウザから展開先を読めません
//  （リダイレクト先を読むには CORS 許可が必要で、Google は許可していない）。
//  そのため短縮 URL は呼び出し側で案内を出す扱いにします。
// =====================================================================

const validLat = (n) => Number.isFinite(n) && n >= -90 && n <= 90;
const validLng = (n) => Number.isFinite(n) && n >= -180 && n <= 180;

function decode(s) {
  const t = String(s ?? "").replace(/\+/g, " ");
  try { return decodeURIComponent(t).trim(); }
  catch { return t.trim(); }
}

/** 共有文に混ざった URL を1つ取り出す */
export function extractUrl(text) {
  const m = String(text ?? "").match(/https?:\/\/[^\s<>"'）)】「」]+/);
  return m ? m[0] : null;
}

/** 「35.68, 139.76」のような座標テキストを読む */
export function parseLatLng(text) {
  const m = String(text ?? "").trim()
    .match(/^\(?\s*(-?\d{1,3}(?:\.\d+)?)\s*[,\s]\s*(-?\d{1,3}(?:\.\d+)?)\s*\)?$/);
  if (!m) return null;
  const lat = parseFloat(m[1]);
  const lng = parseFloat(m[2]);
  if (!validLat(lat) || !validLng(lng)) return null;
  return { lat, lng };
}

/** Google マップ（または短縮 URL）かどうか */
export function isGoogleMapsUrl(text) {
  const u = extractUrl(text);
  if (!u) return false;
  try {
    const h = new URL(u).hostname.toLowerCase();
    return h.endsWith("goo.gl") || /(^|\.)google\.[a-z.]+$/.test(h);
  } catch { return false; }
}

/** 展開が必要な短縮 URL かどうか */
export function isShortLink(text) {
  const u = extractUrl(text);
  if (!u) return false;
  try {
    const h = new URL(u).hostname.toLowerCase();
    return h.endsWith("goo.gl"); // maps.app.goo.gl / goo.gl
  } catch { return false; }
}

/** 「lat,lng」形式のクエリ値なら座標として読む */
function coordsFromParam(v) {
  if (!v) return null;
  const m = String(v).match(/^\s*(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/);
  if (!m) return null;
  const lat = parseFloat(m[1]);
  const lng = parseFloat(m[2]);
  return validLat(lat) && validLng(lng) ? { lat, lng } : null;
}

/** 明らかに名前ではない値を弾く */
function looksLikeName(v) {
  if (!v) return false;
  const s = String(v).trim();
  if (!s || s.length > 80) return false;
  if (/^-?\d+(\.\d+)?$/.test(s)) return false;          // 数値のみ
  if (coordsFromParam(s)) return false;                  // 座標
  if (/^(place_id:|ftid:|cid:|data=|@)/i.test(s)) return false; // 内部ID
  if (/^[\d.,\s+-]+$/.test(s)) return false;             // 記号と数字だけ
  return true;
}

/**
 * Google マップの URL を解析する。
 * @returns {null | {
 *   lat?: number, lng?: number, zoom?: number,
 *   name: string, url: string,
 *   short: boolean,      // 短縮 URL（展開が必要）
 *   needsSearch: boolean // 座標が無く、名前で検索する必要がある
 * }}
 */
export function parseGoogleMapsUrl(text) {
  const urlStr = extractUrl(text);

  // URL ではなく座標を直接貼られた場合
  if (!urlStr) {
    const c = parseLatLng(text);
    return c ? { ...c, name: "", url: "", short: false, needsSearch: false } : null;
  }

  let u;
  try { u = new URL(urlStr); } catch { return null; }

  if (isShortLink(urlStr)) {
    return { name: "", url: urlStr, short: true, needsSearch: false };
  }

  const path = decode(u.pathname);
  const rawPath = u.pathname;
  const qs = u.searchParams;
  // Google は「!3d..!4d..」を data= やパスの中に入れる（URL 全体から探す）
  const whole = urlStr;

  let lat = null, lng = null, zoom = null, name = "";

  // --- 座標: !3d<lat>!4d<lng> が最も正確（地点そのものの座標） ---
  const d34 = whole.match(/!3d(-?\d{1,3}(?:\.\d+)?)!4d(-?\d{1,3}(?:\.\d+)?)/);
  if (d34) {
    const a = parseFloat(d34[1]), b = parseFloat(d34[2]);
    if (validLat(a) && validLng(b)) { lat = a; lng = b; }
  }

  // --- 座標: @<lat>,<lng>,<zoom>z（地図の中心） ---
  const at = whole.match(/@(-?\d{1,3}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)(?:,(\d+(?:\.\d+)?)z)?/);
  if (at) {
    const a = parseFloat(at[1]), b = parseFloat(at[2]);
    if (lat === null && validLat(a) && validLng(b)) { lat = a; lng = b; }
    if (at[3]) zoom = Math.round(parseFloat(at[3]));
  }

  // --- 座標: クエリパラメータ ---
  if (lat === null) {
    for (const k of ["query", "q", "ll", "center", "sll", "daddr", "destination", "mlat"]) {
      const c = coordsFromParam(qs.get(k));
      if (c) { lat = c.lat; lng = c.lng; break; }
    }
  }
  // OSM 風の mlat / mlon
  if (lat === null && qs.get("mlat") && qs.get("mlon")) {
    const a = parseFloat(qs.get("mlat")), b = parseFloat(qs.get("mlon"));
    if (validLat(a) && validLng(b)) { lat = a; lng = b; }
  }

  // --- 名前: /maps/place/<名前>/ ---
  const mPlace = rawPath.match(/\/maps\/place\/([^/@]+)/);
  if (mPlace) {
    const n = decode(mPlace[1]);
    if (looksLikeName(n)) name = n;
  }
  // --- 名前: /maps/search/<名前> ---
  if (!name) {
    const mSearch = rawPath.match(/\/maps\/search\/([^/@?]+)/);
    if (mSearch) {
      const n = decode(mSearch[1]);
      if (looksLikeName(n)) name = n;
    }
  }
  // --- 名前: クエリパラメータ ---
  if (!name) {
    for (const k of ["query", "q", "destination", "daddr"]) {
      const v = qs.get(k);
      if (looksLikeName(v)) { name = String(v).trim(); break; }
    }
  }

  if (lat === null && !name) return null; // 手がかりなし

  return {
    ...(lat !== null ? { lat, lng } : {}),
    ...(zoom ? { zoom } : {}),
    name,
    url: urlStr,
    short: false,
    needsSearch: lat === null,
  };
}
