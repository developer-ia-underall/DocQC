import type { ReactNode } from "react";
import { Logo } from "@/components/app/shell";

export function AuthCard({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-[380px]">
        <div className="mb-8 flex items-center gap-2.5">
          <Logo className="size-9" />
          <div className="leading-tight">
            <div className="text-[15px] font-semibold">DocQC</div>
            <div className="text-[11.5px] text-muted-foreground">Underall</div>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}
