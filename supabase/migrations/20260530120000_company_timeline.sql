-- Company milestone timeline (Asana-style, simplified)
-- Tracks = swimlanes; items = milestones (diamond) or initiatives (bar)

CREATE TABLE IF NOT EXISTS public.company_timeline_tracks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  color TEXT NOT NULL DEFAULT '#00D4AA',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.company_timeline_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  track_id UUID NOT NULL REFERENCES public.company_timeline_tracks(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  item_type TEXT NOT NULL DEFAULT 'initiative'
    CHECK (item_type IN ('milestone', 'initiative')),
  start_date DATE NOT NULL,
  end_date DATE,
  status TEXT NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned', 'in_progress', 'completed', 'cancelled')),
  color TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT company_timeline_items_dates_valid CHECK (
    end_date IS NULL OR end_date >= start_date
  ),
  CONSTRAINT company_timeline_milestone_single_date CHECK (
    item_type = 'initiative' OR end_date IS NULL OR end_date = start_date
  )
);

CREATE INDEX IF NOT EXISTS idx_company_timeline_items_track
  ON public.company_timeline_items(track_id, sort_order);

CREATE INDEX IF NOT EXISTS idx_company_timeline_items_dates
  ON public.company_timeline_items(start_date, end_date);

CREATE OR REPLACE FUNCTION public.company_timeline_items_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_company_timeline_items_updated_at ON public.company_timeline_items;
CREATE TRIGGER trg_company_timeline_items_updated_at
  BEFORE UPDATE ON public.company_timeline_items
  FOR EACH ROW
  EXECUTE FUNCTION public.company_timeline_items_set_updated_at();

ALTER TABLE public.company_timeline_tracks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_timeline_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "company_timeline_tracks_read"
  ON public.company_timeline_tracks FOR SELECT
  USING (true);

CREATE POLICY "company_timeline_tracks_write"
  ON public.company_timeline_tracks FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "company_timeline_items_read"
  ON public.company_timeline_items FOR SELECT
  USING (true);

CREATE POLICY "company_timeline_items_write"
  ON public.company_timeline_items FOR ALL
  USING (true)
  WITH CHECK (true);

-- Default swimlanes
INSERT INTO public.company_timeline_tracks (name, color, sort_order) VALUES
  ('Strategy', '#A371F7', 1),
  ('Product', '#00D4AA', 2),
  ('Operations', '#58A6FF', 3),
  ('Finance', '#F0883E', 4),
  ('Growth', '#FF7B72', 5)
ON CONFLICT (name) DO NOTHING;

-- Seed example milestones (safe to re-run: only if table empty)
DO $$
DECLARE
  v_strategy UUID;
  v_product UUID;
  v_ops UUID;
  v_finance UUID;
  v_growth UUID;
BEGIN
  IF EXISTS (SELECT 1 FROM public.company_timeline_items LIMIT 1) THEN
    RETURN;
  END IF;

  SELECT id INTO v_strategy FROM public.company_timeline_tracks WHERE name = 'Strategy';
  SELECT id INTO v_product FROM public.company_timeline_tracks WHERE name = 'Product';
  SELECT id INTO v_ops FROM public.company_timeline_tracks WHERE name = 'Operations';
  SELECT id INTO v_finance FROM public.company_timeline_tracks WHERE name = 'Finance';
  SELECT id INTO v_growth FROM public.company_timeline_tracks WHERE name = 'Growth';

  INSERT INTO public.company_timeline_items
    (track_id, title, description, item_type, start_date, end_date, status, sort_order)
  VALUES
    (v_strategy, '2026 Annual Plan Locked', 'Board-approved targets and budget', 'milestone', '2026-01-15', '2026-01-15', 'completed', 1),
    (v_product, 'New SKU Launch — EU', 'Amazon DE/NL/BE rollout', 'initiative', '2026-02-01', '2026-04-30', 'in_progress', 1),
    (v_product, 'Listing Monitor v2', 'Unified pricing dashboard on Qualico Platform', 'initiative', '2026-03-01', '2026-05-31', 'in_progress', 2),
    (v_ops, '3PL Network Review', 'Evaluate WeShip vs alternatives', 'initiative', '2026-04-01', '2026-06-30', 'planned', 1),
    (v_ops, 'Inventory Sync Automation Live', 'Mintsoft + Forceget fully automated', 'milestone', '2026-05-01', '2026-05-01', 'planned', 2),
    (v_finance, 'Q2 Close', 'Quarterly financial close', 'milestone', '2026-07-15', '2026-07-15', 'planned', 1),
    (v_growth, 'US Market Entry Decision', 'Go/no-go on Amazon US expansion', 'milestone', '2026-09-01', '2026-09-01', 'planned', 1),
    (v_growth, 'Black Friday Prep', 'Stock, ads, pricing playbook', 'initiative', '2026-08-01', '2026-11-30', 'planned', 2);
END $$;
