import "./fonts";
import "./editor/styles.css";
import "./runtime/evaluate"; // registers the bake sampler used by the ops engine
import { createRoot } from "react-dom/client";
import { App } from "./editor/App";
import { installBridge } from "./editor/bridge";
import { useStore } from "./editor/store";
import { startAutosave } from "./editor/persist";

installBridge();
// test/agent hook: read-only access to editor state
(window as unknown as { __store: unknown }).__store = useStore;
startAutosave();
createRoot(document.getElementById("root")!).render(<App />);
