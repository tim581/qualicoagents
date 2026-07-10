'use strict';

/**
 * amz-downloads-backfill-until-complete.js
 *
 * Orchestrates payments backfill → ads backfill → verify/cleanup in a loop
 * until all expected PDFs are on Drive or auth hard-fails.
 *
 * Usage:
 *   node scripts/amz-downloads-backfill-until-complete.js
 *   AMZ_DOWNLOADS_SKIP_WAIT=1 node scripts/amz-downloads-backfill-until-complete.js
 *
 * Env:
 *   AMAZON_DOWNLOADS_DIR — Google Drive shortcut root
 *   AMZ_DOWNLOADS_MAX_ROUNDS (default 25)
 *   AMZ_DOWNLOADS_WAIT_FOR_RUNNING_MS (default 7200000 = 2h)
 *   AMZ_DOWNLOADS_POLL_RUNNING_MS (default 30000)
 *   AMZ_DOWNLOADS_SKIP_WAIT=1 — don't wait for other backfill node processes
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
try {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
} catch (_) { /* optional */ }

const { resolveDownloadsBase, DRIVE_SHORTCUT_ROOT } = require('./amz-accountant-paths');

const ROOT = path.join(__dirname, '..');
const LOG_PATH = path.join(ROOT, '.debug', 'amz-downloads-backfill-loop.log');
const SUMMARY_PATH = path.join(ROOT, '.debug', 'amz-downloads-backfill-loop-summary.json');
const VERIFY_SCRIPT = path.join(__dirname, 'amz-downloads-verify-and-cleanup.js');
const PAYMENTS_SCRIPT = path.join(__dirname, 'amz-payments-reports-download.js');
const ADS_SCRIPT = path.join(__dirname, 'amz-ads-invoice-download.js');

const MAX_ROUNDS = parseInt(process.env.AMZ_DOWNLOADS_MAX_ROUNDS || '25', 10);
const WAIT_FOR_RUNNING_MS = parseInt(process.env.AMZ_DOWNLOADS_WAIT_FOR_RUNNING_MS || '7200000', 10);
const POLL_RUNNING_MS = parseInt(process.env.AMZ_DOWNLOADS_POLL_RUNNING_MS || '30000', 10);
const SKIP_WAIT = process.env.AMZ_DOWNLOADS_SKIP_WAIT === '1';

const DEFAULT_PAYMENTS_PARAMS = {
  years: [2025, 2026],
  months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  marketplaces: ['US', 'CA', 'UK', 'DE', 'FR', 'IT', 'ES', 'NL', 'BE'],
  report_types: ['summary'],
  skip_existing: true,
  dry_run: false,
};

const DEFAULT_ADS_PARAMS = {
  years: [2025, 2026],
  skip_existing: true,
  dry_run: false,
  limit: 0,
};

const WATCHED_SCRIPTS = [
  'amz-payments-reports-download.js',
  'amz-ads-invoice-download.js',
];

const AUTH_FAIL_RE = /sign-in required|login prompt|refresh amazon-storage-state|Amazon Ads sign-in|Missing scripts\/amazon-storage-state/i;

