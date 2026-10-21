"use client";

import { createContext, useContext, type ReactNode } from "react";

const AuthFormReadyContext = createContext(true);

/** False until the mock API worker (or live transport) can accept requests. */
export function useAuthFormReady(): boolean {
  return useContext(AuthFormReadyContext);
}

export function AuthFormReadyProvider({
  ready,
  children,
}: {
  ready: boolean;
  children: ReactNode;
}) {
  return <AuthFormReadyContext.Provider value={ready}>{children}</AuthFormReadyContext.Provider>;
}
