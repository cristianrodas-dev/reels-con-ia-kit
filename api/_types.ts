/**
 * Tipos de los objetos request/response que Vercel pasa a las funciones de api/.
 *
 * Son los mismos que define el paquete @vercel/node, copiados acá para no
 * instalarlo: el runtime de Vercel ya agrega estos helpers por su cuenta, y ese
 * paquete arrastraba versiones viejas de undici y minimatch con alertas de
 * seguridad. El guion bajo hace que Vercel no lo publique como endpoint.
 */
import type { IncomingMessage, ServerResponse } from "node:http";

export type VercelRequest = IncomingMessage & {
  query: { [key: string]: string | string[] };
  cookies: { [key: string]: string };
  body: any;
};

export type VercelResponse = ServerResponse & {
  send: (body: any) => VercelResponse;
  json: (jsonBody: any) => VercelResponse;
  status: (statusCode: number) => VercelResponse;
  redirect: (statusOrUrl: string | number, url?: string) => VercelResponse;
};
