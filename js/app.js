// =====================================================================
//  画面制御のメイン
// =====================================================================
import { CATEGORIES, catOf, VIEWER_EMAIL } from "./config.js";
import { esc, toast, modal, confirmDialog, promptDialog, fmtDate, debounce } from "./ui.js";
import * as S from "./store.js";
import * as M from "./map.js";
import { openAdmin } from "./admin.js";
import { parseGoogleMapsUrl, isGoogleMapsUrl, isShortLink, extractUrl } from "./gmap.js";

const $ = (id) => document.getElementById(id);

const ui = {
  boot: $("boot"), gate: $("gate"), app: $("app"),
  gateMsg: $("gate-msg"),
  who: $("who"),
  boardSelect: $("board-select"),
  spotList: $("spot-list"),
  q: $("q"), filterCat: $("filter-cat"), filterState: $("filter-state"), sort: $("sort"),
  showRoute: $("show-route"),
  addMode: $("btn-add-mode"),
  banner: $("map-banner"),
  sidebar: $("sidebar"),
};

let unsubBoards = null;
let unsubSpots = null;
let subscribedBoard = null; // いま spots を購読しているマップ
let selectedId = null;
let addMode = false;
let mapReady = false;

// =====================================================================
//  入口（ゲート）
// =====================================================================
function gateMsg(text, ok = false) {
  ui.gateMsg.textContent = text;
  ui.gateMsg.className = "msg" + (ok ? " ok" : "");
}

function showPane(name) {
  document.querySelectorAll(".tab").forEach((t) => {
    const on = t.dataset.tab === name;
    t.classList.toggle("active", on);
    t.setAttribute("aria-selected", String(on));
  });
  document.querySelectorAll(".pane").forEach((p) => {
    p.classList.toggle("hidden", p.dataset.pane !== name);
  });
  gateMsg("");
}

document.querySelectorAll(".tab").forEach((t) => {
  t.addEventListener("click", () => showPane(t.dataset.tab));
});

/** 送信ボタンを押している間は二重送信させない */
async function withBusy(form, fn) {
  const btn = form.querySelector('button[type=submit]');
  const label = btn?.textContent;
  if (btn) { btn.disabled = true; btn.textContent = "処理中..."; }
  try { await fn(); }
  finally { if (btn) { btn.disabled = false; btn.textContent = label; } }
}

$("form-view").addEventListener("submit", (e) => {
  e.preventDefault();
  withBusy(e.target, async () => {
    gateMsg("");
    try {
      await S.loginViewer($("view-pw").value);
    } catch (err) {
      gateMsg(
        err?.code === "auth/user-not-found"
          ? "閲覧用アカウントが未作成です。管理者に連絡してください。"
          : "閲覧パスワードが違います。",
      );
    }
  });
});

$("form-login").addEventListener("submit", (e) => {
  e.preventDefault();
  withBusy(e.target, async () => {
    gateMsg("");
    try {
      await S.login($("login-email").value, $("login-pw").value);
    } catch (err) {
      gateMsg(S.errMsg(err));
    }
  });
});

$("form-signup").addEventListener("submit", (e) => {
  e.preventDefault();
  withBusy(e.target, async () => {
    gateMsg("");
    const code = $("su-code").value.trim().toUpperCase();
    const name = $("su-name").value.trim();
    const email = $("su-email").value.trim();
    const pw = $("su-pw").value;
    try {
      if (email.toLowerCase() === VIEWER_EMAIL.toLowerCase()) {
        throw new Error("このメールアドレスは使用できません。");
      }
      await S.signUpWithInvite({ code, name, email, password: pw });
      gateMsg("アカウントを作成しました。", true);
    } catch (err) {
      gateMsg(S.errMsg(err));
    }
  });
});

$("btn-reset-pw").addEventListener("click", async () => {
  const email = $("login-email").value.trim();
  if (!email) return gateMsg("先にメールアドレスを入力してください。");
  try {
    await S.resetPassword(email);
    gateMsg("再設定メールを送信しました。受信箱をご確認ください。", true);
  } catch (err) {
    gateMsg(S.errMsg(err));
  }
});

/** 管理者が1人もいないときの初期設定フォーム */
let setupShown = false;
function showSetupPane() {
  if (setupShown) return;
  setupShown = true;
  document.querySelector(".tabs").classList.add("hidden");
  document.querySelectorAll(".pane").forEach((p) => p.classList.add("hidden"));

  const card = document.querySelector(".gate-card");
  const form = document.createElement("form");
  form.className = "pane";
  form.innerHTML = `
    <p class="pane-note">
      はじめての起動です。<b>管理者アカウント</b>を作成してください。
      これは最初の1回だけ行えます。
    </p>
    <label class="field"><span>表示名</span>
      <input type="text" id="sa-name" required maxlength="30" value="管理者" /></label>
    <label class="field"><span>メールアドレス</span>
      <input type="email" id="sa-email" required autocomplete="email" /></label>
    <label class="field"><span>パスワード（6文字以上）</span>
      <input type="password" id="sa-pw" required minlength="6" autocomplete="new-password" /></label>
    <button class="btn primary block" type="submit">管理者を作成して開始</button>`;
  card.insertBefore(form, ui.gateMsg);

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    withBusy(form, async () => {
      gateMsg("");
      try {
        await S.createFirstAdmin({
          name: $("sa-name").value.trim(),
          email: $("sa-email").value.trim(),
          password: $("sa-pw").value,
        });
      } catch (err) {
        gateMsg(S.errMsg(err));
      }
    });
  });
}

