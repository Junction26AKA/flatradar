// One-off Cloudinary setup and check: `npm run cloudinary-setup`
// - checks CLOUDINARY_URL works (Admin API ping)
// - creates or updates the unsigned upload preset used by the Upload Widget on /mock
// - checks the AI Vision add-on answers (tags one Cloudinary demo image)
import { v2 as cloudinary } from 'cloudinary';
import { mediaEnabled, ensureUploadPreset } from '../lib/media/index.mjs';

// The SDK's error objects include the request auth (API key and secret): print only the message.
process.on('unhandledRejection', (e) => {
  console.error(`failed: ${e?.error?.message ?? e?.message ?? 'unknown error'}${e?.error?.http_code ? ` (HTTP ${e.error.http_code})` : ''}`);
  process.exit(1);
});

if (!mediaEnabled) {
  console.error('CLOUDINARY_URL is not set. Copy it from the Cloudinary console (Dashboard → API environment variable) into .env.');
  process.exit(1);
}
const { cloud_name, api_key, api_secret } = cloudinary.config();
console.log(`cloud: ${cloud_name}`);

await cloudinary.api.ping();
console.log('admin api: ok');

const preset = await ensureUploadPreset();
console.log(`upload preset "${preset.name}": ${preset.created ? 'created' : 'updated'} (unsigned, folder flatradar/demo)`);

const res = await fetch(`https://api.cloudinary.com/v2/analysis/${cloud_name}/analyze/ai_vision_tagging`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Basic ${Buffer.from(`${api_key}:${api_secret}`).toString('base64')}` },
  body: JSON.stringify({
    source: { uri: 'https://res.cloudinary.com/demo/image/upload/kitchen-island' },
    tag_definitions: [{ name: 'kitchen', description: 'Does the image show a kitchen?' }, { name: 'bathroom', description: 'Does the image show a bathroom?' }],
  }),
});
const body = await res.json().catch(() => ({}));
if (res.ok) {
  const quota = body.limits?.addons_quota?.find((q) => q.type === 'ai_vision');
  console.log(`ai vision: ok, tags ${JSON.stringify((body.data?.analysis?.tags ?? []).map((t) => t.name))}${quota ? `, ${quota.remaining}/${quota.limit} tokens left` : ''}`);
} else {
  console.log(`ai vision: NOT available (${res.status}: ${body.error?.message ?? 'unknown'}).`);
  console.log('  Turn on the "Cloudinary AI Vision" add-on (free tier) at https://console.cloudinary.com/app/settings/addons');
  console.log('  Until then photos are still uploaded and shown; only the photo flags are skipped.');
}
