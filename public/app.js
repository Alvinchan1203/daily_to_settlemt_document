// ===== 密碼保護 =====
let appPassword = sessionStorage.getItem('appPassword') || '';
let pendingTab = null;

// 攔截所有 /api 請求，自動加入密碼 header
const _origFetch = window.fetch.bind(window);
window.fetch = function(url, options = {}) {
  if (typeof url === 'string' && url.startsWith('/api') && appPassword) {
    options = { ...options, headers: { ...(options.headers || {}), 'X-App-Password': appPassword } };
  }
  return _origFetch(url, options);
};

function dismissLogin() {
  document.getElementById('loginOverlay').style.display = 'none';
  document.getElementById('loginError').textContent = '';
  document.getElementById('loginPassword').value = '';
  pendingTab = null;
}

async function doLogin() {
  const pwd = document.getElementById('loginPassword').value;
  if (!pwd) { document.getElementById('loginError').textContent = '請輸入密碼'; return; }
  try {
    const res = await _origFetch('/api/verify-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pwd })
    });
    if (res.ok) {
      appPassword = pwd;
      sessionStorage.setItem('appPassword', pwd);
      document.getElementById('loginOverlay').style.display = 'none';
      const target = pendingTab || 'input';
      pendingTab = null;
      switchTab(target);
      if (target === 'input') loadTodayRecords();
    } else {
      document.getElementById('loginError').textContent = '密碼錯誤，請重試';
      document.getElementById('loginPassword').value = '';
      document.getElementById('loginPassword').focus();
    }
  } catch {
    document.getElementById('loginError').textContent = '連線失敗，請重試';
  }
}

async function initApp() {
  if (appPassword) {
    const res = await _origFetch('/api/verify-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: appPassword })
    });
    if (res.ok) {
      switchTab('input');
      loadTodayRecords();
      return;
    }
    sessionStorage.removeItem('appPassword');
    appPassword = '';
  }
  // No stored password — stay on public calc tab (no login required)
}

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
const PRIVATE_TABS = new Set(['input', 'stats', 'calc']);

function switchTab(tab) {
  document.querySelectorAll('[data-tab]').forEach(l => l.classList.remove('active'));
  const link = document.querySelector(`[data-tab="${tab}"]`);
  if (link) link.classList.add('active');
  document.getElementById('tab-input').style.display = tab === 'input' ? 'block' : 'none';
  document.getElementById('tab-stats').style.display = tab === 'stats' ? 'block' : 'none';
  document.getElementById('tab-calc').style.display  = (tab === 'calc' || tab === 'calc-public') ? 'block' : 'none';
  calcIsPublic = tab === 'calc-public';
  if (calcResults) {
    document.getElementById('calcConfirmCard').style.display = calcIsPublic ? 'none' : '';
  }
  if (tab === 'stats') loadStats();
}