// =====================================================================
//  ログイン状態に応じた切り替え
// =====================================================================
S.watchAuth(async (user, notice) => {
  ui.boot.classList.add("hidden");

  if (!user) {
    teardown();
    ui.app.classList.add("hidden");
    ui.gate.classList.remove("hidden");
    if (notice) gateMsg(notice);
    if (await S.needsSetup()) showSetupPane();
    return;
  }

  ui.gate.classList.add("hidden");
  ui.app.classList.remove("hidden");
  startApp();
});

function teardown() {
  unsubBoards?.(); unsubBoards = null;
  unsubSpots?.(); unsubSpots = null;
  S.state.boards = []; S.state.spots = [];
  S.state.boardId = null; S.state.board = null;
  subscribedBoard = null;
  selectedId = null;
  setAddMode(false);
}

$("btn-logout").addEventListener("click", async () => {
  if (!(await confirmDialog("退出しますか？", "またパスワードでログインできます。", "退出する"))) return;
  teardown();
  await S.logout();
});

// =====================================================================
//  アプリ開始
// =====================================================================
function startApp() {
  const roleLabel = { admin: "管理者", editor: "記載者", viewer: "閲覧者" }[S.state.role] || "";
  ui.who.innerHTML = `${esc(S.myName())}<span class="badge ${esc(S.state.role)}">${esc(roleLabel)}</span>`;
  ui.who.title = S.state.user.email === VIEWER_EMAIL ? "閲覧モード" : S.state.user.email;

  $("btn-admin").classList.toggle("hidden", !S.isAdmin());
  ui.addMode.classList.toggle("hidden", !S.canEdit());
  $("btn-board-new").classList.toggle("hidden", !S.canEdit());
  $("btn-board-edit").classList.toggle("hidden", !S.canEdit());

  if (!mapReady) {
    M.initMap($("map"), {
      onMapClick: onMapClick,
      onSelect: (id) => select(id, false),
      onOpen: (id) => openSpotDialog(S.state.spots.find((s) => s.id === id)),
    });
    mapReady = true;
  }
  M.refresh();

  buildCatFilter();

  unsubBoards?.();
  unsubBoards = S.watchBoards(onBoards, (e) => toast(S.errMsg(e), "err"));
}

function buildCatFilter() {
  if (ui.filterCat.options.length) return;
  ui.filterCat.innerHTML =
    `<option value="all">全カテゴリ</option>` +
    CATEGORIES.map((c) => `<option value="${esc(c.id)}">${c.icon} ${esc(c.label)}</option>`).join("");
}

// =====================================================================
//  マップ（ボード）の切り替え
// =====================================================================
function onBoards(boards) {
  ui.boardSelect.innerHTML = boards.length
    ? boards.map((b) => `<option value="${esc(b.id)}">${esc(b.name)}</option>`).join("")
    : `<option value="">（マップなし）</option>`;

  if (!boards.length) {
    S.state.boardId = null; S.state.board = null; S.state.spots = [];
    unsubSpots?.(); unsubSpots = null; subscribedBoard = null;
    renderList();
    M.renderMarkers([], {});
    banner(S.canEdit() ? "「＋」ボタンで最初のマップを作成しましょう" : "まだマップがありません", true);
    return;
  }

  const want = S.state.boardId || S.lastBoard();
  const pick = boards.find((b) => b.id === want) || boards[0];
  ui.boardSelect.value = pick.id;

  // 購読中のマップと違うときだけ切り替える
  // （createBoard 直後は boardId を先に入れてあるので subscribedBoard で判定する）
  if (subscribedBoard !== pick.id) {
    selectBoard(pick.id);
  } else {
    S.state.board = pick; // 名前やメモの更新を反映
  }
}

function selectBoard(bid) {
  S.state.boardId = bid;
  subscribedBoard = bid;
  S.state.board = S.state.boards.find((b) => b.id === bid) || null;
  S.rememberBoard(bid);
  selectedId = null;
  setAddMode(false);

  if (S.state.board?.center) M.setView(S.state.board.center, S.state.board.zoom);

  unsubSpots?.();
  let first = true;
  unsubSpots = S.watchSpots(
    bid,
    (spots) => {
      renderAll();
      if (first) {
        first = false;
        if (!M.fitAll(spots) && S.state.board?.center) {
          M.setView(S.state.board.center, S.state.board.zoom);
        }
        banner(
          spots.length === 0 && S.canEdit()
            ? "地図をクリック、または「＋ スポットを追加」から登録できます"
            : "",
          true,
        );
      }
    },
    (e) => toast(S.errMsg(e), "err"),
  );
}

ui.boardSelect.addEventListener("change", () => {
  if (ui.boardSelect.value) selectBoard(ui.boardSelect.value);
});

$("btn-board-new").addEventListener("click", async () => {
  if (!S.canEdit()) return;
  const name = await promptDialog({
    title: "新しいマップ",
    label: "マップの名前",
    placeholder: "例）京都旅行 2026",
    okLabel: "作成",
  });
  if (!name) return;
  try {
    const id = await S.createBoard(name);
    S.state.boardId = id;
    S.rememberBoard(id);
    toast("マップを作成しました", "ok");
  } catch (e) { toast(S.errMsg(e), "err"); }
});

