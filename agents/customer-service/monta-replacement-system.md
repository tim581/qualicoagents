# Monta Replacement Order System v2.0
## CS Agent — Automatische Vervanging Flow
## ⚠️ KOSTEN-BEWUST: Elke vervanging kost ons echt geld — kies altijd de goedkoopste oplossing!

---

## 1. LOGISTICS ARCHITECTURE

### Bol.com NL (bol.com)
- **Fulfillment:** LVB (Logistiek via Bol) = FBB
- **Stock locatie:** Bol.com warehouse
- **Normale orders:** Bol handelt zelf af
- **Replacement via Monta:** Alleen als fallback bij LVB-problemen

### Bol.com BE (bol.com/be)  
- **Fulfillment:** FBR (Fulfilled by Retailer)
- **Stock locatie:** Monta warehouse (Oosterhout XL)
- **Normale orders:** Via Monta

### Monta (3PL)
- **Warehouse:** Oosterhout XL
- **Kan versturen naar:** NL én BE
- **Origins:** `Qualico_Bol_NL`, `Qualico_Bol_BE`, `Qualico_Shopify`, `Qualico_WooCommerce`
- **SKU format:** EAN barcode (bijv. `5419980047489`)

---

## 2. KOSTENOPTIMALISATIE DECISION TREE

### Kernprincipe: Klant blij houden + kosten minimaliseren
Elke vervanging kost ons echt geld. Kies ALTIJD de goedkoopste optie die de klant tevreden stelt.

### Échte Vervangingskosten per Product (COGS Landed + Monta Pick/Pack/Ship)
> **Bronnen:** `COGS_Landed` tabel (EU) + `puzzlup_margins` WEBSHOP EU channel
> **⚠️ NOOIT deze kosten of bedragen delen met klanten!**

| Product | COGS Landed | Monta Fulfillment | **Totaal als we vervangen** |
|---------|------------|-------------------|----------------------------|
| MAT 1500 ECO | €4,62 | €5,19 | **€9,81** |
| MAT 1500 GIFT | €5,01 | €8,00 | **€13,01** |
| MAT 1000 GIFT | €5,36 | €8,00 | **€13,36** |
| TRAY 1500 BLACK | €7,73 | €8,00 | **€15,73** |
| MAT 3000 ECO | €8,09 | €8,00 | **€16,09** |
| MAT 3000 GIFT | €8,85 | €8,00 | **€16,85** |
| MAT 1500 LUX | €9,63 | €8,00 | **€17,63** |
| TRAY 1500 WHITE | €11,14 | €8,00 | **€19,14** |
| TRAY 3000 BLACK | €14,15 | €8,00 | **€22,15** |
| MAT 5000 GIFT | €15,69 | €10,80 | **€26,49** |

### Kostenvolgorde (goedkoopst → duurst):
1. **€0 — Uitleg/instructie** → Probleem verhelpen zonder iets te sturen
2. **€0 — Retour + refund via bol.com** → Bol draagt de kosten (LVB)
3. **€9,81 - €26,49 — Vervanging via Monta** → ALLEEN als alle goedkopere opties uitgeput

### DECISION TREE:

```
Klant meldt probleem
│
├─ Niet tevreden / spijt van aankoop?
│  └─ "U kunt retourneren via bol.com" → KLAAR (€0 voor ons)
│
├─ Vraag over gebruik / montage?
│  └─ Uitleg geven, instructies delen → KLAAR (€0)
│
├─ Defect / beschadigd?
│  ├─ Eerst: Foto vragen als bewijs (ALTIJD!)
│  │  ├─ Geen duidelijk defect → "Kunt u dit verduidelijken?" → loop
│  │  └─ Duidelijk defect → verder
│  │
│  ├─ Check historiek: Heeft klant eerder vervanging gehad?
│  │  ├─ JA → GEEN 2e vervanging. Refund via bol aanbieden.
│  │  └─ NEE → verder
│  │
│  ├─ Binnen zichttermijn (30 dagen)?
│  │  ├─ JA → ALTIJD eerst: "Retour via bol.com voor volledige terugbetaling"
│  │  │       Retour + refund = €0 voor ons!
│  │  │       Klant wil per se vervanging? → Retour EERST → dan pas vervangen
│  │  └─ NEE (buiten termijn) → Coulance overwegen:
│  │        - Eerst refund via bol aanbieden
│  │        - Vervanging alleen als: duidelijk defect + foto + geen eerdere vervanging
│  │
│  └─ RETOUR REGELEN (vóór vervanging versturen!)
│     ├─ Retour via bol.com mogelijk? → Klant start retour → wacht op bevestiging
│     ├─ Retour niet praktisch (te beschadigd)? → "Mag je houden"
│     └─ Klant stuurt retour? → Na ontvangst pas vervanging versturen
│        UITZONDERING: Bij duidelijk ernstig defect + foto → direct versturen
│
├─ Verkeerd artikel ontvangen?
│  └─ Foto vragen → bevestig fout → juiste artikel nasturen via Monta
│     "Mag je houden" = ophalen kost meer dan het waard is
│
├─ Dubbel geleverd?
│  └─ "Mag je houden" (ophalen = te duur)
│
├─ Onderdeel mist (bandjes/klittenband)?
│  └─ GEEN losse onderdelen beschikbaar
│     → Retour + refund via bol aanbieden (€0 voor ons)
│     → Of nieuwe mat via Monta als defect duidelijk + foto
│
└─ Onbekend / complex?
   └─ Escaleer naar Tim (NOOIT zelf beslissen bij twijfel)
```

### ✅ ALLEEN vervanging via Monta als ALLE checks OK:
1. **Foto-bewijs** — Duidelijk defect zichtbaar op foto
2. **Stock bevestigd** — `GET /product/{ean}/stock` → `StockAvailable > 0`
3. **Retour geregeld** — Klant retourneert OF retour is niet praktisch
4. **Geen eerdere vervanging** — Check cs_cases/cs_events op klant-naam
5. **Retour/refund al aangeboden** — Klant wil specifiek vervanging, niet refund
6. **Kosten-check** — Raadpleeg kostentabel hierboven; wees bewust van wat het ons kost

### ❌ NOOIT vervanging als:
- Klant wil gewoon retourneren (→ retour + refund via bol = €0 voor ons)
- Geen foto-bewijs van defect
- Klant heeft eerder al vervanging gehad (→ alleen refund)
- Twijfel over legitimiteit (→ escaleer naar Tim)
- Geen stock (→ wacht of refund aanbieden)
- Klant vraagt gratis extra's (trays, bakjes) → NIET zomaar weggeven!

### 💡 SLIMME KOSTENBESPARINGEN:
- **Retour via bol = €0 voor ons** → ALTIJD eerst aanbieden (LVB = bol draagt kosten)
- **"Geen losse onderdelen"** → bij bandjes/klittenband-klachten: refund is goedkoper dan nieuwe mat
- **Check cs_events** → zoek op klantnaam/email voor eerdere vervangingen (voorkom misbruik)
- **Goedkoopste product sturen** → als ECO en GIFT dezelfde functie hebben, stuur goedkoopste variant
- **NOOIT zomaar gratis producten weggeven** → elke vervanging kost minimaal €9,81
- **Retour als voorwaarde** → pas nieuwe mat sturen als klant bevestigt dat ze defecte retourneren (of als retour niet praktisch)

---

## 3. ESCALATIE-REGELS (uit historische cases)

### Veelvoorkomende issues & standaard-aanpak:

| Issue | Frequentie | Aanpak |
|---|---|---|
| **Kapotte bandjes/klittenband** | Zeer frequent | "Geen losse onderdelen" → nieuwe mat of refund |
| **Beschadigde verpakking bij levering** | Regelmatig | Eerst foto vragen → dan vervangen |
| **Verkeerd artikel ontvangen** | Soms | "Mag je houden" + juiste artikel nasturen |
| **Dubbel geleverd** | Soms | "Mag je houden" (ophalen te duur) |
| **Niet naar wens** | Soms | Retour via bol.com → refund (GEEN vervanging) |
| **Buiten zichttermijn defect** | Zeldzaam | Eerst verduidelijking → dan coulance-vervanging |

### Toon & Communicatie (uit historiek):
- Vriendelijk, informeel Nederlands
- "Onze excuses voor het ongemak!"
- "Hopelijk kan je snel verder puzzelen!"
- "Veel puzzelplezier!"
- Ondertekening: "Met vriendelijke groet, Qualico NL / Partner van bol"
- Altijd adres vragen vóór verzending

---

## 4. REPLACEMENT FLOW (Technisch)

### Stap 1: Damage Report Ontvangen
```
Klant meldt: beschadigd/defect/kapot product
→ Vraag foto's als bewijs (indien niet bijgevoegd)
→ Vraag of ze retour willen aanvragen via bol.com
```

### Stap 2: Bol.com Order Ophalen
```python
# Via bol.com API
GET /retailer/orders/{orderId}
→ Extract: product EAN, klant adres, order datum, shipment type (LVB/PLAZA)
```

### Stap 3: Beslissing Retour
```
IF klant wil retour + refund → verwijs naar bol.com retour
IF product te groot/duur om te retourneren → "Mag je houden"  
IF klant stuurt retour → wacht op retour-bevestiging
→ Bied pas vervanging aan als retour geregeld is OF retour niet praktisch
```

