import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = ["/login", "/api/auth/login"];

export async function updateSession(request: NextRequest) {
  const response = NextResponse.next({ request });
  const authenticated = Boolean(request.cookies.get("dokuma_local_session")?.value);

  const isPublicPath = PUBLIC_PATHS.some((path) => request.nextUrl.pathname.startsWith(path));

  if (!authenticated && !isPublicPath) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}
