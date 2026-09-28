# 📍 行きたいマップ

みんなで「行きたいところ」を地図上に集めて共有できるウェブアプリです。
Firebase（無料の Spark プラン）＋ GitHub Pages で、**利用料 0 円**で運用できます。

---

## できること

- 地図をクリックしてスポットを登録（名前・カテゴリ・メモ・おすすめ度・リンク・住所）
- 地名やお店の名前で検索して、その場所を登録
- **Google マップの URL を貼り付けるだけで登録**（座標・店名・リンクを自動で取り込み）
- 「35.68, 139.76」のような座標の貼り付けにも対応
- 「❤ 行きたい」投票、スポットごとのコメント
- 訪問済みチェック、順路の並べ替えと線表示
- カテゴリ・状態・キーワードでのしぼり込みと並べ替え
- 旅行ごとに複数の「マップ」を作り分け
- テキスト／GeoJSON への書き出し、Google マップで順路を開く
- スマホでもそのまま使えるレイアウト

## 3 つの役割

| 役割 | ログイン方法 | できること |
| --- | --- | --- |
| **管理者** | メール＋パスワード | 全権限。アカウントの発行・役割変更・停止・削除、閲覧パスワードの変更、マップの削除 |
| **記載者** | メール＋パスワード | スポットの追加・編集・削除、投票、コメント、マップ作成 |
| **閲覧者** | **閲覧パスワードのみ**（アカウント不要） | 見るだけ |

権限は **Firestore セキュリティルール**（`firestore.rules`）で守っています。
ブラウザの開発者ツールを操作しても、ルールを超えた書き込みはできません。

---

## セットアップ

所要 15 分ほど。**クレジットカードの登録は不要**です。

### 手順 1. Firebase プロジェクトを作る

