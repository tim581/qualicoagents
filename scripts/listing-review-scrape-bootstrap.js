'use strict';

/**
 * listing-review-scrape-bootstrap.js
 *
 * Downloaded by the already-running v3.6 executor. That process will not
 * download listing-monitor-review-*.js because those names are local-only on
 * newer executors, and the running process does not reload its manifest.
 * This filename is absent from the v3.6 NEVER_DOWNLOAD_FROM_GITHUB set.
 *
 * It fetches the merged review files from qualicoagents main, then runs
 * listing-monitor-review-scraper.js. It does not edit or restart the executor.
 *
 * Standalone script: the executor runs this file with node. Do not assign
 * the module export object with an equals sign, or the executor treats the
 * file as an injected-browser function.
 */

const fs = require('fs');
const https = require('https');
const path = require('path');
const { spawnSync } = require('child_process');

const RAW_BASE = 'https://raw.githubusercontent.com/tim581/qualicoagents/main/scripts/';
const DOWNLOAD_TIMEOUT_MS = 20000;
const MAX_REDIRECTS = 3;
const MAX_BYTES = 2 * 1024 * 1024;
const PRESERVED_ENV = ['BROWSER_TASK_ID', 'TASK_PARAMS', 'TASK_ACTIONS'];

const REQUIRED_FILES = [
  'listing-monitor-review-policy.js',
  'listing-monitor-review-lib.js',
  'listing-monitor-review-persist.js',
  'listing-monitor-review-scraper.js',
];

const FILE_MARKERS = {
  'listing-monitor-review-policy.js': 'function assessReview',
  'listing-monitor-review-lib.js': 'function parseAmazonReviewHtml',
  'listing-monitor-review-persist.js': 'puzzlup_review_policy_assessments',
  'listing-monitor-review-scraper.js': 'listing-review-scrape',
};

function coded(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function safeReason(error) {
  const code = error && error.code ? String(error.code) : 'bootstrap_failed';
  if (/^(https_required|timeout|too_many_redirects|response_too_large|invalid_file|download_failed|http_\d{3}|network_error|scraper_not_started)$/.test(code)) {
    return code;
  }
  return 'bootstrap_failed';
}

function validateReviewFile(name, text) {
  const marker = FILE_MARKERS[name];
  if (!marker) return false;
  const body = String(text || '');
  if (!body.includes("'use strict'") && !body.includes('"use strict"')) return false;
  return body.includes(marker);
}

function httpsGetBuffer(url, options = {}) {
  const timeoutMs = options.timeoutMs || DOWNLOAD_TIMEOUT_MS;
  const redirectsLeft = options.redirectsLeft == null ? MAX_REDIRECTS : options.redirectsLeft;
  if (!String(url).startsWith('https://')) return Promise.reject(coded('https_required'));
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      const status = res.statusCode || 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        if (redirectsLeft <= 0) {
          reject(coded('too_many_redirects'));
          return;
        }
        let next;
        try {
          next = new URL(res.headers.location, url).toString();
        } catch (error) {
          reject(coded('download_failed'));
          return;
        }
        httpsGetBuffer(next, { timeoutMs, redirectsLeft: redirectsLeft - 1 }).then(resolve, reject);
        return;
      }
      if (status !== 200) {
        res.resume();
        reject(coded(`http_${status}`));
        return;
      }
      const chunks = [];
      let size = 0;
      let failed = false;
      res.on('data', (chunk) => {
        if (failed) return;
        size += chunk.length;
        if (size > MAX_BYTES) {
          failed = true;
          req.destroy();
          reject(coded('response_too_large'));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => {
        if (!failed) resolve(Buffer.concat(chunks));
      });
    });
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      reject(coded('timeout'));
    });
    req.on('error', () => reject(coded('network_error')));
  });
}

function replaceFileAtomic(tmp, dest) {
  const backup = `${dest}.bootstrap-bak`;
  if (fs.existsSync(backup)) fs.unlinkSync(backup);
  if (fs.existsSync(dest)) fs.renameSync(dest, backup);
  try {
    fs.renameSync(tmp, dest);
  } catch (error) {
    if (fs.existsSync(backup) && !fs.existsSync(dest)) fs.renameSync(backup, dest);
    throw error;
  }
  if (fs.existsSync(backup)) fs.unlinkSync(backup);
}

function commitFiles(staged) {
  const done = [];
  try {
    for (const file of staged) {
      replaceFileAtomic(file.tmp, file.dest);
      done.push(file);
    }
  } catch (error) {
    for (const file of staged) {
      if (fs.existsSync(file.tmp)) fs.unlinkSync(file.tmp);
    }
    throw coded('download_failed');
  }
  return done;
}

async function installReviewFiles({ directory, get, files = REQUIRED_FILES }) {
  const staged = [];
  try {
    for (const name of files) {
      let body;
      try {
        body = await get(`${RAW_BASE}${name}`);
      } catch (error) {
        throw coded(error && error.code ? error.code : 'download_failed');
      }
      const text = Buffer.isBuffer(body) ? body.toString('utf8') : String(body || '');
      if (!validateReviewFile(name, text)) throw coded('invalid_file');
      const tmp = path.join(directory, `.${name}.${process.pid}.partial`);
      fs.writeFileSync(tmp, text);
      staged.push({ name, tmp, dest: path.join(directory, name) });
    }
    commitFiles(staged);
  } catch (error) {
    for (const file of staged) {
      if (fs.existsSync(file.tmp)) fs.unlinkSync(file.tmp);
    }
    throw error;
  }
}

function childEnv(base) {
  const env = { ...base };
  for (const key of PRESERVED_ENV) {
    if (Object.prototype.hasOwnProperty.call(base, key)) env[key] = base[key];
  }
  return env;
}

function defaultSpawn(exe, args, options) {
  return spawnSync(exe, args, options);
}

async function runBootstrap(options = {}) {
  const directory = options.directory || __dirname;
  const get = options.get || ((url) => httpsGetBuffer(url));
  const spawnImpl = options.spawnImpl || defaultSpawn;
  const env = options.env || process.env;
  const log = options.log || ((line) => console.log(line));
  try {
    await installReviewFiles({ directory, get });
  } catch (error) {
    log(JSON.stringify({ ok: false, error: 'listing_review_bootstrap_failed', reason: safeReason(error) }));
    return 1;
  }
  const scraper = path.join(directory, 'listing-monitor-review-scraper.js');
  const result = spawnImpl(process.execPath, [scraper], {
    cwd: directory,
    env: childEnv(env),
    stdio: 'inherit',
  });
  if (!result || result.error || result.status === null || result.status === undefined) {
    log(JSON.stringify({ ok: false, error: 'listing_review_bootstrap_failed', reason: 'scraper_not_started' }));
    return 1;
  }
  return result.status;
}

if (require.main === module) {
  runBootstrap().then((code) => {
    process.exit(code);
  }).catch(() => {
    console.log(JSON.stringify({ ok: false, error: 'listing_review_bootstrap_failed', reason: 'bootstrap_failed' }));
    process.exit(1);
  });
}

Object.assign(module.exports, {
  RAW_BASE,
  REQUIRED_FILES,
  PRESERVED_ENV,
  validateReviewFile,
  httpsGetBuffer,
  replaceFileAtomic,
  installReviewFiles,
  runBootstrap,
});
