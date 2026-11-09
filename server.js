const express = require('express');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

let db;
let feeDb;
let pool = null;
let storageReady = false;

async function initStorage() {
  if (storageReady) return;
  if (process.env.DATABASE_URL) {
    const { Pool } = require('pg');
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 8000,
      max: 1
    });
    db = {
      getAll: async () => {
        const result = await pool.query(
          'SELECT * FROM records ORDER BY date_field DESC, record_id DESC'
        );
        return result.rows.map(r => ({
          record_id: r.record_id,
          fields: { '日期': r.date_field, '牛牛號': r.account, '業務類型': r.biz_type }
        }));
      },
      insert: async (record_id, fields) => {
        await pool.query(
          'INSERT INTO records (record_id, date_field, account, biz_type) VALUES ($1, $2, $3, $4)',
          [record_id, fields['日期'], fields['牛牛號'], fields['業務類型']]
        );
      },
      remove: async (record_id) => {
        await pool.query('DELETE FROM records WHERE record_id = $1', [record_id]);
      }
    };
    feeDb = {
      getAll: async () => {
        const result = await pool.query(
          'SELECT * FROM fee_records ORDER BY date_field DESC, record_id DESC'
        );
        return result.rows.map(r => ({
          record_id: r.record_id,
          date: r.date_field, account: r.account, stock_code: r.stock_code,
          lot_size: r.lot_size, mode: r.mode, total_shares: r.total_shares,
          total_fee: parseFloat(r.total_fee), hkscc_fee: parseFloat(r.hkscc_fee),
          company_fee: parseFloat(r.company_fee)
        }));
      },
      insert: async (record_id, data) => {
        await pool.query(
          `INSERT INTO fee_records (record_id, date_field, account, stock_code, lot_size, mode, total_shares, total_fee, hkscc_fee, company_fee)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [record_id, data.date, data.account, data.stock_code, data.lot_size,
           data.mode, data.total_shares || null, data.total_fee, data.hkscc_fee, data.company_fee]
        );
      },
      remove: async (record_id) => {
        await pool.query('DELETE FROM fee_records WHERE record_id = $1', [record_id]);
      }
    };
    console.log('📦 使用 PostgreSQL 存儲');
  } else {
    const DATA_FILE = path.join(__dirname, 'data.json');
    const load = () => fs.existsSync(DATA_FILE)
      ? JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'))
      : { items: [] };
    const save = (data) => fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));

    db = {
      getAll: async () => load().items,
      insert: async (record_id, fields) => {
        const data = load();
        data.items.push({ record_id, fields });
        save(data);
      },
      remove: async (record_id) => {
        const data = load();
        data.items = data.items.filter(r => r.record_id !== record_id);
        save(data);
      }
    };

    const FEE_FILE = path.join(__dirname, 'fee_data.json');
    const loadFee = () => fs.existsSync(FEE_FILE)
      ? JSON.parse(fs.readFileSync(FEE_FILE, 'utf-8'))
      : { items: [] };
    const saveFee = (data) => fs.writeFileSync(FEE_FILE, JSON.stringify(data, null, 2));

    feeDb = {
      getAll: async () => loadFee().items,
      insert: async (record_id, data) => {
        const f = loadFee();
        f.items.push({ record_id, ...data });
        saveFee(f);
      },
      remove: async (record_id) => {
        const f = loadFee();
        f.items = f.items.filter(r => r.record_id !== record_id);
        saveFee(f);
      }
    };
    console.log('📁 使用本地 JSON 存儲');
  }
  storageReady = true;
}

// 密碼驗證端點（不需要密碼就能訪問）
app.post('/api/verify-password', (req, res) => {
  const { password } = req.body;
  if (!process.env.APP_PASSWORD || password === process.env.APP_PASSWORD) {
    res.json({ code: 0 });
  } else {
    res.status(401).json({ code: -1, msg: '密碼錯誤' });
  }
});

// 所有 /api 路由先確保存儲已初始化，並驗證密碼
app.use('/api', async (req, res, next) => {
  try {
    // 跳過不需要密碼的端點
    if (req.path === '/health' || req.path === '/verify-password' || req.path === '/debug-lotsize' || req.path === '/migrate' || req.path.startsWith('/lotsize/') || req.path.startsWith('/close-price/') || req.path.startsWith('/realtime-price/') || (req.path === '/trigger-lotsize-update' && req.method === 'GET')) {
      await initStorage();
      return next();
    }
    // 密碼檢查
    if (process.env.APP_PASSWORD) {
      const pwd = req.headers['x-app-password'];
      if (pwd !== process.env.APP_PASSWORD) {
        return res.status(401).json({ code: -1, msg: '請先輸入密碼' });
      }
    }
    await initStorage();
    next();
  } catch (err) {
    res.status(500).json({ code: -1, msg: err.message });
  }
});

// 一次性建表端點（新部署後手動執行一次）
app.get('/api/migrate', async (req, res) => {
  if (!pool) return res.status(500).json({ error: 'No database' });
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS records (record_id TEXT PRIMARY KEY, date_field TEXT NOT NULL, account TEXT NOT NULL, biz_type TEXT NOT NULL)`);
    await pool.query(`CREATE TABLE IF NOT EXISTS fee_records (record_id TEXT PRIMARY KEY, date_field TEXT NOT NULL, account TEXT NOT NULL, stock_code TEXT, lot_size INTEGER, mode TEXT, total_fee NUMERIC, hkscc_fee NUMERIC, company_fee NUMERIC)`);
    await pool.query(`ALTER TABLE fee_records ADD COLUMN IF NOT EXISTS total_shares INTEGER`);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/records', async (req, res) => {
  try {
    const items = await db.getAll();
    res.json({ code: 0, data: { items } });
  } catch (err) {
    res.status(500).json({ code: -1, msg: err.message });
  }
});

