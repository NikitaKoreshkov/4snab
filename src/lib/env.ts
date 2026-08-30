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

export const env = {
  amocrm: {
    get subdomain() {
      return req("AMOCRM_SUBDOMAIN");
    },
    get accessToken() {
      return req("AMOCRM_ACCESS_TOKEN");
    },
    get baseUrl() {
      return `https://${req("AMOCRM_SUBDOMAIN")}.amocrm.ru`;
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
  fields: {
    dispatch: {
      get shipDate() {
        return opt("AMOCRM_DISPATCH_FIELD_SHIP_DATE");
      },
      get company() {
        return opt("AMOCRM_DISPATCH_FIELD_COMPANY");
      },
      get quantity() {
        return opt("AMOCRM_DISPATCH_FIELD_QUANTITY");
      },
    },
    sklad: {
      get shipDate() {
        return opt("AMOCRM_SKLAD_FIELD_SHIP_DATE");
      },
      get company() {
        return opt("AMOCRM_SKLAD_FIELD_COMPANY");
      },
      get quantity() {
        return opt("AMOCRM_SKLAD_FIELD_QUANTITY");
      },
      get unitPrice() {
        return opt("AMOCRM_SKLAD_FIELD_UNIT_PRICE");
      },
      get deliveryCost() {
        return opt("AMOCRM_SKLAD_FIELD_DELIVERY_COST");
      },
      get budget() {
        return opt("AMOCRM_SKLAD_FIELD_BUDGET");
      },
    },
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