1. [Firebase コンソール](https://console.firebase.google.com/) を開く
2. 「プロジェクトを追加」→ 好きな名前（例: `ikitai-map`）
3. Google アナリティクスは **無効**でよい（無効の方が設定が簡単）
4. プランは **Spark（無料）** のまま。Blaze にアップグレードしないこと

### 手順 2. Authentication を有効にする

1. 左メニュー **構築 → Authentication → 始める**
2. 「ログイン方法」タブ → **メール / パスワード** を選び、**有効にする** → 保存
   - 「メールリンク」は不要
3. **Settings → 承認済みドメイン**に、公開する GitHub Pages のドメインを追加
   - 例: `あなたのユーザー名.github.io`
   - `localhost` は最初から入っています

### 手順 3. Firestore データベースを作る

1. 左メニュー **構築 → Firestore Database → データベースの作成**
2. ロケーションは近い場所（例: `asia-northeast1` 東京）
3. 開始モードは **本番環境モード** を選ぶ（次の手順でルールを入れます）

### 手順 4. セキュリティルールを反映する

1. Firestore Database の **ルール**タブを開く
2. このリポジトリの [`firestore.rules`](firestore.rules) の**中身をすべてコピーして貼り付け**
3. **公開** をクリック

> Firebase CLI を使う場合は `firebase deploy --only firestore:rules` でも反映できます。

### 手順 5. 設定値をアプリに貼り付ける

1. Firebase コンソールの **⚙ プロジェクトの設定 → マイアプリ**
2. **ウェブ（`</>`）**アイコンでアプリを登録（Hosting のチェックは不要）
3. 表示される `firebaseConfig` の値を [`js/config.js`](js/config.js) に貼り付ける

```js
export const firebaseConfig = {
  apiKey: "AIza...",
  authDomain: "ikitai-map.firebaseapp.com",
  projectId: "ikitai-map",
  storageBucket: "ikitai-map.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abc...",
};
```

> この値は公開して問題ありません。秘密鍵ではなく「どのプロジェクトか」を示す識別子です。
> 実際のアクセス制御は手順 4 のルールが担っています。

### 手順 6. 閲覧専用アカウントを作る

閲覧者が「パスワードだけ」で入れるようにするための仕込みです。

1. Firebase コンソール **Authentication → Users → ユーザーを追加**
2. メールアドレスに `viewer@ikitai-map.local` を入力
   （`js/config.js` の `VIEWER_EMAIL` と同じ文字列にすること）
3. パスワードに、**みんなに共有したい閲覧パスワード**を入力して追加

これで閲覧者はメールアドレスを知らなくても、パスワードだけで入れます。
あとから変更したいときは、アプリの「管理」画面から変更できます。

### 手順 7. GitHub Pages で公開する

1. GitHub で新しいリポジトリを作る（**Public** にすると Actions も Pages も無料枠内）
2. このフォルダの中身を push する

```bash
git init
git add .
git commit -m "行きたいマップ"
git branch -M main
git remote add origin https://github.com/あなたのユーザー名/リポジトリ名.git
git push -u origin main
```

3. リポジトリの **Settings → Pages → Source** を **GitHub Actions** に設定
4. 数十秒待つと `https://あなたのユーザー名.github.io/リポジトリ名/` で公開されます

> 手順 2 の「承認済みドメイン」に `あなたのユーザー名.github.io` を追加し忘れると
> ログインできません。忘れがちなので確認してください。

### 手順 8. 最初の管理者を作る

1. 公開した URL を開く
2. 「はじめての起動です」という画面が出るので、管理者の表示名・メール・パスワードを入力
3. **この画面は 1 回だけ**表示されます。公開直後にすぐ済ませてください

> 誰かに先に管理者を取られないよう、公開したらすぐ手順 8 を行ってください。
> 心配な場合は、先にローカル（下記）で管理者を作ってから公開しても構いません。

### 手順 9. 仲間を招待する

1. 管理者でログイン → 右上の **管理** ボタン
2. 「記載者コードを発行」→ 出てきた 8 桁のコードを相手に伝える
3. 相手は入口の **招待コード** タブから、自分でアカウントを作成できます

見るだけの人には、URL と**閲覧パスワード**を伝えるだけで OK です。

---

## Google マップの URL から登録する

左の検索欄に Google マップの URL を**貼り付けるだけ**で、座標・店名・リンクが
自動で入ったスポット登録ダイアログが開きます（貼り付けた時点で動くので、
検索ボタンを押す必要はありません）。スポット編集ダイアログの中にも
「Google マップの URL から座標を取り込む」欄があります。

対応している形式:

| 貼り付けるもの | 例 |
| --- | --- |
| 場所のページ | `https://www.google.com/maps/place/清水寺/@34.99,135.78,17z/data=...` |
| 地図の座標 | `https://www.google.com/maps/@35.68,139.76,15z` |
| 共有リンク | `https://www.google.com/maps/search/?api=1&query=35.68,139.76` |
| 検索・ルート | `?q=`、`&destination=`、`&ll=` などを含む URL |
| 座標を直接 | `35.681236, 139.767125` |

URL の中に文章が混ざっていても（例:「ここ行きたい https://... どう？」）URL 部分だけを
取り出して処理します。

### ⚠ 短縮 URL（`maps.app.goo.gl`）について

スマホの Google マップの「共有」で出てくる `https://maps.app.goo.gl/xxxx` という
短縮 URL は、**そのままでは読み取れません**。ブラウザのセキュリティ制限（CORS）で
リダイレクト先を取得できないためです。サーバーを立てれば解決できますが、
それには有料プランが必要なので、0 円の条件を守るためにあえて対応していません。

貼り付けると案内ダイアログが出ます。次のどちらかで登録してください。

- **パソコン**: Google マップでその場所を開き、**アドレスバーの URL**をコピーして貼る
- **スマホ**: 短縮 URL を一度ブラウザで開き、開いた先のアドレスバーの URL を貼る

店名がわかっている場合は、URL ではなく**店名で検索**するのが一番早いです。

---

## ローカルで動かす

`file://` では ES モジュールが動かないので、簡易サーバー経由で開きます。

```bash
python -m http.server 8000
# → http://localhost:8000
```

---

## 料金が 0 円になる理由

| 使うもの | プラン | 無料の範囲 |
| --- | --- | --- |
| Firebase Authentication | Spark（無料） | メール／パスワード認証は無料 |
| Cloud Firestore | Spark（無料） | 読み取り 5 万回／書き込み 2 万回／日、保存 1 GiB |
| GitHub Pages | 無料 | パブリックリポジトリの静的サイト配信 |
| GitHub Actions | 無料 | パブリックリポジトリは実行時間無制限 |
| 地図タイル | OpenStreetMap | 無料・APIキー不要 |
| 地名検索 | Nominatim | 無料・APIキー不要 |

出典: [Firestore の使用量と上限](https://firebase.google.com/docs/firestore/quotas)、
[Firebase の料金プラン](https://firebase.google.com/docs/projects/billing/firebase-pricing-plans)
（内容はライセンス上の制約に配慮して要約しています）

2〜3 人の利用なら、無料枠のごく一部しか使いません。

**0 円を保つコツ**

- **Blaze プランにアップグレードしない**。Spark のままなら上限に達すると
  課金ではなく一時的にエラーになるだけで、請求は発生しません
- Cloud Functions / Cloud Storage / Firebase Hosting は使っていません
  （Functions は Blaze プランが必要なため、意図的に避けた設計です）
- 地図の操作は無料タイルのみ。Google Maps API は使っていません

---

## ファイル構成

```
index.html                     画面の骨組み
styles.css                     見た目
js/config.js                   ★設定（ここだけ書き換える）
js/firebase.js                 Firebase SDK の初期化
js/store.js                    認証・権限・データの読み書き
js/map.js                      地図描画と地名検索
js/gmap.js                     Google マップ URL の解析
js/ui.js                       トースト・モーダルなどの部品
js/admin.js                    管理画面
js/app.js                      画面制御のメイン
firestore.rules                ★権限の実体（Firebase に貼り付ける）
firebase.json                  Firebase CLI 用の設定
.github/workflows/deploy.yml   GitHub Pages への自動公開
```

ビルド工程はありません。npm も Node.js も不要です。

---

## 運用のヒント

**閲覧パスワードを変えたい**
管理画面の「閲覧パスワードを変更」から。現在のパスワードが必要です。
忘れた場合は Firebase コンソールの Authentication → 対象ユーザーの
「パスワードを再設定」から変更できます。

**誰かを完全に追い出したい**
管理画面で「停止」すると、次回ログイン時から入れなくなります。
ログイン自体を消すには、Firebase コンソールの Authentication からも削除してください
（無料プランではアプリ側から他人の Auth アカウントを削除できません）。

**閲覧者が増えてきたら**
閲覧パスワードは共通なので、広まりすぎたら定期的に変更するのが安全です。

---

## 制約・注意点

- 閲覧者は共通パスワードのため、誰が見たかは記録されません（設計上の割り切りです）
- 招待コードは 1 回だけ使えます。使い切ったら新しく発行してください
- 地名検索は OpenStreetMap の Nominatim を使っています。
  連続した大量リクエストは利用規約上避けるべきなので、検索はボタン操作のみにしています
- Google マップの順路リンクは、URL 仕様の上限に合わせて先頭 10 件までです
- `maps.app.goo.gl` の短縮 URL は展開できません（上記「短縮 URL について」を参照）

---

地図データ © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors
