# Amazon Messaging — Beslissing 20 mei 2026

## ❌ Scraping gestopt

Automated access to Amazon Seller Central is **too risky** for account suspension.

Amazon's Terms of Service explicitly prohibit automated/programmatic access to Seller Central.
Consequences can include: warnings, temporary suspension, or **permanent account ban** across all marketplaces.

## ✅ Pad vooruit: SP-API Messaging

Amazon biedt een officiële **Selling Partner API (SP-API)** met Messaging endpoints:
- `GET /messaging/v1/orders/{orderId}/messages` — berichten lezen
- `POST /messaging/v1/orders/{orderId}/messages` — antwoorden sturen
- Werkt voor alle EU marketplaces met één app

### Stappen:
1. Registreer als SP-API developer via Amazon Developer portal
2. Maak een SP-API app aan met Messaging scope
3. Autoriseer de app voor het PeakPulse seller account
4. Integreer in CS agent (direct API connection in Tasklet)

## Bestanden verwijderd:
- `scripts/amazon-buyer-messages.js` — scraping script verwijderd
- `scripts/amazon-seller-template.js` — bewaard als referentie
- `scripts/convert-amazon-cookies.js` — bewaard als referentie
- `Browser_Task_Registry` entry voor `amazon-buyer-messages` verwijderd

## Bewaard (voor andere toepassingen):
- `amazon-storage-state.json` op Tim's PC — kan later nuttig zijn
- Cookie infrastructure scripts — herbruikbaar voor andere platforms
