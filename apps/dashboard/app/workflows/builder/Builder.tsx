"use client";

import { useCallback, useMemo, useState, useEffect, useRef } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  Handle,
  Position,
  useNodesState,
  useEdgesState,
  useReactFlow,
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
import {
  IconMessage,
  IconCart,
  IconPackage,
  IconSend,
  IconBot,
  IconUser,
  IconChevronLeft,
  IconTrash,
  IconGrip,
} from "../../Icons";

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
  {
    type: "message_received" as TriggerType,
    label: "Customer message",
    Icon: IconMessage,
    desc: "WhatsApp message arrives",
    color: "#7c3aed",
  },
  {
    type: "order_created" as TriggerType,
    label: "New order",
    Icon: IconCart,
    desc: "Shopify order is placed",
    color: "#1d4ed8",
  },
  {
    type: "order_fulfilled" as TriggerType,
    label: "Order shipped",
    Icon: IconPackage,
    desc: "Order is fulfilled",
    color: "#0f766e",
  },
];

const ACTION_DEFS = [
  {
    type: "send_message" as ActionType,
    label: "Send message",
    Icon: IconSend,
    desc: "Send text to customer",
    color: "#065f46",
  },
  {
    type: "ai_reply" as ActionType,
    label: "AI reply",
    Icon: IconBot,
    desc: "Let the AI respond",
    color: "#1e40af",
  },
  {
    type: "handoff" as ActionType,
    label: "Hand off",
    Icon: IconUser,
    desc: "Pass to a human agent",
    color: "#92400e",
  },
];

const ORDER_VARS = ["{{order_number}}", "{{total_price}}", "{{currency}}", "{{tracking_number}}"];
const MSG_VARS = ["{{message}}"];

// ─── Graph ↔ workflow serialisation ──────────────────────────────────────────

