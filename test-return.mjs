// ทดสอบ "คืนสินค้า" — ดึงโค้ดจริงออกมาจาก index.html แล้วรันในสภาพแวดล้อมจำลอง
// รัน: node test-return.mjs
import fs from 'node:fs';
import assert from 'node:assert';

const html = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const start = html.indexOf('// ================= คืนสินค้า =================');
const end = html.indexOf('function salesRow(c, isChild) {');
assert.ok(start > 0 && end > start, 'หาบล็อกโค้ดคืนสินค้าใน index.html ไม่เจอ');

const stubs = `
function esc(s){ return String(s ?? ''); }
function fmtDate(d){ return d ? d.split('-').reverse().join('/') : ''; }
function actDayKey(t){ const d = new Date(Number(t)||0); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
function shopById(id){ return shops.find(s => s.id === id) || null; }
let shops = [{ id:'s1', name:'สาขา 2' }];
let cards = [];
let viewShopId = null;
let loginId = 'got001';
function actWho(){ return loginId || 'เจ้าของเครื่อง'; }
function render(){}
const saved = [];
function save(){ saved.push(1); }
function renderSales(){}
const synced = [];
function setSync(t, c){ synced.push(c + ':' + t); }
let answer = null;                       // ค่าที่ popup จะตอบกลับ (true / false / null)
const asked = [];
function appConfirm(opt){ asked.push(opt); return Promise.resolve(answer); }
`;

// ชิปสรุป "รอดำเนินการ" อยู่คนละบล็อกกับตรรกะคืนสินค้า — ดึงมาต่อท้ายเพื่อทดสอบด้วยกัน
const chipSrc = html.slice(html.indexOf('// ชิปท้ายแถว: ของที่ร้านกดคืนแล้ว'), html.indexOf('// คลิกชิปรอขาย'));
const chipStubs = `
function inShopScope(c){ return !viewShopId || c.shopId === viewShopId; }
function matchShopFilter(){ return true; }
const document = { getElementById: () => null };
let salesRetFilter = false;
`;

const mod = await import('data:text/javascript;base64,' + Buffer.from(
  stubs + chipStubs + chipSrc.replace(/^\/\/ คลิกชิป[\s\S]*$/m, '') + html.slice(start, end)
    + '\nexport { returnChipHTML };'
    + '\nexport const setRetFilter = v => { salesRetFilter = v; };'
  + '\nexport { retState, retFails, returnBadgeHTML, returnActionsHTML, requestReturn, reviewReturn, asked, saved, synced };'
  + '\nexport const setCards = v => { cards = v; };'
  + '\nexport const setShop = v => { viewShopId = v; };'
  + '\nexport const setAnswer = v => { answer = v; };',
).toString('base64'));

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + e.message); } };
const ta = async (name, fn) => { try { await fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + e.message); } };
const mk = () => ({ id: 'c1', name: 'Luffy', status: 'wait', shopId: 's1' });

console.log('\nสถานะที่แต่ละฝั่งเห็น');

t('ยังไม่ขอคืน = ไม่มีป้ายคืนสินค้าทั้งสองฝั่ง', () => {
  const c = mk();
  mod.setShop('s1'); assert.equal(mod.returnBadgeHTML(c), '');
  mod.setShop(null); assert.equal(mod.returnBadgeHTML(c), '');
});

t('ขอคืนแล้ว: ฝั่งร้าน = รอดำเนินการ · ฝั่งรวม = คืนสินค้า', () => {
  const c = { ...mk(), retState: 'pending' };
  mod.setShop('s1'); assert.ok(mod.returnBadgeHTML(c).includes('รอดำเนินการ'));
  mod.setShop(null); assert.ok(mod.returnBadgeHTML(c).includes('คืนสินค้า'));
});

t('คืนสำเร็จ: ฝั่งร้าน = คืนสินค้า · ฝั่งรวม = คืนสินค้าสำเร็จ', () => {
  const c = { ...mk(), retState: 'done' };
  mod.setShop('s1');
  const shop = mod.returnBadgeHTML(c);
  assert.ok(shop.includes('คืนสินค้า') && !shop.includes('สำเร็จ'), 'ฝั่งร้านต้องเห็นแค่ "คืนสินค้า"');
  mod.setShop(null); assert.ok(mod.returnBadgeHTML(c).includes('คืนสินค้าสำเร็จ'));
});

