"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { getCurrentUser, loginUser } from "@/lib/api";
import { getStoredToken, setStoredToken } from "@/lib/auth";

const FEATURES = [
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-5 w-5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    title: "Upload & Clean",
    desc: "Auto-detect issues — missing values, duplicates, invalid types — and fix them in one click.",
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-5 w-5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
      </svg>
    ),
    title: "Explore & Analyze",
    desc: "Distributions, statistics, correlations, and trend charts — no SQL or code required.",
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-5 w-5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.941" />
      </svg>
    ),
    title: "Forecast",
    desc: "Linear trend forecasts with a 95% likely range — see where your data is heading.",
  },
];

function DataArt() {
  return (
    <svg
      viewBox="0 0 480 320"
      className="absolute inset-0 h-full w-full"
      aria-hidden="true"
    >
      <style>{`
        @keyframes float-a { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-12px)} }
        @keyframes float-b { 0%,100%{transform:translateY(0)} 50%{transform:translateY(10px)} }
        @keyframes pulse-dot { 0%,100%{opacity:.03} 50%{opacity:.09} }
        .fa { animation: float-a 6s ease-in-out infinite; }
        .fb { animation: float-b 8s ease-in-out infinite; }
        .pd { animation: pulse-dot 3s ease-in-out infinite; }
      `}</style>

      {Array.from({ length: 8 }, (_, row) =>
        Array.from({ length: 12 }, (_, col) => (
          <circle
            key={`${row}-${col}`}
            cx={col * 44 + 8}
            cy={row * 44 + 8}
            r={1.5}
            fill="#6366f1"
            className="pd"
            style={{ animationDelay: `${(row + col) * 0.15}s` }}
          />
        ))
      )}

      <g stroke="#6366f1" strokeWidth={0.6} opacity={0.12}>
        <line x1={50} y1={60} x2={180} y2={100} />
        <line x1={180} y1={100} x2={290} y2={70} />
        <line x1={290} y1={70} x2={400} y2={140} />
        <line x1={120} y1={200} x2={240} y2={170} />
        <line x1={240} y1={170} x2={360} y2={220} />
      </g>

      <g fill="#a5b4fc" className="fa" opacity={0.45}>
        <circle cx={50} cy={60} r={5} />
        <circle cx={180} cy={100} r={7} />
        <circle cx={290} cy={70} r={4.5} />
        <circle cx={400} cy={140} r={6} />
      </g>
      <g fill="#c7d2fe" className="fb" opacity={0.35}>
        <circle cx={120} cy={200} r={4} />
        <circle cx={240} cy={170} r={7} />
        <circle cx={360} cy={220} r={5} />
      </g>

      <g className="fa" style={{ animationDelay: "1s" }}>
        <rect x={60} y={240} width={20} height={50} rx={3} fill="#e0e7ff" />
        <rect x={90} y={220} width={20} height={70} rx={3} fill="#c7d2fe" />
        <rect x={120} y={255} width={20} height={35} rx={3} fill="#e0e7ff" />
        <rect x={150} y={230} width={20} height={60} rx={3} fill="#c7d2fe" />
        <rect x={180} y={210} width={20} height={80} rx={3} fill="#ddd6fe" />
      </g>

      <polyline
        points="260,260 295,230 330,240 365,200 400,210 435,190"
        fill="none"
        stroke="#6366f1"
        strokeWidth={1.5}
        opacity={0.2}
        className="fb"
      />
      <polyline
        points="260,260 295,230 330,240 365,200 400,210 435,190 435,290 260,290"
        fill="#6366f1"
        opacity={0.04}
        className="fb"
      />
    </svg>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const token = getStoredToken();
    if (!token) return;
    getCurrentUser(token)
      .then(() => router.replace("/dashboard"))
      .catch(() => {});
  }, [router]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    try {
      const response = await loginUser(username, password);
      setStoredToken(response.token);
      router.replace("/dashboard");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Login failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex h-screen w-full overflow-hidden">
      {/* ── LEFT PANEL ── */}
      <div
        className="relative hidden lg:flex lg:w-[55%] flex-col justify-between overflow-hidden p-12"
        style={{
          background:
            "radial-gradient(circle at 20% 20%, rgba(99,102,241,0.10) 0%, transparent 50%), " +
            "radial-gradient(circle at 80% 80%, rgba(99,102,241,0.06) 0%, transparent 50%), " +
            "#f8fafc",
        }}
      >
        <DataArt />

        {/* brand */}
        <div className="relative z-10">
          <div className="flex items-center gap-3">
            <div className="h-8 w-1 rounded-full bg-indigo-600" />
            <span className="text-lg font-semibold tracking-wide text-indigo-700">Smartalyze</span>
          </div>
        </div>

        {/* hero copy */}
        <div className="relative z-10 max-w-md">
          <h1 className="text-4xl font-bold leading-tight tracking-tight text-slate-900">
            Turn raw data<br />
            <span className="text-indigo-600">into clear insights</span>
          </h1>
          <p className="mt-4 text-base leading-relaxed text-slate-500">
            Upload your CSV or Excel file, clean it automatically, explore statistics, and forecast trends — no code, no SQL, no friction.
          </p>

          {/* feature cards */}
          <div className="mt-8 space-y-3">
            {FEATURES.map((f) => (
              <div
                key={f.title}
                className="flex items-start gap-4 rounded-2xl border border-indigo-100 bg-white shadow-sm p-4"
              >
                <span className="mt-0.5 shrink-0 text-indigo-500">{f.icon}</span>
                <div>
                  <p className="text-sm font-semibold text-slate-800">{f.title}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{f.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* bottom tagline */}
        <div className="relative z-10">
          <p className="text-xs tracking-widest text-slate-400 uppercase">
            Designed for analysts who move fast
          </p>
        </div>
      </div>

      {/* ── RIGHT PANEL ── */}
      <div className="flex flex-1 flex-col justify-center bg-white border-l border-indigo-100 px-8 sm:px-16 lg:px-20">
        <div className="mx-auto w-full max-w-sm">
          {/* top nav */}
          <div className="mb-10 flex items-center justify-between">
            <Link
              href="/"
              className="flex items-center gap-1.5 text-sm text-slate-500 transition hover:text-slate-800"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
              </svg>
              Back
            </Link>
            <div className="flex items-center gap-2">
              <div className="h-1 w-6 rounded-full bg-indigo-600" />
              <span className="text-sm font-semibold text-slate-800">Smartalyze</span>
            </div>
          </div>

          {/* heading */}
          <div className="mb-8">
            <h2 className="text-2xl font-bold tracking-tight text-slate-900">Welcome back</h2>
            <p className="mt-1 text-sm text-slate-500">Sign in to your workspace</p>
          </div>

          {/* form */}
          <form className="space-y-5" onSubmit={handleSubmit}>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-slate-700">Username</span>
              <input
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none ring-0 transition focus:border-indigo-500 focus:bg-white focus:ring-2 focus:ring-indigo-500/20"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                minLength={3}
              />
            </label>

            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-slate-700">Password</span>
              <input
                type="password"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none ring-0 transition focus:border-indigo-500 focus:bg-white focus:ring-2 focus:ring-indigo-500/20"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
              />
            </label>

            <button
              type="submit"
              disabled={loading}
              className="relative w-full overflow-hidden rounded-xl bg-indigo-600 py-3 text-sm font-semibold text-white transition hover:bg-indigo-500 active:scale-[.98] disabled:cursor-not-allowed disabled:opacity-70"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx={12} cy={12} r={10} stroke="currentColor" strokeWidth={4} />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Signing in…
                </span>
              ) : (
                "Sign in"
              )}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-slate-500">
            No account yet?{" "}
            <Link
              href="/register"
              className="font-medium text-indigo-600 underline decoration-indigo-200 underline-offset-4 transition hover:text-indigo-800"
            >
              Create one
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
