# Fable 5 依頼文：マイクロアニメーション チューニング＆ストックアプリ「motion-tuner」

## 目的

Claudeとの会話で作ったマイクロアニメーションのキーフレームCSSを貼り付けるだけで、
パラメータ調整・プレビュー・ストック・クライアント共有・実装用エクスポートまでできる
個人用Webアプリを作る。ビルド不要な静的HTML/CSS/JSで完結させ、GitHub Pages（サブドメイン
`motion.tsubame-tora.jp`）でホスティングする。

## 前提

- ビルドツール（npm等）は使わない。素のHTML/CSS/JSのみ
- バックエンド・データベースは使わない。永続化はブラウザのlocalStorageのみ
- リポジトリ名は `motion-tuner`

## ディレクトリ構成

```
motion-tuner/
├── index.html      … ライブラリ一覧＋新規追加＋チューニング画面（自分用）
├── share.html      … 個別共有ビュー（URLパラメータから復元、読み取り専用）
├── style.css
├── app.js          … ライブラリ管理・貼り付けパーサー・チューニングロジック
├── animations.js   … デフォルトで最初から入っている6種類のプリセットデータ
└── CNAME           … 中身は `motion.tsubame-tora.jp` の1行のみ
```

## データモデル

localStorageに配列で保存する、1エントリの形：

```js
{
  id: "uuid",
  name: "商品カードのフェードイン",
  trigger: "スクロール到達時",       // 自由記述
  targetSelector: ".product-card",   // 自由記述
  notes: "",
  keyframesCSS: "0% { opacity: 0; transform: translateY(var(--distance)); } 100% { opacity: 1; transform: translateY(0); }",
  standardControls: {
    duration: { default: 600, min: 100, max: 2000 },
    delay: { default: 0, min: 0, max: 1000 },
    easing: "ease-out"   // プリセット名 or "cubic-bezier(x1,y1,x2,y2)"
  },
  customParams: {
    distance: { label: "距離", default: 24, min: 0, max: 80, unit: "px" }
  },
  loop: { enabled: false, iterationCount: 1 },   // パルス/シェイクなど無限ループ系で使う
  stagger: { enabled: false, interval: { default: 80, min: 20, max: 300 }, itemCount: { default: 5, min: 2, max: 10 } },
  createdAt, updatedAt
}
```

**重要：6種類を特別扱いしない。** フェードイン/エラスティック登場/パルス/シェイク/モーダル「ぼわん」/スタッガーフェードインは、
すべて上記と同じデータ構造で表現し、`animations.js`に初期データとして登録するだけにする。
専用のprevie生成関数やCSS生成関数を種類ごとに分岐で書かない。共通のレンダリングエンジン1つで全種類を処理する。

**スタッガーは「種類」ではなく「モード」。** どのアニメーションでも`stagger.enabled`をONにすると、
プレビューが`itemCount`個複製され、各要素に`index × interval`の`animation-delay`が加算される。

## 貼り付けパーサー（重要機能）

「新規追加」画面のテキストエリアに以下いずれかを貼り付けられるようにする：

**パターンA：JSONメタ情報つき**
```css
/*
{
  "name": "商品カードのフェードイン",
  "trigger": "スクロール到達時",
  "target": ".product-card",
  "duration": { "default": 600, "min": 200, "max": 1500 },
  "delay": { "default": 0, "min": 0, "max": 500 },
  "easing": "ease-out",
  "params": {
    "distance": { "label": "距離", "default": 24, "min": 0, "max": 80, "unit": "px" }
  }
}
*/
@keyframes fadeIn {
  from { opacity: 0; transform: translateY(var(--distance)); }
  to   { opacity: 1; transform: translateY(0); }
}
```
→ コメント内のJSONをパースし、全フィールドを自動入力した状態でチューニング画面に遷移する。

**パターンB：素のCSS（JSONコメントなし）**
`@keyframes` ブロックのみ、または中身だけが貼られた場合は、`var(--xxx)`を正規表現で検出し、
検出した変数名をそのまま`label`の初期値としてcustomParamsに追加する（min/max/defaultは
妥当な仮値：単位が`px`なら0〜100、`deg`なら0〜360、単位なしなら0〜2、など）。
name/trigger/targetSelector/duration/delay/easingは空欄または汎用デフォルト値にし、
ユーザーが手動で埋められるようにする。

パース失敗時（`@keyframes`が見つからない等）は、エラー内容を分かりやすく表示し、
どこが読み取れなかったかを示す。

## 「Claude用の指示文をコピー」ボタン

「新規追加」画面に配置。押すと、以下のテキストをクリップボードにコピーする
（この文言は固定でOK、変数展開不要）：

```
以下の形式でマイクロアニメーションのキーフレームCSSを書いてください。

/*
{
  "name": "(分かりやすい名前)",
  "trigger": "(発火条件。例:スクロール到達時/クリック時/ページロード時)",
  "target": "(対象要素のセレクタ例。例:.card)",
  "duration": { "default": (ms), "min": (ms), "max": (ms) },
  "delay": { "default": (ms), "min": 0, "max": (ms) },
  "easing": "(linear/ease/ease-in/ease-out/ease-in-out/cubic-bezier(x1,y1,x2,y2)のいずれか)",
  "params": {
    "(変数名。例:distance)": { "label": "(日本語ラベル)", "default": (値), "min": (値), "max": (値), "unit": "(px/deg/など。なければ省略)" }
  }
}
*/
@keyframes (任意の名前) {
  (キーフレーム本体。調整可能にしたい値は必ずvar(--変数名)を使うこと)
}

要望: [ここに実現したい動きを説明する]
```

