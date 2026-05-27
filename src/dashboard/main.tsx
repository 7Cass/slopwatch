import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import { DashboardRoutes } from "./App";
import "./styles.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Expected dashboard root element.");
}

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <BrowserRouter>
      <DashboardRoutes />
    </BrowserRouter>
  </React.StrictMode>,
);