app.post('/api/records', async (req, res) => {
  try {
    const record_id = Date.now().toString();
    await db.insert(record_id, req.body.fields);
    res.json({ code: 0, data: { record: { record_id, fields: req.body.fields } } });
  } catch (err) {
    res.status(500).json({ code: -1, msg: err.message });
  }
});

// 批量登記（一次過插入多筆，使用事務保證原子性）
app.post('/api/records/batch', async (req, res) => {
  try {
    const records = req.body.records;
    if (!Array.isArray(records) || records.length === 0) {
      return res.status(400).json({ code: -1, msg: '無效的 records 陣列' });
    }
    const inserted = [];
    for (const fields of records) {
      const record_id = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      await db.insert(record_id, fields);
      inserted.push({ record_id, fields });
    }
    res.json({ code: 0, data: { count: inserted.length } });
  } catch (err) {
    res.status(500).json({ code: -1, msg: err.message });
  }
});

app.post('/api/records/batch-delete', async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ code: -1, msg: '無效 ids' });
    await Promise.all(ids.map(id => db.remove(id)));
    res.json({ code: 0 });
  } catch (err) {
    res.status(500).json({ code: -1, msg: err.message });
  }
});

app.delete('/api/records/:recordId', async (req, res) => {
  try {
    await db.remove(req.params.recordId);
    res.json({ code: 0 });
  } catch (err) {
    res.status(500).json({ code: -1, msg: err.message });
  }
});

app.get('/api/fee-records', async (req, res) => {
  try {
    const items = await feeDb.getAll();
    res.json({ code: 0, data: { items } });
  } catch (err) {
    res.status(500).json({ code: -1, msg: err.message });
  }
});

app.post('/api/fee-records', async (req, res) => {
  try {
    const record_id = Date.now().toString();
    await feeDb.insert(record_id, req.body);
    res.json({ code: 0, data: { record_id } });
  } catch (err) {
    res.status(500).json({ code: -1, msg: err.message });
  }
});

app.post('/api/fee-records/batch-delete', async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ code: -1, msg: '無效 ids' });
    await Promise.all(ids.map(id => feeDb.remove(id)));
    res.json({ code: 0 });
  } catch (err) {
    res.status(500).json({ code: -1, msg: err.message });
  }
});

app.delete('/api/fee-records/:recordId', async (req, res) => {
  try {
    await feeDb.remove(req.params.recordId);
    res.json({ code: 0 });
  } catch (err) {
    res.status(500).json({ code: -1, msg: err.message });
  }
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true, storage: process.env.DATABASE_URL ? 'postgresql' : 'json' });
});

