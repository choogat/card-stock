// จัดการผู้ใช้ (เฉพาะแอดมิน): GET รายชื่อ, POST สร้าง/แก้, DELETE ลบ
import { verify, loadUsers, saveUsers, ADMIN_ID, ALL_TABS } from '../lib/users.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-app-id, x-app-pass');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  if (!process.env.APP_PASSCODE) { res.status(500).json({ error: 'ยังไม่ได้ตั้งค่า APP_PASSCODE' }); return; }
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  const opts = token ? { token } : {};

  // ต้องเป็นแอดมินเท่านั้น
  const reqId = req.headers['x-app-id'] || '';
  const reqPass = req.headers['x-app-pass'] || '';
  try {
    const v = await verify(reqId, reqPass, opts);
    if (!v.ok || v.role !== 'admin') { res.status(403).json({ error: 'เฉพาะแอดมินเท่านั้น' }); return; }

    if (req.method === 'GET') {
      const users = await loadUsers(opts);
      res.status(200).json({ users: users.map(u => ({ id: u.id, tabs: u.tabs || [] })) });
      return;
    }

    if (req.method === 'POST') {
      let body = req.body;
      if (typeof body === 'string') body = JSON.parse(body || '{}');
      const id = (body.id || '').trim();
      if (!id) { res.status(400).json({ error: 'กรุณาระบุ ID' }); return; }
      if (id === ADMIN_ID) { res.status(400).json({ error: 'ใช้ ID นี้ไม่ได้ (สงวนไว้สำหรับแอดมิน)' }); return; }
      const tabs = Array.isArray(body.tabs) ? body.tabs.filter(t => ALL_TABS.includes(t)) : [];
      const users = await loadUsers(opts);
      const existing = users.find(u => u.id === id);
      if (existing) {
        if (body.password) existing.password = body.password;
        existing.tabs = tabs;
      } else {
        if (!body.password) { res.status(400).json({ error: 'กรุณาตั้งรหัสผ่าน' }); return; }
        users.push({ id, password: body.password, tabs });
      }
      await saveUsers(users, opts);
      res.status(200).json({ ok: true });
      return;
    }

    if (req.method === 'DELETE') {
      let body = req.body;
      if (typeof body === 'string') body = JSON.parse(body || '{}');
      const id = (body.id || req.query.id || '').trim();
      let users = await loadUsers(opts);
      users = users.filter(u => u.id !== id);
      await saveUsers(users, opts);
      res.status(200).json({ ok: true });
      return;
    }

    res.status(405).json({ error: 'method ไม่รองรับ' });
  } catch (err) {
    res.status(500).json({ error: 'เซิร์ฟเวอร์ผิดพลาด: ' + (err.message || err) });
  }
}
