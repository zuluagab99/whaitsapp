"use client";

import { useEffect, useState } from "react";

interface CatalogEntry {
  provider: "anthropic" | "openai";
  model: string;
  label: string;
  tiers: string[];
}

interface Route {
  provider: string;
  model: string;
}

interface LlmSettings {
  conversation?: Route;
  routing?: Route;
}

const TIERS = [
  { key: "conversation" as const, title: "Conversation model", help: "Answers customers on WhatsApp — pick your quality/cost tradeoff." },
  { key: "routing" as const, title: "Routing model", help: "Cheap internal classification tasks." },
];

export default function LlmSettingsPage() {
  const [models, setModels] = useState<CatalogEntry[]>([]);
  const [settings, setSettings] = useState<LlmSettings>({});
  const [status, setStatus] = useState<string>("loading…");

  useEffect(() => {
    fetch("/api/admin/llm")
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json()).error ?? r.statusText);
        return r.json();
      })
      .then((data) => {
        setModels(data.models);
        setSettings(data.settings ?? {});
        setStatus("");
      })
      .catch((e) => setStatus(String(e.message ?? e)));
  }, []);

  const save = async () => {
    setStatus("saving…");
    const res = await fetch("/api/admin/llm", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(settings),
    });
    setStatus(res.ok ? "saved ✓" : `error: ${(await res.json()).error ?? res.statusText}`);
  };

  return (
    <main style={{ maxWidth: 640, margin: "10vh auto", padding: "0 1rem" }}>
      <h1>AI model</h1>
      <p>
        Choose which LLM powers your bot. Changes apply to the next message — no redeploy, no code.
      </p>
      {TIERS.map(({ key, title, help }) => {
        const options = models.filter((m) => m.tiers.includes(key));
        const current = settings[key];
        const value = current ? `${current.provider}:${current.model}` : "";
        return (
          <section key={key} style={{ margin: "1.5rem 0" }}>
            <h3 style={{ marginBottom: 4 }}>{title}</h3>
            <p style={{ marginTop: 0, fontSize: "0.9em", color: "#666" }}>{help}</p>
            <select
              value={value}
              onChange={(e) => {
                const v = e.target.value;
                setSettings((s) => {
                  const next = { ...s };
                  if (!v) delete next[key];
                  else {
                    const [provider, ...rest] = v.split(":");
                    next[key] = { provider: provider as string, model: rest.join(":") };
                  }
                  return next;
                });
              }}
              style={{ padding: "0.4rem", minWidth: 320 }}
            >
              <option value="">Platform default</option>
              {options.map((m) => (
                <option key={`${m.provider}:${m.model}`} value={`${m.provider}:${m.model}`}>
                  {m.label} — {m.provider}
                </option>
              ))}
            </select>
          </section>
        );
      })}
      <button onClick={save} style={{ padding: "0.5rem 1.25rem" }}>
        Save
      </button>
      <span style={{ marginLeft: 12 }}>{status}</span>
      <p style={{ marginTop: "2rem" }}>
        <a href="/">← Back</a>
      </p>
    </main>
  );
}
