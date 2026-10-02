'use strict';

// ===== 定義 =====
const SVG_NS = 'http://www.w3.org/2000/svg';
const STORAGE_KEY = 'flow-diagram-v1';
const GRID = 10;
const INK = '#1f2328';

// 図形の種類
const NODE_TYPES = {
  process:     { name: '工程',           w: 140, h: 120, label: '工程',
                 fields: [['ct', 'C/T（秒）', 'number'], ['co', '段取り C/O（分）', 'number'],
                          ['uptime', '稼働率（%）', 'number'], ['operators', '人数', 'number']] },
  external:    { name: '供給者/顧客',     w: 130, h: 80,  label: '顧客',
                 fields: [['info', '補足（需要量など）', 'text']] },
  inventory:   { name: '在庫',           w: 56,  h: 48,  label: '',
                 fields: [['qty', '数量（個）', 'number'], ['days', '在庫日数（日）', 'number']] },
  control:     { name: '生産管理',        w: 160, h: 60,  label: '生産管理',
                 fields: [['info', '補足（システム名など）', 'text']] },
  truck:       { name: '輸送/出荷',       w: 90,  h: 54,  label: '',
                 fields: [['freq', '頻度（例: 1回/日）', 'text']] },
  supermarket: { name: 'スーパーマーケット', w: 50,  h: 60,  label: '', fields: [] },
  operator:    { name: '作業者',          w: 40,  h: 44,  label: '', fields: [] },
  kaizen:      { name: '改善ポイント',     w: 120, h: 72,  label: '改善', fields: [] },
  note:        { name: 'テキスト',        w: 140, h: 40,  label: 'テキスト', fields: [] },
};

// 矢印の種類
const EDGE_KINDS = {
  material:   { name: 'モノの流れ',        arrowL: 14, arrowW: 16 },
  push:       { name: 'プッシュ（押し出し）', arrowL: 20, arrowW: 26 },
  pull:       { name: '引き取り（プル）',    arrowL: 12, arrowW: 14 },
  info:       { name: '情報（手作業）',      arrowL: 10, arrowW: 10 },
  electronic: { name: '情報（電子）',        arrowL: 10, arrowW: 10 },
};

// ===== 状態 =====
let doc = emptyDoc();
let selection = null;            // { type: 'node'|'edge', id }
let currentEdgeKind = 'material';
let view = { x: 0, y: 0, k: 1 };
let drag = null;                 // 進行中のポインタ操作
let history = [];
let historyIndex = -1;
let addCount = 0;

const svg = document.getElementById('canvas');
const propsEl = document.getElementById('props');
const statusEl = document.getElementById('statusbar');
let viewport, edgeLayer, nodeLayer, overlayLayer;

function emptyDoc() {
  return { title: '無題の流れ図', nodes: [], edges: [] };
}

