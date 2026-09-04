// One-off live check against amoCRM using .env.local / .env.local.example.
// Does not create, update, or unlink anything.

const subdomain = process.env.AMOCRM_SUBDOMAIN;
const token = process.env.AMOCRM_ACCESS_TOKEN;
if (!subdomain || !token) {
  console.error("Нет AMOCRM_SUBDOMAIN / AMOCRM_ACCESS_TOKEN");
  process.exit(1);
}

const host = subdomain.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
const base = `https://${host.includes(".") ? host : `${host}.amocrm.ru`}`;

const ids = {
  dispatchPipeline: process.env.AMOCRM_DISPATCH_PIPELINE_ID,
  shipping: process.env.AMOCRM_DISPATCH_SHIPPING_STATUS_ID,
  waybill: process.env.AMOCRM_DISPATCH_WAYBILL_STATUS_ID,
  skladPipeline: process.env.AMOCRM_SKLAD_PIPELINE_ID,
  skladNew: process.env.AMOCRM_SKLAD_NEW_STATUS_ID,
  skladDone: process.env.AMOCRM_SKLAD_DONE_STATUS_ID,
  sourceField: process.env.AMOCRM_FIELD_SOURCE_LEAD,
  companyField: process.env.AMOCRM_FIELD_COMPANY,
  materialField: process.env.AMOCRM_FIELD_MATERIAL,
};

function query(params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, String(value));
  }
  return search;
}

async function amo(path, params = {}, init = {}) {
  const url = new URL(path, base);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
  }
  const started = performance.now();
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  const ms = Math.round(performance.now() - started);
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = text;
  }
  return { ok: res.ok, status: res.status, ms, json, headers: res.headers };
}

function fail(label, result) {
  const body =
    result.json && typeof result.json === "object"
      ? JSON.stringify(result.json).slice(0, 400)
      : String(result.json ?? "").slice(0, 400);
  throw new Error(`${label}: HTTP ${result.status} (${result.ms}ms) ${body}`);
}

const report = [];
function log(line) {
  report.push(line);
  console.log(line);
}

