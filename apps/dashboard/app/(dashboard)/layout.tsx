import type { ReactNode } from "react";
import NavSidebar from "../NavSidebar";

export default function ShellLayout({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: "flex", height: "100vh", overflow: "hidden" }}>
      <NavSidebar />
      <main style={{ flex: 1, overflowY: "auto", padding: "2rem 2.5rem" }}>
        {children}
      </main>
    </div>
  );
}
