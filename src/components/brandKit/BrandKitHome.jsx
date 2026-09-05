import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  attestFontLicense,
  createManualBrandKit,
  deleteBrandKitAsset,
  getActiveBrandKit,
  listBrandKitAssets,
  listBrandKits,
  runBrandKitExtraction,
  uploadBrandKitAssets,
} from '../../lib/brandKit.js';

const ASSET_KINDS = [
  { kind: 'guideline', label: 'Brand guideline / manual', accept: '.pdf,.docx,.pptx' },
  { kind: 'corporate_profile', label: 'Corporate profile / capability deck', accept: '.pdf,.docx,.pptx' },
  { kind: 'sample_document', label: 'Past report or document', accept: '.pdf,.docx,.pptx' },
  { kind: 'logo', label: 'Logo files', accept: '.svg,.png,.jpg,.jpeg' },
  { kind: 'palette', label: 'Colour palette', accept: '.png,.jpg,.jpeg,.ase,.txt,.csv,.pdf' },
  { kind: 'font', label: 'Font files', accept: '.ttf,.otf,.woff,.woff2' },
  { kind: 'icon_set', label: 'Icon set', accept: '.svg,.png,.ttf,.otf,.woff,.woff2' },
];

const LAYOUT_STYLES = [
  { value: 'minimal_light', label: 'Minimal Light' },
  { value: 'bold_dark', label: 'Bold Dark' },
  { value: 'corporate_classic', label: 'Corporate Classic' },
];

const STATUS_LABEL = { draft: 'Draft', awaiting_review: 'Awaiting review', active: 'Active', archived: 'Archived' };

