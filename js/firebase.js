// Firebase SDK の初期化（CDN の ESM 版を使うので npm / ビルド不要）
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  setPersistence,
  browserLocalPersistence,
  inMemoryPersistence,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  updateProfile,
  updatePassword,
  signOut,
  deleteUser,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore,
  collection,
  doc,
  addDoc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  orderBy,
  limit,
  serverTimestamp,
  writeBatch,
  deleteField,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import { firebaseConfig } from "./config.js";

if (String(firebaseConfig.apiKey).startsWith("PASTE_")) {
  document.getElementById("boot")?.classList.add("hidden");
  document.body.innerHTML = `
    <div style="max-width:620px;margin:12vh auto;padding:28px;font-family:system-ui,sans-serif;line-height:1.8">
      <h1 style="font-size:20px">セットアップが必要です</h1>
      <p><code>js/config.js</code> の <code>firebaseConfig</code> に、ご自身の Firebase
      プロジェクトの設定値を貼り付けてください。</p>
      <p>手順は <code>README.md</code> の「セットアップ」に手順1から順に書いてあります。</p>
    </div>`;
  throw new Error("firebaseConfig is not configured. See README.md");
}

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// ブラウザを閉じてもログイン状態を保つ
await setPersistence(auth, browserLocalPersistence).catch(() => {});

export {
  initializeApp,
  getAuth,
  inMemoryPersistence,
  setPersistence,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  updateProfile,
  updatePassword,
  signOut,
  deleteUser,
  collection,
  doc,
  addDoc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  orderBy,
  limit,
  serverTimestamp,
  writeBatch,
  deleteField,
};

/** Firebase のエラーコードを日本語メッセージに変換する */
export function errMsg(e) {
  const code = e?.code || "";
  const table = {
    "auth/invalid-email": "メールアドレスの形式が正しくありません。",
    "auth/missing-password": "パスワードを入力してください。",
    "auth/weak-password": "パスワードは6文字以上にしてください。",
    "auth/email-already-in-use": "このメールアドレスは既に登録されています。",
    "auth/user-not-found": "メールアドレスまたはパスワードが違います。",
    "auth/wrong-password": "メールアドレスまたはパスワードが違います。",
    "auth/invalid-credential": "パスワードが違います。",
    "auth/invalid-login-credentials": "メールアドレスまたはパスワードが違います。",
    "auth/too-many-requests": "試行回数が多すぎます。しばらく待ってからお試しください。",
    "auth/network-request-failed": "ネットワークに接続できませんでした。",
    "auth/operation-not-allowed":
      "メール／パスワード認証が有効になっていません。Firebase コンソールで有効化してください。",
    "auth/requires-recent-login": "セキュリティのため、再ログインしてからやり直してください。",
    "permission-denied": "権限がありません。",
    unavailable: "通信に失敗しました。接続を確認してください。",
    "failed-precondition": "処理を完了できませんでした。画面を再読み込みしてください。",
  };
  return table[code] || e?.message || "エラーが発生しました。";
}
