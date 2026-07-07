-- Staxxer VAT compliance snapshots (scraped from cloud.staxxer.com via Playwright)

CREATE TABLE IF NOT EXISTS public.staxxer_vat_sync_runs (
  id BIGSERIAL PRIMARY KEY,
  run_id TEXT NOT NULL UNIQUE,
  account_slug TEXT NOT NULL DEFAULT 'qualicobv',
  scraped_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status TEXT NOT NULL DEFAULT 'running',
  filings_count INTEGER DEFAULT 0,
  registrations_count INTEGER DEFAULT 0,
  dashboard_items_count INTEGER DEFAULT 0,
  error_message TEXT,
  raw_summary JSONB
);

CREATE TABLE IF NOT EXISTS public.staxxer_vat_registrations (
  id BIGSERIAL PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES public.staxxer_vat_sync_runs(run_id) ON DELETE CASCADE,
  account_slug TEXT NOT NULL DEFAULT 'qualicobv',
  country TEXT NOT NULL,
  vat_number TEXT,
  status TEXT,
  start_date DATE,
  end_date DATE,
  scraped_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (run_id, country, vat_number)
);

CREATE TABLE IF NOT EXISTS public.staxxer_vat_filings (
  id BIGSERIAL PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES public.staxxer_vat_sync_runs(run_id) ON DELETE CASCADE,
  account_slug TEXT NOT NULL DEFAULT 'qualicobv',
  tab TEXT NOT NULL,
  country TEXT NOT NULL,
  filing_period TEXT,
  payment_due DATE,
  payment_date DATE,
  amount_text TEXT,
  amount_value NUMERIC,
  currency TEXT,
  status TEXT,
  scraped_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (run_id, tab, country, filing_period, payment_due)
);

CREATE TABLE IF NOT EXISTS public.staxxer_oss_snapshot (
  id BIGSERIAL PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES public.staxxer_vat_sync_runs(run_id) ON DELETE CASCADE,
  account_slug TEXT NOT NULL DEFAULT 'qualicobv',
  registration_date DATE,
  end_date DATE,
  linked_vat_numbers JSONB NOT NULL DEFAULT '[]'::jsonb,
  additional_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  scraped_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (run_id)
);

CREATE TABLE IF NOT EXISTS public.staxxer_vat_dashboard (
  id BIGSERIAL PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES public.staxxer_vat_sync_runs(run_id) ON DELETE CASCADE,
  account_slug TEXT NOT NULL DEFAULT 'qualicobv',
  section TEXT NOT NULL,
  country TEXT,
  period_label TEXT,
  status_label TEXT,
  scraped_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_staxxer_vat_filings_run ON public.staxxer_vat_filings (run_id);
CREATE INDEX IF NOT EXISTS idx_staxxer_vat_filings_country ON public.staxxer_vat_filings (country);
CREATE INDEX IF NOT EXISTS idx_staxxer_vat_filings_due ON public.staxxer_vat_filings (payment_due);
CREATE INDEX IF NOT EXISTS idx_staxxer_vat_filings_status ON public.staxxer_vat_filings (status);
CREATE INDEX IF NOT EXISTS idx_staxxer_vat_registrations_run ON public.staxxer_vat_registrations (run_id);
CREATE INDEX IF NOT EXISTS idx_staxxer_vat_registrations_country ON public.staxxer_vat_registrations (country);
CREATE INDEX IF NOT EXISTS idx_staxxer_vat_dashboard_run ON public.staxxer_vat_dashboard (run_id);
CREATE INDEX IF NOT EXISTS idx_staxxer_sync_runs_scraped ON public.staxxer_vat_sync_runs (scraped_at DESC);

COMMENT ON TABLE public.staxxer_vat_sync_runs IS 'One row per Staxxer VAT scrape run (staxxer-vat-scraper.js).';
COMMENT ON TABLE public.staxxer_vat_filings IS 'VAT filing rows from Staxxer Filings page (todo/upcoming/done tabs).';
COMMENT ON TABLE public.staxxer_vat_registrations IS 'VAT registration numbers and status per country from Staxxer.';
COMMENT ON TABLE public.staxxer_oss_snapshot IS 'One Stop Shop registration snapshot per sync run.';
COMMENT ON TABLE public.staxxer_vat_dashboard IS 'Dashboard country/period status cards from Staxxer home.';

ALTER TABLE public.staxxer_vat_sync_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staxxer_vat_registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staxxer_vat_filings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staxxer_oss_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staxxer_vat_dashboard ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access staxxer_vat_sync_runs"
  ON public.staxxer_vat_sync_runs FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access staxxer_vat_registrations"
  ON public.staxxer_vat_registrations FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access staxxer_vat_filings"
  ON public.staxxer_vat_filings FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access staxxer_oss_snapshot"
  ON public.staxxer_oss_snapshot FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access staxxer_vat_dashboard"
  ON public.staxxer_vat_dashboard FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated read staxxer_vat_sync_runs"
  ON public.staxxer_vat_sync_runs FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated read staxxer_vat_registrations"
  ON public.staxxer_vat_registrations FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated read staxxer_vat_filings"
  ON public.staxxer_vat_filings FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated read staxxer_oss_snapshot"
  ON public.staxxer_oss_snapshot FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated read staxxer_vat_dashboard"
  ON public.staxxer_vat_dashboard FOR SELECT TO authenticated USING (true);

INSERT INTO "Browser_Task_Registry" (task_type, display_name, description, script_name, available, requires_running, example_payload)
VALUES (
  'staxxer-vat-sync',
  'Staxxer — VAT Compliance Sync',
  'Scrapes VAT filings, registrations, OSS and dashboard status from cloud.staxxer.com into Supabase.',
  'staxxer-vat-scraper.js',
  true,
  'playwright-task-executor.js on Tim PC',
  '{"agent_name":"vat-agent","task_type":"staxxer-vat-sync","url":"https://cloud.staxxer.com/qualicobv","actions":[],"credentials_key":"staxxer_login","status":"pending"}'::jsonb
)
ON CONFLICT (task_type) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  description = EXCLUDED.description,
  script_name = EXCLUDED.script_name,
  available = EXCLUDED.available,
  example_payload = EXCLUDED.example_payload;
