"""Tests de caption.py. Correr desde la raíz del repo:

    python -m unittest discover -s guion/tests
"""
import os
import sys
import unittest

GUION = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, GUION)

import caption  # noqa: E402


def chequeo(resultado, nombre):
    return next(c for c in resultado["chequeos"] if c["check"] == nombre)


class TestCaption(unittest.TestCase):
    def test_ejemplo_del_repo_esta_listo(self):
        with open(os.path.join(GUION, "ejemplos", "caption-ejemplo.txt"), encoding="utf-8") as f:
            a = caption.analyse(f.read())
        self.assertEqual(a["veredicto"], "LISTO")

    def test_pasarse_del_limite_falla(self):
        a = caption.analyse("a" * (caption.LIMIT + 100))
        self.assertEqual(chequeo(a, "LARGO")["status"], "FALLA")
        self.assertEqual(a["veredicto"], "CORREGIR")

    def test_ventana_visible_se_corta_en_125(self):
        a = caption.analyse("b" * 300)
        self.assertTrue(a["truncado"])
        self.assertEqual(len(a["visible"]), caption.TRUNCATE)

    def test_abrir_con_hashtag_falla(self):
        a = caption.analyse("#tips para tu cuenta")
        self.assertEqual(chequeo(a, "PRIMERA LÍNEA")["status"], "FALLA")

    def test_abrir_con_saludo_falla(self):
        a = caption.analyse("Hola gente, hoy les cuento algo")
        self.assertEqual(chequeo(a, "PRIMERA LÍNEA")["status"], "FALLA")

    def test_mas_de_cinco_hashtags_falla(self):
        tags = " ".join(f"#tema{i}" for i in range(caption.HASHTAG_LIMIT + 2))
        a = caption.analyse("3 errores comunes\n\n" + tags)
        self.assertEqual(chequeo(a, "HASHTAGS")["status"], "FALLA")

    def test_links_se_marcan(self):
        a = caption.analyse("Mirá esto en https://ejemplo.com/guia")
        self.assertEqual(chequeo(a, "LINKS")["status"], "OJO")


if __name__ == "__main__":
    unittest.main()
