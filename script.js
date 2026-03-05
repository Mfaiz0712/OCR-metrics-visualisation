/**
 * script.js — OCR Evaluation Dashboard (Fully Client-Side)
 *
 * All metric computation (edit distance, multiset intersection, word diff)
 * runs entirely in the browser. No backend or data.json needed.
 */

// ── Metric display config ────────────────────────────────────────────────
const METRIC_META = [
  { key:'crr',               label:'CRR',                desc:'Character Recognition Rate' },
  { key:'wrr',               label:'WRR',                desc:'Word Recognition Rate' },
  { key:'ooo_word_precision', label:'OOO Word Precision', desc:'Out-of-Order Word Precision' },
  { key:'ooo_word_recall',    label:'OOO Word Recall',    desc:'Out-of-Order Word Recall' },
  { key:'ooo_word_f1',        label:'OOO Word F1',        desc:'Out-of-Order Word F1' },
];

const MODEL_COLORS  = ['color-0','color-1','color-2','color-3'];
const MODEL_TXT_CLR = ['txt-color-0','txt-color-1','txt-color-2','txt-color-3'];

// ── State ────────────────────────────────────────────────────────────────
let appData = null;          // { gt_text, models: { name: { metrics, diff } } }
let modelNames = [];
let activeMetricModel = 0;
let activeDiffModel   = 0;
let modelSlotCounter  = 0;

// ═══════════════════════════════════════════════════════════════════════════
//  INPUT HANDLING
// ═══════════════════════════════════════════════════════════════════════════

function switchMode(mode) {
  document.getElementById('upload-mode').classList.toggle('hidden', mode !== 'upload');
  document.getElementById('paste-mode').classList.toggle('hidden',  mode !== 'paste');
  document.getElementById('mode-upload-btn').classList.toggle('active', mode === 'upload');
  document.getElementById('mode-paste-btn').classList.toggle('active',  mode === 'paste');
}

// ── Dynamic model slots (upload mode) ────────────────────────────────────
function addModelSlot() {
  modelSlotCounter++;
  const id = modelSlotCounter;
  const container = document.getElementById('model-slots');
  const slot = document.createElement('div');
  slot.className = 'model-slot';
  slot.id = `model-slot-${id}`;
  slot.innerHTML = `
    <input type="text" class="model-name-input" id="model-name-${id}" placeholder="Model name" value="Model ${id}" />
    <div class="file-drop" id="model-drop-${id}">
      <input type="file" accept=".txt" id="model-file-${id}" onchange="handleModelFile(${id})" />
      <span class="drop-text">Drop model output .txt</span>
      <span class="drop-status" id="model-drop-status-${id}"></span>
    </div>
    <button class="remove-slot-btn" onclick="removeModelSlot(${id})">✕</button>
  `;
  container.appendChild(slot);
  setupDropZone(`model-drop-${id}`, `model-file-${id}`);
}

function removeModelSlot(id) {
  const el = document.getElementById(`model-slot-${id}`);
  if (el) el.remove();
}

function setupDropZone(dropId, inputId) {
  const drop = document.getElementById(dropId);
  if (!drop) return;
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('dragover'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('dragover'));
  drop.addEventListener('drop', e => {
    e.preventDefault(); drop.classList.remove('dragover');
    const input = document.getElementById(inputId);
    if (e.dataTransfer.files.length) {
      input.files = e.dataTransfer.files;
      input.dispatchEvent(new Event('change'));
    }
  });
}

// GT file handler
document.addEventListener('DOMContentLoaded', () => {
  setupDropZone('gt-drop', 'gt-file-input');
  document.getElementById('gt-file-input').addEventListener('change', function() {
    const file = this.files[0];
    const status = document.getElementById('gt-drop-status');
    const drop   = document.getElementById('gt-drop');
    if (file) {
      status.textContent = `✓ ${file.name}`;
      drop.classList.add('loaded');
    }
  });

  // Start with one model slot
  addModelSlot();
  initTooltip();
});

function handleModelFile(id) {
  const input  = document.getElementById(`model-file-${id}`);
  const status = document.getElementById(`model-drop-status-${id}`);
  const drop   = document.getElementById(`model-drop-${id}`);
  if (input.files[0]) {
    status.textContent = `✓ ${input.files[0].name}`;
    drop.classList.add('loaded');
  }
}

// ── Read file as text helper ─────────────────────────────────────────────
function readFileText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file, 'utf-8');
  });
}

