import { requireRole, createClient } from "@/lib/supabase/server";
import { HrSubNav } from "@/components/hr/hr-subnav";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { OpeningForm } from "./opening-form";
import { CandidateForm } from "./candidate-form";
import { StageSelect } from "./stage-select";

const STAGES = ["applied", "shortlisted", "interview", "offer", "hired", "rejected"] as const;

export default async function RecruitmentPage() {
  await requireRole(["admin", "exec", "hr_officer", "hr_manager"]);

  const supabase = await createClient();
  const { data: openings } = await supabase.from("job_openings").select("*").order("opened_at", { ascending: false });
  const { data: applications } = await supabase
    .from("applications")
    .select("*, candidates(full_name, email)")
    .order("updated_at", { ascending: false });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-serif text-3xl font-semibold text-navy">HR</h1>
          <p className="mt-1 text-sm text-muted-foreground">Recruitment pipeline by opening.</p>
        </div>
        <OpeningForm />
      </div>

      <HrSubNav isHrTier />

      <div className="space-y-6">
        {openings?.map((opening) => {
          const openingApplications = (applications ?? []).filter((a) => a.job_opening_id === opening.id);
          return (
            <Card key={opening.id} className="rounded-2xl">
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="font-serif text-lg text-navy">{opening.title}</CardTitle>
                  <p className="text-sm text-muted-foreground">{opening.department ?? "—"}</p>
                </div>
                <div className="flex items-center gap-3">
                  <Badge variant="outline" className="capitalize">
                    {opening.status}
                  </Badge>
                  <CandidateForm jobOpeningId={opening.id} />
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-3 overflow-x-auto sm:grid-cols-3 lg:grid-cols-6">
                  {STAGES.map((stage) => (
                    <div key={stage} className="min-w-[140px] rounded-xl bg-muted/40 p-2">
                      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-steel">{stage}</p>
                      <div className="space-y-2">
                        {openingApplications
                          .filter((a) => a.stage === stage)
                          .map((a) => (
                            <div key={a.id} className="rounded-lg bg-white p-2 shadow-sm">
                              <p className="text-xs font-medium text-navy">
                                {(a.candidates as unknown as { full_name: string } | null)?.full_name ?? "—"}
                              </p>
                              <div className="mt-1">
                                <StageSelect applicationId={a.id} stage={a.stage} />
                              </div>
                            </div>
                          ))}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          );
        })}
        {(!openings || openings.length === 0) && (
          <Card className="rounded-2xl">
            <CardContent className="p-8 text-center text-sm text-muted-foreground">No open roles yet.</CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
