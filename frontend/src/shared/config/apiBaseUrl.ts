/**
 * Single source for the FastAPI origin at build time (REACT_APP_API_BASE_URL).
 * Do not point this at the S3/CloudFront UI URL — that host only serves static files.
 */
export function resolveApiBaseUrl(): string {
  const raw = (process.env.REACT_APP_API_BASE_URL || '').trim();
  if (!raw) {
    console.error(
      '[TrustEdge] REACT_APP_API_BASE_URL is not set. Set it to the FastAPI origin, e.g. http://<ec2-ip>:8000'
    );
    return '';
  }
  try {
    const url = new URL(raw);
    const host = url.host.toLowerCase();
    if (host.endsWith('.cloudfront.net') && !raw.includes(':8000')) {
      console.warn(
        `[TrustEdge] REACT_APP_API_BASE_URL looks like a CloudFront UI host (${host}). ` +
          'Use the API origin, e.g. http://<ec2-ip>:8000'
      );
    }
    return raw.replace(/\/+$/, '');
  } catch {
    console.error(`[TrustEdge] REACT_APP_API_BASE_URL is invalid: ${raw}`);
    return '';
  }
}

export const API_BASE_URL = resolveApiBaseUrl();
