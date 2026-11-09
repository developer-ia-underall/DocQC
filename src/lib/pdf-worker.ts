import type * as PdfJs from "pdfjs-dist";

/** Points pdf.js at its worker file (served next to the app). */
export async function setupPdfWorker(pdfjs: typeof PdfJs) {
  if (pdfjs.GlobalWorkerOptions.workerSrc || pdfjs.GlobalWorkerOptions.workerPort) return;
  pdfjs.GlobalWorkerOptions.workerSrc = (
    await import("pdfjs-dist/build/pdf.worker.min.mjs?url")
  ).default;
}
