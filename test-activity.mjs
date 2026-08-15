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
function cardHasStock(c){ return !!c && c.inStock === true; }
function isViewVisible(){ return false; }
function renderActivity(){}
let passcode = 'x', loginId = 'Cielcard', userRole = 'admin';
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
    + '\nexport const ls = localStorage;'
    + '\nexport const setUser = (id, role) => { loginId = id; userRole = role; };',
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
  mod.setCards([cur]);
  mod.logCardChange(body(prev), cur);
  const e = last();
  assert.equal(e.act, 'stock');
  assert.equal(e.changes.length, 1);
  assert.equal(e.changes[0].from, 'ของไม่มี');
  assert.equal(e.changes[0].to, 'มีของ');
});

t('เช็คของบันทึกยอดรวมตอนนั้นด้วย (เช่น 2/4) — ไม่นับใบที่ขายแล้ว/ข้อมูลสินค้า', () => {
  mod.resetLogs();
  const target = { id: 'c1', name: 'Luffy', status: 'show', inStock: true };
  mod.setCards([
    target,
    { id: 'c2', name: 'B', status: 'show', inStock: true },
    { id: 'c3', name: 'C', status: 'wait' },
    { id: 'c4', name: 'D', status: 'show' },
    { id: 'c5', name: 'ขายแล้ว', status: 'sold', inStock: true },   // ไม่นับ
    { id: 'c6', name: 'ข้อมูลสินค้า', status: 'show', productOnly: true }, // ไม่นับ
  ]);
  mod.logCardChange(body({ id: 'c1', name: 'Luffy', status: 'show' }), target);
  assert.equal(last().stockTally, '2/4');
});

