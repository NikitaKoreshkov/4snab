// Выводит воронки, этапы и кастомные поля сделок из amoCRM,
// чтобы заполнить ID в .env.local.
//
// Запуск:  npm run discover
// Требует в .env.local: AMOCRM_SUBDOMAIN, AMOCRM_ACCESS_TOKEN

const subdomain = process.env.AMOCRM_SUBDOMAIN;
const token = process.env.AMOCRM_ACCESS_TOKEN;

if (!subdomain || !token) {
  console.error("Заполните AMOCRM_SUBDOMAIN и AMOCRM_ACCESS_TOKEN в .env.local");
  process.exit(1);
}

const base = `https://${subdomain}.amocrm.ru`;

async function amo(path) {
  const res = await fetch(new URL(path, base), {
    headers: { Authorization: `Bearer ${token}` },
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`Ошибка ${res.status} на ${path}:\n${text}`);
    process.exit(1);
  }
  return text ? JSON.parse(text) : {};
}

const STATUS_TYPE = { 0: "обычный", 1: "успех", 2: "закрыт-неуспех" };

console.log(`\n=== Аккаунт: ${base} ===\n`);

const pipelines = (await amo("/api/v4/leads/pipelines"))._embedded?.pipelines ?? [];
console.log("── ВОРОНКИ И ЭТАПЫ ─────────────────────────────────────────");
for (const p of pipelines) {
  console.log(`\nВоронка «${p.name}»  (pipeline_id = ${p.id})${p.is_main ? "  [основная]" : ""}`);
  for (const s of p._embedded?.statuses ?? []) {
    console.log(`   status_id ${String(s.id).padEnd(10)} «${s.name}»  (${STATUS_TYPE[s.type] ?? s.type})`);
  }
}

const fields = [];
let page = 1;
for (;;) {
  const data = await amo(`/api/v4/leads/custom_fields?page=${page}&limit=250`);
  const chunk = data._embedded?.custom_fields ?? [];
  fields.push(...chunk);
  if (chunk.length < 250) break;
  page += 1;
}

console.log("\n── КАСТОМНЫЕ ПОЛЯ СДЕЛОК ───────────────────────────────────");
for (const f of fields) {
  console.log(`   field_id ${String(f.id).padEnd(10)} «${f.name}»  тип: ${f.type}${f.code ? `  code: ${f.code}` : ""}`);
  if (f.enums?.length) {
    for (const e of f.enums) console.log(`        ├─ enum_id ${e.id}  «${e.value}»`);
  }
}

console.log("\nГотово. Перенесите нужные ID в .env.local\n");
