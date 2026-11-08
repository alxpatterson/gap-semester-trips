"use client";

import { useState, type FormEvent } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

export function SignIn({ sb }: { sb: SupabaseClient }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState("");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setState("sending");
    const { error } = await sb.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: window.location.origin } });
    if (error) {
      setError(error.message);
      setState("error");
    } else setState("sent");
  };

  return (
    <main className="center">
      <div className="card">
        <h1>Gap Semester Trips</h1>
        {state === "sent" ? (
          <p>
            Check <strong>{email}</strong> for a sign-in link. Open it on this device. If you installed the app on your iPhone, open the link in
            Safari first, then reopen the app.
          </p>
        ) : (
          <form className="f" onSubmit={submit}>
            <p>Sign in with your email. We&apos;ll send you a link, no password needed.</p>
            <label>
              Email
              <input id="signin-email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            {state === "error" && <p style={{ color: "var(--bad)" }}>Couldn&apos;t send the link: {error}</p>}
            <button className="btn primary" type="submit" disabled={state === "sending"}>
              {state === "sending" ? "Sending…" : "Email me a sign-in link"}
            </button>
          </form>
        )}
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
          You&apos;re signed in as <strong>{email}</strong>, which isn&apos;t on the gap semester plan. Ask Alex to add this exact email under
          People, then sign in again.
        </p>
        <button className="btn" onClick={() => sb.auth.signOut()}>
          Sign out
        </button>
      </div>
    </main>
  );
}
