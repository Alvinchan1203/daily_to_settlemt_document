const { Pool } = require('pg');
const fs = require('fs');
require('dotenv').config();

async function exportData() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  const records = await pool.query('SELECT * FROM records');
  const feeRecords = await pool.query('SELECT * FROM fee_records');

  const data = {
    records: records.rows,
    fee_records: feeRecords.rows
  };

  fs.writeFileSync('db_backup.json', JSON.stringify(data, null, 2));
  console.log(`匯出完成：${records.rows.length} 筆記錄，${feeRecords.rows.length} 筆費用記錄`);
  await pool.end();
}

exportData().catch(console.error);
