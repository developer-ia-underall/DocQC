import { Toaster as Sonner } from "sonner";
import { useTheme } from "@/components/app/theme";

export function Toaster() {
  const { theme } = useTheme();
  return (
    <Sonner
      theme={theme}
      position="bottom-right"
      toastOptions={{
        classNames: {
          toast:
            "!bg-popover !text-popover-foreground !border !border-border !shadow-popover !rounded-lg !text-[13px] !font-sans",
          description: "!text-muted-foreground",
        },
      }}
    />
  );
}
