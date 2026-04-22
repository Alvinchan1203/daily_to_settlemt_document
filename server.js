const express = require('express');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(express.static('public'));

let db;

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

app.get('/api/health', (req, res) => {
  res.json({ ok: true, storage: process.env.DATABASE_URL ? 'postgresql' : 'json' });
});

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
