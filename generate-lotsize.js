const https = require('https');
const fs = require('fs');
const XLSX = require('xlsx');

const URL = 'https://www.hkex.com.hk/eng/services/trading/securities/securitieslists/ListOfSecurities.xlsx';
const OUTPUT = 'lotsize_data.json';

function download(url) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Referer': 'https://www.hkex.com.hk/'
      }
    };
    https.get(url, options, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return download(res.headers.location).then(resolve).catch(reject);
      }
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

async function generate() {
  console.log('下載 HKEX 證券列表...');
  const buf = await download(URL);

  const wb = XLSX.read(buf, { type: 'buffer', cellFormula: false, cellHTML: false, sheetStubs: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  ws['!ref'] = 'A1:R20000';
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  const lotSizes = {};
  let count = 0;
  for (const row of rows) {
    const code = String(row[0] || '').trim();
    const name = String(row[1] || '').trim();
    const category = String(row[2] || '').trim();
    const lot = parseInt(String(row[4] || '').replace(/,/g, ''));
    if (/^\d{5}$/.test(code) && name && !isNaN(lot) && lot > 0) {
      lotSizes[parseInt(code)] = { name, lot };
      count++;
    }
  }

  fs.writeFileSync(OUTPUT, JSON.stringify(lotSizes));
  console.log(`完成：${count} 隻股票已更新 (${new Date().toLocaleDateString('zh-HK')})`);
}

generate().catch(err => {
  console.error('更新失敗，使用現有數據:', err.message);
  process.exit(0); // 不讓 build 失敗，繼續用舊數據
});
