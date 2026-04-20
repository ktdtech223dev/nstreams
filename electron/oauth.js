// Loopback OAuth helper — spins up a one-shot HTTP server on 127.0.0.1
// to catch redirects from providers that don't support custom URI schemes
// (MAL, AniList, most OAuth providers).
//
// Flow:
//   1. Call waitForCallback({ port, path }) — returns a Promise
//   2. Open the provider's auth URL in the user's browser
//   3. Provider redirects to http://localhost:<port><path>?code=...
//   4. We catch it, show a friendly HTML page, resolve with the query params
//   5. Server shuts down immediately after

const http = require('http');

const FRIENDLY_PAGE = (title, message) => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${title}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0; min-height: 100vh;
      display: flex; align-items: center; justify-content: center;
      background: radial-gradient(circle at 50% 50%, #16162a, #080810);
      font-family: system-ui, -apple-system, sans-serif; color: #e2e8f0;
    }
    .card {
      max-width: 480px; padding: 40px;
      background: #0f0f1a; border: 1px solid #1e1e35;
      border-radius: 16px; text-align: center;
      box-shadow: 0 20px 60px rgba(99,102,241,0.25);
    }
    h1 { font-family: "Bebas Neue", system-ui; font-size: 48px; margin: 0 0 8px; letter-spacing: 2px; }
    .accent { color: #6366f1; }
    p { color: #94a3b8; margin: 12px 0; }
    button {
      margin-top: 20px; padding: 10px 24px;
      background: #6366f1; color: white; border: 0; border-radius: 8px;
      font-size: 14px; font-weight: 500; cursor: pointer;
    }
  </style>
</head>
<body>
  <div class="card">
    <h1><span class="accent">N</span> STREAMS</h1>
    <p>${message}</p>
    <button onclick="window.close()">Close this tab</button>
    <script>setTimeout(() => { try { window.close(); } catch(e){} }, 3000);</script>
  </div>
</body>
</html>`;

function waitForCallback({ port, path, timeoutMs = 10 * 60 * 1000 } = {}) {
  return new Promise((resolve, reject) => {
    let resolved = false;

    const server = http.createServer((req, res) => {
      try {
        const url = new URL(req.url, `http://127.0.0.1:${port}`);
        if (url.pathname !== path) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('Not found');
          return;
        }
        const params = Object.fromEntries(url.searchParams);

        // For providers using implicit flow (AniList), the token comes back
        // as a URL fragment — the fragment isn't sent to the server. Serve
        // a tiny page that reads window.location.hash and POSTs it back.
        if (!params.code && !params.token && !params.error) {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(`<!DOCTYPE html><html><body>
            <script>
              var frag = window.location.hash.substring(1);
              if (frag) {
                fetch(window.location.pathname + '?' + frag)
                  .then(() => { document.body.innerHTML = 'Authorized — you can close this tab.'; setTimeout(()=>{try{window.close()}catch(e){}}, 1500); });
              } else {
                document.body.innerText = 'Missing authorization data.';
              }
            </script>
            Authorizing…
          </body></html>`);
          return;
        }

        res.writeHead(200, { 'Content-Type': 'text/html' });
        if (params.error) {
          res.end(FRIENDLY_PAGE('Authorization failed',
            `<b style="color:#ef4444">Authorization was denied or failed.</b><br>${params.error_description || params.error}`));
        } else {
          res.end(FRIENDLY_PAGE('Authorized ✓', 'You can close this tab and return to N Streams.'));
        }

        if (!resolved) {
          resolved = true;
          setImmediate(() => server.close());
          if (params.error) reject(new Error(params.error_description || params.error));
          else resolve(params);
        }
      } catch (e) {
        res.writeHead(500).end();
        if (!resolved) { resolved = true; reject(e); }
      }
    });

    server.on('error', (e) => { if (!resolved) { resolved = true; reject(e); } });
    server.listen(port, '127.0.0.1');

    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        server.close();
        reject(new Error('OAuth timed out — no response in 10 minutes'));
      }
    }, timeoutMs);
  });
}

// Ports chosen so they're unlikely to conflict with common dev tools
const MAL_REDIRECT = { port: 57835, path: '/mal-callback' };
const ANILIST_REDIRECT = { port: 57836, path: '/anilist-callback' };

function malRedirectUri() { return `http://localhost:${MAL_REDIRECT.port}${MAL_REDIRECT.path}`; }
function anilistRedirectUri() { return `http://localhost:${ANILIST_REDIRECT.port}${ANILIST_REDIRECT.path}`; }

module.exports = {
  waitForCallback,
  MAL_REDIRECT, ANILIST_REDIRECT,
  malRedirectUri, anilistRedirectUri
};
