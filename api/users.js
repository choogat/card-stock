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
      res.status(200).json({ users: users.map(u => ({ id: u.id, tabs: u.tabs || [], seeProfit: u.seeProfit !== false, seeTotals: u.seeTotals !== false, gachaEdit: u.gachaEdit === true, buyEdit: u.buyEdit === true, shops: Array.isArray(u.shops) ? u.shops : [], shopFeats: (u.shopFeats && typeof u.shopFeats === 'object') ? u.shopFeats : {} })) });
      return;
    }

    if (req.method === 'POST') {
      let body = req.body;
      if (typeof body === 'string') body = JSON.parse(body || '{}');
      const id = (body.id || '').trim();
      if (!id) { res.status(400).json({ error: 'กรุณาระบุ ID' }); return; }
      if (id === ADMIN_ID) { res.status(400).json({ error: 'ใช้ ID นี้ไม่ได้ (สงวนไว้สำหรับแอดมิน)' }); return; }
      const tabs = Array.isArray(body.tabs) ? body.tabs.filter(t => ALL_TABS.includes(t)) : [];
      const seeProfit = body.seeProfit !== false;
      const seeTotals = body.seeTotals !== false;
      const gachaEdit = body.gachaEdit === true;
      const buyEdit = body.buyEdit === true;
      // ร้านที่เข้าได้ (array ของ shopId) — ว่าง = ทุกร้าน
      const shops = Array.isArray(body.shops) ? body.shops.map(s => String(s)).filter(Boolean) : [];
      // ฟังก์ชันที่เข้าได้ต่อร้าน { shopId: ['sales','report',...] }
      let shopFeats = {};
      if (body.shopFeats && typeof body.shopFeats === 'object') {
        for (const k of Object.keys(body.shopFeats)) {
          if (Array.isArray(body.shopFeats[k])) shopFeats[k] = body.shopFeats[k].map(x => String(x)).filter(Boolean);
        }
      }
      const users = await loadUsers(opts);
      const existing = users.find(u => u.id === id);
      if (existing) {
        if (body.password) existing.password = body.password;
        existing.tabs = tabs;
        existing.seeProfit = seeProfit;
        existing.seeTotals = seeTotals;
        existing.gachaEdit = gachaEdit;
        existing.buyEdit = buyEdit;
        existing.shops = shops;
        existing.shopFeats = shopFeats;
      } else {
        if (!body.password) { res.status(400).json({ error: 'กรุณาตั้งรหัสผ่าน' }); return; }
        users.push({ id, password: body.password, tabs, seeProfit, seeTotals, gachaEdit, buyEdit, shops, shopFeats });
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