$("btn-board-edit").addEventListener("click", () => {
  if (!S.canEdit() || !S.state.board) return;
  const b = S.state.board;
  modal({
    title: "マップの設定",
    body: `
      <label class="field"><span>マップ名</span>
        <input type="text" id="b-name" value="${esc(b.name)}" maxlength="60" /></label>
      <label class="field"><span>メモ（任意）</span>
        <textarea id="b-desc" maxlength="500">${esc(b.desc || "")}</textarea></label>
      <p class="help">作成: ${esc(b.createdByName || "不明")} / ${esc(fmtDate(b.createdAt))}</p>
      <hr class="hr" />
      <button class="btn block" type="button" id="b-center">現在の地図表示を初期位置にする</button>`,
    onMount: (el, close) => {
      el.querySelector("#b-center").addEventListener("click", async () => {
        const m = M.getMap();
        try {
          await S.updateBoard(b.id, {
            center: [m.getCenter().lat, m.getCenter().lng],
            zoom: m.getZoom(),
          });
          toast("初期位置を更新しました", "ok");
          close();
        } catch (e) { toast(S.errMsg(e), "err"); }
      });
    },
    actions: [
      {
        label: "マップを削除", kind: "danger", side: "left", keep: true,
        onClick: async ({ close }) => {
          if (!S.isAdmin()) return toast("削除は管理者のみ可能です", "err");
          const ok = await confirmDialog(
            "マップを削除しますか？",
            `「${b.name}」と、その中のスポットすべてを削除します。この操作は取り消せません。`,
            "削除する",
          );
          if (!ok) return;
          try {
            await S.deleteBoard(b.id);
            S.state.boardId = null;
            toast("削除しました", "ok");
            close();
          } catch (e) { toast(S.errMsg(e), "err"); }
        },
      },
      { label: "キャンセル" },
      {
        label: "保存", kind: "primary",
        onClick: async ({ el }) => {
          const name = el.querySelector("#b-name").value.trim();
          if (!name) { toast("マップ名を入力してください", "err"); return false; }
          try {
            await S.updateBoard(b.id, { name, desc: el.querySelector("#b-desc").value.trim() });
            toast("保存しました", "ok");
          } catch (e) { toast(S.errMsg(e), "err"); return false; }
        },
      },
    ],
  });
});

