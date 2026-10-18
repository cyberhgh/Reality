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

## Public vs private land visibility

| Spot type | Can place? | Who sees it? |
|-----------|------------|--------------|
| Public-access (Street View / OSM) | Yes | Everyone (`public`) |
| Claimed private land (approved permit) without placer rights | Yes | Creator + land owner until owner **Make public** (`pending_owner`) |
| Unclaimed private / unknown | Yes | Creator only (`private`) until an owner claims the land & approves |
| Placer is land owner / pre-approved on permit | Yes | Everyone if `makePublic` |

Property owners register a **land permit** (Admin tab → request → admin approve). Pending drops on their land appear under **Me → Awaiting your approval**.

Set `PUBLIC_PLACE_POLICY=off` to make everything public by default. Street View / OSM are heuristics, not cadastral proof.

## Admin

Default PIN: `reality-admin` (override with `ADMIN_PIN`)

## Local

```bash
npm install
npm run dev
```

Phone testing needs HTTPS (Vercel deploy or a tunnel).
