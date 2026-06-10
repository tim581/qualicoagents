/**
 * sync-inventory.js — Run all 4 warehouse scrapers.
 * Each script: scrape → JSON (Tasklet pickup) + Supabase Inventory_Levels.
 * Tasklet handles Google Sheets + Inventory_Snapshots separately.
 *
 *   node scripts/sync-inventory.js
 */
'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const path = require('path');
const { spawn } = require('child_process');

const SCRAPERS_PARALLEL = ['forceget-inventory.js', 'kamps-inventory.js', 'mintsoft-inventory.js'];
const SCRAPER_GLC = 'glc-inventory.js'; // runs after forceget (needs forceget.json for US combine)

function runScript(scriptName) {
  return new Promise((resolve) => {
    const scriptPath = path.join(__dirname, scriptName);
    console.log(`\n▶ ${scriptName}`);
    const child = spawn(process.execPath, [scriptPath], {
      cwd: path.join(__dirname, '..'),
      env: process.env,
      stdio: 'inherit',
    });
    child.on('close', (code) => resolve({ script: scriptName, ok: code === 0 }));
  });
}

(async () => {
  console.log('🚀 sync-inventory.js — running all warehouse scrapers...');

  const parallel = await Promise.all(SCRAPERS_PARALLEL.map(runScript));
  const glc = await runScript(SCRAPER_GLC);

  const all = [...parallel, glc];
  const failed = all.filter((r) => !r.ok).map((r) => r.script);

  if (failed.length) {
    console.error(`\n❌ Failed: ${failed.join(', ')}`);
    process.exit(1);
  }

  console.log('\n✅ All inventory scrapers completed.');
})();
