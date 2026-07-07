// playwright-task-executor.js v3.6 — always complete Browser_Tasks after script runs
const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
chromium.use(StealthPlugin());
const { createClient } = require('@supabase/supabase-js');
const https = require('https');
const fs = require('fs');
require('dotenv').config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const POLL_INTERVAL = 30000;
const STALE_RUNNING_MS = 2 * 60 * 60 * 1000; // reclaim running tasks older than 2h on startup
const EXEC_SYNC_MAX_BUFFER = 50 * 1024 * 1024; // long scripts (forecast-sync) can exceed 1MB stdout
let browser;
let pollInFlight = false;
let currentTaskId = null;

async function completeBrowserTask(taskId, { success, data, error }) {
  const payload = {
    status: success ? 'done' : 'failed',
    result: data ?? null,
    error_message: error ? String(error).substring(0, 3000) : null,
    completed_at: new Date().toISOString(),
  };

  // Prefer transitioning running → done/failed (idempotent if already terminal)
  let { data: updated, error: updateError } = await supabase
    .from('Browser_Tasks')
    .update(payload)
    .eq('id', taskId)
    .eq('status', 'running')
    .select('id');

  if (updateError) {
    console.error(`❌ Failed to update Browser_Tasks id=${taskId}: ${updateError.message}`);
    return false;
  }

  if (updated?.length) {
    console.log(`✅ Task ${taskId} → ${payload.status}`);
    return true;
  }

  const { data: row, error: readError } = await supabase
    .from('Browser_Tasks')
    .select('status')
    .eq('id', taskId)
    .maybeSingle();

  if (readError) {
    console.error(`❌ Could not read Browser_Tasks id=${taskId}: ${readError.message}`);
    return false;
  }

  if (row?.status === 'done' || row?.status === 'failed') {
    console.log(`ℹ️ Task ${taskId} already ${row.status}`);
    return true;
  }

  // Still pending/running but running-filter missed — force terminal update
  const { error: forceError } = await supabase
    .from('Browser_Tasks')
    .update(payload)
    .eq('id', taskId);

  if (forceError) {
    console.error(`❌ Force-complete failed for task ${taskId}: ${forceError.message}`);
    return false;
  }
  console.log(`✅ Task ${taskId} → ${payload.status} (force)`);
  return true;
}

async function reclaimStaleRunningTasks() {
  const cutoff = new Date(Date.now() - STALE_RUNNING_MS).toISOString();
  const { data: stale, error } = await supabase
    .from('Browser_Tasks')
    .select('id, task_type, created_at')
    .eq('status', 'running')
    .lt('created_at', cutoff);

  if (error) {
    console.log(`⚠️ Stale-task reclaim skipped: ${error.message}`);
    return;
  }
  if (!stale?.length) return;

  for (const task of stale) {
    console.log(`🧹 Reclaiming stale running task ${task.id} (${task.task_type})`);
    await completeBrowserTask(task.id, {
      success: false,
      data: { reclaimed: true, task_type: task.task_type },
      error: 'Executor restarted or task timed out — marked failed (was stuck in running)',
    });
  }
}

async function initBrowser() {
  if (!browser) {
    console.log('🚀 Initializing Chromium (stealth mode)...');
    try {
      // Prefer installed Chrome to avoid per-session Playwright cache misses.
      browser = await chromium.launch({ channel: 'chrome', headless: false });
    } catch (e) {
      console.log(`⚠️ Chrome channel launch failed: ${e.message}`);
      browser = await chromium.launch({ headless: false });
    }
  }
  return browser;
}

async function getCredentials(key) {
  const { data, error } = await supabase
    .from('Browser_Credentials')
    .select('*')
    .eq('key', key)
    .single();
  if (error) throw new Error(`Credentials not found: ${key}`);
  return data;
}

