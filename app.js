"use strict";

/* ============================================================
   motion-tuner app.js
   - index.html（ライブラリ / 新規追加 / チューニング）
   - share.html（読み取り専用の共有ビュー）
   の両方から読み込まれる。ページはDOMの有無で判定する。

   設計方針：アニメーションの種類ごとの分岐は書かない。
   すべてのエントリは同一のデータ構造で表現され、
   共通のレンダリングエンジン（renderPreview）1つで処理される。
   ============================================================ */

/* ---------- 小物ユーティリティ ---------- */

const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

function uuid() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function escapeHtml(str) {
  return String(str == null ? "" : str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

let toastTimer = null;
function toast(message, isWarn) {
  const el = $("#toast");
  if (!el) { alert(message); return; }
  el.textContent = message;
  el.classList.toggle("warn", !!isWarn);
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    // file:// などでClipboard APIが使えない場合のフォールバック
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch (_) { ok = false; }
    ta.remove();
    return ok;
  }
}

/* Base64URL（Unicode対応） */
function encodeData(obj) {
  const json = JSON.stringify(obj);
  const bytes = new TextEncoder().encode(json);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeData(str) {
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return JSON.parse(new TextDecoder().decode(bytes));
}

/* ---------- イージング ---------- */

const EASING_PRESETS = [
  { key: "linear",      label: "linear",       value: "linear",      bezier: [0, 0, 1, 1] },
  { key: "ease",        label: "ease",         value: "ease",        bezier: [0.25, 0.1, 0.25, 1] },
  { key: "ease-in",     label: "ease-in",      value: "ease-in",     bezier: [0.42, 0, 1, 1] },
  { key: "ease-out",    label: "ease-out",     value: "ease-out",    bezier: [0, 0, 0.58, 1] },
  { key: "ease-in-out", label: "ease-in-out",  value: "ease-in-out", bezier: [0.42, 0, 0.58, 1] },
  { key: "back",        label: "back風",        value: "cubic-bezier(0.34, 1.56, 0.64, 1)",   bezier: [0.34, 1.56, 0.64, 1] },
  { key: "bounce",      label: "バウンス風",     value: "cubic-bezier(0.68, -0.55, 0.27, 1.55)", bezier: [0.68, -0.55, 0.27, 1.55] }
];

function parseBezierString(str) {
  const m = /cubic-bezier\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)/.exec(str || "");
  if (!m) return null;
  return [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]), parseFloat(m[4])];
}

/** easing文字列（キーワード or cubic-bezier）→ グラフ描画用の制御点 */
function easingToBezier(easing) {
  const preset = EASING_PRESETS.find((p) => p.value === easing || p.key === easing);
  if (preset) return preset.bezier;
  return parseBezierString(easing) || [0.25, 0.1, 0.25, 1];
}

/** easing文字列 → ドロップダウンで選択すべきキー（該当なしは 'custom'） */
function easingToPresetKey(easing) {
  const direct = EASING_PRESETS.find((p) => p.value === easing || p.key === easing);
  if (direct) return direct.key;
  const bez = parseBezierString(easing);
  if (bez) {
    const same = EASING_PRESETS.find((p) => p.bezier.every((v, i) => Math.abs(v - bez[i]) < 0.001));
    if (same) return same.key;
  }
  return "custom";
}

/* ---------- トリガー種別 ---------- */
/*
  triggerTypeはプレビューの発火方法とエクスポートされる発火用JSを決める。
  自由記述のtrigger（申し送りメモ）とは別に持つ。
*/

const TRIGGER_TYPES = [
  { key: "load",   label: "ページロード時" },
  { key: "click",  label: "クリック時" },
  { key: "hover",  label: "ホバー時" },
  { key: "scroll", label: "スクロール到達時" }
];

function triggerTypeLabel(key) {
  const t = TRIGGER_TYPES.find((t) => t.key === key);
  return t ? t.label : "ページロード時";
}

/** 「種別ラベル（自由記述）」の表記。自由記述が空またはラベルと同じ場合は種別のみ */
function describeTrigger(entry) {
  const label = triggerTypeLabel(entry.triggerType);
  const memo = (entry.trigger || "").trim();
  return memo && memo !== label ? `${label}（${memo}）` : label;
}

/** 自由記述のトリガー文からtriggerTypeを推定する（既存データ移行・パターンB用） */
function inferTriggerType(text) {
  const s = String(text || "");
  if (/クリック|タップ|押下|click|tap/i.test(s)) return "click";
  if (/ホバー|マウスオーバー|hover/i.test(s)) return "hover";
  if (/スクロール|scroll|到達|viewport|画面内/i.test(s)) return "scroll";
  return "load";
}

/* ---------- 共通レンダリングエンジン ---------- */
/*
  1エントリ＝「keyframesCSS（@keyframesのボディ）＋パラメータ群」。
  スタッガーは種類ではなくモード：enabledならプレビュー要素をitemCount個複製し、
  index × interval のanimation-delayを加算するだけ。それ以外の処理は全種類共通。
  トリガー種別（load/click/hover/scroll）に応じて、プレビューの発火方法を切り替える。
*/

function paramValueWithUnit(param) {
  return `${param.default}${param.unit || ""}`;
}

function iterationCountCSS(entry) {
  if (!entry.loop || !entry.loop.enabled) return "1";
  return entry.loop.iterationCount === "infinite" ? "infinite" : String(entry.loop.iterationCount || 1);
}

function ensurePreviewStyle(stage) {
  let styleEl = document.getElementById("mt-preview-style");
  if (!styleEl) {
    styleEl = document.createElement("style");
    styleEl.id = "mt-preview-style";
    document.head.appendChild(styleEl);
  }
  return styleEl;
}

/** 各ボックスに割り当てるanimationショートハンドをdatasetに持たせて生成する */
function buildPreviewBoxes(entry, container) {
  const staggerOn = entry.stagger && entry.stagger.enabled;
  const count = staggerOn ? (entry.stagger.itemCount.default || 1) : 1;
  const interval = staggerOn ? (entry.stagger.interval.default || 0) : 0;
  const duration = entry.standardControls.duration.default;
  const delay = entry.standardControls.delay.default;
  const easing = entry.standardControls.easing;
  const iters = iterationCountCSS(entry);

  for (let i = 0; i < count; i++) {
    const box = document.createElement("div");
    box.className = "preview-box" + (count > 1 ? " small" : "");
    box.textContent = count > 1 ? String(i + 1) : "target";
    box.dataset.anim = `mt-preview ${duration}ms ${easing} ${delay + i * interval}ms ${iters} both`;
    container.appendChild(box);
  }
}

function playStage(stage) {
  $$(".preview-box", stage).forEach((box) => {
    box.style.animation = "none";
    void box.offsetWidth; // reflowでアニメーションをリスタートさせる
    box.style.animation = box.dataset.anim;
  });
  stage.dataset.playing = "1";
}

function stopStage(stage) {
  $$(".preview-box", stage).forEach((box) => { box.style.animation = "none"; });
  stage.dataset.playing = "";
}

const TRIGGER_HINTS = {
  click: "プレビューをクリックすると再生",
  hover: "プレビューにホバーすると再生",
  scroll: "下にスクロールすると要素の出現時に再生"
};

function renderPreview(entry, stage) {
  if (!stage) return;
  const styleEl = ensurePreviewStyle(stage);
  styleEl.textContent = `@keyframes mt-preview {\n${entry.keyframesCSS}\n}`;

  // カスタムパラメータをCSSカスタムプロパティとして注入
  stage.removeAttribute("style");
  Object.entries(entry.customParams || {}).forEach(([name, param]) => {
    stage.style.setProperty(`--${name}`, paramValueWithUnit(param));
  });

  const trig = entry.triggerType || "load";
  // スクロール到達時：シミュレーションは要素が画面外から始まるため調整に不向き。
  // チューニング中は常時表示（調整モード）をデフォルトにし、scrollSim="1"のときだけ再現する
  const scrollSim = trig === "scroll" && stage.dataset.scrollSim === "1";
  stage.innerHTML = "";
  stage.dataset.playing = "";
  stage.classList.toggle("scroll-mode", scrollSim);
  stage.classList.toggle("click-mode", trig === "click");

  // 前回のトリガー用リスナー/オブザーバを破棄（onXXX代入は上書き、observerは明示的に切断）
  if (stage._observer) { stage._observer.disconnect(); stage._observer = null; }
  stage.onclick = null;
  stage.onmouseenter = null;
  stage.onmouseleave = null;

  // スクロールシミュレーション切替ボタン（チューニング画面にのみ存在）
  const simBtn = document.getElementById("scroll-sim-btn");
  if (simBtn) {
    simBtn.hidden = trig !== "scroll";
    simBtn.textContent = scrollSim ? "調整モードに戻す" : "スクロール発火を試す";
  }

  const hintText = trig === "scroll" && !scrollSim
    ? "実際はスクロール到達時に発火（いまは調整用に常時表示）"
    : TRIGGER_HINTS[trig];
  if (hintText) {
    const hint = document.createElement("div");
    hint.className = "trigger-hint";
    hint.textContent = hintText;
    stage.appendChild(hint);
  }

  if (scrollSim) {
    // 実装と同じ「viewportに入ったら発火」をスクロール領域で再現する
    const spacer = document.createElement("div");
    spacer.className = "scroll-spacer";
    stage.appendChild(spacer);

    const row = document.createElement("div");
    row.className = "scroll-target-row";
    buildPreviewBoxes(entry, row);
    stage.appendChild(row);

    const tail = document.createElement("div");
    tail.className = "scroll-tail";
    stage.appendChild(tail);

    stage.scrollTop = 0;
    stage._observer = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          if (stage.dataset.playing !== "1") playStage(stage);
        } else {
          stopStage(stage); // 画面外に出たらリセットして再スクロールで再発火できるようにする
        }
      });
    }, { root: stage, threshold: 0.4 });
    stage._observer.observe(row);
    return;
  }

  buildPreviewBoxes(entry, stage);

  if (trig === "load" || trig === "scroll") {
    // 調整モードのスクロールトリガーは、変更が即見えるようロード時と同じく即再生する
    playStage(stage);
  } else if (trig === "click") {
    stage.onclick = () => playStage(stage);
  } else if (trig === "hover") {
    stage.onmouseenter = () => playStage(stage);
    stage.onmouseleave = () => stopStage(stage);
  }
}

