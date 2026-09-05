/**
 * The tenant boundary for Brand Kit / Document Engine.
 *
 * Everything before this feature was keyed on auth.users.id directly — see
 * the "organizations" comment in supabase/schema.sql for why that's no
 * longer enough. requireOrg() runs after the existing requireAuth() (see
 * server/index.js) and resolves the signed-in user's organization, so every
 * route downstream can scope its queries and GCS reads/writes to req.orgId
 * instead of req.userId.
 *
 * v1 assumption: one user, one org (every account gets exactly one personal
 * organization at signup — see handle_new_user() in schema.sql). A user
 * belongs to more than one org only once an invite flow exists, which isn't
 * built yet; resolveOrgForUser() picks the earliest membership so behaviour
 * stays well-defined the day that changes instead of silently picking at
 * random.
 */
import { supabaseAdmin } from '../supabaseAdmin.js';

export async function resolveOrgForUser(userId) {
  const { data, error } = await supabaseAdmin
    .from('organization_members')
    .select('org_id, role')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ? { orgId: data.org_id, role: data.role } : null;
}

/** Requires requireAuth to have already set req.userId. */
export async function requireOrg(req, res, next) {
  try {
    const membership = await resolveOrgForUser(req.userId);
    if (!membership) {
      // Should only happen for an account created before the org backfill
      // migration ran and the migration hasn't been applied to this
      // database yet — a real setup problem, not a normal 404.
      return res.status(500).json({
        error: 'Your account has no organization yet. Run supabase/migration_brand_kit.sql against this project.',
      });
    }
    req.orgId = membership.orgId;
    req.orgRole = membership.role;
    next();
  } catch (err) {
    console.error('[blayne] org resolution failed:', err.message);
    res.status(500).json({ error: 'Could not resolve your organization.' });
  }
}
