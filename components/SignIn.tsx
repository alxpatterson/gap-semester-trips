"use client";

import { useState, type FormEvent } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Email + password. Anyone can make an account; an invite code is what buys you a trip (see Onboarding). */
export function SignIn({ sb }: { sb: SupabaseClient }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"signin" | "signup" | "forgot" | "sent" | "check">("signin");
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

  const signUp = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    const { data, error } = await sb.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: window.location.origin } });
    setBusy(false);
    if (error) return setError(error.message);
    // With email confirmation on, there's no session yet and the link has to be opened first.
    if (!data.session) setMode("check");
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
        <h1>{mode === "signup" ? "Make an account" : "Trip planner"}</h1>
        {mode === "check" && (
          <>
            <p>
              Check <strong>{email}</strong> for a link to confirm the address, then come back and sign in.
            </p>
            <button className="btn" onClick={() => setMode("signin")}>
              Back to sign in
            </button>
          </>
        )}
        {mode === "signup" && (
          <>
            <p>You&apos;ll need an invite code once you&apos;re in, to set up your trip.</p>
            <form className="f" onSubmit={signUp}>
              <label>
                Email
                <input id="signup-email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </label>
              <label>
                Password
                <input
                  id="signup-password"
                  type="password"
                  required
                  minLength={8}
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
              {error && <p style={{ color: "var(--alert)" }}>{error}</p>}
              <button className="btn primary" disabled={busy}>
                {busy ? "Creating…" : "Create account"}
              </button>
              <button type="button" className="btn ghost small" onClick={() => { setMode("signin"); setError(""); }}>
                I already have an account
              </button>
            </form>
          </>
        )}
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
            {error && <p style={{ color: "var(--alert)" }}>{error}</p>}
            <button className="btn primary" type="submit" disabled={busy}>
              {busy ? "Signing in…" : "Sign in"}
            </button>
            <button className="btn ghost" type="button" onClick={() => { setError(""); setMode("forgot"); }}>
              Forgot password?
            </button>
            <button className="btn ghost small" type="button" onClick={() => { setError(""); setMode("signup"); }}>
              New here? Make an account
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
            {error && <p style={{ color: "var(--alert)" }}>{error}</p>}
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
      {error && <p style={{ color: "var(--alert)" }}>{error}</p>}
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

/**
 * Where a new account lands: no trip yet. An invite code buys one trip, and the same form collects
 * the things that used to be hardcoded — dates, budget, currency, whether to count Schengen days.
 */
export function Onboarding({ sb, email, onCreated }: { sb: SupabaseClient; email: string; onCreated: () => void }) {
  const [invite, setInvite] = useState("");
  const [name, setName] = useState("");
  const [starts, setStarts] = useState("");
  const [ends, setEnds] = useState("");
  const [budget, setBudget] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [schengen, setSchengen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    const { error } = await sb.rpc("create_plan_with_invite", {
      invite: invite.trim(),
      plan_name: name.trim(),
      starts: starts || null,
      ends: ends || null,
      budget: Number(budget) || 0,
      curr: currency,
      schengen,
    });
    setBusy(false);
    if (error) return setError(error.message);
    onCreated();
  };

  return (
    <main className="center">
      <div className="card">
        <h1>Set up your trip</h1>
        <p>
          Signed in as <strong>{email}</strong>. If someone shared their trip with you instead, ask them to add this exact email under People —
          then sign in again rather than filling this in.
        </p>
        <form className="f" onSubmit={create}>
          <label>
            Invite code
            <input id="ob-invite" required value={invite} onChange={(e) => setInvite(e.target.value)} placeholder="TRIP-XXXX" />
          </label>
          <label>
            What are you calling it?
            <input id="ob-name" required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} placeholder="Summer in Japan" />
          </label>
          <div className="two">
            <label>
              Starts
              <input id="ob-start" type="date" value={starts} onChange={(e) => setStarts(e.target.value)} />
            </label>
            <label>
              Ends
              <input id="ob-end" type="date" value={ends} onChange={(e) => setEnds(e.target.value)} />
            </label>
          </div>
          <div className="two">
            <label>
              Budget
              <input id="ob-budget" type="number" min={0} step={100} value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="5000" />
            </label>
            <label>
              Currency
              <select id="ob-currency" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                {["USD", "EUR", "GBP", "AUD", "CAD", "JPY", "CHF", "SEK", "NZD", "SGD"].map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="check">
            <input id="ob-schengen" type="checkbox" checked={schengen} onChange={(e) => setSchengen(e.target.checked)} />
            Count my Schengen days (Europe&rsquo;s 90-in-180 rule)
          </label>
          {error && <p style={{ color: "var(--alert)" }}>{error}</p>}
          <button className="btn primary" disabled={busy}>
            {busy ? "Setting up…" : "Create my trip"}
          </button>
        </form>
        <button className="btn ghost small" onClick={() => sb.auth.signOut()}>
          Sign out
        </button>
      </div>
    </main>
  );
}
