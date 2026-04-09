# This2Them — Netlify Deployment Guide

## Deploy via Drag-and-Drop

1. Go to [app.netlify.com](https://app.netlify.com) and log in (or sign up free).
2. From your team dashboard, drag the entire `this2them/` folder onto the drop zone that says **"Drag and drop your site output folder here"**.
3. Netlify will deploy instantly and give you a live URL.

## Set the TMDB API Key

The game uses a serverless function to keep your API key secret. You must add it as an environment variable:

1. In the Netlify dashboard, open your site.
2. Go to **Site configuration → Environment variables**.
3. Click **Add a variable** and set:
   - **Key:** `TMDB_API_KEY`
   - **Value:** your TMDB Read Access Token (the long "ey…" token from [themoviedb.org/settings/api](https://www.themoviedb.org/settings/api))
4. Click **Save**, then go to **Deploys** and trigger a **Redeploy** so the function picks up the new variable.

## Free Tier Limits

Netlify's free tier includes **~125,000 serverless function invocations per month**. Each TMDB lookup (movie search, cast fetch, actor lookup) counts as one call. Normal gameplay uses roughly 5–15 calls per game session, so the free tier supports thousands of games per month.
