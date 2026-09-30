// =====================================================================
//  Service Worker（オフライン対応）
//  - アプリ本体（HTML/CSS/JS）と地図ライブラリはキャッシュ優先
//  - 地図タイルは表示済みのものをキャッシュして再訪時に高速＆オフライン表示
//  - Firebase など動的通信はキャッシュしない（常に最新を取りに行く）
// =====================================================================
const VERSION = "v1.0.0";
const APP_CACHE = `ikitai-app-${VERSION}`;
const TILE_CACHE = "ikitai-tiles";
const MAX_TILES = 500; // タイルキャッシュの上限（無料枠の容量を圧迫しないため）

// アプリの土台（GitHub Pages のサブパスでも動くよう相対パス）
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./manifest.webmanifest",
  "./icons/icon.svg",
  "./js/app.js",
  "./js/config.js",
  "./js/firebase.js",
  "./js/store.js",
  "./js/map.js",
  "./js/gmap.js",
  "./js/ui.js",
  "./js/admin.js",
  // 地図ライブラリ（CDN・バージョン固定）
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js",
  "https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css",
  "https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.Default.css",
  "https://unpkg.com/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(APP_CACHE)
      // 1つ失敗しても全体を止めない
      .then((c) => Promise.allSettled(APP_SHELL.map((u) => c.add(u))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== APP_CACHE && k !== TILE_CACHE)
            .map((k) => caches.delete(k)),
      ))
      .then(() => self.clients.claim()),
  );
});

const isTile = (url) =>
  /tile\.openstreetmap\.org/.test(url) || /\.tile\./.test(url);

// Firebase / 検索API など、キャッシュすべきでない動的通信
const isDynamic = (url) =>
  /firestore\.googleapis\.com/.test(url) ||
  /identitytoolkit\.googleapis\.com/.test(url) ||
  /googleapis\.com/.test(url) ||
  /gstatic\.com/.test(url) ||
  /nominatim\.openstreetmap\.org/.test(url) ||
  /photon\.komoot\.io/.test(url);

self.addEventListener("fetch", (e) => {
  const { request } = e;
  if (request.method !== "GET") return;
  const url = request.url;

  // 動的通信はそのままネットワークへ（オフライン時は素直に失敗させる）
  if (isDynamic(url)) return;

  // 地図タイル: キャッシュ優先 + 取得したら保存（上限管理つき）
  if (isTile(url)) {
    e.respondWith(
      caches.open(TILE_CACHE).then(async (cache) => {
        const hit = await cache.match(request);
        if (hit) return hit;
        try {
          const res = await fetch(request);
          if (res.ok) {
            cache.put(request, res.clone());
            trimTiles(cache);
          }
          return res;
        } catch {
          return hit || Response.error();
        }
      }),
    );
    return;
  }

  // アプリ本体・ライブラリ: キャッシュ優先、無ければ取得して保存
  e.respondWith(
    caches.match(request).then((hit) => {
      if (hit) return hit;
      return fetch(request)
        .then((res) => {
          if (res.ok && (url.startsWith(self.location.origin) || url.includes("unpkg.com"))) {
            const copy = res.clone();
            caches.open(APP_CACHE).then((c) => c.put(request, copy));
          }
          return res;
        })
        .catch(() => {
          // ナビゲーション要求がオフラインなら、キャッシュ済みのトップを返す
          if (request.mode === "navigate") return caches.match("./index.html");
          return Response.error();
        });
    }),
  );
});

/** タイルキャッシュが上限を超えたら古いものから削除 */
async function trimTiles(cache) {
  const keys = await cache.keys();
  if (keys.length <= MAX_TILES) return;
  const excess = keys.length - MAX_TILES;
  for (let i = 0; i < excess; i++) await cache.delete(keys[i]);
}

// ページからの指示で即時更新できるように
self.addEventListener("message", (e) => {
  if (e.data === "skipWaiting") self.skipWaiting();
});