// ═══════════════════════════════════════════════════════════════════════════
//  EVALUATION ENTRY POINT
// ═══════════════════════════════════════════════════════════════════════════

async function runEvaluation() {
  const btn = document.getElementById('run-btn');
  btn.disabled = true;
  btn.textContent = '⏳ Computing…';

  try {
    const isUpload = !document.getElementById('upload-mode').classList.contains('hidden');
    let gtText = '';
    const models = {}; // { name: text }

    if (isUpload) {
      // Read GT
      const gtInput = document.getElementById('gt-file-input');
      if (!gtInput.files[0]) { alert('Please select a ground truth file.'); return; }
      gtText = (await readFileText(gtInput.files[0])).trim();

      // Read model files
      const slots = document.querySelectorAll('.model-slot');
      for (const slot of slots) {
        const id    = slot.id.replace('model-slot-', '');
        const name  = document.getElementById(`model-name-${id}`).value.trim() || `Model ${id}`;
        const fInput = document.getElementById(`model-file-${id}`);
        if (!fInput.files[0]) continue;
        models[name] = (await readFileText(fInput.files[0])).trim();
      }
    } else {
      // Paste mode
      gtText = document.getElementById('gt-paste').value.trim();
      const predText = document.getElementById('pred-paste').value.trim();
      const modelName = document.getElementById('paste-model-name').value.trim() || 'Model';
      if (!gtText || !predText) { alert('Please paste both ground truth and model output text.'); return; }
      models[modelName] = predText;
    }

    if (!gtText) { alert('Ground truth is empty.'); return; }
    if (Object.keys(models).length === 0) { alert('Please add at least one model output.'); return; }

    // Compute everything
    appData = { gt_text: gtText, models: {} };
    const gtWords = gtText.split(/\s+/).filter(Boolean);

    for (const [name, predText] of Object.entries(models)) {
      const predWords = predText.split(/\s+/).filter(Boolean);
      appData.models[name] = {
        metrics: computeMetrics(gtText, predText),
        diff:    buildWordDiff(gtWords, predWords),
      };
    }

    modelNames        = Object.keys(appData.models);
    activeMetricModel = 0;
    activeDiffModel   = 0;

    // Show results
    document.getElementById('results-area').classList.remove('hidden');
    buildModelTabs('model-tabs', idx => { activeMetricModel = idx; renderMetrics(); });
    buildModelTabs('diff-tabs',  idx => { activeDiffModel = idx; renderDiff(); });
    renderMetrics();
    renderCompareChart();
    renderGT();
    renderDiff();

    // Scroll to results
    document.getElementById('metrics-section').scrollIntoView({ behavior: 'smooth' });

  } finally {
    btn.disabled = false;
    btn.textContent = '▶ Run Evaluation';
  }
}


// ═══════════════════════════════════════════════════════════════════════════
//  METRIC COMPUTATION (pure JS — no backend)
// ═══════════════════════════════════════════════════════════════════════════

function editDistance(a, b) {
  const m = a.length, n = b.length;
  // Use two rows to save memory
  let prev = new Uint32Array(n + 1);
  let curr = new Uint32Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        curr[j] = prev[j - 1];
      } else {
        curr[j] = 1 + Math.min(prev[j], curr[j - 1], prev[j - 1]);
      }
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

function multisetIntersection(a, b) {
  const ca = new Map(), cb = new Map();
  for (const x of a) ca.set(x, (ca.get(x) || 0) + 1);
  for (const x of b) cb.set(x, (cb.get(x) || 0) + 1);
  let count = 0;
  for (const [k, v] of ca) count += Math.min(v, cb.get(k) || 0);
  return count;
}