console.log('\nปุ่มที่แต่ละฝั่งกดได้');

t('ปุ่ม "คืนสินค้า" ขึ้นเฉพาะหน้าร้าน ข้างปุ่มขาย', () => {
  const c = mk();
  mod.setShop('s1');
  const inShop = mod.returnActionsHTML(c);
  assert.ok(inShop.includes('requestReturn') && inShop.includes('markSold'), 'หน้าร้านต้องมีทั้งขายและคืนสินค้า');
  mod.setShop(null);
  const main = mod.returnActionsHTML(c);
  assert.ok(main.includes('markSold') && !main.includes('requestReturn'), 'หน้ารวมยังไม่มีคำขอ = มีแค่ปุ่มขาย');
});

t('รออนุมัติ: ฝั่งรวมได้ปุ่มตัดสิน · ฝั่งร้านได้แค่ข้อความรอ', () => {
  const c = { ...mk(), retState: 'pending' };
  mod.setShop(null);
  assert.ok(mod.returnActionsHTML(c).includes('reviewReturn'), 'ฝั่งรวมต้องกดตัดสินได้');
  assert.ok(!mod.returnActionsHTML(c).includes('markSold'), 'ระหว่างรอ ห้ามขายไปก่อน');
  mod.setShop('s1');
  assert.ok(mod.returnActionsHTML(c).includes('รอดำเนินการ'), 'ใช้คำเดียวกับป้ายในตาราง ไม่มีคำพ้องซ้อน');
  assert.ok(!mod.returnActionsHTML(c).includes('requestReturn'), 'ขอซ้ำไม่ได้');
});

t('คืนไม่สำเร็จ → ปุ่มขายยังเป็นปุ่มขายปกติ ไม่มีข้อความห้อยใต้แถว (ไปบอกใน popup แทน)', () => {
  const c = { ...mk(), retFails: 2 };
  mod.setShop(null);
  const html = mod.returnActionsHTML(c);
  assert.ok(html.includes('btn-primary btn-act'), 'ต้องเป็นปุ่มขายสีฟ้าแบบเดียวกับใบอื่น');
  assert.ok(!html.includes('ret-failed'), 'ห้ามย้อมสีส้ม');
  assert.ok(!/>คืนไม่สำเร็จ/.test(html), 'ห้ามมีข้อความห้อยใต้ปุ่ม');
  assert.ok(html.includes('title="เคยขอคืนแล้วไม่สำเร็จ 2 ครั้ง"'), 'เก็บไว้เป็น tooltip ได้');
});

console.log('\nการตัดสินของฝั่งรวม');

await ta('ร้านกดขอคืน → pending + บันทึกคนขอ', () => {
  const c = mk();
  mod.setCards([c]);
  mod.setShop('s1');
  mod.requestReturn('c1');
  assert.equal(c.retState, 'pending');
  assert.equal(c.retBy, 'got001');
  assert.ok(c.retAt > 0);
});

await ta('ยืนยัน → คืนสำเร็จ ไม่นับครั้งที่ล้มเหลว', async () => {
  const c = { ...mk(), retState: 'pending', retFails: 1 };
  mod.setCards([c]); mod.setShop(null); mod.setAnswer(true);
  await mod.reviewReturn('c1');
  assert.equal(c.retState, 'done');
  assert.equal(c.retFails, 1, 'ยืนยันแล้วห้ามไปเพิ่มจำนวนครั้งที่ล้มเหลว');
});

await ta('คืนสำเร็จ → กลับเป็น "สะสม" ในคลัง และหลุดจากร้าน พร้อมจำว่าใครอนุมัติ', async () => {
  const c = { ...mk(), retState: 'pending' };
  mod.setCards([c]); mod.setShop(null); mod.setAnswer(true);
  await mod.reviewReturn('c1');
  assert.equal(c.status, 'show', 'ต้องกลับไปเป็นสะสม');
  assert.equal(c.shopId, '', 'ต้องหลุดจากร้าน');
  assert.equal(c.retDoneBy, 'got001', 'ต้องจำว่าใครอนุมัติ');
  assert.ok(c.retDoneAt > 0);
});

