import Link from "next/link";
import { notFound } from "next/navigation";
import { getUserByToken } from "@/lib/auth";
import { formatDate, formatMoney } from "@/lib/format";
import { countRequests, listRequests, type ShipmentRequest } from "@/lib/requests";

export const dynamic = "force-dynamic";

function MaterialsSummary({ request }: { request: ShipmentRequest }) {
  const shown = request.materials.slice(0, 2);
  const rest = request.materials.length - shown.length;
  if (!shown.length) return <span className="text-red-600">материал не указан</span>;
  return (
    <span>
      {shown.map((material) => material.name).join(", ")}
      {rest > 0 && ` +${rest}`}
    </span>
  );
}

function RequestCard({ request, token }: { request: ShipmentRequest; token: string }) {
  return (
    <Link
      href={`/s/${token}/${request.id}`}
      className="block rounded-xl border bg-white p-4 transition hover:border-gray-400 hover:shadow-sm active:bg-gray-50"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-medium">{request.company ?? request.name}</div>
          <div className="mt-1 truncate text-sm text-gray-600">
            <MaterialsSummary request={request} />
          </div>
        </div>
        <span className="shrink-0 text-sm text-gray-500">
          {formatDate(request.shipDate)}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t pt-3 text-xs text-gray-500">
        <span>
          План: <strong className="font-medium text-gray-800">{request.planQuantity ?? "—"}</strong>
        </span>
        {request.budget !== null && <span>Итог: {formatMoney(request.budget)}</span>}
        {request.draft.status === "completing" && (
          <span className="rounded bg-amber-100 px-2 py-0.5 text-amber-800">
            повторить передачу
          </span>
        )}
        {request.syncIssue && (
          <span className="rounded bg-red-100 px-2 py-0.5 text-red-700">
            нет связи с диспетчером
          </span>
        )}
        {request.isDone && request.draft.completedAt && (
          <span>
            Завершено: {new Date(request.draft.completedAt).toLocaleString("ru-RU", {
              day: "2-digit",
              month: "2-digit",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        )}
      </div>
    </Link>
  );
}

export default async function RequestsListPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ view?: string | string[]; completed?: string | string[] }>;
}) {
  const { token } = await params;
  const query = await searchParams;
  const user = getUserByToken(token);
  if (!user) notFound();

  const historySelected = query.view === "history";
  const completed = query.completed === "1";
  const [requests, otherCount] = await Promise.all([
    listRequests(user.name, { scope: historySelected ? "done" : "open" }),
    countRequests(historySelected ? "open" : "done").catch(() => 0),
  ]);
  const openCount = historySelected ? otherCount : requests.length;
  const doneCount = historySelected ? requests.length : otherCount;
  const visible = requests;

  return (
    <main className="mx-auto max-w-3xl px-4 py-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Заявки на отгрузку</h1>
        <p className="text-sm text-gray-500">{user.name}</p>
      </header>

      <nav className="mb-5 grid grid-cols-2 rounded-xl bg-gray-100 p-1" aria-label="Заявки">
        <Link
          href={`/s/${token}`}
          className={`rounded-lg px-3 py-2 text-center text-sm font-medium transition ${
            !historySelected ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-900"
          }`}
        >
          В работе ({openCount})
        </Link>
        <Link
          href={`/s/${token}?view=history`}
          className={`rounded-lg px-3 py-2 text-center text-sm font-medium transition ${
            historySelected ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-900"
          }`}
        >
          История ({doneCount})
        </Link>
      </nav>

      {completed && !historySelected && (
        <p className="mb-5 rounded-xl bg-green-50 p-4 text-sm text-green-800">
          Заявка завершена и передана диспетчеру. Она перемещена в историю.
        </p>
      )}

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
          {historySelected ? "Завершённые заявки" : "Текущие заявки"}
        </h2>
        {visible.length === 0 ? (
          <div className="rounded-xl border border-dashed px-5 py-10 text-center">
            <div className="text-3xl" aria-hidden="true">
              {historySelected ? "🗂️" : "✓"}
            </div>
            <p className="mt-3 font-medium text-gray-700">
              {historySelected ? "История пока пуста" : "Все текущие заявки убраны"}
            </p>
            <p className="mt-1 text-sm text-gray-400">
              {historySelected
                ? "Завершённые складом заявки появятся здесь"
                : "Новая заявка появится автоматически после отправки диспетчером"}
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {visible.map((request) => (
              <li key={request.id}>
                <RequestCard request={request} token={token} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
