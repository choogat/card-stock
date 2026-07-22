// เทสต์ตรรกะรวมทีละรายการ (lib/store.js) — รันด้วย: node merge.test.mjs
import { mergeItems } from './lib/store.js';
import assert from 'node:assert';

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log('  ok  ' + name); } catch (e) { fail++; console.log('FAIL  ' + name + '\n      ' + e.message); } };
const ids = (r) => r.items.map(x => x.id).sort().join(',');
const NOW = 1_000_000_000_000;

t('รายการใหม่จากอีกเครื่องไม่หาย (union ไม่ใช่เขียนทับ)', () => {
  const r = mergeItems([{ id: 'a', updatedAt: 1 }], [{ id: 'b', updatedAt: 2 }], [], [], NOW);
  assert.strictEqual(ids(r), 'a,b');
});

t('ตัวที่ updatedAt ใหม่กว่าชนะ', () => {
  const r = mergeItems([{ id: 'a', n: 'เก่า', updatedAt: 5 }], [{ id: 'a', n: 'ใหม่', updatedAt: 9 }], [], [], NOW);
  assert.strictEqual(r.items[0].n, 'ใหม่');
});

t('ตัวที่ updatedAt เก่ากว่าไม่ทับของใหม่', () => {
  const r = mergeItems([{ id: 'a', n: 'ใหม่', updatedAt: 9 }], [{ id: 'a', n: 'เก่า', updatedAt: 5 }], [], [], NOW);
  assert.strictEqual(r.items[0].n, 'ใหม่');
});

t('ข้อมูลเดิมที่ไม่มี updatedAt ถือเป็น 0 — ของที่แก้ใหม่ชนะ', () => {
  const r = mergeItems([{ id: 'a', n: 'เดิม' }], [{ id: 'a', n: 'แก้', updatedAt: 1 }], [], [], NOW);
  assert.strictEqual(r.items[0].n, 'แก้');
});

t('ลบแล้วไม่ฟื้น แม้อีกเครื่องยังส่งมา', () => {
  const r = mergeItems([], [{ id: 'a', updatedAt: NOW - 2000 }], [], [{ id: 'a', at: NOW - 1000 }], NOW);
  assert.strictEqual(r.items.length, 0);
  assert.strictEqual(r.tombstones.length, 1); // ต้องเก็บ tombstone ไว้กันฟื้นรอบหน้า
});

t('แก้หลังลบ = ฟื้นรายการ และทิ้ง tombstone', () => {
  const r = mergeItems([], [{ id: 'a', updatedAt: 20 }], [{ id: 'a', at: 10 }], [], NOW);
  assert.strictEqual(ids(r), 'a');
  assert.strictEqual(r.tombstones.length, 0);
});

t('tombstone เดิมยังกันของเก่าไม่ให้ฟื้น', () => {
  const r = mergeItems([], [{ id: 'a', updatedAt: 5 }], [{ id: 'a', at: 10 }], [], NOW);
  assert.strictEqual(r.items.length, 0);
});

t('tombstone เกิน 60 วันถูกล้างทิ้ง', () => {
  const old = NOW - 61 * 24 * 60 * 60 * 1000;
  const r = mergeItems([], [], [{ id: 'a', at: old }], [], NOW);
  assert.strictEqual(r.tombstones.length, 0);
});

t('รายการที่ไม่ได้ส่งมาใน payload ไม่ถูกลบ (กันเครื่องที่ข้อมูลเก่าลบของคนอื่น)', () => {
  const r = mergeItems([{ id: 'a' }, { id: 'b' }, { id: 'c' }], [{ id: 'a', updatedAt: 9 }], [], [], NOW);
  assert.strictEqual(ids(r), 'a,b,c');
});

t('รายการที่ไม่มี id ถูกข้าม ไม่ทำให้พัง', () => {
  const r = mergeItems([{ id: 'a' }], [null, {}, { id: null }, { id: 'b' }], [], [], NOW);
  assert.strictEqual(ids(r), 'a,b');
});

t('deletions ที่ไม่มี at ใช้เวลาปัจจุบัน', () => {
  const r = mergeItems([{ id: 'a', updatedAt: 5 }], [], [], [{ id: 'a' }], NOW);
  assert.strictEqual(r.items.length, 0);
});

t('สถานการณ์จริง: 2 เครื่องแก้คนละรายการพร้อมกัน ไม่มีใครหาย', () => {
  const server = [{ id: 'x', n: 'X', updatedAt: 1 }, { id: 'y', n: 'Y', updatedAt: 1 }];
  // เครื่อง A แก้ x (ยังมองเห็น y เวอร์ชันเก่า)
  const a = mergeItems(server, [{ id: 'x', n: 'X2', updatedAt: 10 }, { id: 'y', n: 'Y', updatedAt: 1 }], [], [], NOW);
  // เครื่อง B แก้ y (ยังถือ x เวอร์ชันเก่า) — ยิงตามหลัง
  const b = mergeItems(a.items, [{ id: 'x', n: 'X', updatedAt: 1 }, { id: 'y', n: 'Y2', updatedAt: 11 }], [], [], NOW);
  const m = Object.fromEntries(b.items.map(o => [o.id, o.n]));
  assert.deepStrictEqual(m, { x: 'X2', y: 'Y2' });
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
