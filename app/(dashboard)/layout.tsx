import { redirect } from "next/navigation";
import { getProfile } from "@/lib/supabase/server";
import { NavSidebar } from "@/components/nav-sidebar";
import { TopHeader } from "@/components/top-header";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const profile = await getProfile();
  if (!profile) redirect("/login");

  return (
    <div className="flex min-h-screen bg-muted/40">
      <NavSidebar role={profile.role} />
      <div className="flex min-h-screen flex-1 flex-col">
        <TopHeader profile={profile} />
        <main className="flex-1 overflow-y-auto p-8">{children}</main>
      </div>
    </div>
  );
}
