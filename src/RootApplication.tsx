import type { ReactNode } from "react";
import { isDetachedFolderReviewSurface } from "./core/detachedFolderReview";

interface RootApplicationProps {
  search: string;
  main: ReactNode;
  detached: ReactNode;
}

export function RootApplication({ search, main, detached }: RootApplicationProps) {
  return isDetachedFolderReviewSurface(search) ? detached : main;
}
