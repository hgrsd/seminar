import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { SeminarProvider } from "./hooks/useSeminarStore";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <SeminarProvider>
      <App />
    </SeminarProvider>
  </StrictMode>,
);
