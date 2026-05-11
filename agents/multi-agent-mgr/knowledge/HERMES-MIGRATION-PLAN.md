# Tasklet → Hermes Migration Plan

## Onze huidige stack — wat er moet migreren

### 📊 Supabase (BLIJFT — geen migratie nodig)
**127 tabellen** in project `zlteahycfmpiaxdbnlvr` (nu Pro plan)

Supabase is onze backbone en blijft gewoon staan. Hermes verbindt via MCP of directe PostgreSQL. Dit is het **makkelijkste deel** — niks hoeft te verhuizen.

Categorieën:
- **Finance**: P&L, cashflow, balance sheet, COGS, bank payments, VAT (~25 tabellen)
- **Inventory/Supply chain**: Flieber, FBA, PO's, replenishment, warehousing (~20 tabellen)
- **Amazon/Ads**: campaigns, targets, bid log, search terms, pricing (~15 tabellen)
- **Product**: Puzzlup, margins, channels, forecasts (~10 tabellen)
- **Agent infra**: directives, skills, task log, audit, shared knowledge (~15 tabellen)
- **Other**: domains, legal, insurance, IP, M&A, market insights (~40+ tabellen)

**Migratie-impact: ✅ NIKS** — Hermes verbindt direct via Supabase MCP

---

### 🤖 Agents (37+ agents — MEESTE WERK)

Elk Tasklet agent heeft:
1. **System prompt** — instructies, context, regels
2. **Connections** — API koppelingen
3. **Triggers** — Gmail, schedule, webhooks
4. **Geheugen** — SQL DB per agent + filesystem
5. **Subagents** — delegatie-instructies

**In Hermes worden dit:**
- System prompt → Hermes agent config YAML
- Connections → MCP servers + plugins
- Triggers → Hermes native scheduling + webhook plugins  
- Geheugen → Hermes persistent skills + Supabase
- Subagents → Hermes subagent delegatie

**Migratie-strategie: Agent-per-agent, prioriteit op basis van waarde**

#### Tier 1 — Migreer eerst (dagelijks actief, hoge waarde)
| Agent | Functie | Complexiteit |
|---|---|---|
| Multi Agent Mgr | Orchestratie, netwerk, browser tasks | 🔴 Hoog |
| CFO Agent | Sellerboard scraping, P&L, cashflow | 🔴 Hoog |
| Ads Agent | Amazon PPC optimalisatie | 🟠 Middel |
| Supply Chain | Flieber, replenishment, PO's | 🔴 Hoog |
| Email Agent(s) | Gmail processing, labeling | 🟢 Laag |

#### Tier 2 — Daarna (wekelijks actief)
| Agent | Functie | Complexiteit |
|---|---|---|
| Price Monitor | Competitor pricing | 🟠 Middel |
| Review Agent | Amazon review analysis | 🟢 Laag |
| Legal/IP Agent | Trademark monitoring | 🟢 Laag |

