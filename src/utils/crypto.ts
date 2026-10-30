import crypto from 'crypto';

/**
 * Validates Meta x-hub-signature-256 against raw body using application secret.
 * @param rawBody - Raw request body Buffer
 * @param signatureHeader - Value of x-hub-signature-256 header (sha256=...)
 * @param appSecret - Facebook App Secret
 */
export function verifySignature(
  rawBody: Buffer,
  signatureHeader: string,
  appSecret: string
): boolean {
  if (!signatureHeader || !appSecret || !rawBody) {
    return false;
  }

  const [algorithm, signature] = signatureHeader.split('=');
  if (algorithm !== 'sha256' || !signature) {
    return false;
  }

  const expectedSignature = crypto
    .createHmac('sha256', appSecret)
    .update(rawBody)
    .digest('hex');

  const sigBuffer = Buffer.from(signature, 'utf8');
  const expectedBuffer = Buffer.from(expectedSignature, 'utf8');

  // crypto.timingSafeEqual throws RangeError if buffer lengths differ
  if (sigBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(sigBuffer, expectedBuffer);
}
