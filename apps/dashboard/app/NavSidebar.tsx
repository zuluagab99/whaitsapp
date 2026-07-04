"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { IconHome, IconMessage, IconZap, IconCpu } from "./Icons";

const NAV = [
  { href: "/", icon: IconHome, label: "Dashboard", exact: true },
  { href: "/conversations", icon: IconMessage, label: "Conversations", soon: true },
  { href: "/workflows", icon: IconZap, label: "Workflows" },
  { href: "/brain", icon: IconCpu, label: "Brain" },
];

export default function NavSidebar() {
  const path = usePathname();

  const isActive = (href: string, exact?: boolean) =>
    exact ? path === href : path === href || path.startsWith(href + "/");

  return (
    <aside style={{
      width: 200,
      flexShrink: 0,
      height: "100vh",
      borderRight: "1px solid var(--border)",
      background: "var(--bg)",
      display: "flex",
      flexDirection: "column",
      position: "sticky",
      top: 0,
    }}>
      <div style={{ padding: "20px 16px 12px", borderBottom: "1px solid var(--border)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 8,
            background: "var(--accent)", color: "#fff",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 16, fontWeight: 700, flexShrink: 0,
          }}>
            W
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", lineHeight: 1.2 }}>Whaitsapp</div>
            <div style={{ fontSize: 10, color: "var(--text-3)", lineHeight: 1.2 }}>AI Sales Agent</div>
          </div>
        </div>
      </div>

      <nav style={{ padding: "12px 10px", flex: 1 }}>
        {NAV.map(({ href, icon: Icon, label, exact, soon }) => {
          const active = !soon && isActive(href, exact);
          const itemStyle: React.CSSProperties = {
            display: "flex", alignItems: "center", gap: 10,
            padding: "8px 10px", borderRadius: 8, marginBottom: 2,
            fontSize: 14,
            background: active ? "var(--accent)" : "transparent",
            color: active ? "#fff" : soon ? "var(--text-3)" : "var(--text-2)",
            fontWeight: active ? 600 : 400,
            opacity: soon ? 0.45 : 1,
            cursor: soon ? "not-allowed" : "pointer",
            transition: "background 0.1s, color 0.1s",
            textDecoration: "none",
          };

          return soon ? (
            <div key={href} title={`${label} — Phase 2`} style={itemStyle}>
              <Icon size={16} />
              <span>{label}</span>
            </div>
          ) : (
            <Link key={href} href={href} style={itemStyle}>
              <Icon size={16} />
              <span>{label}</span>
            </Link>
          );
        })}
      </nav>

      <div style={{ padding: "12px 16px", borderTop: "1px solid var(--border)" }}>
        <div style={{ fontSize: 11, color: "var(--text-3)", fontFamily: "monospace" }}>
          v0.1.0 · dev
        </div>
      </div>
    </aside>
  );
}
