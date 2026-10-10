import Link from "next/link";
import { DEMO_TOKEN, isDemoMode } from "../lib/demoStore";

export default function Home() {
  const demo = isDemoMode();
  return (
    <main className="mx-auto max-w-lg px-4 py-16 text-center">
      <h1 className="text-lg font-semibold">Интерфейс зав. склада</h1>
      <p className="mt-2 text-sm text-gray-500">
        Откройте персональную ссылку, которую вам выдали, вида
        <code className="mx-1 rounded bg-gray-100 px-1">/s/&lt;ваш-код&gt;</code>.
      </p>
      {demo && (
        <div className="mt-6 rounded-lg border border-gray-200 p-4 text-left text-sm">
          <p className="font-medium">Демо-режим</p>
          <p className="mt-1 text-gray-500">
            amoCRM и база склада не подключены, список заполнен примерами заявок. Черновики
            сохраняются в памяти процесса, загрузка накладных отключена.
          </p>
          <Link
            href={`/s/${DEMO_TOKEN}`}
            className="mt-3 inline-block rounded bg-gray-900 px-4 py-2 text-white"
          >
            Открыть демо-заявки
          </Link>
        </div>
      )}
    </main>
  );
}
