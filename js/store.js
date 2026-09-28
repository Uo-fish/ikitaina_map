// =====================================================================
//  データ層：認証・権限・マップ・スポットの読み書き
//  サーバー側コードは使わず、Firestore セキュリティルールで権限を守ります
//  （Cloud Functions は有料プラン必須のため一切使っていません）
// =====================================================================
import {
  app, auth, db, errMsg,
  initializeApp, getAuth, setPersistence, inMemoryPersistence,
  onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  sendPasswordResetEmail, updateProfile, updatePassword, signOut, deleteUser,
  collection, doc, addDoc, getDoc, getDocs, setDoc, updateDoc, deleteDoc,
  onSnapshot, query, orderBy, serverTimestamp, writeBatch, deleteField,
} from "./firebase.js";
import { VIEWER_EMAIL, DEFAULT_CENTER, DEFAULT_ZOOM } from "./config.js";

export const ROLES = { ADMIN: "admin", EDITOR: "editor", VIEWER: "viewer" };

/** アプリ全体の状態 */
export const state = {
  user: null,        // Firebase Auth の User
  profile: null,     // users/{uid} の内容（閲覧者は null）
  role: null,        // 'admin' | 'editor' | 'viewer'
  boards: [],
  boardId: null,
  board: null,
  spots: [],
};

export const isAdmin  = () => state.role === ROLES.ADMIN;
export const canEdit  = () => state.role === ROLES.ADMIN || state.role === ROLES.EDITOR;
export const myUid    = () => state.user?.uid || null;
export const myName   = () =>
  state.profile?.name || state.user?.displayName || (state.role === ROLES.VIEWER ? "閲覧者" : "ユーザー");

const LAST_BOARD_KEY = "ikitai:lastBoard";

// ---------------------------------------------------------------------
//  初回セットアップ判定
// ---------------------------------------------------------------------
const claimRef = () => doc(db, "meta", "claimed");

/** 管理者がまだ1人もいない状態か（未ログインでも読める） */
export async function needsSetup() {
  try {
    const s = await getDoc(claimRef());
    return !s.exists();
  } catch {
    // ルール未設定などで読めない場合はセットアップ済み扱い（招待コード入力を表示）
    return false;
  }
}

// ---------------------------------------------------------------------
//  認証
// ---------------------------------------------------------------------

/** 閲覧パスワードだけで入る（内部的に固定メールでログイン） */
export async function loginViewer(password) {
  await signInWithEmailAndPassword(auth, VIEWER_EMAIL, password);
}

export async function login(email, password) {
  await signInWithEmailAndPassword(auth, email.trim(), password);
}

export const logout = () => signOut(auth);

export async function resetPassword(email) {
  await sendPasswordResetEmail(auth, email.trim());
}

/** 最初の管理者アカウントを作る（1回だけ成功する） */
export async function createFirstAdmin({ name, email, password }) {
  const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
  try {
    await updateProfile(cred.user, { displayName: name });
    const batch = writeBatch(db);
    batch.set(claimRef(), { at: serverTimestamp(), by: cred.user.uid });
    batch.set(doc(db, "users", cred.user.uid), {
      name, email: email.trim(), role: ROLES.ADMIN,
      disabled: false, createdAt: serverTimestamp(),
    });
    await batch.commit();
  } catch (e) {
    // 途中で失敗したら中途半端な Auth アカウントを残さない
    await deleteUser(cred.user).catch(() => {});
    throw e;
  }
}

/** 招待コードを使ってアカウントを作る */
export async function signUpWithInvite({ code, name, email, password }) {
  const key = code.trim().toUpperCase();
  const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
  try {
    const invSnap = await getDoc(doc(db, "invites", key));
    if (!invSnap.exists()) throw new Error("招待コードが見つかりません。");
    const inv = invSnap.data();
    if (inv.usedBy) throw new Error("この招待コードは既に使用されています。");

    await updateProfile(cred.user, { displayName: name });
    const batch = writeBatch(db);
    batch.set(doc(db, "users", cred.user.uid), {
      name, email: email.trim(), role: inv.role,
      inviteCode: key, disabled: false, createdAt: serverTimestamp(),
    });
    batch.update(doc(db, "invites", key), {
      usedBy: cred.user.uid, usedByName: name, usedAt: serverTimestamp(),
    });
    await batch.commit();
  } catch (e) {
    await deleteUser(cred.user).catch(() => {});
    throw e;
  }
}

/**
 * 自分のログイン状態を保ったまま、別アカウントのパスワードを変更する。
 * 管理者が「閲覧パスワード」を変えるときに使う（現在のパスワードが必要）。
 */