function log(line) {
  fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
  const msg = `${new Date().toISOString()} ${line}`;
  fs.appendFileSync(LOG_PATH, `${msg}\n`);
  console.log(msg);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function ensureDrivePath() {
  const base = process.env.AMAZON_DOWNLOADS_DIR || resolveDownloadsBase();
  if (!fs.existsSync(base)) {
    log(`WARNING: downloads base not found: ${base}`);
    if (fs.existsSync(DRIVE_SHORTCUT_ROOT)) {
      process.env.AMAZON_DOWNLOADS_DIR = DRIVE_SHORTCUT_ROOT;
      log(`Set AMAZON_DOWNLOADS_DIR=${DRIVE_SHORTCUT_ROOT}`);
      return DRIVE_SHORTCUT_ROOT;
    }
  }
  process.env.AMAZON_DOWNLOADS_DIR = base;
  return base;
}

function loadVerifyModule() {
  if (!fs.existsSync(VERIFY_SCRIPT)) {
    throw new Error(`Missing ${VERIFY_SCRIPT} — run Drive verify worker first or create the script`);
  }
  return require('./amz-downloads-verify-and-cleanup');
}

function listRunningNodeScripts() {
  const ps = spawnSync(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      "Get-CimInstance Win32_Process -Filter \"name='node.exe'\" | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress",
    ],
    { encoding: 'utf8', timeout: 30000 },
  );
  if (ps.status !== 0 || !ps.stdout) return [];

  let rows = [];
  try {
    const parsed = JSON.parse(ps.stdout.trim() || '[]');
    rows = Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }

  const selfPid = process.pid;
  const hits = [];
  for (const row of rows) {
    if (!row || !row.CommandLine) continue;
    if (Number(row.ProcessId) === selfPid) continue;
    for (const script of WATCHED_SCRIPTS) {
      if (row.CommandLine.includes(script)) {
        hits.push({ pid: row.ProcessId, script, commandLine: row.CommandLine });
      }
    }
  }
  return hits;
}

async function waitForRunningBackfills() {
  if (SKIP_WAIT) {
    log('AMZ_DOWNLOADS_SKIP_WAIT=1 — not waiting for other backfill processes');
    return [];
  }

  const deadline = Date.now() + WAIT_FOR_RUNNING_MS;
  let last = [];
  while (Date.now() < deadline) {
    last = listRunningNodeScripts();
    if (last.length === 0) {
      log('No other payments/ads backfill node processes running — continuing');
      return [];
    }
    const desc = last.map((h) => `${h.script}(pid=${h.pid})`).join(', ');
    log(`Waiting for running backfills: ${desc}`);
    await sleep(POLL_RUNNING_MS);
  }

  log(`Timed out after ${WAIT_FOR_RUNNING_MS}ms waiting for: ${last.map((h) => h.script).join(', ')} — continuing anyway`);
  return last;
}

function parseJsonTail(output) {
  const lines = String(output || '').trim().split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line.startsWith('{')) continue;
    try {
      return JSON.parse(line);
    } catch {
      /* keep scanning */
    }
  }
  return null;
}

function detectAuthHardFail(output) {
  return AUTH_FAIL_RE.test(String(output || ''));
}

function runChildScript(scriptPath, params, label, timeoutMs = 4 * 60 * 60 * 1000) {
  const scriptName = path.basename(scriptPath);
  log(`--- ${label}: node scripts/${scriptName} ---`);
  const env = {
    ...process.env,
    TASK_PARAMS: JSON.stringify(params),
    REPORT_TASK_PARAMS: JSON.stringify(params),
  };

  const result = spawnSync('node', [scriptPath], {
    cwd: ROOT,
    env,
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
  });

  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  const tail = output.trim().split('\n').slice(-40).join('\n');
  if (tail) log(tail.slice(-6000));

  const parsed = parseJsonTail(output);
  const authHardFail = detectAuthHardFail(output);
  return {
    label,
    script: scriptName,
    status: result.status,
    signal: result.signal,
    parsed,
    authHardFail,
    error: result.error ? result.error.message : null,
  };
}

function runPayments(params) {
  return runChildScript(PAYMENTS_SCRIPT, params, 'payments backfill', 5 * 60 * 60 * 1000);
}

function runAds(params) {
  return runChildScript(ADS_SCRIPT, params, 'ads backfill', 3 * 60 * 60 * 1000);
}

function runVerify() {
  const verify = loadVerifyModule();
  const report = verify.runVerifyAndCleanup({ cleanup: true });
  log(
    `Verify: payments ${report.payments.found}/${report.payments.expected}`
    + ` missing=${report.payments.missing_count},`
    + ` ads ${report.ads.found}/${report.ads.expected}`
    + ` missing=${report.ads.missing_count},`
    + ` critical_gaps=${report.critical_gaps}`,
  );
  return report;
}