function uid(prefix) {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// ===== SVG ヘルパ =====
function el(tag, attrs, parent) {
  const e = document.createElementNS(SVG_NS, tag);
  for (const k in attrs) {
    if (attrs[k] !== undefined && attrs[k] !== null) e.setAttribute(k, attrs[k]);
  }
  if (parent) parent.appendChild(e);
  return e;
}

function text(parent, str, x, y, attrs) {
  const lines = String(str).split('\n');
  const size = (attrs && attrs['font-size']) || 13;
  const lh = size * 1.25;
  const t = el('text', Object.assign({
    x, 'font-size': size, 'text-anchor': 'middle', 'dominant-baseline': 'middle', fill: INK,
  }, attrs), parent);
  lines.forEach((line, i) => {
    const ts = el('tspan', { x, y: y + (i - (lines.length - 1) / 2) * lh }, t);
    ts.textContent = line;
  });
  return t;
}

function textWidth(str) {
  let w = 0;
  for (const ch of String(str)) w += ch.charCodeAt(0) > 255 ? 12 : 7;
  return w;
}

function defineMarkers(defs) {
  for (const kind in EDGE_KINDS) {
    const { arrowL: L, arrowW: W } = EDGE_KINDS[kind];
    const m = el('marker', {
      id: 'm-' + kind, markerWidth: L, markerHeight: W, refX: 0, refY: W / 2,
      orient: 'auto', markerUnits: 'userSpaceOnUse', viewBox: `0 0 ${L} ${W}`,
    }, defs);
    el('path', { d: `M0,0 L${L},${W / 2} L0,${W} Z`, fill: INK }, m);
  }
}

// ===== 図形の描画 =====
const shapeAttrs = { class: 'shape', fill: '#fff', stroke: INK, 'stroke-width': 1.6 };

function drawNodeShape(g, n) {
  const { w, h } = n;
  const p = n.props || {};
  switch (n.type) {
    case 'process': {
      const hh = Math.min(40, h * 0.45);
      el('rect', Object.assign({ x: 0, y: 0, width: w, height: h }, shapeAttrs), g);
      el('line', { x1: 0, y1: hh, x2: w, y2: hh, stroke: INK, 'stroke-width': 1.2 }, g);
      text(g, n.label, w / 2, hh / 2, { 'font-weight': 'bold' });
      const rows = [];
      if (isSet(p.ct)) rows.push(`C/T = ${p.ct} 秒`);
      if (isSet(p.co)) rows.push(`C/O = ${p.co} 分`);
      if (isSet(p.uptime)) rows.push(`稼働率 = ${p.uptime} %`);
      if (isSet(p.operators)) rows.push(`人数 = ${p.operators} 人`);
      rows.forEach((r, i) => {
        const t = el('text', { x: 8, y: hh + 16 + i * 17, 'font-size': 11, fill: INK }, g);
        t.textContent = r;
      });
      break;
    }
    case 'external': {
      el('path', Object.assign({
        d: `M0,${h} L0,${h * 0.3} L${w / 3},0 L${w / 3},${h * 0.3} L${w * 2 / 3},0 ` +
           `L${w * 2 / 3},${h * 0.3} L${w},0 L${w},${h} Z`,
      }, shapeAttrs), g);
      text(g, n.label, w / 2, p.info ? h * 0.56 : h * 0.65, { 'font-weight': 'bold' });
      if (p.info) text(g, p.info, w / 2, h * 0.82, { 'font-size': 11 });
      break;
    }
    case 'inventory': {
      el('path', Object.assign({ d: `M${w / 2},0 L${w},${h} L0,${h} Z`, fill: '#fff8e6' }, shapeAttrs), g);
      text(g, 'I', w / 2, h * 0.66, { 'font-weight': 'bold', 'font-size': 16 });
      const rows = [];
      if (n.label) rows.push(n.label);
      if (isSet(p.qty)) rows.push(`${p.qty} 個`);
      if (isSet(p.days)) rows.push(`${p.days} 日`);
      rows.forEach((r, i) => text(g, r, w / 2, h + 12 + i * 14, { 'font-size': 11 }));
      break;
    }
    case 'control': {
      el('rect', Object.assign({ x: 0, y: 0, width: w, height: h }, shapeAttrs), g);
      text(g, n.label, w / 2, p.info ? h * 0.38 : h / 2, { 'font-weight': 'bold' });
      if (p.info) text(g, p.info, w / 2, h * 0.72, { 'font-size': 11 });
      break;
    }
    case 'truck': {
      el('rect', { x: 0, y: 0, width: w, height: h, fill: 'transparent', class: 'shape', stroke: 'none' }, g);
      el('rect', Object.assign({ x: 0, y: h * 0.1, width: w * 0.62, height: h * 0.6 }, shapeAttrs), g);
      el('path', Object.assign({
        d: `M${w * 0.62},${h * 0.3} L${w * 0.84},${h * 0.3} L${w},${h * 0.5} L${w},${h * 0.7} L${w * 0.62},${h * 0.7} Z`,
      }, shapeAttrs), g);
      el('circle', { cx: w * 0.2, cy: h * 0.8, r: h * 0.11, fill: '#fff', stroke: INK, 'stroke-width': 1.6 }, g);
      el('circle', { cx: w * 0.8, cy: h * 0.8, r: h * 0.11, fill: '#fff', stroke: INK, 'stroke-width': 1.6 }, g);
      if (p.freq) text(g, p.freq, w * 0.31, h * 0.4, { 'font-size': 11 });
      if (n.label) text(g, n.label, w / 2, h + 12, { 'font-size': 12 });
      break;
    }
    case 'supermarket': {
      el('rect', { x: 0, y: 0, width: w, height: h, fill: 'transparent', class: 'shape', stroke: 'none' }, g);
      el('path', {
        d: `M0,0 L${w},0 L${w},${h} L0,${h} M0,${h / 3} L${w},${h / 3} M0,${h * 2 / 3} L${w},${h * 2 / 3}`,
        fill: 'none', stroke: INK, 'stroke-width': 2,
      }, g);
      if (n.label) text(g, n.label, w / 2, h + 12, { 'font-size': 12 });
      break;
    }
    case 'operator': {
      el('rect', { x: 0, y: 0, width: w, height: h, fill: 'transparent', class: 'shape', stroke: 'none' }, g);
      el('circle', { cx: w / 2, cy: h * 0.24, r: Math.min(w, h) * 0.22, fill: '#fff', stroke: INK, 'stroke-width': 1.6 }, g);
      el('path', {
        d: `M${w * 0.05},${h} A${w * 0.45},${h * 0.5} 0 0 1 ${w * 0.95},${h} Z`,
        fill: '#fff', stroke: INK, 'stroke-width': 1.6,
      }, g);
      if (n.label) text(g, n.label, w / 2, h + 12, { 'font-size': 12 });
      break;
    }
    case 'kaizen': {
      const pts = [];
      const spikes = 12;
      for (let i = 0; i < spikes * 2; i++) {
        const a = (Math.PI * i) / spikes;
        const r = i % 2 === 0 ? 1 : 0.72;
        pts.push(`${w / 2 + Math.cos(a) * (w / 2) * r},${h / 2 + Math.sin(a) * (h / 2) * r}`);
      }
      el('polygon', Object.assign({}, shapeAttrs, { points: pts.join(' '), fill: '#fff3c4', stroke: '#d97706' }), g);
      text(g, n.label, w / 2, h / 2, { 'font-size': 12, 'font-weight': 'bold' });
      break;
    }
    default: { // note
      el('rect', { x: 0, y: 0, width: w, height: h, fill: 'transparent', class: 'shape', stroke: 'none', 'stroke-dasharray': '4 3' }, g);
      text(g, n.label, w / 2, h / 2, { 'font-size': 13 });
    }
  }
}

function isSet(v) {
  return v !== undefined && v !== null && v !== '';
}

// ===== 矢印の形状計算 =====
function center(n) {
  return { x: n.x + n.w / 2, y: n.y + n.h / 2 };
}

function clipToBox(n, px, py) {
  const c = center(n);
  const dx = px - c.x, dy = py - c.y;
  if (!dx && !dy) return c;
  const sx = dx ? (n.w / 2) / Math.abs(dx) : Infinity;
  const sy = dy ? (n.h / 2) / Math.abs(dy) : Infinity;
  const s = Math.min(sx, sy);
  return { x: c.x + dx * s, y: c.y + dy * s };
}

function edgePoints(e, a, b) {
  const ca = center(a), cb = center(b);
  if (e.route !== 'elbow') {
    return [clipToBox(a, cb.x, cb.y), clipToBox(b, ca.x, ca.y)];
  }
  const dx = cb.x - ca.x, dy = cb.y - ca.y;
  // 上下に離れていれば縦→横→縦、それ以外は横→縦→横
  const separatedY = a.y + a.h < b.y || b.y + b.h < a.y;
  let pts;
  if (!separatedY) {
    const p1 = { x: dx > 0 ? a.x + a.w : a.x, y: ca.y };
    const p2 = { x: dx > 0 ? b.x : b.x + b.w, y: cb.y };
    const mx = (p1.x + p2.x) / 2;
    pts = [p1, { x: mx, y: p1.y }, { x: mx, y: p2.y }, p2];
  } else {
    const p1 = { x: ca.x, y: dy > 0 ? a.y + a.h : a.y };
    const p2 = { x: cb.x, y: dy > 0 ? b.y : b.y + b.h };
    const my = (p1.y + p2.y) / 2;
    pts = [p1, { x: p1.x, y: my }, { x: p2.x, y: my }, p2];
  }
  return pts.filter((p, i) => i === 0 || Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y) > 0.5);
}

