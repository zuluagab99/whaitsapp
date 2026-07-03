"use client";

import { useEffect, useState } from "react";

interface Workflow {
  id: string;
  name: string;
  enabled: boolean;
  trigger: { type: string; keywords?: string[]; match?: string };
  actions: Array<{ type: string; text?: string; instructions?: string }>;
}

const TRIGGER_LABELS: Record<string, string> = {
  message_received: "Customer message",
  order_created: "New order",
  order_fulfilled: "Order shipped",
};

const ACTION_LABELS: Record<string, string> = {
  send_message: "Send message",
  ai_reply: "AI reply with extra instructions",
  handoff: "Hand off to a human",
};

const emptyForm = {
  name: "",
  triggerType: "message_received",
  keywords: "",
  actionType: "send_message",
  text: "",
};

export default function WorkflowsPage() {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [status, setStatus] = useState("loading…");

  const load = () =>
    fetch("/api/admin/workflows")
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json()).error ?? r.statusText);
        return r.json();
      })
      .then((d) => {
        setWorkflows(d.workflows);
        setStatus("");
      })
      .catch((e) => setStatus(String(e.message ?? e)));

  useEffect(() => {
    void load();
  }, []);

  const create = async () => {
    const trigger =
      form.triggerType === "message_received"
        ? {
            type: "message_received",
            ...(form.keywords.trim()
              ? { keywords: form.keywords.split(",").map((k) => k.trim()).filter(Boolean) }
              : {}),
          }
        : { type: form.triggerType };
    const action =
      form.actionType === "send_message"
        ? { type: "send_message", text: form.text }
        : form.actionType === "ai_reply"
          ? { type: "ai_reply", ...(form.text ? { instructions: form.text } : {}) }
          : { type: "handoff", ...(form.text ? { text: form.text } : {}) };

    setStatus("saving…");
    const res = await fetch("/api/admin/workflows", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: form.name, enabled: true, trigger, actions: [action] }),
    });
    if (res.ok) {
      setForm(emptyForm);
      await load();
    } else {
      setStatus(`error: ${(await res.json()).error ?? res.statusText}`);
    }
  };

  const toggle = async (wf: Workflow) => {
    await fetch(`/api/admin/workflows/${wf.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...wf, id: undefined, enabled: !wf.enabled }),
    });
    await load();
  };

  const remove = async (id: string) => {
    await fetch(`/api/admin/workflows/${id}`, { method: "DELETE" });
    await load();
  };

  const isOrderTrigger = form.triggerType !== "message_received";

  return (
    <main style={{ maxWidth: 720, margin: "8vh auto", padding: "0 1rem" }}>
      <h1>Workflows</h1>
      <p>
        Automate replies without touching the AI: when a trigger fires, the first matching workflow
        runs its actions. Order messages still respect the 24-hour window and opt-in rules.
      </p>
      <span>{status}</span>

      <ul style={{ listStyle: "none", padding: 0 }}>
        {workflows.map((wf) => (
          <li key={wf.id} style={{ border: "1px solid #ddd", borderRadius: 8, padding: "0.75rem 1rem", margin: "0.5rem 0" }}>
            <strong>{wf.name}</strong> {wf.enabled ? "" : "(paused)"}
            <div style={{ fontSize: "0.9em", color: "#555" }}>
              When: {TRIGGER_LABELS[wf.trigger.type] ?? wf.trigger.type}
              {wf.trigger.keywords?.length ? ` containing “${wf.trigger.keywords.join(", ")}”` : ""}
              {" → "}
              {wf.actions.map((a) => ACTION_LABELS[a.type] ?? a.type).join(", ")}
            </div>
            <div style={{ marginTop: 6 }}>
              <button onClick={() => toggle(wf)}>{wf.enabled ? "Pause" : "Enable"}</button>{" "}
              <button onClick={() => remove(wf.id)}>Delete</button>
            </div>
          </li>
        ))}
      </ul>

      <h2>New workflow</h2>
      <div style={{ display: "grid", gap: "0.6rem", maxWidth: 480 }}>
        <input
          placeholder="Name (e.g. FAQ envíos)"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
        <label>
          When:{" "}
          <select value={form.triggerType} onChange={(e) => setForm({ ...form, triggerType: e.target.value })}>
            {Object.entries(TRIGGER_LABELS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        {!isOrderTrigger && (
          <input
            placeholder="Keywords, comma-separated (empty = every message)"
            value={form.keywords}
            onChange={(e) => setForm({ ...form, keywords: e.target.value })}
          />
        )}
        <label>
          Do:{" "}
          <select value={form.actionType} onChange={(e) => setForm({ ...form, actionType: e.target.value })}>
            {Object.entries(ACTION_LABELS)
              // order events can only send a message — nothing to reply to or hand off
              .filter(([v]) => !isOrderTrigger || v === "send_message")
              .map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
          </select>
        </label>
        <textarea
          rows={3}
          placeholder={
            form.actionType === "ai_reply"
              ? "Extra instructions for the AI (optional)"
              : "Message text — order triggers support {{order_number}}, {{total_price}}, {{currency}}"
          }
          value={form.text}
          onChange={(e) => setForm({ ...form, text: e.target.value })}
        />
        <button onClick={create} disabled={!form.name || (form.actionType === "send_message" && !form.text)}>
          Create workflow
        </button>
      </div>
      <p style={{ marginTop: "2rem" }}>
        <a href="/">← Back</a>
      </p>
    </main>
  );
}