async function main() {
  const downloadsBase = ensureDrivePath();
  const verify = loadVerifyModule();
  log(`Starting backfill-until-complete (max ${MAX_ROUNDS} rounds)`);
  log(`Drive base: ${downloadsBase}`);

  await waitForRunningBackfills();

  const rounds = [];
  let paymentsParams = { ...DEFAULT_PAYMENTS_PARAMS };
  let adsParams = { ...DEFAULT_ADS_PARAMS };
  let finalReport = null;
  let authBlocker = null;

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    log(`========== Round ${round}/${MAX_ROUNDS} ==========`);

    const paymentsResult = runPayments(paymentsParams);
    if (paymentsResult.authHardFail) {
      authBlocker = { phase: 'payments', message: 'Amazon Seller Central auth required' };
      rounds.push({ round, paymentsResult, adsResult: null, verify: null, authBlocker });
      break;
    }

    const adsResult = runAds(adsParams);
    if (adsResult.authHardFail) {
      authBlocker = { phase: 'ads', message: 'Amazon Ads auth required' };
      rounds.push({ round, paymentsResult, adsResult, verify: null, authBlocker });
      break;
    }

    const report = runVerify();
    finalReport = report;
    const retry = verify.buildTargetedRetryParams(report);

    rounds.push({
      round,
      paymentsResult: {
        status: paymentsResult.status,
        ok: paymentsResult.parsed?.ok ?? null,
        totals: paymentsResult.parsed?.totals ?? null,
      },
      adsResult: {
        status: adsResult.status,
        ok: adsResult.parsed?.ok ?? null,
        totals: adsResult.parsed?.totals ?? null,
      },
      verify: {
        critical_gaps: report.critical_gaps,
        payments_missing: report.payments.missing_count,
        ads_missing: report.ads.missing_count,
        complete: report.complete,
      },
      targeted_retry: retry,
    });

    if (report.complete) {
      log('All expected payments summaries and ads invoices found on Drive');
      break;
    }

    paymentsParams = retry.payments ? { ...retry.payments } : { ...DEFAULT_PAYMENTS_PARAMS, skip_existing: true };
    adsParams = retry.ads ? { ...retry.ads } : { ...DEFAULT_ADS_PARAMS, skip_existing: true };

    log(
      `Gaps remain — next round targets:`
      + ` payments=${retry.payments ? `${retry.payments.marketplaces.length} markets, ${retry.payments.months.length} months` : 'full'},`
      + ` ads=${retry.ads ? `${retry.ads.invoice_ids.length} invoice IDs` : 'full'}`,
    );

    await sleep(5000);
  }

  if (!finalReport) {
    finalReport = verify.runVerifyAndCleanup({ cleanup: false });
  }

  const summary = {
    finished_at: new Date().toISOString(),
    downloads_base: downloadsBase,
    complete: finalReport.complete,
    critical_gaps: finalReport.critical_gaps,
    auth_blocker: authBlocker,
    rounds,
    final_report_path: verify.REPORT_PATH,
    log_path: LOG_PATH,
  };

  fs.mkdirSync(path.dirname(SUMMARY_PATH), { recursive: true });
  fs.writeFileSync(SUMMARY_PATH, JSON.stringify(summary, null, 2));
  log(`Summary → ${SUMMARY_PATH}`);
  log(`Verification report → ${verify.REPORT_PATH}`);

  if (authBlocker) {
    log(`Stopped: auth hard fail during ${authBlocker.phase} — refresh amazon-storage-state.json`);
    process.exit(2);
  }
  process.exit(finalReport.complete ? 0 : 1);
}

if (require.main === module) {
  main().catch((err) => {
    log(`Fatal: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { main, waitForRunningBackfills, runPayments, runAds, runVerify };
