# Playwright Task Executor System — Complete Documentation

**Version:** v3.0  
**Location:** `C:\Users\Tim\playwright-render-service\` (Tim's PC)  
**GitHub:** `tim581/qualicoagents` → `playwright-task-executor.js` (repo root)  
**Status:** Altijd draaiend op Tim's PC

---

## Overview

Een Node.js process dat continu draait op Tim's Windows PC. Het pollt elke **30 seconden** de `Browser_Tasks` tabel in Supabase voor `status: 'pending'` taken. Wanneer het een taak vindt:

1. Markeert de taak als `status: 'running'`
2. Resolved het juiste script (3-layer systeem)
3. **Download automatisch de laatste versie van GitHub** (`raw.githubusercontent.com`)
4. Voert het script uit
5. Schrijft resultaat terug naar `Browser_Tasks` (`status: 'done'` of `status: 'failed'`)

## Locatie op Tim's PC

```
C:\Users\Tim\playwright-render-service\
├── playwright-task-executor.js      ← hoofd-executor (draait continu)
├── .env                             ← SUPABASE_URL + SUPABASE_KEY
├── bol-storage-state.json           ← cookies voor bol.com partner portal
├── node_modules/                    ← npm packages
├── package.json                     ← dependencies
└── [scripts worden hier gedownload] ← auto-download van GitHub
```

**BELANGRIJK:** De executor clone NIET de `qualicoagents` repo. Hij download individuele scripts naar zijn eigen directory (`__dirname`) vanuit GitHub raw URL.

## Hoe een taak triggeren (voor agents)

Insert een rij in `Browser_Tasks` in Supabase:

```sql
INSERT INTO "Browser_Tasks" (agent_name, task_type, url, actions, status, priority)
VALUES (
  'customer-service',           -- welke agent triggert dit
  'bol-cases-scrape',           -- task_type → wordt gematcht met script
  'https://partner.bol.com',    -- informatief (niet altijd nodig)
  '[]'::jsonb,                  -- actions array (leeg voor script-based taken)
  'pending',                    -- MUST be 'pending' → executor pikt het op
  1                             -- prioriteit (hoger = eerder)
);
```

De executor pollt elke 30 seconden en pakt de taak op.

## 3-Layer Script Resolution

De executor zoekt scripts in 3 lagen (eerste match wint):

### Layer 1: Hardcoded Map (in executor code)
```javascript
const SCRIPT_TASKS = {
  'forecast-sync':            'flieber-forecast-updater.js',
  'inventory-sync-bol':       'inventory-sync-bol.js',
  'price-scrape':             'price-monitor-scraper.js',
  // ... meer hardcoded mappings
};
```

### Layer 2: Actions Array
Als `actions[]` een entry heeft met `{ "script": "filename.js" }`, wordt dat script gebruikt.

### Layer 3: Browser_Task_Registry (Supabase)
```sql
SELECT script_name FROM "Browser_Task_Registry" WHERE task_type = 'bol-cases-scrape';
-- → 'bol-cases-scrape.js'
```

**`bol-cases-scrape` is geregistreerd in Layer 3** (Browser_Task_Registry).

## Auto-Download van GitHub

**Kritiek detail:** Voordat een script wordt uitgevoerd, download de executor ALTIJD de laatste versie van GitHub:

```
URL: https://raw.githubusercontent.com/tim581/qualicoagents/main/scripts/{scriptName}
Download naar: C:\Users\Tim\playwright-render-service\{scriptName}
```

Dus:
- ✅ `git pull` is NIET nodig — scripts worden automatisch bijgewerkt
- ✅ Push naar GitHub `main` branch = automatisch beschikbaar bij volgende taak
- ⚠️ Als GitHub download faalt, valt hij terug op de lokale versie

## Twee Script-Modi

### 1. Standalone (geen `module.exports`)
- Executor detecteert: geen `module.exports` in code → standalone
- Wordt uitgevoerd met `node scriptPath`
- Script maakt zijn **eigen browser** (stealth, proxy, etc.)
- Output: schrijft JSON naar `{scriptName}-data.json` in executor dir
- **`bol-cases-scrape.js` gebruikt dit patroon** (heeft stealth + proxy nodig)

### 2. Module.exports Pattern
- Executor detecteert: `module.exports = async function(...)` → module
- Executor maakt browser en injecteert `{ page, context, supabase, dbShot }`
- Script gebruikt de executor's browser (GEEN stealth/proxy mogelijk)
- Return value = taak resultaat

## Browser_Tasks Tabel Schema

| Kolom | Type | Beschrijving |
|---|---|---|
| `id` | uuid (auto) | Primary key |
| `agent_name` | text | Welke agent triggerde de taak |
| `task_type` | text | Bepaalt welk script → 3-layer resolution |
| `url` | text | Informatieve URL (niet altijd gebruikt) |
| `actions` | jsonb | Actions array (voor action-based of script ref) |
| `credentials_key` | text | Key voor Browser_Credentials tabel |
| `status` | text | `pending` → `running` → `done` / `failed` |
| `result` | jsonb | Resultaat JSON na voltooiing |
| `error_message` | text | Foutmelding bij failure |
| `created_at` | timestamp | Aangemaakt |
| `completed_at` | timestamp | Afgerond |
| `priority` | integer | Hoger = eerder opgepakt |

## Browser_Task_Registry Schema

| Kolom | Type | Beschrijving |
|---|---|---|
| `id` | integer (auto) | Primary key |
| `task_type` | text (unique) | Matcht met Browser_Tasks.task_type |
| `display_name` | text | Leesbare naam |
| `description` | text | Wat doet dit script |
| `script_name` | text | Bestandsnaam op GitHub (scripts/ map) |
| `example_payload` | jsonb | Voorbeeld Browser_Tasks rij |
| `created_at` | timestamp | Aangemaakt |

## Geregistreerde Scripts

| task_type | script_name | Status |
|---|---|---|
| `forecast-sync` | `flieber-forecast-updater.js` | ✅ Layer 1 (hardcoded) |
| `inventory-sync-bol` | `inventory-sync-bol.js` | ✅ Layer 1 |
| `price-scrape` | `price-monitor-scraper.js` | ✅ Layer 1 |
| `bol-cases-scrape` | `bol-cases-scrape.js` | ✅ Layer 3 (registry) |

## bol-cases-scrape.js — Details

**Versie:** 1.2.0  
**Modus:** Standalone (eigen browser met stealth + proxy)  
**GitHub:** `scripts/bol-cases-scrape.js`

### Wat het doet:
1. Laadt `bol-storage-state.json` (cookies van partner portal)
2. Start stealth Chromium browser met Decodo NL proxy
3. Navigeert naar partner.bol.com (activeert cookies)
4. Checkt of sessie nog geldig is (geen redirect naar login)
5. Haalt case counts op via interne API
6. Haalt OPEN cases lijst op
7. Haalt NEW cases lijst op
8. Per case: details + volledige email bodies
9. Schrijft alles naar `bol-cases-scrape-data.json`

### Dependencies (moeten geïnstalleerd zijn in executor dir):
```bash
cd C:\Users\Tim\playwright-render-service
npm install playwright-extra puppeteer-extra-plugin-stealth
```

### Anti-detectie:
- **Stealth plugin:** Verbergt headless browser fingerprint, WebDriver flag
- **Decodo NL proxy:** Residentieel IP (nl.decodo.com:10001)
- **Realistische headers:** NL locale, Chrome user agent, correct Sec-Fetch headers

### Cookie afhankelijkheid:
- Cookies komen van `bol-partner-save-cookies.js` (apart script)
- Cookies verlopen na onbekende periode
- Als cookies verlopen → script returned error "Session expired"
- Oplossing: handmatig `bol-partner-save-cookies.js` draaien (vereist 2FA SMS)

## Resultaat ophalen (voor agents)

Na het inserten van een task, poll de agent de Browser_Tasks tabel:

```sql
SELECT status, result, error_message, completed_at 
FROM "Browser_Tasks" 
WHERE id = '{task_id}';
```

- `status = 'done'` → resultaat in `result` kolom (JSON)
- `status = 'failed'` → foutmelding in `error_message`
- `status = 'running'` → nog bezig, wacht en poll opnieuw
- `status = 'pending'` → nog niet opgepakt door executor

**Typische wachttijd:** 30-120 seconden (30s poll + script executietijd)

## Troubleshooting

| Probleem | Oorzaak | Oplossing |
|---|---|---|
| `module.exports is not a function` | Script heeft module.exports maar export is geen functie | Zorg dat script standalone is (geen module.exports) |
| `Storage state not found` | `bol-storage-state.json` ontbreekt | Draai `bol-partner-save-cookies.js` |
| `Session expired` | Cookies verlopen | Draai `bol-partner-save-cookies.js` (2FA nodig) |
| Script niet gevonden | Niet in hardcoded map, actions, of registry | Registreer in Browser_Task_Registry |
| Taak blijft `pending` | Executor draait niet | Start executor: `node playwright-task-executor.js` |
| `Cannot find module 'playwright-extra'` | Package niet geïnstalleerd | `npm install playwright-extra puppeteer-extra-plugin-stealth` |

## Flow Diagram

```
Agent INSERT Browser_Tasks (pending)
        ↓
Executor poll (elke 30s)
        ↓
3-layer script resolution → vind script naam
        ↓
Download latest van GitHub (raw.githubusercontent.com)
        ↓
Detecteer modus: standalone of module.exports
        ↓
[Standalone] → node script.js → eigen browser (stealth/proxy)
[Module]     → executor browser → injecteer { page, context, supabase }
        ↓
Script uitvoeren → resultaat
        ↓
UPDATE Browser_Tasks (done/failed + result/error)
        ↓
Agent pollt resultaat en verwerkt
```
