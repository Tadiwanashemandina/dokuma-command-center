import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import {
  EXEC_ONLY,
  FINANCE_READ,
  FINANCE_WRITE,
  FINANCE_APPROVE,
  HR_ALL,
  ADMIN_ONLY,
  GROUP_CAPTURE,
  type UserRole,
} from "@dokuma/shared";

/** Mirrors the Express gate on /api/admin/audit-log (migration 0013). */
const AUDIT_READERS: readonly UserRole[] = ["admin", "exec", "finance_manager"];
import { AuthProvider } from "@/lib/auth-context";
import { RedirectIfAuthenticated, RequireAuth, RequireRole } from "@/components/route-guards";
import { AuthLayout } from "@/layouts/auth-layout";
import { DashboardLayout } from "@/layouts/dashboard-layout";
import { Toaster } from "@/components/ui/sonner";
import { LoginPage } from "@/routes/login";
import { NotFoundPage } from "@/routes/not-found";
import { PlaceholderPage } from "@/routes/placeholder";
import { ProjectsPage } from "@/routes/projects";
import { ProjectDetailPage } from "@/routes/project-detail";
import { DeliveryPage } from "@/routes/delivery";
import { MeetingsPage } from "@/routes/meetings";
import { RisksPage } from "@/routes/risks";
import { ClientsPage } from "@/routes/clients";
import { PeoplePage } from "@/routes/people";
import { CeoHomePage } from "@/routes/ceo-home";
import { CompanyPage } from "@/routes/company";
import { GroupReportingPage } from "@/routes/group-reporting";
import { GroupCapturePage } from "@/routes/group-capture";
import { MfaEnrollPage } from "@/routes/mfa-enroll";
import { MfaVerifyPage } from "@/routes/mfa-verify";
import { SetPasswordPage } from "@/routes/set-password";
import { AdminUsersPage } from "@/routes/admin-users";
import { AdminAuditPage } from "@/routes/admin-audit";
import { FinancePage } from "@/routes/finance";
import { FinanceTransactionsPage } from "@/routes/finance-transactions";
import { FinanceCreditorsPage } from "@/routes/finance-creditors";
import { FinancePaymentNoticesPage } from "@/routes/finance-payment-notices";
import { FinanceReportsPage } from "@/routes/finance-reports";
import { FinanceReportDetailPage } from "@/routes/finance-report-detail";
import {
  FinanceWeeklyReportNewPage,
  FinanceMonthlyReportNewPage,
} from "@/routes/finance-report-new";
import { FinanceImportPage } from "@/routes/finance-import";
import { XeroSettingsPage } from "@/routes/xero-settings";

/**
 * The route tree — the replacement for Next's file-system routing and its
 * `(auth)` / `(dashboard)` route groups (inventory §2).
 *
 * The nesting mirrors the old structure exactly:
 *
 *   (auth)/       → <AuthLayout>      wrapped in <RedirectIfAuthenticated>
 *   (dashboard)/  → <DashboardLayout> wrapped in <RequireAuth>
 *
 * Role gates that pages used to apply themselves with `requireRole()` are
 * `<RequireRole>` layout routes here, so the rule sits in one place per
 * section instead of being repeated at the top of every page. The role tiers
 * come from @dokuma/shared, which is the same source the Express middleware
 * uses — so a gate cannot drift from the endpoint it fronts.
 *
 * Routes still marked `<PlaceholderPage>` are the ones whose Express endpoints
 * do not exist yet; they render the real shell with an explicit "not yet
 * migrated" state rather than a blank screen or a 404.
 */
