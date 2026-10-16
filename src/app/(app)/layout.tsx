import { AppShell } from "@/components/app-shell";
import { QueryProvider } from "@/components/query-provider";
import { Toaster } from "@/components/toaster";

export default function AuthenticatedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <QueryProvider>
      <AppShell>{children}</AppShell>
      <Toaster />
    </QueryProvider>
  );
}
