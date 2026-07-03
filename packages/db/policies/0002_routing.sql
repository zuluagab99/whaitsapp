-- Webhook routing lookups (phone_number_id → tenant, shop_domain → tenant)
-- happen BEFORE a tenant context exists — they are what establishes it.
-- Rather than weakening tenant isolation, routing is an explicit opt-in:
-- the connection sets app.routing='on' (SET LOCAL, transaction-scoped) and
-- gains SELECT-only access to the two routing tables.

DROP POLICY IF EXISTS routing_lookup ON channels;
CREATE POLICY routing_lookup ON channels
  FOR SELECT
  USING (current_setting('app.routing', true) = 'on');

DROP POLICY IF EXISTS routing_lookup ON shopify_stores;
CREATE POLICY routing_lookup ON shopify_stores
  FOR SELECT
  USING (current_setting('app.routing', true) = 'on');
