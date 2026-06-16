-- Flieber inventory forecast snapshots (product × location per sync run).
-- Links to Puzzlup products via flieber_product_skus (soft link — no FK to master product tables).

CREATE TABLE IF NOT EXISTS public.flieber_inventory_forecast (
  id BIGSERIAL PRIMARY KEY,
  run_id TEXT NOT NULL,
  scraped_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Flieber identifiers
  flieber_product_id UUID NOT NULL,
  flieber_product_name TEXT NOT NULL,
  flieber_product_code TEXT,
  inventory_location_id UUID NOT NULL,
  inventory_location_name TEXT NOT NULL,

  -- Puzzlup mapping (nullable when no flieber_product_skus match)
  product_id INTEGER,
  flieber_product_skus_id INTEGER,

  -- On-hand inventory
  on_hand_units INTEGER,
  on_hand_days_of_stock INTEGER,
  is_on_hand_out_of_stock BOOLEAN DEFAULT false,

  -- Total inventory (on-hand + in-transit)
  total_inventory_units INTEGER,
  total_days_of_stock INTEGER,
  is_total_out_of_stock BOOLEAN DEFAULT false,

  -- On-order
  on_order_units INTEGER,
  on_order_days_of_stock INTEGER,

  -- Stockout dates (last day of stock)
  last_stockout_date DATE,
  last_stockout_date_on_hand DATE,
  first_stockout_date DATE,

  -- Replenishment
  replenishment_needs_units INTEGER,
  replenishment_type TEXT,
  total_available_at_origin_units INTEGER,
  optimal_order_date DATE,
  optimal_delivery_date DATE,
  days_of_stock_at_arrival INTEGER,

  -- Status
  inventory_status TEXT,
  inventory_status_label TEXT,
  tier TEXT,

  UNIQUE (run_id, flieber_product_id, inventory_location_id)
);

CREATE INDEX IF NOT EXISTS idx_fif_run_id ON public.flieber_inventory_forecast (run_id);
CREATE INDEX IF NOT EXISTS idx_fif_product_id ON public.flieber_inventory_forecast (product_id);
CREATE INDEX IF NOT EXISTS idx_fif_location ON public.flieber_inventory_forecast (inventory_location_name);
CREATE INDEX IF NOT EXISTS idx_fif_scraped_at ON public.flieber_inventory_forecast (scraped_at DESC);
CREATE INDEX IF NOT EXISTS idx_fif_status ON public.flieber_inventory_forecast (inventory_status_label);

COMMENT ON TABLE public.flieber_inventory_forecast IS
  'Point-in-time Flieber inventory forecast per product×location. product_id maps via flieber_product_skus only.';
COMMENT ON COLUMN public.flieber_inventory_forecast.product_id IS
  'Puzzlup product_id from flieber_product_skus — intentionally no FK to preserve master data independence.';

ALTER TABLE public.flieber_inventory_forecast ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on flieber_inventory_forecast"
  ON public.flieber_inventory_forecast FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated read flieber_inventory_forecast"
  ON public.flieber_inventory_forecast FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Anon read flieber_inventory_forecast"
  ON public.flieber_inventory_forecast FOR SELECT TO anon
  USING (true);
