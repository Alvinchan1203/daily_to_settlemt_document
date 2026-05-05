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

async function run() {
  if (!process.env.DATABASE_URL) {
    console.log('No DATABASE_URL, skipped');
    return;
  }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS lot_sizes (
        code INTEGER PRIMARY KEY, name TEXT NOT NULL, lot INTEGER NOT NULL, updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    const buf = await downloadBuffer(HKEX_URL);
    const wb = XLSX.read(buf, { type: 'buffer', cellFormula: false, sheetStubs: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    ws['!ref'] = 'A1:R20000';
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

    const stocks = [];
    for (const row of rows) {
      const code = String(row[0] || '').trim();
      const name = String(row[1] || '').trim();
      const lot = parseInt(String(row[4] || '').replace(/,/g, ''));
      if (/^\d{5}$/.test(code) && name && !isNaN(lot) && lot > 0) {
        stocks.push([parseInt(code), name, lot]);
      }
    }

    const BATCH = 500;
    for (let i = 0; i < stocks.length; i += BATCH) {
      const batch = stocks.slice(i, i + BATCH);
      const values = batch.map((_, j) => `($${j * 3 + 1}, $${j * 3 + 2}, $${j * 3 + 3}, NOW())`).join(',');
      await pool.query(
        `INSERT INTO lot_sizes (code, name, lot, updated_at) VALUES ${values}
         ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, lot = EXCLUDED.lot, updated_at = NOW()`,
        batch.flat()
      );
    }
    console.log(`Updated ${stocks.length} stocks`);
  } finally {
    await pool.end();
  }
}

run().catch(err => { console.error(err.message); process.exit(1); });
