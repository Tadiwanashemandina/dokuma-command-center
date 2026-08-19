import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { formatDate, formatUsdCompact } from "@/lib/utils";
import type { ProjectStatus } from "@/types/database.types";

export default async function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: project }, { data: milestones }, { data: tasks }, { data: risks }] = await Promise.all([
    supabase.from("projects").select("*, clients(name)").eq("id", id).single(),
    supabase.from("milestones").select("*").eq("project_id", id).order("due_date"),
    supabase.from("tasks").select("*").eq("project_id", id).order("due_date").limit(20),
    supabase.from("risks_issues_decisions").select("*").eq("project_id", id).order("due_date"),
  ]);

  if (!project) notFound();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-serif text-3xl font-semibold text-navy">{project.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {(project.clients as unknown as { name: string } | null)?.name ?? "Internal"} · Owner: {project.owner_name ?? "—"}
          </p>
        </div>
        <StatusBadge status={project.status as ProjectStatus} />
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card className="rounded-2xl">
          <CardContent className="p-4">
            <p className="text-xs text-steel">Budget</p>
            <p className="font-serif text-xl text-navy">{formatUsdCompact(project.budget_usd)}</p>
          </CardContent>
        </Card>
        <Card className="rounded-2xl">
          <CardContent className="p-4">
            <p className="text-xs text-steel">Start</p>
            <p className="font-serif text-xl text-navy">{formatDate(project.start_date)}</p>
          </CardContent>
        </Card>
        <Card className="rounded-2xl">
          <CardContent className="p-4">
            <p className="text-xs text-steel">Target End</p>
            <p className="font-serif text-xl text-navy">{formatDate(project.target_end_date)}</p>
          </CardContent>
        </Card>
        <Card className="rounded-2xl">
          <CardContent className="p-4">
            <p className="text-xs text-steel">Open Risks/Issues</p>
            <p className="font-serif text-xl text-navy">{risks?.filter((r) => r.status !== "closed").length ?? 0}</p>
          </CardContent>
        </Card>
      </div>

      {project.description && (
        <Card className="rounded-2xl">
          <CardContent className="p-4 text-sm text-muted-foreground">{project.description}</CardContent>
        </Card>
      )}

      <Card className="rounded-2xl">
        <CardHeader>
          <CardTitle className="font-serif text-lg text-navy">Milestones</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {milestones && milestones.length > 0 ? (
            milestones.map((m) => (
              <div key={m.id} className="flex items-center justify-between border-b border-border/60 py-2 last:border-0">
                <span className="text-sm text-navy">{m.name}</span>
                <div className="flex items-center gap-3">
                  <Badge variant="outline" className="capitalize">{m.status.replace("_", " ")}</Badge>
                  <span className="text-sm text-muted-foreground">{formatDate(m.due_date)}</span>
                </div>
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">No milestones recorded.</p>
          )}
        </CardContent>
      </Card>

      <Card className="rounded-2xl">
        <CardHeader>
          <CardTitle className="font-serif text-lg text-navy">Tasks</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Task</TableHead>
                <TableHead>Assignee</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Due</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tasks?.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="text-navy">{t.title}</TableCell>
                  <TableCell className="text-muted-foreground">{t.assignee_name ?? "—"}</TableCell>
                  <TableCell><Badge variant="outline" className="capitalize">{t.status.replace("_", " ")}</Badge></TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(t.due_date)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="rounded-2xl">
        <CardHeader>
          <CardTitle className="font-serif text-lg text-navy">Risks, Issues &amp; Decisions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {risks && risks.length > 0 ? (
            risks.map((r) => (
              <div key={r.id} className="flex items-center justify-between border-b border-border/60 py-2 last:border-0">
                <div>
                  <p className="text-sm text-navy">{r.title}</p>
                  <p className="text-xs capitalize text-muted-foreground">{r.type} · {r.severity ?? "—"}</p>
                </div>
                <Badge variant="outline" className="capitalize">{r.status}</Badge>
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">Nothing logged for this project.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
