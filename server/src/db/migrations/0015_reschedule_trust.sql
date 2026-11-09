-- Доверие к переносам: какие переносы сроков система предложила руководителю
-- и что с ними стало. Открытое предложение на пару (цель, задача) одно:
-- если задержка растёт, сдвигается его новый срок, а не множатся строки.

CREATE TABLE reschedule_proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  goal_id UUID NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  from_due DATE NOT NULL,
  to_due DATE NOT NULL,
  shown_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_at TIMESTAMPTZ,
  outcome VARCHAR(12) CHECK (outcome IN ('accepted', 'dismissed')),
  CHECK ((outcome IS NULL) = (decided_at IS NULL))
);
CREATE UNIQUE INDEX uq_reschedule_proposals_open ON reschedule_proposals (goal_id, task_id) WHERE decided_at IS NULL;
CREATE INDEX idx_reschedule_proposals_company ON reschedule_proposals (company_id, shown_at DESC);
