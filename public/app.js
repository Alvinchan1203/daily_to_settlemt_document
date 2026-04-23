const FIELDS = [
  '存實貨',
  '提實貨',
  '提實貨簽收',
  '結單/賬戶證明扣款/審計',
  '銷戶未夠180日收費'
];

let allRecords = [];
let currentFilter = 'today';
let customRangeStart = null;
let customRangeEnd = null;

const todayStr = new Date().toLocaleDateString('sv-SE');
document.getElementById('dateInput').value = todayStr;

// 分頁切換
document.querySelectorAll('[data-tab]').forEach(link => {
  link.addEventListener('click', e => {
    e.preventDefault();
    const tab = e.currentTarget.dataset.tab;
    document.querySelectorAll('[data-tab]').forEach(l => l.classList.remove('active'));
    e.currentTarget.classList.add('active');
    document.getElementById('tab-input').style.display = tab === 'input' ? 'block' : 'none';
    document.getElementById('tab-stats').style.display = tab === 'stats' ? 'block' : 'none';
    document.getElementById('tab-calc').style.display  = tab === 'calc'  ? 'block' : 'none';
    if (tab === 'stats') loadStats();
  });
});

document.getElementById('dateInput').addEventListener('change', () => loadTodayRecords());

// 牛牛號只允許輸入數字
document.getElementById('accountInput').addEventListener('input', function () {
  const pos = this.selectionStart;
  const cleaned = this.value.replace(/[^\d\n]/g, '');
  if (cleaned !== this.value) {
    this.value = cleaned;
    this.setSelectionRange(pos - 1, pos - 1);
  }
});

// ===== 登記頁面 =====
async function submitRecord() {
  const date = document.getElementById('dateInput').value;
  const accounts = document.getElementById('accountInput').value
    .split('\n').map(s => s.trim()).filter(s => s.length > 0);
  const bizType = document.querySelector('input[name="bizType"]:checked');

  if (!date) { showMsg('請選擇日期', 'error'); return; }
  if (accounts.length === 0) { showMsg('請輸入牛牛號', 'error'); document.getElementById('accountInput').focus(); return; }
  if (!bizType) { showMsg('請選擇業務類型', 'error'); return; }

  const btn = document.getElementById('submitBtn');
  btn.disabled = true;
  showMsg(`登記中 (0/${accounts.length})...`, 'muted');

  try {
    for (let i = 0; i < accounts.length; i++) {
      showMsg(`登記中 (${i + 1}/${accounts.length})...`, 'muted');
      const res = await fetch('/api/records', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fields: { '日期': date, '牛牛號': accounts[i], '業務類型': bizType.value }
        })
      });
      const data = await res.json();
      if (data.code !== 0) throw new Error(data.msg);
    }

    showMsg(`✓ 已登記 ${accounts.length} 個賬戶！`, 'success');
    document.getElementById('accountInput').value = '';
    bizType.checked = false;
    document.getElementById('accountInput').focus();
    loadTodayRecords();
  } catch (e) {
    showMsg('✗ 失敗：' + e.message, 'error');
  }

  btn.disabled = false;
}

function showMsg(text, type) {
  const el = document.getElementById('submitMsg');
  el.textContent = text;
  const colors = { success: '#00C37A', error: '#F5222D', muted: '#9CA3AF' };
  el.style.color = colors[type] || '#9CA3AF';
  el.style.fontWeight = type === 'success' ? '600' : '400';
  if (type === 'success') setTimeout(() => { el.textContent = ''; }, 3000);
}

async function loadTodayRecords() {
  const date = document.getElementById('dateInput').value;
  document.getElementById('todayLoading').style.display = 'block';
  document.getElementById('todayEmpty').style.display = 'none';
  document.getElementById('todayTableWrapper').style.display = 'none';
  document.getElementById('updateNotice').style.display = 'none';

  document.getElementById('todayLabel').textContent = date === todayStr ? '今日記錄' : `${date} 的記錄`;

  try {
    const records = await fetchAllRecords();
    allRecords = records;
    const dayRecs = records.filter(r => r.fields['日期'] === date)
      .sort((a, b) => b.record_id.localeCompare(a.record_id));

    document.getElementById('todayCount').textContent = dayRecs.length;

    if (dayRecs.length === 0) {
      document.getElementById('todayEmpty').style.display = 'block';
    } else {
      document.getElementById('todayTableWrapper').style.display = 'block';
      document.getElementById('todayTableBody').innerHTML = dayRecs.map(r => `
        <tr>
          <td>${r.fields['牛牛號'] || '-'}</td>
          <td><span class="biz-tag">${r.fields['業務類型'] || '-'}</span></td>
          <td><button class="btn-delete" onclick="deleteRecord('${r.record_id}')" title="刪除">✕</button></td>
        </tr>`).join('');
    }
  } catch (e) {
    document.getElementById('todayEmpty').textContent = '載入失敗：' + e.message;
    document.getElementById('todayEmpty').style.display = 'block';
  }

  document.getElementById('todayLoading').style.display = 'none';
}