// 矢じりの分だけ終端を手前にずらす
function shorten(pts, L) {
  const out = pts.map(p => ({ ...p }));
  const n = out.length;
  const a = out[n - 2], b = out[n - 1];
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len > L + 1) {
    b.x -= ((b.x - a.x) / len) * L;
    b.y -= ((b.y - a.y) / len) * L;
  }
  return out;
}

// 電子情報の稲妻（最長区間の中央にジグザグを挿入）
function zigzag(pts) {
  let best = 0, bestLen = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const l = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
    if (l > bestLen) { bestLen = l; best = i; }
  }
  if (bestLen < 40) return pts;
  const a = pts[best], b = pts[best + 1];
  const ux = (b.x - a.x) / bestLen, uy = (b.y - a.y) / bestLen;
  const nx = -uy, ny = ux;
  // ラベル（中央）と重ならないよう、区間の 30% の位置に置く
  const mx = a.x + (b.x - a.x) * 0.3, my = a.y + (b.y - a.y) * 0.3;
  const z = [
    { x: mx - ux * 12, y: my - uy * 12 },
    { x: mx - ux * 2 + nx * 9, y: my - uy * 2 + ny * 9 },
    { x: mx + ux * 2 - nx * 9, y: my + uy * 2 - ny * 9 },
    { x: mx + ux * 12, y: my + uy * 12 },
  ];
  return [...pts.slice(0, best + 1), ...z, ...pts.slice(best + 1)];
}

function pathD(pts) {
  return pts.map((p, i) => (i ? 'L' : 'M') + p.x.toFixed(1) + ',' + p.y.toFixed(1)).join(' ');
}

function midpoint(pts) {
  let total = 0;
  const segs = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const l = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
    segs.push(l);
    total += l;
  }
  let half = total / 2;
  for (let i = 0; i < segs.length; i++) {
    if (half <= segs[i]) {
      const t = segs[i] ? half / segs[i] : 0;
      return { x: pts[i].x + (pts[i + 1].x - pts[i].x) * t, y: pts[i].y + (pts[i + 1].y - pts[i].y) * t };
    }
    half -= segs[i];
  }
  return pts[0];
}

function drawEdgeLine(g, kind, pts) {
  const def = EDGE_KINDS[kind] || EDGE_KINDS.material;
  const linePts = kind === 'electronic' ? zigzag(pts) : pts;
  const d = pathD(shorten(linePts, def.arrowL));
  const marker = `url(#m-${kind})`;
  const base = { d, fill: 'none', stroke: INK, class: 'main-line', 'marker-end': marker, 'stroke-linejoin': 'round' };
  switch (kind) {
    case 'push':
      el('path', Object.assign(base, { 'stroke-width': 10 }), g);
      el('path', { d, fill: 'none', stroke: '#fff', 'stroke-width': 6, 'stroke-dasharray': '7 6' }, g);
      break;
    case 'pull':
      el('path', Object.assign(base, { 'stroke-width': 3, 'stroke-dasharray': '9 6' }), g);
      break;
    case 'info':
    case 'electronic':
      el('path', Object.assign(base, { 'stroke-width': 1.6 }), g);
      break;
    default:
      el('path', Object.assign(base, { 'stroke-width': 4 }), g);
  }
}

