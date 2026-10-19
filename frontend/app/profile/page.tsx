"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { deleteAccount, getCurrentUser, updateAvatar, updatePassword, updateUsername, AuthUser } from "@/lib/api";
import { clearStoredToken, getStoredToken, signOut } from "@/lib/auth";

type FeedbackTone = "neutral" | "success" | "warning" | "error";

function getFeedbackClasses(tone: FeedbackTone): string {
  switch (tone) {
    case "success": return "border-green-200 bg-green-50 text-green-800";
    case "warning": return "border-yellow-200 bg-yellow-50 text-yellow-800";
    case "error": return "border-red-200 bg-red-50 text-red-800";
    default: return "border-slate-200 bg-slate-50 text-slate-700";
  }
}

function AvatarDisplay({ user }: { user: AuthUser }) {
  if (user.avatar) {
    return (
      <img
        src={user.avatar}
        alt={user.username}
        className="h-20 w-20 rounded-full object-cover ring-2 ring-indigo-100"
      />
    );
  }
  const initials = user.username.slice(0, 2).toUpperCase();
  return (
    <div className="flex h-20 w-20 items-center justify-center rounded-full bg-indigo-600 text-2xl font-bold text-white ring-2 ring-indigo-100">
      {initials}
    </div>
  );
}

