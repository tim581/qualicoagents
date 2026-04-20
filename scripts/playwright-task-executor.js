// playwright-task-executor.js v3.2 — pass task to module scripts, handle string actions
const { chromium } = require('playwright-core');
const { createClient } = require('@supabase/supabase-js');
const https = require('https');
const fs = require('fs');
require('dotenv').config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const POLL_INTERVAL = 30000;
let browser;

async function initBrowser() {
  if (!browser) {
    console.log('🚀 Initializing Chromium...');
    browser = await chromium.launch({ headless: false });
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
  'corax-stock-export':        'corax-wms-stock-export.js',
  'mintsoft-product-export':   'mintsoft-product-export.js',
  'forceget-inventory-export': 'forceget-inventory-export.js',
  'sellerboard-pl-export':     'sellerboard-pl-export.js',
  'inventory-sync-forceget':   'inventory-sync-forceget.js',
  'inventory-sync-kamps':      'inventory-sync-kamps.js',
  'inventory-sync-mintsoft':   'inventory-sync-mintsoft.js',
  'inventory-sync-bol':        'inventory-sync-bol.js',
  'price-scrape':              'price-monitor-scraper.js',
};

const GITHUB_RAW = 'https://raw.githubusercontent.com/tim581/qualicoagents/main/scripts/';

function downloadFromGitHub(scriptName) {
  return new Promise((resolve, reject) => {
    const url = GITHUB_RAW + scriptName;
    const filePath = path.join(__dirname, scriptName);
    console.log(`📥 Downloading latest ${scriptName} from GitHub...`);
    https.get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        https.get(res.headers.location, (res2) => {
          const chunks = [];
          res2.on('data', (d) => chunks.push(d));
          res2.on('end', () => {
            fs.writeFileSync(filePath, Buffer.concat(chunks));
            const firstLine = fs.readFileSync(filePath, 'utf-8').split('\n')[0];
            console.log(`✅ Downloaded: ${firstLine}`);
            resolve();
          });
        }).on('error', reject);
        return;
      }
      if (res.statusCode === 404) {
        console.log(`⚠️ Script not found on GitHub: ${scriptName}`);
        resolve();
        return;
      }
      const chunks = [];
      res.on('data', (d) => chunks.push(d));
      res.on('end', () => {
        fs.writeFileSync(filePath, Buffer.concat(chunks));
        const firstLine = fs.readFileSync(filePath, 'utf-8').split('\n')[0];
        console.log(`✅ Downloaded: ${firstLine}`);
        resolve();
      });
    }).on('error', reject);
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
  
  try {
    await downloadFromGitHub(scriptName);
  } catch (e) {
    console.log(`⚠️ GitHub download failed, using local: ${e.message}`);
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
    const context = await b.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
      viewport: { width: 1920, height: 1080 }
    });
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
      
      // ✅ v3.2: Pass full task object so scripts can read task.actions, task.task_type etc.
      const result = await scriptFn({ page, context, supabase, dbShot, task });
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
    
    try {
      const output = execSync(`node "${scriptPath}"`, {
        env,
        cwd: __dirname,
        timeout: 14400000,
        stdio: 'pipe',
        encoding: 'utf-8',
      });
      console.log(output);
      
      // ── Detect JSON output files ──
      let jsonData = null;
      const possibleFiles = [
        path.join(__dirname, 'corax-stock-data.json'),
        path.join(__dirname, 'mintsoft-product-data.json'),
        path.join(__dirname, 'forceget-inventory-data.json'),
        path.join(__dirname, 'sellerboard-pl-data.json'),
      ];
      
      for (const f of possibleFiles) {
        if (fs.existsSync(f)) {
          try {
            const stat = fs.statSync(f);
            if (Date.now() - stat.mtimeMs < 600000) {
              jsonData = JSON.parse(fs.readFileSync(f, 'utf-8'));
              console.log(`📄 Found output: ${path.basename(f)} (${(stat.size/1024).toFixed(0)}KB)`);
              break;
            }
          } catch (e) {
            console.log(`⚠️ Could not parse ${f}: ${e.message}`);
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
      await supabase
        .from('Browser_Tasks')
        .update({ status: 'running' })
        .eq('id', task.id);

      const result = await executeTask(task);

      await supabase
        .from('Browser_Tasks')
        .update({
          status: result.success ? 'done' : 'failed',
          result: result.data || null,
          error_message: result.error || null,
          completed_at: new Date().toISOString()
        })
        .eq('id', task.id);

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
    }
  } catch (error) {
    console.error('Poll error:', error.message);
  }
}

async function main() {
  console.log('🎬 Browser Task Executor v3.2');
  console.log(`📍 Supabase: ${SUPABASE_URL}`);
  console.log('📋 Task types:', Object.keys(SCRIPT_TASKS).join(', '));
  console.log('');

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('❌ Missing .env credentials');
    process.exit(1);
  }

  setInterval(() => pollTasks(), POLL_INTERVAL);
  await pollTasks();
}

process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down...');
  if (browser) await browser.close();
  process.exit(0);
});

main().catch(console.error);