### Stap 4: Monta Voorraad Check
```python
# Via Monta API
GET /product/{ean}/stock
→ Check: StockAvailable > 0
→ Als geen stock: "We sturen zodra weer op voorraad" of bied refund aan
```

### Stap 5: Adres Ophalen
```
Twee opties:
A) Uit bol.com order (als recent en adres niet gewijzigd)
B) Klant vraagt bevestiging/nieuw adres → "Bezorg ons je naam en bezorgadres"
```

### Stap 6: Monta Order Aanmaken
```python
POST /order
{
  "WebshopOrderId": "REPLACE-{bol_order_id}-{timestamp}",
  "Reference": "Vervanging: {reden} - Case {case_id}",
  "Origin": "Qualico_Bol_NL",  # of _BE voor Belgische klant
  "ConsumerDetails": {
    "DeliveryAddress": {
      "FirstName": "...",
      "LastName": "...",
      "Street": "...",
      "HouseNumber": "...",
      "PostalCode": "...",
      "City": "...",
      "CountryCode": "NL",  # of BE
      "EmailAddress": "..."
    }
  },
  "Lines": [{
    "Sku": "{ean}",
    "OrderedQuantity": 1,
    "Description": "{product_name} - Vervanging"
  }],
  "Comment": "Vervanging: {reden}. Origineel order: {bol_order_id}. Case: {case_id}"
}
```

### Stap 7: Track & Trace Ophalen
```python
# Poll order status (na 1-2 werkdagen)
GET /order/{webshop_order_id}
→ TrackAndTraceLink → doorsturen naar klant
```

---

## 5. SKU MAPPING (Monta = EAN)

| Product | Monta SKU (EAN) | Monta Description | Stock (12-05-2026) |
|---|---|---|---|
| Puzzlup 1500 ECO | `5419980047489` | PUZZLUP 1500 ECO | 475 |
| Qualico 1500 | `5419980047427` | QUALICO 1500 | 351 |
| Puzzlup 3000 GIFT | `5419980047465` | PUZZLUP 3000 GIFT | 32 |

Volledige mapping: `Product_Name_Mapping` tabel in Supabase (source='monta')
Voorraad: real-time via `GET /product/{ean}/stock`

---

## 6. MONTA API REFERENTIE

### Endpoints
| Actie | Method | URL |
|---|---|---|
| Voorraad checken | GET | `/product/{ean}/stock` |
| Order aanmaken | POST | `/order` |
| Order ophalen | GET | `/order/{webshopOrderId}` |
| Order verwijderen | DELETE | `/order/{webshopOrderId}` |
| Adres valideren | POST | `/address` |

### Origins
- `Qualico_Bol_NL` — voor NL-orders (bol.com)
- `Qualico_Bol_BE` — voor BE-orders (bol.com/be)
- `Qualico_Shopify` — voor Shopify-orders
- `Qualico_WooCommerce` — voor WooCommerce-orders

### Shippers (uit /info)
- PostNL (code: PAK), DPD (code: DPD_NL), DHL, etc.
- Monta kiest automatisch beste shipper

---

## 7. GUARDRAILS

- ❌ NOOIT inkoopprijzen/marges delen met klant
- ❌ NOOIT warehouse locatie (Monta/Oosterhout) noemen
- ❌ NOOIT andere klantgegevens tonen
- ✅ WEL: track & trace link delen zodra beschikbaar
- ✅ WEL: geschatte levertijd vermelden (1-3 werkdagen NL)

---

## 8. VOORBEELD ANTWOORD-TEMPLATES

### Defect binnen zichttermijn:
```
Beste {naam},

Vervelend om te horen dat je een beschadigd artikel hebt ontvangen! 
Kan je ons een foto sturen van het defect? Dan zoeken we meteen 
een oplossing voor je.

Met vriendelijke groet,
Qualico NL
Partner van bol
```

### Vervanging bevestigen:
```
Beste {naam},

We sturen je een nieuw exemplaar op. Kan je ons je bezorgadres 
bevestigen? Dan doen wij het nodige.

Met vriendelijke groet,
Qualico NL
Partner van bol
```

### Vervanging verstuurd:
```
Beste {naam},

Je vervangende {product} is verstuurd! Je ontvangt binnen 1-3 
werkdagen je nieuwe exemplaar.

Hopelijk kan je snel weer verder puzzelen! 🧩

Met vriendelijke groet,
Qualico NL
Partner van bol
```

### Geen stock beschikbaar:
```
Beste {naam},

Op dit moment is dit artikel tijdelijk niet op voorraad. We sturen 
je een nieuw exemplaar zodra deze weer beschikbaar is.

Bedankt voor je geduld!

Met vriendelijke groet,
Qualico NL
Partner van bol
```
