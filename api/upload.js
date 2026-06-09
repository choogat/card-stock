// Vercel Serverless Function — อัปโหลดรูปการ์ด 1 รูปเก็บเป็นไฟล์แยกใน Vercel Blob
// (กัน cards.json บวมจากรูป base64 จนเกินลิมิต request body ~4.5MB → 413)
//
// POST /api/upload  body = { data: "data:image/jpeg;base64,....", id?: "..." }
// คืนค่า: { url }   (URL สาธารณะของรูปบน Blob — เก็บลงช่อง image ของการ์ดแทน base64)

import { put } from '@vercel/blob';
import { verify } from '../lib/users.js';

const EXT = { 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
const MAX_BYTES = 4 * 1024 * 1024; // กันรูปใหญ่เกิน (ปกติย่อแล้ว < 100KB)

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-app-id, x-app-pass');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'method ไม่รองรับ' }); return; }

  if (!process.env.APP_PASSCODE) { res.status(500).json({ error: 'ยังไม่ได้ตั้งค่า APP_PASSCODE' }); return; }
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  const opts = token ? { token } : {};

  // ตรวจสิทธิ์ (เหมือน /api/cards)
  const auth = await verify(req.headers['x-app-id'] || '', req.headers['x-app-pass'] || '', opts);
  if (!auth.ok) { res.status(401).json({ error: 'ID หรือรหัสผ่านไม่ถูกต้อง' }); return; }

  try {
    let body = req.body;
    if (typeof body === 'string') body = JSON.parse(body || '{}');
    const data = (body && body.data) || '';
    const m = /^data:([^;]+);base64,(.+)$/s.exec(data);
    if (!m) { res.status(400).json({ error: 'ต้องส่งรูปแบบ data URL (base64)' }); return; }
    const mime = m[1].toLowerCase();
    const ext = EXT[mime];
    if (!ext) { res.status(400).json({ error: 'ชนิดรูปไม่รองรับ: ' + mime }); return; }
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > MAX_BYTES) { res.status(413).json({ error: 'รูปใหญ่เกินไป' }); return; }

    const safeId = String((body && body.id) || '').replace(/[^a-zA-Z0-9_-]/g, '');
    const name = (safeId || (Date.now().toString(36) + Math.random().toString(36).slice(2, 8)));
    const blob = await put(`card-img/${name}.${ext}`, buf, {
      access: 'public', contentType: mime,
      addRandomSuffix: false, allowOverwrite: true, ...opts,
    });
    res.status(200).json({ url: blob.url });
  } catch (err) {
    res.status(500).json({ error: 'อัปโหลดรูปไม่สำเร็จ: ' + (err.message || err) });
  }
}
