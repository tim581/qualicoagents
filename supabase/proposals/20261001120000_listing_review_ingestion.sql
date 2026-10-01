-- PROPOSAL ONLY. Not a live migration.
-- Do not apply this file from Cursor, CI, or `supabase db push` until Tim/Tasklet approves it.
-- Additive columns and one new table. No functions. No triggers. No changes to existing functions.
--
-- Why: public.puzzlup_reviews has no stable source-review identity. Deduping on reviewer
-- text is unsafe. Coverage of every product × channel also needs its own rows; Price_Monitor_Debug_Log
-- is a free-text trace and cannot say whether a missing listing was empty or never attempted.

ALTER TABLE public.puzzlup_reviews
  ADD COLUMN IF NOT EXISTS source text,
  ADD COLUMN IF NOT EXISTS channel_id integer,
  ADD COLUMN IF NOT EXISTS product_id integer,
  ADD COLUMN IF NOT EXISTS asin text,
  ADD COLUMN IF NOT EXISTS product_key text,
  ADD COLUMN IF NOT EXISTS source_review_id text,
  ADD COLUMN IF NOT EXISTS review_title text,
  ADD COLUMN IF NOT EXISTS review_body text,
  ADD COLUMN IF NOT EXISTS star_rating smallint,
  ADD COLUMN IF NOT EXISTS review_date date,
  ADD COLUMN IF NOT EXISTS source_url text,
  ADD COLUMN IF NOT EXISTS reviewer_name text,
  ADD COLUMN IF NOT EXISTS verified_purchase boolean,
  ADD COLUMN IF NOT EXISTS helpful_count integer,
  ADD COLUMN IF NOT EXISTS country text,
  ADD COLUMN IF NOT EXISTS scraped_at timestamptz,
  ADD COLUMN IF NOT EXISTS original_language text,
  ADD COLUMN IF NOT EXISTS review_title_en text,
  ADD COLUMN IF NOT EXISTS review_body_en text,
  ADD COLUMN IF NOT EXISTS translated_at timestamptz,
  ADD COLUMN IF NOT EXISTS translation_provider text,
  ADD COLUMN IF NOT EXISTS translation_model text,
  ADD COLUMN IF NOT EXISTS translation_version text,
  ADD COLUMN IF NOT EXISTS translation_status text,
  ADD COLUMN IF NOT EXISTS policy_status text,
  ADD COLUMN IF NOT EXISTS policy_categories jsonb,
  ADD COLUMN IF NOT EXISTS policy_rationale text,
  ADD COLUMN IF NOT EXISTS policy_evidence_quote text,
  ADD COLUMN IF NOT EXISTS policy_confidence numeric,
  ADD COLUMN IF NOT EXISTS policy_source_urls jsonb,
  ADD COLUMN IF NOT EXISTS policy_checked_on date,
  ADD COLUMN IF NOT EXISTS policy_assessed_at timestamptz,
  ADD COLUMN IF NOT EXISTS policy_model text,
  ADD COLUMN IF NOT EXISTS policy_version text,
  ADD COLUMN IF NOT EXISTS human_decision text,
  ADD COLUMN IF NOT EXISTS human_decision_note text,
  ADD COLUMN IF NOT EXISTS human_decision_at timestamptz;

COMMENT ON COLUMN public.puzzlup_reviews.source_review_id IS
  'Stable id from the source page, such as an Amazon customer_review id. Never a hash of review text.';
COMMENT ON COLUMN public.puzzlup_reviews.reviewer_name IS
  'Personal data. Store when the page shows it. Never write this column to logs or telemetry.';
COMMENT ON COLUMN public.puzzlup_reviews.translation_status IS
  'not_required (English source), pending, translated, or failed. Pending is not English and must not be copied into the English columns.';
COMMENT ON COLUMN public.puzzlup_reviews.policy_status IS
  'potential_policy_case, needs_human_review, no_clear_policy_case, or not_assessed. Assessment never submits a report.';
COMMENT ON COLUMN public.puzzlup_reviews.human_decision IS
  'Set only by a person. Ingestion updates must omit this column so a re-run cannot overwrite it.';

CREATE UNIQUE INDEX IF NOT EXISTS puzzlup_reviews_source_identity_uidx
  ON public.puzzlup_reviews (source, channel_id, product_key, source_review_id);

CREATE TABLE IF NOT EXISTS public.listing_review_coverage (
  id bigserial PRIMARY KEY,
  run_id text NOT NULL,
  source text NOT NULL,
  channel_id integer,
  product_id integer,
  asin text,
  variant_name text,
  product_key text NOT NULL,
  star_rating smallint NOT NULL CHECK (star_rating BETWEEN 1 AND 4),
  status text NOT NULL CHECK (status IN ('complete', 'empty', 'partial', 'blocked', 'unsupported', 'failed')),
  pages_fetched integer NOT NULL DEFAULT 0,
  reviews_collected integer NOT NULL DEFAULT 0,
  reviews_seen integer NOT NULL DEFAULT 0,
  foreign_excluded integer NOT NULL DEFAULT 0,
  reason text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, source, channel_id, product_key, star_rating)
);

COMMENT ON TABLE public.listing_review_coverage IS
  'One outcome per canonical ASIN or product, market, and star scope (1 through 4) per run. 5-star pages are not collected. empty means that star scope was exhausted and had no kept reviews. A scope absent from a run is unknown, not zero.';

ALTER TABLE public.listing_review_coverage ENABLE ROW LEVEL SECURITY;

-- No anon/authenticated policy is created here. The executor uses the service role,
-- which bypasses RLS. Add a read policy for the Listing Monitor server role when that
-- role is confirmed, rather than opening the table to anon.
