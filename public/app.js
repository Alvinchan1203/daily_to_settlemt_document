const FIELDS = [
  '存實貨',
  '提實貨',
  '提實貨簽收',
  '結單/賬戶證明扣款/審計',
  '銷戶未夠180日收費'
];

let allRecords = [];
let currentFilter = 'all';
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
          <td><span class="biz-badge">${r.fields['業務類型'] || '-'}</span></td>
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
  ['all', 'today', 'week', 'month', 'custom'].forEach(t => {
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
      <td><span class="biz-badge">${r.fields['業務類型'] || '-'}</span></td>
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

  FIELDS.forEach(field => {
    const fieldRecords = records.filter(r => r.fields['業務類型'] === field);
    const count = fieldRecords.length;

    if (count === 0) {
      lines.push(`${field}:`);
    } else {
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
      lines.push(`${field}${count}: ${accountList.join(', ')}`);
    }
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
