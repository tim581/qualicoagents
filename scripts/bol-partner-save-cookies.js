/**
 * bol-partner-save-cookies.js v4.0.0
 * 
 * APPROACH: Playwright does ZERO navigation. YOU log in manually.
 * Script only connects to extract cookies afterwards.
 * 
 * Steps:
 *   1. Close ALL Chrome windows first!
 *   2. Run this script — it opens Chrome with debug port
 *   3. YOU navigate to https://partner.bol.com and log in manually
 *   4. Once on the dashboard, press ENTER here
 *   5. Script saves cookies and closes
 * 
 * Dependencies: playwright
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { integrateBolCookies, printSummary } = require('./integrate-bol-cookies');
const { detectAuthBlocker, AUTH_BLOCKERS } = require('./browser-cookie-sessions');

(async () => {
  console.log('');
  console.log('=== Bol.com Partner Portal — Cookie Saver v4.0 ===');
  console.log('');
  console.log('⚠️  Sluit EERST alle Chrome vensters!');
  console.log('    (Anders kan Chrome niet starten met debug port)');
  console.log('');
  console.log('Druk ENTER als alle Chrome vensters dicht zijn...');
  
  await new Promise(resolve => process.stdin.once('data', resolve));

  console.log('');
  console.log('🚀 Chrome openen...');
  
  // Launch real Chrome with remote debugging — but do NOT navigate anywhere
  const { spawn } = require('child_process');
  
  // Find Chrome
  const chromePaths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe'
  ];
  
  let chromePath = null;
  for (const p of chromePaths) {
    if (fs.existsSync(p)) { chromePath = p; break; }
  }
  
  if (!chromePath) {
    console.log('❌ Chrome niet gevonden! Installeer Chrome of pas het pad aan.');
    process.exit(1);
  }

  console.log(`✅ Chrome gevonden: ${chromePath}`);
  console.log('');

  // Start Chrome with debugging port and a TEMPORARY profile (clean, no automation flags)
  const tempProfile = path.join(require('os').tmpdir(), 'bol-cookie-profile-' + Date.now());
  
  const chromeProcess = spawn(chromePath, [
    `--remote-debugging-port=9222`,
    `--user-data-dir=${tempProfile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--start-maximized',
    'about:blank'
  ], { 
    detached: true, 
    stdio: 'ignore' 
  });
  chromeProcess.unref();

  // Wait for Chrome to start
  console.log('⏳ Wachten tot Chrome opstart...');
  await new Promise(resolve => setTimeout(resolve, 3000));

  console.log('');
  console.log('✅ Chrome is open!');
  console.log('');
  console.log('📋 Doe nu het volgende IN DE CHROME BROWSER:');
  console.log('   1. Ga naar: https://partner.bol.com');
  console.log('   2. Klik op Inloggen');
  console.log('   3. Log in met accounts@qualico.be');
  console.log('   4. Vul 2FA code in (SMS)');
  console.log('   5. Wacht tot je het Partner DASHBOARD ziet');
  console.log('');
  console.log('⏳ Als je op het dashboard bent, druk hier ENTER...');
  
  await new Promise(resolve => process.stdin.once('data', resolve));

  console.log('');
  console.log('🔌 Verbinden met Chrome om cookies op te halen...');

  try {
    // Connect to the running Chrome via CDP — ONLY to extract cookies
    const browser = await chromium.connectOverCDP('http://localhost:9222');
    const contexts = browser.contexts();
    
    if (contexts.length === 0) {
      console.log('❌ Geen browser context gevonden.');
      process.exit(1);
    }

    const context = contexts[0];
    const pages = context.pages();
    const activeUrl = pages.length ? pages[pages.length - 1].url() : '';
    const storage = await context.storageState();
    const cookies = storage.cookies || [];

    // Filter for bol.com cookies
    const bolCookies = cookies.filter(c => 
      c.domain.includes('bol.com') || c.domain.includes('partner.bol.com')
    );

    // Convert Playwright cookies to Cookie-Editor format for raw merge
    const toCookieEditor = (c) => ({
      domain: c.domain,
      expirationDate: c.expires > 0 ? c.expires : undefined,
      hostOnly: !String(c.domain).startsWith('.'),
      httpOnly: c.httpOnly,
      name: c.name,
      path: c.path,
      sameSite: c.sameSite === 'None' ? 'no_restriction' : c.sameSite?.toLowerCase() || null,
      secure: c.secure,
      session: c.expires < 0,
      storeId: null,
      value: c.value,
    });

    console.log('\nIntegrating into bol-cookies-raw.json + all bol-storage-state.json copies...');
    const result = integrateBolCookies(bolCookies.map(toCookieEditor));
    printSummary(result);
    execSync('node sync-storage-state-copies.js', { cwd: __dirname, stdio: 'inherit' });

    const blocker = detectAuthBlocker(activeUrl, {
      loginHints: ['login.bol.com', 'signin', 'login'],
      manualHints: ['mfa', '2fa', 'verify', 'challenge', 'captcha'],
    });

    if (blocker === AUTH_BLOCKERS.MFA_REQUIRED || blocker === AUTH_BLOCKERS.PASSWORD_EXPIRED) {
      throw new Error(`Bol partner sessie onvolledig: ${blocker}. Rond MFA/wachtwoord stap af en run opnieuw.`);
    }
    if (blocker && !activeUrl.includes('partner.bol.com')) {
      throw new Error(`Bol partner sessie nog op auth-stap: ${activeUrl.split('?')[0] || 'unknown url'}`);
    }
    if (bolCookies.length < 3) {
      throw new Error('Te weinig bol.com cookies gevonden; login of handmatige auth-stap is niet volledig afgerond.');
    }

    console.log(`✅ ${cookies.length} totale cookies opgeslagen`);
    console.log(`   (${bolCookies.length} bol.com cookies)`);
    console.log(`✅ bol-cookies-raw.json + bol-storage-state.json (scripts/ + root)`);
    console.log('');

    console.log('🎉 Klaar! Het bol-cases-scrape script kan nu draaien.');

    // Disconnect (don't close — user might still need the browser)
    browser.close();
  } catch (err) {
    console.log('❌ Kon niet verbinden met Chrome.');
    console.log('   Error:', err.message);
    console.log('');
    console.log('   Zorg dat Chrome nog open is en probeer opnieuw.');
  }

  // Cleanup: try to kill chrome
  try { 
    process.kill(chromeProcess.pid); 
  } catch(e) { /* ignore */ }

  process.exit(0);
})();
