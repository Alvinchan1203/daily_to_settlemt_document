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
    if (req.path === '/health' || req.path === '/verify-password' || req.path === '/debug-lotsize') {
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
      const result = await pool.query('SELECT name, lot FROM lot_sizes WHERE code = $1', [numCode]);
      if (result.rows.length > 0) {
        return res.json({ lotSize: result.rows[0].lot, stockName: result.rows[0].name, source: 'HKEX' });
      }
    } catch (e) { /* 數據庫查詢失敗，回退至 JSON */ }
  }

  const entry = LOT_SIZE_DATA[numCode];
  if (entry) return res.json({ lotSize: entry.lot, stockName: entry.name, source: 'HKEX' });
  res.status(404).json({ error: '無法取得每手股數，請手動輸入' });
});

app.get('/api/debug-lotsize', (req, res) => {
  res.json({
    globalCount: global._LOTSIZE_DATA ? Object.keys(global._LOTSIZE_DATA).length : 0,
    jsonCount: Object.keys(LOT_SIZE_DATA).length,
    entry2800: LOT_SIZE_DATA[2800] || null
  });
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
