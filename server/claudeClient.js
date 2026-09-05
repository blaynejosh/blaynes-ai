/**
 * The Claude client, shared between the chat surface (server/index.js) and
 * the Brand Kit extraction pipeline (server/brandKit/extraction/). Split out
 * of index.js so a second call site doesn't have to re-decide the
 * Vertex-vs-direct-API branch — see the comment below for why that branch
 * exists at all.
 *
 * Auth is Application Default Credentials — gcloud auth application-default
 * login locally, or the runtime service account on Cloud Run. No API key.
 * Requires the Claude models to be enabled for this project in Vertex AI
 * Model Garden.
 *
 * TEMPORARY: while Vertex AI quota on this project is still too low for full
 * app testing, setting ANTHROPIC_API_KEY switches to the direct Anthropic
 * API instead (same model IDs, same messages.stream()/messages.create()
 * surface — no other code changes). Remove this branch and the
 * ANTHROPIC_API_KEY read once Vertex quota is raised; AnthropicVertex should
 * stay the only path.
 */
import { AnthropicVertex } from '@anthropic-ai/vertex-sdk';
import Anthropic from '@anthropic-ai/sdk';

export const MODEL = process.env.BLAYNE_MODEL ?? 'claude-opus-5';

export const claudeClient = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : new AnthropicVertex({
      projectId: process.env.ANTHROPIC_VERTEX_PROJECT_ID,
      region: process.env.CLOUD_ML_REGION ?? 'global',
    });

export const claudeVia = process.env.ANTHROPIC_API_KEY ? 'direct Anthropic API (temporary — see client init)' : 'Vertex AI';