document.querySelectorAll('[data-tab]').forEach(link => {
  link.addEventListener('click', e => {
    e.preventDefault();
    const tab = e.currentTarget.dataset.tab;
    if (PRIVATE_TABS.has(tab) && !appPassword) {
      pendingTab = tab;
      const overlay = document.getElementById('loginOverlay');
      overlay.style.display = 'flex';
      setTimeout(() => document.getElementById('loginPassword').focus(), 100);
      return;
    }
    switchTab(tab);
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

  const count = Math.max(1, parseInt(document.getElementById('countInput').value) || 1);
  const total = accounts.length * count;
  const btn = document.getElementById('submitBtn');
  btn.disabled = true;
  showMsg(`登記中 (0/${total})...`, 'muted');

  try {
    showMsg(`登記中 (0/${total})...`, 'muted');
    const records = [];
    for (let c = 0; c < count; c++) {
      for (let i = 0; i < accounts.length; i++) {
        records.push({ '日期': date, '牛牛號': accounts[i], '業務類型': bizType.value });
      }
    }
    const res = await fetch('/api/records/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ records })
    });
    const data = await res.json();
    if (data.code !== 0) throw new Error(data.msg);

    const countMsg = count > 1 ? `（每人 ${count} 份）` : '';
    showMsg(`✓ 已登記 ${total} 筆${countMsg}`, 'success');
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
          <td style="padding:12px 8px;"><input type="checkbox" class="row-check" data-type="today" data-id="${r.record_id}" onchange="onCheckChange('today')"></td>
          <td>${r.fields['牛牛號'] || '-'}</td>
          <td><span class="biz-tag">${r.fields['業務類型'] || '-'}</span></td>
          <td><button class="btn-delete" onclick="deleteRecord('${r.record_id}')" title="刪除">✕</button></td>
        </tr>`).join('');
      resetCheckAll('today');
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

let allFeeRecords = [];

async function loadStats() {
  document.getElementById('statsLoading').style.display = 'block';
  document.getElementById('noData').style.display = 'none';
  document.getElementById('tableWrapper').style.display = 'none';
  document.getElementById('summaryCards').innerHTML = '';

  try {
    [allRecords, allFeeRecords] = await Promise.all([fetchAllRecords(), fetchAllFeeRecords()]);
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

  // 費用紀錄（同日期篩選）
  const feeRecords = allFeeRecords.filter(r => {
    if (!r.date) return false;
    if (currentFilter === 'today') return r.date === todayStr;
    const d = new Date(r.date);
    const now = new Date();
    if (currentFilter === 'month') return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    if (currentFilter === 'week') {
      const weekStart = new Date(now); const day = now.getDay() || 7;
      weekStart.setDate(now.getDate() - day + 1); weekStart.setHours(0,0,0,0);
      const weekEnd = new Date(weekStart); weekEnd.setDate(weekStart.getDate() + 6); weekEnd.setHours(23,59,59,999);
      return d >= weekStart && d <= weekEnd;
    }
    if (currentFilter === 'custom' && customRangeStart && customRangeEnd) return r.date >= customRangeStart && r.date <= customRangeEnd;
    return true;
  });
  if (feeRecords.length === 0) {
    document.getElementById('feeEmpty').style.display = 'block';
    document.getElementById('feeTableWrapper').style.display = 'none';
    document.getElementById('feeTableFoot').innerHTML = '';
  } else {
    document.getElementById('feeEmpty').style.display = 'none';
    document.getElementById('feeTableWrapper').style.display = 'block';
    const totalHkscc   = feeRecords.reduce((s, r) => s + Number(r.hkscc_fee), 0);
    const totalCompany = feeRecords.reduce((s, r) => s + Number(r.company_fee), 0);
    const totalGrand   = feeRecords.reduce((s, r) => s + Number(r.total_fee), 0);
    document.getElementById('feeTableFoot').innerHTML = `
      <tr>
        <td colspan="7" style="font-weight:600;">合計（${feeRecords.length} 筆）</td>
        <td style="text-align:right; font-weight:600;">HK$${totalHkscc.toFixed(2)}</td>
        <td style="text-align:right; font-weight:600;">HK$${totalCompany.toFixed(2)}</td>
        <td style="text-align:right; font-weight:600; color:var(--blue);">HK$${totalGrand.toFixed(2)}</td>
        <td></td>
      </tr>`;
    document.getElementById('feeTableBody').innerHTML = feeRecords.map(r => `
      <tr>
        <td style="padding:12px 8px;"><input type="checkbox" class="row-check" data-type="fee" data-id="${r.record_id}" onchange="onCheckChange('fee')"></td>
        <td>${r.date || '-'}</td>
        <td>${r.account || '-'}</td>
        <td>${r.stock_code || '-'}</td>
        <td>${r.lot_size ? r.lot_size.toLocaleString() : '-'}</td>
        <td>${r.total_shares ? r.total_shares.toLocaleString() : '-'}</td>
        <td><span class="biz-tag">${r.mode === 'split' ? '特別拆細' : '一般提取'}</span></td>
        <td style="text-align:right;">HK$${Number(r.hkscc_fee).toFixed(2)}</td>
        <td style="text-align:right;">HK$${Number(r.company_fee).toFixed(2)}</td>
        <td style="text-align:right; font-weight:600; color:var(--blue);">HK$${Number(r.total_fee).toFixed(2)}</td>
        <td><button class="btn-delete" onclick="deleteFeeRecord('${r.record_id}')" title="刪除">✕</button></td>
      </tr>`).join('');
    resetCheckAll('fee');
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
      <td style="padding:12px 8px;"><input type="checkbox" class="row-check" data-type="stats" data-id="${r.record_id}" onchange="onCheckChange('stats')"></td>
      <td>${r.fields['日期'] || '-'}</td>
      <td>${r.fields['牛牛號'] || '-'}</td>
      <td><span class="biz-tag">${r.fields['業務類型'] || '-'}</span></td>
      <td><button class="btn-delete" onclick="deleteRecord('${r.record_id}', 'stats')" title="刪除">✕</button></td>
    </tr>`).join('');
  resetCheckAll('stats');

  document.getElementById('tableFoot').innerHTML = `
    <tr>
      <td colspan="3">合計</td>
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

async function fetchAllFeeRecords() {
  const res = await fetch('/api/fee-records');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (data.code !== 0) throw new Error(data.msg || 'API 錯誤');
  return data.data.items || [];
}

initApp();

// ===== 收費計算器 =====
let calcIsPublic = true;
const CALC_HKSCC_PER_LOT = 3.50;
const CALC_CO_PER_LOT    = 1.50;
const CALC_SPLIT_ADMIN   = 100.00;
const CALC_FREE_CERTS    = 5;
const CALC_CO_MIN        = 500.00;
const CALC_FRAC_FEE      = 100.00;

let calcStocks  = [];
let calcResults = null;

function calcAddStock() {
  const id = Date.now() + calcStocks.length;
  calcStocks.push({ id, code: '', name: '', lotSize: null, mode: 'normal', shares: null, nCerts: null, certShares: [], dataDate: undefined });
  renderCalcStocks();
}

function calcRemoveStock(id) {
  calcStocks = calcStocks.filter(s => s.id !== id);
  if (calcStocks.length === 0) calcAddStock();
  else renderCalcStocks();
}

function renderCalcStocks() {
  const container = document.getElementById('calcStockList');
  const wrap = document.querySelector('.calc-wrap');
  container.innerHTML = '';
  const n = calcStocks.length;
  const cols = Math.min(n, 3);
  if (n > 1) {
    wrap.style.maxWidth = cols === 2 ? '1040px' : '1560px';
    container.style.display = 'grid';
    container.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    container.style.gap = '12px';
    container.style.marginBottom = '12px';
  } else {
    wrap.style.maxWidth = '620px';
    container.style.display = '';
    container.style.gridTemplateColumns = '';
    container.style.gap = '';
    container.style.marginBottom = '';
  }
  calcStocks.forEach((stock, idx) => {
    const div = document.createElement('div');
    div.className = 'card';
    div.style.marginBottom = n > 1 ? '0' : '12px';
    div.id = `calcStockCard_${stock.id}`;
    div.innerHTML = buildStockCardHTML(stock, idx);
    container.appendChild(div);
  });
}

function buildStockCardHTML(stock, idx) {
  let statusHtml = '';
  if (stock.dataDate !== undefined) {
    if (stock.dataDate === null) {
      statusHtml = `<span style="color:#FA8C16;">⚠ 數據更新日期未知，請手動確認每手股數</span>`;
    } else if (stock.dataDate !== todayStr) {
      statusHtml = `<span style="color:#FA8C16;">⚠ 數據更新日期：${stock.dataDate}（非今日），請手動確認每手股數</span>`;
    } else {
      statusHtml = `<span style="color:var(--green);">✓ 數據為今日（來源：HKEX）</span>`;
    }
  }
  const removeBtn = calcStocks.length > 1
    ? `<button class="btn-secondary" style="padding:4px 10px;font-size:12px;" onclick="calcRemoveStock(${stock.id})">移除</button>`
    : '';
  const sharesVal = stock.shares || '';
  const certsVal  = stock.nCerts || '';
  const normalPanel = `
    <div>
      <label class="form-label">提取股數</label>
      <div style="display:flex;align-items:center;gap:8px;max-width:220px;">
        <input id="calcShares_${stock.id}" type="number" class="form-input" placeholder="請輸入股數" min="1" value="${sharesVal}" oninput="calcUpdateField(${stock.id},'shares',this.value)" />
        <span style="color:var(--text2);white-space:nowrap;">股</span>
      </div>
    </div>`;
  const certFieldsHtml = stock.certShares.length > 0
    ? `<div class="calc-cert-scroll" style="margin-top:8px;">
        ${stock.certShares.map((s, i) => `
          <div class="calc-cert-row">
            <label>第${i+1}張：</label>
            <input id="calcCertInput_${stock.id}_${i}" type="number" class="form-input calc-cert-input" placeholder="股數" min="1" style="width:120px;"
              value="${s || ''}"
              oninput="calcUpdateCertShare(${stock.id},${i},this.value)"
              onkeydown="if(event.key==='Enter'){event.preventDefault();event.stopPropagation();var n=document.getElementById('calcCertInput_${stock.id}_${i+1}');if(n)n.focus();}" />
            <span style="color:var(--text3);font-size:13px;">股</span>
          </div>`).join('')}
      </div>
      <div id="calcCertTotal_${stock.id}" style="margin-top:8px;font-size:13px;color:var(--blue);font-weight:600;">${calcCertTotalText(stock)}</div>`
    : `<div id="calcCertTotal_${stock.id}"></div>`;
  const splitPanel = `
    <div>
      <div style="display:flex;gap:8px;align-items:flex-end;margin-bottom:8px;">
        <div>
          <label class="form-label">分拆張數</label>
          <div style="display:flex;align-items:center;gap:8px;">
            <input id="calcCerts_${stock.id}" type="number" class="form-input" style="width:100px;" placeholder="張數" min="1" value="${certsVal}"
              onkeydown="if(event.key==='Enter'){event.stopPropagation();calcGenCerts(${stock.id});}" />
            <span style="color:var(--text2);white-space:nowrap;">張</span>
          </div>
        </div>
        <button class="btn-secondary" onclick="calcGenCerts(${stock.id})">確認</button>
      </div>
      <div id="calcCertFields_${stock.id}">${certFieldsHtml}</div>
    </div>`;
  return `
    <div class="card-header">
      <span>股票 #${idx + 1}${stock.name ? `　${stock.name}` : ''}</span>
      ${removeBtn}
    </div>
    <div class="card-body">
      <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start;margin-bottom:12px;">
        <div>
          <label class="form-label">股票代號</label>
          <div style="display:flex;gap:6px;">
            <input id="calcCode_${stock.id}" type="text" class="form-input calc-code-input" style="width:110px;" placeholder="例：700" inputmode="numeric" value="${stock.code}"
              oninput="calcUpdateField(${stock.id},'code',this.value)"
              onkeydown="if(event.key==='Enter'){event.stopPropagation();calcLookupForStock(${stock.id});}" />
            <button class="btn-secondary" id="calcLookupBtn_${stock.id}" onclick="calcLookupForStock(${stock.id})">查詢每手</button>
            ${!calcIsPublic && idx === 0 ? `<button class="btn-secondary" id="updateLotsizeBtn" style="font-size:12px;" onclick="triggerLotsizeUpdate(this)">更新每手數據</button>` : ''}
          </div>
          ${!calcIsPublic && idx === 0 ? `<div id="updateLotsizeMsg" style="margin-top:4px;font-size:12px;"></div>` : ''}
          <div id="calcLookupStatus_${stock.id}" style="margin-top:4px;font-size:12px;">${statusHtml}</div>
        </div>
        <div>
          <label class="form-label">每手股數</label>
          <input id="calcLot_${stock.id}" type="number" class="form-input" style="width:150px;" placeholder="自動填入或手動" min="1" value="${stock.lotSize || ''}" oninput="calcUpdateField(${stock.id},'lotSize',this.value)" />
          <div style="margin-top:4px;font-size:12px;color:var(--text3);">如查詢失敗，請手動輸入</div>
        </div>
      </div>
      <div class="calc-mode-toggle" style="margin-bottom:12px;">
        <button class="calc-mode-btn ${stock.mode === 'normal' ? 'active' : ''}" onclick="calcSetStockMode(${stock.id},'normal')">一般提取</button>
        <button class="calc-mode-btn ${stock.mode === 'split' ? 'active' : ''}" onclick="calcSetStockMode(${stock.id},'split')">特別拆細提取</button>
      </div>
      ${stock.mode === 'normal' ? normalPanel : splitPanel}
    </div>`;
}

function calcCertTotalText(stock) {
  if (!stock.certShares || !stock.certShares.length) return '';
  const filled = stock.certShares.filter(s => s > 0);
  const total  = filled.reduce((a, b) => a + b, 0);
  return `已輸入 ${filled.length}/${stock.certShares.length} 張，總股數：${total.toLocaleString()} 股`;
}

function calcGenCerts(id) {
  const stock = calcStocks.find(s => s.id === id);
  if (!stock) return;
  const certsEl = document.getElementById(`calcCerts_${id}`);
  const n = certsEl ? parseInt(certsEl.value) : 0;
  if (!n || n < 1) { alert('請輸入有效張數（正整數）'); return; }
  stock.nCerts = n;
  const old = stock.certShares || [];
  stock.certShares = Array.from({ length: n }, (_, i) => old[i] || null);
  renderCertFields(id);
  const first = document.getElementById(`calcCertInput_${id}_0`);
  if (first) first.focus();
}

function renderCertFields(id) {
  const stock = calcStocks.find(s => s.id === id);
  if (!stock) return;
  const container = document.getElementById(`calcCertFields_${id}`);
  if (!container) return;
  container.innerHTML = `
    <div class="calc-cert-scroll" style="margin-top:8px;">
      ${stock.certShares.map((s, i) => `
        <div class="calc-cert-row">
          <label>第${i+1}張：</label>
          <input id="calcCertInput_${id}_${i}" type="number" class="form-input calc-cert-input" placeholder="股數" min="1" style="width:120px;"
            value="${s || ''}"
            oninput="calcUpdateCertShare(${id},${i},this.value)"
            onkeydown="if(event.key==='Enter'){event.preventDefault();event.stopPropagation();var n=document.getElementById('calcCertInput_${id}_${i+1}');if(n)n.focus();}" />
          <span style="color:var(--text3);font-size:13px;">股</span>
        </div>`).join('')}
    </div>
    <div id="calcCertTotal_${id}" style="margin-top:8px;font-size:13px;color:var(--blue);font-weight:600;">${calcCertTotalText(stock)}</div>`;
}

function calcUpdateCertShare(id, certIdx, value) {
  const stock = calcStocks.find(s => s.id === id);
  if (!stock) return;
  stock.certShares[certIdx] = value ? parseInt(value) : null;
  const totalEl = document.getElementById(`calcCertTotal_${id}`);
  if (totalEl) totalEl.textContent = calcCertTotalText(stock);
}

function calcToggleCertDetail(btn) {
  const detailEl = btn.closest('.calc-section-title').nextElementSibling;
  const show = detailEl.style.display === 'none';
  detailEl.style.display = show ? '' : 'none';
  btn.textContent = show ? '隱藏明細' : '顯示明細';
}

function calcUpdateField(id, field, value) {
  const stock = calcStocks.find(s => s.id === id);
  if (!stock) return;
  stock[field] = (field === 'lotSize' || field === 'shares' || field === 'nCerts') ? (value ? parseInt(value) : null) : value;
}

function calcSetStockMode(id, mode) {
  const stock = calcStocks.find(s => s.id === id);
  if (stock) { stock.mode = mode; renderCalcStocks(); }
}

async function triggerLotsizeUpdate(btn) {
  const msg = document.getElementById('updateLotsizeMsg');
  const orig = btn.textContent;
  btn.disabled = true;
  btn.textContent = '更新中…';
  if (msg) { msg.textContent = ''; }
  try {
    const res = await fetch('/api/trigger-lotsize-update', { method: 'POST' });
    const data = await res.json();
    if (data.code !== 0) throw new Error(data.msg);
    btn.textContent = '✓ 已觸發';
    if (msg) { msg.textContent = '已觸發 GitHub 更新，約1分鐘後數據刷新'; msg.style.color = 'var(--green)'; }
    setTimeout(() => { btn.textContent = orig; btn.disabled = false; if (msg) msg.textContent = ''; }, 8000);
  } catch (e) {
    btn.textContent = orig;
    btn.disabled = false;
    if (msg) { msg.textContent = '✗ ' + e.message; msg.style.color = 'var(--red)'; }
  }
}

async function calcLookupForStock(id) {
  const stock = calcStocks.find(s => s.id === id);
  if (!stock) return;
  const codeEl = document.getElementById(`calcCode_${id}`);
  const code = codeEl ? codeEl.value.trim() : stock.code;
  if (!code || !/^\d+$/.test(code)) { alert('請輸入有效股票代號（純數字）'); return; }
  stock.code = code;
  const btn    = document.getElementById(`calcLookupBtn_${id}`);
  const status = document.getElementById(`calcLookupStatus_${id}`);
  btn.disabled = true;
  btn.textContent = '查詢中…';
  status.innerHTML = '';
  try {
    const resp = await fetch(`/api/lotsize/${parseInt(code)}`);
    const data = await resp.json();
    if (data.lotSize) {
      stock.name     = data.stockName || '';
      stock.lotSize  = data.lotSize;
      stock.dataDate = data.updatedAt !== undefined ? data.updatedAt : null;
      document.getElementById(`calcLot_${id}`).value = data.lotSize;
      const header = document.querySelector(`#calcStockCard_${id} .card-header span`);
      if (header) header.textContent = `股票 #${calcStocks.indexOf(stock) + 1}　${stock.name}`;
      if (stock.dataDate === null) {
        status.innerHTML = `<span style="color:#FA8C16;">⚠ 數據更新日期未知，請手動確認每手股數</span>`;
      } else if (stock.dataDate !== todayStr) {
        status.innerHTML = `<span style="color:#FA8C16;">⚠ 數據更新日期：${stock.dataDate}（非今日），請手動確認每手股數</span>`;
      } else {
        status.innerHTML = `<span style="color:var(--green);">✓ 已自動填入（來源：${data.source}，數據為今日）</span>`;
      }
    } else {
      status.innerHTML = `<span style="color:#FA8C16;">⚠ ${data.error || '查詢失敗，請手動輸入'}</span>`;
    }
  } catch {
    status.innerHTML = '<span style="color:var(--red);">查詢失敗，請手動輸入</span>';
  } finally {
    btn.disabled = false;
    btn.textContent = '查詢每手';
  }
}

