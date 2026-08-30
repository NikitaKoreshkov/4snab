import Link from "next/link";
import { notFound } from "next/navigation";
import { getUserByToken } from "@/lib/auth";
import { listRequests } from "@/lib/requests";
import { formatMoney, formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function RequestsListPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const user = getUserByToken(token);
  if (!user) notFound();

  const requests = await listRequests();
  const open = requests.filter((r) => !r.isDone);
  const done = requests.filter((r) => r.isDone);

  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <header className="mb-6">
        <h1 className="text-xl font-semibold">Заявки на отгрузку</h1>
        <p className="text-sm text-gray-500">{user.name}</p>
      </header>

      <section className="mb-8">
        <h2 className="mb-2 text-sm font-medium text-gray-500">
          Новые ({open.length})
        </h2>
        {open.length === 0 ? (
          <p className="rounded-lg border border-dashed p-4 text-sm text-gray-400">
            Новых заявок нет
          </p>
        ) : (
          <ul className="space-y-2">
            {open.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/s/${token}/${r.id}`}
                  className="block rounded-lg border p-4 transition hover:border-gray-400 active:bg-gray-50"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-medium">{r.company ?? r.name}</span>
                    <span className="shrink-0 text-sm text-gray-500">
                      {formatDate(r.shipDate)}
                    </span>
                  </div>
                  <div className="mt-1 text-sm text-gray-500">
                    {r.quantity != null ? `${r.quantity} ед.` : "кол-во не указано"}
                    {r.budget != null && ` · ${formatMoney(r.budget)}`}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {done.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-medium text-gray-500">
            Готово ({done.length})
          </h2>
          <ul className="space-y-2">
            {done.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/s/${token}/${r.id}`}
                  className="block rounded-lg border bg-gray-50 p-4 text-gray-500 transition hover:border-gray-400"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-medium">{r.company ?? r.name}</span>
                    <span className="shrink-0 text-sm">{formatDate(r.shipDate)}</span>
                  </div>
                  <div className="mt-1 text-sm">
                    {r.budget != null && formatMoney(r.budget)}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
