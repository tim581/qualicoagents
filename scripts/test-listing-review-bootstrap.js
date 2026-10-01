#!/usr/bin/env node
'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const bootstrap = require('./listing-review-scrape-bootstrap');

const OLD_NEVER_DOWNLOAD = new Set([
  'price-monitor-scraper.js',
  'amz-price-update.js',
  'bol-price-sync-all.js',
  'amz-price-sync-all.js',
  'competitor-mat-scraper.js',
  'inventory-sync-kamps.js',
  'inventory-sync-mintsoft.js',
  'inventory-sync-forceget.js',
]);

function bodies() {
  return {
    'listing-monitor-review-policy.js': "'use strict';\nfunction assessReview() { return { status: 'not_assessed' }; }\n",
    'listing-monitor-review-lib.js': "'use strict';\nfunction parseAmazonReviewHtml() { return { reviews: [] }; }\n",
    'listing-monitor-review-persist.js': "'use strict';\nconst ASSESSMENT_TABLE = 'puzzlup_review_policy_assessments';\n",
    'listing-monitor-review-scraper.js': "'use strict';\n/* Browser_Tasks task_type: listing-review-scrape */\n",
  };
}

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'listing-review-bootstrap-'));
}

function getter(map, failName) {
  return async (url) => {
    assert.equal(String(url).startsWith('https://raw.githubusercontent.com/tim581/qualicoagents/main/scripts/'), true);
    const name = String(url).split('/').pop();
    if (failName && name === failName) {
      throw Object.assign(new Error('http_503'), { code: 'http_503' });
    }
    if (!Object.prototype.hasOwnProperty.call(map, name)) {
      throw Object.assign(new Error('http_404'), { code: 'http_404' });
    }
    return Buffer.from(map[name]);
  };
}

async function main() {
  const source = fs.readFileSync(path.join(__dirname, 'listing-review-scrape-bootstrap.js'), 'utf8');
  assert.equal(/module\.exports\s*=/.test(source), false);
  assert.equal(OLD_NEVER_DOWNLOAD.has('listing-review-scrape-bootstrap.js'), false);
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'browser-automation-manifest.json'), 'utf8'));
  const task = manifest.automations.find((entry) => entry.task_type === 'listing-review-scrape');
  assert.equal(task.script_name, 'listing-review-scrape-bootstrap.js');

  const failedLogs = [];
  let failedSpawns = 0;
  const failedDir = tempDir();
  const failedCode = await bootstrap.runBootstrap({
    directory: failedDir,
    get: async () => {
      throw Object.assign(new Error('http_503'), { code: 'http_503' });
    },
    spawnImpl: () => {
      failedSpawns += 1;
      return { status: 0 };
    },
    log: (line) => failedLogs.push(line),
  });
  assert.equal(failedCode, 1);
  assert.equal(failedSpawns, 0);
  assert.equal(JSON.parse(failedLogs[0]).ok, false);
  assert.equal(JSON.parse(failedLogs[0]).reason, 'http_503');
  assert.equal(fs.readdirSync(failedDir).length, 0);

  const partialDir = tempDir();
  const existing = path.join(partialDir, 'listing-monitor-review-scraper.js');
  fs.writeFileSync(existing, 'OLD SCRAPER');
  const partialLogs = [];
  let partialSpawns = 0;
  const partialCode = await bootstrap.runBootstrap({
    directory: partialDir,
    get: getter(bodies(), 'listing-monitor-review-persist.js'),
    spawnImpl: () => {
      partialSpawns += 1;
      return { status: 0 };
    },
    log: (line) => partialLogs.push(line),
  });
  assert.equal(partialCode, 1);
  assert.equal(partialSpawns, 0);
  assert.equal(fs.readFileSync(existing, 'utf8'), 'OLD SCRAPER');
  assert.equal(fs.readdirSync(partialDir).some((name) => name.includes('.partial') || name.endsWith('.bootstrap-bak')), false);
  assert.equal(JSON.parse(partialLogs[0]).reason, 'http_503');

  const atomicDir = tempDir();
  fs.writeFileSync(path.join(atomicDir, 'listing-monitor-review-scraper.js'), 'OLD SCRAPER');
  const map = bodies();
  let spawnEnv = null;
  let spawnStdio = null;
  const atomicCode = await bootstrap.runBootstrap({
    directory: atomicDir,
    env: { BROWSER_TASK_ID: '41', TASK_PARAMS: '{"asins":["B09MBH7RFW"]}', TASK_ACTIONS: '["de"]', OTHER: 'drop-check' },
    get: getter(map),
    spawnImpl: (exe, args, options) => {
      spawnEnv = options.env;
      spawnStdio = options.stdio;
      assert.equal(args[0], path.join(atomicDir, 'listing-monitor-review-scraper.js'));
      assert.equal(fs.existsSync(args[0] + '.partial'), false);
      return { status: 7 };
    },
  });
  assert.equal(atomicCode, 7);
  assert.equal(spawnStdio, 'inherit');
  assert.equal(spawnEnv.BROWSER_TASK_ID, '41');
  assert.equal(spawnEnv.TASK_PARAMS, '{"asins":["B09MBH7RFW"]}');
  assert.equal(spawnEnv.TASK_ACTIONS, '["de"]');
  const replaced = fs.readFileSync(path.join(atomicDir, 'listing-monitor-review-scraper.js'), 'utf8');
  assert.equal(replaced.includes('OLD SCRAPER'), false);
  assert.equal(replaced, map['listing-monitor-review-scraper.js']);
  for (const name of bootstrap.REQUIRED_FILES) {
    assert.equal(fs.readFileSync(path.join(atomicDir, name), 'utf8'), map[name]);
  }
  assert.equal(fs.readdirSync(atomicDir).some((name) => name.includes('.partial') || name.endsWith('.bootstrap-bak')), false);

  const successCode = await bootstrap.runBootstrap({
    directory: tempDir(),
    get: getter(bodies()),
    spawnImpl: () => ({ status: 0 }),
  });
  assert.equal(successCode, 0);

  await assert.rejects(() => bootstrap.httpsGetBuffer('http://example.com/scripts/listing-monitor-review-scraper.js'), (error) => error.code === 'https_required');

  console.log('listing review bootstrap tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
