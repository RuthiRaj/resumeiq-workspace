import { Suspense } from "react";
import { ResumeStudio } from "@/features/resume/resume-studio";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * `/targets/[id]/resume` — the editable tailored-resume canvas (F5). Suspense
 * is required because the requested snapshot id comes from `?resume=`.
 */
export const instant = false;

export default async function TargetResumePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <Suspense
      fallback={
        <div
          role="status"
          aria-busy="true"
          aria-label="Loading resume studio"
          className="flex flex-col gap-3 py-8"
        >
          <Skeleton className="h-8 w-1/3" />
          <Skeleton className="h-5 w-1/2" />
          <Skeleton className="h-64 w-full" />
        </div>
      }
    >
      <ResumeStudio targetId={id} />
    </Suspense>
  );
}