/** リプレイボタン用：トリガー種別に関わらず手動で再生する */
function replayPreview(stage) {
  // スクロール到達モードでは、対象が画面外のまま再生しても見えないため、
  // まず対象行をスクロールインさせる（表示された時点でIntersectionObserverが発火する）
  const row = stage.classList.contains("scroll-mode") ? $(".scroll-target-row", stage) : null;
  if (row) {
    stopStage(stage);
    const stageRect = stage.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    const visible = rowRect.top < stageRect.bottom - rowRect.height * 0.4 &&
                    rowRect.bottom > stageRect.top + rowRect.height * 0.4;
    if (visible) {
      playStage(stage);
    } else {
      const targetTop = stage.scrollTop + (rowRect.top - stageRect.top) - (stage.clientHeight - rowRect.height) / 2;
      stage.scrollTo({ top: targetTop, behavior: "smooth" });
    }
    return;
  }
  playStage(stage);
}

/* ---------- ストレージ ---------- */

const STORAGE_KEY = "motion-tuner:library";
let library = [];

function loadLibrary() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch (_) { saved = null; }
  if (Array.isArray(saved) && saved.length > 0) {
    library = saved;
  } else {
    // 初回起動：プリセット6種を初期データとして読み込む
    library = JSON.parse(JSON.stringify(DEFAULT_ANIMATIONS));
    saveLibrary();
  }
  // 旧データの移行：triggerTypeがないエントリは自由記述から推定して付与する
  let migrated = false;
  library.forEach((e) => {
    if (!e.triggerType) {
      e.triggerType = inferTriggerType(e.trigger);
      migrated = true;
    }
    syncGeneratedKeyframes(e);
  });
  if (migrated) saveLibrary();
}

function saveLibrary() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(library));
}

function findEntry(id) {
  return library.find((e) => e.id === id) || null;
}

/* ---------- プロトタイプ（複合アニメーションHTML）のストレージ ---------- */

const PROTO_STORAGE_KEY = "motion-tuner:prototypes";
let prototypes = [];

function loadPrototypes() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(PROTO_STORAGE_KEY)); } catch (_) { saved = null; }
  if (Array.isArray(saved) && saved.length > 0) {
    prototypes = saved;
  } else {
    prototypes = JSON.parse(JSON.stringify(typeof DEFAULT_PROTOTYPES !== "undefined" ? DEFAULT_PROTOTYPES : []));
    savePrototypes();
  }
}

function savePrototypes() {
  localStorage.setItem(PROTO_STORAGE_KEY, JSON.stringify(prototypes));
}

function findPrototype(id) {
  return prototypes.find((p) => p.id === id) || null;
}

/* ---------- 数式ジェネレーター ---------- */
/*
  generatorを持つエントリは、customParams（数式パラメータ）とdurationから
  keyframesCSSを自動生成する。生成後は通常エントリと同じ共通エンジンで処理される。
*/

const GENERATORS = {
  dampedSwing: {
    label: "減衰振動スウィング",
    /** angle = sign × amp × e^(-decay·t) × |sin(freq·t)|（ampはsinの符号で切替） */
    build(entry) {
      const p = entry.customParams;
      const durSec = entry.standardControls.duration.default / 1000;
      const steps = 50;
      const lines = [];
      for (let i = 0; i <= steps; i++) {
        const t = (i / steps) * durSec;
        const raw = Math.exp(-p.decay.default * t) * Math.sin(p.freq.default * t);
        const amp = raw > 0 ? p.ampLeft.default : p.ampRight.default;
        const angle = -(amp * Math.abs(raw)); // 初動は左（マイナス）方向
        const pct = Math.round((i / steps) * 1000) / 10;
        // transform-originは0%と100%に同値で入れて全区間で一定に保つ
        const origin = (i === 0 || i === steps) ? " transform-origin: bottom center;" : "";
        lines.push(`${pct}% { transform: rotate(${angle.toFixed(2)}deg);${origin} }`);
      }
      return lines.join("\n");
    }
  }
};

/** generator付きエントリのkeyframesCSSをパラメータから再生成する */
function syncGeneratedKeyframes(entry) {
  if (entry && entry.generator && GENERATORS[entry.generator.type]) {
    entry.keyframesCSS = GENERATORS[entry.generator.type].build(entry);
  }
}

function makeSwingEntry() {
  const now = new Date().toISOString();
  const entry = {
    id: uuid(),
    name: "減衰振動スウィング",
    trigger: "カード着地後（切替完了時）などの揺れ演出",
    triggerType: "click",
    targetSelector: ".card-tag",
    notes: "電車が止まる感じの左右非対称な減衰振動。対象要素に transform-origin: bottom center（タグは top center）を指定すること。数式パラメータからkeyframesを自動生成している。",
    generator: { type: "dampedSwing" },
    keyframesCSS: "",
    standardControls: {
      duration: { default: 1500, min: 300, max: 4000 },
      delay: { default: 0, min: 0, max: 1000 },
      easing: "linear" /* 揺れのカーブはkeyframes側で表現するためlinear固定が基本 */
    },
    customParams: {
      ampLeft:  { label: "振れ幅（初動）", default: 17,  min: 0,   max: 45, unit: "deg" },
      ampRight: { label: "振れ幅（戻り）", default: 18,  min: 0,   max: 45, unit: "deg" },
      decay:    { label: "減衰速度",       default: 3.4, min: 0.5, max: 8,  unit: "" },
      freq:     { label: "振動周波数",     default: 6.6, min: 1,   max: 15, unit: "" }
    },
    loop: { enabled: false, iterationCount: 1 },
    stagger: { enabled: false, interval: { default: 80, min: 20, max: 300 }, itemCount: { default: 5, min: 2, max: 10 } },
    createdAt: now,
    updatedAt: now
  };
  syncGeneratedKeyframes(entry);
  return entry;
}

/* ---------- 貼り付けパーサー ---------- */

/** @keyframesの後の { ... } を波かっこの対応を数えて取り出す */
function extractBraceBlock(text, startIndex) {
  const open = text.indexOf("{", startIndex);
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") {
      depth--;
      if (depth === 0) return { body: text.slice(open + 1, i).trim(), end: i };
    }
  }
  return null; // 閉じかっこ不足
}

