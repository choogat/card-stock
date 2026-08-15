// ทดสอบตัวบอก "กำลังคุยกับเซิร์ฟเวอร์" — ดึงโค้ดจริงออกมาจาก index.html
// รัน: node test-busy.mjs
import fs from 'node:fs';
import assert from 'node:assert';

const html = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const start = html.indexOf('// ================= ตัวบอกว่ากำลังคุยกับเซิร์ฟเวอร์ =================');
const end = html.indexOf('// ---- ซิงก์กับเซิร์ฟเวอร์ ----');
assert.ok(start > 0 && end > start, 'หาบล็อกโค้ดตัวบอกสถานะโหลดไม่เจอ');

const stubs = `
const els = {};
const mkEl = () => ({ _cls: new Set(), textContent: '',
  classList: { add(c){ this._o._cls.add(c); }, remove(c){ this._o._cls.delete(c); }, contains(c){ return this._o._cls.has(c); } } });
for (const id of ['busyPill', 'busyText']) { const e = mkEl(); e.classList._o = e; els[id] = e; }
const document = { getElementById: id => els[id] || null };
const calls = [];
const window = { fetch: (url, init) => { calls.push(url); return (init && init.__fail) ? Promise.reject(new Error('net')) : Promise.resolve({ ok: true, url }); } };
window.fetch.bind = function(){ return window.fetch; };
`;

const mod = await import('data:text/javascript;base64,' + Buffer.from(
  stubs + html.slice(start, end)
  + '\nexport { busyStart, busyEnd, runBusy };'
  + '\nexport const fetch2 = (u, i) => window.fetch(u, i);'
  + '\nexport const pillOn = () => els.busyPill.classList.contains("on");'
  + '\nexport const pillText = () => els.busyText.textContent;'
  + '\nexport const busyCount = () => _busyN;',
).toString('base64'));

let pass = 0, fail = 0;
const ta = async (name, fn) => { try { await fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + e.message); } };
const wait = ms => new Promise(r => setTimeout(r, ms));

console.log('\nตัวหมุนตอนคุยกับเซิร์ฟเวอร์');

await ta('ทุกการยิงเซิร์ฟเวอร์ถูกนับอัตโนมัติ ไม่ต้องไล่ใส่ทีละที่', async () => {
  const p = mod.fetch2('/api/cards');
  assert.equal(mod.busyCount(), 1, 'เริ่มยิง = ต้องนับขึ้น');
  await p;
  assert.equal(mod.busyCount(), 0, 'ยิงเสร็จ = ต้องนับลง');
});

await ta('งานเร็วกว่า 250ms ไม่ต้องโชว์ป้าย (กันกะพริบถี่)', async () => {
  await mod.fetch2('/api/cards');
  await wait(60);
  assert.equal(mod.pillOn(), false);
});

await ta('งานที่ช้าเกิน 250ms โชว์ป้ายหมุน แล้วหายเองเมื่อเสร็จ', async () => {
  mod.busyStart('/api/cards');
  await wait(320);
  assert.equal(mod.pillOn(), true, 'ต้องขึ้นป้าย');
  mod.busyEnd();
  assert.equal(mod.pillOn(), false, 'เสร็จแล้วต้องหาย');
});

await ta('ยิงพร้อมกันหลายอัน ป้ายหายเมื่ออันสุดท้ายเสร็จ ไม่ใช่อันแรก', async () => {
  mod.busyStart('/api/cards'); mod.busyStart('/api/gacha'); mod.busyStart('/api/shops');
  await wait(320);
  assert.equal(mod.pillOn(), true);
  mod.busyEnd(); mod.busyEnd();
  assert.equal(mod.pillOn(), true, 'ยังเหลืออีกงาน ป้ายต้องยังอยู่');
  mod.busyEnd();
  assert.equal(mod.pillOn(), false);
});

await ta('ยิงแล้วเน็ตล่ม ป้ายต้องไม่ค้างบนจอ', async () => {
  await mod.fetch2('/api/cards', { __fail: true }).catch(() => {});
  assert.equal(mod.busyCount(), 0, 'ล้มเหลวก็ต้องนับลง ไม่งั้นป้ายค้างตลอดกาล');
  assert.equal(mod.pillOn(), false);
});

await ta('ข้อความบนป้ายบอกว่ากำลังทำอะไรอยู่', async () => {
  mod.busyStart('/api/upload'); assert.equal(mod.pillText(), 'กำลังอัปโหลดรูป'); mod.busyEnd();
  mod.busyStart('/api/psa?cert=1'); assert.equal(mod.pillText(), 'กำลังดึงข้อมูลการ์ด'); mod.busyEnd();
  mod.busyStart('/api/cards'); assert.equal(mod.pillText(), 'กำลังโหลด'); mod.busyEnd();
});

console.log('\nปุ่มกันกดซ้ำ');

await ta('กดปุ่มค้างอยู่ กดซ้ำต้องไม่ทำงานรอบสอง', async () => {
  const btn = { _cls: new Set() };
  btn.classList = { add: c => btn._cls.add(c), remove: c => btn._cls.delete(c), contains: c => btn._cls.has(c) };
  let ran = 0;
  const slow = () => { ran++; return wait(80); };
  const first = mod.runBusy(btn, slow);
  assert.equal(btn._cls.has('is-busy'), true, 'ระหว่างทำงานต้องล็อกปุ่ม');
  await mod.runBusy(btn, slow);          // กดซ้ำระหว่างรอ
  await first;
  assert.equal(ran, 1, 'ต้องทำงานรอบเดียว');
  assert.equal(btn._cls.has('is-busy'), false, 'เสร็จแล้วต้องปลดล็อก');
});

await ta('งานพัง ปุ่มต้องปลดล็อกเสมอ ไม่ค้างกดไม่ได้', async () => {
  const btn = { _cls: new Set() };
  btn.classList = { add: c => btn._cls.add(c), remove: c => btn._cls.delete(c), contains: c => btn._cls.has(c) };
  await mod.runBusy(btn, () => { throw new Error('พัง'); }).catch(() => {});
  assert.equal(btn._cls.has('is-busy'), false);
});

console.log(`\n${fail ? '✗' : '✓'} ผ่าน ${pass} / ${pass + fail}\n`);
process.exit(fail ? 1 : 0);