export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          {/* Redeeming an invite or reset link. Public, and deliberately
              outside <RedirectIfAuthenticated>: a signed-in admin checking a
              link should see the page, not be bounced to their dashboard. */}
          <Route element={<AuthLayout />}>
            <Route path="/set-password" element={<SetPasswordPage />} />
          </Route>

          {/* ---------------- Auth ---------------- */}
          <Route element={<RedirectIfAuthenticated />}>
            <Route element={<AuthLayout />}>
              <Route path="/login" element={<LoginPage />} />
            </Route>
          </Route>

          {/* ---------------- Dashboard ---------------- */}
          <Route element={<RequireAuth />}>
            {/* MFA screens sit inside the auth gate but outside the dashboard
                shell: a user who has not cleared the challenge should not see
                navigation to places they cannot go. */}
            <Route element={<AuthLayout />}>
              <Route path="/account/mfa/enroll" element={<MfaEnrollPage />} />
              <Route path="/account/mfa/verify" element={<MfaVerifyPage />} />
            </Route>

            <Route element={<DashboardLayout />}>
              {/* Executive — admin/exec only. Non-exec roles are redirected to
                  their own home route by <RequireRole>, matching the redirect
                  the CEO Home page did itself. */}
              <Route element={<RequireRole roles={EXEC_ONLY} />}>
                <Route path="/" element={<CeoHomePage />} />
                <Route path="/company" element={<CompanyPage />} />
                {/* What Dokuma reports UPWARD to the Group — the 59-measure
                    register and the state of the feed carrying it. Exec-tier
                    like the other board-level surfaces; capture is wider and is
                    gated at the endpoint, not here. */}
                <Route path="/group" element={<GroupReportingPage />} />
                <Route path="/people" element={<PeoplePage />} />
              </Route>

              {/* Month-end capture is deliberately WIDER than exec: §9 of the
                  Group specification describes these figures as typed in by
                  finance and operations staff. Gating it on exec would mean the
                  only people allowed to enter the numbers are the people the
                  numbers are for. The endpoint enforces the same list. */}
              <Route element={<RequireRole roles={GROUP_CAPTURE} />}>
                <Route path="/group/capture" element={<GroupCapturePage />} />
              </Route>

              {/* Any authenticated role (inventory §10, D-2: these had no
                  requireRole and relied on RLS; the endpoints now require an
                  authenticated session explicitly). */}
              <Route path="/projects" element={<ProjectsPage />} />
              <Route path="/projects/:id" element={<ProjectDetailPage />} />
              <Route path="/risks" element={<RisksPage />} />
              <Route path="/clients" element={<ClientsPage />} />
              <Route path="/delivery" element={<DeliveryPage />} />
              <Route path="/meetings" element={<MeetingsPage />} />

              {/* Finance — the four finance-tier roles.
                  Note the nested gates below: FINANCE_READ is the floor for
                  the section, and the sub-gates narrow it to match the
                  endpoints each page calls. A finance_officer reaching
                  /finance/xero would find every control on it inert, and an
                  exec reaching /finance/import would get a 403 on the first
                  upload — so neither route is offered to them at all. */}
              <Route element={<RequireRole roles={FINANCE_READ} />}>
                <Route path="/finance" element={<FinancePage />} />
                <Route path="/finance/transactions" element={<FinanceTransactionsPage />} />
                <Route path="/finance/creditors" element={<FinanceCreditorsPage />} />
                <Route path="/finance/payment-notices" element={<FinancePaymentNoticesPage />} />
                <Route path="/finance/reports" element={<FinanceReportsPage />} />
                <Route path="/finance/reports/weekly/new" element={<FinanceWeeklyReportNewPage />} />
                <Route path="/finance/reports/monthly/new" element={<FinanceMonthlyReportNewPage />} />
                {/* After the two /new routes: "weekly" would otherwise match
                    :id and render the detail page for a non-existent report. */}
                <Route path="/finance/reports/:id" element={<FinanceReportDetailPage />} />

                {/* Importing writes transactions — FINANCE_WRITE, matching
                    requireRole() on /api/finance/import/*. */}
                <Route element={<RequireRole roles={FINANCE_WRITE} />}>
                  <Route path="/finance/import" element={<FinanceImportPage />} />
                </Route>

                {/* Every Xero mutation is approve-tier server-side. */}
                <Route element={<RequireRole roles={FINANCE_APPROVE} />}>
                  <Route path="/finance/xero" element={<XeroSettingsPage />} />
                </Route>
              </Route>

              {/* HR */}
              <Route element={<RequireRole roles={HR_ALL} />}>
                <Route path="/hr" element={<PlaceholderPage title="HR" />} />
                <Route path="/hr/employees" element={<PlaceholderPage title="Employees" />} />
                <Route path="/hr/employees/:id" element={<PlaceholderPage title="Employee" />} />
                <Route path="/hr/leave" element={<PlaceholderPage title="Leave" />} />
                <Route path="/hr/leave/new" element={<PlaceholderPage title="Request Leave" />} />
                <Route path="/hr/performance" element={<PlaceholderPage title="Performance" />} />
                <Route path="/hr/training" element={<PlaceholderPage title="Training" />} />
                <Route path="/hr/recruitment" element={<PlaceholderPage title="Recruitment" />} />
              </Route>

              {/* Admin */}
              <Route element={<RequireRole roles={ADMIN_ONLY} />}>
                <Route path="/admin/users" element={<AdminUsersPage />} />
                <Route
                  path="/admin/import/lazyboss-csv"
                  element={<PlaceholderPage title="Import LazyBoss CSV" />}
                />
              </Route>

              {/* The audit trail is oversight rather than administration, so it
                  follows migration 0013's wider policy: admin, exec and
                  finance_manager, not admin alone. */}
              <Route element={<RequireRole roles={AUDIT_READERS} />}>
                <Route path="/admin/audit-log" element={<AdminAuditPage />} />
              </Route>

              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Route>

          {/* An unmatched path outside the dashboard shell (i.e. while signed
              out) goes to /login rather than rendering a bare 404. */}
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>

        <Toaster />
      </AuthProvider>
    </BrowserRouter>
  );
}
