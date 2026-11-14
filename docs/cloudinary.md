# Cloudinary in FlatRadar

For the Junction 2026 "Best Use of Cloudinary" challenge. Built with the Cloudinary **Skills Pack**
(`npx skills add cloudinary-devs/skills`, installed in `.claude/skills/`: cloudinary-react, -transformations,
-upload, -docs).

## What it does
1. **Photo pass** (`lib/media/index.mjs`): after a listing is scored, its gallery photos are uploaded to
   Cloudinary (stable public ids per listing) and read by the **AI Vision** add-on in tagging mode, against our own
   condition taxonomy: dated kitchen, dated bathroom, worn floors, damp, worn facade, fresh renovation.
2. **Photo flags**: those tags become `photo_condition` chips next to the renovation-text and PDF flags, each
   linked to the photo that shows it, with a rough typical cost. A bathroom isn't costed if a pipe renovation is
   already planned, because that redoes it anyway.
3. **"See it renovated"** (detail view): a before/after slider. The "after" is a **generative replace** on the photo,
   with the prompt chosen by the room type AI Vision found. Generated on demand only (about 120 transformations
   each). Cloudinary answers `423` while it works, so the client retries until the image loads (about 15 s).
4. **Share card**: `GET /api/listings/:id/card` redirects to a 1200×630 card made only from the delivery URL:
   smart crop (`g_auto`), padding on a Finnish-blue band, and text overlays for the deal, price and address.
   The same card heads the alert email.
5. **Feed and gallery**: smart-cropped cover photos on the cards and a gallery in the detail view, using
   `@cloudinary/url-gen` + `AdvancedImage` with blur placeholders and lazy loading, and `f_auto/q_auto` on every
   image.
6. **Stage demo** (`/mock`): a **Cloudinary Upload Widget** panel (unsigned preset, local files, camera or URL).
   Upload photos of the demo flat, press Publish, and the photo pass and flags run live.

## Setup
1. Create a free account and copy **API environment variable** from the console dashboard into `.env`:
   `CLOUDINARY_URL=cloudinary://<key>:<secret>@<cloud>` (and on Render).
2. Turn on the **Cloudinary AI Vision** add-on (free tier): Console → Settings → Add-ons.
3. `npm run cloudinary-setup` creates the `flatradar_demo` unsigned upload preset and checks AI Vision works.
4. New listings get `photos` from the normal extraction, at no extra cost. Existing listings need the photo
   backfill, which costs **1 Context.dev credit per listing** (an images-only scrape; re-extracting would be 5):
   ```bash
   npm run backfill-photos                      # dry run: count and credits
   npm run backfill-photos -- --sample 3        # 3 credits: check what the portal pages give us
   npm run backfill-photos -- --yes --process   # batch scrape, then Cloudinary upload + AI Vision
   ```
   AI Vision runs only on the 20 best deals by default (`--vision N`), to stay inside the free add-on quota.
   The others are uploaded and shown without analysis. Re-running the photo pass for one listing:
   `POST /admin/photos {"id": "<listing id>"}`.

Without `CLOUDINARY_URL` everything here switches off and the app behaves as before.

## Notes
- Real listing photos belong to the agents. We store copies only to run the analysis for this demo.
- Submission: the challenge also asks for the survey at https://cld.media/hackathon-survey.
