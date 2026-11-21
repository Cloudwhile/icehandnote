/*
 * Decoupled Data Storage Backend Hot-Switch Tab (`StudioSettingsPanel` Tab: `'storage'`).
 * Reuses `<SettingsSectionCard>`, `<RadioPillGroup>`, and `<PasswordInput>`.
 * Avoids flashing default `'local'` / `'icehandnote'` fields before `adminGetStorage` resolves.
 */

import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { EXT_COPY, UI_COPY } from '../../../lib/i18n';
import type {
  LocaleCode,
  PostgresConnectionFieldsDto,
  PostgresSslMode,
  StorageStatusDto,
} from '../../../lib/types';
import { RadioPillGroup, SwitchRow } from '../../ui/FormControls';
import { PasswordInput } from '../../ui/PasswordInput';
import { useToast } from '../../ui/ToastProvider';
import { SettingsSectionCard } from './SettingsSectionCard';

const DEFAULT_PG_FIELDS: PostgresConnectionFieldsDto = {
  host: '127.0.0.1',
  port: 5432,
  database: 'icehandnote',
  username: 'postgres',
  ssl_mode: 'prefer',
};

function normalizePgSslMode(raw: string | undefined): PostgresSslMode {
  switch ((raw ?? '').trim().toLowerCase()) {
    case 'disable':
      return 'disable';
    case 'require':
      return 'require';
    case 'verify-ca':
      return 'verify-ca';
    case 'verify-full':
      return 'verify-full';
    default:
      return 'prefer';
  }
}

