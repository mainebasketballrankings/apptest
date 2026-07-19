#!/usr/bin/env node
// Runs every suite and prints ONE line each. Exit code 0 = everything passed.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const SKIP = new Set(['run-all.js','loadapp.js','fieldload.js','genpdf.js','genpdf2.js','smoke.js']);
const files = fs.readdirSync(__dirname).filter(f => f.endsWith('.js') && !SKIP.has(f)).sort();

let failed = [];
console.log(`\nRunning ${files.length} suites…\n`);
for (const f of files) {
  let line = '', ok = true;
  try {
    const out = execFileSync('node', [path.join(__dirname, f)], { encoding: 'utf8', timeout: 180000, stdio: ['ignore','pipe','pipe'] });
    line = out.trim().split('\n').filter(Boolean).pop() || '(no output)';
  } catch (e) {
    ok = false;
    const out = ((e.stdout || '') + (e.stderr || '')).trim();
    line = out.split('\n').filter(Boolean).pop() || e.message;
  }
  if (!ok || /FAIL/.test(line)) { failed.push(f); }
  console.log(`  ${(ok && !/FAIL/.test(line)) ? '✅' : '❌'}  ${f.replace('.js','').padEnd(14)} ${line}`);
}
console.log('');
if (failed.length) { console.log(`❌  ${failed.length} suite(s) failed: ${failed.join(', ')}\n`); process.exit(1); }
console.log(`✅  All ${files.length} suites passed.\n`);
