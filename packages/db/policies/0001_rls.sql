-- Row-Level Security: defense-in-depth against cross-tenant leaks.
-- The app sets `app.tenant_id` per transaction (see tenantTransaction).
-- current_setting(..., true) returns NULL when unset, so a connection that
-- never set a tenant sees no tenant-owned rows at all.
--
-- IMPORTANT: the runtime application role must not own these tables and must
-- not have BYPASSRLS. FORCE ROW LEVEL SECURITY additionally applies policies
-- to the owner, protecting dev/test setups that connect as the owner.

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'users', 'channels', 'shopify_stores', 'contacts', 'conversations',
    'messages', 'products', 'product_embeddings', 'kb_documents', 'carts',
    'orders_cache', 'message_templates', 'usage_events'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    -- NULLIF guards the cast: after a SET LOCAL transaction ends, the GUC
    -- resets to '' on that pooled connection, and ''::uuid would error.
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid)',
      t
    );
  END LOOP;
END $$;
