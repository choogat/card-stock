// ดึงชื่อ + รูป Booster pack จากเว็บ One Piece Card Game (asia-th)
// เรียก: /api/onepiece?code=OP-01  → { found, code, name, image }
const BASE = 'https://asia-th.onepiece-cardgame.com';
const LIST = BASE + '/products/?subcategory=boosters&page=';

function normKey(code) {
  // "OP-01" / "op 01" / "op01" -> "op01"
  return (code || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  const want = normKey(req.query.code);
  if (!want) { res.status(400).json({ error: 'กรุณาระบุรหัส เช่น OP-01' }); return; }

  try {
    const map = {}; // key(op01) -> { name, code }
    for (let page = 1; page <= 4; page++) {
      const r = await fetch(LIST + page, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'th,en' } });
      if (!r.ok) break;
      const html = await r.text();
      const titles = [...html.matchAll(/class="linkListColTitle">([^<]+)</g)].map(m => m[1]);
      if (!titles.length) break;
      for (let t of titles) {
        t = t.replace(/&#0?39;/g, "'").replace(/&amp;/g, '&').trim();
        const m = t.match(/\[([A-Za-z]+-?\d+)\]/);
        if (!m) continue;
        const key = normKey(m[1]);
        if (!map[key]) map[key] = { name: t, code: m[1].toUpperCase() };
      }
      if (map[want]) break; // เจอแล้วหยุด
    }

    const hit = map[want];
    if (!hit) { res.status(404).json({ found: false, error: 'ไม่พบรหัสนี้ในเว็บ One Piece' }); return; }

    // รูปแบบพาธรูปแน่นอน: /boosters/<key>/img_item01.webp
    const image = `${BASE}/renewal/images/products/boosters/${want}/img_item01.webp`;
    let img = '';
    try {
      const ir = await fetch(image, { method: 'HEAD', headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (ir.ok) img = image;
    } catch (_) {}

    res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate');
    res.status(200).json({ found: true, code: hit.code, name: hit.name, image: img });
  } catch (err) {
    res.status(500).json({ error: 'ดึงข้อมูลไม่สำเร็จ: ' + (err.message || err) });
  }
}
