import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, KeyRound, Link2, ShieldOff, UserPlus } from "lucide-react";
import { USER_ROLES, type UserRole } from "@dokuma/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { QueryError, TableSkeleton } from "@/components/query-states";
import { formatDateTime } from "@/lib/utils";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useAuth } from "@/lib/auth-context";
import { ApiRequestError } from "@/lib/api-client";
import {
  changeUserRole,
  inviteUser,
  issuePasswordLink,
  listUsers,
  resetUserMfa,
  setUserDisabled,
  unlockUser,
  type AdminUser,
} from "@/lib/api/admin";

const USERS_KEY = ["admin", "users"] as const;

/**
 * User management — admin only.
 *
 * Replaces the CLI `invite` script for day-to-day use. Every action here is
 * audited server-side, and the destructive ones (role change, disable) confirm
 * first, because their effect is immediate: the server revokes the target's
 * live sessions so a changed role cannot keep acting under the old one.
 */
export function AdminUsersPage() {
  useDocumentTitle("User Management");

  const queryClient = useQueryClient();
  const { user: currentUser } = useAuth();

  const [inviteOpen, setInviteOpen] = useState(false);
  const [issuedLink, setIssuedLink] = useState<{ url: string; email: string; expiresAt: string } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<
    | { kind: "disable" | "enable" | "reset-mfa"; user: AdminUser }
    | { kind: "role"; user: AdminUser; role: UserRole }
    | null
  >(null);

  const users = useQuery({ queryKey: USERS_KEY, queryFn: listUsers });

  const refresh = () => queryClient.invalidateQueries({ queryKey: USERS_KEY });

  /** Turns the server's relative path into a full URL the admin can send. */
  const toFullUrl = (path: string) => `${window.location.origin}${path}`;

  const onError = (caught: unknown) =>
    setError(caught instanceof ApiRequestError ? caught.message : "That action failed. Try again.");

  const invite = useMutation({
    mutationFn: inviteUser,
    async onSuccess(result) {
      setInviteOpen(false);
      setIssuedLink({
        url: toFullUrl(result.setPasswordPath),
        email: result.user.email,
        expiresAt: result.expiresAt,
      });
      await refresh();
    },
    onError,
  });

  const passwordLink = useMutation({
    mutationFn: issuePasswordLink,
    onSuccess: (result) =>
      setIssuedLink({
        url: toFullUrl(result.setPasswordPath),
        email: result.email ?? "",
        expiresAt: result.expiresAt,
      }),
    onError,
  });

  const act = useMutation({
    mutationFn: async (input: NonNullable<typeof confirm>) => {
      if (input.kind === "role") return changeUserRole(input.user.id, input.role);
      if (input.kind === "reset-mfa") return resetUserMfa(input.user.id);
      return setUserDisabled(input.user.id, input.kind === "disable");
    },
    async onSuccess() {
      setConfirm(null);
      await refresh();
    },
    onError(caught) {
      setConfirm(null);
      onError(caught);
    },
  });

  const unlock = useMutation({
    mutationFn: unlockUser,
    onSuccess: refresh,
    onError,
  });

  const rows = users.data?.items ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <h1 className="font-serif text-3xl font-semibold text-navy">User Management</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Accounts, roles and access. Every change here is recorded in the audit trail.
          </p>
        </div>
        <Button className="rounded-xl bg-navy hover:bg-navy/90" onClick={() => setInviteOpen(true)}>
          <UserPlus className="mr-2 h-4 w-4" /> Invite user
        </Button>
      </div>

      {error && (
        <p role="alert" className="rounded-lg bg-status-red/10 px-3 py-2 text-sm text-status-red">
          {error}
        </p>
      )}

      <Card className="rounded-2xl">
        <CardContent className="p-0">
          {users.isPending && <TableSkeleton columns={6} />}

          {users.error && (
            <div className="p-4">
              <QueryError error={users.error} onRetry={() => void users.refetch()} resource="users" />
            </div>
          )}

          {!users.isPending && !users.error && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last sign-in</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((u) => {
                  const isSelf = u.id === currentUser?.id;
                  const locked = u.lockedUntil !== null && new Date(u.lockedUntil) > new Date();

                  return (
                    <TableRow key={u.id} className={u.disabledAt ? "opacity-55" : undefined}>
                      <TableCell className="font-medium text-navy">
                        {u.fullName ?? "—"}
                        {isSelf && <span className="ml-2 text-xs text-muted-foreground">(you)</span>}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{u.email}</TableCell>
                      <TableCell>
                        {/* Changing your own role is refused server-side, so the
                            control is disabled rather than failing on click. */}
                        <Select
                          value={u.role}
                          disabled={isSelf || act.isPending}
                          onValueChange={(role) =>
                            setConfirm({ kind: "role", user: u, role: role as UserRole })
                          }
                        >
                          <SelectTrigger className="h-8 w-[168px] rounded-lg text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {USER_ROLES.map((role) => (
                              <SelectItem key={role} value={role} className="text-xs">
                                {role}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {u.disabledAt && (
                            <Badge className="rounded-full border-0 bg-status-red/15 text-status-red hover:bg-status-red/15">
                              disabled
                            </Badge>
                          )}
                          {u.pendingInvite && !u.disabledAt && (
                            <Badge className="rounded-full border-0 bg-gold/15 text-gold hover:bg-gold/15">
                              invite pending
                            </Badge>
                          )}
                          {locked && (
                            <Badge className="rounded-full border-0 bg-status-amber/15 text-status-amber hover:bg-status-amber/15">
                              locked
                            </Badge>
                          )}
                          {u.mfaEnrolled && (
                            <Badge className="rounded-full border-0 bg-status-green/15 text-status-green hover:bg-status-green/15">
                              MFA
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {u.lastLoginAt ? formatDateTime(u.lastLoginAt) : "never"}
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            title="Send a set-password link"
                            onClick={() => passwordLink.mutate(u.id)}
                            disabled={passwordLink.isPending}
                          >
                            <Link2 className="h-4 w-4" />
                          </Button>

                          {u.mfaEnrolled && (
                            <Button
                              variant="ghost"
                              size="sm"
                              title="Reset two-factor authentication"
                              onClick={() => setConfirm({ kind: "reset-mfa", user: u })}
                            >
                              <KeyRound className="h-4 w-4" />
                            </Button>
                          )}

                          {locked && (
                            <Button
                              variant="ghost"
                              size="sm"
                              title="Clear the lockout"
                              onClick={() => unlock.mutate(u.id)}
                            >
                              unlock
                            </Button>
                          )}

                          {!isSelf && (
                            <Button
                              variant="ghost"
                              size="sm"
                              title={u.disabledAt ? "Re-enable this account" : "Disable this account"}
                              className={u.disabledAt ? "text-status-green" : "text-status-red"}
                              onClick={() =>
                                setConfirm({ kind: u.disabledAt ? "enable" : "disable", user: u })
                              }
                            >
                              <ShieldOff className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* ---- Invite ---- */}
      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite a user</DialogTitle>
            <DialogDescription>
              Creates the account with no password and gives you a one-time link for them to set one.
              No email is sent — you share the link yourself.
            </DialogDescription>
          </DialogHeader>

          <form
            id="invite-form"
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              setError(null);
              const data = new FormData(e.currentTarget);
              invite.mutate({
                email: String(data.get("email") ?? ""),
                fullName: String(data.get("fullName") ?? ""),
                role: String(data.get("role") ?? "viewer") as UserRole,
              });
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="invite-name">Full name</Label>
              <Input id="invite-name" name="fullName" required className="rounded-xl" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="invite-email">Email</Label>
              <Input id="invite-email" name="email" type="email" required className="rounded-xl" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="invite-role">Role</Label>
              <select
                id="invite-role"
                name="role"
                defaultValue="viewer"
                className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm"
              >
                {USER_ROLES.map((role) => (
                  <option key={role} value={role}>
                    {role}
                  </option>
                ))}
              </select>
            </div>
          </form>

          <DialogFooter>
            <Button variant="outline" className="rounded-xl" onClick={() => setInviteOpen(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              form="invite-form"
              className="rounded-xl bg-navy hover:bg-navy/90"
              disabled={invite.isPending}
            >
              {invite.isPending ? "Creating…" : "Create & get link"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---- The issued link, shown once ---- */}
      <Dialog open={issuedLink !== null} onOpenChange={() => setIssuedLink(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Set-password link</DialogTitle>
            <DialogDescription>
              Send this to {issuedLink?.email}. It works once and expires{" "}
              {issuedLink ? formatDateTime(issuedLink.expiresAt) : ""}. Anyone holding it can set this
              account&apos;s password — treat it like a password.
            </DialogDescription>
          </DialogHeader>

          <div className="break-all rounded-xl bg-muted px-3 py-2 font-mono text-xs text-navy">
            {issuedLink?.url}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              className="rounded-xl"
              onClick={() => void navigator.clipboard?.writeText(issuedLink?.url ?? "")}
            >
              <Copy className="mr-2 h-4 w-4" /> Copy link
            </Button>
            <Button className="rounded-xl bg-navy hover:bg-navy/90" onClick={() => setIssuedLink(null)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---- Confirmations ---- */}
      <Dialog open={confirm !== null} onOpenChange={() => setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirm?.kind === "role" && `Change role to "${confirm.role}"?`}
              {confirm?.kind === "disable" && "Disable this account?"}
              {confirm?.kind === "enable" && "Re-enable this account?"}
              {confirm?.kind === "reset-mfa" && "Reset two-factor authentication?"}
            </DialogTitle>
            <DialogDescription>
              {confirm?.kind === "role" &&
                `${confirm.user.email} is currently "${confirm.user.role}". They will be signed out everywhere and must sign in again under the new role.`}
              {confirm?.kind === "disable" &&
                `${confirm.user.email} will be signed out immediately and unable to sign in. Their history is kept.`}
              {confirm?.kind === "enable" && `${confirm.user.email} will be able to sign in again.`}
              {confirm?.kind === "reset-mfa" &&
                `${confirm.user.email} will be asked to set up a new authenticator at next sign-in. Use this when someone has lost both their device and their recovery codes.`}
            </DialogDescription>
          </DialogHeader>

          <DialogFooter>
            <Button variant="outline" className="rounded-xl" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button
              className="rounded-xl bg-navy hover:bg-navy/90"
              disabled={act.isPending}
              onClick={() => confirm && act.mutate(confirm)}
            >
              {act.isPending ? "Working…" : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