export async function changeOtherPassword(email, currentPw, newPw) {
  const sub = initializeApp(app.options, "pw-" + Date.now());
  const subAuth = getAuth(sub);
  await setPersistence(subAuth, inMemoryPersistence);
  try {
    const cred = await signInWithEmailAndPassword(subAuth, email, currentPw);
    await updatePassword(cred.user, newPw);
  } finally {
    await signOut(subAuth).catch(() => {});
  }
}

/**
 * ログイン状態の変化を監視する。
 * プロフィール（役割）を解決してからコールバックを呼ぶ。
 */
export function watchAuth(cb) {
  return onAuthStateChanged(auth, async (user) => {
    state.user = user;
    state.profile = null;
    state.role = null;

    if (!user) return cb(null);

    if (user.email === VIEWER_EMAIL) {
      state.role = ROLES.VIEWER;
      return cb(user);
    }

    try {
      const snap = await getDoc(doc(db, "users", user.uid));
      if (snap.exists()) {
        state.profile = snap.data();
        if (state.profile.disabled) {
          await signOut(auth);
          return cb(null, "このアカウントは管理者により無効化されています。");
        }
        state.role = state.profile.role || ROLES.VIEWER;
      } else {
        // users ドキュメントが無いアカウントは閲覧のみ
        state.role = ROLES.VIEWER;
      }
    } catch {
      state.role = ROLES.VIEWER;
    }
    cb(user);
  });
}

// ---------------------------------------------------------------------
//  マップ（ボード）
// ---------------------------------------------------------------------
const boardsCol = () => collection(db, "boards");
const spotsCol = (bid) => collection(db, "boards", bid, "spots");
const spotRef = (bid, sid) => doc(db, "boards", bid, "spots", sid);

/** マップ一覧を購読 */
export function watchBoards(cb, onErr) {
  return onSnapshot(
    query(boardsCol(), orderBy("createdAt", "asc")),
    (snap) => {
      state.boards = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      cb(state.boards);
    },
    (e) => onErr?.(e),
  );
}

