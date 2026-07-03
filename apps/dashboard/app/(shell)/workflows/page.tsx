"use client";

import { useEffect, useReducer, useState } from "react";

// ─── Types ───────────────────────────────────────────────────────────────────

type TriggerType = "message_received" | "order_created" | "order_fulfilled";
type ActionType = "send_message" | "ai_reply" | "handoff";

interface Trigger {
  type: TriggerType;
  keywords?: string[];
  match?: "any" | "all";
}

interface Action {
  type: ActionType;
  text?: string;
  instructions?: string;
}

interface Workflow {
  id: string;
  name: string;
  enabled: boolean;
  trigger: Trigger;
  actions: Action[];
}

// ─── Editor state ─────────────────────��─────────────────��─────────────────────

interface EditorState {
  name: string;
  triggerType: TriggerType;
  keywords: string; // comma-separated raw input
  match: "any" | "all";
  actions: Action[];
}

type EditorAction =
  | { type: "set_name"; value: string }
  | { type: "set_trigger"; value: TriggerType }
  | { type: "set_keywords"; value: string }
  | { type: "set_match"; value: "any" | "all" }
  | { type: "add_action" }
  | { type: "remove_action"; index: number }
  | { type: "set_action_type"; index: number; value: ActionType }
  | { type: "set_action_text"; index: number; value: string }
  | { type: "reset"; value: EditorState };

const defaultAction = (): Action => ({ type: "send_message", text: "" });

function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case "set_name":
      return { ...state, name: action.value };
    case "set_trigger": {
      const isOrder = action.value !== "message_received";
      return {
        ...state,
        triggerType: action.value,
        // handoff/ai_reply don't make sense on order triggers — reset those actions
        actions: state.actions.map((a) =>
          isOrder && a.type !== "send_message" ? { type: "send_message", text: a.text ?? "" } : a,
        ),
      };
    }
    case "set_keywords":
      return { ...state, keywords: action.value };
    case "set_match":
      return { ...state, match: action.value };
    case "add_action":
      if (state.actions.length >= 5) return state;
      return { ...state, actions: [...state.actions, defaultAction()] };
    case "remove_action":
      return { ...state, actions: state.actions.filter((_, i) => i !== action.index) };
    case "set_action_type":
      return {
        ...state,
        actions: state.actions.map((a, i) =>
          i === action.index ? { type: action.value } : a,
        ),
      };
    case "set_action_text":
      return {
        ...state,
        actions: state.actions.map((a, i) => {
          if (i !== action.index) return a;
          if (a.type === "ai_reply") return { ...a, instructions: action.value };
          return { ...a, text: action.value };
        }),
      };
    case "reset":
      return action.value;
  }
}

function workflowToEditor(wf: Workflow): EditorState {
  return {
    name: wf.name,
    triggerType: wf.trigger.type,
    keywords: wf.trigger.keywords?.join(", ") ?? "",
    match: wf.trigger.match ?? "any",
    actions: wf.actions.length ? wf.actions : [defaultAction()],
  };
}

const emptyEditor = (): EditorState => ({
  name: "",
  triggerType: "message_received",
  keywords: "",
  match: "any",
  actions: [defaultAction()],
});

// ─── Serialise editor → API payload ──────────────���───────────────────────────

function editorToPayload(state: EditorState, enabled: boolean) {
  const isMessage = state.triggerType === "message_received";
  const keywords = state.keywords
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
  const trigger: Trigger = isMessage
    ? { type: "message_received", ...(keywords.length ? { keywords, match: state.match } : {}) }
    : { type: state.triggerType };
  const actions = state.actions
    .map((a): Action | null => {
      if (a.type === "send_message") return a.text?.trim() ? a : null;
      if (a.type === "ai_reply") return { type: "ai_reply", ...(a.instructions?.trim() ? { instructions: a.instructions } : {}) };
      if (a.type === "handoff") return { type: "handoff", ...(a.text?.trim() ? { text: a.text } : {}) };
      return null;
    })
    .filter((a): a is Action => a !== null);
  return { name: state.name.trim(), enabled, trigger, actions };
}

function isValid(state: EditorState): boolean {
  if (!state.name.trim()) return false;
  const validActions = state.actions.filter((a) => {
    if (a.type === "send_message") return !!a.text?.trim();
    return true; // ai_reply + handoff can have no text
  });
  return validActions.length > 0;
}

