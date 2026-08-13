// ทดสอบเครื่องบันทึก "รายงานการใช้งาน" — ดึงโค้ดจริงออกมาจาก index.html แล้วรันในสภาพแวดล้อมจำลอง
// รัน: node test-activity.mjs
import fs from 'node:fs';
import assert from 'node:assert';

const html = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const start = html.indexOf('// ================= รายงานการใช้งาน (activity log) =================');
const end = html.indexOf('function money(n) {');
assert.ok(start > 0 && end > start, 'หาบล็อกโค้ดรายงานการใช้งานใน index.html ไม่เจอ');
const src = html.slice(start, end);

// ---- สภาพแวดล้อมจำลองเท่าที่โค้ดบล็อกนี้ใช้ ----
const stubs = `
const STATUS = { show:{label:'สะสม'}, wait:{label:'รอขาย'}, sold:{label:'ขายแล้ว'} };
const PAYMENT = { cash:'เงินสด', transfer:'เงินโอน' };
let shops = [{ id:'s1', name:'สาขา 2' }];
let gachaBoxes = [{ id:'g1', name:'ตู้ A' }];
function shopById(id){ return shops.find(s => s.id === id); }
function fmtDate(d){ return d ? d.split('-').reverse().join('/') : ''; }
function money(n){ return '฿' + (Number(n)||0).toLocaleString('th-TH',{maximumFractionDigits:0}); }
let _uid = 0;
function uid(){ return 'u' + (++_uid); }
function isViewVisible(){ return false; }
function renderActivity(){}
let passcode = 'x', loginId = 'Cielcard';
let cards = [];
let _cardSnap = new Map();
const localStorage = { _d:{}, getItem(k){ return this._d[k] ?? null; }, setItem(k,v){ this._d[k]=String(v); }, removeItem(k){ delete this._d[k]; } };
const pushed = [];
function makeSyncStore(){ return { save(){ pushed.push('save'); }, recordDeletion(id){ pushed.push('del:'+id); },
  async pull(){ return true; }, flush(){}, hasPending(){ return false; }, snapshot(){}, async push(){ return true; } }; }
const ACTIVITY_API = '/api/activity';
`;

const mod = await import('data:text/javascript;base64,' + Buffer.from(
  stubs + src + '\nexport { activityLogs, logCardChange, logCardDeleted, actDiff, actKindOf, actVal, actPrune, seedActivityFromCards, _cardSnap, cards, ACT_MAX };'
    + '\nexport const setCards = (v) => { cards = v; };'
    + '\nexport const setSnap = (v) => { _cardSnap = v; };'
    + '\nexport const getLogs = () => activityLogs;'
    + '\nexport const resetLogs = () => { activityLogs = []; };'
    + '\nexport const ls = localStorage;',
).toString('base64'));

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + e.message); } };
const body = (c) => { const { updatedAt, ...rest } = c; return JSON.stringify(rest); };
const last = () => mod.getLogs()[mod.getLogs().length - 1];

console.log('\nการจำแนกเหตุการณ์');

t('การ์ดใบใหม่ = เพิ่มการ์ด พร้อมราคา/สถานะ', () => {
  mod.resetLogs();
  const c = { id: 'c1', name: 'Luffy', topic: 'One Piece', buy: 500, sell: 900, status: 'show', qty: 1 };
  assert.equal(mod.logCardChange(undefined, c), true);
  const e = last();
  assert.equal(e.act, 'add');
  assert.equal(e.name, 'Luffy');
  assert.deepEqual(e.changes.map(x => x.label + ' ' + x.to), ['ราคารับซื้อ ฿500', 'ราคาขาย ฿900', 'สถานะ สะสม']);
});

t('ติ๊กเช็คของอย่างเดียว = เช็คของ (ของไม่มี → มีของ)', () => {
  mod.resetLogs();
  const prev = { id: 'c1', name: 'Luffy', status: 'show' };
  const cur = { ...prev, inStock: true };
  mod.logCardChange(body(prev), cur);
  const e = last();
  assert.equal(e.act, 'stock');
  assert.equal(e.changes.length, 1);
  assert.equal(e.changes[0].from, 'ของไม่มี');
  assert.equal(e.changes[0].to, 'มีของ');
});

