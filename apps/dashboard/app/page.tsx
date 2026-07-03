export default function Home() {
  return (
    <main style={{ maxWidth: 640, margin: "10vh auto", padding: "0 1rem" }}>
      <h1>Whaitsapp</h1>
      <p>
        Multi-tenant AI sales agent for WhatsApp + Shopify. The merchant dashboard (onboarding,
        conversation viewer, human takeover, analytics, template manager) lands in Phase 1–4 of the
        roadmap — this is the Phase 0 skeleton.
      </p>
      <ul>
        <li>Connect Shopify — OAuth install flow (Phase 3)</li>
        <li>Connect WhatsApp — Meta Embedded Signup (Phase 4)</li>
        <li>Conversations — live viewer + takeover (Phase 2)</li>
        <li>Recovered revenue — attribution analytics (Phase 4)</li>
      </ul>
    </main>
  );
}
