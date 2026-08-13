// Vercel Serverless Function — รายงานการใช้งาน (activity log)
// GET  /api/activity  -> { logs: [...] }                        (ต้องมีรหัสผ่าน)
// POST /api/activity  -> { ok, count, logs }                    (ต้องมีรหัสผ่าน)
//
// ใช้ตรรกะเดียวกับชุดข้อมูลอื่น (lib/store.js): รวมทีละรายการตาม id + tombstone
// log เป็นแบบ "เขียนเพิ่มอย่างเดียว" (append-only) ไม่มีการแก้รายการเดิม → merge ไม่มีทางชนกัน
// การลบเกิดจากการตัดของเก่าทิ้งตามอายุ/จำนวนสูงสุดเท่านั้น (ฝั่ง client ส่ง deletions มาให้)

import { handleStore } from '../lib/store.js';

export default function handler(req, res) {
  return handleStore(req, res, { path: 'activity.json', key: 'logs' });
}
