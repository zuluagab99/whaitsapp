"use client";

import { useCallback, useMemo, useState, useEffect, useRef } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  useNodesState,
  useEdgesState,
  addEdge,
  MarkerType,
  type Node,
  type Edge,
  type Connection,
  type NodeProps,
  type OnConnect,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useSearchParams, useRouter } from "next/navigation";

// ─── Domain types ─────────────────────────────────────────────────────────────

type TriggerType = "message_received" | "order_created" | "order_fulfilled";
type ActionType = "send_message" | "ai_reply" | "handoff";

interface TriggerData extends Record<string, unknown> {
  triggerType: TriggerType;
  keywords: string;
  match: "any" | "all";
}

interface ActionData extends Record<string, unknown> {
  actionType: ActionType;
  text: string;
}

interface ApiWorkflow {
  id: string;
  name: string;
  enabled: boolean;
  trigger: { type: string; keywords?: string[]; match?: string };
  actions: Array<{ type: string; text?: string; instructions?: string }>;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const TRIGGER_DEFS = [
  { type: "message_received" as TriggerType, label: "Customer message", icon: "💬", desc: "WhatsApp message arrives" },
  { type: "order_created" as TriggerType, label: "New order", icon: "🛒", desc: "Shopify order is placed" },
  { type: "order_fulfilled" as TriggerType, label: "Order shipped", icon: "📦", desc: "Order is fulfilled" },
];

const ACTION_DEFS = [
  { type: "send_message" as ActionType, label: "Send message", icon: "✉️", desc: "Send text to customer" },
  { type: "ai_reply" as ActionType, label: "AI reply", icon: "🤖", desc: "Let the AI respond" },
  { type: "handoff" as ActionType, label: "Hand off", icon: "🙋", desc: "Pass to a human agent" },
];

const ORDER_VARS = ["{{order_number}}", "{{total_price}}", "{{currency}}", "{{tracking_number}}"];
const MSG_VARS = ["{{message}}"];

const TRIGGER_COLORS: Record<TriggerType, string> = {
  message_received: "#6d28d9",
  order_created: "#1d4ed8",
  order_fulfilled: "#0f766e",
};

const ACTION_COLORS: Record<ActionType, string> = {
  send_message: "#065f46",
  ai_reply: "#1e3a8a",
  handoff: "#92400e",
};

// ─── Graph ↔ workflow serialisation ──────────────────────────────────────────

function workflowToGraph(wf: ApiWorkflow): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [
    {
      id: "trigger",
      type: "trigger",
      position: { x: 180, y: 60 },
      data: {
        triggerType: (wf.trigger.type as TriggerType) ?? "message_received",
        keywords: wf.trigger.keywords?.join(", ") ?? "",
        match: (wf.trigger.match as "any" | "all") ?? "any",
      } satisfies TriggerData,
    },
  ];

  wf.actions.forEach((action, i) => {
    nodes.push({
      id: `action-${i}`,
      type: "action",
      position: { x: 180, y: 60 + 160 * (i + 1) },
      data: {
        actionType: action.type as ActionType,
        text: action.type === "ai_reply" ? (action.instructions ?? "") : (action.text ?? ""),
      } satisfies ActionData,
    });
  });

  const edges: Edge[] = [];
  for (let i = -1; i < wf.actions.length - 1; i++) {
    const src = i === -1 ? "trigger" : `action-${i}`;
    const tgt = i === -1 ? "action-0" : `action-${i + 1}`;
    if (!nodes.find((n) => n.id === tgt)) break;
    edges.push(makeEdge(src, tgt));
  }

  return { nodes, edges };
}

function makeEdge(source: string, target: string): Edge {
  return {
    id: `${source}→${target}`,
    source,
    target,
    type: "smoothstep",
    markerEnd: { type: MarkerType.ArrowClosed, color: "#94a3b8" },
    style: { stroke: "#94a3b8", strokeWidth: 2 },
  };
}

