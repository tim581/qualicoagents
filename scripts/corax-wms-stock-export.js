/**
 * corax-wms-stock-export.js — v5.1
 * Based on Playwright Codegen recording (Apr 23, 2026)
 * 
 * APPROACH: Download CSV/Excel export instead of HTML scraping — much more reliable.
 * 
 * CRITICAL: Corax shows stock in KOLI (= master cartons), NOT individual units!
 * Must multiply KOLI × units_per_master to get real unit count.
 * 
 * Flow: Microsoft OAuth login → Voorraad → Stocks per artikel → Export → Parse → Write to Inventory_Levels
 */
module.exports = async function({ page, supabase, dbShot, credentials }) {
  const TIMEOUT = 60000;
  const fs = require('fs');
  const path = require('path');
  
  // KOLI = master cartons. Multiply by units_per_master to get units.
  const PRODUCT_CONFIG = {
    'PUZZLUP 1000':       { name: 'MAT 1000 GIFT',    upm: 12 },
    'PUZZLUP 1500 ECO':   { name: 'MAT 1500 ECO',     upm: 10 },
    'PUZZLUP 1500 GIFT':  { name: 'MAT 1500 GIFT',    upm: 10 },
    'PUZZLUP 1500 LUX':   { name: 'MAT 1500 LUX',     upm: 10 },
    'PUZZLUP 3000 ECO':   { name: 'MAT 3000 ECO',     upm: 9 },
    'PUZZLUP 3000 GIFT':  { name: 'MAT 3000 GIFT',    upm: 6 },
    'PUZZLUP 5000 GIFT':  { name: 'MAT 5000 GIFT',    upm: 6 },
    'TRAYS 1500 BLACK':   { name: 'TRAYS 1500 BLACK',  upm: 8 },
    'TRAYS 1500 WHITE':   { name: 'TRAYS 1500 WHITE',  upm: 8 },
    'TRAYS 3000 BLACK':   { name: 'TRAYS 3000 BLACK',  upm: 4 },
  };

  // Helper: find product config from cell text
  function matchProduct(text) {
    const upper = (text || '').toUpperCase();
    // Try longest keys first for best match
    const keys = Object.keys(PRODUCT_CONFIG).sort((a, b) => b.length - a.length);
    for (const key of keys) {
      if (upper.includes(key.toUpperCase())) return PRODUCT_CONFIG[key];
    }
    return null;
  }

  try {
    // ─── Step 1: Navigate to Corax (redirects to Microsoft OAuth) ───
    await dbShot?.('step1', 'Navigating to Corax WMS...');
    await page.goto('https://kampspijnacker.coraxwms.nl', { waitUntil: 'networkidle', timeout: TIMEOUT });
    await page.waitForTimeout(3000);
    await dbShot?.('step1_landed', 'On login page');

    // ─── Step 2: Microsoft OAuth Login (exact from Codegen) ───
    const emailField = page.getByRole('textbox', { name: 'someone@coraxwms.nl' });
    await emailField.waitFor({ state: 'visible', timeout: TIMEOUT });
    await emailField.click();
    await emailField.fill(credentials?.username || 'qualico@coraxwms.nl');
    
    await page.getByRole('button', { name: 'Volgende' }).click();
    await page.waitForTimeout(2000);

    // Password field — try Codegen role first, then fallback to ID selector
    try {
      const pwField = page.getByRole('textbox', { name: 'Voer het wachtwoord voor' });
      await pwField.waitFor({ state: 'visible', timeout: 5000 });
      await pwField.click();
      await pwField.fill(credentials?.password || 'GXE.NYeUJX6.f!J');
    } catch {
      const pwField = page.locator('#i0118');
      await pwField.waitFor({ state: 'visible', timeout: TIMEOUT });
      await pwField.click();
      await pwField.fill(credentials?.password || 'GXE.NYeUJX6.f!J');
    }
    
    await page.getByRole('button', { name: 'Aanmelden' }).click();
    await page.waitForTimeout(3000);
    await dbShot?.('step2_login', 'Logged in');

    // Handle "Stay signed in?" prompt
    try {
      const stayBtn = page.getByRole('button', { name: 'Ja' });
      await stayBtn.waitFor({ state: 'visible', timeout: 5000 });
      await stayBtn.click();
    } catch { /* no prompt */ }

    await page.waitForTimeout(5000);
    await dbShot?.('step3_loaded', 'Corax WMS loaded');

    // ─── Step 3: Navigate to Voorraad → Stocks per artikel (exact from Codegen) ───
    await page.getByRole('button', { name: 'Voorraad ' }).click();
    await page.waitForTimeout(1000);
    await page.getByRole('link', { name: 'Stocks per artikel' }).click();
    await page.waitForTimeout(3000);
    await dbShot?.('step3_stocks', 'On Stocks per artikel page');

    // Set items per page to 150 so export has everything (from Codegen)
    try {
      await page.getByRole('combobox').nth(1).selectOption('number:150');
      await page.waitForTimeout(2000);
    } catch (e) {
      await dbShot?.('warn_pagesize', 'Could not set page size to 150: ' + e.message);
    }

    await dbShot?.('step4_ready', 'Ready to export');

    // ─── Step 4: Export file (exact from Codegen) ───
    await page.getByRole('button', { name: 'Exporteren' }).click();
    await page.waitForTimeout(1000);

    const downloadPromise = page.waitForEvent('download', { timeout: 30000 });
    await page.getByRole('button', { name: 'Ja' }).click();
    const download = await downloadPromise;

    // Save the downloaded file
    const downloadDir = '/tmp/corax-export';
    if (!fs.existsSync(downloadDir)) fs.mkdirSync(downloadDir, { recursive: true });
    const fileName = download.suggestedFilename() || 'export.csv';
    const filePath = path.join(downloadDir, fileName);
    await download.saveAs(filePath);
    
    await dbShot?.('step5_downloaded', `File downloaded: ${fileName} (${fs.statSync(filePath).size} bytes)`);

    // ─── Step 5: Parse the export file (xlsx or CSV) ───
    let inventory = [];
    let rows = []; // array of arrays (each row = array of cell values)
    let headers = [];

    if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
      // Parse Excel using SheetJS (xlsx package)
      let XLSX;
      try {
        XLSX = require('xlsx');
      } catch {
        // If not installed, try installing it
        const { execSync } = require('child_process');
        try {
          execSync('npm install xlsx', { cwd: process.cwd(), timeout: 30000 });
          XLSX = require('xlsx');
        } catch (installErr) {
          await dbShot?.('error_xlsx', `Cannot load xlsx package: ${installErr.message}. Run: npm install xlsx`);
          return { success: false, error: 'xlsx package not available. Run: npm install xlsx' };
        }
      }
      
      const workbook = XLSX.readFile(filePath);
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
      
      if (jsonData.length > 0) {
        headers = jsonData[0].map(h => String(h).trim().toLowerCase());
        rows = jsonData.slice(1);
      }
      
      // Log ALL rows for debugging (first 30 rows, truncated cells)
      const debugRows = jsonData.slice(0, 30).map(r => r.slice(0, 8).map(c => String(c).substring(0, 40)));
      await dbShot?.('step5_xlsx', `Excel parsed: ${jsonData.length} rows, sheet: ${sheetName}, headers: ${JSON.stringify(headers)}`);
      await dbShot?.('step5_xlsx_rows', `First 30 rows: ${JSON.stringify(debugRows)}`);
    } else {
      // CSV fallback
      const fileContent = fs.readFileSync(filePath, 'utf-8');
      const lines = fileContent.split('\n').map(l => l.trim()).filter(l => l.length > 0);
      
      if (lines.length > 0) {
        const delimiter = lines[0].includes(';') ? ';' : ',';
        headers = lines[0].split(delimiter).map(h => h.replace(/"/g, '').trim().toLowerCase());
        rows = lines.slice(1).map(l => l.split(delimiter).map(c => c.replace(/"/g, '').trim()));
      }
      
      await dbShot?.('step5_csv', `CSV parsed: ${rows.length} rows, headers: ${JSON.stringify(headers)}`);
    }

    // Find relevant columns
    const nameIdx = headers.findIndex(h => 
      h.includes('artikel') || h.includes('article') || h.includes('product') || h.includes('omschrijving') || h.includes('description')
    );
    const koliIdx = headers.findIndex(h => 
      h.includes('koli') || h.includes('colli') || h.includes('voorraad') || h.includes('stock') || h.includes('aantal')
    );
    const skuIdx = headers.findIndex(h =>
      h.includes('sku') || h.includes('code') || h.includes('artikelcode') || h.includes('artikelnummer')
    );

    await dbShot?.('step5_cols', `Column indices — name: ${nameIdx}, koli: ${koliIdx}, sku: ${skuIdx}. Total rows: ${rows.length}`);

    // Log first 3 rows for debugging
    await dbShot?.('step5_sample', `Sample rows: ${JSON.stringify(rows.slice(0, 3))}`);

    for (const cols of rows) {
      let product = null;
      let koliCount = 0;

      // Try matching on product name column first, then SKU, then any column
      if (nameIdx >= 0 && cols[nameIdx]) {
        product = matchProduct(String(cols[nameIdx]));
      }
      if (!product && skuIdx >= 0 && cols[skuIdx]) {
        product = matchProduct(String(cols[skuIdx]));
      }
      // Fallback: search all columns for product name
      if (!product) {
        for (const col of cols) {
          product = matchProduct(String(col));
          if (product) break;
        }
      }

      if (product && koliIdx >= 0) {
        koliCount = parseInt(cols[koliIdx]) || 0;
      }

      if (product && koliCount >= 0) {
        const existing = inventory.find(inv => inv.name === product.name);
        if (existing) {
          existing.koli += koliCount;
          existing.units = existing.koli * product.upm;
        } else {
          inventory.push({
            name: product.name,
            koli: koliCount,
            upm: product.upm,
            units: koliCount * product.upm,
            rawLine: cols.map(c => String(c)).join(' | ')
          });
        }
      }
    }

    await dbShot?.('step6_parsed', `Parsed ${inventory.length} products: ${JSON.stringify(inventory.map(p => `${p.name}: ${p.koli} KOLI = ${p.units}u`))}`);

    // ─── Step 6: Write to Inventory_Levels ───
    let itemsWritten = 0;

    for (const item of inventory) {
      try {
        const { error } = await supabase
          .from('Inventory_Levels')
          .upsert({
            product_name: item.name,
            channel: 'Vanthiel',
            channel_type: '3PL',
            region: 'EU',
            warehouse: 'Kamps Pijnacker',
            on_hand: item.units,
            source: 'corax_wms_export',
            updated_at: new Date().toISOString()
          }, { onConflict: 'product_name,channel' });

        if (error) {
          await dbShot?.(`write_err_${item.name}`, `Upsert error: ${JSON.stringify(error)}`);
        } else {
          itemsWritten++;
        }
      } catch (e) {
        await dbShot?.(`write_crash_${item.name}`, `Exception: ${e.message}`);
      }
    }

    const summary = {
      success: true,
      file: fileName,
      products_found: inventory.length,
      items_written: itemsWritten,
      inventory: inventory.map(p => ({
        product: p.name,
        koli: p.koli,
        units_per_master: p.upm,
        units: p.units
      }))
    };

    await dbShot?.('done', JSON.stringify(summary));
    return summary;

  } catch (err) {
    await dbShot?.('error', `Fatal: ${err.message}\n${err.stack?.substring(0, 500)}`);
    return { success: false, error: err.message };
  }
};
