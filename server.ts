import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import multer from "multer";
import sharp from "sharp";
import fs from "fs";

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Multer setup for image uploads
  const upload = multer({ storage: multer.memoryStorage() });

  app.use(express.json({ limit: '50mb' }));

  // API Route: Image Optimization
  app.post("/api/optimize-image", upload.single('image'), async (req: any, res: any) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No image uploaded" });
      }

      const optimizedBuffer = await sharp(req.file.buffer)
        .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 80 })
        .toBuffer();

      const base64 = optimizedBuffer.toString('base64');
      res.json({ base64: `data:image/jpeg;base64,${base64}` });
    } catch (error) {
      console.error("Optimization error:", error);
      res.status(500).json({ error: "Failed to optimize image" });
    }
  });

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
