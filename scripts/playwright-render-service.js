#!/usr/bin/env node

/**
 * PLAYWRIGHT RENDER SERVICE
 * 
 * RUN THIS ON YOUR LOCAL MACHINE
 * Renders JavaScript-heavy websites → uploads clean HTML to Supabase
 * 
 * Installation:
 * 1. npm install playwright @supabase/supabase-js dotenv
 * 2. Create .env with SUPABASE_URL and SUPABASE_KEY
 * 3. node playwright-render-service.js "https://example.com" [--login user pass] [--wait 5000]
 */

const { chromium } = require('playwright');
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
require('dotenv').config();

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://zlteahycfmpiaxdbnlvr.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY;

if (!SUPABASE_KEY) {
  console.error('❌ Missing SUPABASE_KEY in .env file');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function renderPage(url, options = {}) {
  const startTime = Date.now();
  let browser;
  
  try {
    console.log(`\n📍 Rendering: ${url}`);
    
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await browser.newPage();
    
    // Optional: Login before rendering
    if (options.login) {
      console.log(`🔐 Logging in as ${options.login.email}...`);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
      
      // Try common login selectors
      const loginSelectors = [
        'input[type="email"]',
        'input[name="email"]',
        'input[name="username"]',
        'input[placeholder*="email" i]'
      ];
      
      let emailInput = null;
      for (const selector of loginSelectors) {
        const el = await page.$(selector);
        if (el) {
          emailInput = selector;
          break;
        }
      }
      
      if (emailInput) {
        await page.fill(emailInput, options.login.email);
        const passwordInputs = await page.$$('input[type="password"]');
        if (passwordInputs.length > 0) {
          await page.fill('input[type="password"]', options.login.password);
        }
        
        const submitButton = await page.$('button[type="submit"], input[type="submit"], [role="button"]:has-text("Login")');
        if (submitButton) {
          await submitButton.click();
          await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
        }
      }
    }
    
    // Navigate and wait
    console.log('⏳ Loading page...');
    await page.goto(url, { waitUntil: 'networkidle', timeout: 20000 });
    
    // Optional: Wait for specific content
    if (options.wait) {
      await page.waitForTimeout(options.wait);
    }
    
    // Get full HTML
    const html = await page.content();
    
    const renderTime = Date.now() - startTime;
    console.log(`✅ Rendered in ${renderTime}ms (${html.length} bytes)`);
    
    // Upload to Supabase
    console.log('📤 Uploading to Supabase...');
    
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 day cache
    
    const { data, error } = await supabase
      .from('Rendered_Pages')
      .upsert({
        url,
        html_content: html,
        format: 'html',
        last_rendered: new Date(),
        expires_at: expiresAt,
        render_time_ms: renderTime
      }, { onConflict: 'url' });
    
    if (error) {
      console.error('❌ Upload error:', error.message);
      return false;
    }
    
    console.log('✅ Stored in Supabase');
    console.log(`📊 Cache expires: ${expiresAt.toISOString()}`);
    
    return true;
    
  } catch (e) {
    console.error(`❌ Error: ${e.message}`);
    
    // Log error to Supabase
    await supabase
      .from('Rendered_Pages')
      .upsert({
        url,
        error_message: e.message,
        last_rendered: new Date()
      }, { onConflict: 'url' });
    
    return false;
  } finally {
    if (browser) await browser.close();
  }
}

// CLI interface
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log(`
╔════════════════════════════════════════════════════════════════╗
║         PLAYWRIGHT RENDER SERVICE - Local Usage                ║
╚════════════════════════════════════════════════════════════════╝

USAGE:
  node playwright-render-service.js <URL> [OPTIONS]

EXAMPLES:
  # Simple render (no login)
  node playwright-render-service.js "https://example.com"
  
  # With login
  node playwright-render-service.js "https://forum.example.com" \\
    --login tim@qualico.be Reset123!
  
  # With wait time (e.g., for lazy-loaded content)
  node playwright-render-service.js "https://example.com" --wait 3000
  
  # Render eCommerce Fuel member list
  node playwright-render-service.js "https://forum.ecommercefuel.com/members" \\
    --login tim@qualico.be Reset123! --wait 2000

OPTIONS:
  --login EMAIL PASSWORD    Login before rendering
  --wait MS                 Wait N milliseconds for content to load
  --no-sandbox              Run without sandbox (Docker/Linux)

REQUIREMENTS:
  npm install playwright @supabase/supabase-js dotenv

.env file must contain:
  SUPABASE_URL=https://zlteahycfmpiaxdbnlvr.supabase.co
  SUPABASE_KEY=your_supabase_key_here

WORKFLOW:
  1. You run this script locally (Playwright installed)
  2. Script renders the page (JS executed)
  3. Clean HTML uploaded to Supabase Rendered_Pages table
  4. Agents query the table → get cached HTML instantly
  5. No JS parsing needed, agents save 95% tokens!
    `);
    process.exit(0);
  }
  
  const url = args[0];
  const options = {};
  
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--login' && i + 2 < args.length) {
      options.login = { email: args[i + 1], password: args[i + 2] };
      i += 2;
    } else if (args[i] === '--wait' && i + 1 < args.length) {
      options.wait = parseInt(args[i + 1]);
      i += 1;
    }
  }
  
  const success = await renderPage(url, options);
  process.exit(success ? 0 : 1);
}

main();
