import { createRoot } from "react-dom/client";
import LibraryApp from "./LibraryApp";
import "./index.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Vibloom could not find its application root.");
}

createRoot(root).render(
  <LibraryApp />,
);
