import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";
import { createShare, fetchShare } from "./server/shareStore";

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Raised limit: base64-encoded file payloads (QRMesh sequences, AirVault
  // PNGs) run ~33% larger than the original bytes. Note this only matters on
  // platforms with a real Express server (Render/Koyeb) — Vercel's request
  // body limit is fixed by the platform regardless of this setting.
  app.use(express.json({ limit: "45mb" }));

  // API Routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Share-link endpoints — used by QRMesh, SoundMesh, and AirVault's
  // "Copy Link" / "Paste link to decode" features. Storage is Telegram
  // (see server/shareStore.ts); the link itself is a signed, self-contained
  // token, so there's nothing to persist locally.
  app.post("/api/share", async (req, res) => {
    try {
      const appUrl = process.env.APP_URL || `${req.protocol}://${req.get("host")}`;
      const result = await createShare(req.body || {}, appUrl);
      res.json(result);
    } catch (err: any) {
      console.error("share upload error:", err);
      res.status(err.status || 500).json({ error: err.message || "Failed to create share link." });
    }
  });

  app.get("/api/share/:id", async (req, res) => {
    try {
      const result = await fetchShare(req.params.id || "");
      res.json(result);
    } catch (err: any) {
      console.error("share fetch error:", err);
      res.status(err.status || 404).json({ error: err.message || "Share link not found or expired." });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    // For Express 4
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