function detectVarNames(cssBody) {
  const names = [];
  const re = /var\(\s*--([a-zA-Z0-9_-]+)/g;
  let m;
  while ((m = re.exec(cssBody)) !== null) {
    if (!names.includes(m[1])) names.push(m[1]);
  }
  return names;
}

/** 指定位置のvar()を直接囲んでいる関数名を返す（calc/min/max/clampは透過して外側を見る） */
function enclosingFunctionName(css, varIndex) {
  let i = varIndex;
  while (i > 0) {
    let depth = 0;
    let found = -1;
    for (let j = i - 1; j >= 0; j--) {
      const ch = css[j];
      if (ch === ")") depth++;
      else if (ch === "(") {
        if (depth === 0) { found = j; break; }
        depth--;
      } else if (ch === ";" || ch === "{" || ch === "}") {
        return null;
      }
    }
    if (found === -1) return null;
    const m = /([a-zA-Z-]+)\s*$/.exec(css.slice(0, found));
    const name = m ? m[1].toLowerCase() : null;
    if (name && ["calc", "min", "max", "clamp"].includes(name)) {
      i = found; // 数式関数は透過して、さらに外側の関数を探す
      continue;
    }
    return name;
  }
  return null;
}

const PX_FUNCS = ["translate", "translatex", "translatey", "translatez", "translate3d", "blur", "drop-shadow", "perspective"];
const DEG_FUNCS = ["rotate", "rotatex", "rotatey", "rotatez", "rotate3d", "skew", "skewx", "skewy", "hue-rotate"];
const PX_PROPS = ["top", "left", "right", "bottom", "width", "height", "gap", "margin", "padding", "border-radius", "letter-spacing", "font-size"];

/** パターンB用：変数の単位を推測する（fallback値 → 直接囲む関数 → プロパティ名 → 単位なし） */
function inferUnit(cssBody, varName) {
  const fb = new RegExp(`var\\(\\s*--${varName}\\s*,\\s*[-\\d.]+(px|deg|%|em|rem|vw|vh|ms|s)\\s*\\)`).exec(cssBody);
  if (fb) return fb[1];

  const occurrence = new RegExp(`var\\(\\s*--${varName}[\\s,)]`).exec(cssBody);
  if (occurrence) {
    const fn = enclosingFunctionName(cssBody, occurrence.index);
    if (fn) {
      if (PX_FUNCS.includes(fn)) return "px";
      if (DEG_FUNCS.includes(fn)) return "deg";
      return ""; // scale / opacity など
    }
    // 関数の外で直接使われている場合はプロパティ名から推測する
    const before = cssBody.slice(0, occurrence.index);
    const propMatch = /([a-zA-Z-]+)\s*:\s*[^;{}]*$/.exec(before);
    if (propMatch) {
      const prop = propMatch[1].toLowerCase();
      if (PX_PROPS.some((p) => prop === p || prop.startsWith(p + "-"))) return "px";
    }
  }
  return "";
}

function defaultRangeForUnit(unit) {
  if (unit === "px") return { default: 24, min: 0, max: 100 };
  if (unit === "deg") return { default: 90, min: 0, max: 360 };
  if (unit === "%") return { default: 50, min: 0, max: 100 };
  return { default: 1, min: 0, max: 2 }; // 単位なし（scale/opacityなど）
}

function normalizeRange(obj, fallback) {
  const base = fallback || { default: 0, min: 0, max: 100 };
  const src = (obj && typeof obj === "object") ? obj : {};
  const def = Number.isFinite(+src.default) ? +src.default : base.default;
  const min = Number.isFinite(+src.min) ? +src.min : Math.min(base.min, def);
  const max = Number.isFinite(+src.max) ? +src.max : Math.max(base.max, def);
  return { default: def, min, max };
}

/**
 * 貼り付けテキスト → エントリ（id/日時なし）
 * パターンA：JSONメタ情報コメント ＋ @keyframes
 * パターンB：素の@keyframes、または中身（キーフレームボディ）のみ
 * 失敗時は分かりやすいメッセージのErrorを投げる
 */
function parsePasted(text) {
  const trimmed = (text || "").trim();
  if (!trimmed) throw new Error("入力が空です。キーフレームCSSを貼り付けてください。");

  // 1) JSONメタ情報コメントの抽出（あれば）
  let meta = null;
  let css = trimmed;
  const commentMatch = /\/\*([\s\S]*?)\*\//.exec(trimmed);
  if (commentMatch && commentMatch[1].trim().startsWith("{")) {
    try {
      meta = JSON.parse(commentMatch[1].trim());
    } catch (e) {
      throw new Error(
        "コメント内のJSONメタ情報の解析に失敗しました。\n" +
        `JSONエラー: ${e.message}\n` +
        "→ /* */ コメント内が正しいJSONになっているか確認してください（末尾カンマ・引用符に注意）。"
      );
    }
    css = trimmed.replace(commentMatch[0], "").trim();
  }

  // 2) @keyframesボディの抽出
  let body = null;
  const kfMatch = /@keyframes\s+([\w-]+)/.exec(css);
  if (kfMatch) {
    const block = extractBraceBlock(css, kfMatch.index + kfMatch[0].length);
    if (!block) {
      throw new Error(
        `@keyframes ${kfMatch[1]} の { } の対応が取れませんでした。\n` +
        "→ 閉じかっこ } が不足していないか確認してください。"
      );
    }
    body = block.body;
  } else if (/(from|to|[\d.]+%)\s*[,{\s]/.test(css) && css.includes("{")) {
    // @keyframesの中身だけが貼られたケース
    body = css;
  } else {
    throw new Error(
      "@keyframes ブロックが見つかりませんでした。\n" +
      "読み取れる形式は次の2つです：\n" +
      "  A) /* JSONメタ情報 */ ＋ @keyframes 名前 { ... }\n" +
      "  B) @keyframes 名前 { ... } または 0% { ... } 100% { ... } のような中身のみ\n" +
      "→ 貼り付けた内容にキーフレーム定義が含まれているか確認してください。"
    );
  }

  if (!body.trim()) {
    throw new Error("@keyframes の中身が空です。キーフレーム（from/to や 0%〜100%）を記述してください。");
  }

  // 3) CSS内の var(--xxx) を検出
  const varNames = detectVarNames(body);

  // 4) customParams の組み立て
  const customParams = {};
  varNames.forEach((name) => {
    const metaParam = meta && meta.params && meta.params[name];
    if (metaParam) {
      const range = normalizeRange(metaParam, defaultRangeForUnit(metaParam.unit || ""));
      customParams[name] = {
        label: metaParam.label || name,
        default: range.default,
        min: range.min,
        max: range.max,
        unit: metaParam.unit || ""
      };
    } else {
      // パターンB：変数名をそのままラベルにし、単位から仮のmin/max/defaultを決める
      const unit = inferUnit(body, name);
      const range = defaultRangeForUnit(unit);
      customParams[name] = { label: name, default: range.default, min: range.min, max: range.max, unit };
    }
  });

  // 5) エントリ組み立て
  const metaTriggerType = meta && TRIGGER_TYPES.some((t) => t.key === meta.triggerType)
    ? meta.triggerType
    : inferTriggerType(meta && meta.trigger);

  const entry = {
    name: (meta && meta.name) || "",
    trigger: (meta && meta.trigger) || "",
    triggerType: metaTriggerType,
    targetSelector: (meta && meta.target) || "",
    notes: (meta && meta.notes) || "",
    keyframesCSS: body,
    standardControls: {
      duration: normalizeRange(meta && meta.duration, { default: 600, min: 100, max: 2000 }),
      delay: normalizeRange(meta && meta.delay, { default: 0, min: 0, max: 1000 }),
      easing: (meta && meta.easing) || "ease-out"
    },
    customParams,
    loop: { enabled: false, iterationCount: 1 },
    stagger: {
      enabled: false,
      interval: { default: 80, min: 20, max: 300 },
      itemCount: { default: 5, min: 2, max: 10 }
    }
  };
  return entry;
}

/* ---------- Claude用の指示文 ---------- */

const CLAUDE_PROMPT = `以下の形式でマイクロアニメーションのキーフレームCSSを書いてください。

/*
{
  "name": "(分かりやすい名前)",
  "trigger": "(発火条件の説明。例:スクロール到達時/クリック時/ページロード時)",
  "triggerType": "(load/click/hover/scroll のいずれか)",
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

要望: [ここに実現したい動きを説明する]`;

const CLAUDE_PROTO_PROMPT = `複合的なアニメーション（複数要素・JS制御を含む動き）のプロトタイプを、1ファイルで完結するHTMLとして書いてください。

条件:
- HTML/CSS/JSをすべて1つの.htmlファイルにまとめる（外部ファイル・CDN読み込みなし）
- ファイル先頭に、次の形式のメタ情報コメントを必ず付ける:

<!--
{
  "name": "(分かりやすい名前)",
  "description": "(どんな複合アニメーションかの説明。構成要素・トリガー・タイミングの要点)"
}
-->

- 調整しそうな数値（duration・ずらし時間・振れ幅など）は、scriptの冒頭に定数としてまとめて宣言し、コメントで意味を書く
- 画像は使わず、絵文字・単色背景などのプレースホルダで代替する

要望: [ここに実現したい動きを説明する]`;

/* ---------- プロトタイプの貼り付けパース ---------- */

function parsePrototypePasted(text) {
  const trimmed = (text || "").trim();
  if (!trimmed) throw new Error("入力が空です。1ファイル完結のHTMLを貼り付けてください。");
  if (!/<html[\s>]|<!doctype\s+html/i.test(trimmed)) {
    throw new Error(
      "HTMLドキュメントとして認識できませんでした（<!DOCTYPE html> または <html> が見つかりません）。\n" +
      "→ 部分的なスニペットではなく、1ファイルで完結するHTML全体を貼り付けてください。"
    );
  }
  let meta = null;
  const commentMatch = /<!--([\s\S]*?)-->/.exec(trimmed);
  if (commentMatch && commentMatch[1].trim().startsWith("{")) {
    try { meta = JSON.parse(commentMatch[1].trim()); } catch (_) { meta = null; /* メタは任意なので失敗しても続行 */ }
  }
  return {
    name: (meta && meta.name) || "",
    description: (meta && meta.description) || "",
    html: trimmed
  };
}

/** プロトタイプ用のCursor実装ブリーフ（HTML一式をリファレンスとして添付） */
function exportPrototypeBrief(proto) {
  const children = library.filter((e) => e.prototypeId === proto.id);
  const lines = [];
  lines.push("以下の複合アニメーションのプロトタイプを、本番実装に組み込んでください。");
  lines.push("");
  lines.push(`## ${proto.name || "（無題の複合アニメーション）"}`);
  lines.push("");
  lines.push(proto.description || "（説明なし）");
  lines.push("");
  if (children.length > 0) {
    lines.push("## 関連する調整済みアニメーション（motion-tunerでチューニング済み）");
    lines.push("");
    children.forEach((c) => {
      const sc = c.standardControls;
      lines.push(`- ${c.name}: duration ${sc.duration.default}ms / easing \`${sc.easing}\` / トリガー ${describeTrigger(c)}`);
    });
    lines.push("");
    lines.push("※ 上記の個別アニメーションの最新値は、それぞれのCursor実装ブリーフを参照。");
    lines.push("");
  }
  lines.push("## リファレンス実装（動作確認済みのプロトタイプHTML一式）");
  lines.push("");
  lines.push("このHTMLをブラウザで開くと完成形の動きが確認できます。構造・タイミング・数値はここから読み取ってください。");
  lines.push("");
  lines.push("```html");
  lines.push(proto.html);
  lines.push("```");
  lines.push("");
  lines.push("実装時の注意：");
  lines.push("- script冒頭の定数（duration等）が調整ポイントです");
  lines.push("- データ（記事等）はプレースホルダなので、本番のデータソースに差し替えてください");
  return lines.join("\n");
}

/* ---------- エクスポート ---------- */

/** エントリ名からCSSで使える識別子を作る（日本語名などは motion-xxxx にフォールバック） */
function cssIdent(entry) {
  const ascii = (entry.name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (ascii) return ascii;
  const idPart = String(entry.id || "x").toLowerCase().replace(/[^a-z0-9-]+/g, "").replace(/^-+|-+$/g, "");
  return `motion-${idPart.slice(0, 24) || "anim"}`;
}

/** keyframesCSS内の var(--x) / var(--x, fallback) を現在値で置換する */
function resolveVars(body, entry) {
  return body.replace(/var\(\s*--([a-zA-Z0-9_-]+)\s*(?:,[^)]*)?\)/g, (whole, name) => {
    const param = (entry.customParams || {})[name];
    return param ? paramValueWithUnit(param) : whole;
  });
}

function indent(text, spaces) {
  const pad = " ".repeat(spaces);
  return text.split("\n").map((l) => (l.trim() ? pad + l : l)).join("\n");
}

function describeLoop(entry) {
  if (!entry.loop || !entry.loop.enabled) return "なし（1回再生）";
  return entry.loop.iterationCount === "infinite"
    ? "無限ループ"
    : `${entry.loop.iterationCount}回再生`;
}

function describeStagger(entry) {
  if (!entry.stagger || !entry.stagger.enabled) return "なし";
  return `あり（${entry.stagger.itemCount.default}要素 × ${entry.stagger.interval.default}ms間隔）`;
}

/** トリガー種別に応じた発火用JSスニペットを生成する */
function triggerSnippet(entry, n) {
  const sel = entry.targetSelector || `.${n}`;
  const infinite = iterationCountCSS(entry) === "infinite";
  const trig = entry.triggerType || "load";

  if (trig === "click") {
    return [
      `// クリック時に発火（再クリックでリプレイ）`,
      `document.querySelectorAll("${sel}").forEach((el) => {`,
      `  el.addEventListener("click", () => {`,
      `    el.classList.remove("${n}");`,
      `    void el.offsetWidth; // reflowでアニメーションをリスタート`,
      `    el.classList.add("${n}");`,
      `  });`,
      `});`
    ].join("\n");
  }
  if (trig === "hover") {
    const lines = [
      `// ホバー時に発火`,
      `document.querySelectorAll("${sel}").forEach((el) => {`,
      `  el.addEventListener("mouseenter", () => {`,
      `    el.classList.remove("${n}");`,
      `    void el.offsetWidth; // reflowでアニメーションをリスタート`,
      `    el.classList.add("${n}");`,
      `  });`
    ];
    if (infinite) {
      lines.push(`  // 無限ループ系はホバー解除で停止する`);
      lines.push(`  el.addEventListener("mouseleave", () => el.classList.remove("${n}"));`);
    }
    lines.push(`});`);
    return lines.join("\n");
  }
  if (trig === "scroll") {
    return [
      `// スクロール到達時に発火（一度だけ）`,
      `// 登場系の場合は、発火前の要素に opacity: 0 などの初期状態を当てておくこと`,
      `const observer = new IntersectionObserver((entries) => {`,
      `  entries.forEach((e) => {`,
      `    if (e.isIntersecting) {`,
      `      e.target.classList.add("${n}");`,
      `      observer.unobserve(e.target);`,
      `    }`,
      `  });`,
      `}, { threshold: 0.2 });`,
      `document.querySelectorAll("${sel}").forEach((el) => observer.observe(el));`
    ].join("\n");
  }
  // load
  return [
    `// ページロード時に発火`,
    `document.addEventListener("DOMContentLoaded", () => {`,
    `  document.querySelectorAll("${sel}").forEach((el) => el.classList.add("${n}"));`,
    `});`
  ].join("\n");
}

function exportObsidian(entry) {
  const sc = entry.standardControls;
  const lines = [];
  lines.push(`# ${entry.name || "（無題のアニメーション）"}`);
  lines.push("");
  lines.push(`- トリガー種別: ${triggerTypeLabel(entry.triggerType)}`);
  lines.push(`- トリガー詳細: ${entry.trigger || "（未設定）"}`);
  lines.push(`- 対象要素: \`${entry.targetSelector || "（未設定）"}\``);
  lines.push(`- duration: ${sc.duration.default}ms`);
  lines.push(`- delay: ${sc.delay.default}ms`);
  lines.push(`- easing: \`${sc.easing}\``);
  lines.push(`- ループ: ${describeLoop(entry)}`);
  lines.push(`- スタッガー: ${describeStagger(entry)}`);
  lines.push("");
  lines.push("## 調整パラメータ");
  lines.push("");
  const params = Object.entries(entry.customParams || {});
  if (params.length === 0) {
    lines.push("（カスタムパラメータなし）");
  } else {
    lines.push("| 変数 | ラベル | 現在値 | 可動域 |");
    lines.push("| --- | --- | --- | --- |");
    params.forEach(([name, p]) => {
      lines.push(`| \`--${name}\` | ${p.label} | ${p.default}${p.unit || ""} | ${p.min}〜${p.max}${p.unit || ""} |`);
    });
  }
  lines.push("");
  lines.push("## keyframes");
  lines.push("");
  lines.push("```css");
  lines.push(`@keyframes ${cssIdent(entry)} {`);
  lines.push(indent(entry.keyframesCSS, 2));
  lines.push("}");
  lines.push("```");
  lines.push("");
  lines.push("## 発火用JS");
  lines.push("");
  lines.push("```js");
  lines.push(triggerSnippet(entry, cssIdent(entry)));
  lines.push("```");
  lines.push("");
  lines.push("## 備考");
  lines.push("");
  lines.push(entry.notes || "（なし）");
  return lines.join("\n");
}

function exportCSSDoc(entry) {
  const n = cssIdent(entry);
  const sc = entry.standardControls;
  const params = Object.entries(entry.customParams || {});
  const lines = [];
  lines.push(`/* ============================================`);
  lines.push(`   ${entry.name || n}`);
  lines.push(`   トリガー: ${describeTrigger(entry)} / 対象: ${entry.targetSelector || "（未設定）"}`);
  lines.push(`   ============================================ */`);
  lines.push("");
  if (entry.generator) {
    lines.push(`/* 生成式（${GENERATORS[entry.generator.type].label}）のパラメータ。値はkeyframesに焼き込み済み：`);
    params.forEach(([name, p]) => {
      lines.push(`   ${p.label}（${name}）= ${paramValueWithUnit(p)}`);
    });
    lines.push(`   変更する場合はmotion-tunerで再調整して書き出し直すこと */`);
  }
  lines.push(":root {");
  lines.push(`  --${n}-duration: ${sc.duration.default}ms;`);
  lines.push(`  --${n}-delay: ${sc.delay.default}ms;`);
  lines.push(`  --${n}-easing: ${sc.easing};`);
  if (!entry.generator) {
    params.forEach(([name, p]) => {
      lines.push(`  --${name}: ${paramValueWithUnit(p)}; /* ${p.label} */`);
    });
  }
  lines.push("}");
  lines.push("");
  lines.push(`@keyframes ${n} {`);
  lines.push(indent(entry.keyframesCSS, 2));
  lines.push("}");
  lines.push("");
  lines.push(`/* 実装例（${entry.targetSelector || "対象要素"} に付与） */`);
  lines.push(`.${n} {`);
  lines.push(`  animation: ${n} var(--${n}-duration) var(--${n}-easing) var(--${n}-delay) ${iterationCountCSS(entry)} both;`);
  lines.push("}");
  if (entry.stagger && entry.stagger.enabled) {
    lines.push("");
    lines.push(`/* スタッガー（${entry.stagger.interval.default}msずつずらす）: 各要素に --stagger-index を振る */`);
    lines.push(`.${n} {`);
    lines.push(`  animation-delay: calc(var(--${n}-delay) + var(--stagger-index, 0) * ${entry.stagger.interval.default}ms);`);
    lines.push("}");
    lines.push(`/* 例: <li class="${n}" style="--stagger-index: 0"> ... <li class="${n}" style="--stagger-index: 4"> */`);
  }
  lines.push("");
  lines.push(`/* ---- 発火用JS（トリガー: ${triggerTypeLabel(entry.triggerType)}）----`);
  lines.push(`   .${n} クラスの付与でアニメーションが始まる前提のスニペット`);
  lines.push("");
  lines.push(triggerSnippet(entry, n));
  lines.push("*/");
  return lines.join("\n");
}

function exportCursorBrief(entry) {
  const n = cssIdent(entry);
  const sc = entry.standardControls;
  const resolved = resolveVars(entry.keyframesCSS, entry);
  const lines = [];
  lines.push("以下のマイクロアニメーションを実装してください。");
  lines.push("");
  lines.push(`## ${entry.name || "（無題のアニメーション）"}`);
  lines.push("");
  lines.push(`- トリガー: ${describeTrigger(entry)}`);
  lines.push(`- 対象セレクタ: \`${entry.targetSelector || "（未設定。実装時に確認すること）"}\``);
  lines.push(`- ループ: ${describeLoop(entry)}`);
  lines.push(`- スタッガー: ${describeStagger(entry)}`);
  lines.push("");
  lines.push("## CSS（チューニング済みの実値。このまま使えます）");
  lines.push("");
  lines.push("```css");
  lines.push(`@keyframes ${n} {`);
  lines.push(indent(resolved, 2));
  lines.push("}");
  lines.push("");
  lines.push(`/* ${entry.targetSelector || `.${n}`} にこのクラスを付与するとアニメーションが始まる */`);
  lines.push(`.${n} {`);
  lines.push(`  animation: ${n} ${sc.duration.default}ms ${sc.easing} ${sc.delay.default}ms ${iterationCountCSS(entry)} both;`);
  lines.push("}");
  if (entry.stagger && entry.stagger.enabled) {
    lines.push("");
    lines.push(`/* リスト要素は上から順に ${entry.stagger.interval.default}ms ずつ animation-delay を加算してください */`);
  }
  lines.push("```");
  lines.push("");
  lines.push(`## 発火用JS（トリガー: ${triggerTypeLabel(entry.triggerType)}）`);
  lines.push("");
  lines.push("```js");
  lines.push(triggerSnippet(entry, n));
  lines.push("```");
  lines.push("");
  lines.push("## 備考");
  lines.push("");
  lines.push(entry.notes || "（なし）");
  return lines.join("\n");
}

/* ---------- 共有リンク ---------- */

function makeShareUrl(entry) {
  const data = encodeData(entry);
  const url = new URL("share.html", location.href);
  url.search = `?data=${data}`;
  return url.toString();
}

/* ---------- ベジェ曲線グラフ ---------- */

const BEZ = {
  width: 320, height: 260,
  padL: 34, padR: 14, padT: 10, padB: 24,
  yMin: -0.7, yMax: 1.7
};

function bezX(x) { return BEZ.padL + x * (BEZ.width - BEZ.padL - BEZ.padR); }
function bezY(y) {
  const h = BEZ.height - BEZ.padT - BEZ.padB;
  return BEZ.padT + ((BEZ.yMax - y) / (BEZ.yMax - BEZ.yMin)) * h;
}

function drawBezierGraph(easing) {
  const svg = $("#bezier-graph");
  if (!svg) return;
  const [x1, y1, x2, y2] = easingToBezier(easing);
  const parts = [];

  // グリッド（0〜1の単位枠を強調、外側は控えめ）。色はCSS側でテーマ変数を参照する
  for (const gy of [-0.5, 0, 0.5, 1, 1.5]) {
    const strong = gy === 0 || gy === 1;
    parts.push(`<line x1="${bezX(0)}" y1="${bezY(gy)}" x2="${bezX(1)}" y2="${bezY(gy)}"
      class="${strong ? "bz-grid-strong" : "bz-grid"}"/>`);
    parts.push(`<text x="${bezX(0) - 6}" y="${bezY(gy) + 3.5}" text-anchor="end" class="bz-label">${gy}</text>`);
  }
  for (const gx of [0, 0.25, 0.5, 0.75, 1]) {
    const strong = gx === 0 || gx === 1;
    parts.push(`<line x1="${bezX(gx)}" y1="${bezY(BEZ.yMin)}" x2="${bezX(gx)}" y2="${bezY(BEZ.yMax)}"
      class="${strong ? "bz-grid-strong" : "bz-grid"}"/>`);
    parts.push(`<text x="${bezX(gx)}" y="${BEZ.height - 8}" text-anchor="middle" class="bz-label">${gx}</text>`);
  }

  // 制御点ハンドル
  parts.push(`<line x1="${bezX(0)}" y1="${bezY(0)}" x2="${bezX(x1)}" y2="${bezY(y1)}" class="bz-handle-1"/>`);
  parts.push(`<line x1="${bezX(1)}" y1="${bezY(1)}" x2="${bezX(x2)}" y2="${bezY(y2)}" class="bz-handle-2"/>`);

  // 曲線本体（CSSのタイミング関数は(0,0)→(1,1)の3次ベジェそのもの）
  parts.push(`<path d="M ${bezX(0)} ${bezY(0)} C ${bezX(x1)} ${bezY(y1)}, ${bezX(x2)} ${bezY(y2)}, ${bezX(1)} ${bezY(1)}"
    class="bz-curve"/>`);

  // 端点と制御点
  parts.push(`<circle cx="${bezX(0)}" cy="${bezY(0)}" r="4" class="bz-endpoint"/>`);
  parts.push(`<circle cx="${bezX(1)}" cy="${bezY(1)}" r="4" class="bz-endpoint"/>`);
  parts.push(`<circle cx="${bezX(x1)}" cy="${bezY(y1)}" r="5" class="bz-point-1"/>`);
  parts.push(`<circle cx="${bezX(x2)}" cy="${bezY(y2)}" r="5" class="bz-point-2"/>`);

  svg.innerHTML = parts.join("");

  const readout = $("#bezier-readout");
  if (readout) {
    const isKeyword = /^(linear|ease|ease-in|ease-out|ease-in-out)$/.test(easing);
    readout.textContent = isKeyword
      ? `${easing}  =  cubic-bezier(${x1}, ${y1}, ${x2}, ${y2})`
      : `cubic-bezier(${x1}, ${y1}, ${x2}, ${y2})`;
  }
}

/* ============================================================
   index.html（メインアプリ）
   ============================================================ */

let currentId = null;
let saveTimer = null;

function markSaved() {
  const el = $("#save-status");
  if (!el) return;
  const t = new Date();
  const hh = String(t.getHours()).padStart(2, "0");
  const mm = String(t.getMinutes()).padStart(2, "0");
  const ss = String(t.getSeconds()).padStart(2, "0");
  el.textContent = `自動保存済み ${hh}:${mm}:${ss}`;
}

function scheduleSave(entry) {
  entry.updatedAt = new Date().toISOString();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveLibrary();
    markSaved();
  }, 250);
}