// ===== レンダリング =====
function setupCanvas() {
  svg.innerHTML = '';
  const defs = el('defs', {}, svg);
  defineMarkers(defs);
  viewport = el('g', { id: 'viewport' }, svg);
  edgeLayer = el('g', {}, viewport);
  nodeLayer = el('g', {}, viewport);
  overlayLayer = el('g', {}, viewport);
}

function render() {
  viewport.setAttribute('transform', `translate(${view.x},${view.y}) scale(${view.k})`);
  edgeLayer.innerHTML = '';
  nodeLayer.innerHTML = '';
  const byId = Object.fromEntries(doc.nodes.map(n => [n.id, n]));

  for (const e of doc.edges) {
    const a = byId[e.from], b = byId[e.to];
    if (!a || !b) continue;
    const pts = edgePoints(e, a, b);
    const sel = selection && selection.type === 'edge' && selection.id === e.id;
    const g = el('g', { class: 'edge' + (sel ? ' selected' : ''), 'data-id': e.id }, edgeLayer);
    el('path', { d: pathD(pts), class: 'hit' }, g);
    drawEdgeLine(g, e.kind, pts);
    if (e.label) {
      const m = midpoint(pts);
      const tw = textWidth(e.label) + 10;
      el('rect', { x: m.x - tw / 2, y: m.y - 10, width: tw, height: 20, rx: 4, fill: '#fff', stroke: '#c7ccd4', class: 'label-bg' }, g);
      const t = el('text', { x: m.x, y: m.y, class: 'edge-label', 'font-size': 12, 'text-anchor': 'middle', 'dominant-baseline': 'middle', fill: INK }, g);
      t.textContent = e.label;
    }
  }

  for (const n of doc.nodes) {
    const sel = selection && selection.type === 'node' && selection.id === n.id;
    const g = el('g', {
      class: 'node' + (sel ? ' selected' : ''), 'data-id': n.id,
      transform: `translate(${n.x},${n.y})`,
    }, nodeLayer);
    drawNodeShape(g, n);
    [[n.w / 2, 0], [n.w, n.h / 2], [n.w / 2, n.h], [0, n.h / 2]].forEach(([cx, cy]) => {
      el('circle', { class: 'port', cx, cy, r: 5.5 }, g);
    });
  }
  renderStatus();
}

function renderStatus() {
  let days = 0, ct = 0, procs = 0;
  for (const n of doc.nodes) {
    const p = n.props || {};
    if (n.type === 'inventory' && isSet(p.days)) days += Number(p.days) || 0;
    if (n.type === 'process') {
      procs++;
      if (isSet(p.ct)) ct += Number(p.ct) || 0;
    }
  }
  statusEl.innerHTML =
    `生産リードタイム <b>${round(days)} 日</b> ／ 付加価値時間 <b>${round(ct)} 秒</b> ／ 工程数 ${procs}`;
}

function round(v) {
  return Math.round(v * 100) / 100;
}