function graphToPayload(
  name: string,
  enabled: boolean,
  nodes: Node[],
  edges: Edge[],
): object | null {
  const triggerNode = nodes.find((n) => n.type === "trigger");
  if (!triggerNode) return null;

  // Walk the chain from trigger
  const actionIds: string[] = [];
  let cur = triggerNode.id;
  const seen = new Set<string>();
  while (true) {
    seen.add(cur);
    const edge = edges.find((e) => e.source === cur);
    if (!edge || seen.has(edge.target)) break;
    actionIds.push(edge.target);
    cur = edge.target;
  }

  const td = triggerNode.data as TriggerData;
  const isOrder = td.triggerType !== "message_received";
  const keywords = td.keywords
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
  const trigger = isOrder
    ? { type: td.triggerType }
    : { type: "message_received", ...(keywords.length ? { keywords, match: td.match } : {}) };

  const actions = actionIds
    .map((id) => {
      const node = nodes.find((n) => n.id === id);
      if (!node) return null;
      const d = node.data as ActionData;
      if (d.actionType === "send_message") return d.text.trim() ? { type: "send_message", text: d.text } : null;
      if (d.actionType === "ai_reply") return { type: "ai_reply", ...(d.text.trim() ? { instructions: d.text } : {}) };
      if (d.actionType === "handoff") return { type: "handoff", ...(d.text.trim() ? { text: d.text } : {}) };
      return null;
    })
    .filter(Boolean);

  if (actions.length === 0) return null;
  return { name, enabled, trigger, actions };
}

// ─── Custom nodes ─────────────────────────────────────────────────────────────

const NODE_W = 220;

function TriggerNode({ data, selected }: NodeProps) {
  const d = data as TriggerData;
  const def = TRIGGER_DEFS.find((t) => t.type === d.triggerType)!;
  const color = TRIGGER_COLORS[d.triggerType];
  const kws = d.keywords.trim();

  return (
    <div style={{
      width: NODE_W,
      borderRadius: 10,
      border: `2px solid ${selected ? "#f59e0b" : color}`,
      boxShadow: selected ? `0 0 0 3px ${color}33` : "0 2px 8px rgba(0,0,0,0.12)",
      background: "#fff",
      fontFamily: "system-ui, sans-serif",
      overflow: "hidden",
    }}>
      <div style={{ background: color, padding: "8px 12px", display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 16 }}>{def.icon}</span>
        <div>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.7)", textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 600 }}>Trigger</div>
          <div style={{ fontSize: 13, color: "#fff", fontWeight: 600 }}>{def.label}</div>
        </div>
      </div>
      <div style={{ padding: "8px 12px", minHeight: 28, fontSize: 12, color: "#6b7280" }}>
        {d.triggerType === "message_received"
          ? kws
            ? <span>Keywords: <b style={{ color: "#374151" }}>{kws}</b> <span style={{ color: "#9ca3af" }}>({d.match})</span></span>
            : <span style={{ color: "#9ca3af" }}>Matches every message</span>
          : <span style={{ color: "#9ca3af" }}>{def.desc}</span>}
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        style={{ background: color, width: 10, height: 10, border: "2px solid #fff" }}
      />
    </div>
  );
}

function ActionNode({ data, selected }: NodeProps) {
  const d = data as ActionData;
  const def = ACTION_DEFS.find((a) => a.type === d.actionType)!;
  const color = ACTION_COLORS[d.actionType];

  return (
    <div style={{
      width: NODE_W,
      borderRadius: 10,
      border: `2px solid ${selected ? "#f59e0b" : color}`,
      boxShadow: selected ? `0 0 0 3px ${color}33` : "0 2px 8px rgba(0,0,0,0.12)",
      background: "#fff",
      fontFamily: "system-ui, sans-serif",
      overflow: "hidden",
    }}>
      <Handle
        type="target"
        position={Position.Top}
        style={{ background: color, width: 10, height: 10, border: "2px solid #fff" }}
      />
      <div style={{ background: color, padding: "8px 12px", display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 16 }}>{def.icon}</span>
        <div>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.7)", textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 600 }}>Action</div>
          <div style={{ fontSize: 13, color: "#fff", fontWeight: 600 }}>{def.label}</div>
        </div>
      </div>
      <div style={{ padding: "8px 12px", minHeight: 28, fontSize: 12, color: "#6b7280" }}>
        {d.text
          ? <span style={{ color: "#374151" }}>{d.text.length > 60 ? d.text.slice(0, 60) + "…" : d.text}</span>
          : <span style={{ color: "#d1d5db", fontStyle: "italic" }}>No content yet — configure on the right</span>}
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        style={{ background: color, width: 10, height: 10, border: "2px solid #fff" }}
      />
    </div>
  );
}