function showView(name) {
  ["library", "add", "tune"].forEach((v) => {
    const el = $(`#view-${v}`);
    if (el) el.hidden = v !== name;
  });
  $$(".nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.nav === name));
  if (name === "library") renderLibrary();
}

/* ----- テーマ切替 ----- */

const THEME_KEY = "motion-tuner:theme";

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(THEME_KEY, theme);
  $$(".theme-btn").forEach((b) => b.classList.toggle("active", b.dataset.themeChoice === theme));
}

/* ----- ライブラリ一覧 ----- */

function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d)) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** カードごとに一意な@keyframes名（複数カード間の衝突を避ける） */
function cardAnimName(entry) {
  return `mt-card-${String(entry.id).replace(/[^a-zA-Z0-9_-]/g, "")}`;
}

function cardStage(id) {
  return $(`#library-root .lib-card[data-id="${CSS.escape(id)}"] [data-stage]`);
}

/** ミニプレビューの要素を（アニメーションなしの状態で）用意する */
function buildCardBoxes(entry, stage) {
  Object.entries(entry.customParams || {}).forEach(([name, param]) => {
    stage.style.setProperty(`--${name}`, paramValueWithUnit(param));
  });
  const count = (entry.stagger && entry.stagger.enabled) ? (entry.stagger.itemCount.default || 1) : 1;
  stage.innerHTML = "";
  for (let i = 0; i < count; i++) {
    const box = document.createElement("div");
    box.className = "mini-box";
    stage.appendChild(box);
  }
}

