// Vercel Serverless Function — เก็บ/อ่านข้อมูล "พรีออเดอร์" บนเซิร์ฟเวอร์กลาง (Vercel Blob)
// GET  /api/preorder   -> { orders: [...] }                      (ต้องมีรหัสผ่าน)
// POST /api/preorder   body = { items:[...], deletions:[...] }    (ต้องมีรหัสผ่าน)
//                      -> { ok, count, orders }
//
// รวมทีละรายการ + tombstone ผ่าน lib/store.js กันของหายเมื่อแก้หลายเครื่อง
// ความปลอดภัย: ต้องส่ง id + รหัสผ่านมาใน header x-app-id / x-app-pass (ตรวจผ่าน lib/users.js)

import { handleStore } from '../lib/store.js';

export default function handler(req, res) {
  return handleStore(req, res, { path: 'preorder.json', key: 'orders' });
}
