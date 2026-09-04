import Link from "next/link";
import { notFound } from "next/navigation";
import { getUserByToken } from "@/lib/auth";
import { formatDate, formatMoney } from "@/lib/format";
import { getRequest, listRequestFiles, type RequestFile } from "@/lib/requests";
import { RequestFiles } from "./RequestFiles";
import { RequestForm } from "./RequestForm";

export const dynamic = "force-dynamic";

export default async function RequestPage({
  params,
}: {
  params: Promise<{ token: string; id: string }>;
}) {
  const { token, id } = await params;
  const user = getUserByToken(token);
  if (!user) notFound();

  const requestId = Number(id);
  if (!Number.isInteger(requestId) || requestId <= 0) notFound();

  const requestPromise = getRequest(requestId, user.name);
  const filesPromise = listRequestFiles(requestId, { refresh: false }).catch((error) => {
    console.error("RequestPage: не удалось получить накладные", error);
    return null;
  });

  let request;
  try {
    request = await requestPromise;
  } catch (error) {
    console.error("RequestPage", error);
    notFound();
  }

  const filesOrNull = await filesPromise;
  const files: RequestFile[] = filesOrNull ?? [];
  const filesError =
    filesOrNull === null
      ? "Не удалось получить накладные. Проверьте доступ к файлам amoCRM."
      : undefined;

  return (
    <main className="mx-auto max-w-3xl px-4 py-6">
      <Link href={`/s/${token}`} className="text-sm text-gray-500 hover:underline">
        ← К списку
      </Link>

      <header className="mt-3 mb-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">{request.company ?? request.name}</h1>
            <p className="mt-1 text-sm text-gray-500">Заявка склада #{request.id}</p>
          </div>
          <span
            className={
              request.isDone
                ? "rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-700"
                : request.draft.status === "completing"
                  ? "rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-800"
                  : "rounded-full bg-blue-100 px-3 py-1 text-xs font-medium text-blue-700"
            }
          >
            {request.isDone
              ? "Готово"
              : request.draft.status === "completing"
                ? "Ожидает повторной передачи"
                : "Черновик"}
          </span>
        </div>
      </header>

      <section className="mb-6 rounded-xl bg-slate-50 p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
          Задание от диспетчера
        </h2>
        <dl className="grid gap-x-5 gap-y-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-gray-500">Объект</dt>
            <dd className="font-medium">{request.company ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Когда</dt>
            <dd className="font-medium">{formatDate(request.shipDate)}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Общий план</dt>
            <dd className="font-medium">
              {request.planQuantity !== null ? request.planQuantity : "—"}
            </dd>
          </div>
          <div className="sm:col-span-3">
            <dt className="text-gray-500">Материалы</dt>
            <dd className="mt-1 flex flex-wrap gap-1.5">
              {request.materials.length ? (
                request.materials.map((material) => (
                  <span
                    key={material.enumId}
                    className="rounded-md border bg-white px-2 py-1 font-medium"
                  >
                    {material.name}
                  </span>
                ))
              ) : (
                <span className="font-medium text-red-700">Не выбраны в amoCRM</span>
              )}
            </dd>
          </div>
          {request.description && (
            <div className="sm:col-span-3">
              <dt className="text-gray-500">Описание</dt>
              <dd className="whitespace-pre-wrap font-medium">{request.description}</dd>
            </div>
          )}
          {request.isDone && request.budget !== null && (
            <div className="sm:col-span-3">
              <dt className="text-gray-500">Итог склада</dt>
              <dd className="text-lg font-semibold">{formatMoney(request.budget)}</dd>
            </div>
          )}
        </dl>
      </section>

      <RequestFiles
        token={token}
        id={request.id}
        initialFiles={files}
        initialError={filesError}
        allowDelete={request.draft.status !== "completing"}
      />

      <RequestForm
        token={token}
        id={request.id}
        draft={request.draft}
        isDone={request.isDone}
        blockedReason={request.syncIssue}
      />
    </main>
  );
}