function playCard(entry) {
  const stage = cardStage(entry.id);
  if (!stage) return;
  const sc = entry.standardControls;
  const staggerOn = entry.stagger && entry.stagger.enabled;
  const interval = staggerOn ? (entry.stagger.interval.default || 0) : 0;
  const iters = iterationCountCSS(entry);
  $$(".mini-box", stage).forEach((box, i) => {
    box.style.animation = "none";
    void box.offsetWidth;
    box.style.animation = `${cardAnimName(entry)} ${sc.duration.default}ms ${sc.easing} ${sc.delay.default + i * interval}ms ${iters} both`;
  });
  stage.dataset.playing = "1";
}

function stopCard(entry) {
  const stage = cardStage(entry.id);
  if (!stage) return;
  $$(".mini-box", stage).forEach((box) => { box.style.animation = "none"; });
  stage.dataset.playing = "";
}

function animCardHtml(e) {
  const badges = [];
  if (e.generator) badges.push(`<span class="badge badge-gen">生成式</span>`);
  badges.push(`<span class="badge">${triggerTypeLabel(e.triggerType)}</span>`);
  if (e.loop && e.loop.enabled) {
    badges.push(`<span class="badge">${e.loop.iterationCount === "infinite" ? "無限ループ" : `×${e.loop.iterationCount}`}</span>`);
  }
  if (e.stagger && e.stagger.enabled) badges.push(`<span class="badge">スタッガー</span>`);
  const paramCount = Object.keys(e.customParams || {}).length;
  if (paramCount > 0) badges.push(`<span class="badge">params:${paramCount}</span>`);
  return `
    <div class="lib-card${e.prototypeId ? " lib-card-child" : ""}" data-id="${escapeHtml(e.id)}">
      <h3 class="lib-card-name">${escapeHtml(e.name || "（無題のアニメーション）")}</h3>
      <div class="lib-card-preview">
        <div class="mini-stage" data-stage></div>
        <button type="button" class="mini-play" data-action="play" aria-label="プレビューを再生" title="プレビューを再生">▶</button>
      </div>
      <div class="lib-card-badges">${badges.join("")}</div>
      <div class="lib-card-meta">
        <span>トリガー: ${escapeHtml(e.trigger || "未設定")}</span>
        <span class="mono">${escapeHtml(e.targetSelector || "")}</span>
        <span>更新: ${formatDate(e.updatedAt)}</span>
      </div>
      <div class="lib-card-actions">
        <button type="button" class="btn btn-primary btn-small" data-action="tune">チューニング</button>
        <button type="button" class="btn btn-ghost btn-small" data-action="share">共有リンクを作成</button>
        <button type="button" class="btn btn-ghost btn-small btn-danger" data-action="delete">削除</button>
        <span class="move-btns">
          <button type="button" class="btn btn-ghost btn-small btn-move" data-action="move-up" aria-label="上へ移動" title="上へ移動">↑</button>
          <button type="button" class="btn btn-ghost btn-small btn-move" data-action="move-down" aria-label="下へ移動" title="下へ移動">↓</button>
        </span>
      </div>
    </div>`;
}

function protoGroupHtml(proto) {
  const children = library.filter((e) => e.prototypeId === proto.id);
  const childrenHtml = children.length > 0
    ? `<div class="library-grid proto-children">${children.map(animCardHtml).join("")}</div>`
    : `<div class="proto-children-empty">関連アニメーションはまだありません。「関連アニメを追加」から登録するか、チューニング画面で親（複合アニメーション）を設定してください。</div>`;
  return `
    <div class="proto-group${proto.done ? " proto-group-done" : ""}" data-proto-id="${escapeHtml(proto.id)}">
      <div class="proto-card">
        <div class="proto-card-head">
          <span class="proto-badge">複合</span>
          ${proto.done ? `<span class="done-badge">完了</span>` : ""}
          <h3 class="lib-card-name">${escapeHtml(proto.name || "（無題の複合アニメーション）")}</h3>
        </div>
        <p class="proto-desc">${escapeHtml(proto.description || "")}</p>
        <div class="lib-card-meta"><span>更新: ${formatDate(proto.updatedAt)} ／ 関連アニメーション: ${children.length}件</span></div>
        <div class="lib-card-actions">
          <button type="button" class="btn btn-primary btn-small" data-proto-action="preview">プレビュー</button>
          <button type="button" class="btn btn-ghost btn-small" data-proto-action="open">新しいタブで開く</button>
          <button type="button" class="btn btn-ghost btn-small" data-proto-action="brief">Cursorブリーフをコピー</button>
          <button type="button" class="btn btn-ghost btn-small" data-proto-action="copy-html">HTMLをコピー</button>
          <button type="button" class="btn btn-ghost btn-small" data-proto-action="download">ダウンロード</button>
          <button type="button" class="btn btn-ghost btn-small" data-proto-action="add-child">関連アニメを追加</button>
          <button type="button" class="btn btn-ghost btn-small" data-proto-action="edit">編集</button>
          <button type="button" class="btn btn-ghost btn-small" data-proto-action="toggle-done">${proto.done ? "進行中に戻す" : "完了にする"}</button>
          <button type="button" class="btn btn-ghost btn-small btn-danger" data-proto-action="delete">削除</button>
          <span class="move-btns">
            <button type="button" class="btn btn-ghost btn-small btn-move" data-proto-action="move-up" aria-label="上へ移動" title="上へ移動">↑</button>
            <button type="button" class="btn btn-ghost btn-small btn-move" data-proto-action="move-down" aria-label="下へ移動" title="下へ移動">↓</button>
          </span>
        </div>
      </div>
      ${childrenHtml}
    </div>`;
}

/**
 * 並び替え：同じ表示グループ（同ステータスの複合アニメ／同じ親を持つアニメ）の
 * 隣り合う要素と配列内で入れ替える
 */
