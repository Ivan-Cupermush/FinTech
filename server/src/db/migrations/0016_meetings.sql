CREATE TABLE meetings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  organizer_id UUID REFERENCES users(id) ON DELETE SET NULL,
  title VARCHAR(150) NOT NULL CHECK (char_length(trim(title)) > 0),
  agenda VARCHAR(2000),
  location VARCHAR(300),
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL CHECK (ends_at > starts_at),
  UNIQUE (id, company_id)
);

CREATE TABLE meeting_participants (
  meeting_id UUID NOT NULL,
  company_id UUID NOT NULL,
  user_id UUID NOT NULL,
  PRIMARY KEY (meeting_id, user_id),
  FOREIGN KEY (meeting_id, company_id) REFERENCES meetings(id, company_id) ON DELETE CASCADE,
  FOREIGN KEY (company_id, user_id) REFERENCES company_members(company_id, user_id) ON DELETE CASCADE
);

CREATE INDEX meeting_participants_by_user ON meeting_participants (company_id, user_id, meeting_id);