t('การแก้อย่างอื่นไม่ต้องมียอดเช็คของติดมาด้วย', () => {
  mod.resetLogs();
  const prev = { id: 'c1', name: 'Luffy', status: 'show', sell: 500 };
  mod.setCards([{ ...prev, sell: 600 }]);
  mod.logCardChange(body(prev), { ...prev, sell: 600 });
  assert.equal(last().stockTally, undefined);
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

t('ร้านขอคืนสินค้า = ขอคืนสินค้า พร้อมบอกว่าใครทำ', () => {
  mod.resetLogs();
  const prev = { id: 'c1', name: 'Luffy', status: 'wait', shopId: 's1' };
  mod.logCardChange(body(prev), { ...prev, retState: 'pending' });
  const e = last();
  assert.equal(e.act, 'retask');
  assert.equal(e.who, 'Cielcard', 'ต้องบันทึกว่า user ไหนกด');
  assert.ok(e.changes.some(x => x.label === 'คืนสินค้า' && x.to === 'รอดำเนินการ'));
});

t('อนุมัติคืน = คืนสินค้าสำเร็จ (ไม่ใช่ "ออกจากสินค้าขาย" ทั้งที่สถานะเปลี่ยนพร้อมกัน)', () => {
  mod.resetLogs();
  const prev = { id: 'c1', name: 'Luffy', status: 'wait', shopId: 's1', retState: 'pending' };
  mod.logCardChange(body(prev), { ...prev, retState: 'done', status: 'show', shopId: '' });
  const e = last();
  assert.equal(e.act, 'retok');
  assert.ok(e.changes.some(x => x.label === 'สถานะ' && x.to === 'สะสม'), 'ต้องเห็นว่ากลับไปเป็นสะสม');
  assert.ok(e.changes.some(x => x.label === 'ร้านค้า' && x.from === 'สาขา 2'), 'ต้องเห็นว่าหลุดจากร้านไหน');
});

t('ไม่อนุมัติคืน = ไม่อนุมัติคืน พร้อมจำนวนครั้ง', () => {
  mod.resetLogs();
  const prev = { id: 'c1', name: 'Luffy', status: 'wait', retState: 'pending' };
  mod.logCardChange(body(prev), { ...prev, retState: '', retFails: 1 });
  const e = last();
  assert.equal(e.act, 'retno');
  assert.ok(e.changes.some(x => x.label === 'คืนไม่สำเร็จ (ครั้ง)' && String(x.to) === '1'));
  assert.ok(e.changes.some(x => x.label === 'คืนสินค้า' && x.to === 'ไม่ได้คืน'));
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

const SEED_K = 'activity_seed_v3';
const seedCards = () => {
  const now = Date.now();
  const d = new Date(now);
  const iso = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  return [
    { id: 'a', name: 'ขายวันนี้', status: 'sold', sell: 3000, payment: 'cash', seller: 'ผู้ช่วยเอ', sellDate: iso, sellTime: '10:30', updatedAt: now },
    { id: 'b', name: 'แก้เมื่อกี้', status: 'show', editedBy: 'ผู้ช่วยบี', updatedAt: now - 3600000 },
    { id: 'c', name: 'เก่าเกิน', status: 'show', updatedAt: now - 5 * 86400000 },
    { id: 'd', name: 'ไม่รู้คนแก้', status: 'wait', updatedAt: now - 7200000 },
  ];
};

t('เอาเฉพาะ 24 ชม.ล่าสุด + ใช้ id ตายตัวกันซ้ำข้ามเครื่อง', () => {
  mod.resetLogs();
  mod.ls.removeItem(SEED_K);
  mod.setCards(seedCards());
  mod.seedActivityFromCards();
  const ids = mod.getLogs().map(e => e.id).sort();
  assert.deepEqual(ids, ['seed-edit-b', 'seed-edit-d', 'seed-sell-a']);
  assert.ok(mod.getLogs().every(e => e.seed === true));
  // เรียกซ้ำต้องไม่เพิ่มรายการ (id ซ้ำ = ทับของเดิม ไม่ใช่ต่อท้าย)
  mod.ls.removeItem(SEED_K);
  mod.seedActivityFromCards();
  assert.equal(mod.getLogs().length, 3, 'เติมซ้ำแล้วต้องไม่บวมขึ้น');
});

t('ชื่อคนทำของรายการย้อนหลัง — ไล่จากหลักฐานที่แน่นอนที่สุด', () => {
  mod.resetLogs();
  mod.ls.removeItem(SEED_K);
  mod.setCards(seedCards());
  mod.seedActivityFromCards();
  const by = Object.fromEntries(mod.getLogs().map(e => [e.id, e.who]));
  assert.equal(by['seed-sell-a'], 'ผู้ช่วยเอ', 'ใบที่ขายแล้ว = คนขายที่บันทึกไว้');
  assert.equal(by['seed-edit-b'], 'ผู้ช่วยบี', 'ใบที่รู้คนแก้ล่าสุด = คนนั้น');
  assert.equal(by['seed-edit-d'], 'Cielcard', 'ใบที่ไม่มีข้อมูลเลย = บัญชีแอดมินที่เติมประวัติ');
  assert.ok(mod.getLogs().every(e => e.who && e.who !== 'ไม่ทราบ'));
});

t('รายการ "แก้ไข" ต้องไม่ถูกสวมชื่อผู้ขายของการขายครั้งก่อน', () => {
  mod.resetLogs();
  mod.ls.removeItem(SEED_K);
  const now = Date.now();
  // เคยขายโดย got001 มาก่อน แล้ววันนี้มีคนมาแก้ — คนแก้ไม่ใช่ got001
  mod.setCards([{ id: 'k', name: 'เคยขาย', status: 'show', seller: 'got001', updatedAt: now - 60000 }]);
  mod.seedActivityFromCards();
  assert.equal(last().act, 'edit');
  assert.equal(last().who, 'Cielcard', 'ต้องไม่ใช่ got001');
});

t('ผู้ช่วยเปิดแอปแล้วต้องไม่เติม/ไม่ซ่อมประวัติ (กันชื่อคนทำโดนสวม)', () => {
  mod.resetLogs();
  mod.getLogs().push({ id: 'seed-edit-b', at: Date.now(), who: 'ไม่ทราบ', act: 'edit', seed: true, cardId: 'b', changes: [] });
  mod.ls.removeItem(SEED_K);
  mod.setCards(seedCards());
  mod.setUser('got001', 'assistant');
  mod.seedActivityFromCards();
  assert.equal(mod.getLogs().length, 1, 'ผู้ช่วยต้องไม่สร้างรายการย้อนหลัง');
  assert.equal(last().who, 'ไม่ทราบ', 'และต้องไม่เขียนชื่อตัวเองทับ');
  mod.setUser('Cielcard', 'admin');
});

t('แอดมินเปิดแล้วซ่อมชื่อที่ผิด และเครื่องอื่นมาทีหลังไม่เขียนสลับไปมา', () => {
  mod.resetLogs();
  const now = Date.now();
  // แถวที่รอบก่อนเขียนชื่อผิดไว้ (เครื่องที่ล็อกอินเป็น got001 เป็นคนเติม)
  mod.getLogs().push({ id: 'seed-edit-b', at: now - 3600000, who: 'got001', act: 'edit', seed: true, cardId: 'b', changes: [] });
  mod.getLogs().push({ id: 'seed-edit-zz', at: now - 5 * 86400000, who: 'got001', act: 'edit', seed: true, cardId: 'zz', changes: [] });
  mod.ls.removeItem(SEED_K);
  mod.setCards(seedCards());
  mod.seedActivityFromCards();
  const by = Object.fromEntries(mod.getLogs().map(e => [e.id, e.who]));
  assert.equal(by['seed-edit-b'], 'ผู้ช่วยบี', 'ใบที่รู้คนแก้ → ใช้ชื่อนั้น');
  assert.equal(by['seed-edit-zz'], 'Cielcard', 'ใบที่หาการ์ดไม่เจอ (เลย 24 ชม.) → บัญชีแอดมิน');
  assert.ok(mod.getLogs().every(e => e.who !== 'got001'), 'ต้องไม่เหลือชื่อที่ผิด');
  assert.ok(mod.getLogs().every(e => e.whoFixed === 1), 'ทุกแถวต้องถูกปั๊มว่าสรุปแล้ว');
  assert.equal(mod.getLogs().filter(e => e.id === 'seed-edit-b').length, 1, 'ต้องไม่เกิดรายการซ้ำ');

  // แอดมินอีกเครื่อง (ชื่ออื่น) เปิดตาม — ต้องไม่เขียนชื่อทับของที่สรุปไปแล้ว
  const snapshot = JSON.stringify(mod.getLogs().map(e => [e.id, e.who]).sort());
  mod.ls.removeItem(SEED_K);
  mod.setUser('AdminSอง', 'admin');
  mod.seedActivityFromCards();
  mod.setUser('Cielcard', 'admin');
  assert.equal(JSON.stringify(mod.getLogs().map(e => [e.id, e.who]).sort()), snapshot, 'ชื่อต้องไม่สลับไปมา');
});

// ---- โครงตาราง: ดึงฟังก์ชันวาดแถวออกมาจริง ๆ แล้วนับช่องให้ตรงกับหัวตาราง ----
const rStart = html.indexOf('// ---- หน้ารายงานการใช้งาน');
const rEnd = html.indexOf('function renderActivity() {');
assert.ok(rStart > 0 && rEnd > rStart, 'หาบล็อกวาดหน้ารายงานไม่เจอ');
const view = await import('data:text/javascript;base64,' + Buffer.from(`
function esc(s){ return String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
function pad2(n){ return String(n).padStart(2,'0'); }
function todayStr(){ return '2026-08-14'; }
function yesterdayStr(){ return '2026-08-13'; }
function fmtDate(d){ return d ? d.split('-').reverse().join('/') : ''; }
const ACT_META = { add:{label:'เพิ่มการ์ด'}, edit:{label:'แก้ไขการ์ด'}, stock:{label:'เช็คของ'}, sell:{label:'ขายแล้ว'}, del:{label:'ลบการ์ด'} };
const document = { querySelectorAll: () => [], querySelector: () => null };
let cards = [];
let activityLogs = [];
function cardById(id){ return cards.find(c => c && c.id === id) || null; }
function cardHay(c){ return [c.name, c.cert, (c.setItems||[]).map(i => i.name + ' ' + i.cert).join(' ')].filter(Boolean).join(' ').toLowerCase(); }
function setHitHTML(c){ return c && c.setItems ? '<div class="set-hit">รวมเป็นชุด</div>' : ''; }
function actVal(k, v){
  if (k === 'inStock') return v === true ? 'มีของ' : 'ของไม่มี';
  if (k === 'status') return ({ show:'สะสม', wait:'รอขาย', sold:'ขายแล้ว' })[v] || v;
  return v;
}
` + html.slice(rStart, rEnd) + '\nexport { actRowHTML, actLeafRowHTML, actChipHTML, actHay, actNoHitHint, actCardRowHTML, actExtraCards };'
  + '\nexport const setViewCards = (v) => { cards = v; };'
  + '\nexport const setViewLogs = (v) => { activityLogs = v; };').toString('base64'));

// จำนวนคอลัมน์ในหัวตาราง (อ่านจาก <thead> จริงใน index.html) ต้องเท่ากับทุกแถวที่วาดออกมา
const rBody = html.slice(html.indexOf('function renderActivity() {'));
const tableAt = rBody.indexOf('<table id="actTable">');
const COLS = (rBody.slice(tableAt, rBody.indexOf('</thead>', tableAt)).match(/<th[\s>]/g) || []).length;
const colspan = Number((rBody.slice(0, tableAt).match(/sold-date-head"><td colspan="(\d+)"/) || [])[1]);
const cellsOf = (tr) => (tr.match(/<td/g) || []).length;
const rowsOf = (h) => h.split('<tr').slice(1).map(r => '<tr' + r);

console.log('\nโครงตาราง (' + COLS + ' คอลัมน์)');

t('หัวตารางกับ colspan ของแถบวันที่ตรงกัน', () => {
  assert.equal(colspan, COLS, `colspan=${colspan} แต่หัวตารางมี ${COLS} คอลัมน์`);
});

t('แถวปกติมีช่องครบตามหัวตาราง', () => {
  const e = { id: 'x', at: Date.now(), who: 'Cielcard', act: 'stock', name: 'Luffy', topic: 'One Piece',
    cert: '144153428', psa: '10', grader: 'PSA', image: 'https://blob/a.png', stockTally: '178/1118',
    changes: [{ k: 'inStock', label: 'เช็คของ', from: 'ของไม่มี', to: 'มีของ' }] };
  const rows = rowsOf(view.actRowHTML([e]));
  assert.equal(rows.length, 1);
  assert.equal(cellsOf(rows[0]), COLS);
});

t('แถวกลุ่มที่ยุบไว้: หัวแถว + ใบย่อย ช่องครบทุกแถว', () => {
  const mk = (i) => ({ id: 'x' + i, at: Date.now(), who: 'Cielcard', act: 'edit', batchId: 'b1',
    name: 'การ์ด ' + i, cert: '', image: '', changes: [{ k: 'sell', label: 'ราคาขาย', from: '฿500', to: '฿600' }] });
  const rows = rowsOf(view.actRowHTML([mk(1), mk(2), mk(3)]));
  assert.equal(rows.length, 4, 'หัวแถว 1 + ใบย่อย 3');
  rows.forEach((r, i) => assert.equal(cellsOf(r), COLS, 'แถวที่ ' + i + ' ช่องไม่ครบ'));
  assert.equal((rows[0].match(/act-batch/g) || []).length, 1);
  assert.equal(rows.slice(1).filter(r => r.includes('act-sub-tr') && r.includes('display:none')).length, 3);
});

t('รูปกดดูได้ · ไม่มีรูปก็ไม่พัง', () => {
  const base = { id: 'x', at: Date.now(), who: 'a', act: 'edit', name: 'n', changes: [] };
  const withImg = view.actLeafRowHTML({ ...base, image: 'https://blob/a.png' }, null);
  assert.ok(withImg.includes("openImgUrl('https://blob/a.png')"), 'รูปต้องกดเปิดดูได้');
  assert.ok(withImg.includes('act-thumb'), 'ต้องมี class รูปย่อ');
  assert.ok(view.actLeafRowHTML(base, null).includes('act-thumb-empty'), 'ไม่มีรูป = ช่องว่างมีไอคอนแทน');
});

t('ยอดเช็คของโผล่เฉพาะแถวที่ติ๊กเช็คของ', () => {
  const stock = { id: 'x', at: 1, who: 'a', act: 'stock', name: 'n', stockTally: '178/1118',
    changes: [{ k: 'inStock', label: 'เช็คของ', from: 'ของไม่มี', to: 'มีของ' }] };
  assert.ok(view.actLeafRowHTML(stock, null).includes('178/1118'));
  const edit = { id: 'y', at: 1, who: 'a', act: 'edit', name: 'n', changes: [{ k: 'sell', label: 'ราคาขาย', to: '฿600' }] };
  assert.ok(!view.actLeafRowHTML(edit, null).includes('act-tally'));
});

t('ชิปสถานะได้สีตามค่า และช่องที่ไม่มีข้อมูลขึ้นขีด', () => {
  const ch = [{ k: 'status', label: 'สถานะ', from: 'สะสม', to: 'ขายแล้ว' }];
  assert.ok(view.actChipHTML(ch, 'status').includes('act-chip sold'));
  assert.ok(view.actChipHTML(ch, 'inStock').includes('—'));
});

t('เนื้อหาจากผู้ใช้ถูก escape ไม่หลุดเป็น HTML', () => {
  const e = { id: 'x', at: 1, who: '<b>hack</b>', act: 'edit', name: '<script>x</' + 'script>', cert: '"><i>', changes: [] };
  const out = view.actLeafRowHTML(e, null);
  assert.ok(!out.includes('<script'), 'ชื่อการ์ดต้องไม่กลายเป็นแท็ก');
  assert.ok(!out.includes('<b>hack'), 'ชื่อผู้ใช้ต้องไม่กลายเป็นแท็ก');
});

console.log('\nค้นหาในรายงานการใช้งาน');

// รายการเก่าเก็บแค่ชื่อ/cert ของ "ชุด" — เลข cert ของใบข้างในต้องมาจากการ์ดใบล่าสุด
const actEntry = { id: 'a1', at: 1, who: 'got001', act: 'edit', name: 'ชุดรวม OP09', cert: '', cardId: 'set1', changes: [] };
const setCard = {
  id: 'set1', name: 'ชุดรวม OP09', type: 'set',
  setItems: [{ name: 'Luffy', cert: '152750653' }, { name: 'Zoro', cert: '99887766' }],
  updatedAt: Date.parse('2026-07-25T14:18:00Z'),
};

t('ค้นเลข cert ของใบในชุด แล้วเจอรายการในรายงาน', () => {
  view.setViewCards([setCard]);
  assert.ok(view.actHay(actEntry, setCard).includes('152750653'));
  assert.ok(!view.actHay(actEntry, null).includes('152750653'), 'ไม่มีการ์ดให้เทียบ = ได้แค่ข้อมูลที่บันทึกไว้');
});

t('ยังค้นด้วยข้อมูลที่บันทึกไว้ได้เหมือนเดิม (ชื่อ/ผู้ทำรายการ/ประเภท)', () => {
  const hay = view.actHay(actEntry, null);
  assert.ok(hay.includes('ชุดรวม op09') && hay.includes('got001') && hay.includes('แก้ไขการ์ด'));
});

t('การ์ดถูกลบไปแล้ว ค้นหาไม่พัง', () => {
  view.setViewCards([]);
  assert.doesNotThrow(() => view.actHay(actEntry, undefined));
  assert.doesNotThrow(() => view.actLeafRowHTML(actEntry, null));
});

t('ค้นไม่เจอ แต่มีการ์ดใบนั้นอยู่จริง → บอกว่าการ์ดยังไม่มีความเคลื่อนไหว', () => {
  view.setViewCards([setCard]);
  view.setViewLogs([{ id: 'z', at: Date.parse('2026-08-12T03:00:00Z'), act: 'edit' }]);
  const hint = view.actNoHitHint(['152750653']);
  assert.ok(hint.includes('ชุดรวม OP09'), 'ต้องบอกชื่อการ์ดที่ตรงกับคำค้น');
  assert.ok(hint.includes('ยังไม่มีความเคลื่อนไหว'));
  assert.ok(hint.includes('แก้ไขล่าสุด'), 'การ์ดมี updatedAt = ต้องบอกวันที่แก้ล่าสุด');
  assert.ok(hint.includes('การ์ดในคลังที่ตรงกับคำค้น 1 ใบ'), 'ต้องบอกว่าค้นเจอการ์ดกี่ใบ');
  assert.ok(hint.includes('เริ่มเก็บบันทึก'), 'ต้องบอกว่าระบบเริ่มเก็บบันทึกเมื่อไหร่');
  const none = view.actNoHitHint(['ไม่มีการ์ดชื่อนี้']);
  assert.ok(none.includes('การ์ดในคลังที่ตรงกับคำค้น 0 ใบ'), 'ไม่มีการ์ดตรงเลย = ยังบอกขอบเขตที่ค้นไป');
  assert.ok(!none.includes('แก้ไขล่าสุด'), 'ไม่มีการ์ดตรง = ไม่ต้องพูดถึงวันแก้ล่าสุด');
  assert.equal(view.actNoHitHint([]), '', 'ไม่ได้ค้นอะไร = ไม่ต้องขึ้นคำอธิบาย');
});

t('แถวในรายงานขึ้นป้าย "รวมเป็นชุด" เมื่อเจอจากใบในชุด', () => {
  view.setViewCards([setCard]);
  assert.ok(view.actLeafRowHTML(actEntry, null).includes('set-hit'));
  assert.ok(!view.actLeafRowHTML({ ...actEntry, cardId: 'none' }, null).includes('set-hit'));
});

t('การ์ดที่ไม่มีบันทึก ถูกต่อท้ายเป็นแถว "ข้อมูลการ์ด" ช่องครบตามหัวตาราง', () => {
  view.setViewCards([setCard]);
  const row = view.actCardRowHTML(setCard);
  assert.equal(cellsOf(row), COLS, 'แถวข้อมูลการ์ดต้องมีช่องเท่าหัวตาราง');
  assert.ok(row.includes('act-tag info'), 'ต้องมีป้ายแยกว่าไม่ใช่บันทึกจริง');
  assert.ok(row.includes('แก้ไขล่าสุด'));
  assert.ok(row.includes('set-hit'), 'ค้นเจอจากใบในชุด = ต้องบอกด้วย');
});

t('การ์ดที่มีแถวในบันทึกอยู่แล้ว ไม่ถูกใส่ซ้ำเป็นแถวข้อมูลการ์ด', () => {
  view.setViewCards([setCard]);
  assert.equal(view.actExtraCards(['152750653'], []).length, 1, 'ไม่มีแถวในบันทึก = ต้องต่อท้ายให้');
  assert.equal(view.actExtraCards(['152750653'], [{ cardId: 'set1' }]).length, 0, 'มีแถวแล้ว = ไม่ซ้ำ');
  assert.equal(view.actExtraCards([], []).length, 0, 'ไม่ได้ค้นอะไร = ไม่ต่อท้ายอะไรเลย');
});

console.log(`\n${fail ? '✗' : '✓'} ผ่าน ${pass} / ${pass + fail}\n`);
process.exit(fail ? 1 : 0);