function moveInArray(arr, id, dir, sameGroup) {
  const groupIdx = arr.map((item, i) => ({ item, i })).filter(({ item }) => sameGroup(item));
  const pos = groupIdx.findIndex(({ item }) => item.id === id);
  const target = pos + dir;
  if (pos < 0 || target < 0 || target >= groupIdx.length) return false;
  const a = groupIdx[pos].i;
  const b = groupIdx[target].i;
  [arr[a], arr[b]] = [arr[b], arr[a]];
  return true;
}

function movePrototype(id, dir) {
  const proto = findPrototype(id);
  if (!proto) return;
  if (moveInArray(prototypes, id, dir, (p) => !!p.done === !!proto.done)) {
    savePrototypes();
    renderLibrary();
  }
}

function moveEntry(id, dir) {
  const entry = findEntry(id);
  if (!entry) return;
  const groupKey = entry.prototypeId && findPrototype(entry.prototypeId) ? entry.prototypeId : "";
  const sameGroup = (e) => ((e.prototypeId && findPrototype(e.prototypeId)) ? e.prototypeId : "") === groupKey;
  if (moveInArray(library, id, dir, sameGroup)) {
    saveLibrary();
    renderLibrary();
  }
}

function renderLibrary() {
  const root = $("#library-root");
  if (!root) return;

  const standalone = library.filter((e) => !e.prototypeId || !findPrototype(e.prototypeId));
  const active = prototypes.filter((p) => !p.done);
  const done = prototypes.filter((p) => p.done);
  const parts = [];

  active.forEach((p) => parts.push(protoGroupHtml(p)));

  parts.push(`<div class="group-label">単体アニメーション</div>`);
  if (standalone.length > 0) {
    parts.push(`<div class="library-grid">${standalone.map(animCardHtml).join("")}</div>`);
  } else {
    parts.push(`<div class="library-empty">単体アニメーションはありません。「新規追加」からキーフレームCSSを貼り付けて登録してください。</div>`);
  }

  // 完了にした複合アニメーションは一番下の折りたたみセクションへ自動で移動する
  if (done.length > 0) {
    parts.push(`
      <details class="done-section">
        <summary class="group-label">完了した複合アニメーション（${done.length}）</summary>
        <div class="done-section-body">${done.map(protoGroupHtml).join("")}</div>
      </details>`);
  }
  root.innerHTML = parts.join("");

  // 全カード分の@keyframesを一意な名前で1つの<style>にまとめて注入する
  let styleEl = document.getElementById("mt-card-styles");
  if (!styleEl) {
    styleEl = document.createElement("style");
    styleEl.id = "mt-card-styles";
    document.head.appendChild(styleEl);
  }
  styleEl.textContent = library
    .map((e) => `@keyframes ${cardAnimName(e)} {\n${e.keyframesCSS}\n}`)
    .join("\n\n");

  library.forEach((e) => {
    const stage = cardStage(e.id);
    if (stage) buildCardBoxes(e, stage);
  });
}

/** プロトタイプ操作 */
let pendingPrototypeId = null; // 「関連アニメを追加」からの遷移時に使う

function openProtoPreview(proto) {
  $("#proto-modal-title").textContent = proto.name || "（無題の複合アニメーション）";
  $("#proto-frame").srcdoc = proto.html;
  $("#proto-modal").hidden = false;
}