function safeDecodeUriPart(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function tryParsePostgresUrlClient(
  rawUrl: string,
): { fields: PostgresConnectionFieldsDto; password?: string } | null {
  const trimmed = rawUrl.trim();
  const lower = trimmed.toLowerCase();
  let afterScheme = '';
  if (lower.startsWith('postgresql://')) {
    afterScheme = trimmed.slice('postgresql://'.length);
  } else if (lower.startsWith('postgres://')) {
    afterScheme = trimmed.slice('postgres://'.length);
  } else {
    return null;
  }

  const [beforeHash] = afterScheme.split('#');
  const qIdx = beforeHash.indexOf('?');
  const withoutQuery = qIdx >= 0 ? beforeHash.slice(0, qIdx) : beforeHash;
  const queryStr = qIdx >= 0 ? beforeHash.slice(qIdx + 1) : '';

  let ssl_mode: PostgresSslMode = 'prefer';
  if (queryStr) {
    for (const pair of queryStr.split('&')) {
      const eqIdx = pair.indexOf('=');
      if (eqIdx > 0) {
        const k = pair.slice(0, eqIdx).trim().toLowerCase();
        const v = safeDecodeUriPart(pair.slice(eqIdx + 1));
        if (k === 'sslmode') {
          ssl_mode = normalizePgSslMode(v);
        }
      }
    }
  }

  const atIdx = withoutQuery.lastIndexOf('@');
  let username = 'postgres';
  let password: string | undefined;
  let authorityAndPath = withoutQuery;

  if (atIdx >= 0) {
    const userinfo = withoutQuery.slice(0, atIdx);
    authorityAndPath = withoutQuery.slice(atIdx + 1);
    const colonIdx = userinfo.indexOf(':');
    if (colonIdx >= 0) {
      const u = safeDecodeUriPart(userinfo.slice(0, colonIdx));
      const p = userinfo.slice(colonIdx + 1);
      username = u.trim() || 'postgres';
      if (p && p !== '***') {
        password = safeDecodeUriPart(p);
      }
    } else {
      username = safeDecodeUriPart(userinfo).trim() || 'postgres';
    }
  }

  const slashIdx = authorityAndPath.indexOf('/');
  const hostPort =
    slashIdx >= 0 ? authorityAndPath.slice(0, slashIdx) : authorityAndPath;
  const dbRaw =
    slashIdx >= 0 ? authorityAndPath.slice(slashIdx + 1).replace(/\/+$/, '') : '';
  const database = safeDecodeUriPart(dbRaw).trim() || 'icehandnote';

  let host = '';
  let port = 5432;
  if (hostPort.startsWith('[')) {
    const closeIdx = hostPort.indexOf(']');
    if (closeIdx < 0) return null;
    host = hostPort.slice(1, closeIdx).trim();
    const afterClose = hostPort.slice(closeIdx + 1);
    if (afterClose.startsWith(':')) {
      const pNum = Number.parseInt(afterClose.slice(1), 10);
      if (Number.isFinite(pNum) && pNum >= 1 && pNum <= 65535) {
        port = pNum;
      }
    }
  } else {
    const colons = hostPort.split(':');
    if (colons.length === 2) {
      host = colons[0].trim();
      const pNum = Number.parseInt(colons[1], 10);
      if (Number.isFinite(pNum) && pNum >= 1 && pNum <= 65535) {
        port = pNum;
      }
    } else {
      host = hostPort.trim();
    }
  }

  if (!host) return null;

  return {
    fields: { host, port, database, username, ssl_mode },
    password,
  };
}

function buildPostgresUrlFromFieldsClient(
  fields: PostgresConnectionFieldsDto,
  passwordToken: string | null,
): string {
  const rawHost =
    fields.host.trim().replace(/^\[|\]$/g, '').trim() || '127.0.0.1';
  const hostFmt = rawHost.includes(':') ? `[${rawHost}]` : rawHost;
  const port = fields.port >= 1 && fields.port <= 65535 ? fields.port : 5432;
  const user = encodeURIComponent(fields.username.trim() || 'postgres');
  const db = encodeURIComponent(fields.database.trim() || 'icehandnote');
  const ssl = normalizePgSslMode(fields.ssl_mode);
  const auth = passwordToken ? `${user}:${passwordToken}` : user;
  return `postgres://${auth}@${hostFmt}:${port}/${db}?sslmode=${ssl}`;
}

export function StorageSettingsTab({ locale }: { locale: LocaleCode }) {
  const st = UI_COPY[locale].studio.settings;
  const extSettings = EXT_COPY[locale].settings;
  const toast = useToast();

  const [loaded, setLoaded] = useState(false);
  const [storageStatus, setStorageStatus] = useState<StorageStatusDto | null>(null);
  const [storageMode, setStorageMode] = useState<'local' | 'postgres'>('local');
  const [pgInputMode, setPgInputMode] = useState<'fields' | 'url'>('fields');
  const [pgFields, setPgFields] =
    useState<PostgresConnectionFieldsDto>(DEFAULT_PG_FIELDS);
  const [savedPgBaseline, setSavedPgBaseline] =
    useState<PostgresConnectionFieldsDto>(DEFAULT_PG_FIELDS);
  const [pgPortText, setPgPortText] = useState('5432');
  const [hasSavedPgPassword, setHasSavedPgPassword] = useState(false);
  const [pgPasswordInput, setPgPasswordInput] = useState('');
  const [clearPgPassword, setClearPgPassword] = useState(false);
  const [postgresUrl, setPostgresUrl] = useState('');
  const [syncContent, setSyncContent] = useState(true);
  const [testingStorage, setTestingStorage] = useState(false);
  const [switchingStorage, setSwitchingStorage] = useState(false);

  useEffect(() => {
    let active = true;
    void api
      .adminGetStorage()
      .then((stRes) => {
        if (!active) return;
        setStorageStatus(stRes);
        setStorageMode(stRes.active_backend);
        setPostgresUrl(stRes.database_url_masked || '');
        const incomingPg: PostgresConnectionFieldsDto = stRes.postgres
          ? {
              host: stRes.postgres.host || '127.0.0.1',
              port: stRes.postgres.port || 5432,
              database: stRes.postgres.database || 'icehandnote',
              username: stRes.postgres.username || 'postgres',
              ssl_mode: normalizePgSslMode(stRes.postgres.ssl_mode),
            }
          : DEFAULT_PG_FIELDS;
        setPgFields(incomingPg);
        setSavedPgBaseline(incomingPg);
        setPgPortText(String(incomingPg.port));
        setHasSavedPgPassword(Boolean(stRes.has_saved_password));
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoaded(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const parsedPgPortNum = Number.parseInt(pgPortText, 10);
  const effectivePgPort =
    Number.isFinite(parsedPgPortNum) &&
    parsedPgPortNum >= 1 &&
    parsedPgPortNum <= 65535
      ? parsedPgPortNum
      : 5432;
  const effectivePgFields: PostgresConnectionFieldsDto = {
    host: pgFields.host.trim(),
    port: effectivePgPort,
    database: pgFields.database.trim(),
    username: pgFields.username.trim(),
    ssl_mode: normalizePgSslMode(pgFields.ssl_mode),
  };

  const handleSelectPgInputMode = (nextMode: 'fields' | 'url') => {
    if (nextMode === pgInputMode) return;
    if (nextMode === 'fields') {
      const parsed = tryParsePostgresUrlClient(postgresUrl);
      if (parsed) {
        setPgFields(parsed.fields);
        setPgPortText(String(parsed.fields.port));
        if (parsed.password !== undefined) {
          setPgPasswordInput(parsed.password);
          setClearPgPassword(false);
        }
      }
    } else if (pgPasswordInput.length > 0) {
      setPostgresUrl(
        buildPostgresUrlFromFieldsClient(
          effectivePgFields,
          encodeURIComponent(pgPasswordInput),
        ),
      );
    } else if (
      !postgresUrl.trim() ||
      postgresUrl.includes(':***@') ||
      clearPgPassword
    ) {
      setPostgresUrl(
        buildPostgresUrlFromFieldsClient(
          effectivePgFields,
          hasSavedPgPassword && !clearPgPassword ? '***' : null,
        ),
      );
    }
    setPgInputMode(nextMode);
  };

  const handleTestStorage = async () => {
    if (testingStorage) return;
    setTestingStorage(true);
    try {
      const res =
        pgInputMode === 'fields'
          ? await api.adminTestStorage({
              postgres: {
                ...effectivePgFields,
                password: pgPasswordInput || undefined,
              },
              clear_password: clearPgPassword && pgPasswordInput.length === 0,
            })
          : await api.adminTestStorage({ database_url: postgresUrl });
      toast.success(st.testConnectionOk(res.latency_ms));
    } catch (err) {
      toast.error(err);
    } finally {
      setTestingStorage(false);
    }
  };

  const handleApplyStorage = async () => {
    if (switchingStorage) return;
    setSwitchingStorage(true);
    try {
      const res = await api.adminUpdateStorage(
        storageMode === 'postgres' && pgInputMode === 'fields'
          ? {
              mode: storageMode,
              postgres: {
                ...effectivePgFields,
                password: pgPasswordInput || undefined,
              },
              clear_password: clearPgPassword && pgPasswordInput.length === 0,
              sync_content: syncContent,
            }
          : {
              mode: storageMode,
              database_url: postgresUrl,
              sync_content: syncContent,
            },
      );
      setStorageStatus(res);
      setStorageMode(res.active_backend);
      setPostgresUrl(res.database_url_masked || '');
      const updatedPg: PostgresConnectionFieldsDto = res.postgres
        ? {
            host: res.postgres.host || '127.0.0.1',
            port: res.postgres.port || 5432,
            database: res.postgres.database || 'icehandnote',
            username: res.postgres.username || 'postgres',
            ssl_mode: normalizePgSslMode(res.postgres.ssl_mode),
          }
        : DEFAULT_PG_FIELDS;
      setPgFields(updatedPg);
      setSavedPgBaseline(updatedPg);
      setPgPortText(String(updatedPg.port));
      setHasSavedPgPassword(Boolean(res.has_saved_password));
      setPgPasswordInput('');
      setClearPgPassword(false);
      toast.success(st.storageSwitchedMsg);
    } catch (err) {
      toast.error(err);
    } finally {
      setSwitchingStorage(false);
    }
  };

  const hasEffectivePgPassword =
    pgPasswordInput.length > 0 || (hasSavedPgPassword && !clearPgPassword);
  const maskedPgPreviewUri = buildPostgresUrlFromFieldsClient(
    effectivePgFields,
    hasEffectivePgPassword ? '***' : null,
  );
  const canTestStorage =
    pgInputMode === 'fields'
      ? Boolean(
          effectivePgFields.host &&
            effectivePgFields.database &&
            effectivePgFields.username,
        )
      : Boolean(postgresUrl.trim());
  const isPgFieldsChanged =
    !storageStatus?.has_saved_url ||
    effectivePgFields.host !== savedPgBaseline.host.trim() ||
    effectivePgFields.port !== savedPgBaseline.port ||
    effectivePgFields.database !== savedPgBaseline.database.trim() ||
    effectivePgFields.username !== savedPgBaseline.username.trim() ||
    effectivePgFields.ssl_mode !== normalizePgSslMode(savedPgBaseline.ssl_mode) ||
    pgPasswordInput.length > 0 ||
    clearPgPassword;
  const isStorageDirty = Boolean(
    storageStatus &&
      (storageMode !== storageStatus.active_backend ||
        (storageMode === 'postgres' &&
          (pgInputMode === 'fields'
            ? isPgFieldsChanged
            : postgresUrl.trim() !==
              (storageStatus.database_url_masked || '').trim()))),
  );

  return (
    <SettingsSectionCard>
      {!loaded ? (
        <div className="space-y-3" aria-busy="true">
          <div className="h-9 w-56 rounded-xl bg-surface-raised animate-pulse" />
          <div className="h-24 rounded-xl bg-surface-raised animate-pulse" />
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <RadioPillGroup<'local' | 'postgres'>
              name="storage_mode"
              value={storageMode}
              onChange={setStorageMode}
              options={[
                { value: 'local', label: st.storageModeLocal },
                { value: 'postgres', label: st.storageModePostgres },
              ]}
            />
            {storageStatus && (
              <span className="px-2 py-0.5 rounded-lg text-xs font-mono bg-action-subtle text-link-ink font-semibold">
                {st.storageActiveBadge(storageStatus.active_backend)}
              </span>
            )}
          </div>

          {storageMode === 'postgres' && (
            <div className="flex flex-col gap-4 pt-3 border-t border-dashed border-border-subtle">
              <RadioPillGroup<'fields' | 'url'>
                name="pg_input_mode"
                legend={extSettings.pgInputModeLegend}
                size="sm"
                value={pgInputMode}
                onChange={handleSelectPgInputMode}
                options={[
                  { value: 'fields', label: extSettings.pgInputModeFields },
                  { value: 'url', label: extSettings.pgInputModeUrl },
                ]}
              />

              {pgInputMode === 'fields' ? (
                <div className="space-y-3.5">
                  <div className="grid grid-cols-1 sm:grid-cols-12 gap-3.5">
                    <div className="sm:col-span-6">
                      <label
                        htmlFor="set-pg-host"
                        className="block mb-1 text-xs font-semibold text-ink-secondary"
                      >
                        {extSettings.pgHostLabel}
                      </label>
                      <input
                        id="set-pg-host"
                        type="text"
                        autoCorrect="off"
                        autoCapitalize="none"
                        spellCheck={false}
                        value={pgFields.host}
                        onChange={(e) =>
                          setPgFields((prev) => ({
                            ...prev,
                            host: e.target.value,
                          }))
                        }
                        placeholder={extSettings.pgHostPlaceholder}
                        className="w-full px-3 py-2 rounded-xl bg-surface-raised text-ink-primary border border-border-subtle text-xs font-mono ink-input-inset"
                      />
                    </div>

                    <div className="sm:col-span-2">
                      <label
                        htmlFor="set-pg-port"
                        className="block mb-1 text-xs font-semibold text-ink-secondary"
                      >
                        {extSettings.pgPortLabel}
                      </label>
                      <input
                        id="set-pg-port"
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        maxLength={5}
                        autoCorrect="off"
                        autoCapitalize="none"
                        spellCheck={false}
                        value={pgPortText}
                        onChange={(e) => {
                          const digits = e.target.value.replace(/[^0-9]/g, '');
                          setPgPortText(digits);
                          const num = Number.parseInt(digits, 10);
                          if (
                            Number.isFinite(num) &&
                            num >= 1 &&
                            num <= 65535
                          ) {
                            setPgFields((prev) => ({ ...prev, port: num }));
                          }
                        }}
                        onBlur={() => {
                          const num = Number.parseInt(pgPortText, 10);
                          const safePort =
                            Number.isFinite(num) && num >= 1 && num <= 65535
                              ? num
                              : 5432;
                          setPgPortText(String(safePort));
                          setPgFields((prev) => ({ ...prev, port: safePort }));
                        }}
                        placeholder="5432"
                        className="w-full px-3 py-2 rounded-xl bg-surface-raised text-ink-primary border border-border-subtle text-xs font-mono tabular-nums ink-input-inset"
                      />
                    </div>

                    <div className="sm:col-span-4">
                      <label
                        htmlFor="set-pg-ssl"
                        className="block mb-1 text-xs font-semibold text-ink-secondary"
                      >
                        {extSettings.pgSslModeLabel}
                      </label>
                      <select
                        id="set-pg-ssl"
                        value={pgFields.ssl_mode}
                        onChange={(e) =>
                          setPgFields((prev) => ({
                            ...prev,
                            ssl_mode: normalizePgSslMode(e.target.value),
                          }))
                        }
                        className="ink-select w-full px-3 py-2 rounded-xl bg-surface-raised text-ink-primary border border-border-subtle text-xs"
                      >
                        <option value="prefer">{extSettings.pgSslPrefer}</option>
                        <option value="disable">{extSettings.pgSslDisable}</option>
                        <option value="require">{extSettings.pgSslRequire}</option>
                        <option value="verify-ca">{extSettings.pgSslVerifyCa}</option>
                        <option value="verify-full">{extSettings.pgSslVerifyFull}</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-12 gap-3.5">
                    <div className="sm:col-span-4">
                      <label
                        htmlFor="set-pg-db"
                        className="block mb-1 text-xs font-semibold text-ink-secondary"
                      >
                        {extSettings.pgDatabaseLabel}
                      </label>
                      <input
                        id="set-pg-db"
                        type="text"
                        autoCorrect="off"
                        autoCapitalize="none"
                        spellCheck={false}
                        value={pgFields.database}
                        onChange={(e) =>
                          setPgFields((prev) => ({
                            ...prev,
                            database: e.target.value,
                          }))
                        }
                        placeholder={extSettings.pgDatabasePlaceholder}
                        className="w-full px-3 py-2 rounded-xl bg-surface-raised text-ink-primary border border-border-subtle text-xs font-mono ink-input-inset"
                      />
                    </div>

                    <div className="sm:col-span-4">
                      <label
                        htmlFor="set-pg-user"
                        className="block mb-1 text-xs font-semibold text-ink-secondary"
                      >
                        {extSettings.pgUsernameLabel}
                      </label>
                      <input
                        id="set-pg-user"
                        type="text"
                        autoCorrect="off"
                        autoCapitalize="none"
                        spellCheck={false}
                        value={pgFields.username}
                        onChange={(e) =>
                          setPgFields((prev) => ({
                            ...prev,
                            username: e.target.value,
                          }))
                        }
                        placeholder={extSettings.pgUsernamePlaceholder}
                        className="w-full px-3 py-2 rounded-xl bg-surface-raised text-ink-primary border border-border-subtle text-xs font-mono ink-input-inset"
                      />
                    </div>

                    <div className="sm:col-span-4">
                      <div className="flex flex-wrap items-center justify-between gap-1.5 mb-1">
                        <label
                          htmlFor="set-pg-pw"
                          className="text-xs font-semibold text-ink-secondary"
                        >
                          {extSettings.pgPasswordLabel}
                        </label>
                        {hasSavedPgPassword && (
                          <div className="flex items-center gap-2 text-xs">
                            {clearPgPassword && pgPasswordInput.length === 0 ? (
                              <>
                                <span className="font-mono text-ink-muted">
                                  {extSettings.pgPasswordClearedBadge}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => setClearPgPassword(false)}
                                  className="text-link-ink hover:underline cursor-pointer"
                                >
                                  {extSettings.pgUndoClearPasswordBtn}
                                </button>
                              </>
                            ) : (
                              <>
                                <span className="font-mono text-accent-success">
                                  ✓ {extSettings.pgPasswordSavedBadge}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setPgPasswordInput('');
                                    setClearPgPassword(true);
                                  }}
                                  className="text-accent-danger hover:underline cursor-pointer"
                                >
                                  {extSettings.pgClearPasswordBtn}
                                </button>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                      <PasswordInput
                        id="set-pg-pw"
                        locale={locale}
                        variant="compact"
                        autoComplete="new-password"
                        autoCorrect="off"
                        autoCapitalize="none"
                        spellCheck={false}
                        value={pgPasswordInput}
                        onChange={(e) => {
                          setPgPasswordInput(e.target.value);
                          if (e.target.value.length > 0 && clearPgPassword) {
                            setClearPgPassword(false);
                          }
                        }}
                        placeholder={
                          hasSavedPgPassword && !clearPgPassword
                            ? '••••••••'
                            : ''
                        }
                      />
                    </div>
                  </div>

                  <div className="px-3 py-2 rounded-xl bg-surface-raised/60 border border-dashed border-border-subtle flex flex-wrap items-baseline gap-2 text-xs">
                    <span className="text-ink-muted shrink-0">
                      {extSettings.pgPreviewUriLabel}:
                    </span>
                    <code className="font-mono text-ink-secondary break-all">
                      {maskedPgPreviewUri}
                    </code>
                  </div>
                </div>
              ) : (
                <div>
                  <label htmlFor="set-pg-url" className="ink-field-label">
                    {st.postgresUrlLabel}
                  </label>
                  <input
                    id="set-pg-url"
                    type="text"
                    autoCorrect="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    value={postgresUrl}
                    onChange={(e) => setPostgresUrl(e.target.value)}
                    placeholder={st.postgresUrlPlaceholder}
                    className="ink-field-input font-mono text-xs"
                  />
                </div>
              )}

              <SwitchRow
                variant="inline"
                labelPosition="end"
                checked={syncContent}
                onChange={setSyncContent}
                label={st.storageSyncContentLabel}
              />
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2.5 pt-1">
            {storageMode === 'postgres' && (
              <button
                type="button"
                disabled={testingStorage || !canTestStorage}
                onClick={() => void handleTestStorage()}
                className="min-h-9 px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-surface-raised border border-border-subtle hover:border-border-ink text-ink-primary cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {testingStorage ? st.testingConnectionBtn : st.testConnectionBtn}
              </button>
            )}
            <button
              type="button"
              disabled={switchingStorage || !isStorageDirty}
              onClick={() => void handleApplyStorage()}
              className="min-h-9 px-4 py-1.5 rounded-xl text-xs font-semibold ink-btn-primary cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {switchingStorage ? st.applyingStorageBtn : st.applyStorageBtn}
            </button>
          </div>
        </div>
      )}
    </SettingsSectionCard>
  );
}
