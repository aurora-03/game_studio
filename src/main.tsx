import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "@xyflow/react/dist/style.css";
import "./styles.css";
import "./icon-system.css";
import "./account.css";
import { getLanguage, setLanguage } from "./locale";
setLanguage(getLanguage());

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
