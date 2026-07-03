import { Suspense } from "react";
import Builder from "./Builder";

export default function BuilderPage() {
  return (
    <Suspense fallback={<div style={{ padding: "2rem", fontFamily: "system-ui" }}>Loading builder…</div>}>
      <Builder />
    </Suspense>
  );
}
