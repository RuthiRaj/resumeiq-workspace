import { Suspense } from "react";
import { ImportReviewPage } from "@/features/imports/import-review";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * `/workspace/import` — upload, staged extraction and side-by-side review
 * (PRD §6.2 IM-1..IM-3). Wrapped in Suspense because the review reads the
 * `?session=` search param (`useSearchParams`) to survive a reload.
 */
export const instant = false;

export default function WorkspaceImportPage() {
  return (
    <Suspense
      fallback={
        <div className="flex flex-col gap-3 py-8" aria-busy="true" aria-label="Loading import">
          <Skeleton className="h-8 w-1/3" />
          <Skeleton className="h-40 w-full" />
        </div>
      }
    >
      <ImportReviewPage />
    </Suspense>
  );
}
