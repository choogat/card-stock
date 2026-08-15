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
const saved = [];
function save(){ saved.push(1); }
function renderSales(){}
const synced = [];
function setSync(t, c){ synced.push(c + ':' + t); }
let answer = null;                       // ค่าที่ popup จะตอบกลับ (true / false / null)
const asked = [];
function appConfirm(opt){ asked.push(opt); return Promise.resolve(answer); }
`;

const mod = await import('data:text/javascript;base64,' + Buffer.from(
  stubs + html.slice(start, end)
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
  assert.ok(mod.returnActionsHTML(c).includes('รออนุมัติ'));
  assert.ok(!mod.returnActionsHTML(c).includes('requestReturn'), 'ขอซ้ำไม่ได้');
});

t('คืนไม่สำเร็จ → ปุ่มขายเป็นสีส้ม + บอกจำนวนครั้ง', () => {
  const c = { ...mk(), retFails: 2 };
  mod.setShop(null);
  const html = mod.returnActionsHTML(c);
  assert.ok(html.includes('ret-failed'), 'ปุ่มขายต้องถูกย้อมสีส้ม');
  assert.ok(html.includes('คืนไม่สำเร็จ 2 ครั้ง'));
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
  assert.equal(last.title, 'ยืนยันคืนสินค้า');
  assert.equal(last.okText, 'ยืนยันคืนสินค้า');
  assert.ok(last.sub.includes('Luffy') && last.sub.includes('สาขา 2') && last.sub.includes('got001'));
  assert.equal(last.count, '3 ครั้ง');
});

console.log(`\n${fail ? '✗' : '✓'} ผ่าน ${pass} / ${pass + fail}\n`);
process.exit(fail ? 1 : 0);
