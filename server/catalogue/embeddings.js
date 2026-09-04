/**
 * Text embeddings via Vertex AI's own prediction API — a separate surface
 * from the Anthropic-on-Vertex client in server/index.js. Claude has no
 * embeddings endpoint on any platform; Vertex AI's Model Garden does, and
 * it's reachable with the exact same Application Default Credentials
 * already configured for GCS and for AnthropicVertex (the runtime service
 * account's roles/aiplatform.user covers both).
 *
 * Plain REST + google-auth-library rather than @google-cloud/aiplatform: the
 * full aiplatform SDK is a large, gRPC-oriented client for a single HTTP
 * call this app needs in exactly two places (build-time catalogue embedding,
 * request-time query embedding). Same "no heavier than it needs to be"
 * choice this codebase already made for Cloud Storage.
 *
 * text-embedding-005 is not available on the `global` Vertex endpoint used
 * for Claude (CLOUD_ML_REGION) — it needs a real region. Kept as its own env
 * var so changing where Claude runs never silently moves this too.
 */
import { GoogleAuth } from 'google-auth-library';

const EMBEDDING_REGION = process.env.CATALOGUE_EMBEDDING_REGION ?? 'us-central1';
const EMBEDDING_MODEL = process.env.CATALOGUE_EMBEDDING_MODEL ?? 'text-embedding-005';
/** Vertex's per-request cap for this model's batch embedding endpoint. */
const MAX_INSTANCES_PER_REQUEST = 20;

const auth = new GoogleAuth({ scopes: 'https://www.googleapis.com/auth/cloud-platform' });

async function accessToken() {
  const client = await auth.getClient();
  const { token } = await client.getAccessToken();
  if (!token) throw new Error('Could not obtain an access token for Vertex AI embeddings.');
  return token;
}

function projectId() {
  const id = process.env.ANTHROPIC_VERTEX_PROJECT_ID;
  if (!id) throw new Error('ANTHROPIC_VERTEX_PROJECT_ID is required to call Vertex AI embeddings.');
  return id;
}

async function predict(instances) {
  const url = `https://${EMBEDDING_REGION}-aiplatform.googleapis.com/v1/projects/${projectId()}/locations/${EMBEDDING_REGION}/publishers/google/models/${EMBEDDING_MODEL}:predict`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${await accessToken()}`, 'content-type': 'application/json' },
    body: JSON.stringify({ instances }),
  });
  if (!res.ok) {
    throw new Error(`Vertex AI embeddings request failed (${res.status}): ${await res.text()}`);
  }
  const body = await res.json();
  return body.predictions.map((p) => p.embeddings.values);
}

/**
 * Embeds up to MAX_INSTANCES_PER_REQUEST texts as documents (the catalogue
 * side of the match) — batched, used only by the build-time script.
 */
export async function embedDocuments(texts) {
  const vectors = [];
  for (let i = 0; i < texts.length; i += MAX_INSTANCES_PER_REQUEST) {
    const batch = texts.slice(i, i + MAX_INSTANCES_PER_REQUEST);
    const batchVectors = await predict(batch.map((content) => ({ content, task_type: 'RETRIEVAL_DOCUMENT' })));
    vectors.push(...batchVectors);
  }
  return vectors;
}

/** Embeds one user need string as a query — the request-time side of the match. */
export async function embedQuery(text) {
  const [vector] = await predict([{ content: text, task_type: 'RETRIEVAL_QUERY' }]);
  return vector;
}

export function cosineSimilarity(a, b) {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
