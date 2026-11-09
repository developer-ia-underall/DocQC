import type * as PdfJs from "pdfjs-dist";
import PdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?worker&inline";

/** Single-file build: the worker is embedded and started from a blob URL. */
export async function setupPdfWorker(pdfjs: typeof PdfJs) {
  if (pdfjs.GlobalWorkerOptions.workerPort) return;
  pdfjs.GlobalWorkerOptions.workerPort = new PdfWorker();
}
