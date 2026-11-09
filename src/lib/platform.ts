import { toast } from "sonner";

type ClaudeHost = { use?: (name: string) => Promise<unknown> };
type Downloads = { save: (r: { filename: string; data: Blob }) => Promise<{ status: string }> };

const host = (): ClaudeHost | undefined =>
  typeof window !== "undefined" ? (window as unknown as { claude?: ClaudeHost }).claude : undefined;

/**
 * Hands a generated file to the user. Inside a claude.ai artifact the frame cannot start downloads
 * itself, so it goes through the host's `downloads` capability (the viewer confirms); everywhere
 * else a normal browser download is used.
 */
export async function saveFile(bytes: Uint8Array, name: string, mime: string): Promise<boolean> {
  const blob = new Blob([bytes as BlobPart], { type: mime });
  const h = host();
  if (h?.use) {
    try {
      const d = (await h.use("downloads")) as Downloads | null;
      if (d) {
        await d.save({ filename: name, data: blob });
        return true;
      }
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === "declined") return false;
      if (code === "rejected_extension") {
        toast.error("Este formato não pode ser descarregado aqui", { description: name });
        return false;
      }
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return true;
}

/** In-page confirmation (window.confirm is unavailable in sandboxed frames). */
export function confirmAction(
  message: string,
  label: string,
  onConfirm: () => void | Promise<void>,
) {
  toast(message, {
    duration: 8000,
    action: { label, onClick: () => void onConfirm() },
    cancel: { label: "Cancelar", onClick: () => {} },
  });
}
