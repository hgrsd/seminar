import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import { SeminarProvider } from "./hooks/useSeminarStore";

const queryClient = new QueryClient();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <SeminarProvider>
        <App />
      </SeminarProvider>
    </QueryClientProvider>
  </StrictMode>,
);
