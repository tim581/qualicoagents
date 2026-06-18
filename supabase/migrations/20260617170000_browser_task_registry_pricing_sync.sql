-- Register bulk pricing sync automations for manual UI + agents
INSERT INTO "Browser_Task_Registry" (task_type, display_name, description, script_name, available, requires_running, example_payload)
VALUES
  (
    'bol-price-sync-all',
    'Bol.com — Sync All Price Targets',
    'Reads all BOL.COM rows from price_targets in Supabase, sets tijdelijke prijs + date range on partner.bol.com for each product.',
    'bol-price-sync-all.js',
    true,
    'playwright-task-executor.js on Tim PC',
    '{"agent_name":"manual-ui","task_type":"bol-price-sync-all","url":"https://partner.bol.com","actions":[],"credentials_key":"bol_seller","status":"pending"}'::jsonb
  ),
  (
    'amz-price-sync-all',
    'Amazon — Sync All Price Targets',
    'Runs amz-price-update.js for all EU + NA channels until price_targets_ready queue is empty.',
    'amz-price-sync-all.js',
    true,
    'playwright-task-executor.js on Tim PC',
    '{"agent_name":"manual-ui","task_type":"amz-price-sync-all","url":"https://sellercentral.amazon.co.uk","actions":[],"credentials_key":null,"status":"pending"}'::jsonb
  ),
  (
    'amz-price-update',
    'Amazon — Single Price Update',
    'Updates sale price for one ASIN/channel. Pass params in actions[0] or use amz-price-sync-all for bulk.',
    'amz-price-update.js',
    true,
    'playwright-task-executor.js on Tim PC',
    '{"agent_name":"manual-ui","task_type":"amz-price-update","url":"https://sellercentral.amazon.co.uk","actions":[],"credentials_key":null,"status":"pending"}'::jsonb
  )
ON CONFLICT (task_type) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  description = EXCLUDED.description,
  script_name = EXCLUDED.script_name,
  available = EXCLUDED.available,
  example_payload = EXCLUDED.example_payload;

UPDATE "Browser_Task_Registry" SET available = false WHERE task_type = 'amazon-buyer-messages';