function downloadPrototype(proto) {
  const blob = new Blob([proto.html], { type: "text/html" });
  const a = document.createElement("a");
  const slug = (proto.name || "prototype").toLowerCase().replace(/[^a-z0-9一-龠ぁ-んァ-ヶ]+/gi, "-").replace(/^-+|-+$/g, "") || "prototype";
  a.href = URL.createObjectURL(blob);
  a.download = `${slug}.html`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

async function handleProtoAction(btn) {
  const group = btn.closest(".proto-group");
  const proto = findPrototype(group.dataset.protoId);
  if (!proto) return;
  const action = btn.dataset.protoAction;

  if (action === "preview") {
    openProtoPreview(proto);
  } else if (action === "open") {
    const blob = new Blob([proto.html], { type: "text/html" });
    window.open(URL.createObjectURL(blob), "_blank");
  } else if (action === "brief") {
    const ok = await copyText(exportPrototypeBrief(proto));
    toast(ok ? "Cursor実装ブリーフをコピーしました" : "コピーに失敗しました", !ok);
  } else if (action === "copy-html") {
    const ok = await copyText(proto.html);
    toast(ok ? "HTMLをコピーしました" : "コピーに失敗しました", !ok);
  } else if (action === "download") {
    downloadPrototype(proto);
    toast("HTMLをダウンロードしました。共有するにはリポジトリの prototypes/ に置いてデプロイしてください");
  } else if (action === "add-child") {
    pendingPrototypeId = proto.id;
    showView("add");
    switchAddTab("anim");
    toast(`保存すると「${proto.name}」の関連アニメーションとして登録されます`);
  } else if (action === "toggle-done") {
    proto.done = !proto.done;
    savePrototypes();
    renderLibrary();
    toast(proto.done ? `「${proto.name}」を完了にしました（一番下に移動）` : `「${proto.name}」を進行中に戻しました`);
  } else if (action === "move-up") {
    movePrototype(proto.id, -1);
  } else if (action === "move-down") {
    movePrototype(proto.id, 1);
  } else if (action === "edit") {
    showView("add");
    switchAddTab("proto");
    $("#proto-name").value = proto.name || "";
    $("#proto-desc").value = proto.description || "";
    $("#proto-paste-area").value = proto.html;
    protoEditId = proto.id;
    $("#proto-edit-note").hidden = false;
  } else if (action === "delete") {
    if (!confirm(`複合アニメーション「${proto.name}」を削除しますか？\n（関連アニメーションは単体アニメーションに移動します）`)) return;
    prototypes = prototypes.filter((p) => p.id !== proto.id);
    library.forEach((e) => { if (e.prototypeId === proto.id) delete e.prototypeId; });
    savePrototypes();
    saveLibrary();
    renderLibrary();
    toast("削除しました");
  }
}

async function handleLibraryClick(ev) {
  const protoBtn = ev.target.closest("button[data-proto-action]");
  if (protoBtn) { handleProtoAction(protoBtn); return; }

  const btn = ev.target.closest("button[data-action]");
  if (!btn) return;
  const card = btn.closest(".lib-card");
  const entry = findEntry(card.dataset.id);
  if (!entry) return;

  if (btn.dataset.action === "play") {
    // 無限ループ系は▶で再生/停止をトグル、それ以外は毎回リプレイ
    const stage = cardStage(entry.id);
    if (iterationCountCSS(entry) === "infinite" && stage && stage.dataset.playing === "1") {
      stopCard(entry);
    } else {
      playCard(entry);
    }
  } else if (btn.dataset.action === "tune") {
    openTune(entry.id);
  } else if (btn.dataset.action === "share") {
    const url = makeShareUrl(entry);
    const ok = await copyText(url);
    if (url.length > 5000) {
      toast(`共有URLが${url.length}文字と長大です（keyframesCSSが長い可能性）。コピーはしましたが、チャット等で切れないよう注意してください。`, true);
    } else {
      toast(ok ? "共有リンクをコピーしました" : "コピーに失敗しました。手動でコピーしてください。", !ok);
    }
  } else if (btn.dataset.action === "delete") {
    if (!confirm(`「${entry.name || "無題のアニメーション"}」を削除しますか？`)) return;
    library = library.filter((e) => e.id !== entry.id);
    saveLibrary();
    renderLibrary();
    toast("削除しました");
  } else if (btn.dataset.action === "move-up") {
    moveEntry(entry.id, -1);
  } else if (btn.dataset.action === "move-down") {
    moveEntry(entry.id, 1);
  }
}

/* ----- 新規追加 ----- */

let protoEditId = null; // プロトタイプ編集中のID（新規はnull）

function switchAddTab(tab) {
  $$(".add-tab").forEach((b) => b.classList.toggle("active", b.dataset.addTab === tab));
  $("#add-panel-anim").hidden = tab !== "anim";
  $("#add-panel-proto").hidden = tab !== "proto";
  if (tab !== "proto") {
    protoEditId = null;
    $("#proto-edit-note").hidden = true;
  }
}

function handleParse() {
  const errorBox = $("#parse-error");
  errorBox.hidden = true;
  try {
    const parsed = parsePasted($("#paste-area").value);
    const now = new Date().toISOString();
    const entry = Object.assign(parsed, { id: uuid(), createdAt: now, updatedAt: now });
    if (pendingPrototypeId && findPrototype(pendingPrototypeId)) {
      entry.prototypeId = pendingPrototypeId;
    }
    pendingPrototypeId = null;
    library.push(entry);
    saveLibrary();
    $("#paste-area").value = "";
    toast("読み込みました。チューニングを開始します");
    openTune(entry.id);
  } catch (e) {
    errorBox.textContent = e.message;
    errorBox.hidden = false;
  }
}

function handleProtoSave() {
  const errorBox = $("#proto-parse-error");
  errorBox.hidden = true;
  try {
    const parsed = parsePrototypePasted($("#proto-paste-area").value);
    const name = $("#proto-name").value.trim() || parsed.name;
    const description = $("#proto-desc").value.trim() || parsed.description;
    if (!name) throw new Error("名前を入力してください（HTML先頭のメタコメントに \"name\" を含めると自動入力されます）。");
    const now = new Date().toISOString();

    if (protoEditId && findPrototype(protoEditId)) {
      const proto = findPrototype(protoEditId);
      Object.assign(proto, { name, description, html: parsed.html, updatedAt: now });
      toast("複合アニメーションを更新しました");
    } else {
      prototypes.push({ id: uuid(), name, description, html: parsed.html, createdAt: now, updatedAt: now });
      toast("複合アニメーションを保存しました");
    }
    savePrototypes();
    protoEditId = null;
    $("#proto-edit-note").hidden = true;
    $("#proto-name").value = "";
    $("#proto-desc").value = "";
    $("#proto-paste-area").value = "";
    showView("library");
  } catch (e) {
    errorBox.textContent = e.message;
    errorBox.hidden = false;
  }
}

/* ----- チューニング画面 ----- */

function sliderStep(min, max) {
  return (max - min) <= 5 ? 0.01 : 1;
}

function rangeRow(id, label, range, unit) {
  const step = sliderStep(range.min, range.max);
  const unitLabel = unit ? `（${escapeHtml(unit)}）` : "";
  return `
    <div class="ctrl-row">
      <label for="${id}" title="${escapeHtml(label)}">${escapeHtml(label)}${unitLabel}</label>
      <input type="range" id="${id}" min="${range.min}" max="${range.max}" step="${step}" value="${range.default}">
      <input type="number" id="${id}-num" min="${range.min}" max="${range.max}" step="${step}" value="${range.default}" aria-label="${escapeHtml(label)}の数値入力">
    </div>`;
}

function buildControls(entry) {
  const panel = $("#controls");
  const sc = entry.standardControls;
  const presetKey = easingToPresetKey(sc.easing);
  const bez = easingToBezier(sc.easing);

  const paramRows = Object.entries(entry.customParams || {})
    .map(([name, p]) => rangeRow(`param-${name}`, p.label || name, p, p.unit))
    .join("") || `<p class="view-desc">var(--xxx) 形式のカスタムパラメータはありません。</p>`;

  const easingOptions = EASING_PRESETS
    .map((p) => `<option value="${p.key}" ${p.key === presetKey ? "selected" : ""}>${p.label}</option>`)
    .join("") + `<option value="custom" ${presetKey === "custom" ? "selected" : ""}>カスタム</option>`;

  panel.innerHTML = `
    <div class="ctrl-group">
      <div class="ctrl-group-title">基本情報</div>
      <div class="ctrl-row-wide"><label for="f-name">名前</label>
        <input type="text" id="f-name" value="${escapeHtml(entry.name)}" placeholder="例: 商品カードのフェードイン"></div>
    </div>

    <div class="ctrl-section-label">動きの調整</div>

    <div class="ctrl-group">
      <div class="ctrl-group-title">タイミング</div>
      ${rangeRow("f-duration", "duration", sc.duration, "ms")}
      ${rangeRow("f-delay", "delay", sc.delay, "ms")}
    </div>

    <div class="ctrl-group">
      <div class="ctrl-group-title">イージング</div>
      <div class="ctrl-row-wide">
        <select id="f-easing">${easingOptions}</select>
      </div>
      <div class="bezier-inputs" id="bezier-inputs" ${presetKey === "custom" ? "" : "hidden"}>
        <input type="number" id="bz-x1" step="0.01" min="0" max="1" value="${bez[0]}" aria-label="x1">
        <input type="number" id="bz-y1" step="0.01" value="${bez[1]}" aria-label="y1">
        <input type="number" id="bz-x2" step="0.01" min="0" max="1" value="${bez[2]}" aria-label="x2">
        <input type="number" id="bz-y2" step="0.01" value="${bez[3]}" aria-label="y2">
      </div>
    </div>

    <div class="ctrl-group">
      <div class="ctrl-group-title">${entry.generator ? `パラメータ（生成式: ${GENERATORS[entry.generator.type].label}）` : "パラメータ"}</div>
      ${paramRows}
    </div>

    <div class="ctrl-group">
      <div class="ctrl-group-title">ループ</div>
      <div class="check-row">
        <input type="checkbox" id="f-loop" ${entry.loop.enabled ? "checked" : ""}>
        <label for="f-loop">ループ再生する</label>
      </div>
      <div class="check-row" id="loop-detail" ${entry.loop.enabled ? "" : "hidden"}>
        <input type="checkbox" id="f-loop-infinite" ${entry.loop.iterationCount === "infinite" ? "checked" : ""}>
        <label for="f-loop-infinite">無限ループ</label>
        <input type="number" id="f-loop-count" min="1" max="99" step="1" style="width:80px"
          value="${entry.loop.iterationCount === "infinite" ? 3 : entry.loop.iterationCount}"
          ${entry.loop.iterationCount === "infinite" ? "disabled" : ""} aria-label="再生回数">
        <span style="color:var(--muted);font-size:12px">回</span>
      </div>
    </div>

    <div class="ctrl-group">
      <div class="ctrl-group-title">スタッガー</div>
      <div class="check-row">
        <input type="checkbox" id="f-stagger" ${entry.stagger.enabled ? "checked" : ""}>
        <label for="f-stagger">スタッガーモード（要素を複製してずらし再生）</label>
      </div>
      <div id="stagger-detail" ${entry.stagger.enabled ? "" : "hidden"}>
        ${rangeRow("f-stagger-interval", "間隔", entry.stagger.interval, "ms")}
        ${rangeRow("f-stagger-count", "要素数", entry.stagger.itemCount, "")}
      </div>
    </div>

    <div class="ctrl-section-label">実装情報（申し送り）</div>

    <div class="ctrl-group">
      <div class="ctrl-group-title">トリガー</div>
      <div class="ctrl-row-wide"><label for="f-trigger-type">トリガー種別（プレビューの発火方法）</label>
        <select id="f-trigger-type">
          ${TRIGGER_TYPES.map((t) => `<option value="${t.key}" ${t.key === (entry.triggerType || "load") ? "selected" : ""}>${t.label}</option>`).join("")}
        </select></div>
      <div class="ctrl-row-wide"><label for="f-trigger">トリガー詳細（自由記述メモ）</label>
        <input type="text" id="f-trigger" value="${escapeHtml(entry.trigger)}" placeholder="例: 商品一覧のカードが画面に入った時"></div>
    </div>

    <div class="ctrl-group">
      <div class="ctrl-group-title">関連付け・対象</div>
      <div class="ctrl-row-wide"><label for="f-proto">親の複合アニメーション（関連付け）</label>
        <select id="f-proto">
          <option value="">なし（単体アニメーション）</option>
          ${prototypes.map((p) => `<option value="${escapeHtml(p.id)}" ${p.id === entry.prototypeId ? "selected" : ""}>${escapeHtml(p.name)}</option>`).join("")}
        </select></div>
      <div class="ctrl-row-wide"><label for="f-target">対象セレクタ</label>
        <input type="text" id="f-target" value="${escapeHtml(entry.targetSelector)}" placeholder="例: .product-card"></div>
      <div class="ctrl-row-wide"><label for="f-notes">備考</label>
        <textarea id="f-notes" class="ctrl-textarea" rows="2" placeholder="メモ">${escapeHtml(entry.notes)}</textarea></div>
    </div>

    <div class="ctrl-group">
      <div class="ctrl-group-title">keyframes CSS${entry.generator ? "（数式パラメータから自動生成・編集不可）" : ""}</div>
      <textarea id="f-keyframes" class="ctrl-textarea" rows="6" spellcheck="false" ${entry.generator ? "readonly" : ""}>${escapeHtml(entry.keyframesCSS)}</textarea>
    </div>
  `;

  attachControlEvents(entry);
}

function bindRange(id, onValue) {
  const slider = $(`#${id}`);
  const num = $(`#${id}-num`);
  if (!slider || !num) return;
  const apply = (v) => {
    const val = parseFloat(v);
    if (!Number.isFinite(val)) return;
    slider.value = val;
    num.value = val;
    onValue(val);
  };
  slider.addEventListener("input", () => apply(slider.value));
  num.addEventListener("input", () => apply(num.value));
}

function attachControlEvents(entry) {
  const stage = $("#preview-stage");
  const rerender = () => {
    syncGeneratedKeyframes(entry);
    if (entry.generator) $("#f-keyframes").value = entry.keyframesCSS;
    renderPreview(entry, stage);
    scheduleSave(entry);
  };
  const save = () => scheduleSave(entry);

  $("#f-name").addEventListener("input", (e) => { entry.name = e.target.value; save(); });
  $("#f-trigger-type").addEventListener("change", (e) => { entry.triggerType = e.target.value; rerender(); });
  $("#f-trigger").addEventListener("input", (e) => { entry.trigger = e.target.value; save(); });
  $("#f-proto").addEventListener("change", (e) => {
    if (e.target.value) entry.prototypeId = e.target.value;
    else delete entry.prototypeId;
    save();
  });
  $("#f-target").addEventListener("input", (e) => { entry.targetSelector = e.target.value; save(); });
  $("#f-notes").addEventListener("input", (e) => { entry.notes = e.target.value; save(); });

  bindRange("f-duration", (v) => { entry.standardControls.duration.default = v; rerender(); });
  bindRange("f-delay", (v) => { entry.standardControls.delay.default = v; rerender(); });

  Object.keys(entry.customParams || {}).forEach((name) => {
    bindRange(`param-${name}`, (v) => { entry.customParams[name].default = v; rerender(); });
  });

  // イージング
  const easingSelect = $("#f-easing");
  const bezInputs = $("#bezier-inputs");
  const readCustomBezier = () => {
    const x1 = Math.min(1, Math.max(0, parseFloat($("#bz-x1").value) || 0));
    const y1 = parseFloat($("#bz-y1").value) || 0;
    const x2 = Math.min(1, Math.max(0, parseFloat($("#bz-x2").value) || 0));
    const y2 = parseFloat($("#bz-y2").value) || 0;
    return `cubic-bezier(${x1}, ${y1}, ${x2}, ${y2})`;
  };
  const applyEasing = () => {
    const key = easingSelect.value;
    if (key === "custom") {
      bezInputs.hidden = false;
      entry.standardControls.easing = readCustomBezier();
    } else {
      bezInputs.hidden = true;
      const preset = EASING_PRESETS.find((p) => p.key === key);
      entry.standardControls.easing = preset.value;
      // カスタム入力欄にも現在のカーブを反映しておく
      $("#bz-x1").value = preset.bezier[0];
      $("#bz-y1").value = preset.bezier[1];
      $("#bz-x2").value = preset.bezier[2];
      $("#bz-y2").value = preset.bezier[3];
    }
    drawBezierGraph(entry.standardControls.easing);
    rerender();
  };
  easingSelect.addEventListener("change", applyEasing);
  ["bz-x1", "bz-y1", "bz-x2", "bz-y2"].forEach((id) => {
    $(`#${id}`).addEventListener("input", () => {
      if (easingSelect.value !== "custom") return;
      entry.standardControls.easing = readCustomBezier();
      drawBezierGraph(entry.standardControls.easing);
      rerender();
    });
  });

  // ループ
  const loopCheck = $("#f-loop");
  const loopDetail = $("#loop-detail");
  const loopInfinite = $("#f-loop-infinite");
  const loopCount = $("#f-loop-count");
  const applyLoop = () => {
    entry.loop.enabled = loopCheck.checked;
    loopDetail.hidden = !loopCheck.checked;
    loopCount.disabled = loopInfinite.checked;
    entry.loop.iterationCount = loopInfinite.checked
      ? "infinite"
      : Math.max(1, parseInt(loopCount.value, 10) || 1);
    rerender();
  };
  loopCheck.addEventListener("change", applyLoop);
  loopInfinite.addEventListener("change", applyLoop);
  loopCount.addEventListener("input", applyLoop);

  // スタッガー
  const staggerCheck = $("#f-stagger");
  const staggerDetail = $("#stagger-detail");
  staggerCheck.addEventListener("change", () => {
    entry.stagger.enabled = staggerCheck.checked;
    staggerDetail.hidden = !staggerCheck.checked;
    rerender();
  });
  bindRange("f-stagger-interval", (v) => { entry.stagger.interval.default = v; rerender(); });
  bindRange("f-stagger-count", (v) => { entry.stagger.itemCount.default = Math.round(v); rerender(); });

  // keyframes CSS の直接編集
  $("#f-keyframes").addEventListener("input", (e) => {
    entry.keyframesCSS = e.target.value;
    rerender();
  });
}

function openTune(id) {
  const entry = findEntry(id);
  if (!entry) { toast("エントリが見つかりません", true); return; }
  currentId = id;
  $("#preview-stage").dataset.scrollSim = ""; // 開き直したら調整モードから始める
  buildControls(entry);
  renderPreview(entry, $("#preview-stage"));
  drawBezierGraph(entry.standardControls.easing);
  $("#save-status").textContent = "";
  showView("tune");
}

/* ----- エクスポートモーダル ----- */

const EXPORTERS = {
  obsidian: { title: "Obsidian仕様書Markdown", fn: exportObsidian },
  css: { title: "CSSドキュメント", fn: exportCSSDoc },
  cursor: { title: "Cursor実装ブリーフ", fn: exportCursorBrief }
};

function openExportModal(kind) {
  const entry = findEntry(currentId);
  if (!entry) return;
  const exp = EXPORTERS[kind];
  $("#modal-title").textContent = exp.title;
  $("#modal-body").value = exp.fn(entry);
  $("#modal").hidden = false;
}

/* ----- メインアプリ初期化 ----- */

function initApp() {
  loadLibrary();
  loadPrototypes();

  $$(".nav-btn").forEach((b) => {
    b.addEventListener("click", () => showView(b.dataset.nav));
  });

  const root = $("#library-root");
  root.addEventListener("click", handleLibraryClick);

  // ホバーで再生、離れたら停止（無限ループ系はホバー中のみ繰り返し再生）
  root.addEventListener("mouseover", (e) => {
    const card = e.target.closest(".lib-card");
    if (!card || (e.relatedTarget && card.contains(e.relatedTarget))) return;
    const entry = findEntry(card.dataset.id);
    if (entry) playCard(entry);
  });
  root.addEventListener("mouseout", (e) => {
    const card = e.target.closest(".lib-card");
    if (!card || (e.relatedTarget && card.contains(e.relatedTarget))) return;
    const entry = findEntry(card.dataset.id);
    if (entry) stopCard(entry);
  });

  // テーマ切替（デフォルトはライト。選択はlocalStorageに保存）
  applyTheme(localStorage.getItem(THEME_KEY) || "light");
  $$(".theme-btn").forEach((b) => {
    b.addEventListener("click", () => applyTheme(b.dataset.themeChoice));
  });

  // 新規追加のタブ切替
  $$(".add-tab").forEach((b) => {
    b.addEventListener("click", () => switchAddTab(b.dataset.addTab));
  });

  $("#parse-btn").addEventListener("click", handleParse);
  $("#proto-save-btn").addEventListener("click", handleProtoSave);

  // プロトタイプHTML貼り付け時、メタコメントから名前/説明を自動入力する
  $("#proto-paste-area").addEventListener("input", () => {
    try {
      const parsed = parsePrototypePasted($("#proto-paste-area").value);
      if (parsed.name && !$("#proto-name").value.trim()) $("#proto-name").value = parsed.name;
      if (parsed.description && !$("#proto-desc").value.trim()) $("#proto-desc").value = parsed.description;
    } catch (_) { /* 入力途中は無視 */ }
  });

  // 数式ジェネレーターから追加
  $("#add-generator-swing").addEventListener("click", () => {
    const entry = makeSwingEntry();
    if (pendingPrototypeId && findPrototype(pendingPrototypeId)) {
      entry.prototypeId = pendingPrototypeId;
      pendingPrototypeId = null;
    }
    library.push(entry);
    saveLibrary();
    toast("減衰振動スウィングを追加しました。パラメータを調整してください");
    openTune(entry.id);
  });

  $("#copy-claude-prompt").addEventListener("click", async () => {
    const ok = await copyText(CLAUDE_PROMPT);
    toast(ok ? "Claude用の指示文をコピーしました" : "コピーに失敗しました", !ok);
  });

  $("#copy-claude-proto-prompt").addEventListener("click", async () => {
    const ok = await copyText(CLAUDE_PROTO_PROMPT);
    toast(ok ? "Claude用の指示文（複合アニメーション）をコピーしました" : "コピーに失敗しました", !ok);
  });

  $("#proto-modal-close").addEventListener("click", () => {
    $("#proto-modal").hidden = true;
    $("#proto-frame").srcdoc = "";
  });
  $("#proto-modal").addEventListener("click", (e) => {
    if (e.target === $("#proto-modal")) {
      $("#proto-modal").hidden = true;
      $("#proto-frame").srcdoc = "";
    }
  });

  $("#back-to-library").addEventListener("click", () => showView("library"));

  $("#replay-btn").addEventListener("click", () => replayPreview($("#preview-stage")));

  $("#scroll-sim-btn").addEventListener("click", () => {
    const stage = $("#preview-stage");
    stage.dataset.scrollSim = stage.dataset.scrollSim === "1" ? "" : "1";
    const entry = findEntry(currentId);
    if (entry) renderPreview(entry, stage);
  });

  $$("button[data-export]").forEach((b) => {
    b.addEventListener("click", () => openExportModal(b.dataset.export));
  });

  $("#modal-close").addEventListener("click", () => { $("#modal").hidden = true; });
  $("#modal").addEventListener("click", (e) => {
    if (e.target === $("#modal")) $("#modal").hidden = true;
  });
  $("#modal-copy").addEventListener("click", async () => {
    const ok = await copyText($("#modal-body").value);
    toast(ok ? "コピーしました" : "コピーに失敗しました", !ok);
  });

  showView("library");
}

/* ============================================================
   share.html（読み取り専用の共有ビュー）
   ============================================================ */

/** 共有ページ下部：仕様の要約と使用CSSを表示する */
function renderShareSpec(entry) {
  const specEl = $("#share-spec");
  const cssEl = $("#share-css-code");
  if (!specEl || !cssEl) return;

  const sc = entry.standardControls;
  const rows = [
    ["トリガー", describeTrigger(entry)],
    ["対象セレクタ", entry.targetSelector || "—"],
    ["duration", `${sc.duration.default}ms`],
    ["delay", `${sc.delay.default}ms`],
    ["easing", sc.easing]
  ];
  if (entry.loop && entry.loop.enabled) {
    rows.push(["ループ", entry.loop.iterationCount === "infinite" ? "無限" : `${entry.loop.iterationCount}回`]);
  }
  if (entry.stagger && entry.stagger.enabled) {
    rows.push(["スタッガー", `${entry.stagger.itemCount.default}要素 × ${entry.stagger.interval.default}ms間隔`]);
  }
  Object.entries(entry.customParams || {}).forEach(([name, p]) => {
    rows.push([p.label || name, paramValueWithUnit(p)]);
  });
  if (entry.notes) rows.push(["備考", entry.notes]);

  specEl.innerHTML = rows
    .map(([k, v]) => `<div class="share-spec-row"><span class="share-spec-key">${escapeHtml(k)}</span><span class="share-spec-val">${escapeHtml(v)}</span></div>`)
    .join("");

  const css = exportCSSDoc(entry);
  cssEl.textContent = css;
  const copyBtn = $("#share-css-copy");
  if (copyBtn) {
    copyBtn.addEventListener("click", async () => {
      const ok = await copyText(css);
      toast(ok ? "CSSをコピーしました" : "コピーに失敗しました", !ok);
    });
  }
}

function initShare() {
  const errBox = $("#share-error");
  const params = new URLSearchParams(location.search);
  const data = params.get("data");
  try {
    if (!data) throw new Error("URLに共有データ（?data=...）が含まれていません。");
    const entry = decodeData(data);
    if (!entry || !entry.keyframesCSS || !entry.standardControls) {
      throw new Error("共有データの形式が正しくありません。");
    }
    $("#share-name").textContent = entry.name || "（無題のアニメーション）";
    $("#share-trigger").textContent = `トリガー: ${describeTrigger(entry)}`;
    const stage = $("#preview-stage");
    stage.dataset.scrollSim = "1"; // 共有ビューでは実際の発火方法をそのまま再現する
    renderPreview(entry, stage);
    $("#replay-btn").addEventListener("click", () => replayPreview(stage));
    renderShareSpec(entry);
  } catch (e) {
    $("#share-name").textContent = "読み込みエラー";
    errBox.textContent = `共有データを復元できませんでした。\n${e.message}\n→ リンクが途中で切れていないか確認してください。`;
    errBox.hidden = false;
    const replay = $("#replay-btn");
    if (replay) replay.hidden = true;
  }
}

/* ---------- エントリポイント ---------- */

document.addEventListener("DOMContentLoaded", () => {
  if ($("#share-root")) {
    initShare();
  } else if ($("#library-root")) {
    initApp();
  }
});
