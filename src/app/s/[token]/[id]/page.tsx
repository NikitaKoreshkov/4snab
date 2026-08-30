import Link from "next/link";
import { notFound } from "next/navigation";
import { getUserByToken } from "@/lib/auth";
import { getRequest } from "@/lib/requests";
import { formatDate, formatMoney } from "@/lib/format";
import { RequestForm } from "./RequestForm";

export const dynamic = "force-dynamic";

export default async function RequestPage({
  params,
}: {
  params: Promise<{ token: string; id: string }>;
}) {
  const { token, id } = await params;
  if (!getUserByToken(token)) notFound();

  const requestId = Number(id);
  if (!Number.isInteger(requestId)) notFound();

  let request;
  try {
    request = await getRequest(requestId);
  } catch {
    notFound();
  }

  return (
    <main className="mx-auto max-w-lg px-4 py-6">
      <Link href={`/s/${token}`} className="text-sm text-gray-500 hover:underline">
        ← К списку
      </Link>

      <header className="mt-3 mb-6">
        <h1 className="text-xl font-semibold">{request.company ?? request.name}</h1>
        {request.isDone && (
          <span className="mt-1 inline-block rounded bg-green-100 px-2 py-0.5 text-xs text-green-700">
            Готово
          </span>
        )}
      </header>

      <dl className="mb-6 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
        <div>
          <dt className="text-gray-500">Дата отгрузки</dt>
          <dd className="font-medium">{formatDate(request.shipDate)}</dd>
        </div>
        <div>
          <dt className="text-gray-500">Компания / объект</dt>
          <dd className="font-medium">{request.company ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-gray-500">Количество материала</dt>
          <dd className="font-medium">
            {request.quantity != null ? `${request.quantity} ед.` : "—"}
          </dd>
        </div>
        <div>
          <dt className="text-gray-500">Текущий бюджет</dt>
          <dd className="font-medium">{formatMoney(request.budget)}</dd>
        </div>
      </dl>

      <RequestForm
        token={token}
        id={request.id}
        initialQuantity={request.quantity}
        initialUnitPrice={request.unitPrice}
        initialDeliveryCost={request.deliveryCost}
        isDone={request.isDone}
      />
    </main>
  );
}
