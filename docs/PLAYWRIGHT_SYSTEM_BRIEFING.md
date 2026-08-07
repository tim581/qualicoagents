# 🎭 Playwright Browser Automation System — Complete Briefing for Agents

> **Voor alle agents die browser-automatisering willen begrijpen, triggeren, of zelf uitbreiden.**  
> **Source of truth**: `tim581/qualicoagents/docs/` op GitHub  
> **Samengesteld**: Mei 2026

---

## 1. Wat is dit systeem?

Een Node.js executor draait **continu op Tim's Windows PC** (`C:\Users\Tim\playwright-render-service\`). Hij pollt elke 30 seconden de `Browser_Tasks` tabel in Supabase. Wanneer hij een taak vindt, download hij het bijhorende script van GitHub en voert het uit.

**Waarom Tim's PC?** Sites als Bol.com, Flieber, Corax/Vanthiel, Mintsoft blokkeren cloud-IPs. Tim's thuis-IP wordt niet geblokkeerd.

### Flow diagram

```
Agent INSERT Browser_Tasks (status='pending')
        ↓
Executor pollt elke 30s
        ↓
3-layer script resolution → vindt script naam
        ↓
Auto-download latest van GitHub (raw.githubusercontent.com)
        ↓
Detecteer modus: standalone of module.exports
        ↓
Script uitvoeren → resultaat
        ↓
UPDATE Browser_Tasks (status='done'/'failed' + result/error_message)
        ↓
Agent pollt resultaat en verwerkt
```

**Key principe**: Push naar GitHub `main` = automatisch beschikbaar bij de volgende taak run. Geen `git pull` of file transfer nodig.

---

## 2. Hoe een taak triggeren (als agent)

### Stap 1: INSERT in Browser_Tasks

```sql
INSERT INTO "Browser_Tasks" (agent_name, task_type, url, actions, credentials_key, status, priority)
VALUES (
  'jouw-agent-naam',         -- welke agent triggert dit
  'forecast-sync',           -- task_type → bepaalt welk script
  'https://app.flieber.com', -- informatief (niet altijd gebruikt door script)
  '[]'::jsonb,               -- VERPLICHT, ook al is het leeg!
  'flieber_login',           -- credentials key (uit Browser_Credentials tabel)
  'pending',                 -- executor pikt dit op
  1                          -- prioriteit (hoger = eerder)
);
```

⚠️ **KRITIEK**: De `actions` kolom is NOT NULL. Geef **altijd** `'[]'::jsonb` mee voor script-based taken.

### Stap 2: Poll op resultaat

```sql
SELECT status, result, error_message, completed_at
FROM "Browser_Tasks"
WHERE id = '{task_id}';
```

| status | Betekenis |
|---|---|
| `pending` | Nog niet opgepakt door executor |
| `running` | Script wordt uitgevoerd |
| `done` | ✅ Klaar — resultaat in `result` kolom |
| `failed` | ❌ Fout — zie `error_message` |

**Typische wachttijd**: 30–120 seconden (30s poll + script executietijd).

---

## 3. Browser_Tasks Tabel Schema

| Kolom | Type | Beschrijving |
|---|---|---|
| `id` | uuid | Primary key |
| `agent_name` | text | Welke agent triggerde de taak |
| `task_type` | text | Bepaalt welk script (3-layer resolution) |
| `url` | text | Doelsite (informatief) |
| `actions` | jsonb | **NIET NULL** — geef altijd `[]` mee |
| `credentials_key` | text | Key voor `Browser_Credentials` tabel |
| `status` | text | `pending` → `running` → `done`/`failed` |
| `result` | jsonb | Resultaat JSON na voltooiing |
| `error_message` | text | Foutmelding bij failure |
| `created_at` | timestamp | Aangemaakt |
| `completed_at` | timestamp | Afgerond |
| `priority` | integer | Hoger = eerder opgepakt |

---

## 4. Beschikbare Scripts (bestaand)