// 每手股數查詢（優先查數據庫，回退至 JSON 靜態數據）
const LOT_SIZE_DATA = global._LOTSIZE_DATA || (() => {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'lotsize_data.json'), 'utf-8')); } catch(e) { return {}; }
})();
app.get('/api/lotsize/:code', async (req, res) => {
  const code = req.params.code;
  if (!/^\d+$/.test(code)) return res.status(400).json({ error: '無效股票代號' });
  const numCode = parseInt(code);

  if (pool) {
    try {
      // 用 to_char 直接攞 YYYY-MM-DD 文字，避免 timestamp 冇時區被本地時區錯誤換算（本地會慢一日）
      const result = await pool.query("SELECT name, lot, to_char(updated_at, 'YYYY-MM-DD') AS updated_at FROM lot_sizes WHERE code = $1", [numCode]);
      if (result.rows.length > 0) {
        const row = result.rows[0];
        return res.json({ lotSize: row.lot, stockName: row.name, source: 'HKEX', updatedAt: row.updated_at || null });
      }
    } catch (e) { /* 數據庫查詢失敗，回退至 JSON */ }
  }

  const entry = LOT_SIZE_DATA[numCode];
  if (entry) return res.json({ lotSize: entry.lot, stockName: entry.name, source: 'HKEX', updatedAt: null });
  res.status(404).json({ error: '無法取得每手股數，請手動輸入' });
});

app.get('/api/debug-lotsize', (req, res) => {
  res.json({
    globalCount: global._LOTSIZE_DATA ? Object.keys(global._LOTSIZE_DATA).length : 0,
    jsonCount: Object.keys(LOT_SIZE_DATA).length,
    entry2800: LOT_SIZE_DATA[2800] || null
  });
});

// ===== 收市價查詢（港交所每日報價） =====
// 快取：記住最新交易日 + 該日全部股票收市價，避免每次查詢都下載 25MB 網頁
let closePriceCache = { tradeDate: null, fetchedAt: 0, prices: {} };

// 由今日向後試，搵第一個有數據嘅交易日（最多試 15 日，足夠跨長假期）
// 港交所對 HEAD 請求回 503，必須用 GET；搵到 200 就直接用嗰日內容
async function findAndLoadLatestTradeDate() {
  const today = new Date();
  for (let back = 0; back < 15; back++) {
    const d = new Date(today);
    d.setDate(today.getDate() - back);
    const yy = String(d.getFullYear()).slice(2);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const tag = `${yy}${mm}${dd}`;
    const url = `https://www.hkex.com.hk/eng/stat/smstat/dayquot/d${tag}e.htm`;
    try {
      const resp = await axios.get(url, { timeout: 30000, responseType: 'text', validateStatus: s => s === 200 });
      if (resp.status === 200 && resp.data && resp.data.indexOf('name = "quotations"') !== -1) {
        const iso = `${d.getFullYear()}-${mm}-${dd}`;
        return { tag, iso, html: resp.data };
      }
    } catch (e) { /* 404 / 非交易日 / 頁面未上載，繼續試前一日 */ }
  }
  return null;
}

// 由報價網頁 HTML 抽全部股票收市價，回傳 { code: { name, closePrice } }
function parseAllClosePrices(html) {

  // 只取主報價表段（QUOTATIONS 到 SALES RECORDS 之間）
  const startIdx = html.indexOf('name = "quotations"');
  const endIdx = html.indexOf('name = "sales_all"');
  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
    throw new Error('未能定位主報價表');
  }
  const section = html.slice(startIdx, endIdx);

  const prices = {};
  const lines = section.split('\n');
  // 每隻股票佔兩行：
  //   第1行：編號 名稱 貨幣 前日收市價(PRV.CLO.) ...
  //   第2行：當日收市價(CLOSING) 買入價 最低價 成交金額 ...
  // 收市價 = 第2行第一個數字。第2行開頭兩個欄位必須都是數字，避免誤把下一隻股票嘅編號當成收市價
  const rowRe    = /^\s*\*?\s*(\d+)\s+(\S.*?)\s+(HKD|CNY|USD|EUR)\s+/;
  const closeRe  = /^\s+([0-9]+(?:\.[0-9]+)?)\s+([0-9]+(?:\.[0-9]+)?)[\s-]/;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(rowRe);
    if (!m) continue;
    const code = m[1];
    const name = m[2].trim();
    if (i + 1 >= lines.length) break;
    const c = lines[i + 1].match(closeRe);
    if (!c) continue;
    const closePrice = parseFloat(c[1]);
    if (closePrice > 0) {
      prices[code] = { name, closePrice };
    }
  }
  return prices;
}

