// Централизованный доступ к переменным окружения.
// Токен amoCRM читается только здесь и никогда не уходит в браузер.
// Все обращения ленивые (через геттеры), чтобы сборка не падала без .env.

function req(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Не задана переменная окружения ${name} (см. .env.local.example)`);
  }
  return value;
}

function opt(name: string): string | undefined {
  return process.env[name] || undefined;
}

/** Принимает "company", "company.amocrm.ru" или "https://company.amocrm.ru" → "company.amocrm.ru". */
export function normalizeAmoHost(value: string): string {
  const raw = value
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");
  return raw.includes(".") ? raw : `${raw}.amocrm.ru`;
}

export const env = {
  amocrm: {
    get accessToken() {
      return req("AMOCRM_ACCESS_TOKEN");
    },
    get baseUrl() {
      return `https://${normalizeAmoHost(req("AMOCRM_SUBDOMAIN"))}`;
    },
  },
  pipelines: {
    get dispatchId() {
      return opt("AMOCRM_DISPATCH_PIPELINE_ID");
    },
    get dispatchShippingStatusId() {
      return opt("AMOCRM_DISPATCH_SHIPPING_STATUS_ID");
    },
    get skladId() {
      return opt("AMOCRM_SKLAD_PIPELINE_ID");
    },
    get skladNewStatusId() {
      return opt("AMOCRM_SKLAD_NEW_STATUS_ID");
    },
    get skladDoneStatusId() {
      return opt("AMOCRM_SKLAD_DONE_STATUS_ID");
    },
  },
  // Кастомные поля сделок в amoCRM общие для всех воронок,
  // поэтому одни и те же ID и для чтения из «Диспетчера», и для записи в «Склад».
  fields: {
    get shipDate() {
      return opt("AMOCRM_FIELD_SHIP_DATE");
    },
    get company() {
      return opt("AMOCRM_FIELD_COMPANY");
    },
    get quantity() {
      return opt("AMOCRM_FIELD_QUANTITY");
    },
    get unitPrice() {
      return opt("AMOCRM_FIELD_UNIT_PRICE");
    },
    get deliveryCost() {
      return opt("AMOCRM_FIELD_DELIVERY_COST");
    },
    get budget() {
      return opt("AMOCRM_FIELD_BUDGET");
    },
    get waybill() {
      return opt("AMOCRM_FIELD_WAYBILL");
    },
    get waybillPhoto() {
      return opt("AMOCRM_FIELD_WAYBILL_PHOTO");
    },
    get sourceLead() {
      return opt("AMOCRM_FIELD_SOURCE_LEAD");
    },
  },
  get processedTag() {
    return opt("AMOCRM_PROCESSED_TAG") ?? "Склад: заявка создана";
  },
  get webhookSecret() {
    return opt("AMOCRM_WEBHOOK_SECRET");
  },
  get warehouseUsersRaw() {
    return opt("WAREHOUSE_USERS");
  },
  get appBaseUrl() {
    return opt("APP_BASE_URL") ?? "http://localhost:3000";
  },
};

/** Требует, чтобы ID был настроен; иначе понятная ошибка. */
export function requireId(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(
      `Не настроен ID «${name}». Запустите \`npm run discover\` и заполните .env.local`,
    );
  }
  return value;
}