async function executeAction(page, action, creds = {}) {
  switch (action.type) {
    case 'navigate':
      console.log(`  → Navigate to ${action.url}`);
      await page.goto(action.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      break;
    case 'login':
      console.log(`  → Login with ${action.credentials_key}`);
      const loginCreds = await getCredentials(action.credentials_key);
      if (action.username_selector) await page.fill(action.username_selector, loginCreds.username);
      if (action.password_selector) await page.fill(action.password_selector, loginCreds.password);
      if (action.submit_selector) {
        await page.click(action.submit_selector);
        await page.waitForTimeout(3000);
      }
      break;
    case 'click':
      console.log(`  → Click ${action.selector}`);
      await page.click(action.selector);
      await page.waitForTimeout(1000);
      break;
    case 'wait':
      console.log(`  → Wait ${action.ms}ms`);
      await page.waitForTimeout(action.ms);
      break;
    case 'extract':
      console.log(`  → Extract ${action.field} from ${action.selector}`);
      const extracted = await page.evaluate((sel) => {
        const elem = document.querySelector(sel);
        return elem ? elem.innerText : null;
      }, action.selector);
      return { [action.field]: extracted };
    case 'extract_all':
      console.log(`  → Extract all from ${action.selector}`);
      const items = await page.evaluate((sel) => {
        return Array.from(document.querySelectorAll(sel)).map(el => el.innerText);
      }, action.selector);
      return { [action.field]: items };
    default:
      throw new Error(`Unknown action type: ${action.type}`);
  }
  return null;
}

// ── SCRIPT-BASED TASK ROUTING ─────────────────────────────────────────────────
const { execSync } = require('child_process');
const path = require('path');

const SCRIPT_TASKS = {
  'forecast-sync':             'flieber-forecast-updater.js',
  'forecast-verify':           'flieber-forecast-verifier.js',
  'po-simulation':             'flieber-replenishment-simulator.js',
  'to-simulation':             'flieber-replenishment-simulator.js',
  'inventory-forecast-sync':   'flieber-inventory-forecast-sync.js',
  'corax-stock-export':        'corax-wms-stock-export.js',
  'mintsoft-product-export':   'mintsoft-product-export.js',
  'forceget-inventory-export': 'forceget-inventory-export.js',
  'sellerboard-pl-export':     'sellerboard-pl-export.js',
  'inventory-sync-forceget':   'inventory-sync-forceget.js',
  'inventory-sync-kamps':      'inventory-sync-kamps.js',
  'inventory-sync-mintsoft':   'inventory-sync-mintsoft.js',
  'forceget-inventory':        'forceget-inventory.js',
  'glc-inventory':             'glc-inventory.js',
  'glc_inventory':             'glc-inventory.js',
  'kamps-inventory':           'kamps-inventory.js',
  'mintsoft-inventory':        'mintsoft-inventory.js',
  'sync-inventory':            'sync-inventory.js',
  'price-scrape':              'price-monitor-scraper.js',
  'competitor-mat-scrape':     'competitor-mat-scraper.js',
  'bol-price-update':          'bol-price-update.js',
  'bol-price-sync-all':        'bol-price-sync-all.js',
  'bol-cases-scrape':          'bol-cases-scrape.js',
  'staxxer-vat-sync':          'staxxer-vat-scraper.js',
  'amazon-buyer-messages':     'amazon-buyer-messages.js',
  'amz-price-update':          'amz-price-update.js',
  'amz-price-sync-all':        'amz-price-sync-all.js',
};

// Standalone scripts write JSON here; executor must match by task_type (not first-recent-file)
const TASK_OUTPUT_FILES = {
  'corax-stock-export':        'corax-stock-data.json',
  'mintsoft-product-export':   'mintsoft-product-data.json',
  'forceget-inventory-export': 'forceget-inventory-data.json',
  'sellerboard-pl-export':     'sellerboard-pl-data.json',
  'bol-cases-scrape':          'bol-cases-scrape-data.json',
  'staxxer-vat-sync':          'staxxer-vat-scrape-data.json',
  'amazon-buyer-messages':     'amazon-buyer-messages-data.json',
};

function parseStdoutJson(output) {
  const lines = output.trim().split('\n');
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

function readRecentJsonFile(filePath, maxAgeMs = 600000) {
  if (!fs.existsSync(filePath)) return null;
  try {
    const stat = fs.statSync(filePath);
    if (Date.now() - stat.mtimeMs > maxAgeMs) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (e) {
    console.log(`⚠️ Could not parse ${filePath}: ${e.message}`);
    return null;
  }
}


// ── COOKIE/STORAGE STATE MAPPING ──────────────────────────────────────────────
const STORAGE_STATE_MAP = {
  'vanthiel_corax_wms': 'corax-wms-storage-state.json',
  'mintsoft_login': 'mintsoft-storage-state.json',
  'forceget_login': 'forceget-storage-state.json',
  'glc_wms': 'glc-storage-state.json',
  'sellerboard_login': 'sellerboard-storage-state.json',
  'flieber_login': 'flieber-storage-state.json',
  'bol_seller': 'bol-storage-state.json',
  'staxxer_login': 'staxxer-storage-state.json',
};

const GITHUB_RAW = 'https://raw.githubusercontent.com/tim581/qualicoagents/main/scripts/';
// Never overwrite local-only scripts until pushed to qualicoagents
const NEVER_DOWNLOAD_FROM_GITHUB = new Set([
  'price-monitor-scraper.js',
  'amz-price-update.js',
  'bol-price-sync-all.js',
  'amz-price-sync-all.js',
  'competitor-mat-scraper.js',
  'inventory-sync-kamps.js',
  'inventory-sync-mintsoft.js',
  'inventory-sync-forceget.js',
]);

function downloadFromGitHub(scriptName) {
  return new Promise((resolve) => {
    const url = GITHUB_RAW + scriptName;
    const filePath = path.join(__dirname, scriptName);
    let settled = false;
    const finish = (msg) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (msg) console.log(msg);
      resolve();
    };

    const timer = setTimeout(() => finish(`⚠️ GitHub download timed out — using local ${scriptName}`), 15000);
    console.log(`📥 Downloading latest ${scriptName} from GitHub...`);

    const saveResponse = (res) => {
      const chunks = [];
      res.on('data', (d) => chunks.push(d));
      res.on('end', () => {
        fs.writeFileSync(filePath, Buffer.concat(chunks));
        const firstLine = fs.readFileSync(filePath, 'utf-8').split('\n')[0];
        finish(`✅ Downloaded: ${firstLine}`);
      });
      res.on('error', (e) => finish(`⚠️ GitHub download failed, using local: ${e.message}`));
    };

    const req = https.get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        https.get(res.headers.location, saveResponse).on('error', (e) =>
          finish(`⚠️ GitHub download failed, using local: ${e.message}`)
        );
        return;
      }
      if (res.statusCode === 404) {
        finish(`⚠️ Script not found on GitHub: ${scriptName}`);
        return;
      }
      saveResponse(res);
    });
    req.on('error', (e) => finish(`⚠️ GitHub download failed, using local: ${e.message}`));
  });
}

