/**
 * Renueva el token de larga duración de Instagram (válido 60 días).
 * Ejecutar cada ~50 días: npm run refresh
 * Actualiza automáticamente el archivo .env
 */
import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, "../.env");
dotenv.config({ path: envPath });

const { IG_ACCESS_TOKEN, IG_API_VERSION = "v22.0" } = process.env;

async function main() {
  const res = await fetch(
    `https://graph.instagram.com/${IG_API_VERSION}/refresh_access_token?grant_type=ig_refresh_token&access_token=${IG_ACCESS_TOKEN}`
  );
  const data = (await res.json()) as any;

  if (data.error) {
    console.error("❌ No se pudo renovar:", data.error.message);
    console.error("   Genera un token nuevo en developers.facebook.com → tu app → Casos de uso → Generar token");
    process.exit(1);
  }

  const env = fs.readFileSync(envPath, "utf8");
  const updated = env.replace(/^IG_ACCESS_TOKEN=.*$/m, `IG_ACCESS_TOKEN=${data.access_token}`);
  fs.writeFileSync(envPath, updated);

  const days = Math.round(data.expires_in / 86400);
  console.log(`✅ Token renovado y guardado en .env — válido por ${days} días.`);
}

main();
