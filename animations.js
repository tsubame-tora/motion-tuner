/**
 * デフォルトプリセット（初回起動時にlocalStorageが空ならここから読み込む）
 *
 * 重要：6種類はすべてapp.jsの共通レンダリングエンジンで処理される「ただのデータ」であり、
 * 種類ごとの分岐処理は一切持たない。keyframesCSSは@keyframesの中身（ボディ）のみを保持する。
 */
const DEFAULT_ANIMATIONS = [
  {
    id: "preset-fade-in",
    name: "フェードイン",
    trigger: "スクロール到達時",
    triggerType: "scroll",
    targetSelector: ".card",
    notes: "下から浮き上がるベーシックなフェードイン。距離を0にすると純粋なフェードになる。",
    keyframesCSS:
      "from { opacity: 0; transform: translateY(var(--distance)); }\n" +
      "to   { opacity: 1; transform: translateY(0); }",
    standardControls: {
      duration: { default: 600, min: 100, max: 2000 },
      delay: { default: 0, min: 0, max: 1000 },
      easing: "ease-out"
    },
    customParams: {
      distance: { label: "距離", default: 24, min: 0, max: 80, unit: "px" }
    },
    loop: { enabled: false, iterationCount: 1 },
    stagger: { enabled: false, interval: { default: 80, min: 20, max: 300 }, itemCount: { default: 5, min: 2, max: 10 } },
    createdAt: "2026-07-06T00:00:00.000Z",
    updatedAt: "2026-07-06T00:00:00.000Z"
  },
  {
    id: "preset-elastic-in",
    name: "エラスティック登場",
    trigger: "ページロード時",
    triggerType: "load",
    targetSelector: ".hero-badge",
    notes: "back風イージングで少し行き過ぎてから収まる登場アニメーション。",
    keyframesCSS:
      "from { opacity: 0; transform: scale(var(--startScale)); }\n" +
      "to   { opacity: 1; transform: scale(1); }",
    standardControls: {
      duration: { default: 700, min: 200, max: 2000 },
      delay: { default: 0, min: 0, max: 1000 },
      easing: "cubic-bezier(0.34, 1.56, 0.64, 1)" /* back風 */
    },
    customParams: {
      startScale: { label: "開始スケール", default: 0.6, min: 0, max: 1, unit: "" }
    },
    loop: { enabled: false, iterationCount: 1 },
    stagger: { enabled: false, interval: { default: 80, min: 20, max: 300 }, itemCount: { default: 5, min: 2, max: 10 } },
    createdAt: "2026-07-06T00:00:00.000Z",
    updatedAt: "2026-07-06T00:00:00.000Z"
  },
  {
    id: "preset-pulse",
    name: "パルス",
    trigger: "常時（注目させたい要素）",
    triggerType: "load",
    targetSelector: ".notification-dot",
    notes: "無限ループがデフォルト。durationは1周期の長さ。",
    keyframesCSS:
      "0%, 100% { transform: scale(1); }\n" +
      "50%      { transform: scale(var(--scaleAmount)); }",
    standardControls: {
      duration: { default: 1200, min: 400, max: 3000 },
      delay: { default: 0, min: 0, max: 1000 },
      easing: "ease-in-out"
    },
    customParams: {
      scaleAmount: { label: "スケール量", default: 1.12, min: 1, max: 1.5, unit: "" }
    },
    loop: { enabled: true, iterationCount: "infinite" },
    stagger: { enabled: false, interval: { default: 80, min: 20, max: 300 }, itemCount: { default: 5, min: 2, max: 10 } },
    createdAt: "2026-07-06T00:00:00.000Z",
    updatedAt: "2026-07-06T00:00:00.000Z"
  },
  {
    id: "preset-shake",
    name: "シェイク",
    trigger: "バリデーションエラー時",
    triggerType: "click",
    targetSelector: ".form-field.error",
    notes: "回数デフォルト3回。振れ幅を大きくしすぎると乱暴な印象になるので注意。",
    keyframesCSS:
      "0%, 100% { transform: translateX(0); }\n" +
      "25%      { transform: translateX(calc(var(--amplitude) * -1)); }\n" +
      "75%      { transform: translateX(var(--amplitude)); }",
    standardControls: {
      duration: { default: 240, min: 100, max: 800 },
      delay: { default: 0, min: 0, max: 1000 },
      easing: "linear"
    },
    customParams: {
      amplitude: { label: "振れ幅", default: 8, min: 0, max: 40, unit: "px" }
    },
    loop: { enabled: true, iterationCount: 3 },
    stagger: { enabled: false, interval: { default: 80, min: 20, max: 300 }, itemCount: { default: 5, min: 2, max: 10 } },
    createdAt: "2026-07-06T00:00:00.000Z",
    updatedAt: "2026-07-06T00:00:00.000Z"
  },
  {
    id: "preset-modal-pop",
    name: "モーダル「ぼわん」",
    trigger: "モーダルを開いた時",
    triggerType: "click",
    targetSelector: ".modal",
    notes: "back風イージングでぼわんと現れる。開始スケールは0.85〜0.95あたりが上品。",
    keyframesCSS:
      "from { opacity: 0; transform: scale(var(--startScale)); }\n" +
      "to   { opacity: 1; transform: scale(1); }",
    standardControls: {
      duration: { default: 420, min: 150, max: 1200 },
      delay: { default: 0, min: 0, max: 500 },
      easing: "cubic-bezier(0.34, 1.56, 0.64, 1)" /* back風 */
    },
    customParams: {
      startScale: { label: "開始スケール", default: 0.9, min: 0.5, max: 1, unit: "" }
    },
    loop: { enabled: false, iterationCount: 1 },
    stagger: { enabled: false, interval: { default: 80, min: 20, max: 300 }, itemCount: { default: 5, min: 2, max: 10 } },
    createdAt: "2026-07-06T00:00:00.000Z",
    updatedAt: "2026-07-06T00:00:00.000Z"
  },
  {
    id: "preset-stagger-fade-in",
    name: "スタッガーフェードイン",
    trigger: "スクロール到達時（リスト要素）",
    triggerType: "scroll",
    targetSelector: ".list-item",
    notes: "フェードインのkeyframesCSSを流用し、スタッガーモードをデフォルトONにしたもの。",
    keyframesCSS:
      "from { opacity: 0; transform: translateY(var(--distance)); }\n" +
      "to   { opacity: 1; transform: translateY(0); }",
    standardControls: {
      duration: { default: 600, min: 100, max: 2000 },
      delay: { default: 0, min: 0, max: 1000 },
      easing: "ease-out"
    },
    customParams: {
      distance: { label: "距離", default: 24, min: 0, max: 80, unit: "px" }
    },
    loop: { enabled: false, iterationCount: 1 },
    stagger: { enabled: true, interval: { default: 80, min: 20, max: 300 }, itemCount: { default: 5, min: 2, max: 10 } },
    createdAt: "2026-07-06T00:00:00.000Z",
    updatedAt: "2026-07-06T00:00:00.000Z"
  }
];