function calcSyncInputs() {
  for (const stock of calcStocks) {
    const codeEl = document.getElementById(`calcCode_${stock.id}`);
    const lotEl  = document.getElementById(`calcLot_${stock.id}`);
    if (codeEl) stock.code    = codeEl.value.trim();
    if (lotEl)  stock.lotSize = lotEl.value ? parseInt(lotEl.value) : null;
    if (stock.mode === 'normal') {
      const sharesEl = document.getElementById(`calcShares_${stock.id}`);
      if (sharesEl) stock.shares = sharesEl.value ? parseInt(sharesEl.value) : null;
    } else {
      const certsEl = document.getElementById(`calcCerts_${stock.id}`);
      if (certsEl && certsEl.value) stock.nCerts = parseInt(certsEl.value);
    }
  }
}

function calcRunAll() {
  calcSyncInputs();
  const results = [];
  for (let i = 0; i < calcStocks.length; i++) {
    const stock = calcStocks[i];
    if (!stock.lotSize || stock.lotSize < 1) { alert(`股票 #${i+1}：請輸入每手股數`); return; }
    if (stock.mode === 'normal') {
      if (!stock.shares || stock.shares < 1) { alert(`股票 #${i+1}：請輸入提取股數`); return; }
      const { lotSize, shares: total } = stock;
      const whole     = Math.floor(total / lotSize);
      const frac      = total % lotSize;
      const totalLots = whole + (frac > 0 ? 1 : 0);
      const hkscc     = totalLots * CALC_HKSCC_PER_LOT;
      const coBase    = totalLots * CALC_CO_PER_LOT;
      const fracFee   = frac > 0 ? CALC_FRAC_FEE : 0;
      const coRaw     = coBase + fracFee;
      const coFee     = Math.max(CALC_CO_MIN, coRaw);
      results.push({ stock, total, whole, frac, totalLots, hkscc, coBase, coRaw, coFee, fracFee, grand: hkscc + coFee, mode: 'normal' });
    } else {
      if (!stock.certShares || stock.certShares.length === 0) { alert(`股票 #${i+1}：請先輸入分拆張數並點擊「確認」`); return; }
      if (stock.certShares.some(s => !s || s < 1)) { alert(`股票 #${i+1}：請填入所有分拆張數的股數`); return; }
      const nCerts   = stock.certShares.length;
      const total    = stock.certShares.reduce((a, b) => a + b, 0);
      const lotSize  = stock.lotSize;
      const whole    = Math.floor(total / lotSize);
      const frac     = total % lotSize;
      const totalLots = whole + (frac > 0 ? 1 : 0);
      const hkscc    = totalLots * CALC_HKSCC_PER_LOT;
      const coPerLot = totalLots * CALC_CO_PER_LOT;
      const extra    = Math.max(0, nCerts - CALC_FREE_CERTS);
      const admin    = extra * CALC_SPLIT_ADMIN;
      const fracFee  = frac > 0 ? CALC_FRAC_FEE : 0;
      const coRaw    = coPerLot + admin + fracFee;
      const coFee    = Math.max(CALC_CO_MIN, coRaw);
      results.push({ stock, total, whole, frac, totalLots, hkscc, coRaw, coFee, fracFee, grand: hkscc + coFee, mode: 'split', nCerts, extra, admin, coPerLot, certShares: stock.certShares });
    }
  }
  calcResults = results;
  renderCalcResults(results);
}