// ===== プロパティパネル =====
function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function renderProps() {
  propsEl.classList.toggle('open', !!selection);
  const item = getSelected();
  if (!item) {
    propsEl.innerHTML = `
      <h2>図の設定</h2>
      <label>タイトル（保存時のファイル名）</label>
      <input id="p-title" value="${esc(doc.title)}">
      <h2 style="margin-top:20px">使い方</h2>
      <div class="empty">
        ・左の図形をクリック／ドラッグで追加<br>
        ・図形の青い点からドラッグして矢印を接続<br>
        ・図形や矢印をクリックで選択・編集<br>
        ・背景ドラッグで移動、ホイールで拡大縮小<br>
        ・<kbd>Delete</kbd> 削除 ／ <kbd>Ctrl</kbd>+<kbd>D</kbd> 複製<br>
        ・<kbd>Ctrl</kbd>+<kbd>Z</kbd> 元に戻す ／ <kbd>Ctrl</kbd>+<kbd>Y</kbd> やり直し<br>
        ・内容はブラウザに自動保存されます
      </div>`;
    bindInput('p-title', v => { doc.title = v; });
    return;
  }

  if (selection.type === 'node') {
    const n = item;
    const def = NODE_TYPES[n.type];
    const fields = def.fields.map(([key, label, type]) => `
      <label>${esc(label)}</label>
      <input id="p-f-${key}" type="${type}" value="${esc((n.props || {})[key])}">`).join('');
    propsEl.innerHTML = `
      <h2>${esc(def.name)}</h2>
      <label>名前・ラベル</label>
      <textarea id="p-label">${esc(n.label)}</textarea>
      ${fields}
      <div class="row2">
        <div><label>幅</label><input id="p-w" type="number" min="20" step="10" value="${n.w}"></div>
        <div><label>高さ</label><input id="p-h" type="number" min="20" step="10" value="${n.h}"></div>
      </div>
      <div class="actions">
        <button id="p-dup">複製</button>
        <button id="p-del" class="danger">削除</button>
      </div>`;
    bindInput('p-label', v => { n.label = v; });
    def.fields.forEach(([key]) => bindInput('p-f-' + key, v => { n.props = n.props || {}; n.props[key] = v; }));
    bindInput('p-w', v => { n.w = Math.max(20, Number(v) || 20); });
    bindInput('p-h', v => { n.h = Math.max(20, Number(v) || 20); });
    document.getElementById('p-dup').onclick = duplicateSelected;
  } else {
    const e = item;
    const options = Object.entries(EDGE_KINDS)
      .map(([k, d]) => `<option value="${k}" ${k === e.kind ? 'selected' : ''}>${esc(d.name)}</option>`).join('');
    propsEl.innerHTML = `
      <h2>矢印</h2>
      <label>種類</label>
      <select id="p-kind">${options}</select>
      <label>線の形</label>
      <select id="p-route">
        <option value="straight" ${e.route !== 'elbow' ? 'selected' : ''}>直線</option>
        <option value="elbow" ${e.route === 'elbow' ? 'selected' : ''}>カギ線</option>
      </select>
      <label>ラベル（例: 週次発注）</label>
      <input id="p-elabel" value="${esc(e.label)}">
      <div class="actions">
        <button id="p-rev">向きを反転</button>
        <button id="p-del" class="danger">削除</button>
      </div>`;
    bindInput('p-kind', v => { e.kind = v; });
    bindInput('p-route', v => { e.route = v; });
    bindInput('p-elabel', v => { e.label = v; });
    document.getElementById('p-rev').onclick = () => {
      [e.from, e.to] = [e.to, e.from];
      render(); commit();
    };
  }
  document.getElementById('p-del').onclick = deleteSelected;
}

function bindInput(id, apply) {
  const input = document.getElementById(id);
  input.addEventListener('input', () => { apply(input.value); render(); });
  input.addEventListener('change', () => { apply(input.value); render(); commit(); });
}

function getSelected() {
  if (!selection) return null;
  const list = selection.type === 'node' ? doc.nodes : doc.edges;
  return list.find(x => x.id === selection.id) || null;
}

function select(sel) {
  selection = sel;
  render();
  renderProps();
}

// ===== 編集操作 =====
function addNode(type, x, y) {
  const def = NODE_TYPES[type];
  const n = {
    id: uid('n'), type, label: def.label, props: {},
    w: def.w, h: def.h,
    x: snap(x - def.w / 2), y: snap(y - def.h / 2),
  };
  doc.nodes.push(n);
  select({ type: 'node', id: n.id });
  commit();
}

function addEdge(from, to, kind) {
  if (from === to) return;
  const e = { id: uid('e'), from, to, kind, route: kind === 'info' || kind === 'electronic' ? 'elbow' : 'straight', label: '' };
  doc.edges.push(e);
  select({ type: 'edge', id: e.id });
  commit();
}

function deleteSelected() {
  if (!selection) return;
  if (selection.type === 'node') {
    doc.nodes = doc.nodes.filter(n => n.id !== selection.id);
    doc.edges = doc.edges.filter(e => e.from !== selection.id && e.to !== selection.id);
  } else {
    doc.edges = doc.edges.filter(e => e.id !== selection.id);
  }
  select(null);
  commit();
}

function duplicateSelected() {
  const item = getSelected();
  if (!item || selection.type !== 'node') return;
  const copy = JSON.parse(JSON.stringify(item));
  copy.id = uid('n');
  copy.x += 20;
  copy.y += 20;
  doc.nodes.push(copy);
  select({ type: 'node', id: copy.id });
  commit();
}

function snap(v) {
  return Math.round(v / GRID) * GRID;
}

// ===== 履歴・保存 =====
function commit() {
  const s = JSON.stringify(doc);
  if (history[historyIndex] === s) return;
  history = history.slice(0, historyIndex + 1);
  history.push(s);
  if (history.length > 100) history.shift();
  historyIndex = history.length - 1;
  try { localStorage.setItem(STORAGE_KEY, s); } catch (_) { /* 保存不可の環境では無視 */ }
  updateHistoryButtons();
}

function restore(index) {
  historyIndex = index;
  doc = JSON.parse(history[index]);
  try { localStorage.setItem(STORAGE_KEY, history[index]); } catch (_) { /* ignore */ }
  selection = null;
  render();
  renderProps();
  updateHistoryButtons();
}

function undo() { if (historyIndex > 0) restore(historyIndex - 1); }
function redo() { if (historyIndex < history.length - 1) restore(historyIndex + 1); }

function updateHistoryButtons() {
  document.getElementById('btn-undo').disabled = historyIndex <= 0;
  document.getElementById('btn-redo').disabled = historyIndex >= history.length - 1;
}