#### Tier 3 — Als laatste of uitfaseren
- Agents die in audit als "inactive" of "low value" zijn gemarkeerd
- Overhead agents (heartbeat, etc — al verwijderd per Directive #28)

---

### 🔗 Connections (11 actief — moeten allemaal opnieuw)

| Service | Tasklet | Hermes equivalent | Moeite |
|---|---|---|---|
| **Supabase** | Native connection | MCP server (Composio) | 🟢 Makkelijk |
| **GitHub** | Native connection | MCP server | 🟢 Makkelijk |
| **Google Drive** | Native connection | MCP of OAuth plugin | 🟠 Middel |
| **Gmail** | Native connection + trigger | Native plugin | 🟢 Makkelijk |
| **Slack** | Native connection | Native (ingebouwd) | 🟢 Makkelijk |
| **Airtable** | Direct API | MCP of HTTP plugin | 🟠 Middel |
| **Vercel** | Native connection | MCP server | 🟢 Makkelijk |
| **LinkedIn** | Native connection | Plugin/MCP | 🟠 Middel |
| **Shortwave** | Native connection | Email plugin (of Gmail direct) | 🟠 Middel |

**Totale migratie-inspanning:** ~2-4 uur voor alle connections

---

### 🌐 Browser Automation (KRITIEK)

Onze Playwright scripts op de Windows executor:
- **Sellerboard** scraping (API interception methode)
- **Flieber** forecast management
- **WMS scripts** (Corax, Mintsoft, Forceget)
- **Amazon Seller Central** monitoring

**In Hermes:**
- Hermes heeft een **browser tool** maar het is minder matuur dan onze Playwright setup
- Optie A: Hermes browser tool gebruiken (eenvoudiger taken)
- Optie B: Playwright scripts blijven draaien op VPS (complexe taken)
- Optie C: Hermes roept dezelfde Playwright scripts aan via terminal tool

**Aanbeveling:** Optie C — bestaande scripts hergebruiken, Hermes als orchestrator

---

### 📁 Filesystem & Kennis

| Item | Locatie nu | Hermes equivalent |
|---|---|---|
| Subagent instructies | `/agent/subagents/*.md` | Hermes skills (auto-generated!) |
| Shared Knowledge | Supabase `Shared_Knowledge` tabel | Blijft in Supabase |
| CFO scraping prompt | `/agent/home/CFO-SELLERBOARD-SCRAPING-PROMPT.md` | Hermes agent config |
| Summary | `/agent/home/SUMMARY.md` | Hermes persistent memory |
| Drive CSVs | Google Drive folder | Blijft in Drive |

---

## 🚀 Migratieplan — 4 Fases

### Fase 0: Voorbereiding (1 dag)
- [ ] VPS opzetten (Hetzner €5/mo of DigitalOcean $6/mo)
- [ ] Hermes installeren (`curl -fsSL https://hermes.nousresearch.com/install.sh | bash`)
- [ ] API keys configureren (Claude of GPT)
- [ ] Supabase MCP server aansluiten
- [ ] GitHub MCP server aansluiten
- [ ] Security hardenen (NIET default laten!)
  - Disable YOLO mode
  - File read deny list configureren
  - Shell command allowlist instellen
  - Docker sandbox backend gebruiken (niet local!)

### Fase 1: Proof of Concept — 1 agent (2-3 dagen)
- [ ] Email Agent migreren (laagste complexiteit)
- [ ] Gmail plugin configureren
- [ ] Test: kan het emails lezen, labelen, Supabase updaten?
- [ ] Vergelijk: snelheid, betrouwbaarheid, kosten
- [ ] Documenteer alle issues en workarounds

### Fase 2: Parallelle run (1-2 weken)
- [ ] 3-5 Tier 1 agents migreren
- [ ] Beide systemen draaien parallel
- [ ] Tasklet = primary, Hermes = shadow
- [ ] Vergelijk resultaten dagelijks
- [ ] Browser automation testen (Playwright via terminal)

### Fase 3: Cutover (1 week)
- [ ] Alle agents gemigreerd en getest
- [ ] Triggers overgezet
- [ ] Tasklet triggers uitschakelen
- [ ] Hermes = primary
- [ ] Tasklet = fallback (1 maand actief houden)

### Fase 4: Cleanup
- [ ] Tasklet abonnement opzeggen
- [ ] VPS monitoring opzetten
- [ ] Backup strategie voor Hermes config
- [ ] Documentatie afronden

---

## 💰 Kostenvergelijking

### Huidig (Tasklet)
| Item | Kosten/maand |
|---|---|
| Tasklet | ~$700 |
| Supabase Pro | $25 |
| Vercel | $20 |
| **Totaal** | **~$745/mo** |

### Na migratie (Hermes)
| Item | Kosten/maand |
|---|---|
| VPS (Hetzner CPX21) | ~€8 (~$9) |
| Claude API (37 agents) | ~$50-150 (afhankelijk van gebruik) |
| Supabase Pro | $25 |
| Vercel | $20 |
| **Totaal** | **~$100-200/mo** |

### Besparing: **$500-650/maand** (~75-85%)

---

## ⚠️ Risico's

| Risico | Impact | Mitigatie |
|---|---|---|
| Hermes v0.8 instabiliteit | 🔴 Hoog | Wacht op v1.0, of accepteer bugs |
| Security issues (4 critical) | 🔴 Hoog | Docker sandbox, hardening, geen YOLO |
| VPS beheer = jouw tijd | 🟠 Middel | Automatiseer met systemd + monitoring |
| Breaking changes bij updates | 🟠 Middel | Pin versie, update bewust |
| MCP ecosystem minder matuur | 🟠 Middel | Fallback naar directe API calls |
| Claude API rate limits | 🟢 Laag | Batch requests, caching |

---

## 🎯 Aanbeveling

**Niet nu migreren. Wel nu voorbereiden.**

1. ✅ **Nu:** Dit plan opslaan, watchlist voor Hermes v1.0
2. ✅ **Nu:** VPS opzetten als test-omgeving (~$9/mo)
3. ✅ **Q3 2026:** Proof of concept met 1 agent als Hermes v1.0 landt
4. ✅ **Q4 2026:** Parallelle run als PoC succesvol
5. ✅ **Q1 2027:** Volledige cutover

**Totale migratie-inspanning:** ~2-3 weken gespreid over 1-2 maanden
**Break-even:** Na 1 maand (besparing > migratie-kosten)
