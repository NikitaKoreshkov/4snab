// Форматирование для интерфейса. Валюта — тенге (₸).

const money = new Intl.NumberFormat("ru-RU", {
  style: "currency",
  currency: "KZT",
  maximumFractionDigits: 0,
});

export function formatMoney(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return money.format(value);
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "дата не указана";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "дата не указана";
  return d.toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}
