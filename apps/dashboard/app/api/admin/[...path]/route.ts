import { NextRequest, NextResponse } from "next/server";

/**
 * Server-side proxy to the core API's admin routes. The bearer token and the
 * tenant binding stay on the server — the browser only ever talks to this
 * route. DASHBOARD_TENANT_ID pins the session to one tenant until real
 * dashboard auth lands (interim, single-merchant dev setup).
 */
const API_URL = process.env.API_URL ?? "http://localhost:3001";
const TOKEN = process.env.ADMIN_API_TOKEN;
const TENANT_ID = process.env.DASHBOARD_TENANT_ID;

async function proxy(req: NextRequest, path: string[]): Promise<NextResponse> {
  if (!TOKEN || !TENANT_ID) {
    return NextResponse.json(
      { error: "dashboard is not configured: set ADMIN_API_TOKEN and DASHBOARD_TENANT_ID" },
      { status: 503 },
    );
  }
  // /api/admin/models is tenant-independent; everything else is tenant-scoped.
  const target =
    path[0] === "models"
      ? `${API_URL}/admin/models`
      : `${API_URL}/admin/tenants/${TENANT_ID}/${path.join("/")}`;

  const body = req.method === "GET" || req.method === "DELETE" ? undefined : await req.text();
  const res = await fetch(target, {
    method: req.method,
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
    ...(body !== undefined ? { body } : {}),
  });
  const text = await res.text();
  return new NextResponse(text.length ? text : null, {
    status: res.status,
    headers: { "content-type": "application/json" },
  });
}

type Ctx = { params: Promise<{ path: string[] }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  return proxy(req, (await ctx.params).path);
}
export async function POST(req: NextRequest, ctx: Ctx) {
  return proxy(req, (await ctx.params).path);
}
export async function PUT(req: NextRequest, ctx: Ctx) {
  return proxy(req, (await ctx.params).path);
}
export async function DELETE(req: NextRequest, ctx: Ctx) {
  return proxy(req, (await ctx.params).path);
}
