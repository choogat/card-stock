// Proxy รูปจากเว็บ One Piece ผ่านโดเมนเราเอง (กันปัญหาโหลดข้ามโดเมน + ใช้ฝังเป็น base64)
// เรียก: /api/opimg?url=https://asia-th.onepiece-cardgame.com/.../img_item01.webp
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  const url = req.query.url || '';
  if (!url.startsWith('https://asia-th.onepiece-cardgame.com/')) {
    res.status(400).json({ error: 'URL ไม่ถูกต้อง' });
    return;
  }
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://asia-th.onepiece-cardgame.com/' } });
    if (!r.ok) { res.status(502).end(); return; }
    const ct = r.headers.get('content-type') || 'image/webp';
    const buf = Buffer.from(await r.arrayBuffer());
    res.setHeader('Content-Type', ct);
    res.setHeader('Cache-Control', 's-maxage=604800, stale-while-revalidate');
    res.status(200).send(buf);
  } catch (err) {
    res.status(500).json({ error: 'โหลดรูปไม่สำเร็จ' });
  }
}
