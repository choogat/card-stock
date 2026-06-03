// Vercel Serverless Function — เก็บ/อ่านข้อมูลการ์ดบนเซิร์ฟเวอร์กลาง (Vercel Blob)
// GET  /api/cards   -> { cards: [...] }          (ต้องมีรหัสผ่าน)
// POST /api/cards   body = [...]  -> { ok, count } (ต้องมีรหัสผ่าน)
//
// ความปลอดภัย: ต้องส่งรหัสผ่านมาใน header  x-app-pass  ให้ตรงกับ env APP_PASSCODE
// ข้อมูลเก็บใน Vercel Blob ผ่าน BLOB_READ_WRITE_TOKEN (ฝั่งเซิร์ฟเวอร์เท่านั้น)

import { put, list } from '@vercel/blob';

const PATH = 'cards.json';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-app-pass');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  const expected = process.env.APP_PASSCODE;
  if (!expected) { res.status(500).json({ error: 'ยังไม่ได้ตั้งค่า APP_PASSCODE' }); return; }

  // v2 ของ @vercel/blob จะใช้ store ที่เชื่อมกับโปรเจกต์อัตโนมัติ (ผ่าน BLOB_STORE_ID)
  // ถ้ามี static token ก็ใช้ได้ ไม่มีก็ปล่อยให้ SDK จัดการเอง
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  const opts = token ? { token } : {};

  // ตรวจรหัสผ่าน
  const pass = req.headers['x-app-pass'] || req.query.pass || '';
  if (pass !== expected) { res.status(401).json({ error: 'รหัสผ่านไม่ถูกต้อง' }); return; }

  try {
    if (req.method === 'GET') {
      const { blobs } = await list({ prefix: PATH, ...opts });
      const b = blobs.find(x => x.pathname === PATH);
      if (!b) { res.status(200).json({ cards: [] }); return; }
      const r = await fetch(b.url + '?t=' + Date.now(), { cache: 'no-store' });
      const cards = await r.json();
      res.status(200).json({ cards: Array.isArray(cards) ? cards : [] });
      return;
    }

    if (req.method === 'POST') {
      let body = req.body;
      if (typeof body === 'string') body = JSON.parse(body || '[]');
      if (!Array.isArray(body)) { res.status(400).json({ error: 'ข้อมูลต้องเป็น array' }); return; }
      await put(PATH, JSON.stringify(body), {
        access: 'public',
        contentType: 'application/json',
        addRandomSuffix: false,
        allowOverwrite: true,
        cacheControlMaxAge: 0,
        ...opts,
      });
      res.status(200).json({ ok: true, count: body.length });
      return;
    }

    res.status(405).json({ error: 'method ไม่รองรับ' });
  } catch (err) {
    res.status(500).json({ error: 'เซิร์ฟเวอร์ผิดพลาด: ' + (err.message || err) });
  }
}
