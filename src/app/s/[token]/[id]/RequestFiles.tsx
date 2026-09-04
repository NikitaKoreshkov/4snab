"use client";

import Image from "next/image";
import { useEffect, useState, type ChangeEvent, type DragEvent } from "react";
import type { RequestFile } from "@/lib/requests";

interface Props {
  token: string;
  id: number;
  initialFiles: RequestFile[];
  initialError?: string;
  allowDelete?: boolean;
}

interface UploadSession {
  uploadUrl: string;
  maxFileSize: number;
  maxPartSize: number;
}

interface UploadProgress {
  complete: boolean;
  nextUrl?: string;
  file?: RequestFile;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}

function isPreviewableImage(file: RequestFile): boolean {
  if (/^image\/(?:jpeg|png|webp|gif|bmp|svg\+xml)$/i.test(file.type)) return true;
  return /\.(?:jpe?g|png|webp|gif|bmp|svg)$/i.test(file.name);
}

function mergeFiles(primary: RequestFile[], fallback: RequestFile[]): RequestFile[] {
  const merged = new Map(fallback.map((file) => [file.uuid, file]));
  primary.forEach((file) => merged.set(file.uuid, file));
  return [...merged.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

async function responseError(response: Response, fallback: string): Promise<Error> {
  const text = await response.text().catch(() => "");
  if (text) {
    try {
      const body = JSON.parse(text) as { error?: string };
      if (body.error) return new Error(body.error);
    } catch {
      return new Error(text);
    }
  }
  return new Error(fallback);
}

export function RequestFiles({
  token,
  id,
  initialFiles,
  initialError,
  allowDelete = true,
}: Props) {
  const [files, setFiles] = useState<RequestFile[]>(initialFiles);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [notice, setNotice] = useState<string | null>(null);
  const [preview, setPreview] = useState<RequestFile | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const endpoint = `/api/requests/${id}/files?token=${encodeURIComponent(token)}`;

  function fileUrl(file: RequestFile, variant?: "preview"): string {
    const suffix = variant ? `&variant=${variant}` : "";
    return `/api/requests/${id}/files/${encodeURIComponent(file.uuid)}?token=${encodeURIComponent(token)}${suffix}`;
  }

  useEffect(() => {
    if (!preview) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setPreview(null);
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [preview]);

  async function refreshFiles(): Promise<void> {
    const response = await fetch(endpoint, { cache: "no-store" });
    if (!response.ok) throw await responseError(response, "Не удалось обновить накладные");
    const body = (await response.json()) as { files?: RequestFile[] };
    setFiles((current) => mergeFiles(body.files ?? [], current));
  }

  async function uploadOne(file: File): Promise<RequestFile> {
    const sessionResponse = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fileName: file.name,
        fileSize: file.size,
        contentType: file.type,
      }),
    });
    if (!sessionResponse.ok) {
      throw await responseError(sessionResponse, `Не удалось загрузить «${file.name}»`);
    }

    const session = (await sessionResponse.json()) as UploadSession;
    if (file.size > session.maxFileSize) {
      throw new Error(
        `«${file.name}» больше допустимого размера ${formatFileSize(session.maxFileSize)}`,
      );
    }
    if (!session.maxPartSize || !session.uploadUrl) {
      throw new Error("amoCRM вернула некорректную сессию загрузки");
    }

    let uploadUrl = session.uploadUrl;
    let offset = 0;
    while (offset < file.size) {
      const end = Math.min(offset + session.maxPartSize, file.size);
      const chunk = file.slice(offset, end);
      const response = await fetch(
        `/api/requests/${id}/files/upload?token=${encodeURIComponent(token)}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/octet-stream",
            "x-amo-upload-url": uploadUrl,
          },
          body: chunk,
        },
      );
      if (!response.ok) {
        throw await responseError(response, `Не удалось загрузить «${file.name}»`);
      }

      const result = (await response.json()) as UploadProgress;
      offset = end;
      setProgress(Math.round((offset / file.size) * 100));

      if (result.complete) {
        if (!result.file) throw new Error("amoCRM не вернула загруженный файл");
        return result.file;
      }
      if (!result.nextUrl) throw new Error("amoCRM прервала загрузку файла");
      uploadUrl = result.nextUrl;
    }

    throw new Error(`Не удалось завершить загрузку «${file.name}»`);
  }

  async function uploadMany(selected: File[]) {
    if (!selected.length) return;

    setUploading(true);
    setProgress(0);
    setError(null);
    setNotice(null);
    let uploadedCount = 0;
    try {
      for (const file of selected) {
        const uploaded = await uploadOne(file);
        uploadedCount += 1;
        setFiles((current) => mergeFiles([uploaded], current));
        setProgress(0);
      }
      await refreshFiles();
      setNotice(
        uploadedCount === 1
          ? "Накладная загружена и сохранена"
          : `Загружено накладных: ${uploadedCount}`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить накладную");
    } finally {
      setUploading(false);
    }
  }

  async function handleFiles(event: ChangeEvent<HTMLInputElement>) {
    const selected = [...(event.target.files ?? [])];
    event.target.value = "";
    await uploadMany(selected);
  }

  function handleDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setDragOver(false);
    if (uploading) return;
    void uploadMany([...event.dataTransfer.files]);
  }

  async function removeFile(file: RequestFile) {
    if (!allowDelete || deleting) return;
    const confirmed = window.confirm(`Удалить накладную «${file.name}»?`);
    if (!confirmed) return;

    setDeleting(file.uuid);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(fileUrl(file), { method: "DELETE" });
      if (!response.ok) throw await responseError(response, "Не удалось удалить накладную");
      setFiles((current) => current.filter((item) => item.uuid !== file.uuid));
      if (preview?.uuid === file.uuid) setPreview(null);
      setNotice("Накладная удалена");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось удалить накладную");
    } finally {
      setDeleting(null);
    }
  }

  return (
    <section className="mb-6 rounded-xl border p-4">
      <div className="mb-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-medium">Накладные и фото</h2>
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
            {files.length}
          </span>
        </div>
        <p className="mt-0.5 text-xs text-gray-500">
          Одно поле: можно выбрать или перетащить сразу несколько PDF и фото
        </p>
      </div>

      <label
        className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-6 text-center transition ${
          dragOver
            ? "border-gray-900 bg-gray-50"
            : "border-gray-300 bg-white hover:border-gray-400"
        } ${uploading ? "pointer-events-none opacity-60" : ""}`}
        onDragEnter={(event) => {
          event.preventDefault();
          setDragOver(true);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          if (event.currentTarget.contains(event.relatedTarget as Node)) return;
          setDragOver(false);
        }}
        onDrop={handleDrop}
      >
        <input
          type="file"
          multiple
          accept="application/pdf,image/*,.heic,.heif"
          disabled={uploading}
          onChange={handleFiles}
          className="sr-only"
        />
        <span className="text-sm font-medium text-gray-800">
          {uploading ? `Загрузка ${progress || 0}%` : "Нажмите или перетащите файлы сюда"}
        </span>
        <span className="mt-1 text-xs text-gray-400">
          Несколько накладных за раз, без ограничения по количеству
        </span>
      </label>

      <div aria-live="polite">
        {error && (
          <p className="mt-3 rounded-lg bg-red-50 p-2 text-sm text-red-700">{error}</p>
        )}
        {notice && (
          <p className="mt-3 rounded-lg bg-green-50 p-2 text-sm text-green-700">
            {notice}
          </p>
        )}
      </div>

      {files.length ? (
        <ul className="mt-4 grid gap-3 sm:grid-cols-2">
          {files.map((file, index) => {
            const image = isPreviewableImage(file);
            const busy = deleting === file.uuid;
            return (
              <li key={file.uuid} className="relative overflow-hidden rounded-xl border bg-white">
                {image ? (
                  <button
                    type="button"
                    onClick={() => setPreview(file)}
                    className="relative block aspect-[4/3] w-full overflow-hidden bg-gray-100"
                    aria-label={`Предпросмотр ${file.name}`}
                  >
                    <Image
                      unoptimized
                      src={fileUrl(file, "preview")}
                      alt={file.name}
                      fill
                      loading={index === 0 ? "eager" : "lazy"}
                      sizes="(max-width: 640px) 100vw, 360px"
                      className="object-cover transition hover:scale-[1.02]"
                    />
                  </button>
                ) : (
                  <a
                    href={fileUrl(file)}
                    target="_blank"
                    rel="noreferrer"
                    className="flex aspect-[4/3] items-center justify-center bg-gray-50 text-center"
                  >
                    <span>
                      <span className="block text-4xl" aria-hidden="true">
                        📄
                      </span>
                      <span className="mt-2 block text-sm font-medium text-blue-700">
                        Открыть документ
                      </span>
                    </span>
                  </a>
                )}
                {allowDelete && (
                  <button
                    type="button"
                    onClick={() => void removeFile(file)}
                    disabled={busy || uploading}
                    className="absolute top-2 right-2 rounded-full bg-black/70 px-2.5 py-1 text-xs font-medium text-white hover:bg-black disabled:opacity-50"
                    aria-label={`Удалить ${file.name}`}
                  >
                    {busy ? "…" : "Удалить"}
                  </button>
                )}
                <div className="flex items-start justify-between gap-3 p-3 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium" title={file.name}>
                      {file.name}
                    </p>
                    <p className="mt-0.5 text-xs text-gray-400">{formatFileSize(file.size)}</p>
                  </div>
                  <a
                    href={fileUrl(file)}
                    target="_blank"
                    rel="noreferrer"
                    className="shrink-0 text-xs font-medium text-blue-700 hover:underline"
                  >
                    Открыть
                  </a>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-3 text-center text-xs text-gray-400">
          После загрузки накладные появятся здесь с превью и кнопкой удаления
        </p>
      )}

      {preview && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Предпросмотр ${preview.name}`}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 sm:p-6"
          onClick={() => setPreview(null)}
        >
          <div
            className="flex max-h-full w-full max-w-5xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
              <p className="min-w-0 truncate text-sm font-medium">{preview.name}</p>
              <div className="flex shrink-0 items-center gap-3">
                {allowDelete && (
                  <button
                    type="button"
                    onClick={() => void removeFile(preview)}
                    disabled={deleting === preview.uuid}
                    className="text-sm font-medium text-red-700 hover:underline disabled:opacity-50"
                  >
                    Удалить
                  </button>
                )}
                <a
                  href={fileUrl(preview)}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm font-medium text-blue-700 hover:underline"
                >
                  Открыть отдельно
                </a>
                <button
                  type="button"
                  onClick={() => setPreview(null)}
                  className="rounded-md bg-gray-100 px-3 py-1.5 text-sm font-medium hover:bg-gray-200"
                >
                  Закрыть
                </button>
              </div>
            </div>
            <div className="relative min-h-0 flex-1 overflow-auto bg-gray-950 p-2 sm:p-4">
              <Image
                unoptimized
                src={fileUrl(preview)}
                alt={preview.name}
                width={1600}
                height={1200}
                loading="eager"
                className="mx-auto h-auto max-h-[calc(100vh-8rem)] w-auto max-w-full object-contain"
              />
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
