import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { getLang, setMissingHandler } from "./i18n";
import "./index.css";

// <html lang> is set here, at startup, from the remembered language; setLang() keeps it right afterwards.
document.documentElement.lang = getLang();

if (import.meta.env.DEV) {
  setMissingHandler((info) => console.warn("[i18n]", info.reason, `${info.lang}.${info.section}.${info.key}`));
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
