import { createRoot } from "react-dom/client";
import MobileApp from "./MobileApp";

const root = document.getElementById("root");
if (!root) throw new Error("Vibloom could not find its mobile application root.");
document.body.dataset.vibloomUi = "mobile";
const viewport = document.querySelector('meta[name="viewport"]');
viewport?.setAttribute("content", "width=device-width, initial-scale=1.0, viewport-fit=cover");
createRoot(root).render(<MobileApp />);
