const { Pool } = require('pg');
const fs = require('fs');

const NEON_URL = process.argv[2];
if (!NEON_URL) { console.error('用法: node import_db.js "連接字串"'); process.exit(1); }

async function importData() {
  const pool = new Pool({ connectionString: NEON_URL, ssl: { rejectUnauthorized: false } });
  const data = JSON.parse(fs.readFileSync('db_backup.json', 'utf-8'));

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
      total_shares INTEGER,
      total_fee NUMERIC,
      hkscc_fee NUMERIC,
      company_fee NUMERIC
    )
  `);

  for (const r of data.records) {
    await pool.query(
      'INSERT INTO records (record_id, date_field, account, biz_type) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING',
      [r.record_id, r.date_field, r.account, r.biz_type]
    );
  }
  console.log(`已匯入 ${data.records.length} 筆走袋記錄`);

  for (const r of data.fee_records) {
    await pool.query(
      `INSERT INTO fee_records (record_id, date_field, account, stock_code, lot_size, mode, total_shares, total_fee, hkscc_fee, company_fee)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING`,
      [r.record_id, r.date_field, r.account, r.stock_code, r.lot_size, r.mode,
       r.total_shares || null, r.total_fee, r.hkscc_fee, r.company_fee]
    );
  }
  console.log(`已匯入 ${data.fee_records.length} 筆費用記錄`);

  await pool.end();
  console.log('完成！');
}

importData().catch(console.error);
