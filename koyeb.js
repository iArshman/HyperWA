import express from "express";
import http from "http";
import https from "https";

const app = express();
const PORT = process.env.PORT || 8000;

let REAL_URL = null;
let BOT_HEALTHY = false;

// Guess from env first

if (process.env.KOYEB_PUBLIC_URL) REAL_URL = process.env.KOYEB_PUBLIC_URL;

// Log helper
const log = (...msg) => console.log("[KeepAlive ADV]", ...msg);

//  Learn REAL public URL from proxy headers (Koyeb )
app.use((req, res, next) => {
    const proto = req.headers["x-forwarded-proto"];
    const host = req.headers["x-forwarded-host"] || req.headers.host;

    if (proto && host) {
        const newURL = `${proto}://${host}`;
        if (REAL_URL !== newURL) {
            REAL_URL = newURL;
            log(" Learned domain:", REAL_URL);
            restartExternalPinger();
        }
    }
    next();
});

//  UI
app.get("/", (req, res) => {
    const up = process.uptime();
    const h = Math.floor(up / 3600);
    const m = Math.floor((up % 3600) / 60);
    const s = Math.floor(up % 60);

    res.send(`
        <html>
<head>
    <title>HyperWa Bot</title>
    <style>
        body {
            margin: 0;
            background: linear-gradient(135deg, #0f0f0f, #1b1b1b);
            font-family: Arial, sans-serif;
            color: #eee;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
        }

        .card {
            background: #181818;
            padding: 30px 40px;
            border-radius: 18px;
            box-shadow: 0 0 20px rgba(0,0,0,0.6);
            width: 420px;
            text-align: center;
        }

        h1 {
            margin-top: 0;
            margin-bottom: 20px;
            color: #00e676;
        }

        table {
            width: 100%;
            margin-top: 20px;
            border-collapse: collapse;
        }

        td {
            padding: 8px 0;
            border-bottom: 1px solid #333;
            font-size: 14px;
            color: #ddd;
        }

        .badge {
            padding: 4px 10px;
            border-radius: 6px;
            font-size: 12px;
            color: #fff;
        }

        .ok { background: #00c853; }
        .init { background: #ffb300; }
    </style>

    <!-- Auto-refresh every 10 seconds -->
    <meta http-equiv="refresh" content="10">
</head>

<body>
    <div class="card">
        <h1>HyperWa Bot</h1>

        <table>
            <tr>
                <td>Status</td>
                <td><span class="badge ok">Running</span></td>
            </tr>

            <tr>
                <td>Uptime</td>
                <td>${h}h ${m}m ${s}s</td>
            </tr>

        </table>
        
    </div>
</body>
</html>

    `);
});

// Health
app.get("/health", (req, res) => {
    res.json({
        ok: true,
        uptime: process.uptime(),
        detected: REAL_URL,
        bot: BOT_HEALTHY,
        ts: new Date().toISOString()
    });
});

//  Whoami debug
app.get("/whoami", (req, res) => {
    res.json({
        detected_url: REAL_URL,
        headers: {
            "x-forwarded-proto": req.headers["x-forwarded-proto"],
            "x-forwarded-host": req.headers["x-forwarded-host"],
            host: req.headers.host
        }
    });
});

//  Bot status endpoint
app.post("/bot-status", (req, res) => {
    BOT_HEALTHY = req.body?.healthy !== false;
    res.json({ ok: true });
});

//  Local ping (keeps Node active)
let localTimer = null;
function startLocalPinger() {
    if (localTimer) clearInterval(localTimer);

    const localURL = `http://127.0.0.1:${PORT}/health`;
    log("Local pinger ->", localURL);

    localTimer = setInterval(() => {
        http.get(localURL, res => res.resume());
    }, 120000); // every 2 min
}
startLocalPinger();

//  External pinger (only after REAL_URL learned)
let externalTimer = null;

function restartExternalPinger() {
    if (!REAL_URL) return;
    if (externalTimer) clearInterval(externalTimer);

    const url = REAL_URL + "/health";
    const isHttps = REAL_URL.startsWith("https");
    const proto = isHttps ? https : http;

    log("External pinger ->", url);

    externalTimer = setInterval(async () => {
        try {
            const time = new Date().toISOString();
            log(`PING → ${url} @ ${time}`);

            proto.get(url, res => {
                res.on("data", () => {});
                res.on("end", () => {
                    if (res.statusCode === 200) {
                        log(" External ping OK");
                    } else {
                        log("⚠️ Non-200 status:", res.statusCode);
                    }
                });
            }).on("error", () => {
                log("❌ External ping failed");
            });

        } catch {}
    }, 240000); // every 4 minutes
}

// Domain verification (HEAD request) every 10 min
setInterval(() => {
    if (!REAL_URL) return;

    const checkURL = REAL_URL + "/health";
    const proto = REAL_URL.startsWith("https") ? https : http;

    proto.request(checkURL, { method: "HEAD", timeout: 3000 }, (res) => {
        if (res.statusCode === 200) log("Domain verified:", REAL_URL);
        else log(" Domain check returned:", res.statusCode);
    }).on("error", () => {
        log("❌ Domain failed. Waiting for new whoami header...");
    }).end();

}, 600000); // every 10 minutes

//  Start server
const server = app.listen(PORT, "0.0.0.0", () => {
    log(`Server running on ${PORT}`);
    log(`Initial URL: ${REAL_URL || "none"}`);
    if (REAL_URL) restartExternalPinger();
});

//  Safe exit
process.on("SIGTERM", () => server.close(() => process.exit(0)));
process.on("SIGINT", () => server.close(() => process.exit(0)));

export { server, app };
