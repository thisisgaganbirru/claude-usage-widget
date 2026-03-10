import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

const isDev = process.env.NODE_ENV === "development";

if (isDev) console.log("✅ index.tsx loaded");

const rootElement = document.getElementById("root");
if (isDev) console.log("📍 Root element found:", rootElement);

if (rootElement) {
  const root = ReactDOM.createRoot(rootElement);
  if (isDev) console.log("✅ ReactDOM root created");

  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
  if (isDev) console.log("✅ React App rendered");
} else {
  console.error("❌ Root element (#root) not found in HTML");
}
