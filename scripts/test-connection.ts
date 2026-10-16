import * as dotenv from "dotenv";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "../.env") });

const { IG_USER_ID, IG_ACCESS_TOKEN, IG_API_VERSION = "v22.0" } = process.env;

async function main() {
  console.log("🔍 Probando conexión con Instagram...\n");

  const res = await fetch(
    `https://graph.instagram.com/${IG_API_VERSION}/me?fields=id,user_id,username,account_type,media_count,followers_count&access_token=${IG_ACCESS_TOKEN}`
  );
  const data = (await res.json()) as any;

  if (data.error) {
    console.error("❌ Error:", data.error.message);
    process.exit(1);
  }

  console.log("✅ Conectado correctamente!");
  console.log(`   Usuario:     @${data.username}`);
  console.log(`   ID cuenta:   ${data.user_id} ${data.user_id === IG_USER_ID ? "✓ coincide con .env" : "⚠️ no coincide con IG_USER_ID del .env"}`);
  console.log(`   Tipo:        ${data.account_type}`);
  console.log(`   Posts:       ${data.media_count}`);
  console.log(`   Seguidores:  ${data.followers_count ?? "N/A"}`);

  // Verificar expiración del token
  const dbg = await fetch(
    `https://graph.instagram.com/${IG_API_VERSION}/access_token?grant_type=ig_refresh_token&access_token=${IG_ACCESS_TOKEN}`
  );
  const tokenInfo = (await dbg.json()) as any;
  if (tokenInfo.expires_in) {
    const days = Math.round(tokenInfo.expires_in / 86400);
    console.log(`\n🔑 Token renovado — válido por ${days} días más.`);
    console.log("   (ejecuta `npm run refresh` cada ~50 días para mantenerlo activo)");
  }
}

main().catch((e) => {
  console.error("❌", e.message);
  process.exit(1);
});
