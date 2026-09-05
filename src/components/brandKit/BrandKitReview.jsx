import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  activateBrandKit,
  confirmAllRemainingFields,
  confirmBrandKitField,
  editBrandKitField,
  getAssetDownloadUrl,
  getBrandKitDraft,
  listBrandKitAssets,
} from '../../lib/brandKit.js';
import BrandKitPreview from './BrandKitPreview.jsx';

/** Walks a dot-path ("colors.text.heading") to read the current value out
 * of kit_json — the frontend counterpart of server/brandKit's setPath(). */
function getPath(obj, path) {
  return path.split('.').reduce((cur, key) => (cur == null ? undefined : cur[key]), obj);
}

const METHOD_LABEL = {
  extracted_llm: 'Read from your material',
  extracted_deterministic: 'Detected automatically',
  system_default: 'System default — nothing found in your material',
  user_entered: 'You entered this',
};

function isHexShape(v) {
  return v && typeof v === 'object' && !Array.isArray(v) && typeof v.hex === 'string' && Object.keys(v).length === 1;
}
function isHexArrayShape(v) {
  return Array.isArray(v) && v.length > 0 && v.every(isHexShape);
}
function isStringArrayShape(v) {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

/** One editable field row. Renders a different control based on the
 * runtime shape of the current value — see the note in the Phase 2 report
 * on why this is a value-shape heuristic rather than a second copy of
 * server/brandKit/extraction/proposals.js's PATH_SPECS on the frontend. */
function FieldRow({ path, entry, value, sourceLabel, onEdit, onAccept, busy }) {
  const [draft, setDraft] = useState(() => toEditableString(value));

  function toEditableString(v) {
    if (isHexShape(v)) return v.hex;
    if (isHexArrayShape(v)) return v.map((c) => c.hex).join(', ');
    if (isStringArrayShape(v)) return v.join(', ');
    if (typeof v === 'boolean') return v;
    if (typeof v === 'string') return v;
    return null; // composite/read-only
  }

  const editable = draft !== null;
  const changed = editable && draft !== toEditableString(value);

  function save() {
    let payload = draft;
    if (isHexArrayShape(value) || isStringArrayShape(value)) {
      payload = String(draft)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    }
    onEdit(path, payload);
  }

  return (
    <div className="material-panel rounded-xl p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="m-0 truncate font-mono text-[11px] text-platinum/50">{path}</p>
          <p className="m-0 text-[11px] text-platinum/60">
            {METHOD_LABEL[entry.method] ?? entry.method}
            {sourceLabel ? ` · ${sourceLabel}` : ''}
            {typeof entry.confidence === 'number' ? ` · confidence ${(entry.confidence * 100).toFixed(0)}%` : ''}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
            entry.confirmed ? 'bg-emerald-500/20 text-emerald-300' : 'bg-amber-500/20 text-amber-300'
          }`}
        >
          {entry.confirmed ? 'Confirmed' : 'Needs review'}
        </span>
      </div>

      <div className="mt-2">
        {editable ? (
          typeof draft === 'boolean' ? (
            <label className="flex items-center gap-2 text-sm text-platinum">
              <input type="checkbox" checked={draft} onChange={(e) => setDraft(e.target.checked)} />
              {draft ? 'True' : 'False'}
            </label>
          ) : (
            <div className="flex items-center gap-2">
              {isHexShape(value) && <input type="color" value={/^#[0-9A-Fa-f]{6}$/.test(draft) ? draft : '#000000'} onChange={(e) => setDraft(e.target.value)} className="h-8 w-8 shrink-0 rounded" />}
              <input
                type="text"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-black/20 px-2 py-1.5 text-sm text-platinum"
              />
            </div>
          )
        ) : (
          <ReadOnlyValue value={value} />
        )}
      </div>

      <div className="mt-2 flex justify-end gap-2">
        {editable && changed && (
          <button type="button" disabled={busy} onClick={save} className="pressable rounded-lg bg-jordy px-3 py-1 text-xs font-medium text-delft">
            Save & confirm
          </button>
        )}
        {!entry.confirmed && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onAccept(path)}
            className="pressable-text rounded-lg border border-white/15 px-3 py-1 text-xs text-platinum/85"
          >
            Accept as-is
          </button>
        )}
      </div>
    </div>
  );
}

function ReadOnlyValue({ value }) {
  if (isHexShape(value)) return <span className="inline-block h-5 w-5 rounded ring-1 ring-white/20" style={{ background: value.hex }} />;
  if (Array.isArray(value)) {
    return (
      <div className="flex flex-wrap gap-2">
        {value.map((item, i) =>
          isHexShape(item) ? (
            <span key={i} className="h-5 w-5 rounded ring-1 ring-white/20" style={{ background: item.hex }} />
          ) : (
            <span key={i} className="rounded bg-white/10 px-2 py-0.5 text-[11px] text-platinum/80">
              {typeof item === 'string' ? item : JSON.stringify(item)}
            </span>
          ),
        )}
      </div>
    );
  }
  return <pre className="m-0 overflow-x-auto text-[11px] whitespace-pre-wrap text-platinum/70">{JSON.stringify(value, null, 2)}</pre>;
}

export default function BrandKitReview() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [draft, setDraft] = useState(null);
  const [assetsById, setAssetsById] = useState({});
  const [logoUrl, setLogoUrl] = useState(null);
  const [error, setError] = useState(null);
  const [busyPath, setBusyPath] = useState(null);
  const [activating, setActivating] = useState(false);

  const reload = useCallback(async () => {
    try {
      const [d, assets] = await Promise.all([getBrandKitDraft(id), listBrandKitAssets()]);
      setDraft(d);
      setAssetsById(Object.fromEntries(assets.map((a) => [a.id, a])));
      const logoAssetId = d.kit_json.logos?.[0]?.asset_id;
      if (logoAssetId) {
        getAssetDownloadUrl(logoAssetId)
          .then((r) => setLogoUrl(r.url))
          .catch(() => setLogoUrl(null));
      }
    } catch (err) {
      setError(err.message);
    }
  }, [id]);

  useEffect(() => {
    reload();
  }, [reload]);

  const fields = useMemo(() => {
    if (!draft) return [];
    const provenance = draft.kit_json.provenance ?? {};
    return Object.entries(provenance)
      .map(([path, entry]) => ({
        path,
        entry,
        value: getPath(draft.kit_json, path),
        sourceLabel: entry.source_asset_id ? assetsById[entry.source_asset_id]?.file_name ?? entry.source_asset_id : null,
      }))
      .sort((a, b) => (a.entry.confidence ?? 1) - (b.entry.confidence ?? 1));
  }, [draft, assetsById]);

  const unconfirmedCount = fields.filter((f) => !f.entry.confirmed).length;

  async function handleEdit(path, value) {
    setBusyPath(path);
    try {
      await editBrandKitField(id, path, value);
      await reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyPath(null);
    }
  }

  async function handleAccept(path) {
    setBusyPath(path);
    try {
      await confirmBrandKitField(id, path);
      await reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyPath(null);
    }
  }

  async function handleAcceptAll() {
    setBusyPath('*');
    try {
      await confirmAllRemainingFields(id);
      await reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyPath(null);
    }
  }

  async function handleActivate() {
    setActivating(true);
    setError(null);
    try {
      await activateBrandKit(id);
      navigate('/brand-kit');
    } catch (err) {
      setError(err.message);
    } finally {
      setActivating(false);
    }
  }

  if (error && !draft) {
    return <p className="text-sm text-red-300">{error}</p>;
  }
  if (!draft) {
    return <p className="text-sm text-platinum/60">Loading…</p>;
  }

  const canActivate = unconfirmedCount === 0 && draft.completeness.complete;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_1.1fr]">
      <div>
        <h2 className="m-0 mb-3 text-sm font-semibold text-platinum">Preview</h2>
        <BrandKitPreview tokens={draft.resolved_tokens} logoUrl={logoUrl} orgName={draft.kit_json.identity?.legal_name} />

        {draft.resolved_tokens.warnings?.length > 0 && (
          <div className="material-panel mt-4 rounded-xl p-3">
            <p className="m-0 mb-1 text-xs font-semibold text-amber-300">Renderer warnings</p>
            <ul className="m-0 list-disc space-y-1 pl-4 text-[11px] text-platinum/70">
              {draft.resolved_tokens.warnings.map((w, i) => (
                <li key={i}>{w.message}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="m-0 text-sm font-semibold text-platinum">
            Fields to review <span className="text-platinum/50">({unconfirmedCount} remaining)</span>
          </h2>
          {unconfirmedCount > 0 && (
            <button type="button" disabled={busyPath === '*'} onClick={handleAcceptAll} className="pressable-text text-xs text-jordy underline">
              Accept all remaining as-is
            </button>
          )}
        </div>

        <div className="space-y-2">
          {fields.map(({ path, entry, value, sourceLabel }) => (
            <FieldRow
              key={path}
              path={path}
              entry={entry}
              value={value}
              sourceLabel={sourceLabel}
              onEdit={handleEdit}
              onAccept={handleAccept}
              busy={busyPath === path}
            />
          ))}
        </div>

        {!draft.completeness.complete && (
          <div className="material-panel mt-4 rounded-xl p-3">
            <p className="m-0 mb-1 text-xs font-semibold text-red-300">Still missing required fields</p>
            <ul className="m-0 list-disc space-y-1 pl-4 text-[11px] text-platinum/70">
              {draft.completeness.errors.map((e, i) => (
                <li key={i}>
                  {e.path}: {e.message}
                </li>
              ))}
            </ul>
          </div>
        )}

        {error && <p className="mt-3 text-xs text-red-300">{error}</p>}

        <button
          type="button"
          disabled={!canActivate || activating}
          onClick={handleActivate}
          className="pressable material-chip mt-4 w-full rounded-xl bg-jordy px-4 py-2.5 text-sm font-medium text-delft disabled:opacity-40"
        >
          {activating ? 'Activating…' : 'Activate this Brand Kit'}
        </button>
        {!canActivate && (
          <p className="m-0 mt-2 text-center text-[11px] text-platinum/50">
            {unconfirmedCount > 0 ? 'Review every field above first.' : 'This kit is missing required fields.'}
          </p>
        )}
      </div>
    </div>
  );
}