// 取得最新交易日 + 該日全部收市價（含快取：當日數據快取6小時；非當日快取30分鐘，等港交所上載新頁面）
async function getLatestClosePriceData() {
  const now = Date.now();
  if (closePriceCache.tradeDate && closePriceCache.fetchedAt) {
    const d = new Date();
    const todayKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const ttl = closePriceCache.tradeDate.slice(0, 10) === todayKey ? 6 * 60 * 60 * 1000 : 30 * 60 * 1000;
    if (now - closePriceCache.fetchedAt < ttl) return closePriceCache;
  }

  const found = await findAndLoadLatestTradeDate();
  if (!found) throw new Error('未能找到近期交易日報價');
  const prices = parseAllClosePrices(found.html);
  if (Object.keys(prices).length === 0) throw new Error('報價頁已下載但未能抽取任何收市價');

  closePriceCache = { tradeDate: found.iso, fetchedAt: now, prices };
  console.log(`📈 已載入 ${found.iso} 收市價（${Object.keys(prices).length} 隻）`);
  return closePriceCache;
}

// 收市價查詢端點（公開，供計算器使用）
app.get('/api/close-price/:code', async (req, res) => {
  const code = req.params.code;
  if (!/^\d+$/.test(code)) return res.status(400).json({ error: '無效股票代號' });
  try {
    const data = await getLatestClosePriceData();
    const entry = data.prices[code];
    if (!entry) return res.status(404).json({ error: `未能找到股票 ${code} 的收市價`, tradeDate: data.tradeDate });
    res.json({ code, name: entry.name, closePrice: entry.closePrice, tradeDate: data.tradeDate });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== etnet 即時報價（計算器「即時價·預估」模式用；免費報價延遲約15分鐘） =====
// etnet 報價頁要先有 session cookie 先會輸出數字，所以由 server 代攞：先攞 cookie，再攞報價頁
let etnetCookie = { cookie: '', savedAt: 0 };
const ETNET_BASE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Accept-Language': 'zh-HK,zh;q=0.9'
};
const realtimePriceCache = {}; // code -> { fetchedAt, data }

async function primeEtnetCookie(numCode) {
  const resp = await axios.get(`https://www.etnet.com.hk/www/tc/stocks/realtime/quote.php?code=${numCode}`, {
    timeout: 15000, headers: ETNET_BASE_HEADERS, validateStatus: s => s === 200
  });
  const setCookies = resp.headers['set-cookie'];
  if (setCookies && setCookies.length) {
    etnetCookie = { cookie: setCookies.map(c => c.split(';')[0]).join('; '), savedAt: Date.now() };
  }
}

function parseEtnetQuote(html, numCode) {
  const t = html.match(/即時報價更新時間為\s*([0-9]{2}\/[0-9]{2}\/[0-9]{4}\s+[0-9]{2}:[0-9]{2})/);
  if (!t) throw new Error('etnet 報價頁未有數據（可能非交易時段或來源異常）');
  const p = html.match(/class="nominal[^"]*">[\s\S]*?class="number">([0-9.]+)</);
  if (!p) throw new Error('etnet 報價頁未能找到價格');
  const n = html.match(new RegExp(`href="quote\\.php\\?code=${numCode}"[^>]*>\\d{5}&nbsp;([^<]+)<`));
  const c = html.match(/font-weight:bold;">\s*(-?[0-9.]+)\s*\((-?[0-9.]+%)\)/);
  return {
    name: n ? n[1].trim() : '',
    price: parseFloat(p[1]),
    change: c ? parseFloat(c[1]) : null,
    changePct: c ? c[2] : null,
    updateTime: t[1]
  };
}

async function fetchEtnetQuote(numCode) {
  const url = `https://www.etnet.com.hk/www/tc/stocks/realtime/quote_super.php?code=${numCode}`;
  const referer = `https://www.etnet.com.hk/www/tc/stocks/realtime/quote.php?code=${numCode}`;
  let headers = { ...ETNET_BASE_HEADERS, Referer: referer };
  if (etnetCookie.cookie && Date.now() - etnetCookie.savedAt < 25 * 60 * 1000) headers.Cookie = etnetCookie.cookie;
  let resp = await axios.get(url, { timeout: 15000, headers, validateStatus: s => s === 200 });
  let data;
  try {
    data = parseEtnetQuote(resp.data, numCode);
  } catch (e) {
    // cookie 冇效／未攞過 → 重新攞 cookie 再試一次
    await primeEtnetCookie(numCode);
    resp = await axios.get(url, { timeout: 15000, headers: { ...ETNET_BASE_HEADERS, Referer: referer, Cookie: etnetCookie.cookie }, validateStatus: s => s === 200 });
    data = parseEtnetQuote(resp.data, numCode);
  }
  return { code: String(numCode), ...data, source: 'etnet' };
}

// etnet 即時價查詢端點（公開；每隻股票快取60秒）
app.get('/api/realtime-price/:code', async (req, res) => {
  const code = req.params.code;
  if (!/^\d+$/.test(code)) return res.status(400).json({ error: '無效股票代號' });
  const numCode = parseInt(code, 10);
  const now = Date.now();
  const hit = realtimePriceCache[numCode];
  if (hit && now - hit.fetchedAt < 60 * 1000) return res.json(hit.data);
  try {
    const data = await fetchEtnetQuote(numCode);
    realtimePriceCache[numCode] = { fetchedAt: now, data };
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function triggerLotsizeUpdate(res) {
  const githubToken = process.env.GITHUB_TOKEN;
  if (!githubToken) return res.status(500).json({ code: -1, msg: 'GITHUB_TOKEN 未設定' });
  const gh = { headers: { 'Authorization': `Bearer ${githubToken}`, 'Accept': 'application/vnd.github+json' } };
  const wfUrl = 'https://api.github.com/repos/Alvinchan1203/daily_to_settlemt_document/actions/workflows/update-lotsize.yml';
  try {
    // GitHub 會自動停用 60 天無活動的排程工作，先確保處於啟用狀態再觸發
    await axios.put(`${wfUrl}/enable`, {}, gh);
    await axios.post(`${wfUrl}/dispatches`, { ref: 'main' }, gh);
  } catch (e) {
    return res.status(500).json({ code: -1, msg: e.response?.data?.message || e.message });
  }
  // cron 每朝同步刷新收市價：清快取強制重新下載，兼每日檢查港交所來源有冇壞
  let closePrice = null;
  try {
    closePriceCache = { tradeDate: null, fetchedAt: 0, prices: {} };
    const data = await getLatestClosePriceData();
    closePrice = { tradeDate: data.tradeDate, stocks: Object.keys(data.prices).length };
  } catch (e) {
    closePrice = { error: e.message };
  }
  res.json({ code: 0, msg: '已觸發更新，約1分鐘後完成', closePrice });
}

// UI 按鈕用（POST，無需 token，已在私用版登入後才可見）
app.post('/api/trigger-lotsize-update', (req, res) => triggerLotsizeUpdate(res));

// cron-job.org 用（GET + token）
app.get('/api/trigger-lotsize-update', (req, res) => {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || req.query.token !== cronSecret) {
    return res.status(401).json({ code: -1, msg: 'Unauthorized' });
  }
  triggerLotsizeUpdate(res);
});

module.exports = app;

// 本地開發直接執行時才啟動監聽
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  initStorage().then(() => {
    app.listen(PORT, () => {
      console.log(`✅ 每日走袋統計已啟動`);
      console.log(`🌐 http://localhost:${PORT}`);
    });
  }).catch(err => {
    console.error('啟動失敗:', err);
    process.exit(1);
  });
}