| task_type | Script | Wat het doet |
|---|---|---|
| `forecast-sync` | `flieber-forecast-updater.js` v8.9 | Pusht Puzzlup forecasts → Flieber (5 stores, 13 maanden) |
| `forecast-verify` | `flieber-forecast-verifier.js` v2.4 | Exporteert Flieber CSV, vergelijkt met Supabase (±10 tolerantie) |
| `po-simulation` | `flieber-replenishment-simulator.js` v3.1 | Draait PO/TO simulatie in Flieber, haalt resultaten via GraphQL |
| `to-simulation` | `flieber-replenishment-simulator.js` v3.1 | Zelfde script als po-simulation, andere mode |
| `bol-cases-scrape` | `bol-cases-scrape.js` v1.2 | Scrapet open cases van partner.bol.com (stealth + NL proxy) |
| `inventory-sync-bol` | `inventory-sync-bol.js` | Synct Bol LvB stock ← ⚠️ DEPRECATED — gebruik nu Bol Retailer API |

Bekijk altijd de actuele lijst: `SELECT * FROM "Browser_Task_Registry";`

---

## 5. Script Resolution — 3 Lagen (eerste match wint)

### Layer 1: Hardcoded in executor (snelst)
```javascript
const SCRIPT_TASKS = {
  'forecast-sync':   'flieber-forecast-updater.js',
  'po-simulation':   'flieber-replenishment-simulator.js',
  'to-simulation':   'flieber-replenishment-simulator.js',
  'forecast-verify': 'flieber-forecast-verifier.js',
};
```

### Layer 2: Actions array
Als `actions[]` een entry bevat met `{ "script": "filename.js" }`.

### Layer 3: Browser_Task_Registry (Supabase)
```sql
SELECT script_name FROM "Browser_Task_Registry" WHERE task_type = 'jouw-task-type';
```

---

## 6. Nieuw Script Schrijven — Stap voor Stap

### 6.1 Script Template

Elk script is **standalone** (eigen browser, eigen login, eigen logging):

```javascript
/**
 * jouw-script.js  v1.0 — Korte beschrijving
 */

'use strict';
require('dotenv').config();
const { chromium } = require('playwright');

// ── CONFIG ────────────────────────────────────────────────────────────
const SITE_URL = 'https://target-site.com';
// Credentials: laad uit Browser_Credentials (zie sectie 6.4)

// ── SELF-DEBUGGING: LOG NAAR SUPABASE ─────────────────────────────────
const RUN_ID = `jouw_prefix_${Date.now()}`;

async function dbLog(step, status, message) {
  const short = (message || '').toString().substring(0, 3000);
  console.log(`  [DB:${status}] ${step}: ${short.substring(0, 120)}`);
  try {
    await fetch(`${process.env.SUPABASE_URL}/rest/v1/Flieber_Debug_Log`, {
      method: 'POST',
      headers: {
        'apikey': process.env.SUPABASE_KEY,
        'Authorization': `Bearer ${process.env.SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify({ run_id: RUN_ID, step, status, message: short }),
    });
  } catch (e) { /* nooit de main flow breken */ }
}

