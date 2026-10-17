# Reality (MVP)

Mobile web proof-of-concept: place digital emoji-objects at real-world GPS coordinates, then view them through your phone camera when you are nearby.

## What works in this MVP

- Open on a phone browser (no App Store / Play install)
- Camera + GPS + compass-based AR overlay of nearby objects
- Place an object at your current location (server checks you are within ~40m)
- Admin PIN bypasses the presence check
- Admin can create circular **no-placement zones** that block everyone
- Nearby list + remove (admin)

This is **not** Unity / ARKit Geospatial yet — it is a GPS + heading overlay PoC you can test outdoors today.

## Quick start (local)

```bash
npm install
npm run dev
```

Open `http://localhost:3000` on your computer.

For a **real phone**, use HTTPS (camera/GPS require it on iOS):

1. Deploy to Vercel (recommended), or
2. Tunnel: `npx localtunnel --port 3000` / Cloudflare Tunnel / ngrok

## Admin

Default PIN: `reality-admin`  
Override with env `ADMIN_PIN`.

Enter the PIN under the **admin** tab on your device.

## Persistence

| Environment | Behavior |
|-------------|----------|
| Local | `data/store.json` |
| Vercel + `BLOB_READ_WRITE_TOKEN` | Durable Vercel Blob JSON |
| Vercel without Blob | In-memory (can reset on cold starts) |

## Notes for testers

- Use outdoors with clear GPS
- Allow camera, location, and motion/orientation permissions
- Point the rear camera and slowly rotate to find nearby objects
- Accuracy of overlay depends on phone compass quality