async function resolveScript(task) {
  // Layer 1: Hardcoded map
  if (SCRIPT_TASKS[task.task_type]) {
    console.log(`   📌 Script resolved: ${SCRIPT_TASKS[task.task_type]}`);
    return SCRIPT_TASKS[task.task_type];
  }
  // Layer 2: Check actions array for script reference (only objects, not strings)
  if (Array.isArray(task.actions) && task.actions.length > 0) {
    const scriptAction = task.actions.find(a => typeof a === 'object' && a !== null && a.script);
    if (scriptAction) {
      console.log(`   ⚡ Script from actions: ${scriptAction.script}`);
      return scriptAction.script;
    }
  }
  // Layer 3: Browser_Task_Registry
  try {
    const { data: registry } = await supabase
      .from('Browser_Task_Registry')
      .select('script_name')
      .eq('task_type', task.task_type)
      .single();
    if (registry?.script_name) {
      console.log(`   🗄️ Script from registry: ${registry.script_name}`);
      return registry.script_name;
    }
  } catch (e) {
    console.log(`   ℹ️ Registry lookup failed: ${e.message}`);
  }
  return null;
}

async function executeScriptTask(task, scriptName) {
  const scriptPath = path.join(__dirname, scriptName);
  
  const localSrc = fs.existsSync(scriptPath) ? fs.readFileSync(scriptPath, 'utf8') : '';
  const useLocal = process.env.USE_LOCAL_SCRIPTS === '1'
    || NEVER_DOWNLOAD_FROM_GITHUB.has(scriptName)
    || localSrc.includes('listing_content_puzzlup');
  if (useLocal) {
    console.log(`   📂 Using local ${scriptName} (skip GitHub sync)`);
  } else {
    try {
      await downloadFromGitHub(scriptName);
    } catch (e) {
      console.log(`⚠️ GitHub download failed, using local: ${e.message}`);
    }
  }
  
  if (!fs.existsSync(scriptPath)) {
    return { success: false, error: `Script not found: ${scriptName}` };
  }
  
  console.log(`\n🔧 Running: ${scriptName} for ${task.task_type}`);
  
  const scriptContent = fs.readFileSync(scriptPath, 'utf-8');
  const isModuleExports = /module\.exports\s*=/.test(scriptContent);
  
  if (isModuleExports) {
    // ── MODULE.EXPORTS PATTERN ──────────────────────────────
    console.log(`   📦 module.exports pattern — injecting browser + task context`);
    
    const b = await initBrowser();
    
    // ✅ v3.3: Auto-load storage state (cookies + localStorage) based on credentials_key
    const contextOpts = {
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
      viewport: { width: 1920, height: 1080 }
    };
    const cookieFileName = STORAGE_STATE_MAP[task.credentials_key];
    if (cookieFileName) {
      const storageStatePath = path.join(__dirname, cookieFileName);
      if (fs.existsSync(storageStatePath)) {
        contextOpts.storageState = storageStatePath;
        console.log(`   🍪 Loaded storage state: ${cookieFileName}`);
      } else {
        console.log(`   ⚠️ Cookie file not found: ${storageStatePath}`);
      }
    }
    const context = await b.newContext(contextOpts);
    const page = await context.newPage();
    
    const runId = `${task.task_type}_${Date.now()}`;
    const dbShot = async (p, step, message) => {
      try {
        const buf = await p.screenshot({ fullPage: false });
        const b64 = buf.toString('base64');
        await supabase.from('Flieber_Debug_Log').insert({
          run_id: runId, step, message,
          screenshot: `data:image/png;base64,${b64}`
        });
        console.log(`   📸 ${step}: ${message}`);
      } catch (e) {
        console.log(`   ⚠️ dbShot failed: ${e.message}`);
      }
    };
    
    try {
      delete require.cache[require.resolve(scriptPath)];
      const scriptFn = require(scriptPath);
      
      if (typeof scriptFn !== 'function') {
        throw new Error('module.exports is not a function');
      }
      
      const credentials = task.credentials_key
        ? await getCredentials(task.credentials_key).catch(() => null)
        : null;
      const log = async (step, message) => {
        console.log(`   [${step}] ${message}`);
        try { await dbShot(page, step, message); } catch (_) {}
      };

      // ✅ v3.2: Pass full task object so scripts can read task.actions, task.task_type etc.
      const result = await scriptFn({ page, context, supabase, dbShot, task, credentials, log });
      console.log(`✅ Script returned:`, JSON.stringify(result || {}).substring(0, 500));
      
      await page.close();
      await context.close();
      
      return { success: true, data: result || {} };
    } catch (error) {
      console.error(`❌ Script failed: ${error.message}`);
      if (dbShot) await dbShot(page, 'error', error.message).catch(() => {});
      await page.close().catch(() => {});
      await context.close().catch(() => {});
      return { success: false, error: error.message };
    }
  } else {
    // ── STANDALONE PATTERN ───────────────────────────────────
    console.log(`   🖥️ Standalone script — running with node`);
    
    const env = { ...process.env };
    env.BROWSER_TASK_ID = String(task.id);

    // Always use real Playwright browsers (not Cursor sandbox cache paths).
    if (process.env.LOCALAPPDATA) {
      const browsersPath = path.join(process.env.LOCALAPPDATA, 'ms-playwright');
      if (fs.existsSync(browsersPath)) env.PLAYWRIGHT_BROWSERS_PATH = browsersPath;
    }
    
    // Pass task-specific env variables
    if (task.task_type === 'po-simulation') env.RUN_MODE = 'po';
    if (task.task_type === 'to-simulation') env.RUN_MODE = 'to';
    
    // Sellerboard: pass market scope
    if (task.task_type === 'sellerboard-pl-export') {
      if (Array.isArray(task.actions) && task.actions.length > 0 && typeof task.actions[0] === 'string') {
        env.MARKET_SCOPE = task.actions[0];
        console.log(`   🌍 MARKET_SCOPE = ${env.MARKET_SCOPE}`);
      } else {
        env.MARKET_SCOPE = 'eu';
        console.log(`   🌍 MARKET_SCOPE = eu (default)`);
      }
    }
    
    // Pass all string actions as TASK_ACTIONS env var (generic mechanism)
    if (Array.isArray(task.actions) && task.actions.length > 0) {
      const stringActions = task.actions.filter(a => typeof a === 'string');
      if (stringActions.length > 0) {
        env.TASK_ACTIONS = JSON.stringify(stringActions);
      }
    }

    // Amazon price update: pass object actions as TASK_PARAMS (same pattern as bol-price-update loadTask)
    if (task.task_type === 'amz-price-update' && Array.isArray(task.actions) && task.actions.length > 0) {
      const objAction = task.actions.find((a) => typeof a === 'object' && a !== null && (a.asin || a.channel_name));
      if (objAction) {
        env.TASK_PARAMS = JSON.stringify(objAction);
        console.log(`   🏷️ TASK_PARAMS = ${env.TASK_PARAMS.substring(0, 200)}`);
      }
    }
    if (task.task_type === 'amz-price-update') {
      env.AMAZON_NO_PROXY = env.AMAZON_NO_PROXY || '1';
      env.AMAZON_PRICE_SKIP_CHANNELS = env.AMAZON_PRICE_SKIP_CHANNELS || 'AMZ BE';
    }
    if (task.task_type === 'bol-price-sync-all') {
      env.BOL_NO_PROXY = env.BOL_NO_PROXY || '1';
      env.BOL_SYNC_ALL = '1';
      env.BOL_FORCE_DATE_RANGE = '1';
    }
    if (task.task_type === 'amz-price-sync-all') {
      env.AMAZON_NO_PROXY = env.AMAZON_NO_PROXY || '1';
      env.AMAZON_PRICE_SKIP_CHANNELS = 'none';
    }
    
    try {
      const output = execSync(`node "${scriptPath}"`, {
        env,
        cwd: __dirname,
        timeout: 14400000,
        maxBuffer: EXEC_SYNC_MAX_BUFFER,
        stdio: 'pipe',
        encoding: 'utf-8',
      });
      console.log(output);
      
      // ── Read task-specific JSON output (never cross-contaminate bol ↔ amazon) ──
      let jsonData = null;
      const outputFile = TASK_OUTPUT_FILES[task.task_type];
      if (outputFile) {
        const filePath = path.join(__dirname, outputFile);
        jsonData = readRecentJsonFile(filePath);
        if (jsonData) {
          console.log(`📄 Task output: ${outputFile} (task ${task.id}, type ${task.task_type})`);
        }
      }

      // Fallback: last JSON line on stdout (amazon-buyer-messages, etc.)
      if (!jsonData) {
        jsonData = parseStdoutJson(output);
        if (jsonData) {
          console.log(`📄 Parsed JSON from stdout (task ${task.id}, type ${task.task_type})`);
        }
      }

      // Legacy fallback for unmapped export tasks only
      if (!jsonData) {
        for (const name of Object.values(TASK_OUTPUT_FILES)) {
          const filePath = path.join(__dirname, name);
          jsonData = readRecentJsonFile(filePath);
          if (jsonData) {
            console.log(`📄 Legacy output fallback: ${name}`);
            break;
          }
        }
      }
      
      if (jsonData) {
        const jsonStr = JSON.stringify(jsonData);
        if (jsonStr.length > 500000) {
          console.log(`⚠️ Output too large (${(jsonStr.length/1024).toFixed(0)}KB) — storing summary`);
          const summary = { _truncated: true, _size_kb: Math.round(jsonStr.length / 1024) };
          if (jsonData.markets) {
            summary.markets = {};
            for (const [mkt, views] of Object.entries(jsonData.markets)) {
              summary.markets[mkt] = {};
              for (const [view, data] of Object.entries(views)) {
                summary.markets[mkt][view] = { row_count: data.row_count || data.rows?.length, headers: data.headers };
              }
            }
          }
          if (Array.isArray(jsonData.items)) summary.item_count = jsonData.length;
          return { success: true, data: summary };
        }
        return { success: true, data: jsonData };
      }

      // Structured summary for long-running scripts without JSON output files
      if (task.task_type === 'forecast-sync') {
        const runMatch = output.match(/Debug run ID: (run_\d+)/);
        const doneMatch = output.match(/Done! (\d+) products updated, (\d+) skipped/);
        const errMatch = output.match(/(\d+) errors:/);
        return {
          success: true,
          data: {
            run_id: runMatch?.[1] || null,
            products_updated: doneMatch ? parseInt(doneMatch[1], 10) : null,
            products_skipped: doneMatch ? parseInt(doneMatch[2], 10) : null,
            error_count: errMatch ? parseInt(errMatch[1], 10) : 0,
          },
        };
      }

      return { success: true, data: { output: output.substring(0, 2000) } };
    } catch (error) {
      const stderr = error.stderr ? error.stderr.substring(0, 2000) : error.message;
      console.error(`❌ Script failed: ${stderr}`);
      return { success: false, error: stderr };
    }
  }
}