function renderCalcResults(results) {
  const multi      = results.length > 1;
  const grandTotal = results.reduce((s, r) => s + r.grand, 0);
  const totalHkscc = results.reduce((s, r) => s + r.hkscc, 0);
  const totalCo    = results.reduce((s, r) => s + r.coFee, 0);
  let html = '';
  results.forEach((r, idx) => {
    const label    = r.stock.code ? `${r.stock.code}${r.stock.name ? ` ${r.stock.name}` : ''}` : `股票 #${idx+1}`;
    const prefix   = multi ? `股票 ${idx+1}：${label} — ` : '';
    const coPerLot = r.mode === 'split' ? r.coPerLot : r.coBase;

    if (r.mode === 'split' && r.certShares) {
      const certRows = r.certShares.map((s, i) =>
        `<tr><td>第 ${i+1} 張</td><td style="text-align:right;">${s.toLocaleString()} 股</td></tr>`
      ).join('');
      html += `<div class="calc-section">
        <div class="calc-section-title">${prefix}拆細明細
          <button class="calc-detail-toggle" onclick="calcToggleCertDetail(this)">顯示明細</button>
        </div>
        <div style="display:none; margin-bottom:8px;">
          <table class="calc-detail-table">${certRows}</table>
        </div>
        <div class="calc-row"><span>分拆總張數</span><span>${r.nCerts} 張</span></div>
        <div class="calc-row subtotal"><span>總提取股數</span><span>${r.total.toLocaleString()} 股</span></div>
      </div>`;
    }

    html += `<div class="calc-section">
      <div class="calc-section-title">${r.mode === 'split' ? '股票明細' : `${prefix}股票明細`}</div>
      ${r.mode === 'normal' ? `<div class="calc-row"><span>提取股數</span><span>${r.total.toLocaleString()} 股</span></div>` : ''}
      <div class="calc-row"><span>每手股數</span><span>${r.stock.lotSize.toLocaleString()} 股</span></div>
      <div class="calc-row"><span>整手數</span><span>${r.whole.toLocaleString()} 手</span></div>
      ${r.frac > 0 ? `<div class="calc-row"><span>碎股（作一手計）</span><span>${r.frac.toLocaleString()} 股</span></div>` : ''}
      <div class="calc-row subtotal"><span>HKSCC 收費手數</span><span>${r.totalLots.toLocaleString()} 手</span></div>
    </div>
    <div class="calc-section">
      <div class="calc-section-title">中央結算費用</div>
      <div class="calc-row"><span>${r.totalLots} 手 × HK$3.50</span><span>HK$${r.hkscc.toFixed(2)}</span></div>
    </div>
    <div class="calc-section">
      <div class="calc-section-title">富途證券手續費</div>
      <div class="calc-row"><span>每手費 ${r.totalLots} 手 × HK$1.50</span><span>HK$${coPerLot.toFixed(2)}</span></div>
      ${r.mode === 'split' && r.extra > 0 ? `<div class="calc-row"><span>拆細行政費 第6-${r.nCerts}張 × HK$100（共${r.extra}張）</span><span>HK$${r.admin.toFixed(2)}</span></div>` : ''}
      ${r.fracFee > 0 ? `<div class="calc-row"><span>碎股附加費</span><span>HK$100.00</span></div>` : ''}
      ${r.coFee > r.coRaw ? `<div class="calc-row adjusted"><span>↑ 適用最低收費 HK$500.00</span><span>HK$${r.coFee.toFixed(2)}</span></div>` : ''}
      <div class="calc-row subtotal"><span>富途證券手續費合計</span><span>HK$${r.coFee.toFixed(2)}</span></div>
    </div>`;

    if (multi) {
      html += `<div class="calc-total" style="font-size:14px;background:var(--bg2);color:var(--text1);"><span>小計（${label}）</span><span>HK$${r.grand.toFixed(2)}</span></div>`;
    }
  });
  if (multi) {
    html += `<div class="calc-section" style="margin-top:8px;">
      <div class="calc-section-title">各項費用合計</div>
      <div class="calc-row"><span>中央結算費用合計</span><span>HK$${totalHkscc.toFixed(2)}</span></div>
      <div class="calc-row"><span>富途證券手續費合計</span><span>HK$${totalCo.toFixed(2)}</span></div>
    </div>`;
  }
  html += `<div class="calc-total"><span>總費用</span><span>HK$${grandTotal.toFixed(2)}</span></div>`;
  document.getElementById('calcResultsContent').innerHTML = html;
  const card = document.getElementById('calcResultsCard');
  card.style.display = '';
  document.getElementById('calcConfirmCard').style.display = calcIsPublic ? 'none' : '';
  document.getElementById('calcConfirmDate').value = todayStr;
  document.getElementById('calcAccountInput').value = '';
  document.getElementById('calcConfirmMsg').textContent = '';
  card.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function calcCopyResults() {
  if (!calcResults) return;
  const lines = [];
  calcResults.forEach((r, idx) => {
    if (calcResults.length > 1) lines.push(`【股票 ${idx+1}：${r.stock.code}${r.stock.name ? ` ${r.stock.name}` : ''}】`);
    lines.push(r.mode === 'normal'
      ? calcBuildPlainNormal(r.total, r.stock.lotSize, r.whole, r.frac, r.totalLots, r.hkscc, r.coBase, r.coRaw, r.coFee, r.fracFee, r.grand)
      : calcBuildPlainSplit(r.total, r.stock.lotSize, r.whole, r.frac, r.totalLots, r.nCerts, r.extra, r.hkscc, r.coPerLot, r.admin, r.coRaw, r.coFee, r.fracFee, r.grand, r.certShares));
  });
  if (calcResults.length > 1) {
    lines.push('='.repeat(38), `總費用合計   : HK$${calcResults.reduce((s,r) => s+r.grand, 0).toFixed(2)}`, '='.repeat(38));
  }
  await navigator.clipboard.writeText(lines.join('\n\n')).catch(() => alert('複製失敗，請手動選取文字'));
  const btn = document.querySelector('#calcResultsCard .btn-secondary');
  const orig = btn.textContent;
  btn.textContent = '✓ 已複製';
  setTimeout(() => { btn.textContent = orig; }, 2000);
}

async function calcConfirmApply() {
  if (!calcResults || calcResults.length === 0) { alert('請先計算費用'); return; }
  const account = document.getElementById('calcAccountInput').value.trim();
  if (!account || !/^\d+$/.test(account)) { alert('請輸入有效牛牛號（純數字）'); return; }
  const btn = event.target;
  const msg = document.getElementById('calcConfirmMsg');
  btn.disabled = true;
  msg.textContent = '儲存中…';
  msg.style.color = 'var(--text3)';
  try {
    const date = document.getElementById('calcConfirmDate').value || todayStr;
    for (const r of calcResults) {
      const res = await fetch('/api/fee-records', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date, account,
          stock_code: r.stock.code || '',
          lot_size: r.stock.lotSize,
          mode: r.mode,
          total_shares: r.total,
          total_fee: r.grand,
          hkscc_fee: r.hkscc,
          company_fee: r.coFee
        })
      });
      const data = await res.json();
      if (data.code !== 0) throw new Error(data.msg);
    }
    msg.textContent = calcResults.length > 1 ? `✓ 已儲存 ${calcResults.length} 筆記錄` : '✓ 已儲存';
    msg.style.color = 'var(--green)';
    btn.disabled = false;
    setTimeout(() => { msg.textContent = ''; }, 3000);
  } catch (e) {
    msg.textContent = '✗ 儲存失敗：' + e.message;
    msg.style.color = 'var(--red)';
    btn.disabled = false;
  }
}

