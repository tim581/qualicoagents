// playwright-task-executor.js v3.0 — 3-layer script resolution + module.exports support
const { chromium } = require('playwright-core');
const { createClient } = require('@supabase/supabase-js');
const https = require('https');
const fs = require('fs');
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
// Maps task_type to standalone Playwright scripts that handle their own browser.
// These scripts are self-contained (login, execute, log to Supabase).
const { execSync } = require('child_process');
const path = require('path');

// Layer 1: Hardcoded map (fast, no DB call)
const SCRIPT_TASKS = {
  'forecast-sync':            'flieber-forecast-updater.js',
  'po-simulation':            'flieber-replenishment-simulator.js',
  'to-simulation':            'flieber-replenishment-simulator.js',
  'forecast-verify':          'flieber-forecast-verifier.js',
  'inventory-sync-forceget':  'inventory-sync-forceget.js',
  'inventory-sync-kamps':     'inventory-sync-kamps.js',
  'inventory-sync-mintsoft':  'inventory-sync-mintsoft.js',
  'inventory-sync-bol':       'inventory-sync-bol.js',
  'price-scrape':             'price-monitor-scraper.js',
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

// ── 3-LAYER SCRIPT RESOLUTION (v2.5) ─────────────────────────────────────────
// 1. SCRIPT_TASKS hardcoded map (fast)
// 2. actions[] array — look for {"script": "filename.js"} entries (flexible)
// 3. Browser_Task_Registry in Supabase (dynamic, no code change needed)
async function resolveScript(task) {
  // Layer 1: Hardcoded map
  if (SCRIPT_TASKS[task.task_type]) {
    console.log(`   📌 Script resolved from SCRIPT_TASKS: ${SCRIPT_TASKS[task.task_type]}`);
    return SCRIPT_TASKS[task.task_type];
  }

  // Layer 2: Check actions array for script reference
  if (Array.isArray(task.actions) && task.actions.length > 0) {
    const scriptAction = task.actions.find(a => a.script);
    if (scriptAction) {
      console.log(`   ⚡ Script resolved from actions[]: ${scriptAction.script}`);
      return scriptAction.script;
    }
  }

  // Layer 3: Check Browser_Task_Registry in Supabase
  try {
    const { data: registry } = await supabase
      .from('Browser_Task_Registry')
      .select('script_name')
      .eq('task_type', task.task_type)
      .single();
    if (registry?.script_name) {
      console.log(`   🗄️ Script resolved from Browser_Task_Registry: ${registry.script_name}`);
      return registry.script_name;
    }
  } catch (e) {
    // Registry lookup failed — fall through to action-based
    console.log(`   ℹ️ Registry lookup failed: ${e.message}`);
  }

  return null; // No script found → action-based execution
}

async function executeScriptTask(task, scriptName) {
  const scriptPath = path.join(__dirname, scriptName);
  
  // Auto-download latest version from GitHub before running
  try {
    await downloadFromGitHub(scriptName);
  } catch (e) {
    console.log(`⚠️ GitHub download failed, using local version: ${e.message}`);
  }
  
  console.log(`\n🔧 Running script: ${scriptName} for task type: ${task.task_type}`);
  
  // Detect script type: module.exports (needs browser injection) vs standalone (runs with node)
  const scriptContent = fs.readFileSync(scriptPath, 'utf-8');
  const isModuleExports = /module\.exports\s*=/.test(scriptContent);
  
  if (isModuleExports) {
    // ── MODULE.EXPORTS PATTERN ──────────────────────────────
    // Script exports an async function: ({ page, context, supabase, dbShot }) => result
    // We create a browser context, call the function, and capture the return value
    console.log(`   📦 Detected module.exports pattern — injecting browser context`);
    
    const b = await initBrowser();
    const context = await b.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
      viewport: { width: 1920, height: 1080 }
    });
    const page = await context.newPage();
    
    // dbShot helper — saves screenshot to Flieber_Debug_Log
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
      // Clear require cache to get fresh version
      delete require.cache[require.resolve(scriptPath)];
      const scriptFn = require(scriptPath);
      
      if (typeof scriptFn !== 'function') {
        throw new Error('module.exports is not a function');
      }
      
      const result = await scriptFn({ page, context, supabase, dbShot });
      console.log(`✅ Module script returned:`, JSON.stringify(result).substring(0, 500));
      
      await page.close();
      await context.close();
      
      return { success: true, data: result || {} };
    } catch (error) {
      console.error(`❌ Module script failed: ${error.message}`);
      if (dbShot) await dbShot(page, 'error', error.message).catch(() => {});
      await page.close().catch(() => {});
      await context.close().catch(() => {});
      return { success: false, error: error.message };
    }
  } else {
    // ── STANDALONE PATTERN ───────────────────────────────────
    // Script runs independently with node, captures stdout
    console.log(`   🖥️ Standalone script — running with node`);
    
    const env = { ...process.env };
    env.BROWSER_TASK_ID = String(task.id);
    if (task.task_type === 'po-simulation') env.RUN_MODE = 'po';
    if (task.task_type === 'to-simulation') env.RUN_MODE = 'to';
    
    try {
      const output = execSync(`node "${scriptPath}"`, {
        env,
        cwd: __dirname,
        timeout: 14400000, // 4 hours max
        stdio: 'pipe',
        encoding: 'utf-8',
      });
      console.log(output);
      
      // Check if script wrote a JSON file we can read
      const jsonOutputPath = scriptPath.replace('.js', '-data.json')
        .replace('stock-export', 'stock-data')
        .replace('product-export', 'product-data')
        .replace('inventory-export', 'inventory-data');
      
      let jsonData = null;
      // Try common output file patterns
      const possibleFiles = [
        path.join(__dirname, scriptName.replace('.js', '-data.json')),
        path.join(__dirname, 'forceget-inventory-data.json'),
        path.join(__dirname, 'mintsoft-product-data.json'),
        path.join(__dirname, 'corax-stock-data.json'),
      ];
      
      for (const f of possibleFiles) {
        if (fs.existsSync(f)) {
          try {
            jsonData = JSON.parse(fs.readFileSync(f, 'utf-8'));
            console.log(`📄 Found JSON output: ${f} (${Array.isArray(jsonData) ? jsonData.length : 'object'} items)`);
            break;
          } catch (e) {
            console.log(`⚠️ Could not parse ${f}: ${e.message}`);
          }
        }
      }
      
      if (jsonData) {
        return { success: true, data: { items: jsonData, output: output.substring(0, 1000) } };
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
  console.log(`   URL: ${task.url || '(script-based)'}`);

  // ── v2.5: 3-layer script resolution ──
  const scriptName = await resolveScript(task);
  if (scriptName) {
    return await executeScriptTask(task, scriptName);
  }

  // No script found → generic action-based execution
  console.log(`   🌐 No script found — using action-based execution`);
  
  // Safety check: if actions contain script references but we couldn't resolve, warn
  if (Array.isArray(task.actions) && task.actions.some(a => a.script && !a.type)) {
    console.error(`   ⚠️ Actions contain script references but no 'type' field — these are NOT executable as actions!`);
    console.error(`   💡 Make sure the script file exists on GitHub or register task_type in Browser_Task_Registry`);
    return { success: false, error: `Task has script references in actions but script could not be resolved. Check GitHub or Browser_Task_Registry.` };
  }

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

      // Save result
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
        console.log('🔗 Forecast sync done — auto-queuing verification task...');
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
        if (chainErr) {
          console.error('⚠️ Failed to queue verify task:', chainErr.message);
        } else {
          console.log('✅ Verification task queued — will run next poll cycle');
        }
      }
    }

  } catch (error) {
    console.error('Poll error:', error.message);
  }
}

async function main() {
  console.log('🎬 Browser Task Executor v3.0 — 3-layer script resolution');
  console.log(`📍 Checking Supabase: ${SUPABASE_URL}`);

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('❌ Missing .env credentials');
    process.exit(1);
  }

  // Poll continuously
  setInterval(() => pollTasks(), POLL_INTERVAL);

  // Also poll immediately on start
  await pollTasks();
}

process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down...');
  if (browser) await browser.close();
  process.exit(0);
});

main().catch(console.error);