async function dbShot(page, step, label) {
  try {
    const buf = await page.screenshot({ fullPage: false });
    const b64 = buf.toString('base64').substring(0, 400000);
    await fetch(`${process.env.SUPABASE_URL}/rest/v1/Flieber_Debug_Log`, {
      method: 'POST',
      headers: {
        'apikey': process.env.SUPABASE_KEY,
        'Authorization': `Bearer ${process.env.SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify({ run_id: RUN_ID, step, status: 'screenshot', message: label, screenshot: b64 }),
    });
  } catch (e) { /* nooit de main flow breken */ }
}

// ── LOGIN ──────────────────────────────────────────────────────────────
async function login(page, creds) {
  await dbLog('login', 'info', 'Navigating...');
  // ⚠️ ALTIJD 'domcontentloaded' — NOOIT 'networkidle' (SPAs hangen)
  await page.goto(creds.base_url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(3000);

  await page.fill('input[type="email"]', creds.username);
  await page.fill('input[type="password"]', creds.password);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(3000);

  await dbLog('login', 'success', 'Logged in');
  await dbShot(page, 'login', 'After login');
}

// ── MAIN ───────────────────────────────────────────────────────────────
(async () => {
  let browser;
  try {
    // headless: false → Tim wil scripts zien tijdens debugging
    browser = await chromium.launch({ headless: false });
    const page = await browser.newPage();

    // Credentials laden
    const creds = await getCredentials('jouw-credentials-key');
    await login(page, creds);

    // ── JOUW AUTOMATIE LOGICA HIER ──
    await dbLog('step-1', 'info', 'Starting main logic...');
    // ... do work ...
    await dbLog('complete', 'success', 'Done');

  } catch (err) {
    console.error('❌ Fatal:', err.message);
    await dbLog('fatal', 'error', err.message);
  } finally {
    if (browser) await browser.close();
    await new Promise(r => setTimeout(r, 2000)); // logs flushen
  }
})();
```

### 6.2 Push naar GitHub

```
Repository: tim581/qualicoagents
Branch: main
Path: scripts/jouw-script.js
```

De executor download automatisch de laatste versie voor elke run.

### 6.3 Registreer je task_type

**Stap A**: Voeg toe aan `SCRIPT_TASKS` in `playwright-task-executor.js`:
```javascript
'jouw-task-type': 'jouw-script.js',
```
⚠️ De executor zelf wordt NIET auto-gedownload. Na een wijziging moet Tim hem opnieuw downloaden:
```powershell
cd C:\Users\Tim\playwright-render-service
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/tim581/qualicoagents/main/scripts/playwright-task-executor.js" -OutFile "playwright-task-executor.js"
```

**Stap B**: Registreer in `Browser_Task_Registry`:
```sql
INSERT INTO "Browser_Task_Registry" (task_type, display_name, description, script_name, available)
VALUES (
  'jouw-task-type',
  'Leesbare Naam',
  'Wat dit script doet en wat het oplevert.',
  'jouw-script.js',
  true
);
```

### 6.4 Credentials ophalen in script

Gebruik de `Browser_Credentials` tabel (centraal, gedeeld):

```javascript
async function getCredentials(key) {
  const res = await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/Browser_Credentials?key=eq.${key}&select=*`,
    {
      headers: {
        'apikey': process.env.SUPABASE_KEY,
        'Authorization': `Bearer ${process.env.SUPABASE_KEY}`,
      },
    }
  );
  const data = await res.json();
  if (!data || data.length === 0) throw new Error(`No credentials for key: ${key}`);
  return data[0]; // { key, username, password, base_url }
}
```

Beschikbare credential keys (query altijd voor actuele lijst):
```sql
SELECT key, service_name, username, base_url FROM "Browser_Credentials";
```

Huidige keys: `flieber_login`, `corax`, `vanthiel_corax_wms`, `mintsoft_login`, `forceget_login`, `bol_seller`

---

## 7. Debugging — Self-Diagnosis Protocol

Alle scripts loggen elke stap + screenshots naar `Flieber_Debug_Log`. Geen file transfer nodig.

### Query logs na een run:

```sql
-- Alle stappen van laatste run
SELECT step, status, LEFT(message, 500) as msg, created_at
FROM "Flieber_Debug_Log"
WHERE run_id = '{jouw_run_id}'
ORDER BY created_at;

-- Vind de laatste 5 runs voor jouw script
SELECT DISTINCT run_id, MIN(created_at) as started
FROM "Flieber_Debug_Log"
WHERE run_id LIKE 'jouw_prefix%'
GROUP BY run_id
ORDER BY started DESC LIMIT 5;
```

### Debug Log Schema:

| Kolom | Beschrijving |
|---|---|
| `run_id` | Uniek per executie (prefix + timestamp) |
| `step` | Naam van de stap (login, navigate, etc.) |
| `status` | `info`, `success`, `error`, `warning`, `screenshot` |
| `message` | Inhoud/data (max ~3000 chars) |
| `screenshot` | Base64-encoded PNG (voor screenshot entries) |
| `created_at` | Timestamp |

---

## 8. Script Modi — Standalone vs Module

### Standalone (aanbevolen voor nieuwe scripts)
- Geen `module.exports`
- Maakt **eigen browser** → kan stealth + proxy gebruiken
- Schrijft resultaat naar JSON file of rechtstreeks naar Supabase
- `bol-cases-scrape.js` en `flieber-forecast-updater.js` gebruiken dit

### Module.exports
- `module.exports = async function({ page, context, supabase, dbShot }) {...}`
- Executor maakt browser en injecteert Playwright page
- Geen stealth/proxy mogelijk (executor's browser)
- Verouderd patroon — gebruik standalone voor nieuwe scripts

---

## 9. 🚨 Kritieke Gotcha's (Hard-Learned)

| ❌ NOOIT | ✅ ALTIJD |
|---|---|
| `waitUntil: 'networkidle'` (SPA's hangen) | `waitUntil: 'domcontentloaded'` + `waitForTimeout(3000)` |
| `Ctrl+A` in Handsontable/AG Grid | `dblclick()` → editor wacht → `el.value = ''` → type → `Tab` |
| `page.locator('button').filter(...)` (hangt op hidden) | `page.getByText('Exact Text').first()` |
| `headless: true` tijdens development | `headless: false` tot script stabiel is |
| `actions` kolom weglaten bij INSERT | Altijd `'[]'::jsonb` meegeven |
| Executor aanpassen zonder Tim te notificeren | Tim vertellen om executor te herstarten na wijziging |

---

## 10. Deployment Checklist

- [ ] Script geschreven en getest
- [ ] Script gepusht naar `qualicoagents/scripts/{naam}.js` op GitHub
- [ ] `SCRIPT_TASKS` mapping toegevoegd in `playwright-task-executor.js`
- [ ] Tim genotificeerd om executor te herstarten (alleen als executor gewijzigd)
- [ ] Geregistreerd in `Browser_Task_Registry`
- [ ] Test task aangemaakt in `Browser_Tasks` met status `pending`
- [ ] Resultaat geverifieerd via `Flieber_Debug_Log` of `Browser_Tasks.result`

---

## 11. Locatie op Tim's PC

```
C:\Users\Tim\playwright-render-service\
├── playwright-task-executor.js   ← hoofd-executor (draait continu)
├── .env                          ← SUPABASE_URL + SUPABASE_KEY
├── bol-storage-state.json        ← cookies voor bol.com (apart beheerd)
├── node_modules/                 ← npm packages
└── package.json
```

### Starten/herstarten:
```powershell
cd C:\Users\Tim\playwright-render-service
node playwright-task-executor.js
```

### Executor updaten (na SCRIPT_TASKS wijziging):
```powershell
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/tim581/qualicoagents/main/scripts/playwright-task-executor.js" -OutFile "playwright-task-executor.js"
```

---

## 12. Supabase Connectie

| | Waarde |
|---|---|
| Project | `zlteahycfmpiaxdbnlvr` |
| URL | `https://zlteahycfmpiaxdbnlvr.supabase.co` |
| Key | In `.env` als `SUPABASE_KEY` |

Scripts gebruiken de **service_role key** (in `.env` op Tim's PC) — niet de anon key.

---

## 13. Speciale Cases

### Stealth + Proxy (voor geblokkeerde sites)
`bol-cases-scrape.js` gebruikt stealth plugin + Decodo NL residentieel proxy:
```javascript
const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
chromium.use(StealthPlugin());
// Proxy: nl.decodo.com:10001
```
⚠️ `partner.bol.com` blokkeert zelfs stealth Chromium op IP/TLS niveau. Bol data → gebruik **Bol Retailer API** in plaats van browser.

### Bol.com Partner Portal
Cookie-gebaseerd (saved in `bol-storage-state.json`). Cookies verlopen periodiek — `bol-partner-save-cookies.js` opnieuw draaien (vereist 2FA SMS van Tim).

### Auto-chaining
De executor kan na een voltooide task automatisch een volgende queuen. Gedocumenteerd in `playwright-task-executor.js`. Vraag Tim om dit toe te voegen als je het nodig hebt.

---

## 14. Volledige GitHub Doc Locaties

| File | Inhoud |
|---|---|
| `docs/playwright-task-executor-system.md` | Systeem overview + schema's |
| `docs/WRITING-BROWSER-SCRIPTS.md` | Volledige schrijfgids voor scripts |
| `docs/AGENTS-HOW-TO-REQUEST-RENDERS.md` | Page render caching systeem (apart) |
| `docs/PLAYWRIGHT-LOCAL-SETUP.md` | Setup instructies voor Tim's PC |
| `scripts/playwright-task-executor.js` | De executor zelf |

GitHub repo: `https://github.com/tim581/qualicoagents`
