"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Workflow { id: string; enabled: boolean }
interface ModelRoute { provider: string; model: string }
interface LlmSettings { conversation?: ModelRoute; routing?: ModelRoute }

interface Stats {
  workflows: { total: number; active: number; paused: number } | null;
  brain: LlmSettings | null;
  configured: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DEFAULT_BRAIN: LlmSettings = {
  conversation: { provider: "anthropic", model: "claude-opus-4-8" },
  routing: { provider: "anthropic", model: "claude-haiku-4-5" },
};

const PROVIDER_LABELS: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
};

function StatusDot({ color }: { color: string }) {
  return (
    <span style={{
      display: "inline-block", width: 8, height: 8, borderRadius: "50%",
      background: color, flexShrink: 0,
    }} />
  );
}

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      border: "1px solid var(--border)", borderRadius: 12,
      padding: "1.25rem", background: "var(--bg)", ...style,
    }}>
      {children}
    </div>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: "0.7rem", fontWeight: 700, color: "var(--text-3)",
      textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8,
    }}>
      {children}
    </div>
  );
}

function BigNumber({ n, label }: { n: number; label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
      <span style={{ fontSize: "2rem", fontWeight: 700, color: "var(--text)", lineHeight: 1 }}>{n}</span>
      <span style={{ fontSize: "0.85rem", color: "var(--text-2)" }}>{label}</span>
    </div>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [apiHealth, setApiHealth] = useState<"ok" | "error" | "loading">("loading");

  useEffect(() => {
    // API health
    fetch("http://localhost:3001/health")
      .then((r) => r.ok ? setApiHealth("ok") : setApiHealth("error"))
      .catch(() => setApiHealth("error"));

    // Admin data
    Promise.allSettled([
      fetch("/api/admin/workflows").then((r) => r.json()),
      fetch("/api/admin/llm").then((r) => r.json()),
    ]).then(([wfResult, llmResult]) => {
      const configured = wfResult.status === "fulfilled" && !wfResult.value?.error;

      const workflows = configured && wfResult.status === "fulfilled"
        ? (wfResult.value.workflows as Workflow[])
        : null;

      const brain = llmResult.status === "fulfilled" && !llmResult.value?.error
        ? (llmResult.value.settings as LlmSettings ?? {})
        : null;

      setStats({
        configured,
        workflows: workflows
          ? {
              total: workflows.length,
              active: workflows.filter((w) => w.enabled).length,
              paused: workflows.filter((w) => !w.enabled).length,
            }
          : null,
        brain,
      });
    });
  }, []);

  const brain = stats?.brain ?? DEFAULT_BRAIN;
  const conv = brain.conversation ?? DEFAULT_BRAIN.conversation!;
  const routing = brain.routing ?? DEFAULT_BRAIN.routing!;

  return (
    <div style={{ maxWidth: 860 }}>
      {/* Header */}
      <div style={{ marginBottom: "2rem" }}>
        <h1 style={{ margin: "0 0 4px", fontSize: "1.25rem", fontWeight: 700 }}>Dashboard</h1>
        <p style={{ margin: 0, color: "var(--text-2)", fontSize: "0.9rem" }}>
          What's happening right now.
        </p>
      </div>

      {/* Not configured warning */}
      {stats && !stats.configured && (
        <div style={{
          background: "#fefce8", border: "1px solid #fde047", borderRadius: 10,
          padding: "12px 16px", marginBottom: "1.5rem", fontSize: "0.85rem", color: "#713f12",
        }}>
          <strong>Not configured.</strong> Set <code style={{ fontFamily: "monospace", background: "#fef9c3", padding: "1px 5px", borderRadius: 4 }}>ADMIN_API_TOKEN</code> and{" "}
          <code style={{ fontFamily: "monospace", background: "#fef9c3", padding: "1px 5px", borderRadius: 4 }}>DASHBOARD_TENANT_ID</code> in your <code style={{ fontFamily: "monospace", background: "#fef9c3", padding: "1px 5px", borderRadius: 4 }}>.env</code> to unlock the dashboard.
        </div>
      )}

      {/* Top row: Brain + Workflows + Conversations */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "1rem", marginBottom: "1rem" }}>

        {/* Brain */}
        <Card>
          <Eyebrow>Brain</Eyebrow>
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: "0.75rem", color: "var(--text-3)", marginBottom: 3 }}>Thinking</div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <StatusDot color="var(--green)" />
              <span style={{ fontFamily: "monospace", fontSize: "0.8rem", color: "var(--text)" }}>{conv.model}</span>
            </div>
            <div style={{ fontSize: "0.75rem", color: "var(--text-3)", marginTop: 1 }}>{PROVIDER_LABELS[conv.provider] ?? conv.provider}</div>
          </div>
          <div>
            <div style={{ fontSize: "0.75rem", color: "var(--text-3)", marginBottom: 3 }}>Routing</div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <StatusDot color="var(--green)" />
              <span style={{ fontFamily: "monospace", fontSize: "0.8rem", color: "var(--text)" }}>{routing.model}</span>
            </div>
            <div style={{ fontSize: "0.75rem", color: "var(--text-3)", marginTop: 1 }}>{PROVIDER_LABELS[routing.provider] ?? routing.provider}</div>
          </div>
          <Link
            href="/brain"
            style={{ display: "inline-block", marginTop: 14, fontSize: "0.8rem", color: "var(--blue)", textDecoration: "none" }}
          >
            Configure →
          </Link>
        </Card>

        {/* Workflows */}
        <Card>
          <Eyebrow>Workflows</Eyebrow>
          {stats?.workflows ? (
            <>
              <BigNumber n={stats.workflows.active} label="active" />
              <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
                {stats.workflows.paused > 0 && (
                  <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.8rem", color: "var(--text-2)" }}>
                    <StatusDot color="var(--amber)" />
                    {stats.workflows.paused} paused
                  </div>
                )}
                <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.8rem", color: "var(--text-3)" }}>
                  <StatusDot color="var(--text-3)" />
                  {stats.workflows.total} total
                </div>
              </div>
            </>
          ) : (
            <div style={{ fontSize: "0.85rem", color: "var(--text-3)" }}>—</div>
          )}
          <Link
            href="/workflows"
            style={{ display: "inline-block", marginTop: 14, fontSize: "0.8rem", color: "var(--blue)", textDecoration: "none" }}
          >
            Manage →
          </Link>
        </Card>

        {/* Conversations */}
        <Card style={{ opacity: 0.6 }}>
          <Eyebrow>Conversations</Eyebrow>
          <div style={{ fontSize: "0.85rem", color: "var(--text-2)", lineHeight: 1.5 }}>
            Live viewer, human takeover, and message history.
          </div>
          <div style={{ marginTop: 12, fontSize: "0.75rem", color: "var(--text-3)" }}>
            Phase 2 — not yet built
          </div>
        </Card>
      </div>

      {/* Under the hood */}
      <Card style={{ marginTop: "1.5rem" }}>
        <Eyebrow>Under the hood</Eyebrow>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "1.5rem" }}>

          <div>
            <div style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--text-2)", marginBottom: 6 }}>API</div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
              <StatusDot color={apiHealth === "ok" ? "var(--green)" : apiHealth === "error" ? "var(--red)" : "var(--text-3)"} />
              <span style={{ fontSize: "0.8rem", color: "var(--text)" }}>
                {apiHealth === "ok" ? "online" : apiHealth === "error" ? "unreachable" : "checking…"}
              </span>
            </div>
            <div style={{ fontFamily: "monospace", fontSize: "0.75rem", color: "var(--text-3)" }}>:3001</div>
          </div>

          <div>
            <div style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--text-2)", marginBottom: 6 }}>Database</div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
              <StatusDot color="var(--green)" />
              <span style={{ fontSize: "0.8rem", color: "var(--text)" }}>Postgres</span>
            </div>
            <div style={{ fontFamily: "monospace", fontSize: "0.75rem", color: "var(--text-3)" }}>pgvector · 16 tables</div>
          </div>

          <div>
            <div style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--text-2)", marginBottom: 6 }}>Queue</div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
              <StatusDot color="var(--green)" />
              <span style={{ fontSize: "0.8rem", color: "var(--text)" }}>BullMQ / Redis</span>
            </div>
            <div style={{ fontFamily: "monospace", fontSize: "0.75rem", color: "var(--text-3)" }}>
              inbound · outbound
              <br />
              shopify · recovery
            </div>
          </div>

          <div>
            <div style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--text-2)", marginBottom: 6 }}>Channels</div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
              <StatusDot color="var(--text-3)" />
              <span style={{ fontSize: "0.8rem", color: "var(--text)" }}>Meta Cloud API</span>
            </div>
            <div style={{ fontFamily: "monospace", fontSize: "0.75rem", color: "var(--text-3)" }}>
              v21.0 · Shopify
            </div>
          </div>
        </div>
      </Card>

      {/* Quick actions */}
      <div style={{ marginTop: "1.5rem" }}>
        <div style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>
          Quick actions
        </div>
        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
          <Link href="/workflows/builder" style={quickBtn}>
            + New workflow
          </Link>
          <Link href="/brain" style={quickBtn}>
            Configure Brain
          </Link>
        </div>
      </div>
    </div>
  );
}

const quickBtn: React.CSSProperties = {
  border: "1px solid var(--border)", borderRadius: 8,
  padding: "0.5rem 1rem", fontSize: "0.875rem",
  textDecoration: "none", color: "var(--text)",
  background: "var(--bg)",
};
