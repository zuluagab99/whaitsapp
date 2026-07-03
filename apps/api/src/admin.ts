import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { llmSettingsSchema, MODEL_CATALOG, type LlmSettings } from "@whaitsapp/ai";
import { workflowDefinitionSchema, type Workflow, type WorkflowDefinition } from "@whaitsapp/workflows";

/**
 * Persistence surface for the admin routes — implemented in server.ts on top
 * of tenantTransaction, faked in tests. Everything here is already
 * tenant-scoped; RLS is the second line of defense.
 */
export interface AdminStore {
  getLlmSettings(tenantId: string): Promise<LlmSettings>;
  putLlmSettings(tenantId: string, settings: LlmSettings): Promise<void>;
  listWorkflows(tenantId: string): Promise<Workflow[]>;
  createWorkflow(tenantId: string, def: WorkflowDefinition): Promise<Workflow>;
  updateWorkflow(tenantId: string, id: string, def: WorkflowDefinition): Promise<Workflow | null>;
  deleteWorkflow(tenantId: string, id: string): Promise<boolean>;
}

const tenantParam = z.object({ tenantId: z.string().uuid() });
const workflowParams = tenantParam.extend({ workflowId: z.string().uuid() });

/**
 * Admin/settings API: per-tenant LLM configuration and workflow CRUD.
 * Guarded by a static bearer token (interim until dashboard auth lands) —
 * the routes are not registered at all when no token is configured.
 */
export function registerAdminRoutes(app: FastifyInstance, token: string, store: AdminStore): void {
  app.addHook("onRequest", async (req, reply) => {
    if (!req.url.startsWith("/admin/")) return;
    const header = req.headers.authorization ?? "";
    if (header !== `Bearer ${token}`) {
      return reply.code(401).send({ error: "unauthorized" });
    }
  });

  // --- LLM configuration ---

  app.get("/admin/models", async () => ({ models: MODEL_CATALOG }));

  app.get("/admin/tenants/:tenantId/llm", async (req, reply) => {
    const params = tenantParam.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: "invalid tenant id" });
    const settings = await store.getLlmSettings(params.data.tenantId);
    return { settings, models: MODEL_CATALOG };
  });

  app.put("/admin/tenants/:tenantId/llm", async (req, reply) => {
    const params = tenantParam.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: "invalid tenant id" });
    const body = llmSettingsSchema.safeParse(req.body);
    if (!body.success) return reply.code(422).send({ error: "invalid llm settings", details: body.error.issues });
    await store.putLlmSettings(params.data.tenantId, body.data);
    return { settings: body.data };
  });

  // --- Workflows ---

  app.get("/admin/tenants/:tenantId/workflows", async (req, reply) => {
    const params = tenantParam.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: "invalid tenant id" });
    return { workflows: await store.listWorkflows(params.data.tenantId) };
  });

  app.post("/admin/tenants/:tenantId/workflows", async (req, reply) => {
    const params = tenantParam.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: "invalid tenant id" });
    const body = workflowDefinitionSchema.safeParse(req.body);
    if (!body.success) return reply.code(422).send({ error: "invalid workflow", details: body.error.issues });
    const workflow = await store.createWorkflow(params.data.tenantId, body.data);
    return reply.code(201).send({ workflow });
  });

  app.put("/admin/tenants/:tenantId/workflows/:workflowId", async (req, reply) => {
    const params = workflowParams.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: "invalid id" });
    const body = workflowDefinitionSchema.safeParse(req.body);
    if (!body.success) return reply.code(422).send({ error: "invalid workflow", details: body.error.issues });
    const workflow = await store.updateWorkflow(params.data.tenantId, params.data.workflowId, body.data);
    if (!workflow) return reply.code(404).send({ error: "not found" });
    return { workflow };
  });

  app.delete("/admin/tenants/:tenantId/workflows/:workflowId", async (req, reply) => {
    const params = workflowParams.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: "invalid id" });
    const deleted = await store.deleteWorkflow(params.data.tenantId, params.data.workflowId);
    if (!deleted) return reply.code(404).send({ error: "not found" });
    return reply.code(204).send();
  });
}