const nodeTypes = { trigger: TriggerNode, action: ActionNode };

// ─── Config panel ─────────────────────────────────────────────────────────────

function ConfigPanel({
  node,
  onUpdate,
  onDelete,
}: {
  node: Node;
  onUpdate: (id: string, data: Record<string, unknown>) => void;
  onDelete: ((id: string) => void) | null;
}) {
  const isTrigger = node.type === "trigger";
  const d = node.data as TriggerData & ActionData;
  const isOrder = d.triggerType !== "message_received";
  const vars = isOrder ? ORDER_VARS : MSG_VARS;

  const set = (patch: Record<string, unknown>) => onUpdate(node.id, { ...node.data, ...patch });

  return (
    <div style={{
      width: 280,
      borderLeft: "1px solid #e5e7eb",
      background: "#fafafa",
      display: "flex",
      flexDirection: "column",
      fontFamily: "system-ui, sans-serif",
      overflowY: "auto",
    }}>
      <div style={{ padding: "14px 16px", borderBottom: "1px solid #e5e7eb", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontWeight: 700, fontSize: 14, color: "#111" }}>
          {isTrigger ? "Configure trigger" : "Configure action"}
        </span>
        {onDelete && (
          <button
            onClick={() => onDelete(node.id)}
            style={{ background: "transparent", border: "1px solid #fca5a5", color: "#ef4444", borderRadius: 6, padding: "3px 8px", fontSize: 12, cursor: "pointer" }}
          >
            Delete
          </button>
        )}
      </div>

      <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 16 }}>
        {isTrigger ? (
          <>
            <div>
              <label style={labelStyle}>Trigger type</label>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {TRIGGER_DEFS.map((t) => (
                  <label key={t.type} style={{
                    display: "flex", alignItems: "center", gap: 10, padding: "8px 10px",
                    border: `2px solid ${d.triggerType === t.type ? TRIGGER_COLORS[t.type] : "#e5e7eb"}`,
                    borderRadius: 8, cursor: "pointer", background: d.triggerType === t.type ? `${TRIGGER_COLORS[t.type]}0d` : "#fff",
                  }}>
                    <input
                      type="radio"
                      name="triggerType"
                      value={t.type}
                      checked={d.triggerType === t.type}
                      onChange={() => set({ triggerType: t.type })}
                      style={{ accentColor: TRIGGER_COLORS[t.type] }}
                    />
                    <span style={{ fontSize: 18 }}>{t.icon}</span>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "#111" }}>{t.label}</div>
                      <div style={{ fontSize: 11, color: "#9ca3af" }}>{t.desc}</div>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {d.triggerType === "message_received" && (
              <>
                <div>
                  <label style={labelStyle}>Keywords <span style={{ fontWeight: 400, color: "#9ca3af" }}>(optional)</span></label>
                  <input
                    style={inputStyle}
                    placeholder="envío, tracking — comma-separated"
                    value={d.keywords ?? ""}
                    onChange={(e) => set({ keywords: e.target.value })}
                  />
                  <p style={{ fontSize: 11, color: "#9ca3af", margin: "4px 0 0" }}>Leave empty to match every message.</p>
                </div>

                {(d.keywords ?? "").trim() && (
                  <div>
                    <label style={labelStyle}>Match mode</label>
                    <div style={{ display: "flex", border: "1px solid #d1d5db", borderRadius: 8, overflow: "hidden" }}>
                      {(["any", "all"] as const).map((m) => (
                        <button
                          key={m}
                          onClick={() => set({ match: m })}
                          style={{
                            flex: 1, border: "none", padding: "7px 0", fontSize: 13, cursor: "pointer",
                            background: d.match === m ? "#111" : "#fff",
                            color: d.match === m ? "#fff" : "#374151",
                            fontWeight: d.match === m ? 600 : 400,
                          }}
                        >
                          {m === "any" ? "Any keyword" : "All keywords"}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </>
        ) : (
          <>
            <div>
              <label style={labelStyle}>Action type</label>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {ACTION_DEFS.filter((a) => !isOrder || a.type === "send_message").map((a) => (
                  <label key={a.type} style={{
                    display: "flex", alignItems: "center", gap: 10, padding: "8px 10px",
                    border: `2px solid ${d.actionType === a.type ? ACTION_COLORS[a.type] : "#e5e7eb"}`,
                    borderRadius: 8, cursor: "pointer", background: d.actionType === a.type ? `${ACTION_COLORS[a.type]}0d` : "#fff",
                  }}>
                    <input
                      type="radio"
                      name={`actionType-${node.id}`}
                      value={a.type}
                      checked={d.actionType === a.type}
                      onChange={() => set({ actionType: a.type, text: "" })}
                      style={{ accentColor: ACTION_COLORS[a.type] }}
                    />
                    <span style={{ fontSize: 18 }}>{a.icon}</span>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "#111" }}>{a.label}</div>
                      <div style={{ fontSize: 11, color: "#9ca3af" }}>{a.desc}</div>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {(d.actionType === "send_message" || d.actionType === "handoff") && (
              <div>
                <label style={labelStyle}>
                  {d.actionType === "handoff" ? "Message before handoff" : "Message text"}
                  {d.actionType === "handoff" && <span style={{ fontWeight: 400, color: "#9ca3af" }}> (optional)</span>}
                </label>
                <textarea
                  style={textareaStyle}
                  rows={4}
                  placeholder={d.actionType === "handoff" ? "e.g. Connecting you with a human agent…" : "Your message…"}
                  value={d.text ?? ""}
                  onChange={(e) => set({ text: e.target.value })}
                />
                {vars.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
                    <span style={{ fontSize: 11, color: "#9ca3af", alignSelf: "center" }}>Insert:</span>
                    {vars.map((v) => (
                      <button
                        key={v}
                        onClick={() => set({ text: (d.text ?? "") + v })}
                        style={{ background: "#f0fdf4", color: "#15803d", border: "1px solid #bbf7d0", borderRadius: 5, padding: "2px 6px", fontSize: 11, cursor: "pointer", fontFamily: "monospace" }}
                      >
                        {v}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {d.actionType === "ai_reply" && (
              <div>
                <label style={labelStyle}>Extra instructions <span style={{ fontWeight: 400, color: "#9ca3af" }}>(optional)</span></label>
                <textarea
                  style={textareaStyle}
                  rows={4}
                  placeholder="e.g. Always suggest the Premium plan when asked about pricing"
                  value={d.text ?? ""}
                  onChange={(e) => set({ text: e.target.value })}
                />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Left palette ─────────────────────────────────────────────────────────────

function Palette({
  onSetTrigger,
  onAddAction,
}: {
  onSetTrigger: (type: TriggerType) => void;
  onAddAction: (type: ActionType) => void;
}) {
  return (
    <div style={{
      width: 200,
      borderRight: "1px solid #e5e7eb",
      background: "#f8fafc",
      padding: "16px 12px",
      overflowY: "auto",
      fontFamily: "system-ui, sans-serif",
    }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8 }}>Triggers</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 20 }}>
        {TRIGGER_DEFS.map((t) => (
          <button
            key={t.type}
            onClick={() => onSetTrigger(t.type)}
            style={{
              display: "flex", alignItems: "center", gap: 8, padding: "8px 10px",
              background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8,
              cursor: "pointer", textAlign: "left", transition: "border-color 0.15s",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.borderColor = TRIGGER_COLORS[t.type])}
            onMouseLeave={(e) => (e.currentTarget.style.borderColor = "#e5e7eb")}
            title={`Set trigger: ${t.label}`}
          >
            <span style={{ fontSize: 18 }}>{t.icon}</span>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#111" }}>{t.label}</div>
              <div style={{ fontSize: 10, color: "#9ca3af" }}>Set as trigger</div>
            </div>
          </button>
        ))}
      </div>

      <div style={{ fontSize: 10, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8 }}>Actions</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {ACTION_DEFS.map((a) => (
          <button
            key={a.type}
            onClick={() => onAddAction(a.type)}
            style={{
              display: "flex", alignItems: "center", gap: 8, padding: "8px 10px",
              background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8,
              cursor: "pointer", textAlign: "left",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.borderColor = ACTION_COLORS[a.type])}
            onMouseLeave={(e) => (e.currentTarget.style.borderColor = "#e5e7eb")}
            title={`Add action: ${a.label}`}
          >
            <span style={{ fontSize: 18 }}>{a.icon}</span>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#111" }}>{a.label}</div>
              <div style={{ fontSize: 10, color: "#9ca3af" }}>Add to canvas</div>
            </div>
          </button>
        ))}
      </div>

      <div style={{ marginTop: 24, padding: "10px", background: "#f1f5f9", borderRadius: 8, fontSize: 11, color: "#64748b", lineHeight: 1.5 }}>
        <b>Tip:</b> Click a block to add it, then drag the <b>●</b> handles to connect them in order.
      </div>
    </div>
  );
}

// ─── Shared styles ────────────────────────────────────────────────────────────

const labelStyle: React.CSSProperties = {
  display: "block", fontSize: 11, fontWeight: 700, color: "#374151",
  textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6,
};
const inputStyle: React.CSSProperties = {
  width: "100%", border: "1px solid #d1d5db", borderRadius: 7,
  padding: "7px 10px", fontSize: 13, boxSizing: "border-box", outline: "none",
};
const textareaStyle: React.CSSProperties = {
  width: "100%", border: "1px solid #d1d5db", borderRadius: 7, padding: "7px 10px",
  fontSize: 13, boxSizing: "border-box", resize: "vertical", outline: "none",
};

// ─── ID counter ───────────────────────────────────────────────────────────────

let nodeSeq = 1;
const nextId = () => `action-${Date.now()}-${nodeSeq++}`;

// ─── Builder ──────────────────────────────────────────────────────────────────

export default function Builder() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const editId = searchParams.get("id");

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [name, setName] = useState("New workflow");
  const [enabled, setEnabled] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ msg: string; err?: boolean } | null>(null);

  const showToast = (msg: string, err = false) => {
    setToast({ msg, err });
    setTimeout(() => setToast(null), 3000);
  };

  // Seed initial trigger node or load existing workflow
  useEffect(() => {
    if (!editId) {
      setNodes([{
        id: "trigger",
        type: "trigger",
        position: { x: 180, y: 60 },
        data: { triggerType: "message_received", keywords: "", match: "any" } satisfies TriggerData,
      }]);
      return;
    }
    fetch("/api/admin/workflows")
      .then((r) => r.json())
      .then((d) => {
        const wf: ApiWorkflow = d.workflows?.find((w: ApiWorkflow) => w.id === editId);
        if (!wf) { showToast("Workflow not found", true); return; }
        setName(wf.name);
        setEnabled(wf.enabled);
        const { nodes: ns, edges: es } = workflowToGraph(wf);
        setNodes(ns);
        setEdges(es);
      })
      .catch(() => showToast("Failed to load workflow", true));
  }, [editId]);

  const onConnect: OnConnect = useCallback(
    (params: Connection) =>
      setEdges((eds) =>
        addEdge({ ...params, type: "smoothstep", markerEnd: { type: MarkerType.ArrowClosed, color: "#94a3b8" }, style: { stroke: "#94a3b8", strokeWidth: 2 } }, eds),
      ),
    [setEdges],
  );

  const selectedNode = useMemo(() => nodes.find((n) => n.id === selectedId) ?? null, [nodes, selectedId]);

  const updateNodeData = useCallback((id: string, data: Record<string, unknown>) => {
    setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data } : n)));
  }, [setNodes]);

  const deleteNode = useCallback((id: string) => {
    setNodes((ns) => ns.filter((n) => n.id !== id));
    setEdges((es) => es.filter((e) => e.source !== id && e.target !== id));
    setSelectedId(null);
  }, [setNodes, setEdges]);

  const setTriggerType = useCallback((type: TriggerType) => {
    setNodes((ns) =>
      ns.map((n) =>
        n.type === "trigger"
          ? { ...n, data: { ...n.data, triggerType: type } }
          : n,
      ),
    );
    setSelectedId("trigger");
  }, [setNodes]);

  const addAction = useCallback((type: ActionType) => {
    const id = nextId();
    // Find a good Y position: below last node
    const maxY = nodes.reduce((m, n) => Math.max(m, n.position.y), 0);
    const newNode: Node = {
      id,
      type: "action",
      position: { x: 180, y: maxY + 160 },
      data: { actionType: type, text: "" } satisfies ActionData,
    };
    setNodes((ns) => [...ns, newNode]);
    setSelectedId(id);
  }, [nodes, setNodes]);

  const save = async () => {
    const payload = graphToPayload(name, enabled, nodes, edges);
    if (!payload) {
      showToast("Connect at least one action to the trigger before saving.", true);
      return;
    }
    setSaving(true);
    try {
      const url = editId ? `/api/admin/workflows/${editId}` : "/api/admin/workflows";
      const method = editId ? "PUT" : "POST";
      const r = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      if (!r.ok) throw new Error((await r.json()).error ?? r.statusText);
      router.push("/workflows");
    } catch (e) {
      showToast(String((e as Error).message ?? e), true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", fontFamily: "system-ui, sans-serif" }}>
      {/* Top bar */}
      <div style={{
        height: 56, display: "flex", alignItems: "center", gap: 12,
        padding: "0 20px", borderBottom: "1px solid #e5e7eb", background: "#fff", flexShrink: 0,
      }}>
        <a
          href="/workflows"
          style={{ color: "#6b7280", textDecoration: "none", fontSize: 13, display: "flex", alignItems: "center", gap: 4 }}
        >
          ← Workflows
        </a>
        <div style={{ width: 1, height: 20, background: "#e5e7eb" }} />
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={{ border: "none", outline: "none", fontSize: 15, fontWeight: 600, color: "#111", flex: 1, background: "transparent" }}
          placeholder="Workflow name…"
        />
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#374151", cursor: "pointer" }}>
          <span style={{
            display: "inline-block", width: 34, height: 18, borderRadius: 9,
            background: enabled ? "#22c55e" : "#d1d5db", position: "relative", cursor: "pointer",
          }} onClick={() => setEnabled((v) => !v)}>
            <span style={{
              position: "absolute", top: 2, left: enabled ? 18 : 2, width: 14, height: 14,
              borderRadius: "50%", background: "#fff", transition: "left 0.15s", boxShadow: "0 1px 2px rgba(0,0,0,0.2)",
            }} />
          </span>
          {enabled ? "Active" : "Paused"}
        </label>
        <button
          onClick={save}
          disabled={saving}
          style={{ background: "#111", color: "#fff", border: "none", borderRadius: 8, padding: "7px 18px", fontSize: 14, fontWeight: 600, cursor: saving ? "not-allowed" : "pointer", opacity: saving ? 0.6 : 1 }}
        >
          {saving ? "Saving…" : editId ? "Save changes" : "Create workflow"}
        </button>
      </div>

      {/* Canvas area */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        <Palette onSetTrigger={setTriggerType} onAddAction={addAction} />

        <div style={{ flex: 1, position: "relative" }}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_, node) => setSelectedId(node.id)}
            onPaneClick={() => setSelectedId(null)}
            fitView
            fitViewOptions={{ padding: 0.3 }}
            deleteKeyCode="Delete"
          >
            <Background color="#e5e7eb" gap={20} />
            <Controls />
          </ReactFlow>

          {nodes.length <= 1 && (
            <div style={{
              position: "absolute", bottom: 80, left: "50%", transform: "translateX(-50%)",
              background: "rgba(255,255,255,0.95)", border: "1px dashed #d1d5db", borderRadius: 10,
              padding: "12px 20px", fontSize: 13, color: "#6b7280", pointerEvents: "none", textAlign: "center",
              backdropFilter: "blur(4px)", maxWidth: 320,
            }}>
              ← Add action blocks from the palette, then drag the <b>●</b> handle on the trigger down to connect them
            </div>
          )}
        </div>

        {selectedNode && (
          <ConfigPanel
            node={selectedNode}
            onUpdate={updateNodeData}
            onDelete={selectedNode.type !== "trigger" ? deleteNode : null}
          />
        )}
      </div>

      {toast && (
        <div style={{
          position: "fixed", bottom: "1.5rem", right: "1.5rem", zIndex: 100,
          background: toast.err ? "#ef4444" : "#111", color: "#fff",
          padding: "10px 16px", borderRadius: 8, fontSize: 13,
          boxShadow: "0 4px 12px rgba(0,0,0,0.2)",
        }}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}
