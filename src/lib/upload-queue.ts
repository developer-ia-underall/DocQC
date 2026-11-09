import { useSyncExternalStore } from "react";
import { analyzeBytes, readFile, type Stage } from "@/lib/analysis";
import { AnalysisError } from "@/lib/analysis/common";
import * as store from "@/services/store";
import { ensureSeed } from "@/services/queries";
import { uid } from "@/lib/format";
import type { AnalysisResult } from "@/types/domain";

export interface QueueItem {
  id: string;
  file: File;
  stage: Stage | "error" | "cancelled";
  progress: number;
  error?: string | undefined;
  result?:
    | {
        docId: string;
        status: store.IngestResult["status"];
        versionN: number;
        analysis: AnalysisResult;
      }
    | undefined;
  controller: AbortController;
}

/**
 * Module-level queue so uploads keep running while the user navigates away from /upload.
 * Files are processed with limited concurrency (2), like Uppy's default.
 */
let items: QueueItem[] = [];
const listeners = new Set<() => void>();
let onDone: (() => void) | null = null;
const emit = () => {
  items = [...items];
  listeners.forEach((l) => l());
};
const patch = (id: string, p: Partial<QueueItem>) => {
  const i = items.findIndex((x) => x.id === id);
  const cur = items[i];
  if (cur) items[i] = { ...cur, ...p };
  emit();
};

export const uploadQueue = {
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  get: () => items,
  setOnDone(fn: () => void) {
    onDone = fn;
  },
  add(files: File[]) {
    for (const file of files)
      items.push({
        id: uid(),
        file,
        stage: "upload",
        progress: 0,
        controller: new AbortController(),
      });
    emit();
    void pump();
  },
  cancel(id: string) {
    const it = items.find((x) => x.id === id);
    if (it && it.stage !== "done" && it.stage !== "error") {
      it.controller.abort();
      patch(id, { stage: "cancelled", error: "Cancelado pelo utilizador." });
    }
  },
  retry(id: string) {
    patch(id, {
      stage: "upload",
      progress: 0,
      error: undefined,
      controller: new AbortController(),
    });
    void pump();
  },
  remove(id: string) {
    items = items.filter((x) => x.id !== id);
    emit();
  },
  clearFinished() {
    items = items.filter(
      (x) => x.stage !== "done" && x.stage !== "cancelled" && x.stage !== "error",
    );
    emit();
  },
};

const running = new Set<string>();
const CONCURRENCY = 2;

async function pump() {
  await ensureSeed();
  while (running.size < CONCURRENCY) {
    const next = items.find((x) => x.stage === "upload" && x.progress === 0 && !running.has(x.id));
    if (!next) return;
    running.add(next.id);
    void process(next.id).finally(() => {
      running.delete(next.id);
      void pump();
    });
  }
}

async function process(id: string) {
  const it = items.find((x) => x.id === id);
  if (!it) return;
  const signal = it.controller.signal;
  try {
    const settings = await store.getSettings();
    if (it.file.size > settings.scanning.maxSizeMb * 1024 * 1024)
      throw new AnalysisError(
        "too_large",
        `Ficheiro demasiado grande (${(it.file.size / 1048576).toFixed(1)} MB). O limite é ${settings.scanning.maxSizeMb} MB.`,
      );
    patch(id, { progress: 0.01 });
    const bytes = await readFile(it.file, (p) => patch(id, { progress: 0.02 + p * 0.26 }), signal);
    // Short, honest pauses between stages keep the stepper legible for small files.
    const out = await analyzeBytes(bytes, it.file.name, {
      ...settings.scanning,
      signal,
      onStage: (stage, progress) => patch(id, { stage, progress }),
    });
    if (signal.aborted) return;
    const res = await store.ingest({
      fileName: it.file.name,
      size: it.file.size,
      hash: out.hash,
      bytes,
      analysis: out.analysis,
      uploadedBy: (await store.listProfiles())[0]?.fullName ?? "Utilizador",
    });
    patch(id, {
      stage: "done",
      progress: 1,
      result: {
        docId: res.doc.id,
        status: res.status,
        versionN: res.version.n,
        analysis: out.analysis,
      },
    });
    onDone?.();
  } catch (e) {
    if (signal.aborted) return;
    patch(id, { stage: "error", error: e instanceof Error ? e.message : String(e) });
  }
}

export const useUploadQueue = () =>
  useSyncExternalStore(uploadQueue.subscribe, uploadQueue.get, () => items);