// =====================================================================
//  一覧のしぼり込みと描画
// =====================================================================
function visibleSpots() {
  const q = ui.q.value.trim().toLowerCase();
  const cat = ui.filterCat.value;
  const st = ui.filterState.value;
  let rows = S.state.spots.filter((s) => {
    if (cat !== "all" && (s.cat || "other") !== cat) return false;
    if (st === "todo" && s.done) return false;
    if (st === "done" && !s.done) return false;
    if (q) {
      const hay = `${s.name} ${s.note || ""} ${s.addr || ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const nVotes = (s) => Object.keys(s.votes || {}).length;
  const ms = (t) => (t?.toMillis ? t.toMillis() : 0);
  const sort = ui.sort.value;
  if (sort === "votes") rows.sort((a, b) => nVotes(b) - nVotes(a) || (a.order ?? 0) - (b.order ?? 0));
  else if (sort === "new") rows.sort((a, b) => ms(b.createdAt) - ms(a.createdAt));
  else if (sort === "name") rows.sort((a, b) => String(a.name).localeCompare(String(b.name), "ja"));
  else rows.sort((a, b) => (a.order ?? 1e9) - (b.order ?? 1e9));
  return rows;
}

function renderAll() {
  const rows = visibleSpots();
  renderList(rows);
  const orderMap = new Map(S.state.spots.map((s, i) => [s.id, i + 1]));
  M.renderMarkers(rows, {
    selectedId,
    showRoute: ui.showRoute.checked,
    canEdit: S.canEdit(),
    orderMap,
  });
}

function renderList(rows = visibleSpots()) {
  const total = S.state.spots.length;

  if (!rows.length) {
    ui.spotList.innerHTML = `<div class="empty">${
      total === 0
        ? (S.canEdit()
            ? "まだスポットがありません。<br />地図をクリックして追加してみましょう。"
            : "まだスポットがありません。")
        : "条件に合うスポットがありません。"
    }</div>`;
    return;
  }

  const orderIdx = new Map(S.state.spots.map((s, i) => [s.id, i + 1]));
  const uid = S.myUid();
  const byOrder = ui.sort.value === "order";

  ui.spotList.innerHTML = rows.map((s) => {
    const c = catOf(s.cat);
    const votes = Object.keys(s.votes || {}).length;
    const mine = !!(s.votes || {})[uid];
    const pos = S.state.spots.findIndex((x) => x.id === s.id);
    return `
      <article class="spot-card ${s.id === selectedId ? "active" : ""} ${s.done ? "done" : ""}"
               data-id="${esc(s.id)}" tabindex="0" role="button">
        <div class="sc-idx" style="background:${c.color}22;color:${c.color}">${orderIdx.get(s.id) ?? ""}</div>
        <div class="sc-body">
          <div class="sc-title">${esc(s.name)}</div>
          <div class="sc-meta">
            <span>${c.icon} ${esc(c.label)}</span>
            ${s.rating ? `<span>${"★".repeat(s.rating)}</span>` : ""}
            ${s.createdByName ? `<span>${esc(s.createdByName)}</span>` : ""}
          </div>
          ${s.note ? `<div class="sc-note">${esc(s.note)}</div>` : ""}
        </div>
        <div class="sc-side">
          <button class="vote ${mine ? "on" : ""}" type="button" data-vote="${esc(s.id)}"
                  ${S.canEdit() ? "" : "disabled"}
                  aria-label="行きたい ${votes}件">❤ ${votes}</button>
          ${byOrder && S.canEdit() ? `
            <div class="ord-btns">
              <button type="button" data-up="${esc(s.id)}"   ${pos <= 0 ? "disabled" : ""} aria-label="上へ">▲</button>
              <button type="button" data-down="${esc(s.id)}" ${pos >= S.state.spots.length - 1 ? "disabled" : ""} aria-label="下へ">▼</button>
            </div>` : ""}
        </div>
      </article>`;
  }).join("");
}

ui.spotList.addEventListener("click", async (e) => {
  const voteBtn = e.target.closest("[data-vote]");
  if (voteBtn) {
    e.stopPropagation();
    if (!S.canEdit()) return;
    const s = S.state.spots.find((x) => x.id === voteBtn.dataset.vote);
    const on = !(s.votes || {})[S.myUid()];
    try { await S.toggleVote(S.state.boardId, s.id, on); }
    catch (err) { toast(S.errMsg(err), "err"); }
    return;
  }

  const up = e.target.closest("[data-up]");
  const down = e.target.closest("[data-down]");
  if (up || down) {
    e.stopPropagation();
    const id = (up || down).dataset.up || (up || down).dataset.down;
    const i = S.state.spots.findIndex((x) => x.id === id);
    const j = up ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= S.state.spots.length) return;
    try { await S.swapOrder(S.state.boardId, S.state.spots[i], S.state.spots[j]); }
    catch (err) { toast(S.errMsg(err), "err"); }
    return;
  }

  const card = e.target.closest(".spot-card");
  if (card) select(card.dataset.id, true);
});

ui.spotList.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" && e.key !== " ") return;
  const card = e.target.closest(".spot-card");
  if (!card) return;
  e.preventDefault();
  openSpotDialog(S.state.spots.find((s) => s.id === card.dataset.id));
});

ui.spotList.addEventListener("dblclick", (e) => {
  const card = e.target.closest(".spot-card");
  if (card) openSpotDialog(S.state.spots.find((s) => s.id === card.dataset.id));
});

function select(id, pan) {
  selectedId = id;
  renderAll(); // マーカーを作り直すので、吹き出しは描画後に開く
  if (pan) M.focusSpot(id);
  else M.openPopupOf(id);
  if (pan && window.matchMedia("(max-width: 760px)").matches) closeSidebar();
}

[ui.q, ui.filterCat, ui.filterState, ui.sort].forEach((el) => {
  el.addEventListener("input", debounce(renderAll, 120));
  el.addEventListener("change", renderAll);
});
ui.showRoute.addEventListener("change", renderAll);

// =====================================================================
//  スポットの追加
// =====================================================================
function banner(text, autoHide = false) {
  if (!text) return ui.banner.classList.add("hidden");
  ui.banner.textContent = text;
  ui.banner.classList.remove("hidden");
  if (autoHide) setTimeout(() => ui.banner.classList.add("hidden"), 5000);
}

function setAddMode(on) {
  addMode = on && S.canEdit();
  ui.addMode.classList.toggle("active", addMode);
  ui.addMode.textContent = addMode ? "✕ 追加をやめる" : "＋ スポットを追加";
  M.setAddCursor(addMode);
  if (addMode) banner("地図をクリックして場所を指定してください");
  else { banner(""); M.clearGhost(); }
}

ui.addMode.addEventListener("click", () => {
  if (!S.state.boardId) return toast("先にマップを作成してください", "err");
  setAddMode(!addMode);
});

function onMapClick(latlng) {
  if (!addMode) return;
  setAddMode(false);
  M.showGhost(latlng);
  openSpotDialog(null, { lat: latlng.lat, lng: latlng.lng });
}

// =====================================================================
//  スポットの詳細・編集ダイアログ
// =====================================================================
function catPicker(sel) {
  return `<div class="cat-grid" id="sp-cats">` + CATEGORIES.map((c) => `
    <button type="button" class="cat-opt ${c.id === sel ? "on" : ""}" data-cat="${esc(c.id)}">
      <span class="ico">${c.icon}</span><span>${esc(c.label)}</span>
    </button>`).join("") + `</div>`;
}

function starPicker(v) {
  return `<div class="stars" id="sp-stars">` +
    [1, 2, 3, 4, 5].map((n) => `<button type="button" class="${n <= v ? "on" : ""}" data-star="${n}" aria-label="${n}">★</button>`).join("") +
    `<button type="button" class="btn sm ghost" data-star="0" style="margin-left:6px;filter:none;opacity:1">なし</button></div>`;
}

/**
 * @param {object|null} spot  既存スポット（null なら新規）
 * @param {object} pos        新規時の座標 { lat, lng }
 */
function openSpotDialog(spot, pos) {
  if (!spot && !pos) return;
  const isNew = !spot;
  if (isNew && !S.canEdit()) return;

  // 閲覧者は読み取り専用の表示
  if (!S.canEdit()) return openSpotView(spot);

  // 新規のときは地名検索や貼り付けた URL の情報を初期値に使う
  const cur = spot || {
    cat: "other", rating: 0, note: "",
    name: pos.name || "", addr: pos.addr || "", url: pos.url || "",
  };
  const body = `
    <label class="field"><span>場所の名前 *</span>
      <input type="text" id="sp-name" value="${esc(cur.name)}" maxlength="80" placeholder="例）清水寺" /></label>

    <div class="sect-title">カテゴリ</div>
    ${catPicker(cur.cat || "other")}

    <div class="sect-title">おすすめ度</div>
    ${starPicker(cur.rating || 0)}

    <label class="field" style="margin-top:16px"><span>メモ</span>
      <textarea id="sp-note" maxlength="1000" placeholder="行きたい理由、営業時間、予算など">${esc(cur.note || "")}</textarea></label>

    <label class="field"><span>参考リンク（任意）</span>
      <input type="url" id="sp-url" value="${esc(cur.url || "")}" placeholder="https://" /></label>

    ${!isNew ? `
      <label class="chk" style="margin-top:4px">
        <input type="checkbox" id="sp-done" ${cur.done ? "checked" : ""} /> 訪問済みにする
      </label>` : ""}

    <hr class="hr" />
    <label class="field"><span>Google マップの URL から座標を取り込む</span>
      <div class="field-row">
        <input type="text" id="sp-gurl" placeholder="URL を貼り付け" />
        <button class="btn sm" type="button" id="sp-gurl-go" style="flex:0 0 auto">取り込む</button>
      </div>
    </label>
    <div class="field-row">
      <label class="field"><span>緯度</span>
        <input type="text" id="sp-lat" value="${esc(isNew ? pos.lat.toFixed(6) : cur.lat)}" /></label>
      <label class="field"><span>経度</span>
        <input type="text" id="sp-lng" value="${esc(isNew ? pos.lng.toFixed(6) : cur.lng)}" /></label>
    </div>
    <label class="field"><span>住所（自動取得）</span>
      <input type="text" id="sp-addr" value="${esc(cur.addr || "")}" placeholder="取得中..." /></label>
    ${!isNew ? `<p class="help">登録: ${esc(cur.createdByName || "不明")} / ${esc(fmtDate(cur.createdAt))}</p>` : ""}
    ${!isNew ? `<div id="sp-comments"></div>` : ""}`;

  let pickedCat = cur.cat || "other";
  let pickedStar = cur.rating || 0;
  let unsubC = null;

  const m = modal({
    title: isNew ? "スポットを追加" : "スポットを編集",
    body,
    onMount: (el, close) => {
      el.querySelector("#sp-cats").addEventListener("click", (e) => {
        const b = e.target.closest("[data-cat]");
        if (!b) return;
        pickedCat = b.dataset.cat;
        el.querySelectorAll(".cat-opt").forEach((x) => x.classList.toggle("on", x === b));
      });
      el.querySelector("#sp-stars").addEventListener("click", (e) => {
        const b = e.target.closest("[data-star]");
        if (!b) return;
        pickedStar = Number(b.dataset.star);
        el.querySelectorAll("[data-star]").forEach((x) => {
          const n = Number(x.dataset.star);
          if (n > 0) x.classList.toggle("on", n <= pickedStar);
        });
      });

      if (isNew && !cur.addr) {
        M.reverseGeocode(pos.lat, pos.lng).then((a) => {
          const f = el.querySelector("#sp-addr");
          if (f && !f.value) f.value = a;
          const n = el.querySelector("#sp-name");
          if (n && !n.value && a) n.value = a.split(",")[0];
        });
      }

      // ダイアログ内でも Google マップ URL から座標を取り込めるようにする
      const gurl = el.querySelector("#sp-gurl");
      const applyGurl = () => {
        const hit = parseGoogleMapsUrl(gurl.value);
        if (!hit) return toast("この URL からは場所を読み取れませんでした", "err");
        if (hit.short) return toast("短縮 URL は一度ブラウザで開き、アドレスバーの URL を貼ってください", "err");
        if (hit.needsSearch) return toast("座標が含まれていません。左の検索欄から名前で探してください", "err");

        el.querySelector("#sp-lat").value = hit.lat.toFixed(6);
        el.querySelector("#sp-lng").value = hit.lng.toFixed(6);
        const nameF = el.querySelector("#sp-name");
        if (hit.name && !nameF.value) nameF.value = hit.name;
        const urlF = el.querySelector("#sp-url");
        if (!urlF.value) urlF.value = hit.url;

        M.setView([hit.lat, hit.lng], hit.zoom || 17);
        M.showGhost({ lat: hit.lat, lng: hit.lng });

        // 住所を取り直す
        M.reverseGeocode(hit.lat, hit.lng).then((a) => {
          const f = el.querySelector("#sp-addr");
          if (f && a) f.value = a;
        });
        gurl.value = "";
        toast("座標を取り込みました", "ok");
      };
      el.querySelector("#sp-gurl-go").addEventListener("click", applyGurl);
      gurl.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); applyGurl(); }
      });
      gurl.addEventListener("paste", (e) => {
        const t = e.clipboardData?.getData("text") || "";
        if (!/^\s*https?:\/\//i.test(t)) return;
        e.preventDefault();
        gurl.value = t.trim();
        setTimeout(applyGurl, 0);
      });

      if (!isNew) {
        unsubC = mountComments(el.querySelector("#sp-comments"), spot.id);
        const obs = new MutationObserver(() => {
          if (!el.isConnected) { obs.disconnect(); unsubC?.(); M.clearGhost(); }
        });
        obs.observe($("modal-root"), { childList: true });
      } else {
        const obs = new MutationObserver(() => {
          if (!el.isConnected) { obs.disconnect(); M.clearGhost(); }
        });
        obs.observe($("modal-root"), { childList: true });
      }
    },
    actions: [
      ...(isNew ? [] : [{
        label: "削除", kind: "danger", side: "left", keep: true,
        onClick: async ({ close }) => {
          const ok = await confirmDialog("削除しますか？", `「${spot.name}」を削除します。`, "削除する");
          if (!ok) return;
          try {
            await S.deleteSpot(S.state.boardId, spot.id);
            if (selectedId === spot.id) selectedId = null;
            toast("削除しました", "ok");
            close();
          } catch (e) { toast(S.errMsg(e), "err"); }
        },
      }]),
      { label: "キャンセル" },
      {
        label: isNew ? "追加する" : "保存", kind: "primary",
        onClick: async ({ el }) => {
          const name = el.querySelector("#sp-name").value.trim();
          const lat = parseFloat(el.querySelector("#sp-lat").value);
          const lng = parseFloat(el.querySelector("#sp-lng").value);
          if (!name) { toast("名前を入力してください", "err"); return false; }
          if (!Number.isFinite(lat) || !Number.isFinite(lng) ||
              lat < -90 || lat > 90 || lng < -180 || lng > 180) {
            toast("緯度・経度が正しくありません", "err"); return false;
          }
          const url = el.querySelector("#sp-url").value.trim();
          if (url && !/^https?:\/\//i.test(url)) {
            toast("リンクは http:// または https:// で始めてください", "err"); return false;
          }
          const data = {
            name, lat, lng,
            cat: pickedCat,
            rating: pickedStar,
            note: el.querySelector("#sp-note").value.trim(),
            url,
            addr: el.querySelector("#sp-addr").value.trim(),
          };
          try {
            if (isNew) {
              await S.addSpot(S.state.boardId, data);
              toast("追加しました", "ok");
            } else {
              data.done = el.querySelector("#sp-done").checked;
              await S.updateSpot(S.state.boardId, spot.id, data);
              toast("保存しました", "ok");
            }
            M.clearGhost();
          } catch (e) { toast(S.errMsg(e), "err"); return false; }
        },
      },
    ],
  });
  return m;
}

/** 閲覧者向け：読み取り専用の詳細表示 */
function openSpotView(spot) {
  if (!spot) return;
  const c = catOf(spot.cat);
  const votes = Object.keys(spot.votes || {}).length;
  const row = (k, v) => v ? `<div class="detail-row"><div class="k">${esc(k)}</div><div class="v">${v}</div></div>` : "";
  let unsubC = null;

  modal({
    title: spot.name,
    body: `
      ${row("カテゴリ", `${c.icon} ${esc(c.label)}`)}
      ${row("状態", spot.done ? "✅ 訪問済み" : "🕒 未訪問")}
      ${row("おすすめ", spot.rating ? "★".repeat(spot.rating) : "")}
      ${row("行きたい", votes ? `❤️ ${votes} 人` : "")}
      ${row("メモ", esc(spot.note))}
      ${row("リンク", spot.url ? `<a href="${esc(spot.url)}" target="_blank" rel="noopener noreferrer">${esc(spot.url)}</a>` : "")}
      ${row("住所", esc(spot.addr))}
      ${row("登録", `${esc(spot.createdByName || "不明")} / ${esc(fmtDate(spot.createdAt))}`)}
      <div id="sp-comments"></div>`,
    onMount: (el) => {
      unsubC = mountComments(el.querySelector("#sp-comments"), spot.id);
      const obs = new MutationObserver(() => {
        if (!el.isConnected) { obs.disconnect(); unsubC?.(); }
      });
      obs.observe($("modal-root"), { childList: true });
    },
    actions: [
      {
        label: "地図で見る",
        onClick: () => M.focusSpot(spot.id, 17),
      },
      { label: "閉じる", kind: "primary" },
    ],
  });
}

/** コメント欄をマウントして購読解除関数を返す */
function mountComments(host, spotId) {
  if (!host) return null;
  host.innerHTML = `
    <div class="sect-title">コメント</div>
    <ul class="comments" id="c-list"><li style="color:#6b7684">読み込み中...</li></ul>
    ${S.canEdit() ? `
      <div class="comment-form">
        <input type="text" id="c-text" maxlength="500" placeholder="ひとこと書く" />
        <button class="btn primary sm" type="button" id="c-send">送信</button>
      </div>` : `<p class="help" style="margin-top:8px">閲覧モードではコメントできません。</p>`}`;

  const list = host.querySelector("#c-list");

  const unsub = S.watchComments(
    S.state.boardId, spotId,
    (rows) => {
      list.innerHTML = rows.length
        ? rows.map((c) => `
            <li>
              <div class="c-head">
                <span class="c-who">${esc(c.byName || "誰か")}</span>
                <span class="c-at">${esc(fmtDate(c.createdAt))}</span>
                ${(S.isAdmin() || c.by === S.myUid())
                  ? `<span class="spacer"></span><button class="icon-btn" style="width:24px;height:24px;font-size:13px"
                       data-del="${esc(c.id)}" aria-label="コメントを削除">🗑</button>` : ""}
              </div>
              <div class="c-text">${esc(c.text)}</div>
            </li>`).join("")
        : `<li style="color:#6b7684">まだコメントはありません。</li>`;
    },
    () => { list.innerHTML = `<li style="color:#6b7684">コメントを読み込めませんでした。</li>`; },
  );

  list.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-del]");
    if (!b) return;
    if (!(await confirmDialog("コメントを削除", "このコメントを削除します。", "削除する"))) return;
    try { await S.deleteComment(S.state.boardId, spotId, b.dataset.del); }
    catch (err) { toast(S.errMsg(err), "err"); }
  });

  const send = host.querySelector("#c-send");
  if (send) {
    const input = host.querySelector("#c-text");
    const post = async () => {
      const t = input.value.trim();
      if (!t) return;
      send.disabled = true;
      try { await S.addComment(S.state.boardId, spotId, t); input.value = ""; }
      catch (err) { toast(S.errMsg(err), "err"); }
      finally { send.disabled = false; input.focus(); }
    };
    send.addEventListener("click", post);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); post(); } });
  }

  return unsub;
}

// =====================================================================
//  地名検索
// =====================================================================
const geoList = $("geo-results");

/**
 * 検索欄の入力を処理する。
 * Google マップの URL / 座標 / 地名 を自動で見分ける。
 * @returns {boolean} URL または座標として処理したか
 */
function handlePastedLocation(text) {
  const hit = parseGoogleMapsUrl(text);

  // 短縮 URL（maps.app.goo.gl）はブラウザから展開できないので案内を出す
  if (hit?.short) {
    showShortLinkHelp(hit.url);
    return true;
  }

  // Google マップの URL なのに手がかりが取れなかった場合
  if (!hit && isGoogleMapsUrl(text)) {
    if (isShortLink(text)) { showShortLinkHelp(extractUrl(text)); return true; }
    toast("この URL からは場所を読み取れませんでした", "err");
    return true;
  }

  if (!hit) return false;

  // 座標が無く名前だけ取れた場合は、その名前で地名検索に回す
  if (hit.needsSearch) {
    if (!hit.name) return false;
    $("geo-q").value = hit.name;
    toast(`「${hit.name}」で検索します`);
    return false;
  }

  if (!S.canEdit() || !S.state.boardId) {
    // 閲覧モードなどでは地図を動かすだけ
    M.setView([hit.lat, hit.lng], hit.zoom || 16);
    geoList.classList.add("hidden");
    return true;
  }

  M.setView([hit.lat, hit.lng], hit.zoom || 17);
  M.showGhost({ lat: hit.lat, lng: hit.lng });
  geoList.classList.add("hidden");
  $("geo-q").value = "";

  openSpotDialog(null, {
    lat: hit.lat,
    lng: hit.lng,
    name: hit.name,
    url: hit.url,   // 貼った Google マップの URL を参考リンクとして保持
  });
  if (window.matchMedia("(max-width: 760px)").matches) closeSidebar();
  return true;
}

/** 短縮 URL の展開方法を案内する */
function showShortLinkHelp(url) {
  modal({
    title: "短縮 URL は展開が必要です",
    body: `
      <p style="margin:0 0 12px">
        <code>maps.app.goo.gl</code> の短縮 URL は、ブラウザのセキュリティ制限
        （CORS）により、このアプリから展開先を読み取れません。
      </p>
      <p style="margin:0 0 12px"><b>かんたんな解決方法</b></p>
      <ol style="margin:0 0 14px;padding-left:1.3em;line-height:1.9">
        <li>下のボタンで短縮 URL を開く</li>
        <li>開いた Google マップの<b>アドレスバーの URL をコピー</b></li>
        <li>それをこの検索欄に貼り付ける</li>
      </ol>
      <p class="help" style="margin:0">
        Google マップのアプリで「共有」ではなく、パソコンのブラウザで開いた
        アドレスバーの URL（<code>/maps/place/...@35.68,139.76...</code> の形）を
        使うと一度で登録できます。
      </p>`,
    actions: [
      {
        label: "短縮 URL を開く", kind: "primary", keep: true,
        onClick: () => { window.open(url, "_blank", "noopener"); },
      },
      { label: "閉じる" },
    ],
  });
}

async function runGeocode() {
  const q = $("geo-q").value.trim();
  if (!q) return geoList.classList.add("hidden");

  // まず URL や座標として解釈できるか試す
  if (handlePastedLocation(q)) return;

  geoList.classList.remove("hidden");
  geoList.innerHTML = `<li style="pointer-events:none;color:#6b7684">検索中...</li>`;
  try {
    const rows = await M.geocode(q);
    if (!rows.length) {
      geoList.innerHTML = `<li style="pointer-events:none;color:#6b7684">見つかりませんでした</li>`;
      return;
    }
    geoList.innerHTML = rows.map((r, i) => `
      <li data-i="${i}" tabindex="0" role="button">
        <div class="g-name">${esc(r.name)}</div>
        <div class="g-addr">${esc(r.addr)}</div>
      </li>`).join("");
    geoList._rows = rows;
  } catch {
    geoList.innerHTML = `<li style="pointer-events:none;color:#6b7684">検索に失敗しました</li>`;
  }
}

$("geo-btn").addEventListener("click", runGeocode);
$("geo-q").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); runGeocode(); } });

// URL を貼り付けたら、ボタンを押さなくてもすぐ処理する
$("geo-q").addEventListener("paste", (e) => {
  const text = e.clipboardData?.getData("text") || "";
  if (!/^\s*https?:\/\//i.test(text) && !/^\s*-?\d{1,3}\.\d+\s*[,\s]/.test(text)) return;
  e.preventDefault();
  $("geo-q").value = text.trim();
  setTimeout(runGeocode, 0);
});

geoList.addEventListener("click", (e) => {
  const li = e.target.closest("li[data-i]");
  if (!li) return;
  const r = geoList._rows?.[Number(li.dataset.i)];
  if (!r) return;
  M.setView([r.lat, r.lng], 16);
  geoList.classList.add("hidden");
  $("geo-q").value = "";
  if (S.canEdit() && S.state.boardId) {
    M.showGhost({ lat: r.lat, lng: r.lng });
    openSpotDialog(null, { lat: r.lat, lng: r.lng, addr: r.addr, name: r.name });
  }
  if (window.matchMedia("(max-width: 760px)").matches) closeSidebar();
});

// =====================================================================
//  書き出し
// =====================================================================
$("btn-export").addEventListener("click", () => {
  const rows = visibleSpots();
  if (!rows.length) return toast("書き出すスポットがありません", "err");
  const bname = S.state.board?.name || "map";

  modal({
    title: "書き出し",
    body: `<p class="help" style="margin:0 0 12px">表示中の ${rows.length} 件を書き出します。</p>
           <div style="display:flex;flex-direction:column;gap:8px">
             <button class="btn block" type="button" data-fmt="text">テキストで一覧をコピー</button>
             <button class="btn block" type="button" data-fmt="geojson">GeoJSON ファイルを保存</button>
             <button class="btn block" type="button" data-fmt="gmap">Google マップで順路を開く</button>
           </div>`,
    onMount: (el, close) => {
      el.addEventListener("click", async (e) => {
        const b = e.target.closest("[data-fmt]");
        if (!b) return;
        const fmt = b.dataset.fmt;

        if (fmt === "text") {
          const txt = `【${bname}】\n` + rows.map((s, i) => {
            const c = catOf(s.cat);
            return `${i + 1}. ${s.name}（${c.label}）${s.done ? " ✅" : ""}\n`
              + (s.addr ? `   ${s.addr}\n` : "")
              + (s.note ? `   memo: ${s.note}\n` : "")
              + `   https://www.google.com/maps/search/?api=1&query=${s.lat},${s.lng}\n`;
          }).join("");
          try {
            await navigator.clipboard.writeText(txt);
            toast("クリップボードにコピーしました", "ok");
          } catch {
            modal({ title: "コピーしてください", wide: true,
              body: `<textarea rows="14" readonly>${esc(txt)}</textarea>`,
              actions: [{ label: "閉じる", kind: "primary" }] });
          }
          close();
        }

        if (fmt === "geojson") {
          const gj = {
            type: "FeatureCollection",
            features: rows.map((s) => ({
              type: "Feature",
              geometry: { type: "Point", coordinates: [s.lng, s.lat] },
              properties: {
                name: s.name, category: s.cat, note: s.note || "",
                url: s.url || "", address: s.addr || "",
                rating: s.rating || 0, visited: !!s.done,
                votes: Object.keys(s.votes || {}).length,
              },
            })),
          };
          const url = URL.createObjectURL(
            new Blob([JSON.stringify(gj, null, 2)], { type: "application/geo+json" }),
          );
          const a = document.createElement("a");
          a.href = url;
          a.download = `${bname.replace(/[\\/:*?"<>|]/g, "_")}.geojson`;
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
          close();
        }

        if (fmt === "gmap") {
          const pts = rows.slice(0, 10).map((s) => `${s.lat},${s.lng}`);
          if (pts.length < 2) {
            window.open(`https://www.google.com/maps/search/?api=1&query=${pts[0]}`, "_blank", "noopener");
          } else {
            const origin = pts.shift();
            const dest = pts.pop();
            const wp = pts.length ? `&waypoints=${pts.join("|")}` : "";
            window.open(
              `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${dest}${wp}`,
              "_blank", "noopener",
            );
          }
          if (rows.length > 10) toast("Google マップの上限に合わせて先頭10件のみ開きました");
          close();
        }
      });
    },
    actions: [{ label: "閉じる" }],
  });
});

// =====================================================================
//  管理画面 / サイドバー開閉
// =====================================================================
$("btn-admin").addEventListener("click", () => {
  if (S.isAdmin()) openAdmin();
});

function closeSidebar() {
  ui.sidebar.classList.remove("open");
  $("btn-sidebar").setAttribute("aria-expanded", "false");
}

$("btn-sidebar").addEventListener("click", () => {
  const open = ui.sidebar.classList.toggle("open");
  $("btn-sidebar").setAttribute("aria-expanded", String(open));
  M.refresh();
});

// Esc で追加モードを抜ける
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && addMode && !$("modal-root").childElementCount) setAddMode(false);
});
