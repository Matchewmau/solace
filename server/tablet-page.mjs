function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function renderTabletPage({ url, qrSvg }) {
  const hasUrl = url !== null && url !== undefined;
  const safeUrl = hasUrl ? escapeHtml(url) : "";
  const content = hasUrl
    ? `<p class="lead">Scan this code with your tablet camera.</p>
      <div class="qr-card">${
        qrSvg
          ? qrSvg
          : `<p class="qr-missing">QR code unavailable. Open the address below on your tablet.</p>`
      }</div>
      <p class="address"><code id="address">${safeUrl}</code></p>
      <button type="button" id="copy" data-copy="${safeUrl}">Copy address</button>
      <p class="hint">The tablet must be on the same Wi-Fi as this laptop.</p>
      <p class="hint">If the address changes, reload this page and scan the new code.</p>`
    : `<p class="warning">This laptop is not connected to the local network. Connect it to Wi-Fi and reload this page.</p>`;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Solace on your tablet</title>
    <style>
      :root {
        color-scheme: light;
        font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
      }
      * {
        box-sizing: border-box;
      }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: 24px;
        background: #f3f0ea;
        color: #2b2620;
      }
      .card {
        width: min(100%, 560px);
        padding: clamp(24px, 6vw, 48px);
        border-radius: 24px;
        background: #ffffff;
        box-shadow: 0 18px 50px rgba(43, 38, 32, 0.12);
        text-align: center;
      }
      h1 {
        margin: 0 0 12px;
        font-size: clamp(1.7rem, 5vw, 2.4rem);
        line-height: 1.15;
      }
      .lead {
        margin: 0 0 24px;
        color: #5d554b;
        font-size: clamp(1.05rem, 2.6vw, 1.25rem);
      }
      .qr-card {
        width: min(320px, 100%);
        margin: 0 auto 24px;
        padding: 16px;
        border: 1px solid #e7e1d7;
        border-radius: 18px;
        background: #ffffff;
      }
      .qr-card svg {
        display: block;
        width: 100%;
        height: auto;
      }
      .qr-missing {
        margin: 0;
        padding: 32px 12px;
        color: #5d554b;
        font-size: 1.05rem;
      }
      .address {
        margin: 0 0 16px;
        word-break: break-all;
      }
      code {
        font-size: clamp(1.05rem, 3vw, 1.3rem);
        font-weight: 600;
        color: #2b2620;
      }
      button {
        min-height: 52px;
        padding: 0 28px;
        border: 0;
        border-radius: 999px;
        background: #2b2620;
        color: #ffffff;
        font: inherit;
        font-size: 1.05rem;
        font-weight: 600;
        cursor: pointer;
        touch-action: manipulation;
      }
      button:active {
        transform: scale(0.98);
      }
      .hint,
      .warning {
        color: #5d554b;
        font-size: clamp(1rem, 2.4vw, 1.1rem);
        line-height: 1.5;
      }
      .hint {
        margin: 20px 0 0;
      }
      .warning {
        margin: 0;
        padding: 18px;
        border-radius: 14px;
        background: #fff6e5;
        color: #6b4a00;
      }
      @media (max-width: 480px) {
        body {
          padding: 12px;
        }
        .card {
          border-radius: 18px;
        }
      }
    </style>
  </head>
  <body>
    <main class="card">
      <h1>Solace on your tablet</h1>
      ${content}
    </main>
    <script>
      (() => {
        const button = document.getElementById("copy");
        if (!button) return;
        const address = document.getElementById("address");

        button.addEventListener("click", async () => {
          const value = button.getAttribute("data-copy") || "";
          let copied = false;

          try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
              await navigator.clipboard.writeText(value);
              copied = true;
            }
          } catch {
            copied = false;
          }

          if (!copied) {
            const range = document.createRange();
            range.selectNodeContents(address);
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);
            button.textContent = "Address selected — press Ctrl+C";
            return;
          }

          button.textContent = "Copied";
          setTimeout(() => {
            button.textContent = "Copy address";
          }, 2000);
        });
      })();
    </script>
  </body>
</html>`;
}
