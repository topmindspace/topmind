import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/v4.css";
// i18n must be imported before App so i18next is initialized before first render.
import "./locales";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
