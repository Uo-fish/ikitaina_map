// =====================================================================
//  設定ファイル  ★ここだけ自分の値に書き換えてください★
//  手順の詳細は README.md を参照してください。
// =====================================================================

// Firebase コンソール →  プロジェクトの設定 → マイアプリ（ウェブ）→ SDK の設定と構成
// に表示される値をそのまま貼り付けます。
// ここに載る値は「公開前提」の識別子です（秘密鍵ではありません）。
// 実際のアクセス制御は Firestore セキュリティルール（firestore.rules）で行います。
export const firebaseConfig = {
  apiKey: "AIzaSyCorSBKyriUsr61Cgm_rms5M27N5EV10hg",
  authDomain: "ittemitai-e0787.firebaseapp.com",
  projectId: "ittemitai-e0787",
  storageBucket: "ittemitai-e0787.firebasestorage.app",
  messagingSenderId: "122052033148",
  appId: "1:122052033148:web:0c0ba7aa9ddff0944a67f9",
};

// 閲覧専用アカウントのメールアドレス。
// 閲覧者はメールを入力せず「閲覧パスワード」だけで入れるようにするため、
// この固定アドレスをアプリ側が内部的に使います。
// Firebase Authentication に、このアドレスのユーザーを1つ作っておいてください。
// その「パスワード」がみんなに共有する閲覧パスワードになります。
export const VIEWER_EMAIL = "viewer@ikitai-map.local";

// 地図の初期表示（例: 東京駅）
export const DEFAULT_CENTER = [35.681236, 139.767125];
export const DEFAULT_ZOOM = 12;

// スポットのカテゴリ。自由に増減できます（id は保存値なので後から変えないこと）
export const CATEGORIES = [
  { id: "spot",   label: "観光",   icon: "🗼", color: "#2f6df6" },
  { id: "food",   label: "ごはん", icon: "🍜", color: "#f2870d" },
  { id: "cafe",   label: "カフェ", icon: "☕", color: "#a9722b" },
  { id: "shop",   label: "買い物", icon: "🛍️", color: "#d6336c" },
  { id: "nature", label: "自然",   icon: "🌲", color: "#17a673" },
  { id: "stay",   label: "宿",     icon: "🏨", color: "#7048e8" },
  { id: "other",  label: "その他", icon: "📌", color: "#59636f" },
];

export const CAT_MAP = new Map(CATEGORIES.map((c) => [c.id, c]));
export const catOf = (id) => CAT_MAP.get(id) || CAT_MAP.get("other");

// スポットの状態（旅行計画の進み具合）。
// 旧データとの互換のため、内部では文字列 status を使いつつ
// 既存の done(true/false) とも相互変換する（store.js 参照）。
//   candidate … 候補（みんなで検討中）
//   decided   … 行くと決定
//   visited   … 訪問済み
export const STATUSES = [
  { id: "candidate", label: "候補",     icon: "🕒", color: "#59636f" },
  { id: "decided",   label: "行く",     icon: "📌", color: "#2f6df6" },
  { id: "visited",   label: "訪問済み", icon: "✅", color: "#17a673" },
];

export const STATUS_MAP = new Map(STATUSES.map((s) => [s.id, s]));
export const statusOf = (id) => STATUS_MAP.get(id) || STATUS_MAP.get("candidate");

/** 保存データから状態IDを求める（旧 done フィールドにも対応） */
export function readStatus(spot) {
  if (spot && STATUS_MAP.has(spot.status)) return spot.status;
  if (spot && spot.done === true) return "visited";
  return "candidate";
}
