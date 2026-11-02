# ARMY Heart Map

The website for the BTS MAMA Awards 2026 voting challenge. Each continent has one Instagram post, and every comment on that post lights one purple heart on that continent's map. All participation happens on Instagram; the site only displays the result.

## Set up the challenge

1. Publish the six posts (Asia, Europe, Africa, North America, South America, Oceania) on Instagram.
2. Paste each post's link into `postUrl` in `data/challenge.json`. Set `voteUrl` to the MAMA voting page, and check that `instagram` is the right handle.
3. Push to `main` on GitHub and set Settings, Pages, Source to **GitHub Actions**.

The site shows sample hearts, and says so on the page, until the first save.

## Update the hearts

Open `admin.html` on the published site (for example `https://<owner>.github.io/<repo>/admin.html`), type each post's comment count and press **Save counts**. Each comment is one heart. The map updates in about 2 minutes, and open pages light the new hearts without a reload.

Saving a lower number than the current one asks you to press Save again, in case it's a typo.

### Your access token

The page is public but can't save without a token, so only people with one can change the counts. Create one at [github.com/settings/personal-access-tokens/new](https://github.com/settings/personal-access-tokens/new):

- **Resource owner:** the account or organization that owns the repo
- **Repository access:** only this repo
- **Permissions:** Contents, Read and write
- **Expiration:** after the challenge ends

Paste it into the page once. Only tick **Remember on this device** on your own device. Each helper who updates counts needs their own token and write access to the repo.

## Save an image for Instagram

**Save map image** under the map makes a 1080 x 1350 PNG of whichever map is showing, with the latest counts and date. On a phone, choose **Save Image** in the share sheet.

## The headline

`assets/headline-light.png` (purple, for the page) and `assets/headline.png` (white, for saved images) are the poster's headline rendered in Bacony Script by Måns Grebäck. They're images so the font file itself isn't published. To change the wording, render both again. Commercial licenses for the font are at [mansgreback.com](https://www.mansgreback.com).

## Reading counts from Instagram

`scripts/sync-instagram.mjs` isn't used by the site. It's kept in case the counts are ever read from Instagram automatically, which needs a Meta app and business portfolio.

## Run locally

```
npm start
```

This opens the map at `http://localhost:3000/` and a practice update page at `http://localhost:3000/admin.html`. Practice numbers stay on your computer and never change the live site. `npm run reset` clears them.

`npm run build:map` regenerates `data/continents.json`. You only need it if you change the map shapes. Russia is split at 60°E between Europe and Asia.
