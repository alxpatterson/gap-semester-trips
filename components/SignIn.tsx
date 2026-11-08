"use client";

import { useState, type FormEvent } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Email + password sign-in. Accounts are created by Alex in Supabase; there is no public sign-up. */
export function SignIn({ sb }: { sb: SupabaseClient }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"signin" | "forgot" | "sent">("signin");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const signIn = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) setError(error.message === "Invalid login credentials" ? "That email and password don't match." : error.message);
  };

  const sendReset = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    const { error } = await sb.auth.resetPasswordForEmail(email.trim(), { redirectTo: window.location.origin });
    setBusy(false);
    if (error) setError(error.message);
    else setMode("sent");
  };

  return (
    <main className="center">
      <div className="card">
        <h1>Gap Semester Trips</h1>
        {mode === "sent" && (
          <>
            <p>
              If <strong>{email}</strong> has an account, a link to set a new password is on its way. Open it on this device.
            </p>
            <button className="btn" onClick={() => setMode("signin")}>
              Back to sign in
            </button>
          </>
        )}
        {mode === "signin" && (
          <form className="f" onSubmit={signIn}>
            <label>
              Email
              <input id="signin-email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            <label>
              Password
              <input
                id="signin-password"
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            {error && <p style={{ color: "var(--bad)" }}>{error}</p>}
            <button className="btn primary" type="submit" disabled={busy}>
              {busy ? "Signing in…" : "Sign in"}
            </button>
            <button className="btn ghost" type="button" onClick={() => { setError(""); setMode("forgot"); }}>
              Forgot password?
            </button>
          </form>
        )}
        {mode === "forgot" && (
          <form className="f" onSubmit={sendReset}>
            <p>Enter your email and we&apos;ll send a link to set a new password.</p>
            <label>
              Email
              <input id="reset-email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            {error && <p style={{ color: "var(--bad)" }}>{error}</p>}
            <button className="btn primary" type="submit" disabled={busy}>
              {busy ? "Sending…" : "Send reset link"}
            </button>
            <button className="btn ghost" type="button" onClick={() => setMode("signin")}>
              Back to sign in
            </button>
          </form>
        )}
      </div>
    </main>
  );
}

/** Shown after opening a password-reset link, and from People → Change password. */
export function SetPassword({ sb, onDone, onCancel }: { sb: SupabaseClient; onDone: () => void; onCancel?: () => void }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <form
      className="f"
      onSubmit={async (e) => {
        e.preventDefault();
        if (password.length < 8) return setError("Use at least 8 characters.");
        if (password !== confirm) return setError("The two passwords don't match.");
        setBusy(true);
        const { error } = await sb.auth.updateUser({ password });
        setBusy(false);
        if (error) setError(error.message);
        else onDone();
      }}
    >
      <label>
        New password
        <input id="new-password" type="password" required autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </label>
      <label>
        Confirm new password
        <input id="confirm-password" type="password" required autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </label>
      {error && <p style={{ color: "var(--bad)" }}>{error}</p>}
      <button className="btn primary" type="submit" disabled={busy}>
        {busy ? "Saving…" : "Save password"}
      </button>
      {onCancel && (
        <button className="btn ghost" type="button" onClick={onCancel}>
          Cancel
        </button>
      )}
    </form>
  );
}

export function RecoveryScreen({ sb, onDone }: { sb: SupabaseClient; onDone: () => void }) {
  return (
    <main className="center">
      <div className="card">
        <h1>Set a new password</h1>
        <SetPassword sb={sb} onDone={onDone} />
      </div>
    </main>
  );
}

export function SetupNeeded() {
  return (
    <main className="center">
      <div className="card">
        <h1>Almost there</h1>
        <p>
          This app needs its Supabase settings. Add <code>NEXT_PUBLIC_SUPABASE_URL</code> and <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> in Vercel →
          Project → Settings → Environment Variables (or in <code>.env.local</code> when running locally), then redeploy.
        </p>
      </div>
    </main>
  );
}

/** Shown to anyone who signs in with an email that isn't on the gap semester plan. */
export function NotInvited({ sb, email }: { sb: SupabaseClient; email: string }) {
  return (
    <main className="center">
      <div className="card">
        <h1>This planner is private</h1>
        <p>
          You&apos;re signed in as <strong>{email}</strong>, which isn&apos;t on the gap semester plan. Ask Alex to add this exact email to the
          plan, then sign in again.
        </p>
        <button className="btn" onClick={() => sb.auth.signOut()}>
          Sign out
        </button>
      </div>
    </main>
  );
}
