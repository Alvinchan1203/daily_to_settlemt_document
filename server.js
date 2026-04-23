const express = require('express');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(express.static('public'));

let db;
let feeDb;

async function initStorage() {
  if (process.env.DATABASE_URL) {
    // 雲端模式：PostgreSQL
    const { Pool } = require('pg');
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    });
    await pool.query(`
      CREATE TABLE IF NOT EXISTS records (
        record_id TEXT PRIMARY KEY,
        date_field TEXT NOT NULL,
        account TEXT NOT NULL,
        biz_type TEXT NOT NULL
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS fee_records (
        record_id TEXT PRIMARY KEY,
        date_field TEXT NOT NULL,
        account TEXT NOT NULL,
        stock_code TEXT,
        lot_size INTEGER,
        mode TEXT,
        total_fee NUMERIC,
        hkscc_fee NUMERIC,
        company_fee NUMERIC
      )
    `);
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
          lot_size: r.lot_size, mode: r.mode,
          total_fee: parseFloat(r.total_fee), hkscc_fee: parseFloat(r.hkscc_fee),
          company_fee: parseFloat(r.company_fee)
        }));
      },
      insert: async (record_id, data) => {
        await pool.query(
          `INSERT INTO fee_records (record_id, date_field, account, stock_code, lot_size, mode, total_fee, hkscc_fee, company_fee)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [record_id, data.date, data.account, data.stock_code, data.lot_size,
           data.mode, data.total_fee, data.hkscc_fee, data.company_fee]
        );
      },
      remove: async (record_id) => {
        await pool.query('DELETE FROM fee_records WHERE record_id = $1', [record_id]);
      }
    };
    console.log('📦 使用 PostgreSQL 存儲');
  } else {
    // 本地模式：JSON 文件
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
}

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

// ── 每手股數查詢 ─────────────────────────────────────────────
app.get('/api/lotsize/:code', async (req, res) => {
  const code = req.params.code;
  if (!/^\d+$/.test(code)) return res.status(400).json({ error: '無效股票代號' });
  try {
    const lotSize = await scrapeEtnetLotSize(code);
    if (lotSize) return res.json({ lotSize, source: 'ETNet' });
    res.status(404).json({ error: '無法取得每手股數，請手動輸入' });
  } catch (e) {
    res.status(404).json({ error: '無法取得每手股數，請手動輸入', debug: e.message });
  }
});

async function scrapeEtnetLotSize(stockCode) {
  const { chromium } = require('playwright');
  const code = String(parseInt(stockCode)).padStart(4, '0');
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 800 },
    });
    const page = await context.newPage();
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });
    await page.goto('https://www.etnet.com.hk/www/sc/stocks/realtime/index.php', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await page.fill('#globalsearch', code);
    await page.press('#globalsearch', 'Enter');
    await page.waitForSelector("li:has-text('單位'), li:has-text('单位')", { timeout: 20000 });
    const value = await page.evaluate(() => {
      for (const li of document.querySelectorAll('li')) {
        const txt = li.textContent.trim();
        if (txt === '單位' || txt === '单位') {
          const sib = li.nextElementSibling;
          if (sib) {
            const n = parseInt(sib.textContent.trim().replace(/,/g, ''));
            return isNaN(n) ? null : n;
          }
        }
      }
      return null;
    });
    return value || null;
  } finally {
    await browser.close();
  }
}

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
