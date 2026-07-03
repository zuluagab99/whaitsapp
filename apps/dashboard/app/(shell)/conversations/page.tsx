export default function ConversationsPage() {
  return (
    <div style={{ maxWidth: 680 }}>
      <h1 style={{ margin: "0 0 4px", fontSize: "1.25rem", fontWeight: 700 }}>
        💬 Conversations
      </h1>
      <p style={{ margin: "0 0 2rem", color: "var(--text-2)", fontSize: "0.9rem" }}>
        Live conversation viewer, human takeover, and message history.
      </p>

      <div style={{
        border: "1px dashed var(--border)", borderRadius: 12, padding: "3rem",
        textAlign: "center", color: "var(--text-3)",
      }}>
        <div style={{ fontSize: "2.5rem", marginBottom: 12 }}>💬</div>
        <div style={{ fontWeight: 600, fontSize: "0.95rem", color: "var(--text-2)", marginBottom: 8 }}>
          Phase 2 — not yet built
        </div>
        <div style={{ fontSize: "0.85rem", lineHeight: 1.6, maxWidth: 400, margin: "0 auto" }}>
          This screen will show all active WhatsApp conversations in real time. Agents can
          take over from the bot, see the full message history, and hand back to the AI when done.
        </div>
      </div>
    </div>
  );
}
