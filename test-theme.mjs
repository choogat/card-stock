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

console.log(`\n${fail ? '✗' : '✓'} ผ่าน ${pass} / ${pass + fail}\n`);
process.exit(fail ? 1 : 0);
