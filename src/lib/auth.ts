// Авторизация зав.склада по именной ссылке: /s/<token>
// Список пользователей задаётся в WAREHOUSE_USERS:  token:Имя,token2:Имя2
import "server-only";
import { env } from "./env";

export interface WarehouseUser {
  token: string;
  name: string;
}

function parseUsers(): WarehouseUser[] {
  const raw = env.warehouseUsersRaw;
  if (!raw) return [];
  return raw
    .split(",")
    .map((pair) => pair.trim())
    .filter(Boolean)
    .map((pair) => {
      const idx = pair.indexOf(":");
      const token = (idx === -1 ? pair : pair.slice(0, idx)).trim();
      const name = (idx === -1 ? "" : pair.slice(idx + 1)).trim() || "Зав. склада";
      return { token, name };
    })
    .filter((u) => u.token.length >= 8);
}

export function getUserByToken(token: string): WarehouseUser | null {
  if (!token) return null;
  return parseUsers().find((u) => u.token === token) ?? null;
}

/** Бросает, если токен неизвестен. Использовать в API-роутах. */
export function requireUser(token: string | null | undefined): WarehouseUser {
  const user = token ? getUserByToken(token) : null;
  if (!user) {
    throw new AuthError();
  }
  return user;
}

export class AuthError extends Error {
  constructor() {
    super("Доступ запрещён");
    this.name = "AuthError";
  }
}