t('สะสม → รอขาย = เข้าสินค้าขาย พร้อมชื่อร้าน', () => {
  mod.resetLogs();
  const prev = { id: 'c1', name: 'Luffy', status: 'show', shopId: '' };
  mod.logCardChange(body(prev), { ...prev, status: 'wait', shopId: 's1' });
  const e = last();
  assert.equal(e.act, 'tosale');
  assert.ok(e.changes.some(x => x.label === 'ร้านค้า' && x.to === 'สาขา 2'), 'ต้องบอกร้านปลายทาง');
});

t('รอขาย → สะสม = ออกจากสินค้าขาย', () => {
  mod.resetLogs();
  const prev = { id: 'c1', name: 'Luffy', status: 'wait' };
  mod.logCardChange(body(prev), { ...prev, status: 'show' });
  assert.equal(last().act, 'untosale');
});

t('→ ขายแล้ว = ขายแล้ว พร้อมราคาสุทธิ/ส่วนลด/ช่องทางจ่าย', () => {
  mod.resetLogs();
  const prev = { id: 'c1', name: 'Luffy', status: 'wait', sell: 900 };
  mod.logCardChange(body(prev), { ...prev, status: 'sold', sell: 3000, discount: 200, payment: 'transfer', sellDate: '2026-08-14' });
  const e = last();
  assert.equal(e.act, 'sell');
  const lbl = e.changes.map(x => x.label);
  assert.ok(lbl.includes('ราคาขาย') && lbl.includes('ส่วนลด') && lbl.includes('ชำระโดย'));
  assert.equal(e.changes.find(x => x.label === 'ชำระโดย').to, 'เงินโอน');
  assert.equal(e.changes.find(x => x.label === 'วันที่ขาย').to, '14/08/2026');
});

t('ขายแล้ว → รอขาย = ยกเลิกการขาย', () => {
  mod.resetLogs();
  const prev = { id: 'c1', name: 'Luffy', status: 'sold' };
  mod.logCardChange(body(prev), { ...prev, status: 'wait' });
  assert.equal(last().act, 'unsell');
});

t('แก้ราคา = แก้ไขการ์ด บอกจากเท่าไหร่เป็นเท่าไหร่', () => {
  mod.resetLogs();
  const prev = { id: 'c1', name: 'Luffy', status: 'show', sell: 500 };
  mod.logCardChange(body(prev), { ...prev, sell: 600 });
  const e = last();
  assert.equal(e.act, 'edit');
  assert.deepEqual(e.changes, [{ k: 'sell', label: 'ราคาขาย', from: '฿500', to: '฿600' }]);
});

console.log('\nสิ่งที่ต้องไม่ขึ้นรายงาน');

t('ไม่มีอะไรเปลี่ยน = ไม่บันทึก', () => {
  mod.resetLogs();
  const prev = { id: 'c1', name: 'Luffy', status: 'show' };
  assert.equal(mod.logCardChange(body(prev), { ...prev }), false);
  assert.equal(mod.getLogs().length, 0);
});

t('เปลี่ยนแต่ฟิลด์ภายใน (ไม่อยู่ในรายชื่อ) = ไม่บันทึก', () => {
  mod.resetLogs();
  const prev = { id: 'c1', name: 'Luffy', status: 'show' };
  assert.equal(mod.logCardChange(body(prev), { ...prev, _tmpFlag: 1 }), false);
});

t('ระบบย้ายรูป base64 ขึ้น Blob เอง = ไม่บันทึกว่าคนแก้รูป', () => {
  mod.resetLogs();
  const prev = { id: 'c1', name: 'Luffy', status: 'show', image: 'data:image/png;base64,AAA' };
  assert.equal(mod.logCardChange(body(prev), { ...prev, image: 'https://blob/x.png' }), false);
});

