import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath, pathToFileURL } from "url";

// Cargar variables de entorno desde .env en el directorio padre
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "../.env") });

const IG_USER_ID = process.env.IG_USER_ID!;
const IG_ACCESS_TOKEN = process.env.IG_ACCESS_TOKEN!;
const IG_API_VERSION = process.env.IG_API_VERSION || "v22.0";

if (!IG_USER_ID || !IG_ACCESS_TOKEN) {
  console.error("ERROR: Faltan IG_USER_ID o IG_ACCESS_TOKEN en .env");
  process.exit(1);
}

// ── Recarga en caliente de tools.ts ─────────────────────────────────
// Cada llamada importa tools.ts usando su fecha de modificación como clave:
// si el archivo cambió, se carga la versión nueva sin reiniciar Claude.
const TOOLS_PATH = path.join(__dirname, "tools.ts");
let loadedMtime = 0;
let toolsModule: typeof import("./tools.js") | null = null;

async function getTools() {
  const mtime = fs.statSync(TOOLS_PATH).mtimeMs;
  if (!toolsModule || mtime !== loadedMtime) {
    const url = `${pathToFileURL(TOOLS_PATH).href}?v=${mtime}`;
    toolsModule = (await import(url)) as typeof import("./tools.js");
    toolsModule.configure({ userId: IG_USER_ID, token: IG_ACCESS_TOKEN, apiVersion: IG_API_VERSION });
    loadedMtime = mtime;
    console.error(`[instagram-mcp] tools.ts cargado (${new Date(mtime).toISOString()})`);
  }
  return toolsModule;
}

const server = new Server(
  { name: "instagram-mcp", version: "1.1.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "publish_reel",
      description: "Publica un Reel en Instagram. Acepta una URL pública del MP4 o una ruta local (la sube al almacenamiento, publica y borra la copia). 9:16, máx 90s. Solo usar con aprobación explícita del usuario.",
      inputSchema: {
        type: "object",
        properties: {
          video_url: { type: "string", description: "URL pública del MP4, o ruta local del archivo en esta PC" },
          caption: { type: "string", description: "Texto del pie de foto con hashtags" },
          cover_url: { type: "string", description: "URL de la imagen de portada (opcional)" },
          share_to_feed: { type: "boolean", description: "Mostrar también en el feed (default true)", default: true },
          keep_in_storage: { type: "boolean", description: "Conservar la copia en el almacenamiento tras publicar (default false)", default: false },
        },
        required: ["video_url", "caption"],
      },
    },
    {
      name: "upload_video",
      description: "Sube un MP4 local al almacenamiento (Supabase, bucket reels) y devuelve su URL pública, para publicar más tarde",
      inputSchema: {
        type: "object",
        properties: {
          video_path: { type: "string", description: "Ruta local del MP4 en esta PC" },
          name: { type: "string", description: "Nombre del objeto (opcional; default fecha-nombre.mp4)" },
        },
        required: ["video_path"],
      },
    },
    {
      name: "delete_video",
      description: "Borra un video del almacenamiento (bucket reels)",
      inputSchema: {
        type: "object",
        properties: {
          object: { type: "string", description: "Nombre del objeto, tal como lo devolvió upload_video" },
        },
        required: ["object"],
      },
    },
    {
      name: "get_media_insights",
      description: "Estadísticas de un post o Reel: vistas, alcance, shares, guardados, tiempo de visualización",
      inputSchema: {
        type: "object",
        properties: {
          media_id: { type: "string", description: "ID del post de Instagram" },
        },
        required: ["media_id"],
      },
    },
    {
      name: "list_recent_media",
      description: "Lista los últimos posts publicados con likes, comentarios y link",
      inputSchema: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Cantidad de posts (máx 20)", default: 10 },
        },
      },
    },
    {
      name: "get_account_insights",
      description: "Estadísticas generales de la cuenta: alcance, vistas, seguidores, interacciones",
      inputSchema: {
        type: "object",
        properties: {
          period: {
            type: "string",
            enum: ["day", "week", "days_28"],
            description: "Período de tiempo",
            default: "week",
          },
        },
      },
    },
    {
      name: "analyze_viral_patterns",
      description: "Rankea los Reels por rendimiento real (vistas, shares, guardados, retención) y detecta qué patrones funcionan",
      inputSchema: { type: "object", properties: {} },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    const tools = await getTools();
    return await tools.handleTool(name, args ?? {});
  } catch (error: any) {
    return {
      content: [{ type: "text", text: `❌ Error: ${error.message}` }],
      isError: true,
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Instagram MCP server iniciado ✅");
}

main().catch(console.error);
