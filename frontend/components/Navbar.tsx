"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { getCurrentUser, AuthUser } from "@/lib/api";
import { getStoredToken, signOut } from "@/lib/auth";

function NavAvatar({ user }: { user: AuthUser | null }) {
  if (!user) return null;
  if (user.avatar) {
    return (
      <img
        src={user.avatar}
        alt={user.username}
        className="h-8 w-8 rounded-full object-cover ring-2 ring-indigo-100"
      />
    );
  }
  return (
    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-600 text-xs font-bold text-white ring-2 ring-indigo-100">
      {user.username.slice(0, 2).toUpperCase()}
    </div>
  );
}

export default function Navbar() {
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setHydrated(true);
      const storedToken = getStoredToken();
      setToken(storedToken);
      if (storedToken) {
        getCurrentUser(storedToken).then(setUser).catch(() => null);
      }
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [pathname]);

  const showOnRoute = pathname.startsWith("/dashboard") || pathname.startsWith("/dataset") || pathname.startsWith("/profile");

  if (!hydrated) return null;
  if (!showOnRoute || !token) return null;

  function handleLogout() {
    signOut();
    setToken(null);
    router.replace("/login");
  }

  return (
    <header className="sticky top-0 z-50 border-b border-indigo-100 bg-white/95 backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:gap-4 sm:px-6 lg:px-8">
        <Link href="/" className="text-lg font-semibold tracking-tight text-indigo-700">
          Smartalyze
        </Link>

        <div className="flex items-center gap-2 sm:gap-3">
          <Link
            href="/dashboard"
            className="rounded-xl border border-indigo-200 px-3 py-2 text-sm font-medium text-indigo-700 transition hover:border-indigo-300 hover:bg-indigo-50 sm:px-4"
          >
            Dashboard
          </Link>

          <Link
            href="/profile"
            aria-label="Profile"
            className="flex items-center gap-2 rounded-xl border border-slate-200 px-2 py-1.5 text-sm font-medium text-slate-700 transition hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700 sm:px-3"
          >
            <NavAvatar user={user} />
            {user ? <span className="hidden sm:inline">{user.username}</span> : <span className="hidden sm:inline">Profile</span>}
          </Link>

          <button
            type="button"
            onClick={handleLogout}
            className="rounded-xl bg-indigo-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-indigo-500 sm:px-4"
          >
            Logout
          </button>
        </div>
      </div>
    </header>
  );
}
