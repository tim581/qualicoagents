const { chromium } = require('playwright-core');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const POLL_INTERVAL = 30000; // 30 seconds
let browser;

async function initBrowser() {
  if (!browser) {
    console.log('🚀 Initializing Chromium...');
    browser = await chromium.launch();
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
      await page.goto(action.url, { waitUntil: 'networkidle', timeout: 30000 });
      break;

    case 'login':
      console.log(`  → Login with ${action.credentials_key}`);
      const loginCreds = await getCredentials(action.credentials_key);
      if (action.username_selector) {
        await page.fill(action.username_selector, loginCreds.username);
      }
      if (action.password_selector) {
        await page.fill(action.password_selector, loginCreds.password);
      }
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
  'forecast-sync':  'flieber-forecast-updater.js',
  'po-simulation':  'flieber-replenishment-simulator.js',
  'to-simulation':  'flieber-replenishment-simulator.js',
  'price-scrape':   'price-monitor-scraper.js',
};

// Timeout per task type (ms)
const SCRIPT_TIMEOUTS = {
  'forecast-sync':  1800000,  // 30 min (5 stores × ~9 products = ~22 min)
  'po-simulation':  600000,   // 10 min
  'to-simulation':  600000,   // 10 min
  'price-scrape':   3600000,  // 60 min
};

async function executeScriptTask(task) {
  const scriptName = SCRIPT_TASKS[task.task_type];
  const scriptPath = path.join(__dirname, scriptName);
  const timeout = SCRIPT_TIMEOUTS[task.task_type] || 300000;
  
  console.log(`\n🔧 Running script: ${scriptName} for task type: ${task.task_type}`);
  console.log(`   Timeout: ${timeout / 60000} min`);
  
  // For replenishment simulator, set RUN_MODE via env variable
  const env = { ...process.env };
  if (task.task_type === 'po-simulation') env.RUN_MODE = 'po';
  if (task.task_type === 'to-simulation') env.RUN_MODE = 'to';
  
  try {
    const output = execSync(`node "${scriptPath}"`, {
      env,
      cwd: __dirname,
      timeout: timeout,
      stdio: 'pipe',
      encoding: 'utf-8',
    });
    console.log(output);
    return { success: true, data: { output: output.substring(0, 2000) } };
  } catch (error) {
    const stderr = error.stderr ? error.stderr.substring(0, 2000) : error.message;
    console.error(`❌ Script failed: ${stderr}`);
    return { success: false, error: stderr };
  }
}

async function executeTask(task) {
  console.log(`\n📋 Task: ${task.id}`);
  console.log(`   Type: ${task.task_type}`);
  console.log(`   URL: ${task.url || '(script-based)'}`);

  // Route to standalone script if task_type is mapped
  if (SCRIPT_TASKS[task.task_type]) {
    return await executeScriptTask(task);
  }

  // Otherwise: generic action-based execution
  const b = await initBrowser();
  const page = await b.newPage();
  
  try {
    let result = {};

    for (const action of (task.actions || [])) {
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
  console.log(`\n⏰ Polling for tasks... (${new Date().toISOString()})`);

  try {
    const { data: tasks, error } = await supabase
      .from('Browser_Tasks')
      .select('*')
      .eq('status', 'pending')
      .order('priority', { ascending: false })
      .order('created_at', { ascending: true })
      .limit(1);

    if (error) throw error;

    if (!tasks || tasks.length === 0) {
      console.log('   No pending tasks.');
      return;
    }

    for (const task of tasks) {
      // Mark as running
      await supabase
        .from('Browser_Tasks')
        .update({ status: 'running' })
        .eq('id', task.id);

      // Execute
      const result = await executeTask(task);

      // Update status
      await supabase
        .from('Browser_Tasks')
        .update({
          status: result.success ? 'done' : 'failed',
          result: result.success ? result.data : { error: result.error },
          completed_at: new Date().toISOString(),
        })
        .eq('id', task.id);
    }
  } catch (error) {
    console.error(`\n❌ Poll error: ${error.message}`);
  }
}

// ── MAIN LOOP ─────────────────────────────────────────────────────────────────
let running = true;

process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down...');
  running = false;
  if (browser) await browser.close();
  process.exit(0);
});

(async () => {
  console.log('🤖 Browser Task Executor v2.1 — 30min forecast timeout');
  console.log('   Polling every 30s for pending tasks...\n');
  
  while (running) {
    await pollTasks();
    await new Promise(r => setTimeout(r, POLL_INTERVAL));
  }
})();
