#!/usr/bin/env node
/**
 * bol-cases-scrape-browseract.js v1.0.0
 * 
 * Scrapes bol.com partner portal for open/new customer service cases
 * Uses BrowserAct (open-source, stealth + CAPTCHA built-in)
 * 
 * Storage: ~/bol-storage-state.json (cookies from Cookie-Editor)
 * 
 * Usage:
 *   node bol-cases-scrape-browseract.js
 * 
 * Output: Supabase Browser_Tasks table (result column)
 */

const fs = require('fs');
const path = require('path');

// BrowserAct: declarative browser automation
// npm install browser-act
const { BrowserAct } = require('browser-act');

const STORAGE_STATE_PATH = path.join(__dirname, 'bol-storage-state.json');

async function main() {
  console.log('[bol-cases-scrape] Starting BrowserAct scraper...');
  
  // Verify cookies exist
  if (!fs.existsSync(STORAGE_STATE_PATH)) {
    console.error(`❌ ERROR: ${STORAGE_STATE_PATH} not found!`);
    console.error('Generate via: node scripts/convert-cookies.js');
    process.exit(1);
  }

  const storageState = JSON.parse(fs.readFileSync(STORAGE_STATE_PATH, 'utf8'));
  console.log(`✅ Loaded ${storageState.cookies.length} cookies from storage state`);

  // Initialize BrowserAct
  const browseract = new BrowserAct({
    headless: true,
    stealth: true,  // Built-in stealth (no separate plugin needed)
    captchaSolver: {
      enabled: true,
      service: 'capsolver',  // or 'capmonster'
      apiKey: process.env.CAPSOLVER_API_KEY || 'CAP-00947509B11A892ECA9F5CBB946F6FD0135399138D85598CD7532F991921D0F2'
    },
    proxy: {
      server: 'http://nl.decodo.com:10001',
      username: process.env.PROXY_USER || 'spx615l7f1',
      password: process.env.PROXY_PASS || 'BHrGlyvt9mRqv2=j62'
    }
  });

  try {
    // Step 1: Launch browser with cookies
    console.log('🌐 Launching browser with stored cookies...');
    const page = await browseract.newPage();
    
    // Apply cookies
    await page.context().addCookies(storageState.cookies);
    
    // Step 2: Navigate to cases page
    console.log('📍 Navigating to bol.com cases...');
    await page.goto('https://www.bol.com/sdd/cases/api/cases/counts', {
      waitUntil: 'networkidle'
    });

    // Step 3: Get case counts
    console.log('📊 Fetching case counts...');
    const countsJson = await page.evaluate(() => {
      return JSON.parse(document.body.innerText);
    });
    
    console.log('Case counts:', countsJson);

    // Step 4: Fetch open cases list
    console.log('📋 Fetching open cases list...');
    const casesUrl = 'https://www.bol.com/sdd/cases/api/cases?case-category=OPEN&page=1&page-size=50';
    const casesResponse = await page.goto(casesUrl, { waitUntil: 'networkidle' });
    
    const casesJson = await page.evaluate(() => {
      return JSON.parse(document.body.innerText);
    });

    console.log(`✅ Found ${casesJson.data.length} open cases`);

    // Step 5: Fetch case details + emails for each
    const casesWithEmails = [];
    
    for (const caseItem of casesJson.data.slice(0, 5)) {  // First 5 for now
      console.log(`  → Case ${caseItem.caseId}...`);
      
      // Get case details
      const detailUrl = `https://www.bol.com/sdd/cases/api/cases/${caseItem.caseId}`;
      await page.goto(detailUrl, { waitUntil: 'networkidle' });
      
      const caseDetail = await page.evaluate(() => {
        return JSON.parse(document.body.innerText);
      });

      // Get email(s)
      let emailBody = '';
      if (caseDetail.events && caseDetail.events.length > 0) {
        const latestEmail = caseDetail.events.find(e => e.type === 'EMAIL');
        if (latestEmail) {
          const emailUrl = `https://www.bol.com/sdd/cases/api/cases/${caseDetail.caseId}/emails/${latestEmail.conversationMailerId}`;
          await page.goto(emailUrl, { waitUntil: 'networkidle' });
          emailBody = await page.evaluate(() => document.body.innerText);
        }
      }

      casesWithEmails.push({
        caseId: caseDetail.caseId,
        status: caseDetail.status,
        category: caseDetail.category,
        customerName: caseDetail.customer?.name,
        customerEmail: caseDetail.customer?.email,
        productEan: caseDetail.product?.ean,
        productName: caseDetail.product?.name,
        createdDate: caseDetail.createdDate,
        lastUpdated: caseDetail.lastUpdated,
        latestEmailBody: emailBody
      });
    }

    console.log(`✅ Scraped ${casesWithEmails.length} cases with emails`);

    // Step 6: Return results
    const result = {
      success: true,
      timestamp: new Date().toISOString(),
      caseCounts: countsJson,
      cases: casesWithEmails,
      totalScraped: casesWithEmails.length
    };

    console.log('📤 Returning results...');
    console.log(JSON.stringify(result, null, 2));

    await browseract.close();
    process.exit(0);

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    
    await browseract.close();
    process.exit(1);
  }
}

main();
