# PLAYBASE

A small hub of browser games, deployed as one Netlify site. The root [index.html](index.html) is the hub; each game lives in its own folder under `games/`.

| Game | Path | Status |
|---|---|---|
| This2Them | `games/this2them/` | Live |
| Untitled Movie Game | — | Planned |
| Untitled Valorant Game | — | Planned |

---

# This2Them

## Can you connect two actors through shared films?

This2Them is a cinephile web game inspired by Six Degrees of Kevin Bacon. Given a start actor and a target actor, find the shortest chain of co-stars and films that connects them in as few hops as possible

## How It Works

Each "hop" is a movie + co-star. You name a film the current actor appeared in, then name another actor from that film's cast. Repeat until you reach the target.
Example: Tom Hanks → (Cast Away) → Helen Hunt → (As Good as It Gets) → Jack Nicholson
Three difficulty modes — Easy, Medium, and Hard — control how far apart the actor pairs are. Hard mode bridges classic Hollywood (pre-1960s) with modern stars, making direct connections impossible.


## Features

* 🎭 100+ curated actor pairs across Easy, Medium, and Hard difficulty
* 🤖 AI-powered hints via Gemini 2.5 Flash — adaptive to difficulty and your current chain
* 🔍 Real-time TMDB validation — every move verified against The Movie Database API
* 🎬 Autocomplete for movies and actors powered by live TMDB search
* 🏆 Local leaderboard tracking your best chains by hops and difficulty
* ⚙️ Settings — toggle MCU/DCU films and filter by era


## Tech Stack
| Layer | Technology |
|---|---|
| Frontend | Vanilla JS, HTML/CSS — single file, no framework |
| Functions  |     Node.js serverless functions (Netlify Functions)|
| AI Hints    |    Google Gemini 2.5 Flash API|
| Movie Data   |   TMDB (The Movie Database) REST API|
| Deployment    |  Netlify (CI/CD via GitHub)|

