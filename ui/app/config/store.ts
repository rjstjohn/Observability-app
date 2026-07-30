/**
 * Persistence for the environment configuration.
 *
 * Stored as ONE App Settings v2 object (schemaId `coverage-config`, multiObject: false)
 * holding the config as a JSON string in `configJson`. App settings are environment-scoped
 * and shared across users, which is what an admin config needs — unlike app *state*, they
 * also give a read/write permission split and optimistic locking.
 */
import { appSettingsObjectsClient } from "@dynatrace-sdk/client-app-settings-v2";
import { type AppConfig, normalizeConfig } from "./types";

export const CONFIG_SCHEMA_ID = "coverage-config";

export interface LoadedConfig {
  config: AppConfig;
  /** Undefined until the object has been saved once. */
  objectId?: string;
  /** Optimistic-locking token; must be passed back on update. */
  version?: string;
  /** False when no object exists yet (fresh install). */
  exists: boolean;
}

/** Read the config object. Returns a normalized (never-undefined) config. */
export async function loadConfig(): Promise<LoadedConfig> {
  const res = await appSettingsObjectsClient.getAppSettingsObjects({
    schemaId: CONFIG_SCHEMA_ID,
    addFields: "value,objectId,version",
  });
  const item = res.items?.[0];
  const value = item?.value as { configJson?: unknown } | undefined;
  const raw = value?.configJson;

  let parsed: unknown = {};
  if (typeof raw === "string" && raw.trim() && raw.trim() !== "{}") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Corrupt/hand-edited JSON: fall back to defaults rather than crashing the app.
      parsed = {};
    }
  }

  return {
    config: normalizeConfig(parsed),
    objectId: item?.objectId,
    version: item?.version,
    exists: !!item?.objectId,
  };
}

/**
 * Create or update the config object. Returns the new objectId/version so the caller can
 * keep its optimistic-locking token current without a full reload.
 */
export async function saveConfig(
  next: AppConfig,
  current: Pick<LoadedConfig, "objectId" | "version">
): Promise<{ objectId?: string; version?: string }> {
  const value = { configJson: JSON.stringify(next) };

  if (!current.objectId) {
    const created = await appSettingsObjectsClient.postAppSettingsObject({
      body: { schemaId: CONFIG_SCHEMA_ID, value },
    });
    const objectId = (created as { objectId?: string } | undefined)?.objectId;
    // Everyone using the app must be able to READ the config, or their queries can't run.
    // Write stays restricted to whoever holds app-settings:objects:write.
    if (objectId) {
      try {
        await appSettingsObjectsClient.putAppSettingsAllUsersPermissionByObjectId({
          objectId,
          body: { permissions: ["r"] },
        });
      } catch {
        // Non-fatal: the object saved. Surface nothing here; the Configuration page
        // reports read-visibility separately if other users can't load it.
      }
    }
    return { objectId, version: (created as { version?: string } | undefined)?.version };
  }

  const updated = await appSettingsObjectsClient.putAppSettingsObjectByObjectId({
    objectId: current.objectId,
    optimisticLockingVersion: current.version ?? "",
    body: { value },
  });
  return {
    objectId: current.objectId,
    version: (updated as { version?: string } | undefined)?.version,
  };
}

/** Can the current user modify the configuration? Drives read-only mode on the config page. */
export async function canWriteConfig(): Promise<boolean> {
  try {
    const res = await appSettingsObjectsClient.resolveEffectivePermissions({
      body: {
        permissions: [
          { permission: "app-settings:objects:write", context: { schemaId: CONFIG_SCHEMA_ID } },
        ],
      },
    });
    // The SDK returns `EffectivePermissions`, which IS the array (it extends Array) — not an
    // object with a `.permissions` field. Reading `.permissions` here made this always
    // undefined, so every user (admins included) was forced into read-only.
    const granted = Array.isArray(res) ? res[0]?.granted : undefined;
    // "condition" means granted subject to a context we already supplied — treat as allowed.
    return granted === "true" || granted === "condition";
  } catch {
    // If the check itself is not permitted, assume read-only rather than showing a Save
    // button that will 403.
    return false;
  }
}