t('คนเปลี่ยนรูปเองจริง ๆ = บันทึก', () => {
  mod.resetLogs();
  const prev = { id: 'c1', name: 'Luffy', status: 'show', image: '' };
  assert.equal(mod.logCardChange(body(prev), { ...prev, image: 'https://blob/x.png' }), true);
  assert.equal(last().changes[0].label, 'รูป');
});

console.log('\nการลบ + การตัดของเก่า');

t('ลบการ์ด = บันทึกชื่อ/ราคาไว้ก่อนใบหายไป และล้าง snapshot', () => {
  mod.resetLogs();
  const snap = new Map();
  snap.set('c1', body({ id: 'c1', name: 'Luffy', topic: 'One Piece', status: 'wait', sell: 900 }));
  mod.setSnap(snap);
  mod.logCardDeleted('c1');
  const e = last();
  assert.equal(e.act, 'del');
  assert.equal(e.name, 'Luffy');
  assert.ok(e.changes.some(x => x.to === '฿900'));
  assert.equal(snap.has('c1'), false, 'ต้องลบออกจาก snapshot ด้วย');
});

t('ตัดของเก่าเกิน 180 วันทิ้ง + ส่ง tombstone', () => {
  mod.resetLogs();
  const now = Date.now();
  const logs = mod.getLogs();
  logs.push({ id: 'old', at: now - 200 * 86400000, act: 'edit', changes: [] });
  logs.push({ id: 'new', at: now, act: 'edit', changes: [] });
  mod.actPrune();
  const ids = mod.getLogs().map(e => e.id);
  assert.deepEqual(ids, ['new']);
});

t('เก็บไม่เกิน ' + mod.ACT_MAX + ' รายการ', () => {
  mod.resetLogs();
  const now = Date.now();
  const logs = mod.getLogs();
  for (let i = 0; i < mod.ACT_MAX + 25; i++) logs.push({ id: 'e' + i, at: now - i * 1000, act: 'edit', changes: [] });
  mod.actPrune();
  assert.equal(mod.getLogs().length, mod.ACT_MAX);
  assert.equal(mod.getLogs()[0].id, 'e0', 'ต้องเก็บรายการใหม่สุดไว้');
});

console.log('\nเติมข้อมูลย้อนหลัง 1 วัน');

t('เอาเฉพาะ 24 ชม.ล่าสุด + ใช้ id ตายตัวกันซ้ำข้ามเครื่อง', () => {
  mod.resetLogs();
  mod.ls.removeItem('activity_seed_v1');
  const now = Date.now();
  const d = new Date(now);
  const iso = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  mod.setCards([
    { id: 'a', name: 'ขายวันนี้', status: 'sold', sell: 3000, payment: 'cash', seller: 'ผู้ช่วยเอ', sellDate: iso, sellTime: '10:30', updatedAt: now },
    { id: 'b', name: 'แก้เมื่อกี้', status: 'show', updatedAt: now - 3600000 },
    { id: 'c', name: 'เก่าเกิน', status: 'show', updatedAt: now - 5 * 86400000 },
  ]);
  mod.seedActivityFromCards();
  const ids = mod.getLogs().map(e => e.id).sort();
  assert.deepEqual(ids, ['seed-edit-b', 'seed-sell-a']);
  assert.ok(mod.getLogs().every(e => e.seed === true));
  assert.equal(mod.getLogs().find(e => e.id === 'seed-sell-a').who, 'ผู้ช่วยเอ');
  // เรียกซ้ำต้องไม่เพิ่มอีก (ทั้งจากธง localStorage และจาก id ที่ซ้ำ)
  mod.ls.removeItem('activity_seed_v1');
  mod.seedActivityFromCards();
  assert.equal(mod.getLogs().length, 2, 'เติมซ้ำไม่ได้');
});

console.log(`\n${fail ? '✗' : '✓'} ผ่าน ${pass} / ${pass + fail}\n`);
process.exit(fail ? 1 : 0);
