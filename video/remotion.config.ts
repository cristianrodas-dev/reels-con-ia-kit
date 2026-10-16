import { Config } from "@remotion/cli/config";

// Salida pensada para Instagram: H.264, calidad alta, audio AAC.
Config.setVideoImageFormat("jpeg");
Config.setCodec("h264");
Config.setCrf(18);
Config.setOverwriteOutput(true);
