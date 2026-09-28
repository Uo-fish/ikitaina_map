// 小さな UI ユーティリティ（トースト / モーダル / 文字列処理）

const toastRoot = () => document.getElementById("toast-root");
const modalRoot = () => document.getElementById("modal-root");

/** HTML エスケープ（ユーザー入力を innerHTML に混ぜる箇所で必ず使う） */
export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

/** 画面下に短いメッセージを出す */
export function toast(text, kind = "", ms = 2600) {
  const el = document.createElement("div");
  el.className = "toast" + (kind ? " " + kind : "");
  el.textContent = text;
  toastRoot().appendChild(el);
  setTimeout(() => el.remove(), ms);
}

let openCount = 0;

/**
 * モーダルを開く。
 * @param {object} o
 * @param {string} o.title      見出し
 * @param {string} o.body       本文 HTML（呼び出し側でエスケープ済みにすること）
 * @param {Array}  o.actions    [{ label, kind, side, onClick, keep }]
 * @param {boolean} o.wide      横幅を広くする
 * @param {Function} o.onMount  描画後に呼ばれる（el, close を受け取る）
 * @returns {{el:HTMLElement, close:Function}}
 */
export function modal(o) {
  const back = document.createElement("div");
  back.className = "modal-back";
  back.setAttribute("role", "dialog");
  back.setAttribute("aria-modal", "true");

  const box = document.createElement("div");
  box.className = "modal" + (o.wide ? " wide" : "");
  box.innerHTML = `
    <div class="modal-head">
      <h2>${esc(o.title || "")}</h2>
      <button class="icon-btn" type="button" data-x aria-label="閉じる">✕</button>
    </div>
    <div class="modal-body">${o.body || ""}</div>`;

  const prevFocus = document.activeElement;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    back.remove();
    openCount = Math.max(0, openCount - 1);
    if (openCount === 0) document.removeEventListener("keydown", onKey);
    if (prevFocus?.isConnected) try { prevFocus.focus(); } catch { /* noop */ }
  };
  const onKey = (e) => {
    if (e.key === "Escape") {
      const top = modalRoot().lastElementChild;
      if (top === back) close();
    }
  };

  if (o.actions?.length) {
    const foot = document.createElement("div");
    foot.className = "modal-foot";
    o.actions.forEach((a) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "btn " + (a.kind || "") + (a.side === "left" ? " left" : "");
      b.textContent = a.label;
      b.addEventListener("click", async () => {
        let r = true;
        if (a.onClick) {
          b.disabled = true;
          try { r = await a.onClick({ el: box, close, btn: b }); }
          finally { if (!closed) b.disabled = false; }
        }
        if (r !== false && !a.keep) close();
      });
      foot.appendChild(b);
    });
    box.appendChild(foot);
  }

  back.appendChild(box);
  back.addEventListener("mousedown", (e) => { if (e.target === back) close(); });
  box.querySelector("[data-x]").addEventListener("click", close);

  modalRoot().appendChild(back);
  openCount++;
  if (openCount === 1) document.addEventListener("keydown", onKey);

  // 最初の入力欄へフォーカス
  const first = box.querySelector("input:not([type=hidden]), textarea, select");
  (first || box.querySelector("[data-x]"))?.focus();

  o.onMount?.(box, close);
  return { el: box, close };
}

/** はい／いいえの確認ダイアログ */
export function confirmDialog(title, message, okLabel = "OK", kind = "danger") {
  return new Promise((resolve) => {
    let decided = false;
    const m = modal({
      title,
      body: `<p style="margin:0;white-space:pre-wrap">${esc(message)}</p>`,
      actions: [
        { label: "キャンセル", onClick: () => { decided = true; resolve(false); } },
        { label: okLabel, kind, onClick: () => { decided = true; resolve(true); } },
      ],
    });
    // ✕ や Esc で閉じられた場合も false を返す
    const obs = new MutationObserver(() => {
      if (!m.el.isConnected) { obs.disconnect(); if (!decided) resolve(false); }
    });
    obs.observe(modalRoot(), { childList: true });
  });
}

/** 単一行入力のダイアログ */
export function promptDialog({ title, label, value = "", placeholder = "", okLabel = "保存", multiline = false }) {
  return new Promise((resolve) => {
    let decided = false;
    const input = multiline
      ? `<textarea id="pd-in" placeholder="${esc(placeholder)}">${esc(value)}</textarea>`
      : `<input type="text" id="pd-in" value="${esc(value)}" placeholder="${esc(placeholder)}" />`;
    const m = modal({
      title,
      body: `<label class="field"><span>${esc(label)}</span>${input}</label>`,
      actions: [
        { label: "キャンセル", onClick: () => { decided = true; resolve(null); } },
        {
          label: okLabel, kind: "primary",
          onClick: ({ el }) => {
            const v = el.querySelector("#pd-in").value.trim();
            if (!v) { toast("入力してください", "err"); return false; }
            decided = true; resolve(v);
          },
        },
      ],
    });
    const obs = new MutationObserver(() => {
      if (!m.el.isConnected) { obs.disconnect(); if (!decided) resolve(null); }
    });
    obs.observe(modalRoot(), { childList: true });
  });
}

/** Firestore Timestamp / Date / 数値 を「2026/09/28 14:03」形式にする */
export function fmtDate(ts, withTime = true) {
  if (!ts) return "";
  const d = ts.toDate ? ts.toDate() : ts instanceof Date ? ts : new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n) => String(n).padStart(2, "0");
  const base = `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())}`;
  return withTime ? `${base} ${p(d.getHours())}:${p(d.getMinutes())}` : base;
}

/** 連続呼び出しをまとめる */
export function debounce(fn, ms = 250) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
