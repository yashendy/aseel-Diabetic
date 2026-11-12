#!/usr/bin/env node
// tools/protocol/migrate.mjs
// ----------------------------------------------------------------------------
// يوحّد بيانات البروتوكول العلاجي في وثائق الأطفال حسب المخطط المعتمد
// (انظر js/child-protocol.js).
//
// الاستخدام (من Cloud Shell، داخل فولدر tools/protocol بعد: npm install):
//   node migrate.mjs                    تجربة جافة: يعرض ما سيتغير فقط (لا يكتب شيئاً)
//   node migrate.mjs --apply            يطبّق: نسخة احتياطية JSON ثم التعديل
//   node migrate.mjs --apply --final    يحذف أيضاً الحقول القديمة التي ما زال بعض الكود يقرؤها
//                                       (يُستخدم فقط بعد تحديث كل الصفحات)
//   node migrate.mjs --child=<childId>  لطفل واحد
// ----------------------------------------------------------------------------
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

// نستورد وحدة البروتوكول عبر data: URL لتعمل على أي إصدار Node
async function loadProtocolModule() {
  const src = readFileSync(join(here, '..', '..', 'js', 'child-protocol.js'), 'utf8');
  return import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'));
}

const jsonSafe = (key, v) => (v && typeof v === 'object' && typeof v.toDate === 'function' ? { __timestamp: v.toDate().toISOString() } : v);

export async function runMigration({ db, FieldValue, apply = false, final = false, only = null, backupDir = './protocol-backups', log = console.log, now = () => new Date(), write = writeFileSync, mkdir = mkdirSync }) {
  const { canonicalizeChild, getProtocol, labelOf } = await loadProtocolModule();
  const snap = await db.collectionGroup('children').get();
  const summary = { total: 0, changed: 0, notReady: 0, applied: 0 };
  if (apply) mkdir(backupDir, { recursive: true });

  for (const d of snap.docs) {
    if (only && d.id !== only) continue;
    summary.total++;
    const data = d.data();
    const parentId = d.ref.parent.parent.id;
    const plan = canonicalizeChild(data, { final });
    const proto = getProtocol(data);
    const blockers = proto.missing.map(labelOf);

    log(`\n━━ ${data.name || '(بلا اسم)'}  [${parentId}/${d.id}]`);
    log(`   يُكتب  : ${Object.keys(plan.set).length ? JSON.stringify(plan.set) : '—'}`);
    log(`   يُحذف  : ${plan.remove.length ? plan.remove.join(', ') : '—'}`);
    plan.notes.forEach(n => log(`   ${n}`));
    log(`   جاهزية الحساب: ${blockers.length ? '❌ ينقصها: ' + blockers.join('، ') : '✅ كاملة'}`);
    if (blockers.length) summary.notReady++;
    if (!plan.needed) { log('   (لا تغيير مطلوب)'); continue; }
    summary.changed++;

    if (apply) {
      const ts = now().toISOString().replace(/[:.]/g, '-');
      const file = join(backupDir, `${parentId}_${d.id}_${ts}.json`);
      write(file, JSON.stringify(data, jsonSafe, 2));               // نسخة احتياطية قبل أي تعديل
      const update = { ...plan.set };
      plan.remove.forEach(k => { update[k] = FieldValue.delete(); });
      update.protocolVersion = 2;
      update.protocolMigratedAt = FieldValue.serverTimestamp();
      await d.ref.update(update);
      if (Object.keys(plan.set).length) {
        await d.ref.collection('regimen_history').add({
          at: FieldValue.serverTimestamp(), by: 'migration', byName: 'ترحيل توحيد البروتوكول',
          changes: Object.entries(plan.set).map(([field, to]) => ({ field, to }))
        });
      }
      summary.applied++;
      log(`   ✅ تم التطبيق (النسخة الاحتياطية: ${file})`);
    }
  }
  log(`\n═══ الملخص: ${summary.total} طفل | يحتاج تعديلاً: ${summary.changed} | غير جاهز للحساب: ${summary.notReady} | طُبّق: ${summary.applied}${apply ? '' : '  (تجربة جافة: لم يُكتب شيء)'}`);
  return summary;
}

// تشغيل من سطر الأوامر
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const { initializeApp } = await import('firebase-admin/app');
  const { getFirestore, FieldValue } = await import('firebase-admin/firestore');
  initializeApp({ projectId: 'sugar-kids-tracker' });
  const only = (args.find(a => a.startsWith('--child=')) || '').split('=')[1] || null;
  runMigration({ db: getFirestore(), FieldValue, apply: args.includes('--apply'), final: args.includes('--final'), only })
    .catch(e => { console.error('فشل الترحيل:', e); process.exit(1); });
}