function workflowToGraph(wf: ApiWorkflow): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [
    {
      id: "trigger",
      type: "trigger",
      position: { x: 160, y: 60 },
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
      position: { x: 160, y: 60 + 170 * (i + 1) },
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
    style: { stroke: "#cbd5e1", strokeWidth: 2 },
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
  const keywords = td.keywords.split(",").map((k) => k.trim()).filter(Boolean);
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

const NODE_W = 260;

function TriggerNode({ data, selected }: NodeProps) {
  const d = data as TriggerData;
  const def = TRIGGER_DEFS.find((t) => t.type === d.triggerType)!;
  const kws = d.keywords.trim();

  return (
    <div style={{
      width: NODE_W,
      background: "#fff",
      border: `1.5px solid ${selected ? def.color : "#e2e8f0"}`,
      borderRadius: 10,
      boxShadow: selected
        ? `0 0 0 3px ${def.color}26, 0 2px 8px rgba(0,0,0,0.08)`
        : "0 1px 4px rgba(0,0,0,0.07)",
      fontFamily: "system-ui, sans-serif",
    }}>
      {/* drag hint */}
      <div style={{ display: "flex", justifyContent: "center", padding: "4px 0 0", color: "#cbd5e1" }}>
        <IconGrip size={12} />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 14px 10px" }}>
        <div style={{
          width: 36, height: 36, borderRadius: 8, background: def.color,
          display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
        }}>
          <def.Icon size={17} color="#fff" />
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", lineHeight: 1.2 }}>
            Trigger
          </div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#0f172a", lineHeight: 1.3 }}>{def.label}</div>
        </div>
      </div>
      {(kws || d.triggerType === "message_received") && (
        <div style={{
          padding: "0 14px 10px 62px", fontSize: 11.5, color: "#64748b", lineHeight: 1.4,
        }}>
          {d.triggerType === "message_received"
            ? kws
              ? <>Keywords: <b style={{ color: "#334155" }}>{kws}</b> <span style={{ color: "#94a3b8" }}>({d.match})</span></>
              : <span style={{ color: "#94a3b8" }}>Matches every message</span>
            : <span style={{ color: "#94a3b8" }}>{def.desc}</span>}
        </div>
      )}
      <Handle
        type="source"
        position={Position.Bottom}
        style={{ background: def.color, width: 10, height: 10, border: "2px solid #fff" }}
      />
    </div>
  );
}

function ActionNode({ data, selected }: NodeProps) {
  const d = data as ActionData;
  const def = ACTION_DEFS.find((a) => a.type === d.actionType)!;

  return (
    <div style={{
      width: NODE_W,
      background: "#fff",
      border: `1.5px solid ${selected ? def.color : "#e2e8f0"}`,
      borderRadius: 10,
      boxShadow: selected
        ? `0 0 0 3px ${def.color}26, 0 2px 8px rgba(0,0,0,0.08)`
        : "0 1px 4px rgba(0,0,0,0.07)",
      fontFamily: "system-ui, sans-serif",
    }}>
      <Handle
        type="target"
        position={Position.Top}
        style={{ background: def.color, width: 10, height: 10, border: "2px solid #fff" }}
      />
      <div style={{ display: "flex", justifyContent: "center", padding: "4px 0 0", color: "#cbd5e1" }}>
        <IconGrip size={12} />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 14px 10px" }}>
        <div style={{
          width: 36, height: 36, borderRadius: 8, background: def.color,
          display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
        }}>
          <def.Icon size={17} color="#fff" />
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", lineHeight: 1.2 }}>
            Action
          </div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#0f172a", lineHeight: 1.3 }}>{def.label}</div>
        </div>
      </div>
      {d.text && (
        <div style={{ padding: "0 14px 10px 62px", fontSize: 11.5, color: "#64748b", lineHeight: 1.4 }}>
          {d.text.length > 70 ? d.text.slice(0, 70) + "…" : d.text}
        </div>
      )}
      <Handle
        type="source"
        position={Position.Bottom}
        style={{ background: def.color, width: 10, height: 10, border: "2px solid #fff" }}
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
      borderLeft: "1px solid #e2e8f0",
      background: "#f8fafc",
      display: "flex",
      flexDirection: "column",
      fontFamily: "system-ui, sans-serif",
      overflowY: "auto",
    }}>
      <div style={{
        padding: "14px 16px", borderBottom: "1px solid #e2e8f0",
        display: "flex", justifyContent: "space-between", alignItems: "center",
        background: "#fff",
      }}>
        <span style={{ fontWeight: 700, fontSize: 13, color: "#0f172a" }}>
          {isTrigger ? "Configure trigger" : "Configure action"}
        </span>
        {onDelete && (
          <button
            onClick={() => onDelete(node.id)}
            title="Delete block"
            style={{
              background: "transparent", border: "1px solid #fca5a5",
              color: "#ef4444", borderRadius: 6, padding: "3px 8px",
              fontSize: 12, cursor: "pointer", display: "flex", alignItems: "center", gap: 4,
            }}
          >
            <IconTrash size={12} />
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
                    border: `1.5px solid ${d.triggerType === t.type ? t.color : "#e2e8f0"}`,
                    borderRadius: 8, cursor: "pointer",
                    background: d.triggerType === t.type ? `${t.color}0d` : "#fff",
                  }}>
                    <input
                      type="radio"
                      name="triggerType"
                      value={t.type}
                      checked={d.triggerType === t.type}
                      onChange={() => set({ triggerType: t.type })}
                      style={{ accentColor: t.color }}
                      className="nodrag"
                    />
                    <div style={{
                      width: 28, height: 28, borderRadius: 6, background: t.color,
                      display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                    }}>
                      <t.Icon size={14} color="#fff" />
                    </div>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: "#0f172a" }}>{t.label}</div>
                      <div style={{ fontSize: 10, color: "#94a3b8" }}>{t.desc}</div>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {d.triggerType === "message_received" && (
              <>
                <div>
                  <label style={labelStyle}>
                    Keywords <span style={{ fontWeight: 400, color: "#94a3b8" }}>(optional)</span>
                  </label>
                  <input
                    className="nodrag"
                    style={inputStyle}
                    placeholder="envío, tracking — comma-separated"
                    value={d.keywords ?? ""}
                    onChange={(e) => set({ keywords: e.target.value })}
                  />
                  <p style={{ fontSize: 11, color: "#94a3b8", margin: "4px 0 0" }}>
                    Leave empty to match every message.
                  </p>
                </div>

                {(d.keywords ?? "").trim() && (
                  <div>
                    <label style={labelStyle}>Match mode</label>
                    <div style={{ display: "flex", border: "1px solid #e2e8f0", borderRadius: 8, overflow: "hidden" }}>
                      {(["any", "all"] as const).map((m) => (
                        <button
                          key={m}
                          onClick={() => set({ match: m })}
                          className="nodrag"
                          style={{
                            flex: 1, border: "none", padding: "7px 0", fontSize: 12, cursor: "pointer",
                            background: d.match === m ? "#0f172a" : "#fff",
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
                    border: `1.5px solid ${d.actionType === a.type ? a.color : "#e2e8f0"}`,
                    borderRadius: 8, cursor: "pointer",
                    background: d.actionType === a.type ? `${a.color}0d` : "#fff",
                  }}>
                    <input
                      type="radio"
                      name={`actionType-${node.id}`}
                      value={a.type}
                      checked={d.actionType === a.type}
                      onChange={() => set({ actionType: a.type, text: "" })}
                      style={{ accentColor: a.color }}
                      className="nodrag"
                    />
                    <div style={{
                      width: 28, height: 28, borderRadius: 6, background: a.color,
                      display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                    }}>
                      <a.Icon size={14} color="#fff" />
                    </div>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: "#0f172a" }}>{a.label}</div>
                      <div style={{ fontSize: 10, color: "#94a3b8" }}>{a.desc}</div>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {(d.actionType === "send_message" || d.actionType === "handoff") && (
              <div>
                <label style={labelStyle}>
                  {d.actionType === "handoff" ? "Message before handoff" : "Message text"}
                  {d.actionType === "handoff" && (
                    <span style={{ fontWeight: 400, color: "#94a3b8" }}> (optional)</span>
                  )}
                </label>
                <textarea
                  className="nodrag"
                  style={textareaStyle}
                  rows={4}
                  placeholder={d.actionType === "handoff" ? "e.g. Connecting you with an agent…" : "Your message…"}
                  value={d.text ?? ""}
                  onChange={(e) => set({ text: e.target.value })}
                />
                {vars.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
                    <span style={{ fontSize: 11, color: "#94a3b8", alignSelf: "center" }}>Insert:</span>
                    {vars.map((v) => (
                      <button
                        key={v}
                        className="nodrag"
                        onClick={() => set({ text: (d.text ?? "") + v })}
                        style={{
                          background: "#f0fdf4", color: "#15803d",
                          border: "1px solid #bbf7d0", borderRadius: 5,
                          padding: "2px 6px", fontSize: 11, cursor: "pointer", fontFamily: "monospace",
                        }}
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
                <label style={labelStyle}>
                  Extra instructions <span style={{ fontWeight: 400, color: "#94a3b8" }}>(optional)</span>
                </label>
                <textarea
                  className="nodrag"
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
  onAddNode,
}: {
  onAddNode: (kind: "trigger" | "action", type: TriggerType | ActionType) => void;
}) {
  const onDragStart = (e: React.DragEvent, kind: string, type: string) => {
    e.dataTransfer.setData("nodeKind", kind);
    e.dataTransfer.setData("nodeType", type);
    e.dataTransfer.effectAllowed = "move";
  };

  return (
    <div style={{
      width: 196,
      borderRight: "1px solid #e2e8f0",
      background: "#f8fafc",
      padding: "14px 10px",
      overflowY: "auto",
      fontFamily: "system-ui, sans-serif",
      flexShrink: 0,
      userSelect: "none",
    }}>
      <div style={sectionLabel}>Triggers</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 5, marginBottom: 18 }}>
        {TRIGGER_DEFS.map((t) => (
          <div
            key={t.type}
            draggable
            onDragStart={(e) => onDragStart(e, "trigger", t.type)}
            onClick={() => onAddNode("trigger", t.type)}
            style={paletteItem}
            onMouseEnter={(e) => (e.currentTarget.style.borderColor = t.color)}
            onMouseLeave={(e) => (e.currentTarget.style.borderColor = "#e2e8f0")}
            title={`Drag or click to add: ${t.label}`}
          >
            <div style={{
              width: 28, height: 28, borderRadius: 6, background: t.color,
              display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
            }}>
              <t.Icon size={14} color="#fff" />
            </div>
            <div>
              <div style={{ fontSize: 11.5, fontWeight: 600, color: "#0f172a" }}>{t.label}</div>
              <div style={{ fontSize: 10, color: "#94a3b8" }}>Trigger</div>
            </div>
          </div>
        ))}
      </div>

      <div style={sectionLabel}>Actions</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        {ACTION_DEFS.map((a) => (
          <div
            key={a.type}
            draggable
            onDragStart={(e) => onDragStart(e, "action", a.type)}
            onClick={() => onAddNode("action", a.type)}
            style={paletteItem}
            onMouseEnter={(e) => (e.currentTarget.style.borderColor = a.color)}
            onMouseLeave={(e) => (e.currentTarget.style.borderColor = "#e2e8f0")}
            title={`Drag or click to add: ${a.label}`}
          >
            <div style={{
              width: 28, height: 28, borderRadius: 6, background: a.color,
              display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
            }}>
              <a.Icon size={14} color="#fff" />
            </div>
            <div>
              <div style={{ fontSize: 11.5, fontWeight: 600, color: "#0f172a" }}>{a.label}</div>
              <div style={{ fontSize: 10, color: "#94a3b8" }}>Action</div>
            </div>
          </div>
        ))}
      </div>

      <div style={{
        marginTop: 20, padding: "9px 10px", background: "#f1f5f9",
        borderRadius: 7, fontSize: 10.5, color: "#64748b", lineHeight: 1.5,
      }}>
        Drag blocks onto the canvas, or click to append.
        Connect them by dragging the <b>●</b> handles.
      </div>
    </div>
  );
}

// ─── Shared styles ────────────────────────────────────────────────────────────

const labelStyle: React.CSSProperties = {
  display: "block", fontSize: 10.5, fontWeight: 700, color: "#374151",
  textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6,
};
const inputStyle: React.CSSProperties = {
  width: "100%", border: "1px solid #e2e8f0", borderRadius: 7,
  padding: "7px 10px", fontSize: 13, boxSizing: "border-box", outline: "none",
  background: "#fff",
};
const textareaStyle: React.CSSProperties = {
  width: "100%", border: "1px solid #e2e8f0", borderRadius: 7, padding: "7px 10px",
  fontSize: 13, boxSizing: "border-box", resize: "vertical", outline: "none",
  background: "#fff",
};
const sectionLabel: React.CSSProperties = {
  fontSize: 9.5, fontWeight: 700, color: "#94a3b8",
  textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6,
};
const paletteItem: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 8, padding: "7px 9px",
  background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8,
  cursor: "grab", transition: "border-color 0.12s",
};

// ─── ID counter ───────────────────────────────────────────────────────────────

let nodeSeq = 1;
const nextId = () => `action-${Date.now()}-${nodeSeq++}`;

// ─── Inner builder (needs ReactFlow context) ──────────────────────────────────

function BuilderInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const editId = searchParams.get("id");
  const { screenToFlowPosition } = useReactFlow();
  const canvasRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    if (!editId) {
      setNodes([{
        id: "trigger",
        type: "trigger",
        position: { x: 160, y: 60 },
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
        addEdge({
          ...params,
          type: "smoothstep",
          markerEnd: { type: MarkerType.ArrowClosed, color: "#94a3b8" },
          style: { stroke: "#cbd5e1", strokeWidth: 2 },
        }, eds),
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

  // Add a node — either at a specific position (drag-drop) or appended below last node
  const addNode = useCallback((kind: "trigger" | "action", type: TriggerType | ActionType, position?: { x: number; y: number }) => {
    if (kind === "trigger") {
      setNodes((ns) =>
        ns.map((n) =>
          n.type === "trigger" ? { ...n, data: { ...n.data, triggerType: type } } : n,
        ),
      );
      setSelectedId("trigger");
      return;
    }

    const id = nextId();
    const pos = position ?? (() => {
      const maxY = nodes.reduce((m, n) => Math.max(m, n.position.y), 0);
      return { x: 160, y: maxY + 170 };
    })();

    setNodes((ns) => [...ns, {
      id,
      type: "action",
      position: pos,
      data: { actionType: type as ActionType, text: "" } satisfies ActionData,
    }]);
    setSelectedId(id);
  }, [nodes, setNodes]);

  // Drop from palette
  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const kind = e.dataTransfer.getData("nodeKind") as "trigger" | "action";
    const type = e.dataTransfer.getData("nodeType") as TriggerType | ActionType;
    if (!kind || !type) return;

    const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    addNode(kind, type, kind === "action" ? position : undefined);
  }, [screenToFlowPosition, addNode]);

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);

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
    <div style={{ position: "fixed", inset: 0, zIndex: 50, background: "#fff", display: "flex", flexDirection: "column", fontFamily: "system-ui, sans-serif" }}>
      {/* Top bar */}
      <div style={{
        height: 52, display: "flex", alignItems: "center", gap: 12,
        padding: "0 18px", borderBottom: "1px solid #e2e8f0",
        background: "#fff", flexShrink: 0,
      }}>
        <a
          href="/workflows"
          style={{
            color: "#64748b", textDecoration: "none", fontSize: 13,
            display: "flex", alignItems: "center", gap: 4,
          }}
        >
          <IconChevronLeft size={14} />
          Workflows
        </a>
        <div style={{ width: 1, height: 18, background: "#e2e8f0" }} />
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={{
            border: "none", outline: "none", fontSize: 14,
            fontWeight: 600, color: "#0f172a", flex: 1, background: "transparent",
          }}
          placeholder="Workflow name…"
        />
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#374151", cursor: "pointer" }}>
          <span
            style={{
              display: "inline-block", width: 32, height: 18, borderRadius: 9,
              background: enabled ? "#22c55e" : "#cbd5e1", position: "relative", cursor: "pointer",
              transition: "background 0.15s",
            }}
            onClick={() => setEnabled((v) => !v)}
          >
            <span style={{
              position: "absolute", top: 2, left: enabled ? 16 : 2, width: 14, height: 14,
              borderRadius: "50%", background: "#fff", transition: "left 0.15s",
              boxShadow: "0 1px 2px rgba(0,0,0,0.2)",
            }} />
          </span>
          {enabled ? "Active" : "Paused"}
        </label>
        <button
          onClick={save}
          disabled={saving}
          style={{
            background: "#0f172a", color: "#fff", border: "none",
            borderRadius: 8, padding: "6px 16px", fontSize: 13, fontWeight: 600,
            cursor: saving ? "not-allowed" : "pointer", opacity: saving ? 0.6 : 1,
          }}
        >
          {saving ? "Saving…" : editId ? "Save changes" : "Create workflow"}
        </button>
      </div>

      {/* Canvas area */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        <Palette onAddNode={addNode} />

        <div
          ref={canvasRef}
          style={{ flex: 1, position: "relative" }}
          onDrop={onDrop}
          onDragOver={onDragOver}
        >
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_, node) => setSelectedId(node.id)}
            onPaneClick={() => setSelectedId(null)}
            nodesDraggable
            fitView
            fitViewOptions={{ padding: 0.35 }}
            deleteKeyCode="Delete"
            proOptions={{ hideAttribution: false }}
          >
            <Background color="#e2e8f0" gap={24} size={1} />
            <Controls />
          </ReactFlow>

          {nodes.length <= 1 && (
            <div style={{
              position: "absolute", bottom: 72, left: "50%", transform: "translateX(-50%)",
              background: "rgba(255,255,255,0.95)", border: "1px dashed #cbd5e1", borderRadius: 10,
              padding: "10px 18px", fontSize: 12.5, color: "#64748b", pointerEvents: "none",
              textAlign: "center", backdropFilter: "blur(4px)", maxWidth: 300,
              whiteSpace: "nowrap",
            }}>
              Drag or click an action from the left panel to add it
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
          position: "fixed", bottom: "1.5rem", right: "1.5rem", zIndex: 200,
          background: toast.err ? "#ef4444" : "#0f172a", color: "#fff",
          padding: "10px 16px", borderRadius: 8, fontSize: 13,
          boxShadow: "0 4px 12px rgba(0,0,0,0.2)",
        }}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}

// ─── Public export — wraps inner component with ReactFlowProvider ─────────────

export default function Builder() {
  return (
    <ReactFlowProvider>
      <BuilderInner />
    </ReactFlowProvider>
  );
}