export async function createBoard(name) {
  const ref = await addDoc(boardsCol(), {
    name: name.trim().slice(0, 60),
    desc: "",
    center: DEFAULT_CENTER,
    zoom: DEFAULT_ZOOM,
    createdBy: myUid(),
    createdByName: myName(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export function updateBoard(bid, data) {
  return updateDoc(doc(db, "boards", bid), { ...data, updatedAt: serverTimestamp() });
}

/** 配列を指定サイズごとに分ける（Firestore のバッチ上限500件対策） */
function chunk(arr, size = 400) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** 参照の配列をまとめて削除する（1件でも失敗すればエラー） */
async function deleteRefs(refs) {
  for (const part of chunk(refs)) {
    const b = writeBatch(db);
    part.forEach((r) => b.delete(r));
    await b.commit();
  }
}

/**
 * 消せるものだけ消す。
 * コメントの削除権限は「自分のもの or 管理者」なので、記載者が
 * スポットを消すときは他人のコメントを消せない。バッチは原子的で
 * 1件の拒否が全体を巻き添えにするため、ここは個別に試して無視する。
 * @returns {number} 消せなかった件数
 */
async function deleteRefsBestEffort(refs) {
  const results = await Promise.allSettled(refs.map((r) => deleteDoc(r)));
  return results.filter((r) => r.status === "rejected").length;
}

/**
 * マップを削除（中のスポットとコメントも消す）。
 * Firestore は親ドキュメントを消してもサブコレクションが残るため、
 * コメントを先に集めて明示的に削除する。
 */
export async function deleteBoard(bid) {
  const spots = await getDocs(spotsCol(bid));

  // 各スポットのコメントを集める
  const commentRefs = [];
  for (const s of spots.docs) {
    const cs = await getDocs(collection(db, "boards", bid, "spots", s.id, "comments"));
    cs.docs.forEach((c) => commentRefs.push(c.ref));
  }

  // 管理者はすべてのコメントを消せるが、念のため個別実行にしておく
  await deleteRefsBestEffort(commentRefs);
  await deleteRefs(spots.docs.map((d) => d.ref));
  await deleteDoc(doc(db, "boards", bid));
}

/** マップ内のスポット数を数える（削除前の確認表示用） */
export async function countSpots(bid) {
  const snap = await getDocs(spotsCol(bid));
  return snap.size;
}

export function rememberBoard(bid) {
  try { localStorage.setItem(LAST_BOARD_KEY, bid); } catch { /* noop */ }
}
export function lastBoard() {
  try { return localStorage.getItem(LAST_BOARD_KEY); } catch { return null; }
}

// ---------------------------------------------------------------------
//  スポット
// ---------------------------------------------------------------------

/** 選択中マップのスポットを購読 */
export function watchSpots(bid, cb, onErr) {
  return onSnapshot(
    spotsCol(bid),
    (snap) => {
      state.spots = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (a.order ?? 1e9) - (b.order ?? 1e9));
      cb(state.spots);
    },
    (e) => onErr?.(e),
  );
}

export function addSpot(bid, data) {
  const maxOrder = state.spots.reduce((m, s) => Math.max(m, s.order ?? 0), 0);
  return addDoc(spotsCol(bid), {
    name: data.name,
    lat: data.lat,
    lng: data.lng,
    cat: data.cat || "other",
    note: data.note || "",
    url: data.url || "",
    addr: data.addr || "",
    rating: data.rating || 0,
    done: false,
    votes: {},
    order: maxOrder + 1,
    createdBy: myUid(),
    createdByName: myName(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export function updateSpot(bid, sid, data) {
  return updateDoc(spotRef(bid, sid), { ...data, updatedAt: serverTimestamp() });
}

/**
 * スポットを削除（付いているコメントも消す）。
 * 記載者は他人のコメントを消せないので、消せない分は残したまま
 * スポット本体の削除を進める（残骸は管理者が消せる）。
 */
export async function deleteSpot(bid, sid) {
  try {
    const cs = await getDocs(collection(db, "boards", bid, "spots", sid, "comments"));
    await deleteRefsBestEffort(cs.docs.map((d) => d.ref));
  } catch { /* コメントが読めなくても本体の削除は進める */ }
  await deleteDoc(spotRef(bid, sid));
}

/** 「行きたい」の付け外し */
export function toggleVote(bid, sid, on) {
  const uid = myUid();
  return updateDoc(spotRef(bid, sid), {
    [`votes.${uid}`]: on ? true : deleteField(),
    updatedAt: serverTimestamp(),
  });
}

/** 順路の並びを入れ替える */
export async function swapOrder(bid, a, b) {
  const batch = writeBatch(db);
  batch.update(spotRef(bid, a.id), { order: b.order ?? 0 });
  batch.update(spotRef(bid, b.id), { order: a.order ?? 0 });
  await batch.commit();
}

// ---------------------------------------------------------------------
//  コメント
// ---------------------------------------------------------------------
const commentsCol = (bid, sid) => collection(db, "boards", bid, "spots", sid, "comments");

export function watchComments(bid, sid, cb, onErr) {
  return onSnapshot(
    query(commentsCol(bid, sid), orderBy("createdAt", "asc")),
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    (e) => onErr?.(e),
  );
}

export function addComment(bid, sid, text) {
  return addDoc(commentsCol(bid, sid), {
    text: text.slice(0, 500),
    by: myUid(),
    byName: myName(),
    createdAt: serverTimestamp(),
  });
}

export const deleteComment = (bid, sid, cid) =>
  deleteDoc(doc(db, "boards", bid, "spots", sid, "comments", cid));

// ---------------------------------------------------------------------
//  ユーザー管理（管理者用）
// ---------------------------------------------------------------------
export function watchUsers(cb, onErr) {
  return onSnapshot(
    collection(db, "users"),
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    (e) => onErr?.(e),
  );
}

export const setUserRole = (uid, role) => updateDoc(doc(db, "users", uid), { role });
export const setUserDisabled = (uid, disabled) => updateDoc(doc(db, "users", uid), { disabled });
export const removeUserDoc = (uid) => deleteDoc(doc(db, "users", uid));

// ---------------------------------------------------------------------
//  招待コード（管理者用）
// ---------------------------------------------------------------------
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 紛らわしい文字を除外

function randomCode(len = 8) {
  const buf = new Uint32Array(len);
  crypto.getRandomValues(buf);
  return Array.from(buf, (n) => CODE_CHARS[n % CODE_CHARS.length]).join("");
}

export function watchInvites(cb, onErr) {
  return onSnapshot(
    query(collection(db, "invites"), orderBy("createdAt", "desc")),
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    (e) => onErr?.(e),
  );
}

export async function createInvite(role) {
  const code = randomCode();
  await setDoc(doc(db, "invites", code), {
    role,
    createdBy: myUid(),
    createdByName: myName(),
    createdAt: serverTimestamp(),
    usedBy: null,
  });
  return code;
}

export const deleteInvite = (code) => deleteDoc(doc(db, "invites", code));

export { errMsg };
