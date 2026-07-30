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
  // No stored password — initialize on public calc tab
  switchTab('calc-public');
}

const FIELDS = [
  '存實貨',
  '提實貨',
  '提實貨簽收',
  '結單/賬戶證明扣款/審計',
  '銷戶未夠180日收費',
  '銷A'
];

const REPORT_FIELDS = FIELDS.filter(f => f !== '銷A');

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
  if (tab === 'calc' || tab === 'calc-public') {
    renderCalcStocks();
  }
  const helpBtn = document.getElementById('calcHelpBtn');
  if (helpBtn) helpBtn.style.display = calcIsPublic ? '' : 'none';
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

  REPORT_FIELDS.forEach(field => {
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

// ===== 收費計算器 =====
let calcIsPublic = true;
const CALC_HKSCC_PER_LOT = 3.50;
const CALC_CO_PER_LOT    = 1.50;
const CALC_SPLIT_ADMIN   = 100.00;
const CALC_FREE_CERTS    = 5;
const CALC_CO_MIN        = 500.00;
const CALC_FRAC_FEE      = 100.00;
const FUTU_LOGO_B64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAREAAAAyCAYAAAB72++iAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAADwDSURBVHhe7Z1nlFTHkueZ92Z2PuzMnjlvn2bmy86eszt6ckDjEd6DMMII7733CCO8bxAI74SXkMEJbwTCCSchhHASIGi89423QrHxi6zsri6qqquhG2nnKDlx7qXr3rx582b8M1xGZrp9/4lMWH1TXut4RjJVO650UjK9c0Tp8O+TqmrbtI1/V/24tfn9pYly+soj+aP8Uf4ov03JNG7ldak+6rK81OysA5GqCcqsv3MQ0TYCIi81OyelBl2WKWsS5WLi48Ar/Xbll19+kcePH8uTJ0/sHPr11yeBX/8of5QXUxh/Dx8+lDt37xrdv/9AHj3KOP7I9J9tjstfGqr0Uf2UgsgxZdRDTzPu7460jbS1xjn5U00FkoFn5NvD95VhA2/1gsu9e/fk2LFjsv2bb2XT15tl27ZvZOvW7bJly1Y93y579uyVixcv2cfN6PKrdgJA9ujRIztCDsyerXMeB4AxBemAjJlC7k2PPvBgndZ6uQ/m4nvFQnfv3lMGvG/1+8I5f/PXPHjwQOv9/UwUdxU0fv75sI3D1V+uMVr71XrZtWu3JF5PDFyVviWTU2EgZUpm+Xd+DmHY3yNpG5GYaqj0VCdRMnc+KUu/uy0PH/82KHLgwEEZN36i1GvQWKrVqC216tQ3qlmzjlTX/7do0Vo+/vgTOXPmTOCOjCkAxfXr13UQ/azAtUf27t0n+/bvlx9//ElOnTptwBJrgVkuXrwoP/50QOvZK/v3/yj79u1/JuLevfv2yf4ff5SEhKNy48bNwFPSXm7fvi1Hjx6zNtn7BeoHxGGgSAUAOXv2nHz//S7ZuHGTrF+/wY6htGnT10acf/XVOpsQTp06ZX0HYCQkJMjXX3+t96+Xdev09+3fyLHjx+WeAsvvoZw+fVrGjp0gdes2kCrVajqqWlP69O1v/ZQRRUHkRECFATyeAUCqviB66tnYRhT8al2SzJ1Oyrxtt+Xew9hABGa7qQP55MlTcvjwYWO6w4ePpJkYuPuVSWfN+kiqVa8lr72RVV5/I5u8+lqWJHrt9Tg9ZpXaCioACddz35EjCWHrjE6HjY7roL127ZrOvr8E3sgVmHPr1m0yauQY6d27n/Tu01+pn/TtN1Def/8D+WLREnvu48cp7wstzLTf7tghkyZNln79B0rPXr2tvvfe6yXdur8nXbv2kG7d3ouJuvfoKb169Q20Y4AMGTJMVqxYJVev0v60zeC379yWXT/8IBMmTg68nxLHvgNk6NDh8vnceXLw4CFj9tBy584dWbDwC+nQobM0a9ZKmjRtoceW0lSPEOfNm7eSli3bSdu2HaVN2/bSqnVb6arvsGjRYjl37pxNAnM++VTad+ggrVu3s987d+kqY8aOl6/Wrbe+PXr0aMrvpVIBAH7z1q2I78t4pH2nT5+Rnwy0FXCV4Q8d+lkuXb5sABhr4Z6WrdrY2MuSNYcRY7JS5aqyefPWwFWxFdpkY1zBH7BmMuIdL126lEI6y/Rc9o8qSpWVKin4VAzQ2+lM1FlZ6annAyIKgLUuSJZOJ2Te1lty90Fsg5IO2LFjpzLJFBk+fIQMiR8u8XrkPF7PhwyNl8FD4u0YjUaMGCkDBw2W+g2bSp68BRVE4vSDxSlwZE0i+79SXPZcCjQ1pI8y9siRH4StL5iSnq9MN2zY+65tehymx7Hjxss6nUmZlYPLhQsXZfbsj6V06fKSI2ceicuWS7LG5ZRs2XPreW4pX76yjB49zqSBSCI4A5qBA3jkL1AocK+rJ3uOPJI7TwHJ+2bBAHEeidw1OXLls/uzZOX+3JJd+6FJkxayZs1XcksZKy3l6tWrBgSVq1a398kWaBf1x2XLKaVKl5NB2m8M9lDGS0xMlOHvj5ACBYvJm/kKKRXUb5bcXs5z5MyndeaWNzJnlzeyZJesWm9evXbQ4KGye/ce+eGH3QYqWeJy2HNhUPqnaNFS0lylTcbR+++PTPp+g/U+aPyESfLdzu9NlQpXAJfLVy7LqtVfSv8BAxWoe0jP3n1k0KB4mTtvvjLuER2zsUmRSMUtWraWV17NbGMPAlCQjL9RdTvWglSHFDZmzDjppWDdo0dvlWYGyIcfTpedO3faROOLgkgoc8ZAXjKAyd86JJlKHZRMJZSKH5BMxdKZSiiV1WcAWCkkkmQQietyQhZsvxWzJEIHTJ8+U8qUKS/Fi5eRosVKSzElBkPBgsXlzfyFdWDpQAscI1HBgkVskGU2tOeDZdMBmM2Onuz/DEr7e1Zlwvx2X7S6g59foEAxKVK0hLaxlFExbW/JUm/pgH1fZ8fzgTdyJTHxhs6UnxmgwbTJgOaADKpUuZrMmDnbZr1wJfHGDVmxcpVUrVbLmMm/x6taT778hRQIa0tTnbUbNWku9Ro2kQYRiN8b6wxfToHrFR3EtIU+gLJlzyP9VDo6ceJk4KmxFYyEy5avkJKl39L3y2V1Jb1fALDLlK0gE3VyQOUJLsyqS5Ysk+7de6qk0UFatWprkkTr1u2lXbuOKoW0lMqVq0uu3PkC/RYnmRVIeEbv3v1l164fdOL5Tlq1aZ/0Hn6igEmzxuUKfK/kbwtY5ctX2MbV9BmzVJK6E2hNyuIlkU8+/UxKlSqr9xY0sCtWrKS8U62GTFTJ68KFC4Gro5c9e/YpSDe3NiEB8x60rWXLtrJbVdxYCpIck2zfvoN0QipnbSmgY7aQjsN3FUS3btuWQtpLG4jAxDBzhQB4KP03lUJeqpUg/7fxMcnc8pjEtTomWdOBsrU+LnGtj8nLTY/JX+skyD9gr0HqSWrPs4MIBrFhw0bIK69k0cGQQwlmUcQ2RimsA7+SVKxYxWbu8hVSoYqVpWKlqsacUOUw5H6rKhWVKlTSesPVE0z63AoV3PMLFipuTMxgcIM3uw2Ojh27qFpzIvBGrqDefPPtDmnQqElgkLt3cmpVVmUK3jWb1FF9GZ0/XDmkqt2gQUONGXjuK6/qYNR7CxQuLn369ZelS5eb0W79ho2y9qt1JsaHElLSBv1946avZerUGVKlSvVAu5PVPP72tdYTLBanVpTXTNzv2KmLAlGuALO794P8+72jALh8+UpjTl+Y7TFuoyps347Re4upfhi+v/lmh6xbt8HUJGxY1MV7U3fOnG+qFDjSpDckHNQX/7y/vfKGzfhIJEw+jJsKftzwDfUc4vt/+tlcA8Fo5cs1a+z78w4OwLJbG2rWRorYEZOHBYN+jZp1Am10IAKY9ezZR35W9SqWcvnyFVXRJtjkmtQWJaRppOEEVdmCJb20gQgAgvShksGfVc3494ZHpXDv09JkwgUZNP+qTFp9XWZ8lSjT1z4/zVp/Q2asS5QhC67J20POKZAcdRJJkmrzfJLIaBXT4lQkpZON2bTTc+sM3r59Z/3gn+ustUQWLPhCFi1eEpG+UF2Z4+IlS2XJ0mWydNnyiMTvzITB90UinrvYjgt1FuyjkkjJwKB2bX3t9SwqXvYKO5Ojr85SlQZjmpckXtXrGYwMCKhEydKm54crgACD0EBVByH94gZyPTM43rlz12YhiH6MRP4abAOoisWKl7Z6fH35CxSVKR9Ok/PnU0pTqRVUoEWLF0vDRk1NjeF9fJ3+/QoXKS4ffTTnKRsEoMLgB7iCvVcw5w2VwFZ/+aU0adYi0E4nZeTMldfUkStXrpjRsmfPXva85L7JYt+nR/eeMnfufBsL8+cvNJqnhPq1YuVqOaoqYmo2INTI+Hj6qkwSQHKEmWfO/EguKQhGK7wT4Ik0lvwOcVJW/4/qfv5CbH2NPaaZqme+X91YyKKTZRVZrSpX6HvEBiLVlLB7lFWVRaWPf62XIBUHn5Xhi67Jil13ZEfCfUm48EjOJz6Wyzd/kUvpQFdu/SKXlQ6cfSgjl1yXvzU7puqSPp92mFrzfCAyQQdGLtXX3WBwAwKd+kMd2Hglbt68KXdVxGTQMfjouIwmP8iRlGAWjKfz5y+Qd3TWNjB4zTF2VtXJe/XqZ4bh0PJE78eQN3feAuncuaupH2XKlpfSqrpxLK+zJQZEJIXQAiPB2Lly50/qEwhG6tW7b8widXBhYCOxNGjYOIVUhL2htaoVzJzBEkMshXagcmHwrVOngUkAvB+2ICSAxo2byQplJvo01vLLL49VVVpuXg3aaUyolDdfQTOI8x63bt2UofHDFKicVOUYNYuULVdRr5ljY4Zvh60qmADTWN8RiQM10Pc9z8DuwuSGShWtXL+eKNOmzZSCKjW6iZH2xUm9eo1N0vo1hv7Arf3FF4vtnVB/fRvyq4Q+UCXU0zq2Qkt0EPE2CGZ/pI/yh+RvLY9L22mXZMX3d+T67ditxs9a7j58InO33FLV5rhkKnrAGVrTAUTGj5+oIPKmdbSXRMqWqyCffT4viaGZffC5I8ZisIpKB2OkcPcGCFEd78J5ZZJHATH/q6/Wm6sYUd0PDMRLxNNoNgWMeHv37leJY4nM/uhjmTnrI/MiffLJZ+a6BCiDC8/7XgcpwOMGsGOQNzLHmecJ6elZA+cuaz8ijWAL8YOS2a1YidKm7kRzzUYqfJ9D+m1W6iz/8ZxPTfqaOXO2vt/nsmbNWjkfYi+iAND37903gIbhPZPfU8Y5duy4fDBqjJQsVSYZRLQPSpYqKytWrEy6f/KUD80o697DjRtsHlOnTTcQZmwBJLwTUhtMybcIBTTaz7V4fRhfewOuamw+9Rs2sXp9X3EsoX01SttHzBHXhbrQISTd9qrm5gxMjqhaHGvUqGN99P2uXUnXBt8P0Qb+vpg6FLC8o8C3gXccMHCIqaqEDXAt6vTVK1djABFUGJU+/lT+Z3ldGXmgqi2HzjyUOzF6Qp633Lz/RD7eeFOytFIQKaaSSAaBCB3FTM0MzmC5ffuOLFRRFIMUenL9+o3s42YkoTIwi06fMVPOBcR8ZhAGgdOPHYjQVtyt4SSR4MLgxe2LVwOXKoR0A+PwjsHl2vXrxojYbvzA5YgXolu3HjYLpmVmDy64lD/7bK6UKlXO6gyuH5dxqBE01kIgnJfYeLcrOqCvXbtufwu1tfC+9Bd2kFWrVhkwfEkg1tqvZNPGr619GIxz5MwbaFucvK7tQ9LBbuKLeYe0j1CbuAY1E8mwffuOskzVVmxN61QlXLt2nda/1rxQ27ZvT/qevtCXuIzxpjXSb44dpyFjQCcMZn3a4PvIH2FkvCz1GjRU6aKh1K3XwMiPTexM3Mu1f3vF22xUTc9TwL4r13JfWArUyUQaDPb+iDSEtEf7oAYNmsj7I0bJ6lVfpgIi3ohaRiWQFsfM7vHzufBuqowqqDXT1t6Q11UCMnUmnUAkWJ3xIEInASKInxjhBiryguZOfHUdmnHkdHqO7Tt2loOHfraBj9RQXSUBb1ylnRCxF6HeGUTuU6q3Y7vABvOlzsgbggKoIOrD7kEcCB4az2wYDru82928E649zGJZJHPW7Aak2BiW6yy5fNkKYxaI/xPzEUrLUlyz0lyXuKpRN7Ah+HfmPQDIlaqawPiRCt8L28qGDZtk2dLlsnjxUlkeAAFAFtUMQy/vyhHpDXWH69DhkTKuXL5idooWLdoYMNRRZuRYt24jadKoudSoVc/sNLSLb05f5wsYJJESfQEQMOzi7uaav72S2Zi1cOFiFgvUoEFjqV27vtSCtE77W6Omsli/x30dV74AIoePHJFeffrb814P2HY4d+SMu/7c91e4ccg1tMPf69rkzt3v7prQ+8KR/z541Fx9gfrt3P2ftjIeMdBPmTItFRBR6QM15q91E6TNtIsvHEAotzJIEhk9erzExeWygeAYNKsZHD/59HMDEWbvOSoCNmnSUiorwhsC166bocRMwoeZNOlDs2sAIjABfzeQUZUGNYDBPnbcRElMTBn5efPmLWPY5i1aSSllWLxGqCJIUp6cx6CydOna3WwVuBZ5DgxY5Z0a1g9usLhZ7G96ZCZDSiunenKyfaWCGdqqvFM9JWlbK1SobNfQBnRrbBZFi5Y0Q7ar2xHPKlK0uAweMkSOJCQE3uLp4r8FUpqrt1xSG5g5wxFSD6oJbSRADIZl4ihWsoy5UBHX8wYopwInKqK9b8DjwrjA5fu5qreXLl0OtMRFhGKkLKDfgPZ7EOEevDR4QvCoFShY1L4TR2wU06bPTOHiRZ05q6rMrNkfqXRR12xVuHOr16ilY6C+ky6CCCmhtl7HNZ4AYMYNUgz9y/MBANrjQYE2MH4tglol3eD7w1ENHSM8v64+L/j5/B8eqFq9tvUp1zExLF+xIhUQUQnkT2//LOUGnZEVP/w2YeX3Hj2ReZvT1yaCzjpy5Gh5TRkTAHFejDgb0PjzUQOY1fEcYKPAtoDOmNGE+xG7yJkzZ7WN922gMfPi9qOdWZQJaWerVu1UBN+sbUwpsiPSw2x4Qrjex2cEk8WL6OCvWq2mLPxikUkAeHQmTf7QvABc45k8mGxg6vFVZTQ/QPk7sS8p6te6/e/uGk8p6/IDHemrZu065jaOVDCkjhg5UgoWLJb0nOBnhCPawXWv6HMI4CKSE5fykPh46di5q7Rt11G6dutuYIoo76SQ5LbT5nbtOun3SBm4xrjYsH6jgmU1u57r3PWZbfx00rpHfjDaGGzAwMFmRxgxcpRs3/6NjavgwmRFSP3Ond/buqtvv91hsSg7v//ewvNT0K5ddh2/cx2EioltgvUxHTu/a3E8rv8dQOfOk88CxVDZCJSDuD8afffdzrDP59n8xjW0dYeeA8yXL1+OACKoMTDrW4fkpQZHJX7RNfOUxFpu3H1inprTV5+dzl3/Remx7Dv1UIYvui4v450hoC1dvDMPZOLEKWYgc7EF2U3nY4b+VCWRUH36tyyoD7hrc+R8U0qVKWuqBfo84nlowdZBVCJRm7V01sGzwEBPVoOyKLMUtjU+Y8aNl9179trA3qGqDaHSXkSHIWAM9GtE8Q4duyhDdTCmaqvH9h06WlQkUomrN/kZBNNVqVrdgK5T5+T7iK/gGQBidtW5PaBwD7M66tKtmzcNOENLYmKirFq12iI4O3fuZtSlSyr0bjd5VwlD8bz5C+SiAuV1rQdj7I7vlBGUqQm+wkg4cdJklV4qBkDQxeOUVEmGNgUDiC+XLly0COIiRUsF+tdRpcpVzAB95uxZUw8PHjpkhC0GQ264d0uPgsEem4wZQwNtIdiwtkopGzdtCvsO6VmeBhEYlKCucofk75Vh8/c8LUt3pQyvDld+efKrXLv9RHYcuS9zN9+Uyauuy+ilAVp2XcakkSasTJSJWkffz65K2UFn5S91EqxNyQFnzw4iDx8+MsMX6zqaNGupTNVEB3hbGTo03oxohITT8Xx8DGWrV68xi/8aRfQv10BrDf1RHfxKyWcl6qNe6uc56PgHVPqhjQw60J+w63YdOtuMtnnzFmOqcIXrmSkx2AGGDCKiFWEMN1u+YWLpSmVImAq9nOvnfPyJSSFuFnazMQMRQyP2ExgC8ut9MIT+sHu3ufy8DYVnIP2gPk2dNsNmyJMnT5p3i/tOnDihM9oPBt6VVM2ifv8cwtd79uproeXhjLf8DS/HxYuXTc1j9uYdoxH2HohFd3hNfL30EeeekEo/nDrdojJpD+/AhALg8U28FweJDeIczw+xPKie/h2gEqoqffb5XLvmRRWWOhCWgDrzegDI8agxIfJ3VMGMLuFBhNm+1EF5qXaCNJ14UXYdT32F4o+nH8gHyvwVh56VnO1OSObmx+Q1lR6MOE8jvdHC0f9pfFT+UvuI/D3tQkJKauuzgwgDiai8nw4cMLfmt99+J7tU1GPBFKtg+R33LkZW4hsIAUf8R/dklkXH9BGqz0vYEJA0IJ6Dnou94/BhFso9tvYwe7IKloV3sbpDSUPA6uHs2fPqwPIgktlmLCIOfUHH79t3gA08rvEzK4Ny3LgJ5vkIVx48fGB6PiK0YyTCq3Oa3QJwDBXdKahfqGxdVYUIZj4GP/1AsFZqq2EBd5tZ9RtFIw8S0QqTBcDVUSUb2u6NiqzDwWPCGiVc4qiISCUQ58SNfPDBGANMbEb+XbKrtIj0hWT3IgpxIZ9+Otf6DrUS9Zy2ENfTp28/VcWTDcIZWcKDCKqMqg4vNzkmQxdelaMXIxtUVQCRn848lAFzr0hmjJ+EwwevfWE9zfNQSaV0XjsTSzmhsyixDXwcb9CEUWzQ63n2HG+azskxrcTsjXqSOUtO/egwkhejnW2GFaIsfsIA/KyF+1uqyhEKIngWfHwJsyweC0LzfZg1ywBYjdyseUvz5gCo4Uo0EEFSe/Qo/JjBkDtNJRX6ALUBddI9O5u8q+BCZGeo+A1wEh+xZMlSM5JCH8/5JCrB7HatHrerdMkq2tBCPwyNH26uUw9oXhLDmIxhGCMua5VKqpRhpOd4mfgtm6p/Fg0MAwfuRV2Mjx9mRtPUio/oxQ2MN40YEVTVUDKvWOA3pFVsHF+tW2dGWSTLYI8XbSCSF/WRqOc1a9ea9wuy+vSYJFmHEC5p4m78M/3zQ8m3FfsI0np4ECG0XRk4S6tjljXs/PXIKwiv3HoiI1QCAUD+XEqZHTdsBT36FbjpQams4k1vEIFxjqv4Pez9kTYreSZkoGB9x1Les1cfFeeH2PJ2cjWkhTC4MfvD0OXKVzTm9mDCc9q172Bq1fOAiJdEEM19vXgS2iGJJLi4DNzBGAAJs86RI68BW85c+aVo8dIm4iMqRyq4K1FbgkEEUGQGJ3wcNSlSwR6BbQUvRs5cAKt7NgBEHEfoe2P4ZREa647y5C1kuj9MHp3yJ13Xr19/mxSCCwyM+xlpkHgQZnGMpLwH3zx7zrySO3d+a1co4c0BBAERrgUIPQMzRnDJs6wgkhTnC9Iw4exE2WKfI3wetfIpUpAjMI/FeXieUFXKl69ghlxiVLzh2rXBnVOfgaDew/3B9RFARyi8rfGpUMmt11JiLJr3S3/necH3BBO2Mo4sZlz4xeIoIKJSBB4R1sJcvhne0Mhq8p0JD+Tt+LPy57J6D4ZP7Ba+nvSk0HZmMIgw6EaMHG2DnMHhGMXlBSFACC8K16BisOYhLQRAkcjmW0VywATXpx+AEHEiGEifB0SwnRDeHgoibZR5UdsoRMYSyThgwGAZrGACxce/b5LCkYRklSdS+ejjOUmBUTwDSaSZPhM7SrSCZMG74xEaPGSo2Xz6DxgkEyZOMqs/gX7BBQ8AIFJWBznPyJo1p7nno1HWbC6XBsFj1H3yVMrAPFapYjBm1s6sUtCrrxLaXdTyirAAEXDt33+QrTYOR331NwzYGHvx8CCx8A2xqQDILVq0MkCMVojzIXUA/YcE6gAgiPi//S2zvBzwZjmvFgbpYOnD3/OGSZN8Cx8nkqK+ANDwux9rrwTigVwdycZunpP0fPstmWgrRIAbK8JjAJEbth4mXCHJM3k84jqcdBII94XWB6GKYBANRynsHGmhjAURBt3IUWOeAhE8G/PmLTTjnouUvGr2k7SQiyC9ajYZclAwkH39EBJKRoIISZgoMDNG3K+/3mKG5rUqVm/YuNFcehhCz5+/YIbJUGLwowqMGj3OZnrXdiSRHCZes4CR3yPdT8j96TNnDDDMqKwiNyL6dzt36t+dezu40E5cjKgpY8eOt8xdEyZMjkpkmmOR5aTJU8xDcUNVNwoSEirEAAWWAqp60G76qEzZigYcW7duNcMp34n3jEQX9N0u6XtwLe75yR9OVammqkkoMBjR0IANBuZI3j7sXUhDJHkiHwkpCpDQzKOlEiOu6K7deti6pe7d35PadRuYhEF/ezIgUMbHhtW4STOLAH733R42EVGXp/YdOtu4atq0pUkcSFAAnhvbbnwDHKSbYNxQz3vv9bYARO+d83XhIeyg9U9VaZW1T6mCyPS1N2xBXLhyIfGxTFp1XV5rTgxHcCBYEAESGGqpk+jXUOKeZwKSjJdEho8cZQz+mi1804+mHwwxj2X4BC6xFoVZm85MC82YMcvuI0kOkk3wwjQGBB8MkT9DQEQHKm5HCoMbMCTyk/YQfUicDO2jncz+ocxJoNVklSBGjx5r7l8fQObaz3qYMtJBByvLCqgv9H5oypSpJsbPmDHb1px8OHWarXshdcAVBdcnGNqCivOi3DcvS3L4/vWo5MLgrxij4oHxRlbiRUaM+MDsGzARfY4do1v3nub6xWZDv/zyOExu2RDy1/Cd6NOx4yZY0Bj9AJAQezJAVV4iXsPZlrD9XLuWqNLsSQM2vFgE3eH9AsSJFwKIAWS+J3XhAfLSgicC6/DcMfE4KfeEHNa6ftY6OUIJWid/B9TmL1hoqqNTw5JBhHpxHPDtsHfgqub5eLmQoDHIUxeGfo6ouwB8qiBCyHkkECGeAxfuq01Do0mDqJISKg4GVwykEOdGeg//90ASem9UyjgQofAxhg4bYZ2bOXPAsKpEhwMsLDfHllC0aAkpoudpIdNR9T4SGvl6OXrDKqHZ4WwDaSnRQATpgwLDkGsUV3dSHgx043IVLUlT4cLFU1CRIiWs3bSfwC/sBq5eF7EJZVZVI4++V9FiJFIqbfeEq6dkybcsktXr49gmSP6zZ+9eefQwpT0F/gNEAAcCzyCkgGiEqgaxngYvDCACc44fP8mMo66vXah5ocLFbGL46ONPZNHipZb7wxtwSRQUSv43iDU38xd8YRnIkGScjcsF0cGkBQoV18lipIHXs5QbiYlmHxs3foLZ4nwsiAs9j5OqVWvKRJ3QqD+1tJe+IEFjzMWQzThmfPgxQuwLMT6ouWRUi6U8N4iMAUSaKYikWNeiFJBA/rHGEfmPFsclR9dTkq/nKXnzvVOStwfnpyWvnr/c5oT8c+0E+TuuT5N6k7EgQm7L2R/NsRBfA4tAZjEzLoUYqp6VvCHN10+kaanSb1m8CiJyNONkaiW6JOIGNPEmWPCbt2ylzy9p7SmsDM6RNsHoLnxcSc9dO2l3CSlYqJi5Ej2IeMJTgQpYSJnHvyf3Ugd1QcV1NuXvPKswIGz9UEratOnowDNEnbl167Z5ipCCSA8JYUuIRv66UaPGqlT3rQEPQWe40QmqI/NYrtxvWt+gkuFxAdQwOubPX8TUhjykTSREPiy53wiUQzrF2Mn9LoAxu/UBaRcBE94VV3Fq3xNphXgYVN2TJ0+YcXyyqmPkTsmd500FDWdzATzyK4hjxMbdfCqVhZjhCm0hMpVUjrQdg7GBUwBYsfH07Nnb4mEYi6hwZM4L9w7PBSJnFETGLlMQQZ0JBpEAgCCB/O/mx6Trx5ctG/uG/Xdl3b67snbPXTtfr+fDFl2TPN1OyT/y7PIqleCJiUkiyVgQYYUoMzbJfz9UUX/adGimiv0zTdRHVH9eIl8lHg5Tb7R+lsUzKBAlcb8+T4lVnSF0mSQ/iOLkX+WIysF7oq5BGJJRPWgvqQcnTJps4nP9ho3M0OmkEGd0gzExuLGsgH6arKrLjJmzrA6I+qZPn2VGVWe3GC+jxuhzx06wpeznzp6TJ1jsgwoi9ciRIy2qtFDhEkZ4dlIjf91Ibevu3btllKpgMEzNmvWkS5fu0qRJM2svUklWS3GJWO9Us8xZspnnA0AIT24RGgZO3h/GxpBLvA1AwopZYkZY8Zs/fyEDM1SrSAUGPXjwZ5UMN1kfYQdhHQ2SK5IvYAQhCdMPMD+2nkuXn30rEjxUqCnE55CgGs/Xa6+79+J9yDsLuDKOSJYEoJBf9ayqWUixXkXLGBBBoqCOMgclZ9eTsmLX7af0XF++PXJfao06L/9SXe8pHUElCksZCyK+PFTkvXX7ti2e8vkhIhG/R6Jw1wcT9RPpyIdNjxJdnUkOQkIvv3rtqtlG0L3Rwy9fumyLzjCCEnXK3yFiAnALnzl7xvTjD0aNttmYunkGMxlqEGtHiFRl9kefJu/EiePH7RmnTp+y/CJIQYCDq/+EzaYwWSiAUPDOYDshdyuL4lB9KlZKjUhZWdWux37FGhgyzBHFiTGTuAgY0a03SfZWsBq3Vas25qVChSDHCO8TTADC6DFjTU1B9EeScfc7tRRJtW/f/hYZvFgBGgAkxgU1ItQ2gt2B+Awyxnd/r3cgL20lC1s3cFOQzqzHPHnzSfXqtS3H6ZxPPjejPGMzPQqSDwsweS8iuFH3eA/UMdeObKZGIcW179DJVrczmRBNDZhkLIi8dVDyqwrz9U+Royz3nnwgTSdekH+tpaBQUuvgvhcEIjAQjEtg0JEjRy0HJYYtGIQwbxgHMY7BHgthaMLzEEr8Pdz1kSjYkEV7aBdu2TNnzphxMTQYK1yJFURCC4Mc0PzpwEFVIbZY6gA8N+QkpQ1+Jeqv+o9gp2AXL4xE8muMpN6eg4GTthDsxKphktqwZgeGinXTpwcPH5rRkYG+dNkKWbKUlJMrohJSDYzLmhsAhH5DRQWoEMnpXyQUDyLewIjdgYAqgItETRgOGSPBdPfeXbn/4L5cT7xuaQ+QbugD7ncgUsIy9DOGkPa8HQcDbzCI0A6ie5HcsC9lUYmD2BOXVT+/ts0lea5WrYb06tXH0i2SAze9wCO0YHPaouokEdOtWrU3WxWrkFn1nJOYGYuLIRt+NgPO4SM+sPGZcepMAESwgaC6RCp7TjyQxhMuyEseRF6gJMLAWrd+o7yvncGiLlxZuLQ6delqLiz+j7sMN1tqhHWfvKeIocGBZayiJDCtu/4W7r5Q4nm49nDHEXXoXGzOPTdoyFBbkMe6l9TKs4IISYzYMa1bj57mOapRq44RMxCzKt4TypNfn5gnJznYzDEhIDJr1mxlEOfWxBuAexKrf43a9WxhILMdqs4ZlXRiLUiyMB0GViQ3GDIawfwQYAbohkoAgEj8sOFm3A4GEbaz2LJ5a0xATdm8ZaulQPD3AyIYK4cMiddnHA9c5cA5VO3A6ItXjBQUSBzcB+OyJocFhGPGjrMFfXhdaC8qT0YXAIqJDEPtpk2b5SNVQQcNGiKtWrexJRkEoqEC5lKQY1uLzVs2ZzyI5OlxStbsCZ8qn7Lr2H1pMO68/M+aCgpsPfECQeSsipKIqxiRyGaNlwQREqYwPd9mFz2PQm4GClyn95hxMSAaO8biOqdn++tD6whP7h7aQz0MTmYFQCkWS/+zggjLy0mxZ2K09gn9gq5PJCOpA3wU5m1V0bBr+LgFDyIYTqep6uFjPVibQn4T+patNRCR0bkrVqxqYvx9ZfjUCuDBt0KCwUgKEazGcngYDHc4fyM/qS2TD/zG3xG5UcOCDYIwNMGCMIfzdiSDCK7Pdes2mpieWkGSQjpiLVUwiJA/hAA+0khEK0hpJE7CS8KaJly42KTwErG4k0WOpE+8c/uOgSELAJEWkJKIdoVQO5+XfF2kOkTN5N1RqzFoHzl8xMYS355JY8TID3TC7GEBdmTg2/HdjhckifwYRZ05hSRyXv7qQYT7XhCIoK4QzUicAC4z58J1jI645r0L0QjLPMQsgrfCM5Orx8V9ENhDzIC/Nlw9oUR4vQchDyJsk0ByYxaxpVaeBUQePnpoLkvexTMExL0EPxEf4GdTVB6MpuFBZIZJAxQyxBHZin2Cuty7ZLNkQMRrsC1lagUVhNgGAqaQiqrrjMhsTQYxEumY7UMZmQWSJN7hN3KUcB2qwkyVjGAWXwARYjdIhhQORDZu2BSze53YFp80yvcZIILdIDUQIYkUwVoTJk5R1WqsTJryoczWvlqwcJGpZCtXfam0xtazYM8hgfL8+V/I3LkL5PPP56c7Ue/ceQtl4cLFBm7Ll68y+9HSZStl0eJl9mw8lhjE2VJi8ZLllp81Y0GkzEHJryCy/efIs82Bcw+k2SRVZwCRF2wTwagH+gMiAIiRDnIYgx3gWISETp20eCkM8TvZx8iAhdpStCh+dzegGJwMUoLHGMhcB4WrB+I5/nnsdYI+TF2O8VjTkcvqyggQQXdnC0gS+LiQ6mSmQFIjC3zwHrosaIsGIqgSFNQaXISdu3Qz7431C67KzGQhb2g2gdS8C4jXGDFdTEOylGceIX22b6tJcArawdfgLUFFJJgruEQDEdzJse44t3GjgoipM27yiRVEALILFy6ZkbRB4+YKfI2kTv3GUr8Rm361Erb6bKrUSH+rX7+J1K7XSEGzgaqDDRQcyVBWK+OoRm2pWrOu1KrTwNJk0L6mzdpI85Ztk9oEDRv+gQFJxoEI528dkjc6nJDJaxNlv0och84+lEPnHsrBoONcZf7yQ87K/6iuoEAA2gtUZ1gGz2Y8hZXxLWoU0oGA3scskJaCfYVFV+j+DF7HWHEWI4Fr9Ny5s4ErYysEGAUPTupEF8VOAlOmVtIKIoiwS5YudRG0Qc/EiIZ6g9oQrBKkBiLB6gBi8fgJkwNeDAfUr+i1bNM5WvX+mzej6/p4iVjsSJIlmNTHMqByscgMMCJfKkmSsud0SYbddTwri4Vqh/YZeyIDmKzEdq5aBzqkdiQaF+8N77xlyzZbFhBMxG8Qz4KRmAzs2DQ8CNFfTEqsiUJlilQAEYz2qAjvVK0lb1euJuVVxStf8R15u1JVKV6ijOTOW0jfmV0WocJ2zPNmYX1eOalYubqUr/SOlHs7/ah8CNnftC3ltE8KFyklud8spM8vJPkKFJM38xc1sBs3fnIGgQj1BDw0/1LvqBTrd1paTLkgXWZdki6zL0lnPb5rx8tS5f3zFoz2Z+7hfgAouD0RKQNBRGdePBJpKXfv3jHJxTb2DtQDw8BUxFiwEjUt5bvvvjdxnHpcXRkLItgcBg1GKnOGUv9MGJ8wd3Tm4JIaiODFCC7YP1h3xC5qTm10TEvWMxg62p4oMBsu14KFi9k9vA8SB3YaYlr27dtnthxy076jwIvdxV1Hm1z6g+BkyzAwzxw4cLBKIgoiyvj+nVE9USeJ78ClirqUlD82QPytms7YlatU02tLmd3KS1mACFtOsudyNBChALQ7v9+lUurHMnHyVJk6nXihWRZDhEG9UJGSBiSecuUpaMw9cFC8zNB7uH6yTlDpRUx2wTR12kxrz8RJU6V9+y4GHmzwBqABZkglqGIZByKAgdKflP579cPyb3WPyH80SJD/aJgg/8sf6yfIX2olyN/764PbkSplHIgwONevf3pzp2iF/BmoIgw8N3gdiBCsM3v2nKiBRuHKDz/seWEgAgOzwI1Njpi9/fOYoWEUQqRDVQ4PIqHemUgggu2DADVzqeozYDruwZ7x+edzLVYhUkGdwX5SuIjLPubfp4aK3cHbgbJVQ1PeWdU+/x6sbH23a7enVAtiUyZOnGQgQDvMiKwAEBzCb6QgFJaCr1Gir3gmdTB+CLbDLR2t0KcYS5G0WKvF4kPiRgC8yZOnyVvlKjnwyFvAmLd06Qq2ehgD8lkFVmJ6iNtJL4IfUpBliTsrJ0+dlo8+/lTKvFXB2oE0ApENkHZmHIj4upBIWDtDIBmG02DCBuJVGH+9vzdVyjgQYUUk0an4wGMh4jlY+UqIMmsnqMMNdpfNfMjQ4eYKtPiTQOxHJPK/E0UYWldGgQhuW9aBEGTkr+V5GHfZmiKcbk8GMvooOU4kOogw665SFZE9jrnWz9w8gxWj+6O8EyBCKLsDESeJ8EyyjwcvtwdQyP1KnEUwiHTRPgt9B9INsP0DiaeQVFg/BHXu/K4Fm7EpNhGtrIwNR/zGNaRRxB3b/T3nwsf2gweD7S0ARqSetBYC9YaNGCXFi79lM36uAONihyCpEMDzosvq1WvN/RwKIlNUYslYEIGQMFJbxQvQBN8TE6U/iGCYYyYioIYB6pP+kuw3EvE7hjv0bkRcloD7dSTMUAxo1t8Q2fiuiqhQuHogV1d3O7KdY67ceY3xqQeGyCgQAQBx25GEJxhEyHjGNp7erRtcHjx4aCH7saozMBOMzO5q2DK4FsLwWbFyFcuGFqlEAhHiFvCO+MKeM7iTeefUQIRk3dS7b/+PlpIAdypARkAdRlgiQm13OP09HBH/wvUwPFIW9dOPuJYxfJMLlj5IzWgcWrieQLk69RvZQkanyhDsVUD69Bugk8yzbfT1PAUcxFtUrgKS0TOAyNRUQISkylFBxNcZjUKvj4kyDkQMAAIgkBby9ybT63ZkILtj+PsiU/J9MERGgAixDuSSxSjpYmScNAYo+C0Tgg2qvpw/d0GGqoSVTQGX6z1hlA4HIhTsKhMnfWhAE/wcPCTEnPB7uJk7Eoiwj05wAiTOSeuYGojAqPThwoWLLOp26vQZtvsfbs1n2Y0PVQAvE2tebL3Q5KmWlpFnpAVEeHfUFJJD5S9cIqDGOIYtVfptmTHzo6T4mxdZmDDIYFbW1Ku0gEjRA5K9zXGZvf6mXL8TviMuJv4ik1YmyustFEQipQLIMMo4EGHw5SFOhNWlRUvZKtNI5Ff0MsDZCBvd2AGII5iE+BECxezaGOrjyAzv68ooEGGAnzlzTgYNjreAMtrqCTWFDb5CPSfM4KyBYc9ibChc6/ai0fuUaD+G2HAiN7Ejmzdvk1at21l7uBdmJ61im7btzV0abu1QNBDBQ+JLrCBCNCo5VEgfSZZ30h0CZKRAGDNmvGWri1UNoW2sI8Erh70nN6kTVRqlbQSMscF6rIVI3E1f63dr2dZUmFw6BmHWgoVKmGFz8+atgStfbGHngS8WLXk2EMnZ9rh89vVNuXkvPIiwxeXUNTck838REPE2ERiYyFD24iW/BKHH7MEajhYtXmJrOVh926NHb2MiN3jdzIxbkgCxqVOnyeIlS62+cPVAPIf6OBI27epyAALDpRVEwuVYdSDiGApGx2jKUnPv5uQIoNTXvxHoRPyILzAW0bIkKyLAitBn6gVEeAbJm2gzSYfCSSKAFtIGBlaeAaNjiOSI7Qh3L4sBQ0t6gwjvgcrRu3c/i72hDdTJPbVq1bGUAdEMvb5g5yEjGwFwFvGsdbhFc7nMNvONqjaxghEFI+bkKdPk7YrVzJ3qQKSwlC7ztnlsUJF+i/JsIAIYqHryavNjMnzRNdl/+qEBBoRq4893n3ggA+ddk/9sErqx1IugjAMRckqwOzpRiwRLsf0B5+EIUZ9kMOyWhzGUVaMwo/M+xFmOEHKHEsgFQ1JfuHogv/MeR/T75EhIByIs0mIdDfp4amXrtu3Sqk07S4LsmQ4Q4X4SLlHwBDjmLG7g4UGkQIEillqQjFvB4jjnZArHAwWzsCPfq1o39/F/7kU6IcqR9wlXYCqfINl7RGBe4jlgPDaTCgYuyvOqMx07d37K3Uq0KKHcpUqXDby3c8/mypPPbFwsdEutYD8h9wuL5ZKByHlnSO8QLdF1uIJNpU27jlKoSAlTY3Dpcqxdp5FJaZH6NKML38wWGqbJsAoYlD0kL9VJkAqDz8rg+Vdl1vobMmvdDZm+NtHOZ65LtA2+yw86K3+tHbSx1H8BEME+8NW65BkulkKEJlGnoS7eUqXeslWtrHdISyF+AMNhKIiwxiIWEGE1JptPpZBEVC3ifp+0mJWl7P5GlKYLJ69tcS49evS0dSfhZlG2ouzUqYsxCu5RjhB2Dpaxz5nzia02jlZIUo1RlhwWZEbnmRife/XqZ/v/hO5ZEwlEMH4Hb7/JOhYvfaUAkU6dU8SJ+ILxlP6wFJj2zRwB3jBtagWXPt+I3CLcjzoMmKCaxRJVHFwePnxgUigrgmFU1BkAhNiM93r2fSri9kUXtnMtWzZWSQTCo6KA8A8KCH+tc0RebnpUsrU+bpS11TE7xrU+Ji83O2q/c12mKgo84erKMMo4EClbrrzppmkpDx88ND2bQRUMIsSJYGRLa5zI3n37bf2HH9jEVqBvszVkakFMFCJu/aZGrg5lKCWyYbETHQXbAPESLJJjn1aAi828WMIeKa8J77F7915zYbL7Pm5VCHCBcWJRAyisZflR34PZl2eSiAk1zaUzTGlHCAci9DEbTxNV6gvuXhg42MWLOti5y7th1+igzpEKEanI9xF1E9RG4qTQALvggv0CCRMPGm3xxNoojMR3AmH/sRTel5iSESNGqRRS3MADZuVYvVZ9S1XIYr3fqhCNPXv2JyahewBJHUQgDwxIGCUOmLfmKWJjKX7nuhcmgXh6fhDBQDhIxdGCLDiD8SEdSOjn06fPNP0fFx7HaMQs8d3O7y19H8a5YBAhM9WQIcNteTnXpVaf/50FZyT9dUyjIr+qC+SpwPDHqtRIBSYnerNP3wFmLPRbKzqKkxIl37LYCJiegQuQEhEKEfTEEUkCL0Vo2yD+fvLkaUs05AkgIgcKOj3niPnh7vXEylDWLXE9q1TJZkY70PnJv3IvhAFdxOoIY24PIhyZtUk7SHY2+hYpiMV3uJBRrwDeuGw5LCH2xYsXTFrkGVx76NAhk+jmzVtgGeod4ChpP7HQEZf8okVLTK2hnzj6c3aWIwKXrOfeZgUBXEhUrDPiPWkXR/oERoxkHwGwly5dYXEgMKcDkUKSM08B6f5eHwPt9EpWBWCxUpekzUhnvp0kdfZkyZ31yLvu//GAeWbate8i+QsCcMmSCBGrY8dNAkSUGcMyaYBIV4iNBGNrKPH3sBtLvQhKCSLzt6UdRGBG9hjJl2IVr4terFOnvvTs2Sc5J4iehyPCm1mD0bV7DxOvcwZyVXpiQBNCjQrAdaypCFcPRF38zvOQGNgzxc262cxwh9pBJG2kYCPUgO3bt+vM29WkFrtX3wkjJu9Ee3g/DMf16zeyd8OAGx8/3IDOE4sSaQeGx9A2sg3C4MHxtnMcNGTIMCPO+Xv//gPD3hdM1M2WDVzPs/kG7PEyfvwEk2pCpZlz58/bHi/OY+XXzmSVHLny2roZVmLz3EaNmloqQhgaEEGtAVTIMEafsYseofE8y7ehY8fOOsOW0XuSwQAi3L9eg4buOu0P+sqf8w4NGzbV9vAsN2FAeNEwLGPbYQEem5TRF2RDI34k1NZDAVhQK+OHAZLFjTl9WHmBQsVUqpmarnlEACOMzDNIwcjY7T9YBup3YF/lJNL/D+KbDh0u3Xv0lqqqoufWNnmPkV/H06x5G5kwgbD3asdVikhQpgQMIgACUkYkCnf9CyEPIhclS+dT8vmWm3LnftoCe5g9h8QPs6AeZnoPIjYgXsnsNknK5ggwCEf8xmDNYjuRMRAdo3qpxurSAcqqVa5D/w5XD+SelcuOPqITxsc4ygIzZl1sK5FiD1AFyGPKAjCMngAPKhEMwMBntzMDN95TjzwH0R+ibTzHtzHSO/Mb15GIGMJO48ndG/6+YHLv6fqNjZ448ncC7JYtW/6U6kfWdkDK7+niQYR+xc5DNjDqeJX+D3jFkCaoD1c00g3eImxTpB7EEMpOf24bVBbsOemGfnHgn3zOtqfB26W6c2dnek3bAcAn36ffXJ/P+iDamjsvO+jlMdfvjBkzk9IjBBc8PCzqq9+wmeQrWMyIDPGASN36jW1fnkgSzLMUgAx1GADJr88h4TNu7nwFiqYg/k5+WkADTxEg4lQs1s6wELCQpWokXUCmTNVPSabqyowGJDDnbyVZpJUURGh7nevyWoeTps7cT6MkAtPhxu3UuavL4FXD5amoWbuuLYkmRwV2hZioqluYRT4LxGPqIVmv1VW9hv0e9r4oRHuYaUmNt0DVm9MBg2ikgp2BnBMtWrbR96lniWPYyoC4EGwsJINu2ry5W1Sm7UnT+2UQWRuq1jSD9GCVNnbv2fOU6A6oLPjiC2FDJpIs0y+1yLqmkl8V3iWoPt4NDxFbPLLPMF4zCsw6R0EYdzY2kEqVq7s8rEpE5tIOR5wr2TXVLHkS19nRn0e4z97H38c1gd/5O567cN4V3o3Fnsz49es3lXr1m0j9Bk2kdbtOMlOlheDsaOlVLqhqN2fOZ9KqdXt7Vj0FKyJkwxG/1W/YWBqoFNy4SUuVhpvbeadOXS1d43FtX6Z/a3JU/qmugohJJEeVOf9/ABFtY9VjkqnGafm7WuelYO8zsn7/HZ2h0wYi+L/RyTEsEsizZct22wgbYrl36BLw1MgtEU+ug+X8/J91M9Qf7p5IRGo67mNhHKnxbqpOHUkC8QXmI9ESWb54LjvdMUjJXM8MRI7R/T/+aAbITZs22TPCPftFEl4QjmQgI8jrrs7WoTMvbm9UGkLTWZq/ZfM261/eMcV32qzvs3mLbZGJcZgUBL4u3h/7DdevXP2lLLccMWx0vdrW9GDjcLQmkPdlTSC3Cxtcu+uCz10emTVP3UeAGfVx3Qq9jkjWDRs2muoc7vsBbuT35ZusXbtBvlq3UY/rZfs3O8wFH+qpSo9CX2A0RiKxsaLjdNt2Ha9haPs331i8iyeXVW6HhfyTppNvk6n/3MtSZvB5+ad6SCQnAxJJKnaS35qqOinkH+uckWxdL8igBVflxOVnT17LQGM3M7/J0e+BMID98iT2aEdfuJdBwjFS+fVXrT9wzW9Nvs9jKf47kRE+tB4olj6jbwAqvCcuD+s9uedztgbnbtVzfnPXhKOg6yPcZ8/Qv/HMSIU2c59df+eu3n9fVa87xpwvolifap+F688UxJjR62gv/w8umU5deiD95yXKv7c4qzO7EhLJ7x5EFOhqnJN/rn9KGk24LNsO3ZNHv6Sf3vhH+aP8UWItIv8PI001VynsfmwAAAAASUVORK5CYII=';


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

async function calcBatchAddByCode(codesStr) {
  const tokens = codesStr.trim().split(/[\s,，]+/).map(t => t.trim()).filter(Boolean);
  const entries = tokens.map(t => {
    const [code, sharesStr] = t.split(/[:：]/);
    const shares = sharesStr ? parseInt(sharesStr) : null;
    return /^\d+$/.test(code) ? { code, shares: (shares && shares > 0) ? shares : null } : null;
  }).filter(Boolean);
  if (entries.length === 0) { alert('請輸入有效股票代號，格式：700:1000 3988:2000\n或只輸入代號：700 3988'); return; }
  calcStocks = entries.map(({ code, shares }, i) => ({
    id: Date.now() + i, code, name: '', lotSize: null, mode: 'normal', shares, nCerts: null, certShares: [], dataDate: undefined
  }));
  renderCalcStocks();
  const inputEl = document.getElementById('calcQuickCodes');
  if (inputEl) inputEl.value = '';
  await Promise.all(calcStocks.map(s => calcLookupForStock(s.id)));
  const allHaveShares = calcStocks.every(s => s.shares && s.shares > 0);
  if (allHaveShares) calcRunAll();
}

function renderCalcStocks() {
  const container = document.getElementById('calcStockList');
  const wrap = document.querySelector('.calc-wrap');
  wrap.style.maxWidth = '';
  document.querySelector('.calc-outer').style.justifyContent = '';
  container.innerHTML = '';
  container.style.cssText = 'display:flex; flex-direction:column; gap:16px; margin-bottom:12px;';

  for (let i = 0; i < calcStocks.length; i += 2) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex; gap:16px; align-items:flex-start;';

    for (let j = i; j < Math.min(i + 2, calcStocks.length); j++) {
      const stock = calcStocks[j];
      const group = document.createElement('div');
      group.style.cssText = 'flex:1; min-width:0; display:flex; gap:10px; align-items:flex-start;';

      const stockDiv = document.createElement('div');
      stockDiv.className = 'card';
      stockDiv.id = `calcStockCard_${stock.id}`;
      stockDiv.style.cssText = 'flex:0 0 350px; min-width:0;';
      stockDiv.innerHTML = buildStockCardHTML(stock, j);

      const feeDiv = document.createElement('div');
      feeDiv.id = `calcFeeInline_${stock.id}`;
      feeDiv.className = 'card';
      feeDiv.style.cssText = 'flex:1; min-width:200px; max-width:520px; display:none;';

      group.appendChild(stockDiv);
      group.appendChild(feeDiv);
      row.appendChild(group);
    }

    container.appendChild(row);
  }
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
      <div id="calcBatchFill_${stock.id}" style="display:${stock.certShares.length > 0 ? 'flex' : 'none'};gap:8px;align-items:center;margin-top:8px;flex-wrap:wrap;">
        <span style="font-size:13px;color:var(--text2);">批量填入：</span>
        <input id="calcBatchShares_${stock.id}" type="number" class="form-input" style="width:100px;" placeholder="股數" min="1"
          onkeydown="if(event.key==='Enter'){event.stopPropagation();calcBatchFill(${stock.id});}" />
        <span style="font-size:13px;color:var(--text2);">股 ×</span>
        <input id="calcBatchCount_${stock.id}" type="number" class="form-input" style="width:75px;" placeholder="全部" min="1"
          onkeydown="if(event.key==='Enter'){event.stopPropagation();calcBatchFill(${stock.id});}" />
        <span style="font-size:13px;color:var(--text2);">張，從第</span>
        <input id="calcBatchFrom_${stock.id}" type="number" class="form-input" style="width:60px;" placeholder="1" min="1"
          onkeydown="if(event.key==='Enter'){event.stopPropagation();calcBatchFill(${stock.id});}" />
        <span style="font-size:13px;color:var(--text2);">張起</span>
        <button class="btn-secondary" onclick="calcBatchFill(${stock.id})">填入</button>
        <button class="btn-secondary" style="color:#e53e3e;border-color:#e53e3e;" onclick="calcClearCertShares(${stock.id})">清除所有股數</button>
      </div>
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
  const batchDiv = document.getElementById(`calcBatchFill_${id}`);
  if (batchDiv) batchDiv.style.display = 'flex';
  calcUpdateBatchFrom(id);
  const first = document.getElementById(`calcCertInput_${id}_0`);
  if (first) first.focus();
}

function calcUpdateBatchFrom(id) {
  const stock = calcStocks.find(s => s.id === id);
  if (!stock) return;
  const fromEl = document.getElementById(`calcBatchFrom_${id}`);
  if (!fromEl) return;
  const firstEmpty = stock.certShares.findIndex(s => !s || s < 1);
  fromEl.value = firstEmpty === -1 ? '' : firstEmpty + 1;
}

function calcBatchFill(id) {
  const stock = calcStocks.find(s => s.id === id);
  if (!stock || !stock.certShares.length) return;
  const sharesEl = document.getElementById(`calcBatchShares_${id}`);
  const countEl  = document.getElementById(`calcBatchCount_${id}`);
  const fromEl   = document.getElementById(`calcBatchFrom_${id}`);
  const shares = parseInt(sharesEl.value);
  if (!shares || shares < 1) { alert('請輸入有效股數'); sharesEl.focus(); return; }
  const fromVal = parseInt(fromEl.value) || 1;
  const startIdx = Math.max(0, fromVal - 1);
  if (startIdx >= stock.certShares.length) { alert(`起始張數不可超過 ${stock.certShares.length} 張`); fromEl.focus(); return; }
  const remaining = stock.certShares.length - startIdx;
  const count = parseInt(countEl.value) || remaining;
  const n = Math.min(count, remaining);
  for (let i = startIdx; i < startIdx + n; i++) stock.certShares[i] = shares;
  renderCertFields(id);
  const batchDiv = document.getElementById(`calcBatchFill_${id}`);
  if (batchDiv) batchDiv.style.display = 'flex';
  calcUpdateBatchFrom(id);
  sharesEl.value = '';
  countEl.value = '';
  sharesEl.focus();
}

function calcClearCertShares(id) {
  const stock = calcStocks.find(s => s.id === id);
  if (!stock || !stock.certShares.length) return;
  stock.certShares = stock.certShares.map(() => null);
  renderCertFields(id);
  const batchDiv = document.getElementById(`calcBatchFill_${id}`);
  if (batchDiv) batchDiv.style.display = 'flex';
  calcUpdateBatchFrom(id);
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
  calcUpdateBatchFrom(id);
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

function openFeeHelp() {
  document.getElementById('feeHelpOverlay').style.display = 'flex';
}

function closeFeeHelp() {
  document.getElementById('feeHelpOverlay').style.display = 'none';
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

function buildInlineFeeHtml(r) {
  const coPerLot = r.mode === 'split' ? r.coPerLot : r.coBase;
  const label = r.stock.code ? `${r.stock.code}${r.stock.name ? ` ${r.stock.name}` : ''}` : '';
  let body = '';

  if (r.mode === 'split' && r.certShares) {
    const certRows = r.certShares.map((s, i) =>
      `<tr><td>第 ${i+1} 張</td><td style="text-align:right;">${s.toLocaleString()} 股</td></tr>`
    ).join('');
    body += `<div class="calc-section">
      <div class="calc-section-title">拆細明細
        <button class="calc-detail-toggle" onclick="calcToggleCertDetail(this)">顯示明細</button>
      </div>
      <div style="display:none; margin-bottom:8px;"><table class="calc-detail-table">${certRows}</table></div>
      <div class="calc-row"><span>分拆總張數</span><span>${r.nCerts} 張</span></div>
      <div class="calc-row subtotal"><span>總提取股數</span><span>${r.total.toLocaleString()} 股</span></div>
    </div>`;
  }

  body += `<div class="calc-section">
    <div class="calc-section-title">股票明細</div>
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
  </div>
  <div class="calc-total" style="font-size:14px;background:var(--bg2);color:var(--text1);">
    <span>小計${label ? `（${label}）` : ''}</span><span>HK$${r.grand.toFixed(2)}</span>
  </div>`;

  return `<div class="card-header"><span>費用明細</span></div>
          <div class="card-body">${body}</div>`;
}

function renderCalcResults(results) {
  const grandTotal = results.reduce((s, r) => s + r.grand, 0);

  // 頂部總費用列
  document.getElementById('calcTotalBarAmount').textContent = `HK$${grandTotal.toFixed(2)}`;
  document.getElementById('calcTotalBar').style.display = 'flex';
  document.getElementById('calcCopyBarBtn').style.display = '';
  document.getElementById('calcEmailBtn').style.display = '';

  // 每隻股票 inline 費用卡
  results.forEach(r => {
    const feeDiv = document.getElementById(`calcFeeInline_${r.stock.id}`);
    if (feeDiv) { feeDiv.innerHTML = buildInlineFeeHtml(r); feeDiv.style.display = ''; }
  });

  // 右欄不再使用
  document.querySelector('.calc-results-panel').style.display = 'none';

  document.getElementById('calcConfirmCard').style.display = calcIsPublic ? 'none' : '';
  document.getElementById('calcConfirmDate').value = todayStr;
  document.getElementById('calcAccountInput').value = '';
  document.getElementById('calcConfirmMsg').textContent = '';
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

function calcGenerateEmail() {
  if (!calcResults || calcResults.length === 0) return;
  const feeLines = calcResults.map(r => {
    const label = r.stock.code
      ? (r.stock.name ? `${r.stock.code} ${r.stock.name}` : r.stock.code)
      : `股票 #${calcResults.indexOf(r) + 1}`;
    return `<span>${label}：HK$${r.grand.toFixed(2)}</span>`;
  });
  if (calcResults.length > 1) {
    const total = calcResults.reduce((s, r) => s + r.grand, 0);
    feeLines.push(`<span><strong>合計費用：HK$${total.toFixed(2)}</strong></span>`);
  }
  const feeBlock = feeLines.join('<br/>');

  const emailHtml = `<div style="font-family:sans-serif;line-height:1.6;color:#1A1A1A;max-width:700px;">
<img src="${FUTU_LOGO_B64}" style="height:38px;display:block;margin-bottom:16px;" />
尊敬的客戶：<br/>
<br/>
您好，閣下之指示/文件已交予相關同事處理，提取實物股票申請需時5-7個工作日（如碎股，有機會視乎上游處理時間而延長）。如可領取，閣下會收到電郵及【富途牛牛】APP通知，請耐心等候，謝謝。<br/>
<br/>
<br/>
有關提取實物股票之收費包括:<br/>
1.&nbsp;&nbsp;&nbsp;&nbsp;富途證券手續費（每隻股票每手港幣1.50元，非整手碎股或特別要求拆細提取則收取每張100元行政費，每隻股票提取申請最低收費為港幣500元）及<br/>
2.&nbsp;&nbsp;&nbsp;&nbsp;香港中央結算有限公司收費（每隻每手股票港幣3.50元，碎股亦視作一手）。<br/>
<br/>
<br/>
<br/>
<strong>是次申請費用預算如下：</strong><br/>
${feeBlock}<br/>
<br/>
<br/>
<br/>
請閣下保證賬戶內有足夠資金用以扣取費用（否則我們將會取消指示），一旦扣取成功，不予取消指示及申請退款，望閣下知悉。<br/>
<br/>
<br/>
<br/>
如有任何問題，歡迎隨時與我們聯絡。<br/>
多謝您選用本行服務。<br/>
客戶服務團隊<br/>
<br/>
&nbsp;<br/>
<br/>
富途證券國際(香港)有限公司<br/>
客服電話: +852 25233588<br/>
公司地址: 香港金鐘道95號統一中心34樓<br/>
<br/>
<span style="font-size:11px;color:#888;">DISCLAIMER:<br/>
The information contained in this e-mail is confidential and intended solely for the addressee.<br/>
If this e-mail was sent to you in error, please notify the sender immediately by return of this e-mail<br/>
and delete it from your system. The information contained in this e-mail is the sender's own concern.</span>
</div>`;

  const emailDiv = document.getElementById('emailModalContent');
  emailDiv.innerHTML = emailHtml;
  document.getElementById('copyEmailBtn').textContent = '複製電郵';
  document.getElementById('emailModalOverlay').style.display = 'flex';
}

function closeEmailModal() {
  document.getElementById('emailModalOverlay').style.display = 'none';
}

async function calcCopyEmail() {
  const emailDiv = document.getElementById('emailModalContent');
  const htmlContent = emailDiv.innerHTML;
  const plainText = emailDiv.innerText;
  const btn = document.getElementById('copyEmailBtn');
  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/html': new Blob([htmlContent], { type: 'text/html' }),
        'text/plain': new Blob([plainText], { type: 'text/plain' })
      })
    ]);
  } catch {
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(emailDiv);
    sel.removeAllRanges();
    sel.addRange(range);
    try { document.execCommand('copy'); } catch { alert('複製失敗，請手動選取文字'); }
    sel.removeAllRanges();
  }
  btn.textContent = '✓ 已複製';
  setTimeout(() => { btn.textContent = '複製電郵'; }, 2000);
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
  document.querySelector('.calc-results-panel').style.display = 'none';
  document.getElementById('calcTotalBar').style.display = 'none';
  document.getElementById('calcCopyBarBtn').style.display = 'none';
  document.getElementById('calcEmailBtn').style.display = 'none';
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
initApp();

document.getElementById('calcAccountInput').addEventListener('input', function () {
  const pos = this.selectionStart;
  const cleaned = this.value.replace(/\D/g, '');
  if (cleaned !== this.value) { this.value = cleaned; this.setSelectionRange(pos - 1, pos - 1); }
});
