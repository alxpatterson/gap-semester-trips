"use client";

import { useEffect, useState } from "react";

type InstallEvent = Event & { prompt: () => Promise<void> };

/** Shows how to put the app on the home screen: a button on Android/desktop Chrome, instructions on iPhone Safari. */
export default function InstallHint() {
  const [mode, setMode] = useState<"none" | "ios" | "prompt">("none");
  const [evt, setEvt] = useState<InstallEvent | null>(null);

  useEffect(() => {
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
    let dismissed = false;
    try {
      dismissed = localStorage.getItem("gst:install-dismissed") === "1";
    } catch {}
    if (standalone || dismissed) return;

    const ua = navigator.userAgent;
    const isIOS = /iPhone|iPad|iPod/.test(ua) && !/CriOS|FxiOS/.test(ua);
    if (isIOS) setMode("ios");

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setEvt(e as InstallEvent);
      setMode("prompt");
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  if (mode === "none") return null;
  const dismiss = () => {
    try {
      localStorage.setItem("gst:install-dismissed", "1");
    } catch {}
    setMode("none");
  };

  return (
    <div className="banner install">
      {mode === "ios" ? (
        <span>
          Put this on your home screen: tap <strong>Share</strong>, then <strong>Add to Home Screen</strong>.
        </span>
      ) : (
        <span>Install Trips as an app on this device.</span>
      )}
      <span className="actions">
        {mode === "prompt" && evt && (
          <button
            className="btn small primary"
            onClick={async () => {
              await evt.prompt();
              setMode("none");
            }}
          >
            Install
          </button>
        )}
        <button className="btn small ghost" onClick={dismiss}>
          Not now
        </button>
      </span>
    </div>
  );
}
