const { schedule } = require('@netlify/functions');
const https = require('https');
const XLSX = require('xlsx');
const { Pool } = require('pg');

const HKEX_URL = 'https://www.hkex.com.hk/eng/services/trading/securities/securitieslists/ListOfSecurities.xlsx';

function downloadBuffer(url) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    https.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.hkex.com.hk/' }
    }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return downloadBuffer(res.headers.location).then(resolve).catch(reject);
      }
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

// 每日香港時間早上9時（UTC+8 = UTC 01:00）更新
exports.handler = schedule('0 1 * * *', async () => {
  if (!process.env.DATABASE_URL) {
    return { statusCode: 200, body: 'No DATABASE_URL, skipped' };
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS lot_sizes (
        code INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        lot INTEGER NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    const buf = await downloadBuffer(HKEX_URL);
    const wb = XLSX.read(buf, { type: 'buffer', cellFormula: false, sheetStubs: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    ws['!ref'] = 'A1:R20000';
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

    let count = 0;
    for (const row of rows) {
      const code = String(row[0] || '').trim();
      const name = String(row[1] || '').trim();
      const category = String(row[2] || '').trim();
      const lot = parseInt(String(row[4] || '').replace(/,/g, ''));
      if (/^\d{5}$/.test(code) && category === 'Equity' && !isNaN(lot) && lot > 0) {
        await pool.query(
          `INSERT INTO lot_sizes (code, name, lot, updated_at) VALUES ($1, $2, $3, NOW())
           ON CONFLICT (code) DO UPDATE SET name = $2, lot = $3, updated_at = NOW()`,
          [parseInt(code), name, lot]
        );
        count++;
      }
    }

    console.log(`每手股數已更新：${count} 隻股票`);
    return { statusCode: 200, body: `Updated ${count} stocks` };
  } catch (err) {
    console.error('更新失敗:', err.message);
    return { statusCode: 500, body: err.message };
  } finally {
    await pool.end();
  }
});
