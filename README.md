# Reality

Social geo layer: members drop digital objects in the real world for others to find, react to, and share.

## Live

https://reality-geo-mvp.vercel.app

## Core loop

1. Pick a display name
2. Drop an object at your location (optional fine-tune + landmark photo + snap QR)
3. Others discover it nearby, follow turn guidance, mark **Found**, react, share

## Accuracy stack (beyond raw GPS)

- High-accuracy GPS with sample blending
- Compass heading for AR guidance
- Step-based dead reckoning between GPS fixes
- Manual N/E fine-tune (± meters) at drop time
- Snap codes + QR (strongest non-GPS lock when posted on-site)
- Optional WebXR hit-test probe when the device supports it
- Landmark photos to help visual recognition

## Admin

Default PIN: `reality-admin` (override with `ADMIN_PIN`)

## Local

```bash
npm install
npm run dev
```

Phone testing needs HTTPS (Vercel deploy or a tunnel).
