"""Tests de gancho.py. Correr desde la raíz del repo:

    python -m unittest discover -s guion/tests
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import gancho  # noqa: E402


class TestGancho(unittest.TestCase):
    def test_gancho_concreto_es_fuerte(self):
        _, overall, verdict, flags = gancho.run("3 señales de que te hackearon Instagram")
        self.assertEqual(verdict, "FUERTE")
        self.assertGreaterEqual(overall, 70)
        self.assertEqual(flags, [])

    def test_saludo_largo_es_flojo_y_se_marca(self):
        texto = ("Hola a todos hoy les voy a hablar de algo muy interesante "
                 "que me pasó la otra semana con mi cuenta")
        _, _, verdict, flags = gancho.run(texto)
        self.assertEqual(verdict, "FLOJO")
        self.assertTrue(any("Saludo" in f for f in flags))

    def test_texto_vacio_no_rompe(self):
        results, overall, verdict, _ = gancho.run("")
        self.assertEqual(verdict, "FLOJO")
        self.assertEqual(set(results), set(gancho.CHECKS))
        self.assertTrue(0 <= overall <= 100)

    def test_puntajes_dentro_de_rango(self):
        for texto in ["Nunca hagas esto", "$18.000 por mes en alquiler", "a" * 300]:
            results, overall, _, _ = gancho.run(texto)
            self.assertTrue(0 <= overall <= 100, texto)
            for check, (score, _) in results.items():
                self.assertTrue(0 <= score <= 100, f"{check}: {texto}")

    def test_largo_ideal_entre_5_y_12_palabras(self):
        score, _ = gancho.check_length("Esto te cuesta plata cada mes")
        self.assertEqual(score, 100.0)
        corto, _ = gancho.check_length("Mirá")
        self.assertLess(corto, 100.0)

    def test_formulas_cargan_y_clasifican(self):
        formulas = gancho.load_formulas()
        self.assertEqual(len(formulas), 26)
        self.assertIsNotNone(gancho.classify("3 señales de que te hackearon Instagram", formulas))


if __name__ == "__main__":
    unittest.main()