async function executeTask(task) {
  console.log(`\n📋 Task: ${task.id}`);
  console.log(`   Type: ${task.task_type}`);
  console.log(`   Actions: ${JSON.stringify(task.actions || []).substring(0, 100)}`);
  console.log(`   URL: ${task.url || '(script-based)'}`);

  const scriptName = await resolveScript(task);
  if (scriptName) {
    return await executeScriptTask(task, scriptName);
  }

  // No script found → generic action-based execution
  console.log(`   🌐 No script — generic action execution`);
  
  // ✅ v3.2: Skip generic execution if actions are just strings (not action objects)
  if (Array.isArray(task.actions)) {
    const hasStringActions = task.actions.some(a => typeof a === 'string');
    if (hasStringActions && !task.actions.some(a => typeof a === 'object' && a !== null && a.type)) {
      console.log(`   ⚠️ Actions are strings, not action objects — skipping generic execution`);
      return { success: false, error: `Task type '${task.task_type}' not found in SCRIPT_TASKS, Browser_Task_Registry, or actions. String actions ${JSON.stringify(task.actions)} are not executable. Check if the correct script exists on GitHub.` };
    }
  }

  const b = await initBrowser();
  const page = await b.newPage();
  
  try {
    let result = {};
    for (const action of (task.actions || [])) {
      if (typeof action !== 'object' || action === null || !action.type) {
        console.log(`   ⚠️ Skipping non-action item: ${JSON.stringify(action)}`);
        continue;
      }
      const actionResult = await executeAction(page, action);
      if (actionResult) {
        result = { ...result, ...actionResult };
      }
    }
    console.log(`✅ Task complete!`);
    return { success: true, data: result };
  } catch (error) {
    console.error(`❌ Task failed: ${error.message}`);
    return { success: false, error: error.message };
  } finally {
    await page.close();
  }
}

