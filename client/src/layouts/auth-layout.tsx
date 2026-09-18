import { Outlet } from "react-router-dom";

/** Replaces `app/(auth)/layout.tsx` — the white full-height wrapper. */
export function AuthLayout() {
  return (
    <div className="min-h-screen bg-white">
      <Outlet />
    </div>
  );
}