// ─── Constants ───────────────────��─────────────────────��──────────────────────

const TRIGGER_OPTIONS: { value: TriggerType; label: string; icon: string; description: string }[] = [
  { value: "message_received", label: "Customer message", icon: "💬", description: "Fires when a WhatsApp message arrives" },
  { value: "order_created", label: "New order", icon: "🛒", description: "Fires when a Shopify order is placed" },
  { value: "order_fulfilled", label: "Order shipped", icon: "📦", description: "Fires when an order is fulfilled" },
];

const ACTION_OPTIONS: { value: ActionType; label: string; icon: string }[] = [
  { value: "send_message", label: "Send a message", icon: "✉️" },
  { value: "ai_reply", label: "AI reply", icon: "🤖" },
  { value: "handoff", label: "Hand off to human", icon: "🙋" },
];

const ORDER_VARS = ["{{order_number}}", "{{total_price}}", "{{currency}}", "{{tracking_number}}", "{{tracking_url}}"];
const MESSAGE_VARS = ["{{message}}"];

// ─── Styles ─────────────��─────────────────────────────────────────────────────

const s = {
  page: { maxWidth: 800, margin: "0 auto", padding: "2rem 1.5rem", fontFamily: "system-ui, sans-serif" } as React.CSSProperties,
  header: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.5rem" } as React.CSSProperties,
  h1: { fontSize: "1.5rem", fontWeight: 700, margin: 0 } as React.CSSProperties,
  subtitle: { color: "#6b7280", fontSize: "0.9rem", marginBottom: "2rem" } as React.CSSProperties,
  btnPrimary: { background: "#111", color: "#fff", border: "none", borderRadius: 8, padding: "0.55rem 1.1rem", fontSize: "0.9rem", cursor: "pointer", fontWeight: 600 } as React.CSSProperties,
  btnSecondary: { background: "transparent", color: "#374151", border: "1px solid #d1d5db", borderRadius: 8, padding: "0.5rem 1rem", fontSize: "0.9rem", cursor: "pointer" } as React.CSSProperties,
  btnDanger: { background: "transparent", color: "#ef4444", border: "1px solid #fca5a5", borderRadius: 6, padding: "0.3rem 0.7rem", fontSize: "0.8rem", cursor: "pointer" } as React.CSSProperties,
  btnGhost: { background: "transparent", border: "none", cursor: "pointer", color: "#6b7280", fontSize: "0.85rem", padding: "0.25rem 0.5rem" } as React.CSSProperties,
  card: { border: "1px solid #e5e7eb", borderRadius: 12, padding: "1rem 1.25rem", marginBottom: "0.75rem", background: "#fff" } as React.CSSProperties,
  cardDisabled: { border: "1px solid #e5e7eb", borderRadius: 12, padding: "1rem 1.25rem", marginBottom: "0.75rem", background: "#f9fafb", opacity: 0.7 } as React.CSSProperties,
  cardRow: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "1rem" } as React.CSSProperties,
  wfName: { fontWeight: 600, fontSize: "1rem", color: "#111" } as React.CSSProperties,
  wfMeta: { fontSize: "0.85rem", color: "#6b7280", marginTop: "0.25rem" } as React.CSSProperties,
  actionRow: { display: "flex", gap: "0.5rem", marginTop: "0.5rem", flexWrap: "wrap" as const },
  chip: { background: "#f3f4f6", borderRadius: 6, padding: "0.2rem 0.6rem", fontSize: "0.8rem", color: "#374151" } as React.CSSProperties,
  chipBlue: { background: "#eff6ff", borderRadius: 6, padding: "0.2rem 0.6rem", fontSize: "0.8rem", color: "#1d4ed8" } as React.CSSProperties,
  toggle: { position: "relative" as const, display: "inline-flex", alignItems: "center", cursor: "pointer", gap: 8, fontSize: "0.85rem", color: "#374151" },
  divider: { border: "none", borderTop: "1px solid #f3f4f6", margin: "1rem 0" } as React.CSSProperties,

  // panel
  overlay: { position: "fixed" as const, inset: 0, background: "rgba(0,0,0,0.35)", zIndex: 40, display: "flex", justifyContent: "flex-end" },
  panel: { background: "#fff", width: "min(560px, 100vw)", height: "100vh", overflowY: "auto" as const, boxShadow: "-4px 0 24px rgba(0,0,0,0.12)", display: "flex", flexDirection: "column" as const },
  panelHeader: { padding: "1.25rem 1.5rem", borderBottom: "1px solid #e5e7eb", display: "flex", justifyContent: "space-between", alignItems: "center" } as React.CSSProperties,
  panelBody: { padding: "1.5rem", flex: 1, display: "flex", flexDirection: "column" as const, gap: "1.5rem" },
  panelFooter: { padding: "1rem 1.5rem", borderTop: "1px solid #e5e7eb", display: "flex", gap: "0.75rem", justifyContent: "flex-end" } as React.CSSProperties,

  // form
  label: { display: "block", fontSize: "0.8rem", fontWeight: 600, color: "#374151", marginBottom: "0.35rem", textTransform: "uppercase" as const, letterSpacing: "0.04em" },
  input: { width: "100%", border: "1px solid #d1d5db", borderRadius: 8, padding: "0.55rem 0.75rem", fontSize: "0.95rem", boxSizing: "border-box" as const, outline: "none" },
  textarea: { width: "100%", border: "1px solid #d1d5db", borderRadius: 8, padding: "0.55rem 0.75rem", fontSize: "0.9rem", boxSizing: "border-box" as const, resize: "vertical" as const, outline: "none", minHeight: 80 },
  select: { width: "100%", border: "1px solid #d1d5db", borderRadius: 8, padding: "0.55rem 0.75rem", fontSize: "0.95rem", background: "#fff", outline: "none" },
  segmented: { display: "flex", border: "1px solid #d1d5db", borderRadius: 8, overflow: "hidden" } as React.CSSProperties,
  segBtn: (active: boolean): React.CSSProperties => ({
    flex: 1, border: "none", padding: "0.45rem 0.75rem", fontSize: "0.85rem", cursor: "pointer",
    background: active ? "#111" : "#fff", color: active ? "#fff" : "#374151", fontWeight: active ? 600 : 400,
  }),

  // trigger cards
  triggerGrid: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.6rem" } as React.CSSProperties,
  triggerCard: (active: boolean): React.CSSProperties => ({
    border: `2px solid ${active ? "#111" : "#e5e7eb"}`, borderRadius: 10, padding: "0.75rem",
    cursor: "pointer", background: active ? "#f8fafc" : "#fff", transition: "border-color 0.15s",
  }),

  // action item
  actionItem: { border: "1px solid #e5e7eb", borderRadius: 10, padding: "0.9rem 1rem", background: "#fafafa" } as React.CSSProperties,
  actionHeader: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.6rem" } as React.CSSProperties,

  // hints
  hints: { display: "flex", flexWrap: "wrap" as const, gap: "0.35rem", marginTop: "0.4rem" },
  hintChip: { background: "#f0fdf4", color: "#15803d", border: "1px solid #bbf7d0", borderRadius: 6, padding: "0.15rem 0.5rem", fontSize: "0.75rem", cursor: "pointer", fontFamily: "monospace" } as React.CSSProperties,

  empty: { textAlign: "center" as const, color: "#9ca3af", padding: "3rem 0", fontSize: "0.95rem" },
  toast: { position: "fixed" as const, bottom: "1.5rem", right: "1.5rem", background: "#111", color: "#fff", padding: "0.6rem 1.1rem", borderRadius: 8, fontSize: "0.9rem", zIndex: 100, boxShadow: "0 4px 12px rgba(0,0,0,0.2)" },
  errToast: { position: "fixed" as const, bottom: "1.5rem", right: "1.5rem", background: "#ef4444", color: "#fff", padding: "0.6rem 1.1rem", borderRadius: 8, fontSize: "0.9rem", zIndex: 100, boxShadow: "0 4px 12px rgba(0,0,0,0.2)" },
};

