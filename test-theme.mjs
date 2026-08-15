// ทดสอบการเลือกธีมสว่าง/มืด — ดึงโค้ดจริงออกมาจาก index.html
// รัน: node test-theme.mjs
import fs from 'node:fs';
import assert from 'node:assert';

const html = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const start = html.indexOf('// ธีมของทั้งระบบ');
const end = html.indexOf('function toggleShopTheme()');
assert.ok(start > 0 && end > start, 'หาบล็อกโค้ดธีมใน index.html ไม่เจอ');

const stubs = `
let isShop = false;
function isShopAccount(){ return isShop; }
const store = {};
const localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k,v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
const cls = new Set();
const els = {};
const document = { body: { classList: { toggle: (c, on) => { on ? cls.add(c) : cls.delete(c); } } }, getElementById: id => els[id] || null };
`;

const mod = await import('data:text/javascript;base64,' + Buffer.from(
  stubs + html.slice(start, end)
  + '\nexport { themePref, applyShopTheme };'
  + '\nexport const setShopAccount = v => { isShop = v; };'
  + '\nexport const setPref = (k, v) => { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); };'
  + '\nexport const isDark = () => cls.has("dark-shop");'
  + '\nexport const isShopUI = () => cls.has("shop-ui");',
).toString('base64'));

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + e.message); } };
const reset = () => { mod.setPref('app_theme', null); mod.setPref('shop_theme', null); };

console.log('\nธีมสว่าง/มืด');

t('ยังไม่เคยเลือก: บัญชีทั่วไปเริ่มที่สว่าง · บัญชีร้านเริ่มที่มืด', () => {
  reset();
  mod.setShopAccount(false);
  assert.equal(mod.themePref(), 'light');
  mod.setShopAccount(true);
  assert.equal(mod.themePref(), 'dark');
});

t('เลือกไว้แล้วต้องชนะค่าเริ่มต้นเสมอ ทั้งสองทิศทาง', () => {
  reset();
  mod.setShopAccount(true);
  mod.setPref('app_theme', 'light');
  assert.equal(mod.themePref(), 'light', 'บัญชีร้านเลือกสว่างได้');
  mod.setShopAccount(false);
  mod.setPref('app_theme', 'dark');
  assert.equal(mod.themePref(), 'dark', 'บัญชีทั่วไปเลือกมืดได้');
});

t('ค่าที่เคยตั้งไว้แบบเก่า (shop_theme=light) ยังถูกนับอยู่ ไม่เด้งกลับเป็นมืด', () => {
  reset();
  mod.setShopAccount(true);
  mod.setPref('shop_theme', 'light');
  assert.equal(mod.themePref(), 'light');
});

t('applyShopTheme ใส่/ถอดคลาสธีมมืดตามที่เลือก', () => {
  reset();
  mod.setShopAccount(false);
  mod.setPref('app_theme', 'dark');
  mod.applyShopTheme();
  assert.equal(mod.isDark(), true);
  assert.equal(mod.isShopUI(), false, 'บัญชีทั่วไปไม่ควรโดนหน้าตาแบบร้าน');
  mod.setPref('app_theme', 'light');
  mod.applyShopTheme();
  assert.equal(mod.isDark(), false);
});

console.log('\nแถบหัวหน้า');

t('ทุกหน้าที่กดจากเมนูมีหัวข้อบนแถบหัว (ไม่มีหน้าไหนหัวข้อหาย)', () => {
  const views = [...new Set([...html.matchAll(/switchView\('(\w+)'\)/g)].map(m => m[1]))];
  const block = html.slice(html.indexOf('const MAIN_TB = {'), html.indexOf('function updateMainTopbar'));
  const missing = views.filter(v => !new RegExp('\\b' + v + ':').test(block));
  assert.deepEqual(missing, [], 'หน้าที่ยังไม่มีหัวข้อ: ' + missing.join(', '));
});

t('หัวข้อ h2 ถูกซ่อนเมื่อมีแถบหัวแล้ว จะได้ไม่ซ้ำกัน', () => {
  assert.ok(/body\.shop-ui \.view-title, body\.main-ui \.view-title \{ display: none/.test(html));
});

console.log('\nปุ่มใน popup');

t('popup ทั่วไปยังเป็น 2 ปุ่มเหมือนเดิม (ปุ่มที่ 3 ซ่อนไว้จนกว่าจะสั่ง)', () => {
  const bar = html.slice(html.indexOf('<div class="modal-actions" id="cfActions">'), html.indexOf('</div>', html.indexOf('id="cfOk"')));
  assert.ok(/id="cfDismiss"[^>]*style="display:none"/.test(bar), 'ปุ่มออกเฉย ๆ ต้องซ่อนไว้ก่อน');
  assert.ok(bar.indexOf('cfDismiss') < bar.indexOf('cfCancel'), 'ปุ่มปลอดภัยสุดอยู่ซ้ายสุด');
  assert.ok(bar.indexOf('cfCancel') < bar.indexOf('cfOk'), 'ปุ่มตกลงอยู่ขวาสุด');
});

t('ปุ่มออกเฉย ๆ ต้องไม่ถูกนับเป็นการปฏิเสธ', () => {
  assert.ok(/id="cfDismiss"[^>]*onclick="closeAppConfirm\(null\)"/.test(html), 'ต้องส่งค่า null เหมือนการปิดกล่อง');
  assert.ok(/id="cfCancel"[^>]*onclick="closeAppConfirm\(false\)"/.test(html));
});

console.log(`\n${fail ? '✗' : '✓'} ผ่าน ${pass} / ${pass + fail}\n`);
process.exit(fail ? 1 : 0);