function loadDoc(d) {
  if (!d || !Array.isArray(d.nodes) || !Array.isArray(d.edges)) throw new Error('形式が正しくありません');
  doc = { title: d.title || '無題の流れ図', nodes: d.nodes, edges: d.edges };
  selection = null;
  render();
  renderProps();
  commit();
  zoomFit();
}

// ===== 座標変換・表示 =====
function toWorld(clientX, clientY) {
  const r = svg.getBoundingClientRect();
  return { x: (clientX - r.left - view.x) / view.k, y: (clientY - r.top - view.y) / view.k };
}

function zoomAt(factor, sx, sy) {
  const k = Math.min(3, Math.max(0.2, view.k * factor));
  view.x = sx - ((sx - view.x) * k) / view.k;
  view.y = sy - ((sy - view.y) * k) / view.k;
  view.k = k;
  render();
}

function contentBounds() {
  if (!doc.nodes.length) return null;
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const n of doc.nodes) {
    x1 = Math.min(x1, n.x); y1 = Math.min(y1, n.y);
    x2 = Math.max(x2, n.x + n.w); y2 = Math.max(y2, n.y + n.h + 40); // 下側の文字分
  }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

function zoomFit() {
  const b = contentBounds();
  const r = svg.getBoundingClientRect();
  if (!b || !r.width) { view = { x: 0, y: 0, k: 1 }; render(); return; }
  const pad = 40;
  const k = Math.min(1.5, (r.width - pad * 2) / b.w, (r.height - pad * 2) / b.h);
  view.k = Math.max(0.2, k);
  view.x = (r.width - b.w * view.k) / 2 - b.x * view.k;
  view.y = (r.height - b.h * view.k) / 2 - b.y * view.k;
  render();
}

// ===== ポインタ操作 =====
svg.addEventListener('pointerdown', ev => {
  if (ev.button !== 0) return;
  const port = ev.target.closest('.port');
  const nodeEl = ev.target.closest('.node');
  const edgeEl = ev.target.closest('.edge');
  const w = toWorld(ev.clientX, ev.clientY);
  ev.preventDefault();
  svg.setPointerCapture(ev.pointerId);

  if (port && nodeEl) {
    const from = doc.nodes.find(n => n.id === nodeEl.dataset.id);
    const c = center(from);
    const line = el('line', {
      x1: c.x, y1: c.y, x2: w.x, y2: w.y, stroke: '#2563eb', 'stroke-width': 2,
      'stroke-dasharray': '5 4', 'pointer-events': 'none',
    }, overlayLayer);
    drag = { mode: 'connect', from: from.id, line };
  } else if (nodeEl) {
    const n = doc.nodes.find(x => x.id === nodeEl.dataset.id);
    if (!selection || selection.id !== n.id) select({ type: 'node', id: n.id });
    drag = { mode: 'move', node: n, dx: w.x - n.x, dy: w.y - n.y, moved: false };
  } else if (edgeEl) {
    select({ type: 'edge', id: edgeEl.dataset.id });
    drag = null;
  } else {
    if (selection) select(null);
    drag = { mode: 'pan', sx: ev.clientX, sy: ev.clientY, vx: view.x, vy: view.y };
    svg.classList.add('panning');
  }
});

svg.addEventListener('pointermove', ev => {
  if (!drag) return;
  const w = toWorld(ev.clientX, ev.clientY);
  if (drag.mode === 'move') {
    const nx = snap(w.x - drag.dx), ny = snap(w.y - drag.dy);
    if (nx !== drag.node.x || ny !== drag.node.y) {
      drag.node.x = nx;
      drag.node.y = ny;
      drag.moved = true;
      render();
    }
  } else if (drag.mode === 'connect') {
    drag.line.setAttribute('x2', w.x);
    drag.line.setAttribute('y2', w.y);
  } else if (drag.mode === 'pan') {
    view.x = drag.vx + ev.clientX - drag.sx;
    view.y = drag.vy + ev.clientY - drag.sy;
    render();
  }
});

function endPointer(ev) {
  if (!drag) return;
  if (drag.mode === 'move' && drag.moved) commit();
  if (drag.mode === 'connect') {
    drag.line.remove();
    const target = document.elementFromPoint(ev.clientX, ev.clientY);
    const nodeEl = target && target.closest && target.closest('.node');
    if (nodeEl && nodeEl.dataset.id !== drag.from) addEdge(drag.from, nodeEl.dataset.id, currentEdgeKind);
  }
  svg.classList.remove('panning');
  drag = null;
}
svg.addEventListener('pointerup', endPointer);
svg.addEventListener('pointercancel', endPointer);

svg.addEventListener('dblclick', ev => {
  if (ev.target.closest('.node')) {
    const input = document.getElementById('p-label');
    if (input) { input.focus(); input.select(); }
  }
});

svg.addEventListener('wheel', ev => {
  ev.preventDefault();
  const r = svg.getBoundingClientRect();
  zoomAt(ev.deltaY < 0 ? 1.1 : 1 / 1.1, ev.clientX - r.left, ev.clientY - r.top);
}, { passive: false });