## チューニング画面のUI要件

- duration / delay は常設スライダー（ms単位、数値も表示）
- easing はプリセットのドロップダウン（linear / ease / ease-in / ease-out / ease-in-out / back風 / バウンス風 / カスタム）
  - カスタム選択時は4つの数値入力（x1,y1,x2,y2）が出る
  - **選んだイージングのカーブをSVGでリアルタイム描画するグラフを表示する**（cubic-bezier.comのような見た目。y軸はback/バウンス風のため-0.7〜1.7程度の範囲を許容すること）
- customParamsは動的にスライダー/数値入力を生成（単位があれば表示）
- loop.enabledがtrueの場合、無限ループ再生 or iterationCount回再生をトグルできる
- stagger.enabledをONにすると、プレビューエリアに複数要素が並び、ずらしdelayを確認できる
- 「リプレイ」ボタンで手動再生できる（アニメーションクラスの付け外しで実現）
- 変更は自動保存、または明示的な「保存」ボタン（どちらでも可、実装しやすい方でよい）

## 共有機能

- ライブラリ一覧の各エントリに「共有リンクを作成」ボタン
- そのエントリのデータをJSON化→Base64エンコードし、`share.html?data=(エンコード文字列)` の形でURLを生成、クリップボードにコピー
- `share.html`は、URLパラメータをデコードしてそのアニメーション**1つだけ**をシンプルに表示する読み取り専用ページ
  （編集UI・ライブラリ一覧・他のナビゲーションは一切出さない。プレビューと名前くらいのミニマルな見た目）
- URLが長くなりすぎる場合（`keyframesCSS`が長大など）の配慮として、5000文字を超える場合は警告を出す

## エクスポート機能（3種類、チューニング画面から呼び出す）

1. **Obsidian仕様書Markdown**：トリガー条件／duration／easing／対象要素／customParamsの一覧／備考、を整形して出力
2. **CSSドキュメント**：`:root`にカスタムプロパティとして現在の値を書き出し、その値を使う`@keyframes`と実装例クラスをセットで出力（人間のコーダーがそのままコピペで使える形）
3. **Cursor実装ブリーフ**：「以下のマイクロアニメーションを実装してください」から始まり、トリガー条件・対象セレクタ・CSS（解決済みの実値入り）・備考をまとめたテキスト。前回の`fable5-task-brief.md`と同様、Cursorのチャットにそのまま貼れる完成された文章にする

いずれも「コピー」ボタンでクリップボードにコピーできること。

## デザイン方向性

- 暗めの精密機器のようなトーン。背景は黒に近い藍寄りの色、テキストは生成り系の白
- アクセントカラーはインディゴ寄りのスレートブルー（暖色のオレンジ系アクセントは使わない）
- 数値表示は等幅フォント、ラベルは日本語対応のゴシック体
- ベジェ曲線グラフを画面内で唯一の華やかな要素にし、それ以外は抑えたトーンにする
- レスポンシブ対応（スマホでも一覧とチューニングが崩れないこと）

## 初期データ（animations.js）

以下6つを、上記のデータモデル形式で最初から`animations.js`に用意し、初回起動時にlocalStorageが
空であればここから読み込む：

1. フェードイン（duration/delay/easing/距離）
2. エラスティック登場（duration/delay/easing/開始スケール、easingは"back風"がデフォルト）
3. パルス（周期duration/スケール量/無限ループデフォルトON）
4. シェイク（周期duration/振れ幅px/回数デフォルト3）
5. モーダル「ぼわん」（duration/delay/easing"back風"/開始スケール）
6. スタッガーフェードイン（フェードインのkeyframesCSSを流用し、`stagger.enabled: true`をデフォルトにしたもの）

## デプロイ手順（実行はしない。手順書として`README.md`に書くのみ）

Fable5自身がGitHubへのpush・Pages設定・DNS変更などのアカウント操作を行うことは想定しない。
以下を`README.md`に手順として明記すること：

1. GitHubに`motion-tuner`という新規リポジトリを作成し、このディレクトリの中身をpushする
2. リポジトリの Settings → Pages で GitHub Pages を有効化する
3. ドメイン管理画面（お名前.com等）で `motion` サブドメインのCNAMEレコードをGitHub Pages側に向ける
4. 反映まで数分〜数時間待ち、`https://motion.tsubame-tora.jp` にアクセスして動作確認する

## 受け入れ基準

- ローカルでindex.htmlを開いた状態で、パターンA・パターンBどちらの貼り付けも正しく動作する
- 初回起動時、6つの初期データがライブラリに表示される
- チューニング画面でスライダーを動かすとプレビューとベジェ曲線グラフがリアルタイムに更新される
- 「共有リンクを作成」で生成したURLを別タブで開くと、そのアニメーション単体が正しく再現される
- 3種類のエクスポートがいずれも正しい内容でコピーできる
- README.mdにデプロイ手順が記載されている

## 制約

- ビルドツール・外部フレームワーク不使用（vanilla HTML/CSS/JSのみ、CDN経由のフォント読み込みは可）
- サーバー・データベース不使用
- 6種類のアニメーションを特別扱いするハードコードされた分岐処理を書かない（共通エンジンで処理する）
