import React from "react";
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
import GuardianConsent from "./auth/GuardianConsent.jsx";

// /guardian#<code> is the parent/guardian consent page for under-18 students.
const Root = window.location.pathname.replace(/\/+$/, "") === "/guardian" ? GuardianConsent : App;

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