function computeMetrics(gtText, predText) {
  const strip = s => s.replace(/\s+/g, '');
  const gtChars   = strip(gtText);
  const predChars = strip(predText);
  const gtWords   = gtText.split(/\s+/).filter(Boolean);
  const predWords = predText.split(/\s+/).filter(Boolean);

  const charED = editDistance(gtChars, predChars);
  const crr = gtChars.length ? Math.max(0, 1 - charED / gtChars.length) * 100 : 0;

  const wordED = editDistance(gtWords, predWords);
  const wrr = gtWords.length ? Math.max(0, 1 - wordED / gtWords.length) * 100 : 0;

  const wi = multisetIntersection(gtWords, predWords);
  const oooWP = predWords.length ? wi / predWords.length * 100 : 0;
  const oooWR = gtWords.length   ? wi / gtWords.length   * 100 : 0;
  const oooWF = (oooWP + oooWR) ? 2 * oooWP * oooWR / (oooWP + oooWR) : 0;

  return {
    crr: +crr.toFixed(2),
    wrr: +wrr.toFixed(2),
    ooo_word_precision: +oooWP.toFixed(2),
    ooo_word_recall:    +oooWR.toFixed(2),
    ooo_word_f1:        +oooWF.toFixed(2),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  WORD DIFF (simplified LCS-based differ)
// ═══════════════════════════════════════════════════════════════════════════

function buildWordDiff(gtWords, predWords) {
  // Use LCS to align the two word sequences
  const m = gtWords.length, n = predWords.length;

  // Build LCS length table
  const dp = [];
  for (let i = 0; i <= m; i++) {
    dp[i] = new Uint16Array(n + 1);
  }
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (gtWords[i - 1] === predWords[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to build opcodes
  const ops = []; // {tag, gtStart, gtEnd, predStart, predEnd}
  let i = m, j = n;
  const rawOps = [];
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && gtWords[i - 1] === predWords[j - 1]) {
      rawOps.push({ tag: 'equal', gi: i - 1, pi: j - 1 });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      rawOps.push({ tag: 'insert', gi: -1, pi: j - 1 });
      j--;
    } else {
      rawOps.push({ tag: 'delete', gi: i - 1, pi: -1 });
      i--;
    }
  }
  rawOps.reverse();

  // Group consecutive same-tag ops into blocks
  const grouped = [];
  for (const op of rawOps) {
    const last = grouped[grouped.length - 1];
    if (last && last.tag === op.tag) {
      if (op.gi >= 0) last.gIndices.push(op.gi);
      if (op.pi >= 0) last.pIndices.push(op.pi);
    } else {
      grouped.push({
        tag: op.tag,
        gIndices: op.gi >= 0 ? [op.gi] : [],
        pIndices: op.pi >= 0 ? [op.pi] : [],
      });
    }
  }

  // Merge adjacent delete+insert into "replace"
  const merged = [];
  for (let k = 0; k < grouped.length; k++) {
    const cur = grouped[k];
    const nxt = grouped[k + 1];
    if (cur.tag === 'delete' && nxt && nxt.tag === 'insert') {
      merged.push({ tag: 'replace', gIndices: cur.gIndices, pIndices: nxt.pIndices });
      k++; // skip next
    } else if (cur.tag === 'insert' && nxt && nxt.tag === 'delete') {
      merged.push({ tag: 'replace', gIndices: nxt.gIndices, pIndices: cur.pIndices });
      k++;
    } else {
      merged.push(cur);
    }
  }

  // Convert to tokens
  const tokens = [];
  for (const block of merged) {
    const gtSpan   = block.gIndices.map(i => gtWords[i]).join(' ');
    const predSpan = block.pIndices.map(i => predWords[i]).join(' ');

    switch (block.tag) {
      case 'equal':
        for (const pi of block.pIndices)
          tokens.push({ text: predWords[pi], type: 'correct', gt: predWords[pi] });
        break;
      case 'replace':
        tokens.push({ text: predSpan, type: 'wrong', gt: gtSpan });
        break;
      case 'delete':
        tokens.push({ text: gtSpan, type: 'missing', gt: gtSpan });
        break;
      case 'insert':
        tokens.push({ text: predSpan, type: 'extra', gt: '' });
        break;
    }
  }
  return tokens;
}


// ═══════════════════════════════════════════════════════════════════════════
//  RENDERING (same as before, but triggered after computation)
// ═══════════════════════════════════════════════════════════════════════════

function buildModelTabs(containerId, onSelect) {
  const wrap = document.getElementById(containerId);
  wrap.innerHTML = '';
  modelNames.forEach((name, i) => {
    const btn = document.createElement('button');
    btn.className = 'tab-btn' + (i === 0 ? ' active' : '');
    btn.textContent = name;
    btn.addEventListener('click', () => {
      wrap.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      onSelect(i);
    });
    wrap.appendChild(btn);
  });
}

function renderMetrics() {
  const grid = document.getElementById('metrics-grid');
  const name = modelNames[activeMetricModel];
  const m    = appData.models[name].metrics;
  grid.innerHTML = '';
  METRIC_META.forEach(({ key, desc }) => {
    const val  = m[key];
    const tier = val >= 75 ? 'high' : val >= 45 ? 'medium' : 'low';
    const card = document.createElement('div');
    card.className = 'metric-card';
    card.innerHTML = `
      <div class="metric-label">${desc}</div>
      <div class="metric-value ${tier}">${val.toFixed(1)}<span style="font-size:18px;font-weight:400">%</span></div>
      <div class="progress-track">
        <div class="progress-fill fill-${tier}" data-pct="${val}" style="width:0%"></div>
      </div>`;
    grid.appendChild(card);
  });
  setTimeout(() => {
    document.querySelectorAll('.progress-fill[data-pct]').forEach(el => { el.style.width = el.dataset.pct + '%'; });
  }, 40);
}

function renderCompareChart() {
  const wrap = document.getElementById('bar-chart');
  const legend = document.createElement('div');
  legend.className = 'chart-legend';
  modelNames.forEach((name, i) => {
    legend.innerHTML += `<div class="chart-legend-item"><div class="legend-dot ${MODEL_COLORS[i % 4]}"></div>${name}</div>`;
  });
  const table = document.createElement('table');
  table.className = 'chart-table';
  const thead = document.createElement('thead');
  const hrow  = document.createElement('tr');
  hrow.innerHTML = `<th>Metric</th>` + modelNames.map(n => `<th>${n}</th>`).join('');
  thead.appendChild(hrow);
  table.appendChild(thead);
  const tbody = document.createElement('tbody');
  METRIC_META.forEach(({ key, label }) => {
    const tr = document.createElement('tr');
    tr.className = 'chart-row';
    let html = `<td class="metric-name-cell">${label}</td>`;
    modelNames.forEach((name, i) => {
      const val  = appData.models[name].metrics[key];
      const clr  = MODEL_COLORS[i % 4];
      const tclr = MODEL_TXT_CLR[i % 4];
      html += `<td><div class="bar-wrap">
        <div class="bar-bg"><div class="bar-inner ${clr}" style="width:0%" data-pct="${val}"></div></div>
        <span class="bar-label ${tclr}">${val.toFixed(1)}%</span></div></td>`;
    });
    tr.innerHTML = html;
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  wrap.innerHTML = '';
  wrap.appendChild(legend);
  wrap.appendChild(table);
  setTimeout(() => {
    wrap.querySelectorAll('.bar-inner[data-pct]').forEach(el => { el.style.width = el.dataset.pct + '%'; });
  }, 80);
}

function renderGT() {
  document.getElementById('gt-text').textContent = appData.gt_text;
}

function renderDiff() {
  const name   = modelNames[activeDiffModel];
  const diff   = appData.models[name].diff;
  const header = document.getElementById('pred-panel-header');
  const predEl = document.getElementById('pred-text');
  header.textContent = name + ' Output';
  predEl.innerHTML = '';
  diff.forEach(tok => {
    const span = document.createElement('span');
    span.className = 'tok ' + tok.type;
    span.textContent = tok.text;
    if ((tok.type === 'wrong' || tok.type === 'missing') && tok.gt)
      span.dataset.gt = tok.gt;
    predEl.appendChild(span);
    predEl.appendChild(document.createTextNode(' '));
  });
}

// ── Tooltip ──────────────────────────────────────────────────────────────
function initTooltip() {
  const tooltip = document.getElementById('tooltip');
  document.addEventListener('mouseover', e => {
    const tok = e.target.closest('.tok.wrong, .tok.missing');
    if (!tok || !tok.dataset.gt) return;
    const lbl = tok.classList.contains('wrong') ? 'Expected (GT)' : 'Missing word (GT)';
    tooltip.innerHTML = `<span class="tooltip-label">${lbl}</span>${tok.dataset.gt}`;
    tooltip.classList.add('visible');
    posTooltip(e);
  });
  document.addEventListener('mousemove', e => { if (tooltip.classList.contains('visible')) posTooltip(e); });
  document.addEventListener('mouseout', e => {
    if (e.target.closest && e.target.closest('.tok.wrong, .tok.missing')) tooltip.classList.remove('visible');
  });
  document.addEventListener('scroll', () => tooltip.classList.remove('visible'), { passive: true });
}

function posTooltip(e) {
  const tt = document.getElementById('tooltip');
  const pad = 12;
  let x = e.clientX + pad, y = e.clientY + pad;
  const tw = tt.offsetWidth || 200, th = tt.offsetHeight || 60;
  if (x + tw > window.innerWidth - pad)  x = e.clientX - tw - pad;
  if (y + th > window.innerHeight - pad) y = e.clientY - th - pad;
  tt.style.left = x + 'px';
  tt.style.top  = y + 'px';
}
