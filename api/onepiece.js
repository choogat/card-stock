// ดึงชื่อ + รูป สินค้า One Piece Card Game (asia-th) — boosters + others
// เรียก: /api/onepiece?q=OP-01  หรือ  ?q=sleeve  → { found, results: [{name, image, code}] }
const BASE = 'https://asia-th.onepiece-cardgame.com';
const CATS = ['boosters', 'others'];

function norm(s) { return (s || '').toLowerCase().replace(/[^a-z0-9ก-๙]+/g, ' ').trim(); }
function keyOf(s) { return (s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
function decode(s) {
  return (s || '').replace(/&#0?39;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?34;/g, '"').trim();
}

async function loadItems() {
  const items = [];
  const seen = new Set();
  for (const cat of CATS) {
    for (let page = 1; page <= 5; page++) {
      let html;
      try {
        const r = await fetch(`${BASE}/products/?subcategory=${cat}&page=${page}`, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'th,en' } });
        if (!r.ok) break;
        html = await r.text();
      } catch (_) { break; }
      // จับคู่รูป (data-src) กับชื่อ (linkListColTitle) ในบล็อกเดียวกัน
      const re = /data-src="([^"]*renewal\/images\/products\/[^"]+\.webp)[^"]*"[\s\S]*?linkListColTitle">([^<]+)</g;
      let m, found = 0;
      while ((m = re.exec(html)) !== null) {
        found++;
        let img = m[1]; if (img.startsWith('/')) img = BASE + img;
        const cleanImg = img.split('?')[0];
        if (seen.has(cleanImg)) continue;
        seen.add(cleanImg);
        const name = decode(m[2]);
        const cm = name.match(/\[([A-Za-z]+-?\d+)\]/);
        items.push({ name, image: cleanImg, code: cm ? cm[1].toUpperCase() : '' });
      }
      if (!found) break;
    }
  }
  return items;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  const q = (req.query.q || req.query.code || '').trim();
  if (!q) { res.status(400).json({ error: 'กรุณาระบุรหัสหรือชื่อบางส่วน' }); return; }

  try {
    const items = await loadItems();
    const qk = keyOf(q);
    const words = norm(q).split(' ').filter(Boolean);

    // ตรงรหัสเป๊ะมาก่อน
    let results = items.filter(it => it.code && keyOf(it.code) === qk);
    if (!results.length) {
      // ค้นด้วยชื่อ: ต้องมี "ทุกคำ" ที่พิมพ์อยู่ในชื่อ (หรือรหัส)
      results = items.filter(it => {
        const hay = norm(it.name + ' ' + it.code);
        return words.every(w => hay.includes(w));
      });
    }

    res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate');
    if (!results.length) { res.status(200).json({ found: false, results: [] }); return; }
    res.status(200).json({ found: true, results: results.slice(0, 20) });
  } catch (err) {
    res.status(500).json({ error: 'ดึงข้อมูลไม่สำเร็จ: ' + (err.message || err) });
  }
}
