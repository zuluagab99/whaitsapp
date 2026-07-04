"use client";

import { useEffect, useState } from "react";

interface ModelRoute { provider: "anthropic" | "openai"; model: string }
interface LlmSettings { conversation?: ModelRoute; routing?: ModelRoute }

interface CatalogEntry {
  provider: "anthropic" | "openai";
  model: string;
  label: string;
  tiers: string[];
}

const TIERS = [
  {
    key: "conversation" as const,
    label: "Thinking model",
    description: "Handles customer replies on WhatsApp. Pick quality over speed — the customer is waiting.",
  },
  {
    key: "routing" as const,
    label: "Routing model",
    description: "Internal classification: intent detection, keyword matching. Cheap and fast.",
  },
];

const PROVIDER_LABELS: Record<string, string> = { anthropic: "Anthropic", openai: "OpenAI" };

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: "0.7rem", fontWeight: 700, color: "var(--text-3)",
      textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6,
    }}>
      {children}
    </div>
  );
}

export default function BrainPage() {
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [settings, setSettings] = useState<LlmSettings>({});
  const [status, setStatus] = useState<string>("loading…");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/admin/llm")
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json()).error ?? r.statusText);
        return r.json();
      })
      .then((d) => {
        setCatalog(d.models ?? []);
        setSettings(d.settings ?? {});
        setStatus("");
      })
      .catch((e) => setStatus(`Error: ${e.message}`));
  }, []);

  const save = async () => {
    setSaving(true);
    setStatus("saving…");
    try {
      const r = await fetch("/api/admin/llm", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(settings),
      });
      if (!r.ok) throw new Error((await r.json()).error ?? r.statusText);
      setStatus("saved ✓");
      setTimeout(() => setStatus(""), 2500);
    } catch (e) {
      setStatus(`Error: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const activeConv = settings.conversation;
  const activeRouting = settings.routing;

  return (
    <div style={{ maxWidth: 680 }}>
      {/* Header */}
      <div style={{ marginBottom: "2rem" }}>
        <h1 style={{ margin: "0 0 4px", fontSize: "1.25rem", fontWeight: 700 }}>Brain</h1>
        <p style={{ margin: 0, color: "var(--text-2)", fontSize: "0.9rem" }}>
          The models that power the AI agent. Changes apply to the next message — no redeploy.
        </p>
      </div>

      {status && (
        <div style={{
          marginBottom: "1.5rem", padding: "10px 14px", borderRadius: 8, fontSize: "0.85rem",
          background: status.startsWith("Error") ? "#fee2e2" : status === "saved ✓" ? "#dcfce7" : "var(--surface)",
          color: status.startsWith("Error") ? "var(--red)" : status === "saved ✓" ? "#166534" : "var(--text-2)",
          border: `1px solid ${status.startsWith("Error") ? "#fca5a5" : status === "saved ✓" ? "#86efac" : "var(--border)"}`,
        }}>
          {status}
        </div>
      )}

      {/* Current config summary */}
      {(activeConv || activeRouting) && (
        <div style={{
          border: "1px solid var(--border)", borderRadius: 12, padding: "1rem 1.25rem",
          marginBottom: "1.5rem", background: "var(--surface)",
          display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem",
        }}>
          <div>
            <Eyebrow>Thinking now</Eyebrow>
            <div style={{ fontFamily: "monospace", fontSize: "0.85rem", color: "var(--text)", fontWeight: 600 }}>
              {activeConv?.model ?? "platform default"}
            </div>
            <div style={{ fontSize: "0.75rem", color: "var(--text-3)", marginTop: 2 }}>
              {activeConv ? PROVIDER_LABELS[activeConv.provider] : "claude-opus-4-8 · Anthropic"}
            </div>
          </div>
          <div>
            <Eyebrow>Routing now</Eyebrow>
            <div style={{ fontFamily: "monospace", fontSize: "0.85rem", color: "var(--text)", fontWeight: 600 }}>
              {activeRouting?.model ?? "platform default"}
            </div>
            <div style={{ fontSize: "0.75rem", color: "var(--text-3)", marginTop: 2 }}>
              {activeRouting ? PROVIDER_LABELS[activeRouting.provider] : "claude-haiku-4-5 · Anthropic"}
            </div>
          </div>
        </div>
      )}

      {/* Tier selectors */}
      {TIERS.map(({ key, label, description }) => {
        const options = catalog.filter((m) => m.tiers.includes(key));
        const current = settings[key];
        const currentVal = current ? `${current.provider}:${current.model}` : "";

        return (
          <div key={key} style={{ marginBottom: "1.5rem" }}>
            <div style={{
              border: "1px solid var(--border)", borderRadius: 12,
              overflow: "hidden", background: "var(--bg)",
            }}>
              <div style={{
                padding: "12px 16px", borderBottom: "1px solid var(--border)",
                background: "var(--surface)",
              }}>
                <div style={{ fontWeight: 600, fontSize: "0.9rem", color: "var(--text)", marginBottom: 2 }}>
                  {label}
                </div>
                <div style={{ fontSize: "0.8rem", color: "var(--text-2)" }}>{description}</div>
              </div>

              <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
                {/* Platform default option */}
                <label style={optionStyle(currentVal === "")}>
                  <input
                    type="radio"
                    name={key}
                    value=""
                    checked={currentVal === ""}
                    onChange={() => setSettings((s) => { const n = { ...s }; delete n[key]; return n; })}
                    style={{ accentColor: "var(--accent)" }}
                  />
                  <div>
                    <div style={{ fontWeight: 600, fontSize: "0.85rem", color: "var(--text)" }}>
                      Platform default
                    </div>
                    <div style={{ fontFamily: "monospace", fontSize: "0.75rem", color: "var(--text-3)" }}>
                      {key === "conversation" ? "claude-opus-4-8 · Anthropic" : "claude-haiku-4-5 · Anthropic"}
                    </div>
                  </div>
                </label>

                {options.map((m) => {
                  const val = `${m.provider}:${m.model}`;
                  return (
                    <label key={val} style={optionStyle(currentVal === val)}>
                      <input
                        type="radio"
                        name={key}
                        value={val}
                        checked={currentVal === val}
                        onChange={() =>
                          setSettings((s) => ({ ...s, [key]: { provider: m.provider, model: m.model } }))
                        }
                        style={{ accentColor: "var(--accent)" }}
                      />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600, fontSize: "0.85rem", color: "var(--text)" }}>
                          {m.label}
                        </div>
                        <div style={{ fontFamily: "monospace", fontSize: "0.75rem", color: "var(--text-3)" }}>
                          {m.model} · {PROVIDER_LABELS[m.provider] ?? m.provider}
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })}

      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button
          onClick={save}
          disabled={saving}
          style={{
            background: "var(--accent)", color: "#fff", border: "none",
            borderRadius: 8, padding: "0.55rem 1.25rem", fontSize: "0.9rem",
            fontWeight: 600, cursor: saving ? "not-allowed" : "pointer",
            opacity: saving ? 0.6 : 1,
          }}
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <p style={{ fontSize: "0.8rem", color: "var(--text-3)", margin: 0 }}>
          Stored in <code style={{ fontFamily: "monospace" }}>tenants.settings.llm</code> — resolved per message by the worker.
        </p>
      </div>
    </div>
  );
}

const optionStyle = (active: boolean): React.CSSProperties => ({
  display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 12px",
  border: `2px solid ${active ? "var(--accent)" : "var(--border)"}`,
  borderRadius: 8, cursor: "pointer",
  background: active ? "#f8fafc" : "var(--bg)",
});
