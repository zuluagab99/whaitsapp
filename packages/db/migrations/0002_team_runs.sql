-- users: add display name + login tracking
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "name" text;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "last_login_at" timestamp with time zone;
--> statement-breakpoint

-- workflow execution log table
CREATE TABLE IF NOT EXISTS "workflow_runs" (
  "id"             uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id"      uuid NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "workflow_id"    uuid REFERENCES "workflows"("id") ON DELETE set null,
  "workflow_name"  text NOT NULL,
  "status"         text DEFAULT 'success' NOT NULL,
  "trigger_type"   text,
  "contact_phone"  text,
  "error"          text,
  "duration_ms"    integer,
  "started_at"     timestamp with time zone DEFAULT now() NOT NULL,
  "finished_at"    timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_runs_tenant_wf_idx"  ON "workflow_runs"("tenant_id", "workflow_id", "started_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_runs_tenant_ts_idx"  ON "workflow_runs"("tenant_id", "started_at" DESC);
--> statement-breakpoint
ALTER TABLE "workflow_runs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workflow_runs_tenant" ON "workflow_runs"
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
