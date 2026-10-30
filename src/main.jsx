import React, { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";
// Self-hosted fonts: bundled with the app, so no request ever goes to
// Google's font servers (no visitor IP shared with a third party).
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/space-grotesk/500.css";
import "@fontsource/space-grotesk/700.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import App from "./App.jsx";
const GuardianConsent = lazy(() => import("./auth/GuardianConsent.jsx"));
const Lab = lazy(() => import("./lab/Lab.jsx"));

// /guardian#<code> is the parent/guardian consent page for under-18 students.
// /lab is the Wi-Fi Sensing Lab (a labelled simulation of the 4-board mesh).
const path = window.location.pathname.replace(/\/+$/, "");
const Root = path === "/guardian" ? GuardianConsent : path === "/lab" ? Lab : App;

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <Suspense fallback={null}><Root /></Suspense>
  </React.StrictMode>
);