// ─── Sub-components ────────────────────────────────��──────────────────────────

function Toggle({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <label style={s.toggle} onClick={(e) => { e.stopPropagation(); onChange(); }}>
      <span style={{
        display: "inline-block", width: 36, height: 20, borderRadius: 10,
        background: checked ? "#22c55e" : "#d1d5db", position: "relative", transition: "background 0.2s",
      }}>
        <span style={{
          position: "absolute", top: 2, left: checked ? 18 : 2, width: 16, height: 16,
          borderRadius: "50%", background: "#fff", transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
        }} />
      </span>
      {checked ? "Active" : "Paused"}
    </label>
  );
}

function TriggerSummary({ trigger }: { trigger: Trigger }) {
  const opt = TRIGGER_OPTIONS.find((o) => o.value === trigger.type)!;
  const kwds = trigger.keywords ?? [];
  return (
    <span>
      {opt.icon} {opt.label}
      {kwds.length > 0 && (
        <span style={{ color: "#4b5563" }}>
          {" "}— keywords {trigger.match === "all" ? "(all)" : "(any)"}:{" "}
          {kwds.map((k) => <code key={k} style={{ background: "#f3f4f6", padding: "0 4px", borderRadius: 4, fontSize: "0.8em" }}>{k}</code>).reduce<React.ReactNode[]>((acc, el, i) => [...acc, i > 0 ? ", " : "", el], [])}
        </span>
      )}
    </span>
  );
}

