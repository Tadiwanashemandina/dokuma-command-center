import { redirect } from "next/navigation";
import { getProfile } from "@/lib/supabase/server";
import { getRecentNotifications } from "@/lib/notifications/get";
import { NavSidebar } from "@/components/nav-sidebar";
import { TopHeader } from "@/components/top-header";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const profile = await getProfile();
  if (!profile) redirect("/login");

  const notifications = await getRecentNotifications();

  return (
    <div className="flex h-screen overflow-hidden bg-[#f6f8fb]">
      <NavSidebar role={profile.role} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopHeader profile={profile} notifications={notifications} />
        <main className="flex-1 overflow-y-auto px-5 py-7 sm:px-8 lg:px-10">{children}</main>
      </div>
    </div>
  );
}