await ta('ไม่อนุมัติ → ยังอยู่ในร้านและยังรอขายเหมือนเดิม', async () => {
  const c = { ...mk(), retState: 'pending' };
  mod.setCards([c]); mod.setShop(null); mod.setAnswer(false);
  await mod.reviewReturn('c1');
  assert.equal(c.status, 'wait');
  assert.equal(c.shopId, 's1');
});

await ta('กดยกเลิก → กลับไปขายต่อได้ และนับครั้งเพิ่ม', async () => {
  const c = { ...mk(), retState: 'pending' };
  mod.setCards([c]); mod.setShop(null); mod.setAnswer(false);
  await mod.reviewReturn('c1');
  assert.equal(c.retState, '');
  assert.equal(c.retFails, 1);
  await mod.reviewReturn('c1'); // ไม่ได้อยู่ในสถานะรอแล้ว ต้องไม่ทำอะไรต่อ
  assert.equal(c.retFails, 1, 'ใบที่ไม่ได้รออนุมัติ ห้ามนับซ้ำ');
});

await ta('ปิด popup ทิ้ง → ยังรออนุมัติเหมือนเดิม ไม่นับว่าปฏิเสธ', async () => {
  const c = { ...mk(), retState: 'pending' };
  mod.setCards([c]); mod.setShop(null); mod.setAnswer(null);
  await mod.reviewReturn('c1');
  assert.equal(c.retState, 'pending');
  assert.equal(mod.retFails(c), 0);
});

await ta('popup บอกชื่อสินค้า ร้าน และจำนวนครั้งที่เคยคืนไม่สำเร็จ', async () => {
  const c = { ...mk(), retState: 'pending', retFails: 3, retBy: 'got001', retAt: Date.parse('2026-08-15T04:00:00Z') };
  mod.setCards([c]); mod.setShop(null); mod.setAnswer(null);
  await mod.reviewReturn('c1');
  const last = mod.asked[mod.asked.length - 1];
  assert.equal(last.title, 'คำขอคืนสินค้า');
  assert.ok(last.sub.includes('Luffy') && last.sub.includes('สาขา 2') && last.sub.includes('got001'));
  assert.equal(last.count, '3 ครั้ง');
});

await ta('popup มี 3 ทางเลือก: ยกเลิก / ไม่อนุมัติ / อนุมัติ', async () => {
  const c = { ...mk(), retState: 'pending' };
  mod.setCards([c]); mod.setShop(null); mod.setAnswer(null);
  await mod.reviewReturn('c1');
  const o = mod.asked[mod.asked.length - 1];
  assert.equal(o.okText, 'อนุมัติ', 'ปุ่มขวา = อนุมัติ');
  assert.equal(o.cancelText, 'ไม่อนุมัติ', 'ปุ่มกลาง = ไม่อนุมัติ (มีผลจริง)');
  assert.equal(o.dismissText, 'ยกเลิก', 'ปุ่มซ้าย = ออกเฉย ๆ');
  assert.equal(o.cancelTone, 'danger', 'ปุ่มไม่อนุมัติต้องเป็นสีแดง ไม่ให้กดสลับกับยกเลิก');
});

console.log('\nชิปสรุป "รอดำเนินการ"');

// สถานการณ์จริงจากเซิร์ฟเวอร์ (16/08/2569): ร้าน 25Cardshop รอขาย 108 ชิ้น ในนั้นรออนุมัติคืน 41
const shopStock = () => {
  const list = [];
  for (let i = 0; i < 41; i++) list.push({ id: 'p' + i, status: 'wait', shopId: 's1', retState: 'pending' });
  for (let i = 0; i < 41; i++) list.push({ id: 'w' + i, status: 'wait', shopId: 's1' });
  list.push({ id: 'set1', status: 'wait', shopId: 's1', type: 'set', qty: 26 });
  list.push({ id: 'sold1', status: 'sold', shopId: 's1' });      // ขายแล้ว ไม่นับ
  list.push({ id: 'show1', status: 'show', shopId: 's1' });      // สะสม ไม่นับ
  list.push({ id: 'other', status: 'wait', shopId: 's2', retState: 'pending' }); // คนละร้าน
  return list;
};

t('นับเฉพาะของที่รอขายในร้านที่กำลังดู → 41/108', () => {
  mod.setCards(shopStock());
  mod.setShop('s1');
  const chip = mod.returnChipHTML();
  assert.ok(chip.includes('41/108'), 'ได้ ' + (chip.match(/\d+\/\d+/) || [])[0]);
  assert.ok(chip.includes('รอดำเนินการ'), 'หน้าร้านใช้คำว่า รอดำเนินการ');
});

