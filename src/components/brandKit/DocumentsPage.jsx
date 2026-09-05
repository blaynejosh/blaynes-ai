import { useCallback, useEffect, useState } from 'react';
import { getDocumentDownloadUrl, listDocuments } from '../../lib/brandKit.js';

const DOC_TYPE_LABEL = {
  strategy_report: 'Strategy report',
  business_case: 'Business case',
  proposal: 'Proposal',
  sow: 'Statement of work',
  market_study: 'Market study',
  board_pack: 'Board pack',
  investment_memo: 'Investment memo',
  company_profile: 'Company profile',
  policy_or_sop: 'Policy / SOP',
  regulatory_brief: 'Regulatory brief',
  whitepaper: 'Whitepaper',
  one_pager: 'One-pager',
  deck: 'Deck',
};

const STATUS_LABEL = { queued: 'Queued', assembling: 'Writing…', rendering: 'Rendering…', complete: 'Ready', failed: 'Failed' };
const STATUS_STYLE = {
  queued: 'bg-platinum/10 text-platinum/70',
  assembling: 'bg-amber-500/20 text-amber-300',
  rendering: 'bg-amber-500/20 text-amber-300',
  complete: 'bg-emerald-500/20 text-emerald-300',
  failed: 'bg-red-500/20 text-red-300',
};
const IN_PROGRESS = new Set(['queued', 'assembling', 'rendering']);

// A generation genuinely takes minutes (see documents/jobs.js) — this only
// needs to catch the transition to 'complete'/'failed' soon after it
// happens, not track incremental progress within a status.
const POLL_MS = 6000;

function StatusBadge({ status }) {
  return <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] ${STATUS_STYLE[status] ?? STATUS_STYLE.queued}`}>{STATUS_LABEL[status] ?? status}</span>;
}

function DownloadButton({ id }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  async function handleDownload() {
    setBusy(true);
    setErr(null);
    try {
      const { url } = await getDocumentDownloadUrl(id);
      window.open(url, '_blank', 'noopener');
    } catch (error) {
      setErr(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleDownload}
        disabled={busy}
        className="pressable material-chip rounded-lg bg-jordy px-3 py-1.5 text-xs font-medium text-delft disabled:opacity-50"
      >
        {busy ? 'Preparing…' : 'Download'}
      </button>
      {err && <p className="m-0 text-[10px] text-red-300">{err}</p>}
    </div>
  );
}

/**
 * Read-only view onto the Phase 4 Document Engine's job queue
 * (`documents` table via `/api/brand-kit/documents`) — generation itself is
 * only ever started from chat (the `generate_document` tool, see
 * blaynePrompt.js), so there's no "new document" form here, just status and
 * download for whatever chat has already queued. Polls while anything is
 * still queued/assembling/rendering; stops once every visible job has
 * settled into complete or failed.
 */
export default function DocumentsPage() {
  const [docs, setDocs] = useState(null);
  const [err, setErr] = useState(null);

  const reload = useCallback(async () => {
    try {
      const list = await listDocuments();
      setDocs(list);
      setErr(null);
    } catch (error) {
      setErr(error.message);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    if (!docs?.some((d) => IN_PROGRESS.has(d.status))) return undefined;
    const timer = setInterval(reload, POLL_MS);
    return () => clearInterval(timer);
  }, [docs, reload]);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="m-0 text-xl font-semibold text-platinum">Documents</h1>
        <p className="m-0 mt-1 text-sm text-platinum/60">
          Ask Blayne for a deliverable in chat — it appears here as soon as generation starts, and stays here to download once it's ready.
        </p>
      </div>

      {err && <p className="text-sm text-red-300">{err}</p>}

      {docs === null && !err && <p className="text-sm text-platinum/60">Loading…</p>}

      {docs !== null && docs.length === 0 && (
        <p className="material-panel rounded-xl p-4 text-sm text-platinum/60">
          No documents yet — tell Blayne what you need in chat and it'll show up here while it's being written.
        </p>
      )}

      {docs !== null && docs.length > 0 && (
        <ul className="m-0 space-y-2 p-0">
          {docs.map((doc) => (
            <li key={doc.id} className="material-panel flex items-center justify-between gap-3 rounded-xl p-3">
              <div className="min-w-0">
                <p className="m-0 truncate text-sm text-platinum">{doc.title}</p>
                <p className="m-0 mt-0.5 text-[11px] text-platinum/50">
                  {DOC_TYPE_LABEL[doc.doc_type] ?? doc.doc_type} · {doc.format?.toUpperCase()} · {new Date(doc.created_at).toLocaleString()}
                </p>
                {doc.status === 'failed' && doc.error && <p className="m-0 mt-1 text-[11px] text-red-300">{doc.error}</p>}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <StatusBadge status={doc.status} />
                {doc.status === 'complete' && <DownloadButton id={doc.id} />}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
