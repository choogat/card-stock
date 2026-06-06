// ตรวจสอบล็อกอิน → คืน role + tabs (สิทธิ์เข้าแถบ)
import { verify } from '../lib/users.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-app-id, x-app-pass');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  if (!process.env.APP_PASSCODE) { res.status(500).json({ error: 'ยังไม่ได้ตั้งค่า APP_PASSCODE' }); return; }
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  const opts = token ? { token } : {};

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body || '{}'); } catch { body = {}; } }
  const id = (body && body.id) || req.headers['x-app-id'] || '';
  const pass = (body && body.password) || req.headers['x-app-pass'] || '';

  try {
    const v = await verify(id, pass, opts);
    if (!v.ok) { res.status(401).json({ error: 'ID หรือรหัสผ่านไม่ถูกต้อง' }); return; }
    res.status(200).json({ ok: true, id: v.id, role: v.role, tabs: v.tabs, seeProfit: v.seeProfit });
  } catch (err) {
    res.status(500).json({ error: 'เซิร์ฟเวอร์ผิดพลาด: ' + (err.message || err) });
  }
}
