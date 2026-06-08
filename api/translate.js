// แปลข้อความผ่าน Google Translate (endpoint gtx — ไม่ต้องใช้ API key)
// GET /api/translate?q=...&sl=auto&tl=ja  ->  { text }
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  const q = (req.query.q || '').toString().trim();
  const tl = (req.query.tl || 'ja').toString();
  const sl = (req.query.sl || 'auto').toString();
  if (!q) { res.status(400).json({ error: 'กรุณาระบุ q' }); return; }

  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${encodeURIComponent(sl)}&tl=${encodeURIComponent(tl)}&dt=t&q=${encodeURIComponent(q)}`;
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!r.ok) { res.status(502).json({ error: 'แปลไม่สำเร็จ (' + r.status + ')' }); return; }
    const data = await r.json();
    // โครงสร้าง: [[[ "แปลแล้ว", "ต้นฉบับ", ... ], ...], ...]
    const text = (Array.isArray(data) && Array.isArray(data[0]))
      ? data[0].map(seg => (seg && seg[0]) || '').join('')
      : '';
    res.setHeader('Cache-Control', 's-maxage=604800, stale-while-revalidate'); // แคช 7 วัน
    res.status(200).json({ text, q, sl, tl });
  } catch (e) {
    res.status(500).json({ error: 'แปลผิดพลาด: ' + (e.message || e) });
  }
}