try {
  log(`Аккаунт: ${base}`);

  const account = await amo("/api/v4/account", { with: "drive_url" });
  if (!account.ok) fail("GET /account", account);
  log(
    `OK  account ${account.ms}ms  name=${account.json.name}  drive=${account.json.drive_url ? "yes" : "no"}`,
  );
  const driveUrl = account.json.drive_url;

  const pipelines = await amo("/api/v4/leads/pipelines");
  if (!pipelines.ok) fail("GET pipelines", pipelines);
  const all = pipelines.json._embedded?.pipelines ?? [];
  const byId = new Map(all.map((p) => [String(p.id), p]));
  for (const [label, id] of [
    ["dispatch", ids.dispatchPipeline],
    ["sklad", ids.skladPipeline],
  ]) {
    const p = byId.get(String(id));
    if (!p) throw new Error(`Воронка ${label} id=${id} не найдена`);
    const statuses = new Map((p._embedded?.statuses ?? []).map((s) => [String(s.id), s.name]));
    log(`OK  pipeline «${p.name}» id=${p.id}`);
    if (label === "dispatch") {
      for (const [name, statusId] of [
        ["shipping", ids.shipping],
        ["waybill", ids.waybill],
      ]) {
        if (!statuses.has(String(statusId))) {
          throw new Error(`Этап ${name} id=${statusId} нет в воронке «${p.name}»`);
        }
        log(`    этап ${name}: «${statuses.get(String(statusId))}»`);
      }
    } else {
      for (const [name, statusId] of [
        ["new", ids.skladNew],
        ["done", ids.skladDone],
      ]) {
        if (!statuses.has(String(statusId))) {
          throw new Error(`Этап ${name} id=${statusId} нет в воронке «${p.name}»`);
        }
        log(`    этап ${name}: «${statuses.get(String(statusId))}»`);
      }
    }
  }

  const fields = [];
  let page = 1;
  for (;;) {
    const data = await amo("/api/v4/leads/custom_fields", { page, limit: 250 });
    if (!data.ok) fail("GET custom_fields", data);
    const chunk = data.json._embedded?.custom_fields ?? [];
    fields.push(...chunk);
    if (chunk.length < 250) break;
    page += 1;
  }
  const fieldById = new Map(fields.map((f) => [String(f.id), f]));
  for (const [label, id] of [
    ["source", ids.sourceField],
    ["company", ids.companyField],
    ["material", ids.materialField],
  ]) {
    const field = fieldById.get(String(id));
    if (!field) throw new Error(`Поле ${label} id=${id} не найдено`);
    log(`OK  field ${label}: «${field.name}» type=${field.type}`);
  }

  const openList = await amo("/api/v4/leads", {
    "filter[pipeline_id]": ids.skladPipeline,
    "filter[statuses][0][pipeline_id]": ids.skladPipeline,
    "filter[statuses][0][status_id]": ids.skladNew,
    limit: 250,
  });
  if (!openList.ok) fail("list open warehouse leads", openList);
  const openLeads = openList.json?._embedded?.leads ?? [];
  log(`OK  open warehouse leads ${openList.ms}ms  count=${openLeads.length}`);

  const doneCount = await amo("/api/v4/leads", {
    "filter[pipeline_id]": ids.skladPipeline,
    "filter[statuses][0][pipeline_id]": ids.skladPipeline,
    "filter[statuses][0][status_id]": ids.skladDone,
    limit: 1,
  });
  if (!doneCount.ok) fail("count done warehouse leads", doneCount);
  const totalHeader =
    doneCount.headers.get("X-Total-Count") ?? doneCount.headers.get("x-total-count");
  log(
    `OK  done count ${doneCount.ms}ms  X-Total-Count=${totalHeader ?? "нет"}  page_items=${doneCount.json?._embedded?.leads?.length ?? 0}  _total_items=${doneCount.json?._total_items ?? "нет"}`,
  );

  const sample =
    openLeads.find((lead) =>
      lead.custom_fields_values?.some(
        (field) =>
          String(field.field_id) === String(ids.sourceField) && field.values?.[0]?.value,
      ),
    ) ?? openLeads[0];
  if (sample) {
    const sourceValue = sample.custom_fields_values?.find(
      (field) => String(field.field_id) === String(ids.sourceField),
    )?.values?.[0]?.value;
    log(`OK  sample warehouse lead id=${sample.id} source=${sourceValue ?? "пусто"}`);

    const tagged = await amo(`/api/v4/leads/${sample.id}`, { with: "tags" });
    if (!tagged.ok) fail("GET lead with tags", tagged);
    const tags = tagged.json._embedded?.tags?.map((t) => t.name) ?? [];
    log(`OK  getLead with=tags ${tagged.ms}ms  tags=${tags.length ? tags.join(", ") : "нет"}`);

    const files = await amo(`/api/v4/leads/${sample.id}/files`, { limit: 50 });
    if (!files.ok) fail("GET lead files", files);
    const fileLinks = files.json?._embedded?.files ?? [];
    log(`OK  lead files ${files.ms}ms  linked=${fileLinks.length}`);

    if (sourceValue) {
      const filtered = await amo("/api/v4/leads", {
        query: String(sourceValue),
        "filter[pipeline_id]": ids.skladPipeline,
        limit: 10,
      });
      if (!filtered.ok && filtered.status !== 204) fail("query by source id", filtered);
      const found = filtered.json?._embedded?.leads ?? [];
      log(
        `OK  query+pipeline ${filtered.ms}ms  HTTP ${filtered.status}  found=${found.length}`,
      );
    }

    if (fileLinks[0]?.file_uuid && driveUrl) {
      const drive = await fetch(
        `${driveUrl.replace(/\/$/, "")}/v1.0/files?${query({
          "filter[uuid]": fileLinks[0].file_uuid,
          limit: 1,
        })}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const driveMs = 0;
      const driveJson = await drive.json().catch(() => ({}));
      log(
        `${drive.ok ? "OK" : "FAIL"} Files API GET /v1.0/files HTTP ${drive.status}  files=${driveJson._embedded?.files?.length ?? 0}`,
      );
    }
  } else {
    log("WARN нет складских сделок в этапах new/done — filter/files на образце пропущены");
  }

  if (driveUrl) {
    const filesIndex = await fetch(`${driveUrl.replace(/\/$/, "")}/v1.0/files?limit=1`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const filesBody = await filesIndex.text();
    log(
      filesIndex.ok
        ? `OK  Files API GET /v1.0/files HTTP ${filesIndex.status}  body=${filesBody.slice(0, 80) ? "json" : "empty"}`
        : `FAIL Files API GET /v1.0/files HTTP ${filesIndex.status} ${filesBody.slice(0, 200)}`,
    );
  }

  const both = await amo("/api/v4/leads", {
    "filter[pipeline_id]": ids.skladPipeline,
    "filter[statuses][0][pipeline_id]": ids.skladPipeline,
    "filter[statuses][0][status_id]": ids.skladNew,
    "filter[statuses][1][pipeline_id]": ids.skladPipeline,
    "filter[statuses][1][status_id]": ids.skladDone,
    limit: 250,
  });
  if (!both.ok) fail("list open+done together", both);
  log(
    `OK  open+done together ${both.ms}ms  count=${both.json?._embedded?.leads?.length ?? 0}`,
  );

  log("\nИтог: живые API из env отвечают, ID воронок/этапов/полей совпадают.");
} catch (error) {
  console.error("\nFAIL", error instanceof Error ? error.message : error);
  process.exit(1);
}
