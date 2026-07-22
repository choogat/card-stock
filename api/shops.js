// Vercel Serverless Function — เก็บ/อ่านรายชื่อ "ร้านค้า" บนเซิร์ฟเวอร์กลาง (Vercel Blob)
// GET  /api/shops   -> { shops: [...] }                       (ต้องมีรหัสผ่าน)
// POST /api/shops   body = { items:[...], deletions:[...] }   (ต้องมีรหัสผ่าน)
//                   -> { ok, count, shops }
//
// รวมทีละรายการ + tombstone ผ่าน lib/store.js กันของหายเมื่อแก้หลายเครื่อง
// ความปลอดภัย: ต้องส่ง id + รหัสผ่านมาใน header x-app-id / x-app-pass (ตรวจผ่าน lib/users.js)

import { handleStore } from '../lib/store.js';

export default function handler(req, res) {
  return handleStore(req, res, { path: 'shops.json', key: 'shops' });
}
