import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App.tsx";
import "./index.css";

registerSW({
  immediate: true,
  /** Pick up new deploys when users return after a while (tab was closed). */
  onRegisteredSW(_url, registration) {
    if (!registration) return;
    setInterval(() => {
      void registration.update();
    }, 60 * 60 * 1000);
  },
});

createRoot(document.getElementById("root")!).render(<App />);
