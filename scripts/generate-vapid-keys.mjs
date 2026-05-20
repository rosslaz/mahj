#!/usr/bin/env node
/**
 * Generate VAPID keys for Web Push.
 *
 * Run once during setup:
 *   node scripts/generate-vapid-keys.mjs
 *
 * Add the resulting values to:
 *   - .env.local (for local dev)
 *   - Vercel env vars (Production, Preview, Development)
 *
 * Variables to add:
 *   VAPID_PUBLIC_KEY=...           (also used as NEXT_PUBLIC_VAPID_PUBLIC_KEY for the client)
 *   VAPID_PRIVATE_KEY=...          (server-only)
 *   VAPID_SUBJECT=mailto:you@yourdomain.com
 *
 * VAPID keys are application-level credentials. They identify your app to
 * push services (FCM, APNs Web Push, etc). One key pair per app, forever.
 * Don't regenerate after deploying — existing subscriptions would silently
 * fail because they're encrypted to the old public key.
 */

import webpush from 'web-push';

const keys = webpush.generateVAPIDKeys();
console.log('');
console.log('VAPID keys generated. Add these to .env.local and Vercel:');
console.log('');
console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`NEXT_PUBLIC_VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
console.log(`VAPID_SUBJECT=mailto:ross@pungctual.com`);
console.log('');
console.log('Keep VAPID_PRIVATE_KEY secret. Public key can be exposed to clients.');
console.log('');
