import { Router } from "express";
import { Client, Project } from "../db/models/index.js";
import { requireAnyRole, requireAuthContext } from "../middleware/auth.js";
import { handle, ok, pagination, page } from "./helpers.js";

/**
 * Clients and their linked projects (inventory §2.3, route 10).
 *
 * DEPARTMENT-SCOPED, with the same no-fallback rule as risks: a scoped role
 * sees only rows tagged with its own department, and `null` rows are
 * exec-only (§4.5). See the longer note in routes/risks.ts.
 *
 * Linked projects are nested per client, which is what the card layout
 * renders. The legacy page fetched EVERY project and filtered in memory per
 * card — fine at 12 projects, but it grows with the portfolio rather than
 * with what is displayed, so the lookup here is scoped to the clients on the
 * current page.
 */

export const clientsRouter = Router();

clientsRouter.get(
  "/",
  ...requireAnyRole,
  handle(async (req, res) => {
    const auth = requireAuthContext(req);
    const { limit, offset } = pagination(req);

    const filter: Record<string, unknown> = {};
    if (auth.departmentScope !== null) {
      filter["department"] = auth.departmentScope;
    }

    const [clients, total] = await Promise.all([
      // tier then name, as the page ordered.
      Client.find(filter).sort({ tier: 1, name: 1 }).skip(offset).limit(limit).lean(),
      Client.countDocuments(filter),
    ]);

    const projects = clients.length
      ? await Project.find({ clientId: { $in: clients.map((c) => c._id) } })
          .select("name status clientId")
          .sort({ name: 1 })
          .lean()
      : [];

    const byClient = new Map<string, typeof projects>();
    for (const project of projects) {
      if (project.clientId === null) continue;
      const bucket = byClient.get(project.clientId) ?? [];
      bucket.push(project);
      byClient.set(project.clientId, bucket);
    }

    ok(res, {
      ...page(
        clients.map((client) => ({
          id: client._id,
          name: client.name,
          industry: client.industry,
          primary_contact_name: client.primaryContactName,
          primary_contact_email: client.primaryContactEmail,
          relationship_owner: client.relationshipOwner,
          tier: client.tier,
          notes: client.notes,
          department: client.department,
          projects: (byClient.get(client._id) ?? []).map((p) => ({
            id: p._id,
            name: p.name,
            status: p.status,
          })),
        })),
        total,
        { limit, offset },
      ),
      scope: auth.departmentScope,
    });
  }),
);
