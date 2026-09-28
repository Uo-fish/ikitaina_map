// =====================================================================
//  管理画面（管理者のみ）
//   - アカウントの役割変更 / 無効化 / 削除
//   - 招待コードの発行
//   - 閲覧パスワードの変更
// =====================================================================
import { esc, toast, modal, confirmDialog, fmtDate } from "./ui.js";
import * as S from "./store.js";
import { VIEWER_EMAIL } from "./config.js";

const ROLE_LABEL = { admin: "管理者", editor: "記載者", viewer: "閲覧者" };

export function openAdmin() {
  if (!S.isAdmin()) return;

  let unsubUsers = null;
  let unsubInvites = null;

  const m = modal({
    title: "アカウント管理",
    wide: true,
    body: `
      <div class="sect-title">アカウント一覧</div>
      <div id="ad-users"><p class="help">読み込み中...</p></div>

      <div class="sect-title">招待コード</div>
      <p class="help">
        コードを発行して相手に伝えてください。受け取った人は入口の「招待コード」タブから
        自分でアカウントを作れます。コードは1回だけ使えます。
      </p>
      <div style="display:flex;gap:8px;margin-bottom:12px">
        <button class="btn sm" type="button" id="ad-inv-editor">記載者コードを発行</button>
        <button class="btn sm" type="button" id="ad-inv-admin">管理者コードを発行</button>
      </div>
      <div id="ad-invites"><p class="help">読み込み中...</p></div>

      <div class="sect-title">閲覧パスワード</div>
      <p class="help">
        アカウントを持たない人が閲覧モードで入るための共通パスワードです。
        変更するには現在のパスワードが必要です。
      </p>
      <button class="btn sm" type="button" id="ad-viewer-pw">閲覧パスワードを変更</button>

      <div class="sect-title">このアプリについて</div>
      <p class="help" style="margin:0">
        管理者＝全権限（アカウント管理・マップ削除）／記載者＝スポットの追加・編集／
        閲覧者＝見るだけ。
      </p>`,
    onMount: (el, close) => {
      const usersHost = el.querySelector("#ad-users");
      const invHost = el.querySelector("#ad-invites");

      // ---- アカウント一覧 ----
      unsubUsers = S.watchUsers(
        (rows) => {
          rows.sort((a, b) => String(a.name).localeCompare(String(b.name), "ja"));
          const adminCount = rows.filter((u) => u.role === "admin" && !u.disabled).length;

          usersHost.innerHTML = `
            <table class="table">
              <thead><tr><th>名前</th><th>メール</th><th>役割</th><th>状態</th><th></th></tr></thead>
              <tbody>${rows.map((u) => {
                const isMe = u.id === S.myUid();
                const lastAdmin = u.role === "admin" && adminCount <= 1;
                return `
                  <tr>
                    <td>${esc(u.name || "-")}${isMe ? " <span class=\"badge\">自分</span>" : ""}</td>
                    <td style="color:#6b7684;font-size:12px;overflow-wrap:anywhere">${esc(u.email || "")}</td>
                    <td>
                      <select data-role="${esc(u.id)}" ${isMe || lastAdmin ? "disabled" : ""}
                              aria-label="${esc(u.name)} の役割">
                        ${["admin", "editor", "viewer"].map((r) =>
                          `<option value="${r}" ${u.role === r ? "selected" : ""}>${ROLE_LABEL[r]}</option>`).join("")}
                      </select>
                    </td>
                    <td class="nowrap" style="font-size:12px">
                      ${u.disabled ? '<span style="color:#e04a4a">停止中</span>' : '<span style="color:#17a673">有効</span>'}
                    </td>
                    <td class="nowrap">
                      ${isMe ? "" : `
                        <button class="btn sm ghost" type="button" data-toggle="${esc(u.id)}"
                                data-next="${u.disabled ? "0" : "1"}" ${lastAdmin ? "disabled" : ""}>
                          ${u.disabled ? "再開" : "停止"}
                        </button>
                        <button class="btn sm ghost" type="button" data-del-user="${esc(u.id)}"
                                ${lastAdmin ? "disabled" : ""}>削除</button>`}
                    </td>
                  </tr>`;
              }).join("")}</tbody>
            </table>
            <p class="help" style="margin-top:8px">
              「停止」すると次回のログイン時から入れなくなります。
            </p>`;
        },
        (e) => { usersHost.innerHTML = `<p class="help">読み込めませんでした（${esc(S.errMsg(e))}）</p>`; },
      );

      usersHost.addEventListener("change", async (e) => {
        const sel = e.target.closest("[data-role]");
        if (!sel) return;
        try {
          await S.setUserRole(sel.dataset.role, sel.value);
          toast("役割を変更しました", "ok");
        } catch (err) { toast(S.errMsg(err), "err"); }
      });

      usersHost.addEventListener("click", async (e) => {
        const tg = e.target.closest("[data-toggle]");
        if (tg) {
          const next = tg.dataset.next === "1";
          try {
            await S.setUserDisabled(tg.dataset.toggle, next);
            toast(next ? "停止しました" : "再開しました", "ok");
          } catch (err) { toast(S.errMsg(err), "err"); }
          return;
        }

        const del = e.target.closest("[data-del-user]");
        if (del) {
          const ok = await confirmDialog(
            "アカウント情報を削除",
            "この利用者の権限情報を削除します。\n\n"
            + "ログイン自体を完全に消すには、Firebase コンソールの Authentication からも"
            + "削除してください（無料プランではアプリ側から実行できません）。",
            "削除する",
          );
          if (!ok) return;
          try {
            await S.removeUserDoc(del.dataset.delUser);
            toast("削除しました", "ok");
          } catch (err) { toast(S.errMsg(err), "err"); }
        }
      });

      // ---- 招待コード ----
      unsubInvites = S.watchInvites(
        (rows) => {
          invHost.innerHTML = rows.length
            ? `<table class="table">
                 <thead><tr><th>コード</th><th>役割</th><th>状態</th><th></th></tr></thead>
                 <tbody>${rows.map((i) => `
                   <tr>
                     <td><span class="code-chip ${i.usedBy ? "used" : ""}">${esc(i.id)}</span></td>
                     <td>${ROLE_LABEL[i.role] || esc(i.role)}</td>
                     <td style="font-size:12px;color:#6b7684">
                       ${i.usedBy
                          ? `使用済み（${esc(i.usedByName || "?")}）`
                          : `未使用 / ${esc(fmtDate(i.createdAt, false))}`}
                     </td>
                     <td class="nowrap">
                       ${i.usedBy ? "" : `<button class="btn sm ghost" type="button" data-copy="${esc(i.id)}">コピー</button>`}
                       <button class="btn sm ghost" type="button" data-del-inv="${esc(i.id)}">削除</button>
                     </td>
                   </tr>`).join("")}</tbody>
               </table>`
            : `<p class="help">発行済みのコードはありません。</p>`;
        },
        (e) => { invHost.innerHTML = `<p class="help">読み込めませんでした（${esc(S.errMsg(e))}）</p>`; },
      );

      invHost.addEventListener("click", async (e) => {
        const cp = e.target.closest("[data-copy]");
        if (cp) {
          try {
            await navigator.clipboard.writeText(cp.dataset.copy);
            toast("コードをコピーしました", "ok");
          } catch { toast("コピーできませんでした", "err"); }
          return;
        }
        const dl = e.target.closest("[data-del-inv]");
        if (dl) {
          if (!(await confirmDialog("コードを削除", `${dl.dataset.delInv} を削除します。`, "削除する"))) return;
          try { await S.deleteInvite(dl.dataset.delInv); }
          catch (err) { toast(S.errMsg(err), "err"); }
        }
      });

      const issue = async (role, btn) => {
        btn.disabled = true;
        try {
          const code = await S.createInvite(role);
          modal({
            title: "招待コードを発行しました",
            body: `<p style="margin:0 0 10px">下のコードを相手に伝えてください。1回だけ使えます。</p>
                   <div style="text-align:center;margin:14px 0">
                     <span class="code-chip" style="font-size:22px;padding:10px 18px">${esc(code)}</span>
                   </div>
                   <p class="help" style="margin:0">役割: ${ROLE_LABEL[role]}</p>`,
            actions: [
              {
                label: "コピー", keep: true,
                onClick: async () => {
                  try { await navigator.clipboard.writeText(code); toast("コピーしました", "ok"); }
                  catch { toast("コピーできませんでした", "err"); }
                },
              },
              { label: "閉じる", kind: "primary" },
            ],
          });
        } catch (e) { toast(S.errMsg(e), "err"); }
        finally { btn.disabled = false; }
      };

      el.querySelector("#ad-inv-editor").addEventListener("click", (e) => issue("editor", e.currentTarget));
      el.querySelector("#ad-inv-admin").addEventListener("click", (e) => issue("admin", e.currentTarget));

      // ---- 閲覧パスワード変更 ----
      el.querySelector("#ad-viewer-pw").addEventListener("click", () => {
        modal({
          title: "閲覧パスワードの変更",
          body: `
            <p class="help" style="margin-top:0">対象アカウント: <code>${esc(VIEWER_EMAIL)}</code></p>
            <label class="field"><span>現在の閲覧パスワード</span>
              <input type="password" id="vp-cur" autocomplete="off" /></label>
            <label class="field"><span>新しいパスワード（6文字以上）</span>
              <input type="password" id="vp-new" minlength="6" autocomplete="new-password" /></label>
            <label class="field"><span>新しいパスワード（確認）</span>
              <input type="password" id="vp-new2" minlength="6" autocomplete="new-password" /></label>
            <p class="help" style="margin-bottom:0">
              変更しても自分のログイン状態はそのまま保たれます。
            </p>`,
          actions: [
            { label: "キャンセル" },
            {
              label: "変更する", kind: "primary",
              onClick: async ({ el: box }) => {
                const cur = box.querySelector("#vp-cur").value;
                const a = box.querySelector("#vp-new").value;
                const b = box.querySelector("#vp-new2").value;
                if (a.length < 6) { toast("6文字以上にしてください", "err"); return false; }
                if (a !== b) { toast("新しいパスワードが一致しません", "err"); return false; }
                try {
                  await S.changeOtherPassword(VIEWER_EMAIL, cur, a);
                  toast("閲覧パスワードを変更しました", "ok");
                } catch (err) {
                  toast(
                    /credential|password|user-not-found/.test(err?.code || "")
                      ? "現在のパスワードが違います（または閲覧用アカウントが未作成です）"
                      : S.errMsg(err),
                    "err",
                  );
                  return false;
                }
              },
            },
          ],
        });
      });

      // モーダルが閉じられたら購読を解除
      const obs = new MutationObserver(() => {
        if (!el.isConnected) { obs.disconnect(); unsubUsers?.(); unsubInvites?.(); }
      });
      obs.observe(document.getElementById("modal-root"), { childList: true });
    },
    actions: [{ label: "閉じる", kind: "primary" }],
  });

  return m;
}
