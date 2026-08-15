// ทดสอบปุ่มสลับ "รวมใบเหมือนกัน / แยกทุกใบ" — ดึงโค้ดจริงออกมาจาก index.html
// รัน: node test-rows.mjs
import fs from 'node:fs';
import assert from 'node:assert';

const html = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const start = html.indexOf('// ===== รวมใบเหมือนกัน / แยกทุกใบ =====');
const end = html.indexOf('function buildStockRows(list) {');
assert.ok(start > 0 && end > start, 'หาบล็อกโค้ดสลับการรวมใบไม่เจอ');

const stubs = `
const store = {};
const localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k,v) => { store[k] = String(v); } };
const els = {};
const document = { getElementById: id => els[id] || null };
const drawn = [];
function render(){ drawn.push('stock'); }
function renderSales(){ drawn.push('sales'); }
function isViewVisible(){ return true; }
`;

const mod = await import('data:text/javascript;base64,' + Buffer.from(
  stubs + html.slice(start, end)
  + '\nexport { toggleFlatRows, flatBtnHTML };'
  + '\nexport const isFlat = () => flatRows;'
  + '\nexport const saved = () => store.app_flat_rows;'
  + '\nexport const drawnViews = () => drawn;',
).toString('base64'));

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + e.message); } };

console.log('\nปุ่มสลับรวมใบ / แยกใบ');

t('เริ่มต้นคือ "รวมใบเหมือนกัน" ตามพฤติกรรมเดิม ไม่เปลี่ยนของที่คนใช้อยู่', () => {
  assert.equal(mod.isFlat(), false);
});

t('กดแล้วสลับ และจำค่าไว้ในเครื่อง', () => {
  mod.toggleFlatRows();
  assert.equal(mod.isFlat(), true);
  assert.equal(mod.saved(), '1', 'ต้องจำไว้ให้เปิดแอปครั้งหน้ายังเป็นค่าเดิม');
  mod.toggleFlatRows();
  assert.equal(mod.isFlat(), false);
  assert.equal(mod.saved(), '0');
});

t('กดครั้งเดียว วาดใหม่ทั้งคลังสินค้าและสินค้าขาย (ค่าใช้ร่วมกัน 2 หน้า)', () => {
  const before = mod.drawnViews().length;
  mod.toggleFlatRows();
  const after = mod.drawnViews().slice(before);
  assert.ok(after.includes('stock') && after.includes('sales'), 'ได้ ' + after.join(','));
  mod.toggleFlatRows();
});

t('ปุ่มบอกสถานะปัจจุบันและบอกว่ากดแล้วจะได้อะไร', () => {
  const grouped = mod.flatBtnHTML('flatBtnStock');
  assert.ok(grouped.includes('กดเพื่อแยกทุกใบ'), 'ตอนรวมใบ ต้องบอกว่ากดแล้วจะแยก');
  assert.ok(!grouped.includes('icon-toggle on'), 'ค่าเริ่มต้นไม่ต้องไฮไลต์');
  mod.toggleFlatRows();
  const flat = mod.flatBtnHTML('flatBtnStock');
  assert.ok(flat.includes('กดเพื่อรวมใบ'), 'ตอนแยกใบ ต้องบอกว่ากดแล้วจะรวม');
  assert.ok(flat.includes('icon-toggle on'), 'ตอนไม่ใช่ค่าเริ่มต้น ต้องไฮไลต์ให้รู้ว่ากำลังเปิดอยู่');
  mod.toggleFlatRows();
});

console.log('\nตารางตอนแยกทุกใบ');

// ตรวจจากโค้ดจริงว่าทั้ง 2 ตารางมีทางลัดข้ามการจัดกลุ่มเมื่อ flatRows
t('คลังสินค้า: แยกใบแล้วต้องไม่มีแถวหัวกลุ่มโผล่มา', () => {
  const fn = html.slice(html.indexOf('function buildStockRows(list) {'), html.indexOf('// ชิป "ของรอขาย"'));
  const cut = fn.indexOf('if (flatRows)');
  assert.ok(cut > 0, 'ต้องมีทางลัดตอนแยกใบ');
  assert.ok(cut < fn.indexOf('groupRow('), 'ทางลัดต้องมาก่อนการวาดหัวกลุ่ม');
});

t('สินค้าขาย: แยกใบแล้วยังเรียงตามคอลัมน์ "กระทำ" ได้เหมือนเดิม', () => {
  const fn = html.slice(html.indexOf('function buildSalesRows(list) {'), html.indexOf('// ชิปท้ายแถว'));
  const cut = fn.indexOf('if (flatRows)');
  assert.ok(cut > 0 && cut < fn.indexOf('salesGroupRow('), 'ทางลัดต้องมาก่อนการวาดหัวกลุ่ม');
  const block = fn.slice(cut, fn.indexOf('// เรียงตามคอลัมน์'));
  assert.ok(block.includes('salesActSort'), 'ตอนแยกใบก็ต้องยังเรียงตามกระทำได้');
});

console.log(`\n${fail ? '✗' : '✓'} ผ่าน ${pass} / ${pass + fail}\n`);
process.exit(fail ? 1 : 0);
