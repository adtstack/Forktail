import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { isDetachedFolderReviewSurface } from "./core/detachedFolderReview";
import "./styles.css";

async function mountRoot(): Promise<void> {
  const element = document.getElementById("root");
  if (!element) throw new Error("Forktail root element is missing.");
  const root = createRoot(element);

  if (isDetachedFolderReviewSurface(window.location.search)) {
    const { default: DetachedFolderReviewApp } = await import("./DetachedFolderReviewApp");
    root.render(<DetachedFolderReviewApp />);
    return;
  }

  const { default: App } = await import("./App");
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void mountRoot();