export default function ProfilePage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [usernameMsg, setUsernameMsg] = useState("");
  const [usernameTone, setUsernameTone] = useState<FeedbackTone>("neutral");
  const [newUsername, setNewUsername] = useState("");
  const [usernamePassword, setUsernamePassword] = useState("");
  const [savingUsername, setSavingUsername] = useState(false);

  const [passwordMsg, setPasswordMsg] = useState("");
  const [passwordTone, setPasswordTone] = useState<FeedbackTone>("neutral");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);

  const [avatarMsg, setAvatarMsg] = useState("");
  const [avatarTone, setAvatarTone] = useState<FeedbackTone>("neutral");
  const [savingAvatar, setSavingAvatar] = useState(false);

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteMsg, setDeleteMsg] = useState("");

  useEffect(() => {
    const storedToken = getStoredToken();
    if (!storedToken) {
      router.replace("/login");
      return;
    }
    setToken(storedToken);
    getCurrentUser(storedToken)
      .then((u) => { setUser(u); setNewUsername(u.username); })
      .catch(() => { clearStoredToken(); router.replace("/login"); })
      .finally(() => setLoading(false));
  }, [router]);

  async function handleAvatarChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || !token) return;

    setSavingAvatar(true);
    setAvatarMsg("");
    setAvatarTone("neutral");

    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const base64 = reader.result as string;
        const updated = await updateAvatar(token, base64);
        setUser(updated);
        setAvatarMsg("Avatar updated.");
        setAvatarTone("success");
      } catch (err) {
        setAvatarMsg(err instanceof Error ? err.message : "Could not update avatar.");
        setAvatarTone("error");
      } finally {
        setSavingAvatar(false);
      }
    };
    reader.readAsDataURL(file);
  }

  async function handleRemoveAvatar() {
    if (!token) return;
    setSavingAvatar(true);
    setAvatarMsg("");
    try {
      const updated = await updateAvatar(token, null);
      setUser(updated);
      setAvatarMsg("Avatar removed.");
      setAvatarTone("success");
    } catch (err) {
      setAvatarMsg(err instanceof Error ? err.message : "Could not remove avatar.");
      setAvatarTone("error");
    } finally {
      setSavingAvatar(false);
    }
  }

  async function handleChangeUsername(event: React.FormEvent) {
    event.preventDefault();
    if (!token || !user) return;
    setSavingUsername(true);
    setUsernameMsg("");
    setUsernameTone("neutral");
    try {
      const updated = await updateUsername(token, newUsername.trim(), usernamePassword);
      setUser(updated);
      setUsernamePassword("");
      setUsernameMsg("Username updated successfully.");
      setUsernameTone("success");
    } catch (err) {
      setUsernameMsg(err instanceof Error ? err.message : "Could not update username.");
      setUsernameTone("error");
    } finally {
      setSavingUsername(false);
    }
  }

  async function handleChangePassword(event: React.FormEvent) {
    event.preventDefault();
    if (!token) return;
    if (newPassword !== confirmPassword) {
      setPasswordMsg("New passwords do not match.");
      setPasswordTone("error");
      return;
    }
    setSavingPassword(true);
    setPasswordMsg("");
    setPasswordTone("neutral");
    try {
      await updatePassword(token, currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordMsg("Password updated successfully.");
      setPasswordTone("success");
    } catch (err) {
      setPasswordMsg(err instanceof Error ? err.message : "Could not update password.");
      setPasswordTone("error");
    } finally {
      setSavingPassword(false);
    }
  }

  async function handleDeleteAccount() {
    if (!token) return;
    setDeleting(true);
    setDeleteMsg("");
    try {
      await deleteAccount(token, deletePassword);
      signOut();
      router.replace("/login");
    } catch (err) {
      setDeleteMsg(err instanceof Error ? err.message : "Could not delete account.");
      setDeleting(false);
    }
  }

  function handleSignOut() {
    signOut();
    router.replace("/login");
  }

  if (loading) {
    return <main className="min-h-screen bg-slate-50 px-4 py-10 text-slate-900">Loading profile...</main>;
  }

  if (!user) return null;

  const memberSince = new Date(user.created_at).toLocaleDateString(undefined, { month: "long", year: "numeric" });

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-900">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">

        <header className="flex items-center justify-between rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div>
            <p className="text-sm font-medium uppercase tracking-[0.2em] text-indigo-500">Account</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">Profile & Settings</h1>
          </div>
          <Link href="/dashboard" className="text-sm font-medium text-indigo-700 underline decoration-indigo-300 underline-offset-4">
            Back to dashboard
          </Link>
        </header>

        {/* Profile card */}
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center gap-5">
            <AvatarDisplay user={user} />
            <div>
              <p className="text-xl font-semibold text-slate-950">{user.username}</p>
              <p className="mt-1 text-sm text-slate-500">Member since {memberSince}</p>
            </div>
          </div>

          <div className="mt-5 space-y-3">
            {avatarMsg ? (
              <p className={`rounded-2xl border px-4 py-3 text-sm ${getFeedbackClasses(avatarTone)}`}>{avatarMsg}</p>
            ) : null}
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700 disabled:opacity-60"
                onClick={() => fileInputRef.current?.click()}
                disabled={savingAvatar}
              >
                {savingAvatar ? "Saving..." : "Change photo"}
              </button>
              {user.avatar ? (
                <button
                  type="button"
                  className="rounded-xl border border-red-100 bg-white px-4 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50 disabled:opacity-60"
                  onClick={handleRemoveAvatar}
                  disabled={savingAvatar}
                >
                  Remove photo
                </button>
              ) : null}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={handleAvatarChange}
            />
          </div>
        </section>

        {/* Change username */}
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">Change username</h2>
          <p className="mt-1 text-sm text-slate-600">Enter your current password to confirm the change.</p>
          <form className="mt-5 space-y-4" onSubmit={handleChangeUsername}>
            {usernameMsg ? (
              <p className={`rounded-2xl border px-4 py-3 text-sm ${getFeedbackClasses(usernameTone)}`}>{usernameMsg}</p>
            ) : null}
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-slate-900">New username</span>
              <input
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-indigo-500"
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                minLength={3}
                required
              />
            </label>
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-slate-900">Current password</span>
              <input
                type="password"
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-indigo-500"
                value={usernamePassword}
                onChange={(e) => setUsernamePassword(e.target.value)}
                required
              />
            </label>
            <button
              type="submit"
              className="rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:opacity-70"
              disabled={savingUsername}
            >
              {savingUsername ? "Saving..." : "Update username"}
            </button>
          </form>
        </section>

        {/* Change password */}
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">Change password</h2>
          <form className="mt-5 space-y-4" onSubmit={handleChangePassword}>
            {passwordMsg ? (
              <p className={`rounded-2xl border px-4 py-3 text-sm ${getFeedbackClasses(passwordTone)}`}>{passwordMsg}</p>
            ) : null}
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-slate-900">Current password</span>
              <input
                type="password"
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-indigo-500"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
              />
            </label>
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-slate-900">New password</span>
              <input
                type="password"
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-indigo-500"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                minLength={8}
                required
              />
            </label>
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-slate-900">Confirm new password</span>
              <input
                type="password"
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-indigo-500"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                minLength={8}
                required
              />
            </label>
            <button
              type="submit"
              className="rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:opacity-70"
              disabled={savingPassword}
            >
              {savingPassword ? "Saving..." : "Update password"}
            </button>
          </form>
        </section>

        {/* Sign out + Delete account */}
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">Account actions</h2>
          <div className="mt-5 flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              className="rounded-xl border border-slate-200 px-5 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
              onClick={handleSignOut}
            >
              Sign out
            </button>
            <button
              type="button"
              className="rounded-xl border border-red-200 bg-white px-5 py-2.5 text-sm font-medium text-red-600 transition hover:bg-red-50"
              onClick={() => setShowDeleteModal(true)}
            >
              Delete account
            </button>
          </div>
        </section>

      </div>

      {/* Delete account modal */}
      {showDeleteModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4">
          <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-6 shadow-2xl">
            <h3 className="text-lg font-semibold text-red-700">Delete account permanently?</h3>
            <p className="mt-2 text-sm text-slate-600">
              This will delete your account and all your datasets. This cannot be undone. Enter your password to confirm.
            </p>
            {deleteMsg ? (
              <p className="mt-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{deleteMsg}</p>
            ) : null}
            <input
              type="password"
              placeholder="Your password"
              className="mt-4 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-red-400"
              value={deletePassword}
              onChange={(e) => setDeletePassword(e.target.value)}
            />
            <div className="mt-5 flex gap-3 sm:justify-end">
              <button
                type="button"
                className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
                onClick={() => { setShowDeleteModal(false); setDeletePassword(""); setDeleteMsg(""); }}
                disabled={deleting}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rounded-xl bg-red-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-red-500 disabled:opacity-70"
                onClick={handleDeleteAccount}
                disabled={deleting || !deletePassword}
              >
                {deleting ? "Deleting..." : "Delete my account"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