// パレットからのドラッグ＆ドロップ
svg.addEventListener('dragover', ev => ev.preventDefault());
svg.addEventListener('drop', ev => {
  ev.preventDefault();
  const type = ev.dataTransfer.getData('text/plain');
  if (!NODE_TYPES[type]) return;
  const w = toWorld(ev.clientX, ev.clientY);
  addNode(type, w.x, w.y);
});

// キーボード
document.addEventListener('keydown', ev => {
  const tag = (ev.target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
  const mod = ev.ctrlKey || ev.metaKey;
  if (mod && ev.key.toLowerCase() === 'z' && !ev.shiftKey) { ev.preventDefault(); undo(); }
  else if (mod && (ev.key.toLowerCase() === 'y' || (ev.key.toLowerCase() === 'z' && ev.shiftKey))) { ev.preventDefault(); redo(); }
  else if (mod && ev.key.toLowerCase() === 'd') { ev.preventDefault(); duplicateSelected(); }
  else if (ev.key === 'Delete' || ev.key === 'Backspace') { if (selection) { ev.preventDefault(); deleteSelected(); } }
  else if (ev.key === 'Escape') { select(null); }
  else if (ev.key.startsWith('Arrow') && selection && selection.type === 'node') {
    ev.preventDefault();
    const n = getSelected();
    const step = ev.shiftKey ? GRID * 5 : GRID;
    if (ev.key === 'ArrowLeft') n.x -= step;
    if (ev.key === 'ArrowRight') n.x += step;
    if (ev.key === 'ArrowUp') n.y -= step;
    if (ev.key === 'ArrowDown') n.y += step;
    render();
    commit();
  }
});

// ===== パレット =====
function buildPalettes() {
  const np = document.getElementById('node-palette');
  for (const [type, def] of Object.entries(NODE_TYPES)) {
    const item = document.createElement('div');
    item.className = 'palette-item';
    item.draggable = true;
    item.title = def.name;
    const icon = el('svg', { viewBox: `-4 -4 ${def.w + 8} ${def.h + 8}`, preserveAspectRatio: 'xMidYMid meet' });
    const sample = { type, w: def.w, h: def.h, label: def.label, props: type === 'truck' ? { freq: '' } : {} };
    drawNodeShape(icon, sample);
    item.appendChild(icon);
    const name = document.createElement('span');
    name.textContent = def.name;
    item.appendChild(name);
    item.addEventListener('click', () => {
      const r = svg.getBoundingClientRect();
      const off = (addCount++ % 6) * 20;
      const w = toWorld(r.left + r.width / 2 + off, r.top + r.height / 2 + off);
      addNode(type, w.x, w.y);
    });
    item.addEventListener('dragstart', ev => ev.dataTransfer.setData('text/plain', type));
    np.appendChild(item);
  }

  const ep = document.getElementById('edge-palette');
  for (const [kind, def] of Object.entries(EDGE_KINDS)) {
    const item = document.createElement('div');
    item.className = 'edge-item' + (kind === currentEdgeKind ? ' active' : '');
    item.dataset.kind = kind;
    const icon = el('svg', { viewBox: '0 0 60 18' });
    drawEdgeLine(icon, kind, [{ x: 2, y: 9 }, { x: 58, y: 9 }]);
    item.appendChild(icon);
    const name = document.createElement('span');
    name.textContent = def.name;
    item.appendChild(name);
    item.addEventListener('click', () => {
      currentEdgeKind = kind;
      ep.querySelectorAll('.edge-item').forEach(x => x.classList.toggle('active', x.dataset.kind === kind));
      // 矢印を選択中なら、その種類も変更する
      const sel = getSelected();
      if (sel && selection.type === 'edge') {
        sel.kind = kind;
        render(); renderProps(); commit();
      }
    });
    ep.appendChild(item);
  }
}

// ===== 書き出し・読み込み =====
function fileBase() {
  return (doc.title || 'flow-diagram').replace(/[\\/:*?"<>|]/g, '_');
}

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function buildExportSvg() {
  const b = contentBounds();
  if (!b) return null;
  const pad = 30;
  const x = b.x - pad, y = b.y - pad, w = b.w + pad * 2, h = b.h + pad * 2;
  const prevSel = selection;
  selection = null;
  render();
  const out = el('svg', { xmlns: SVG_NS, width: w, height: h, viewBox: `${x} ${y} ${w} ${h}` });
  const style = el('style', {}, out);
  style.textContent = 'text{font-family:"Hiragino Kaku Gothic ProN","Noto Sans JP","Yu Gothic",Meiryo,sans-serif}.hit{stroke:transparent;fill:none}';
  const defs = el('defs', {}, out);
  defineMarkers(defs);
  el('rect', { x, y, width: w, height: h, fill: '#fff' }, out);
  out.appendChild(edgeLayer.cloneNode(true));
  const nodes = nodeLayer.cloneNode(true);
  nodes.querySelectorAll('.port').forEach(p => p.remove());
  out.appendChild(nodes);
  selection = prevSel;
  render();
  return { svg: new XMLSerializer().serializeToString(out), w, h };
}

function exportSvg() {
  const r = buildExportSvg();
  if (!r) return alert('図形がありません');
  download(new Blob([r.svg], { type: 'image/svg+xml' }), fileBase() + '.svg');
}

function exportPng() {
  const r = buildExportSvg();
  if (!r) return alert('図形がありません');
  const scale = 2;
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = r.w * scale;
    canvas.height = r.h * scale;
    const ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0);
    canvas.toBlob(blob => download(blob, fileBase() + '.png'), 'image/png');
  };
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(r.svg);
}

function exportJson() {
  download(new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' }), fileBase() + '.json');
}

// ===== サンプル =====
function sampleDoc() {
  const N = (id, type, x, y, label, props, w, h) => {
    const d = NODE_TYPES[type];
    return { id, type, x, y, label, props: props || {}, w: w || d.w, h: h || d.h };
  };
  const E = (from, to, kind, label, route) => ({ id: uid('e'), from, to, kind, label: label || '', route: route || 'straight' });
  return {
    title: 'サンプル_流れ図',
    nodes: [
      N('sup', 'external', 23, 40, '鋼材メーカー', { info: '週2回納入' }),
      N('cus', 'external', 1060, 40, '組立工場（顧客）', { info: '月 18,400個' }),
      N('ctl', 'control', 510, 50, '生産管理', { info: 'MRP' }),
      N('t1', 'truck', 43, 220, '', { freq: '週2回' }),
      N('t2', 'truck', 1080, 220, '', { freq: '1回/日' }),
      N('i1', 'inventory', 60, 410, '', { qty: 5000, days: 5 }),
      N('p1', 'process', 140, 370, 'プレス', { ct: 1, co: 60, uptime: 85, operators: 1 }),
      N('i2', 'inventory', 310, 410, '', { qty: 4600, days: 7.6 }),
      N('p2', 'process', 390, 370, '溶接', { ct: 39, co: 10, uptime: 100, operators: 1 }),
      N('i3', 'inventory', 560, 410, '', { qty: 1100, days: 1.8 }),
      N('p3', 'process', 640, 370, '組立', { ct: 46, co: 0, uptime: 100, operators: 1 }),
      N('i4', 'inventory', 810, 410, '', { qty: 2700, days: 4.5 }),
      N('p4', 'process', 890, 370, '出荷', {}),
      N('op1', 'operator', 190, 520, ''),
      N('kz1', 'kaizen', 380, 520, '段取り短縮'),
      N('note1', 'note', 600, 150, '週次スケジュール', {}, 160, 30),
    ],
    edges: [
      E('ctl', 'sup', 'electronic', '週次発注'),
      E('cus', 'ctl', 'electronic', '月次予測'),
      E('sup', 't1', 'material'),
      E('t1', 'i1', 'material'),
      E('i1', 'p1', 'material'),
      E('p1', 'i2', 'push'),
      E('i2', 'p2', 'material'),
      E('p2', 'i3', 'push'),
      E('i3', 'p3', 'material'),
      E('p3', 'i4', 'push'),
      E('i4', 'p4', 'material'),
      E('p4', 't2', 'material'),
      E('t2', 'cus', 'material'),
      E('ctl', 'p1', 'info', '', 'elbow'),
      E('ctl', 'p2', 'info', '', 'elbow'),
      E('ctl', 'p3', 'info', '', 'elbow'),
      E('ctl', 'p4', 'info', '日次出荷指示', 'elbow'),
    ],
  };
}

// ===== ボタン =====
document.getElementById('btn-new').onclick = () => {
  if (doc.nodes.length && !confirm('現在の図を消して新規作成しますか？（JSON保存していない内容は失われます）')) return;
  loadDoc(emptyDoc());
};
document.getElementById('btn-sample').onclick = () => {
  if (doc.nodes.length && !confirm('現在の図をサンプルで置き換えますか？')) return;
  loadDoc(sampleDoc());
};
document.getElementById('btn-undo').onclick = undo;
document.getElementById('btn-redo').onclick = redo;
document.getElementById('btn-zoom-in').onclick = () => { const r = svg.getBoundingClientRect(); zoomAt(1.2, r.width / 2, r.height / 2); };
document.getElementById('btn-zoom-out').onclick = () => { const r = svg.getBoundingClientRect(); zoomAt(1 / 1.2, r.width / 2, r.height / 2); };
document.getElementById('btn-zoom-fit').onclick = zoomFit;
document.getElementById('btn-export-png').onclick = exportPng;
document.getElementById('btn-export-svg').onclick = exportSvg;
document.getElementById('btn-export-json').onclick = exportJson;
const fileInput = document.getElementById('file-input');
document.getElementById('btn-import-json').onclick = () => fileInput.click();
fileInput.addEventListener('change', async () => {
  const f = fileInput.files[0];
  fileInput.value = '';
  if (!f) return;
  try {
    loadDoc(JSON.parse(await f.text()));
  } catch (err) {
    alert('読み込みに失敗しました: ' + err.message);
  }
});

// ===== 起動 =====
setupCanvas();
buildPalettes();
let saved = null;
try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch (_) { /* ignore */ }
if (saved && Array.isArray(saved.nodes)) {
  doc = saved;
  render();
  renderProps();
  commit();
  zoomFit();
} else {
  loadDoc(sampleDoc());
}
