"use client";

import dynamic from "next/dynamic";

const ColdStartToastInner = dynamic(
  () => import("@/components/cold-start-toast").then((mod) => mod.ColdStartToast),
  { ssr: false }
);

export function ColdStartToastWrapper() {
  return <ColdStartToastInner />;
}