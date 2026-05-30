-- Asana-style task board: departments, projects, assignees, tasks with JSONB subtasks

CREATE TABLE IF NOT EXISTS public.task_board_departments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  color TEXT NOT NULL DEFAULT '#00D4AA',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.task_board_projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id UUID NOT NULL REFERENCES public.task_board_departments(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#238636',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (department_id, name)
);

CREATE TABLE IF NOT EXISTS public.task_board_assignees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.task_board_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id UUID NOT NULL REFERENCES public.task_board_departments(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.task_board_projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'to_start'
    CHECK (status IN ('to_start', 'in_progress', 'done')),
  importance TEXT NOT NULL DEFAULT 'medium'
    CHECK (importance IN ('low', 'medium', 'high', 'critical')),
  urgency TEXT NOT NULL DEFAULT 'medium'
    CHECK (urgency IN ('low', 'medium', 'high', 'critical')),
  assignee_id UUID REFERENCES public.task_board_assignees(id) ON DELETE SET NULL,
  due_date DATE,
  subtasks JSONB NOT NULL DEFAULT '[]'::jsonb,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_task_board_projects_department
  ON public.task_board_projects(department_id, sort_order);

CREATE INDEX IF NOT EXISTS idx_task_board_items_department
  ON public.task_board_items(department_id, status);

CREATE INDEX IF NOT EXISTS idx_task_board_items_project
  ON public.task_board_items(project_id, sort_order);

CREATE INDEX IF NOT EXISTS idx_task_board_items_due_date
  ON public.task_board_items(due_date)
  WHERE due_date IS NOT NULL AND status <> 'done';

CREATE OR REPLACE FUNCTION public.task_board_items_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_task_board_items_updated_at ON public.task_board_items;
CREATE TRIGGER trg_task_board_items_updated_at
  BEFORE UPDATE ON public.task_board_items
  FOR EACH ROW
  EXECUTE FUNCTION public.task_board_items_set_updated_at();

ALTER TABLE public.task_board_departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_board_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_board_assignees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_board_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "task_board_departments_read"
  ON public.task_board_departments FOR SELECT USING (true);
CREATE POLICY "task_board_departments_write"
  ON public.task_board_departments FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "task_board_projects_read"
  ON public.task_board_projects FOR SELECT USING (true);
CREATE POLICY "task_board_projects_write"
  ON public.task_board_projects FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "task_board_assignees_read"
  ON public.task_board_assignees FOR SELECT USING (true);
CREATE POLICY "task_board_assignees_write"
  ON public.task_board_assignees FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "task_board_items_read"
  ON public.task_board_items FOR SELECT USING (true);
CREATE POLICY "task_board_items_write"
  ON public.task_board_items FOR ALL USING (true) WITH CHECK (true);

-- Seed defaults (safe to re-run)
INSERT INTO public.task_board_departments (name, color, sort_order) VALUES
  ('Engineering', '#00D4AA', 1),
  ('Sales', '#58A6FF', 2),
  ('Operations', '#BC8CFF', 3)
ON CONFLICT (name) DO NOTHING;

INSERT INTO public.task_board_assignees (name, sort_order) VALUES
  ('Tim', 1)
ON CONFLICT (name) DO NOTHING;

DO $$
DECLARE
  v_eng UUID;
  v_sales UUID;
  v_ops UUID;
  v_p_platform UUID;
  v_p_automation UUID;
  v_p_pipeline UUID;
  v_p_logistics UUID;
  v_tim UUID;
BEGIN
  IF EXISTS (SELECT 1 FROM public.task_board_items LIMIT 1) THEN
    RETURN;
  END IF;

  SELECT id INTO v_eng FROM public.task_board_departments WHERE name = 'Engineering';
  SELECT id INTO v_sales FROM public.task_board_departments WHERE name = 'Sales';
  SELECT id INTO v_ops FROM public.task_board_departments WHERE name = 'Operations';
  SELECT id INTO v_tim FROM public.task_board_assignees WHERE name = 'Tim';

  INSERT INTO public.task_board_projects (department_id, name, color, sort_order) VALUES
    (v_eng, 'Platform v2', '#238636', 1),
    (v_eng, 'Automation', '#1F6FEB', 2),
    (v_sales, 'Q2 Pipeline', '#8957E5', 1),
    (v_ops, 'Logistics', '#BF8700', 1)
  ON CONFLICT (department_id, name) DO NOTHING;

  SELECT id INTO v_p_platform FROM public.task_board_projects WHERE department_id = v_eng AND name = 'Platform v2';
  SELECT id INTO v_p_automation FROM public.task_board_projects WHERE department_id = v_eng AND name = 'Automation';
  SELECT id INTO v_p_pipeline FROM public.task_board_projects WHERE department_id = v_sales AND name = 'Q2 Pipeline';
  SELECT id INTO v_p_logistics FROM public.task_board_projects WHERE department_id = v_ops AND name = 'Logistics';

  INSERT INTO public.task_board_items
    (department_id, project_id, title, description, status, importance, urgency, assignee_id, due_date, subtasks, sort_order)
  VALUES
    (
      v_eng, v_p_platform,
      'Design task board UI',
      'Asana-style layout with departments, projects, and views',
      'in_progress', 'high', 'high', v_tim,
      CURRENT_DATE + 1,
      jsonb_build_array(
        jsonb_build_object('id', gen_random_uuid(), 'title', 'Department filter bar', 'completed', true),
        jsonb_build_object('id', gen_random_uuid(), 'title', 'Project sidebar', 'completed', false),
        jsonb_build_object('id', gen_random_uuid(), 'title', 'Kanban view', 'completed', false)
      ),
      1
    ),
    (
      v_sales, v_p_pipeline,
      'Review partner proposals',
      '',
      'to_start', 'medium', 'high', v_tim,
      CURRENT_DATE + 5,
      jsonb_build_array(
        jsonb_build_object('id', gen_random_uuid(), 'title', 'Shortlist top 3', 'completed', false)
      ),
      1
    ),
    (
      v_ops, v_p_logistics,
      'Update shipping SLA docs',
      '',
      'to_start', 'low', 'low', NULL,
      NULL,
      '[]'::jsonb,
      1
    );
END $$;