async function pollTasks() {
  if (pollInFlight) return;
  pollInFlight = true;

  console.log(`\n⏰ Polling... (${new Date().toLocaleTimeString()})`);

  try {
    const { data: tasks, error } = await supabase
      .from('Browser_Tasks')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(1);

    if (error) throw error;

    if (!tasks || tasks.length === 0) {
      return;
    }

    for (const task of tasks) {
      currentTaskId = task.id;

      const { error: runError } = await supabase
        .from('Browser_Tasks')
        .update({ status: 'running' })
        .eq('id', task.id)
        .eq('status', 'pending');

      if (runError) {
        console.error(`❌ Could not mark task ${task.id} running: ${runError.message}`);
        continue;
      }

      let result = { success: false, error: 'Task execution did not return a result' };
      try {
        result = await executeTask(task);
      } catch (execErr) {
        console.error(`❌ executeTask threw: ${execErr.message}`);
        result = { success: false, error: execErr.message };
      } finally {
        await completeBrowserTask(task.id, result);
      }

      if (result.data) {
        const preview = JSON.stringify(result.data).substring(0, 120);
        console.log(`💾 Result for task ${task.id}: ${preview}...`);
      }

      // ═══ AUTO-CHAIN: forecast-sync → forecast-verify ═══
      if (task.task_type === 'forecast-sync' && result.success) {
        console.log('🔗 Auto-queuing forecast-verify...');
        const { error: chainErr } = await supabase
          .from('Browser_Tasks')
          .insert({
            agent_name: task.agent_name || 'Multi Agent Mgr',
            task_type: 'forecast-verify',
            url: 'https://app.flieber.com/app/sales-forecast',
            actions: [],
            credentials_key: 'flieber_login',
            status: 'pending'
          });
        if (chainErr) console.error('⚠️ Chain failed:', chainErr.message);
        else console.log('✅ Verification queued');
      }

      currentTaskId = null;
    }
  } catch (error) {
    console.error('Poll error:', error.message);
    if (currentTaskId) {
      await completeBrowserTask(currentTaskId, {
        success: false,
        error: `Poll error: ${error.message}`,
      }).catch(() => {});
      currentTaskId = null;
    }
  } finally {
    pollInFlight = false;
  }
}

async function main() {
  console.log('══════════════════════════════════════════════════');
  console.log('  🎬 Playwright Task Executor v3.6');
  console.log('  ✅ Running — polling Supabase every 30s');
  console.log('  🖥️  Chromium opens when a task is queued');
  console.log('══════════════════════════════════════════════════');
  console.log(`📍 Supabase: ${SUPABASE_URL}`);
  console.log('📋 Task types:', Object.keys(SCRIPT_TASKS).join(', '));
  console.log('');

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('❌ Missing .env credentials');
    process.exit(1);
  }

  await reclaimStaleRunningTasks();

  setInterval(() => pollTasks(), POLL_INTERVAL);
  await pollTasks();
}

process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down...');
  if (currentTaskId) {
    await completeBrowserTask(currentTaskId, {
      success: false,
      error: 'Executor interrupted (SIGINT)',
    }).catch(() => {});
  }
  if (browser) await browser.close();
  process.exit(0);
});

main().catch(console.error);
