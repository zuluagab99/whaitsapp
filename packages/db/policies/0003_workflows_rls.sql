-- RLS for the workflows table (added after 0001 ran; same tenant_isolation policy).
ALTER TABLE workflows ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflows FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON workflows;
CREATE POLICY tenant_isolation ON workflows
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