async function deleteRecord(recordId, source) {
  if (!confirm('確認刪除此記錄？')) return;
  try {
    const res = await fetch(`/api/records/${recordId}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.code !== 0) throw new Error(data.msg);
    if (source === 'stats') loadStats();
    else loadTodayRecords();
  } catch (e) {
    alert('刪除失敗：' + e.message);
  }
}

// ===== 統計頁面 =====
function filterStats(type) {
  currentFilter = type;
  ['today', 'week', 'month', 'custom'].forEach(t => {
    document.getElementById(`btn-${t}`).className =
      `filter-tab${t === type ? ' active' : ''}`;
  });
  const rangeInputs = document.getElementById('customRangeInputs');
  rangeInputs.style.display = type === 'custom' ? 'flex' : 'none';
  if (type !== 'custom') renderStats();
}

function applyCustomRange() {
  customRangeStart = document.getElementById('rangeStart').value;
  customRangeEnd = document.getElementById('rangeEnd').value;
  if (!customRangeStart || !customRangeEnd) { alert('請選擇開始和結束日期'); return; }
  if (customRangeStart > customRangeEnd) { alert('開始日期不能晚於結束日期'); return; }
  renderStats();
}

async function loadStats() {
  document.getElementById('statsLoading').style.display = 'block';
  document.getElementById('noData').style.display = 'none';
  document.getElementById('tableWrapper').style.display = 'none';
  document.getElementById('summaryCards').innerHTML = '';

  try {
    allRecords = await fetchAllRecords();
    renderStats();
  } catch (e) {
    document.getElementById('statsLoading').textContent = '載入失敗：' + e.message;
    return;
  }
  document.getElementById('statsLoading').style.display = 'none';
}

function getFilteredRecords() {
  const now = new Date();
  return allRecords
    .filter(r => {
      const dateStr = r.fields['日期'];
      if (!dateStr) return false;
      if (currentFilter === 'all') return true;
      if (currentFilter === 'today') return dateStr === todayStr;
      const d = new Date(dateStr);
      if (currentFilter === 'month') {
        return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
      }
      if (currentFilter === 'week') {
        const weekStart = new Date(now);
        const day = now.getDay() || 7;
        weekStart.setDate(now.getDate() - day + 1);
        weekStart.setHours(0, 0, 0, 0);
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekStart.getDate() + 6);
        weekEnd.setHours(23, 59, 59, 999);
        return d >= weekStart && d <= weekEnd;
      }
      if (currentFilter === 'custom' && customRangeStart && customRangeEnd) {
        return dateStr >= customRangeStart && dateStr <= customRangeEnd;
      }
      return true;
    })
    .sort((a, b) => (b.fields['日期'] || '').localeCompare(a.fields['日期'] || ''));
}

function renderStats() {
  const records = getFilteredRecords();

  const totals = {};
  FIELDS.forEach(f => { totals[f] = 0; });
  records.forEach(r => {
    const t = r.fields['業務類型'];
    if (t && totals[t] !== undefined) totals[t]++;
  });
  const grandTotal = records.length;

  document.getElementById('summaryCards').innerHTML = [
    ...FIELDS.map(f => `
      <div class="stat-card">
        <div class="stat-label">${f}</div>
        <div class="stat-num">${totals[f]}</div>
      </div>`),
    `<div class="stat-card total">
      <div class="stat-label">總計</div>
      <div class="stat-num">${grandTotal}</div>
    </div>`
  ].join('');

  // 報告格式（本日專用）
  const reportBox = document.getElementById('reportBox');
  if (currentFilter === 'today') {
    reportBox.style.display = 'block';
    document.getElementById('reportText').textContent = generateReport(records);
  } else {
    reportBox.style.display = 'none';
  }

  document.getElementById('statsLoading').style.display = 'none';

  if (records.length === 0) {
    document.getElementById('noData').style.display = 'block';
    document.getElementById('tableWrapper').style.display = 'none';
    return;
  }

  document.getElementById('noData').style.display = 'none';
  document.getElementById('tableWrapper').style.display = 'block';

  document.getElementById('tableBody').innerHTML = records.map(r => `
    <tr>
      <td>${r.fields['日期'] || '-'}</td>
      <td>${r.fields['牛牛號'] || '-'}</td>
      <td><span class="biz-tag">${r.fields['業務類型'] || '-'}</span></td>
      <td><button class="btn-delete" onclick="deleteRecord('${r.record_id}', 'stats')" title="刪除">✕</button></td>
    </tr>`).join('');

  document.getElementById('tableFoot').innerHTML = `
    <tr>
      <td colspan="2">合計</td>
      <td>${grandTotal} 筆</td>
      <td></td>
    </tr>`;
}

function generateReport(records) {
  const d = new Date();
  const dateStr = `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
  const lines = [dateStr, '*SETTLEMENT'];
  const sections = [];

  FIELDS.forEach(field => {
    const fieldRecords = records.filter(r => r.fields['業務類型'] === field);
    const count = fieldRecords.length;
    const countMap = {};
    fieldRecords.forEach(r => {
      const acc = r.fields['牛牛號'] || '';
      countMap[acc] = (countMap[acc] || 0) + 1;
    });
    const seen = new Set();
    const accountList = [];
    fieldRecords.forEach(r => {
      const acc = r.fields['牛牛號'] || '';
      if (!seen.has(acc)) {
        seen.add(acc);
        accountList.push(countMap[acc] > 1 ? `${acc} (${countMap[acc]}份)` : acc);
      }
    });

    lines.push(count === 0 ? `${field}:` : `${field}${count}: ${accountList.join(', ')}`);
  });

  return lines.join('\n');
}

async function copyReport() {
  const text = document.getElementById('reportText').textContent;
  await navigator.clipboard.writeText(text);
  const btn = event.target;
  const orig = btn.textContent;
  btn.textContent = '✓ 已複製';
  setTimeout(() => { btn.textContent = orig; }, 2000);
}

async function fetchAllRecords() {
  const res = await fetch('/api/records');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (data.code !== 0) throw new Error(data.msg || 'API 錯誤');
  return data.data.items || [];
}

loadTodayRecords();

// ===== 收費計算器 =====
const CALC_HKSCC_PER_LOT = 3.50;
const CALC_CO_PER_LOT    = 1.50;
const CALC_SPLIT_ADMIN   = 100.00;
const CALC_FREE_CERTS    = 5;
const CALC_CO_MIN        = 500.00;

let calcMode = 'normal';
let calcCertInputs = [];
let calcLastResult = '';

function calcSetMode(mode) {
  calcMode = mode;
  document.getElementById('calcNormalPanel').style.display = mode === 'normal' ? '' : 'none';
  document.getElementById('calcSplitPanel').style.display  = mode === 'split'  ? '' : 'none';
  document.getElementById('calc-btn-normal').classList.toggle('active', mode === 'normal');
  document.getElementById('calc-btn-split').classList.toggle('active',  mode === 'split');
  document.getElementById('calcResultCard').style.display = 'none';
}

function calcGenCertFields() {
  const n = parseInt(document.getElementById('calcNumCerts').value);
  if (!n || n < 1) { alert('請輸入有效張數（正整數）'); return; }
  const list = document.getElementById('calcCertList');
  list.innerHTML = '';
  calcCertInputs = [];
  for (let i = 0; i < n; i++) {
    const row = document.createElement('div');
    row.className = 'calc-cert-row';
    row.innerHTML = `<label>第${i+1}張：</label>
      <input type="number" class="form-input" placeholder="股數" min="1" style="width:120px;" />
      <span style="color:var(--text3);font-size:13px;">股</span>`;
    list.appendChild(row);
    const inp = row.querySelector('input');
    inp.addEventListener('input', calcUpdateSplitTotal);
    calcCertInputs.push(inp);
  }
  list.style.display = '';
  calcUpdateSplitTotal();
}

function calcUpdateSplitTotal() {
  let total = 0, filled = 0;
  for (const inp of calcCertInputs) {
    if (inp.value.trim()) {
      const v = parseInt(inp.value);
      if (!v || v < 1) {
        document.getElementById('calcSplitTotal').innerHTML = '<span style="color:var(--red);">⚠ 輸入有誤</span>';
        return;
      }
      total += v; filled++;
    }
  }
  const el = document.getElementById('calcSplitTotal');
  el.textContent = calcCertInputs.length
    ? `已輸入 ${filled}/${calcCertInputs.length} 張，總股數：${total.toLocaleString()} 股`
    : '';
}

function calcGetLotSize() {
  const v = parseInt(document.getElementById('calcLotSize').value);
  if (!v || v < 1) { alert('請輸入每手股數'); return null; }
  return v;
}

function calcRun() {
  const lotSize = calcGetLotSize();
  if (!lotSize) return;
  calcMode === 'normal' ? calcNormal(lotSize) : calcSplitCalc(lotSize);
}

function calcNormal(lotSize) {
  const total = parseInt(document.getElementById('calcTotalShares').value);
  if (!total || total < 1) { alert('請輸入有效股數'); return; }
  const whole     = Math.floor(total / lotSize);
  const frac      = total % lotSize;
  const totalLots = whole + (frac > 0 ? 1 : 0);
  const hkscc     = totalLots * CALC_HKSCC_PER_LOT;
  const coRaw     = totalLots * CALC_CO_PER_LOT;
  const coFee     = Math.max(CALC_CO_MIN, coRaw);
  const grand     = hkscc + coFee;
  let html = `<div class="calc-section">
    <div class="calc-section-title">股票明細</div>
    <div class="calc-row"><span>提取股數</span><span>${total.toLocaleString()} 股</span></div>
    <div class="calc-row"><span>每手股數</span><span>${lotSize.toLocaleString()} 股</span></div>
    <div class="calc-row"><span>整手數</span><span>${whole.toLocaleString()} 手</span></div>
    ${frac > 0 ? `<div class="calc-row"><span>碎股（作一手計）</span><span>${frac.toLocaleString()} 股</span></div>` : ''}
    <div class="calc-row subtotal"><span>收費手數</span><span>${totalLots.toLocaleString()} 手</span></div>
  </div>
  <div class="calc-section">
    <div class="calc-section-title">中央結算費用</div>
    <div class="calc-row"><span>${totalLots} 手 × HK$3.50</span><span>HK$${hkscc.toFixed(2)}</span></div>
  </div>
  <div class="calc-section">
    <div class="calc-section-title">我司費用</div>
    <div class="calc-row"><span>每手費 ${totalLots} 手 × HK$1.50</span><span>HK$${coRaw.toFixed(2)}</span></div>
    ${coFee > coRaw ? `<div class="calc-row adjusted"><span>↑ 適用最低收費 HK$500.00</span><span>HK$${coFee.toFixed(2)}</span></div>` : ''}
    <div class="calc-row subtotal"><span>我司費用合計</span><span>HK$${coFee.toFixed(2)}</span></div>
  </div>
  <div class="calc-total"><span>總費用</span><span>HK$${grand.toFixed(2)}</span></div>`;
  calcLastResult = calcBuildPlainNormal(total, lotSize, whole, frac, totalLots, hkscc, coRaw, coFee, grand);
  calcShowResult('一般提取', html);
}

function calcSplitCalc(lotSize) {
  if (calcCertInputs.length === 0) { alert('請先設定分拆張數'); return; }
  const sharesList = [];
  for (let i = 0; i < calcCertInputs.length; i++) {
    const v = parseInt(calcCertInputs[i].value);
    if (!v || v < 1) { alert(`第 ${i+1} 張股數輸入有誤`); return; }
    sharesList.push(v);
  }
  const total     = sharesList.reduce((a, b) => a + b, 0);
  const nCerts    = sharesList.length;
  const whole     = Math.floor(total / lotSize);
  const frac      = total % lotSize;
  const totalLots = whole + (frac > 0 ? 1 : 0);
  const hkscc     = totalLots * CALC_HKSCC_PER_LOT;
  const coPerLot  = totalLots * CALC_CO_PER_LOT;
  const extra     = Math.max(0, nCerts - CALC_FREE_CERTS);
  const admin     = extra * CALC_SPLIT_ADMIN;
  const coRaw     = coPerLot + admin;
  const coFee     = Math.max(CALC_CO_MIN, coRaw);
  const grand     = hkscc + coFee;
  const certRows  = sharesList.map((s, i) =>
    `<tr><td>第 ${i+1} 張</td><td style="text-align:right;">${s.toLocaleString()} 股</td></tr>`
  ).join('');
  let html = `<div class="calc-section">
    <div class="calc-section-title">拆細明細
      <button class="calc-detail-toggle" onclick="calcToggleCertDetail()">顯示明細</button>
    </div>
    <div id="calcCertDetail" style="display:none; margin-bottom:8px;">
      <table class="calc-detail-table">${certRows}</table>
    </div>
    <div class="calc-row"><span>分拆總張數</span><span>${nCerts} 張</span></div>
    <div class="calc-row subtotal"><span>總提取股數</span><span>${total.toLocaleString()} 股</span></div>
  </div>
  <div class="calc-section">
    <div class="calc-section-title">股票明細</div>
    <div class="calc-row"><span>每手股數</span><span>${lotSize.toLocaleString()} 股</span></div>
    <div class="calc-row"><span>整手數</span><span>${whole.toLocaleString()} 手</span></div>
    ${frac > 0 ? `<div class="calc-row"><span>碎股（作一手計）</span><span>${frac.toLocaleString()} 股</span></div>` : ''}
    <div class="calc-row subtotal"><span>HKSCC 收費手數</span><span>${totalLots.toLocaleString()} 手</span></div>
  </div>
  <div class="calc-section">
    <div class="calc-section-title">中央結算費用</div>
    <div class="calc-row"><span>${totalLots} 手 × HK$3.50</span><span>HK$${hkscc.toFixed(2)}</span></div>
  </div>
  <div class="calc-section">
    <div class="calc-section-title">我司費用</div>
    <div class="calc-row"><span>每手費 ${totalLots} 手 × HK$1.50</span><span>HK$${coPerLot.toFixed(2)}</span></div>
    ${extra > 0 ? `<div class="calc-row"><span>拆細行政費 第6-${nCerts}張 × HK$100（共${extra}張）</span><span>HK$${admin.toFixed(2)}</span></div>` : ''}
    ${coFee > coRaw ? `<div class="calc-row adjusted"><span>↑ 適用最低收費 HK$500.00</span><span>HK$${coFee.toFixed(2)}</span></div>` : ''}
    <div class="calc-row subtotal"><span>我司費用合計</span><span>HK$${coFee.toFixed(2)}</span></div>
  </div>
  <div class="calc-total"><span>總費用</span><span>HK$${grand.toFixed(2)}</span></div>`;
  calcLastResult = calcBuildPlainSplit(sharesList, total, lotSize, whole, frac, totalLots, nCerts, extra, hkscc, coPerLot, admin, coRaw, coFee, grand);
  calcShowResult('特別拆細提取', html);
}

function calcShowResult(title, html) {
  document.getElementById('calcResultTitle').textContent = title;
  document.getElementById('calcResultContent').innerHTML = html;
  const card = document.getElementById('calcResultCard');
  card.style.display = '';
  card.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function calcToggleCertDetail() {
  const el = document.getElementById('calcCertDetail');
  const btn = document.querySelector('.calc-detail-toggle');
  const show = el.style.display === 'none';
  el.style.display = show ? '' : 'none';
  btn.textContent = show ? '隱藏明細' : '顯示明細';
}

async function calcCopyResult() {
  await navigator.clipboard.writeText(calcLastResult).catch(() => alert('複製失敗，請手動選取文字'));
  const btn = document.querySelector('#calcResultCard .btn-secondary');
  const orig = btn.textContent;
  btn.textContent = '✓ 已複製';
  setTimeout(() => { btn.textContent = orig; }, 2000);
}

async function calcLookupLotSize() {
  const code = document.getElementById('calcStockCode').value.trim();
  if (!code || !/^\d+$/.test(code)) { alert('請輸入有效股票代號（純數字）'); return; }
  const btn    = document.getElementById('calcLookupBtn');
  const status = document.getElementById('calcLookupStatus');
  btn.disabled = true;
  btn.textContent = '查詢中…';
  status.innerHTML = '';
  try {
    const resp = await fetch(`/api/lotsize/${parseInt(code)}`);
    const data = await resp.json();
    if (data.lotSize) {
      document.getElementById('calcLotSize').value = data.lotSize;
      status.innerHTML = `<span style="color:var(--green);">✓ 已自動填入（來源：${data.source}）</span>`;
    } else {
      status.innerHTML = `<span style="color:#FA8C16;">⚠ ${data.error || '查詢失敗，請手動輸入'}</span>`;
    }
  } catch {
    status.innerHTML = '<span style="color:var(--red);">查詢失敗，請手動輸入</span>';
  } finally {
    btn.disabled = false;
    btn.textContent = '查詢每手股數';
  }
}

function calcClearAll() {
  ['calcStockCode', 'calcLotSize', 'calcTotalShares', 'calcNumCerts'].forEach(id => {
    document.getElementById(id).value = '';
  });
  document.getElementById('calcLookupStatus').innerHTML = '';
  const cl = document.getElementById('calcCertList');
  cl.innerHTML = '';
  cl.style.display = 'none';
  document.getElementById('calcSplitTotal').textContent = '';
  document.getElementById('calcResultCard').style.display = 'none';
  calcCertInputs = [];
  calcLastResult = '';
}

function calcBuildPlainNormal(total, lotSize, whole, frac, totalLots, hkscc, coRaw, coFee, grand) {
  const lines = ['一般提取收費明細', '='.repeat(38),
    `提取股數     : ${total.toLocaleString()} 股`,
    `每手股數     : ${lotSize.toLocaleString()} 股`,
    `整手數       : ${whole.toLocaleString()} 手`,
  ];
  if (frac > 0) lines.push(`碎股（作一手）: ${frac.toLocaleString()} 股`);
  lines.push(`收費手數     : ${totalLots.toLocaleString()} 手`, '-'.repeat(38),
    `中央結算費用 : ${totalLots}手 × $3.50 = HK$${hkscc.toFixed(2)}`, '-'.repeat(38),
    `我司每手費   : ${totalLots}手 × $1.50 = HK$${coRaw.toFixed(2)}`);
  if (coFee > coRaw) lines.push(`（適用最低收費）         = HK$${coFee.toFixed(2)}`);
  lines.push(`我司費用合計 : HK$${coFee.toFixed(2)}`, '='.repeat(38),
    `總費用       : HK$${grand.toFixed(2)}`, '='.repeat(38));
  return lines.join('\n');
}

function calcBuildPlainSplit(sharesList, total, lotSize, whole, frac, totalLots, nCerts, extra, hkscc, coPerLot, admin, coRaw, coFee, grand) {
  const lines = ['特別拆細提取收費明細', '='.repeat(38), '拆細明細：'];
  sharesList.forEach((s, i) => lines.push(`  第${i+1}張 : ${s.toLocaleString()} 股`));
  lines.push(`分拆總張數   : ${nCerts} 張`, `總提取股數   : ${total.toLocaleString()} 股`, '-'.repeat(38),
    `每手股數     : ${lotSize.toLocaleString()} 股`,
    `整手數       : ${whole.toLocaleString()} 手`);
  if (frac > 0) lines.push(`碎股（作一手）: ${frac.toLocaleString()} 股`);
  lines.push(`HKSCC收費手數: ${totalLots.toLocaleString()} 手`, '-'.repeat(38),
    `中央結算費用 : ${totalLots}手 × $3.50 = HK$${hkscc.toFixed(2)}`, '-'.repeat(38),
    `我司每手費   : ${totalLots}手 × $1.50 = HK$${coPerLot.toFixed(2)}`);
  if (extra > 0) lines.push(`拆細行政費   : ${extra}張 × $100 = HK$${admin.toFixed(2)}`);
  if (coFee > coRaw) lines.push(`（適用最低收費）         = HK$${coFee.toFixed(2)}`);
  lines.push(`我司費用合計 : HK$${coFee.toFixed(2)}`, '='.repeat(38),
    `總費用       : HK$${grand.toFixed(2)}`, '='.repeat(38));
  return lines.join('\n');
}

document.addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  if (e.target.id === 'calcStockCode') { calcLookupLotSize(); return; }
  if (e.target.closest && e.target.closest('#tab-calc') && e.target.id !== 'calcNumCerts') calcRun();
});