t('หน้ารวมใช้คำว่า "คืนสินค้า" และนับทุกร้าน', () => {
  mod.setCards(shopStock());
  mod.setShop(null);
  const chip = mod.returnChipHTML();
  assert.ok(chip.includes('คืนสินค้า'));
  assert.ok(chip.includes('42/109'), 'ได้ ' + (chip.match(/\d+\/\d+/) || [])[0]);
});

t('ไม่มีของรอคืน = ขึ้น 0/N ไม่ใช่ซ่อนชิป', () => {
  mod.setCards([{ id: 'a', status: 'wait', shopId: 's1' }, { id: 'b', status: 'wait', shopId: 's1' }]);
  mod.setShop('s1');
  assert.ok(mod.returnChipHTML().includes('0/2'));
});

t('ไม่มีราคาในชิป และกดเพื่อกรองได้', () => {
  mod.setCards(shopStock());
  mod.setShop('s1');
  const chip = mod.returnChipHTML();
  assert.ok(!chip.includes('฿'), 'ห้ามมีราคา');
  assert.ok(chip.includes('toggleReturnFilter()'), 'ต้องกดกรองได้เหมือนชิปอื่น');
});

console.log('\nกดหัวคอลัมน์ "กระทำ" เพื่อเรียง');

// ดึงตัวเรียงจริงออกมาจาก index.html แล้วรันกับข้อมูลจำลอง
const sortSrc = html.slice(html.indexOf('let salesActSort = '), html.indexOf('function actionTH()'));
const sorter = new Function('renderSales', `
  ${sortSrc}
  const retState = c => c.retState || '';
  return {
    cycle: () => { sortByAction(); return salesActSort; },
    order: (groups) => {
      if (!salesActSort) return groups.map(g => g.key);
      const hasRet = g => g.items.some(c => retState(c) === 'pending') ? 1 : 0;
      const dir = salesActSort === 'ret' ? -1 : 1;
      return groups.slice().sort((a, b) => (hasRet(a) - hasRet(b)) * dir).map(g => g.key);
    },
  };
`)(() => {});

const groups = () => ([
  { key: 'ขายปกติ', items: [{ id: 'a' }, { id: 'b' }] },
  { key: 'มีใบรอคืน', items: [{ id: 'c' }, { id: 'd', retState: 'pending' }] },
  { key: 'ขายปกติ2', items: [{ id: 'e' }] },
]);

t('กดวน 3 จังหวะ: คืนสินค้าก่อน → ขายก่อน → ลำดับเดิม', () => {
  assert.equal(sorter.cycle(), 'ret');
  assert.equal(sorter.cycle(), 'sell');
  assert.equal(sorter.cycle(), '');
});

t('จังหวะที่ 1 ดันกลุ่มที่มีใบรอคืนขึ้นบนสุด', () => {
  sorter.cycle(); // → ret
  assert.equal(sorter.order(groups())[0], 'มีใบรอคืน');
});

t('จังหวะที่ 2 ดันกลุ่มขายปกติขึ้นก่อน', () => {
  sorter.cycle(); // → sell
  assert.equal(sorter.order(groups()).pop(), 'มีใบรอคืน');
});

t('จังหวะที่ 3 คืนลำดับเดิม ไม่ยุ่งกับการเรียงที่ผู้ใช้เลือกไว้', () => {
  sorter.cycle(); // → ''
  assert.deepEqual(sorter.order(groups()), ['ขายปกติ', 'มีใบรอคืน', 'ขายปกติ2']);
});

t('กลุ่มที่มีทั้งใบรอคืนและใบขายปกติ ไม่ถูกฉีกออกจากกัน', () => {
  sorter.cycle(); // → ret
  const out = sorter.order(groups());
  assert.equal(out.length, 3, 'จำนวนกลุ่มต้องเท่าเดิม ไม่มีกลุ่มไหนถูกแยก');
  assert.equal(new Set(out).size, 3);
  sorter.cycle(); sorter.cycle(); // คืนค่าเดิมให้เทสต์ถัดไป
});

console.log(`\n${fail ? '✗' : '✓'} ผ่าน ${pass} / ${pass + fail}\n`);
process.exit(fail ? 1 : 0);