function AssetKindSection({ kind, label, accept, assets, onUploaded, onDeleted }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const own = assets.filter((a) => a.kind === kind);

  async function handleFiles(e) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (!files.length) return;
    setBusy(true);
    setErr(null);
    try {
      await uploadBrandKitAssets(kind, files);
      onUploaded();
    } catch (error) {
      setErr(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id) {
    try {
      await deleteBrandKitAsset(id);
      onDeleted();
    } catch (error) {
      setErr(error.message);
    }
  }

  return (
    <div className="material-panel rounded-xl p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="m-0 text-sm text-platinum">{label}</p>
        <label className="pressable-text cursor-pointer rounded-lg border border-white/15 px-2.5 py-1 text-xs text-platinum/85">
          {busy ? 'Uploading…' : 'Upload'}
          <input type="file" accept={accept} multiple className="hidden" onChange={handleFiles} disabled={busy} />
        </label>
      </div>
      {err && <p className="m-0 mt-1 text-[11px] text-red-300">{err}</p>}
      {own.length > 0 && (
        <ul className="m-0 mt-2 space-y-1 p-0">
          {own.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-2 text-[11px] text-platinum/70">
              <span className="truncate">{a.file_name}</span>
              <div className="flex shrink-0 items-center gap-2">
                {a.kind === 'font' && <FontLicenseBadge asset={a} onAttested={onUploaded} />}
                <button type="button" onClick={() => handleDelete(a.id)} className="pressable-text text-red-300/80 hover:text-red-300">
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FontLicenseBadge({ asset, onAttested }) {
  const [open, setOpen] = useState(false);
  const [licenseType, setLicenseType] = useState('');
  const [embed, setEmbed] = useState(false);

  if (asset.license_attested) {
    return <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] text-emerald-300">Licensed</span>;
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] text-amber-300">
        Attest licence
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <input
        placeholder="Licence type"
        value={licenseType}
        onChange={(e) => setLicenseType(e.target.value)}
        className="w-24 rounded border border-white/15 bg-black/20 px-1.5 py-0.5 text-[10px] text-platinum"
      />
      <label className="flex items-center gap-1 text-[10px] text-platinum/70">
        <input type="checkbox" checked={embed} onChange={(e) => setEmbed(e.target.checked)} />
        Embedding OK
      </label>
      <button
        type="button"
        onClick={async () => {
          await attestFontLicense(asset.id, { licenseType, embeddingPermitted: embed });
          setOpen(false);
          onAttested();
        }}
        className="pressable rounded bg-jordy px-2 py-0.5 text-[10px] font-medium text-delft"
      >
        Confirm
      </button>
    </div>
  );
}

function ManualKitForm({ assets, onCreated }) {
  const logos = assets.filter((a) => a.kind === 'logo');
  const [name, setName] = useState('');
  const [primary, setPrimary] = useState('#1A73E8');
  const [secondary, setSecondary] = useState('#111827');
  const [layout, setLayout] = useState('minimal_light');
  const [logoId, setLogoId] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  async function submit(e) {
    e.preventDefault();
    if (!logoId) {
      setErr('Upload a logo above first, then select it here.');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await createManualBrandKit({ name, primaryHex: primary, secondaryHex: secondary, layoutStyle: layout, logoAssetIds: [logoId] });
      onCreated();
    } catch (error) {
      setErr(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="material-panel space-y-3 rounded-xl p-4">
      <p className="m-0 text-sm font-semibold text-platinum">No brand guideline? Build a Brand Kit in two minutes</p>
      <input
        required
        placeholder="Company / brand name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="w-full rounded-lg border border-white/10 bg-black/20 px-2.5 py-1.5 text-sm text-platinum"
      />
      <div className="flex gap-3">
        <label className="flex items-center gap-2 text-xs text-platinum/70">
          Primary
          <input type="color" value={primary} onChange={(e) => setPrimary(e.target.value)} className="h-7 w-9 rounded" />
        </label>
        <label className="flex items-center gap-2 text-xs text-platinum/70">
          Secondary
          <input type="color" value={secondary} onChange={(e) => setSecondary(e.target.value)} className="h-7 w-9 rounded" />
        </label>
      </div>
      <select value={layout} onChange={(e) => setLayout(e.target.value)} className="w-full rounded-lg border border-white/10 bg-black/20 px-2.5 py-1.5 text-sm text-platinum">
        {LAYOUT_STYLES.map((l) => (
          <option key={l.value} value={l.value}>
            {l.label}
          </option>
        ))}
      </select>
      <select value={logoId} onChange={(e) => setLogoId(e.target.value)} className="w-full rounded-lg border border-white/10 bg-black/20 px-2.5 py-1.5 text-sm text-platinum">
        <option value="">Choose an uploaded logo…</option>
        {logos.map((l) => (
          <option key={l.id} value={l.id}>
            {l.file_name}
          </option>
        ))}
      </select>
      {err && <p className="m-0 text-xs text-red-300">{err}</p>}
      <button type="submit" disabled={busy} className="pressable material-chip w-full rounded-lg bg-jordy px-4 py-2 text-sm font-medium text-delft disabled:opacity-50">
        {busy ? 'Creating…' : 'Create Brand Kit'}
      </button>
    </form>
  );
}

export default function BrandKitHome() {
  const [assets, setAssets] = useState([]);
  const [kits, setKits] = useState([]);
  const [activeKit, setActiveKit] = useState(null);
  const [extracting, setExtracting] = useState(false);
  const [err, setErr] = useState(null);

  const reload = useCallback(async () => {
    const [a, k, active] = await Promise.all([listBrandKitAssets(), listBrandKits(), getActiveBrandKit()]);
    setAssets(a);
    setKits(k);
    setActiveKit(active);
  }, []);

  useEffect(() => {
    reload().catch((e) => setErr(e.message));
  }, [reload]);

  const hasLogo = assets.some((a) => a.kind === 'logo');
  const hasTextMaterial = assets.some((a) => ['guideline', 'corporate_profile', 'sample_document'].includes(a.kind));

  async function handleExtract() {
    setExtracting(true);
    setErr(null);
    try {
      const kit = await runBrandKitExtraction();
      window.location.assign(`/brand-kit/review/${kit.id}`);
    } catch (error) {
      setErr(error.message);
    } finally {
      setExtracting(false);
    }
  }

  const pendingKits = kits.filter((k) => k.status !== 'active' && k.status !== 'archived');

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="m-0 text-xl font-semibold text-platinum">Brand Kit</h1>
        <p className="m-0 mt-1 text-sm text-platinum/60">
          {activeKit
            ? `Active: "${activeKit.kit_json.identity?.legal_name}" (v${activeKit.version}, confirmed ${new Date(activeKit.confirmed_at).toLocaleDateString()})`
            : 'No active Brand Kit yet — upload material below and extract, or use the two-minute manual path.'}
        </p>
      </div>

      {err && <p className="text-sm text-red-300">{err}</p>}

      {pendingKits.length > 0 && (
        <div className="material-panel rounded-xl p-3">
          <p className="m-0 mb-2 text-xs font-semibold text-amber-300">Drafts awaiting your review</p>
          <ul className="m-0 space-y-1 p-0">
            {pendingKits.map((k) => (
              <li key={k.id} className="flex items-center justify-between text-sm text-platinum/80">
                <span>
                  v{k.version} — {STATUS_LABEL[k.status]}
                </span>
                <Link to={`/brand-kit/review/${k.id}`} className="pressable-text text-jordy underline">
                  Review
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <h2 className="m-0 mb-2 text-sm font-semibold text-platinum">Brand material</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {ASSET_KINDS.map(({ kind, label, accept }) => (
            <AssetKindSection key={kind} kind={kind} label={label} accept={accept} assets={assets} onUploaded={reload} onDeleted={reload} />
          ))}
        </div>
      </div>

      <div>
        <button
          type="button"
          disabled={!hasLogo || !hasTextMaterial || extracting}
          onClick={handleExtract}
          className="pressable material-chip w-full rounded-xl bg-jordy px-4 py-2.5 text-sm font-medium text-delft disabled:opacity-40"
        >
          {extracting ? 'Reading your material…' : 'Extract Brand Kit from uploaded material'}
        </button>
        {(!hasLogo || !hasTextMaterial) && (
          <p className="m-0 mt-2 text-center text-[11px] text-platinum/50">
            Needs at least one logo and one guideline/profile/sample document uploaded above.
          </p>
        )}
      </div>

      <ManualKitForm assets={assets} onCreated={reload} />
    </div>
  );
}
