'use strict';

const { runVerifyAndCleanup, REPORT_PATH } = require('./amz-downloads-verify-and-cleanup');

/**
 * Optional post-download verify/cleanup hook.
 * Skipped when AMZ_SKIP_POST_VERIFY=1.
 * Use AMZ_VERIFY_NO_CLEANUP=1 to verify only (safe while another backfill is writing).
 */
function maybeRunPostVerify(source = 'unknown') {
  if (process.env.AMZ_SKIP_POST_VERIFY === '1') return null;

  const cleanup = process.env.AMZ_VERIFY_NO_CLEANUP !== '1';
  try {
    const report = runVerifyAndCleanup({ cleanup });
    return {
      source,
      report_path: REPORT_PATH,
      complete: report.complete,
      critical_gaps: report.critical_gaps,
      payments: {
        expected: report.payments.expected,
        effective_expected: report.payments.effective_expected,
        found: report.payments.found,
        missing: report.payments.missing_count,
      },
      ads: {
        expected: report.ads.expected,
        found: report.ads.found,
        missing: report.ads.missing_count,
      },
      backfill_running: report.backfill_running || [],
    };
  } catch (error) {
    return { source, error: error.message, report_path: REPORT_PATH };
  }
}

module.exports = { maybeRunPostVerify, REPORT_PATH };
