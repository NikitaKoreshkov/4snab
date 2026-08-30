// Разовый скрипт: создаёт кастомные поля сделок для веб-инструмента склада.
// Идемпотентен — существующие поля с такими именами не дублирует.
//
// Запуск:  node --env-file=.env.local scripts/create-fields.mjs

const subdomain = process.env.AMOCRM_SUBDOMAIN;
const token = process.env.AMOCRM_ACCESS_TOKEN;
if (!subdomain || !token) {
  console.error("Нужны AMOCRM_SUBDOMAIN и AMOCRM_ACCESS_TOKEN в .env.local");
  process.exit(1);
}
const h = subdomain.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
const base = `https://${h.includes(".") ? h : `${h}.amocrm.ru`}`;

async function amo(path, init = {}) {
  const res = await fetch(new URL(path, base), {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) {
    console.error(`Ошибка ${res.status} на ${path}:\n${JSON.stringify(json, null, 2)}`);
    process.exit(1);
  }
  return json;
}

const WANT = [
  { key: "AMOCRM_FIELD_UNIT_PRICE", name: "Цена за единицу (склад)", type: "numeric" },
  { key: "AMOCRM_FIELD_DELIVERY_COST", name: "Стоимость доставки (склад)", type: "numeric" },
  { key: "AMOCRM_FIELD_BUDGET", name: "Бюджет отгрузки (склад)", type: "numeric" },
  { key: "AMOCRM_FIELD_WAYBILL", name: "Накладная (склад)", type: "file" },
  { key: "AMOCRM_FIELD_WAYBILL_PHOTO", name: "Фото подписанной накладной (склад)", type: "file" },
  { key: "AMOCRM_FIELD_SOURCE_LEAD", name: "Исходная сделка диспетчера (ID)", type: "numeric" },
];

// собрать существующие поля
const existing = [];
let page = 1;
for (;;) {
  const data = await amo(`/api/v4/leads/custom_fields?page=${page}&limit=250`);
  const chunk = data._embedded?.custom_fields ?? [];
  existing.push(...chunk);
  if (chunk.length < 250) break;
  page += 1;
}
const byName = new Map(existing.map((f) => [f.name.toLowerCase(), f]));

const toCreate = WANT.filter((w) => !byName.has(w.name.toLowerCase()));
let created = [];
if (toCreate.length) {
  const data = await amo("/api/v4/leads/custom_fields", {
    method: "POST",
    body: JSON.stringify(toCreate.map((w) => ({ name: w.name, type: w.type }))),
  });
  created = data._embedded?.custom_fields ?? [];
}
const createdByName = new Map(created.map((f) => [f.name.toLowerCase(), f]));

console.log("\n# Впишите в .env.local:\n");
for (const w of WANT) {
  const f = createdByName.get(w.name.toLowerCase()) ?? byName.get(w.name.toLowerCase());
  const tag = createdByName.has(w.name.toLowerCase()) ? "создано" : "уже было";
  console.log(`${w.key}=${f.id}   # «${f.name}» (${tag})`);
}
console.log();