function ActionChip({ action }: { action: Action }) {
  const opt = ACTION_OPTIONS.find((o) => o.value === action.type)!;
  return (
    <span style={s.chip}>
      {opt.icon} {opt.label}
      {action.type === "send_message" && action.text && (
        <span style={{ color: "#9ca3af" }}> — "{action.text.slice(0, 40)}{action.text.length > 40 ? "…" : ""}"</span>
      )}
    </span>
  );
}

// ─── Action editor ──────────────────────���───────────────────────��─────────────

function ActionEditor({
  action, index, total, isOrderTrigger, vars,
  dispatch,
}: {
  action: Action;
  index: number;
  total: number;
  isOrderTrigger: boolean;
  vars: string[];
  dispatch: React.Dispatch<EditorAction>;
}) {
  const textVal = action.type === "ai_reply" ? (action.instructions ?? "") : (action.text ?? "");
  const placeholder =
    action.type === "ai_reply"
      ? "Extra instructions for the AI (e.g. always upsell the subscription plan)"
      : action.type === "handoff"
        ? "Optional message to send before handing off (e.g. Connecting you with a human agent…)"
        : vars.length
          ? `Your message — use ${vars.slice(0, 2).join(", ")} etc.`
          : "Your message text";

  return (
    <div style={{ ...s.actionItem, opacity: 1 }}>
      <div style={s.actionHeader}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <span style={{ fontSize: "0.75rem", fontWeight: 600, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Action {index + 1}
          </span>
          <select
            value={action.type}
            style={{ ...s.select, width: "auto", padding: "0.3rem 0.6rem", fontSize: "0.85rem" }}
            onChange={(e) => dispatch({ type: "set_action_type", index, value: e.target.value as ActionType })}
          >
            {ACTION_OPTIONS.filter(({ value }) => !isOrderTrigger || value === "send_message").map(({ value, label, icon }) => (
              <option key={value} value={value}>{icon} {label}</option>
            ))}
          </select>
        </div>
        {total > 1 && (
          <button style={s.btnGhost} onClick={() => dispatch({ type: "remove_action", index })} title="Remove action">
            ✕
          </button>
        )}
      </div>

      {action.type !== "ai_reply" || true ? (
        <>
          <textarea
            style={s.textarea}
            rows={3}
            placeholder={placeholder}
            value={textVal}
            onChange={(e) => dispatch({ type: "set_action_text", index, value: e.target.value })}
          />
          {vars.length > 0 && (
            <div style={s.hints}>
              <span style={{ fontSize: "0.75rem", color: "#9ca3af", alignSelf: "center" }}>Insert:</span>
              {vars.map((v) => (
                <button
                  key={v}
                  style={s.hintChip}
                  onClick={() => dispatch({ type: "set_action_text", index, value: textVal + v })}
                >
                  {v}
                </button>
              ))}
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}

// ─── Editor panel ────────────────��────────────────────────────────────────────

function EditorPanel({
  editing,
  onSave,
  onClose,
  saving,
}: {
  editing: { workflow: Workflow | null };
  onSave: (state: EditorState, enabled: boolean) => Promise<void>;
  onClose: () => void;
  saving: boolean;
}) {
  const [state, dispatch] = useReducer(
    editorReducer,
    null,
    () => editing.workflow ? workflowToEditor(editing.workflow) : emptyEditor(),
  );
  const [enabled, setEnabled] = useState(editing.workflow?.enabled ?? true);

  const isOrderTrigger = state.triggerType !== "message_received";
  const vars = isOrderTrigger ? ORDER_VARS : MESSAGE_VARS;

  return (
    <div style={s.overlay} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={s.panel}>
        <div style={s.panelHeader}>
          <h2 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 700 }}>
            {editing.workflow ? "Edit workflow" : "New workflow"}
          </h2>
          <button style={s.btnGhost} onClick={onClose}>✕</button>
        </div>

        <div style={s.panelBody}>
          {/* Name */}
          <div>
            <label style={s.label}>Workflow name</label>
            <input
              style={s.input}
              placeholder="e.g. FAQ shipping, Order confirmation"
              value={state.name}
              onChange={(e) => dispatch({ type: "set_name", value: e.target.value })}
              autoFocus
            />
          </div>

          {/* Trigger */}
          <div>
            <label style={s.label}>When this happens</label>
            <div style={s.triggerGrid}>
              {TRIGGER_OPTIONS.map((opt) => (
                <div
                  key={opt.value}
                  style={s.triggerCard(state.triggerType === opt.value)}
                  onClick={() => dispatch({ type: "set_trigger", value: opt.value })}
                >
                  <div style={{ fontSize: "1.5rem", marginBottom: "0.3rem" }}>{opt.icon}</div>
                  <div style={{ fontSize: "0.85rem", fontWeight: 600 }}>{opt.label}</div>
                  <div style={{ fontSize: "0.75rem", color: "#9ca3af", marginTop: 2 }}>{opt.description}</div>
                </div>
              ))}
            </div>

            {!isOrderTrigger && (
              <div style={{ marginTop: "0.75rem" }}>
                <label style={{ ...s.label, marginBottom: "0.5rem" }}>Keywords (optional)</label>
                <input
                  style={s.input}
                  placeholder="envío, tracking, devolución — leave empty to match every message"
                  value={state.keywords}
                  onChange={(e) => dispatch({ type: "set_keywords", value: e.target.value })}
                />
                {state.keywords.trim() && (
                  <div style={{ marginTop: "0.5rem" }}>
                    <label style={{ ...s.label, marginBottom: "0.35rem" }}>Match mode</label>
                    <div style={s.segmented}>
                      <button style={s.segBtn(state.match === "any")} onClick={() => dispatch({ type: "set_match", value: "any" })}>
                        Any keyword
                      </button>
                      <button style={s.segBtn(state.match === "all")} onClick={() => dispatch({ type: "set_match", value: "all" })}>
                        All keywords
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Actions */}
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.5rem" }}>
              <label style={{ ...s.label, margin: 0 }}>Then do these actions</label>
              {state.actions.length < 5 && (
                <button style={{ ...s.btnSecondary, fontSize: "0.8rem", padding: "0.3rem 0.7rem" }} onClick={() => dispatch({ type: "add_action" })}>
                  + Add action
                </button>
              )}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
              {state.actions.map((action, i) => (
                <ActionEditor
                  key={i}
                  action={action}
                  index={i}
                  total={state.actions.length}
                  isOrderTrigger={isOrderTrigger}
                  vars={vars}
                  dispatch={dispatch}
                />
              ))}
            </div>
            <p style={{ fontSize: "0.8rem", color: "#9ca3af", marginTop: "0.5rem" }}>
              Actions run in order. First matching workflow wins — others are skipped.
            </p>
          </div>

          {editing.workflow && (
            <div>
              <label style={s.label}>Status</label>
              <Toggle checked={enabled} onChange={() => setEnabled((v) => !v)} />
            </div>
          )}
        </div>

        <div style={s.panelFooter}>
          <button style={s.btnSecondary} onClick={onClose} disabled={saving}>Cancel</button>
          <button
            style={{ ...s.btnPrimary, opacity: isValid(state) && !saving ? 1 : 0.5 }}
            disabled={!isValid(state) || saving}
            onClick={() => onSave(state, enabled)}
          >
            {saving ? "Saving…" : editing.workflow ? "Save changes" : "Create workflow"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main page ───────────────────────────────────────────────��────────────────

export default function WorkflowsPage() {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [panelTarget] = useState<{ workflow: Workflow | null } | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ msg: string; error?: boolean } | null>(null);

  const showToast = (msg: string, error = false) => {
    setToast({ msg, error });
    setTimeout(() => setToast(null), 3000);
  };

  const load = async () => {
    try {
      const r = await fetch("/api/admin/workflows");
      if (!r.ok) throw new Error((await r.json()).error ?? r.statusText);
      const d = await r.json();
      setWorkflows(d.workflows);
    } catch (e) {
      showToast(String((e as Error).message ?? e), true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const handleSave = async (state: EditorState, enabled: boolean) => {
    setSaving(true);
    try {
      const payload = editorToPayload(state, enabled);
      const editing = panelTarget?.workflow;
      const url = editing ? `/api/admin/workflows/${editing.id}` : "/api/admin/workflows";
      const method = editing ? "PUT" : "POST";
      const r = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      if (!r.ok) throw new Error((await r.json()).error ?? r.statusText);
      setPanelTarget(null);
      await load();
      showToast(editing ? "Workflow saved" : "Workflow created");
    } catch (e) {
      showToast(String((e as Error).message ?? e), true);
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (wf: Workflow) => {
    try {
      const r = await fetch(`/api/admin/workflows/${wf.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...wf, id: undefined, enabled: !wf.enabled }),
      });
      if (!r.ok) throw new Error((await r.json()).error ?? r.statusText);
      await load();
    } catch (e) {
      showToast(String((e as Error).message ?? e), true);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this workflow?")) return;
    try {
      await fetch(`/api/admin/workflows/${id}`, { method: "DELETE" });
      await load();
      showToast("Workflow deleted");
    } catch (e) {
      showToast(String((e as Error).message ?? e), true);
    }
  };

  return (
    <main style={s.page}>
      <div style={s.header}>
        <h1 style={s.h1}>Workflows</h1>
        <a href="/workflows/builder" style={{ ...s.btnPrimary, textDecoration: "none" }}>
          + New workflow
        </a>
      </div>
      <p style={s.subtitle}>
        Automate replies without code. When a trigger fires, the first matching workflow runs its actions in order.
        Order messages still respect the 24-hour window and opt-in rules.
      </p>

      {loading && <p style={{ color: "#9ca3af" }}>Loading…</p>}

      {!loading && workflows.length === 0 && (
        <div style={s.empty}>
          <div style={{ fontSize: "2.5rem", marginBottom: "0.75rem" }}>⚡</div>
          <div style={{ fontWeight: 600, marginBottom: "0.25rem" }}>No workflows yet</div>
          <div>Create your first workflow to automate customer replies and order messages.</div>
          <a href="/workflows/builder" style={{ ...s.btnPrimary, marginTop: "1.25rem", textDecoration: "none", display: "inline-block" }}>
            Create your first workflow
          </a>
        </div>
      )}

      {workflows.map((wf) => (
        <div key={wf.id} style={wf.enabled ? s.card : s.cardDisabled}>
          <div style={s.cardRow}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={s.wfName}>{wf.name}</div>
              <div style={s.wfMeta}>
                <TriggerSummary trigger={wf.trigger} />
              </div>
              <div style={s.actionRow}>
                {wf.actions.map((a, i) => <ActionChip key={i} action={a} />)}
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "0.5rem", flexShrink: 0 }}>
              <Toggle checked={wf.enabled} onChange={() => handleToggle(wf)} />
              <div style={{ display: "flex", gap: "0.4rem" }}>
                <a href={`/workflows/builder?id=${wf.id}`} style={{ ...s.btnSecondary, textDecoration: "none" }}>Edit</a>
                <button style={s.btnDanger} onClick={() => handleDelete(wf.id)}>Delete</button>
              </div>
            </div>
          </div>
        </div>
      ))}

      {workflows.length > 0 && (
        <p style={{ fontSize: "0.8rem", color: "#9ca3af", textAlign: "center", marginTop: "0.5rem" }}>
          Workflows are evaluated top-to-bottom by creation date — first match wins.
        </p>
      )}

      <p style={{ marginTop: "2rem" }}><a href="/" style={{ color: "#6b7280", fontSize: "0.9rem" }}>← Back</a></p>

      {panelTarget && (
        <EditorPanel
          editing={panelTarget}
          onSave={handleSave}
          onClose={() => setPanelTarget(null)}
          saving={saving}
        />
      )}

      {toast && <div style={toast.error ? s.errToast : s.toast}>{toast.msg}</div>}
    </main>
  );
}