async function deleteFeeRecord(recordId) {
  if (!confirm('確認刪除此費用紀錄？')) return;
  try {
    const res = await fetch(`/api/fee-records/${recordId}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.code !== 0) throw new Error(data.msg);
    allFeeRecords = allFeeRecords.filter(r => r.record_id !== recordId);
    renderStats();
  } catch (e) {
    alert('刪除失敗：' + e.message);
  }
}

function calcClearAll() {
  calcStocks  = [];
  calcResults = null;
  calcAddStock();
  document.getElementById('calcResultsCard').style.display  = 'none';
  document.getElementById('calcConfirmCard').style.display  = 'none';
}

function calcBuildPlainNormal(total, lotSize, whole, frac, totalLots, hkscc, coBase, coRaw, coFee, fracFee, grand) {
  const lines = ['一般提取收費明細', '='.repeat(38),
    `提取股數     : ${total.toLocaleString()} 股`,
    `每手股數     : ${lotSize.toLocaleString()} 股`,
    `整手數       : ${whole.toLocaleString()} 手`,
  ];
  if (frac > 0) lines.push(`碎股（作一手）: ${frac.toLocaleString()} 股`);
  lines.push(`收費手數     : ${totalLots.toLocaleString()} 手`, '-'.repeat(38),
    `中央結算費用 : ${totalLots}手 × $3.50 = HK$${hkscc.toFixed(2)}`, '-'.repeat(38),
    `我司每手費   : ${totalLots}手 × $1.50 = HK$${coBase.toFixed(2)}`);
  if (fracFee > 0) lines.push(`碎股附加費   : HK$100.00`);
  if (coFee > coRaw) lines.push(`（適用最低收費）         = HK$${coFee.toFixed(2)}`);
  lines.push(`富途證券手續費合計 : HK$${coFee.toFixed(2)}`);
  lines.push('='.repeat(38), `總費用       : HK$${grand.toFixed(2)}`, '='.repeat(38));
  return lines.join('\n');
}

function calcBuildPlainSplit(total, lotSize, whole, frac, totalLots, nCerts, extra, hkscc, coPerLot, admin, coRaw, coFee, fracFee, grand, certShares) {
  const lines = ['特別拆細提取收費明細', '='.repeat(38)];
  if (certShares && certShares.length) {
    lines.push('拆細明細：');
    certShares.forEach((s, i) => lines.push(`  第${i+1}張 : ${s.toLocaleString()} 股`));
  }
  lines.push(`分拆總張數   : ${nCerts} 張`, `總提取股數   : ${total.toLocaleString()} 股`, '-'.repeat(38),
    `每手股數     : ${lotSize.toLocaleString()} 股`,
    `整手數       : ${whole.toLocaleString()} 手`);
  if (frac > 0) lines.push(`碎股（作一手）: ${frac.toLocaleString()} 股`);
  lines.push(`HKSCC收費手數: ${totalLots.toLocaleString()} 手`, '-'.repeat(38),
    `中央結算費用 : ${totalLots}手 × $3.50 = HK$${hkscc.toFixed(2)}`, '-'.repeat(38),
    `我司每手費   : ${totalLots}手 × $1.50 = HK$${coPerLot.toFixed(2)}`);
  if (extra > 0) lines.push(`拆細行政費   : ${extra}張 × $100 = HK$${admin.toFixed(2)}`);
  if (fracFee > 0) lines.push(`碎股附加費   : HK$100.00`);
  if (coFee > coRaw) lines.push(`（適用最低收費）         = HK$${coFee.toFixed(2)}`);
  lines.push(`富途證券手續費合計 : HK$${coFee.toFixed(2)}`);
  lines.push('='.repeat(38), `總費用       : HK$${grand.toFixed(2)}`, '='.repeat(38));
  return lines.join('\n');
}

// ===== 多選刪除 =====
function onCheckChange(type) {
  const all = [...document.querySelectorAll(`.row-check[data-type="${type}"]`)];
  const checked = all.filter(c => c.checked);
  const btn = document.getElementById(`${type}DeleteBtn`);
  const countEl = document.getElementById(`${type}SelectedCount`);
  if (btn) { btn.style.display = checked.length > 0 ? '' : 'none'; countEl.textContent = checked.length; }
  const checkAll = document.getElementById(`checkAll-${type}`);
  if (checkAll) {
    checkAll.checked = checked.length === all.length && all.length > 0;
    checkAll.indeterminate = checked.length > 0 && checked.length < all.length;
  }
  document.querySelectorAll(`.row-check[data-type="${type}"]`).forEach(c => {
    c.closest('tr').classList.toggle('row-selected', c.checked);
  });
}

function toggleCheckAll(type) {
  const checkAll = document.getElementById(`checkAll-${type}`);
  document.querySelectorAll(`.row-check[data-type="${type}"]`).forEach(c => { c.checked = checkAll.checked; });
  onCheckChange(type);
}

function resetCheckAll(type) {
  const checkAll = document.getElementById(`checkAll-${type}`);
  if (checkAll) { checkAll.checked = false; checkAll.indeterminate = false; }
  const btn = document.getElementById(`${type}DeleteBtn`);
  if (btn) btn.style.display = 'none';
}

async function deleteSelected(type) {
  const checked = [...document.querySelectorAll(`.row-check[data-type="${type}"]:checked`)];
  if (checked.length === 0) return;
  if (!confirm(`確認刪除 ${checked.length} 筆記錄？`)) return;
  const ids = checked.map(c => c.dataset.id);
  try {
    const endpoint = type === 'fee' ? '/api/fee-records/batch-delete' : '/api/records/batch-delete';
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids })
    });
    const data = await res.json();
    if (data.code !== 0) throw new Error(data.msg);
    if (type === 'today') loadTodayRecords();
    else loadStats();
  } catch (e) {
    alert('刪除失敗：' + e.message);
  }
}

document.addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  if (e.target.id === 'calcAccountInput' && !calcIsPublic) { calcConfirmApply(); return; }
  if (e.target.closest && e.target.closest('#tab-calc') && !e.target.classList.contains('calc-code-input')) calcRunAll();
});

calcAddStock();

document.getElementById('calcAccountInput').addEventListener('input', function () {
  const pos = this.selectionStart;
  const cleaned = this.value.replace(/\D/g, '');
  if (cleaned !== this.value) { this.value = cleaned; this.setSelectionRange(pos - 1, pos - 1); }
});
