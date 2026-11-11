#!/usr/bin/env python3
"""Unit tests for high-specificity Persian Moderation rules."""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RULES_DIR = ROOT / "python-ai" / "services" / "ai_moderation"
sys.path.insert(0, str(RULES_DIR))

from moderation_rules import normalize_for_rules, rule_based_check  # noqa: E402


class PersianModerationRuleTests(unittest.TestCase):
    def assert_allowed(self, text: str) -> None:
        result = rule_based_check(text)
        self.assertTrue(result["allowed"], f"False positive for {text!r}: {result}")

    def assert_blocked(self, text: str, category: str) -> None:
        result = rule_based_check(text)
        self.assertFalse(result["allowed"], f"Missed violation for {text!r}: {result}")
        self.assertEqual(result.get("category"), category, result)

    def test_reported_lexical_collisions_are_allowed(self):
        self.assert_allowed("گروه کتاب‌خوانی محله‌مان هر هفته جلسه دارد.")
        self.assert_allowed("قیمت کتاب را از کتاب‌فروشی پرسیدم.")
        self.assert_allowed("درباره کانال تلویزیونی مستند صحبت می‌کردیم.")
        self.assert_allowed("در اینستاگرام کاری ندارم؛ درباره هنر کلاسیک حرف می‌زنم.")

    def test_neutral_discussion_of_threats_is_not_a_threat(self):
        self.assert_allowed("از تهدید و خشونت در گفتگو استفاده نکنیم.")
        self.assert_allowed("می‌خواهم اختلاف را بدون تهدید حل کنیم.")
        self.assert_allowed("اگر احساس خطر کردی گفتگو را متوقف و گزارش کن.")
        self.assert_allowed("از آزار و تهدید دیگران پرهیز کنیم.")

    def test_normalization_handles_arabic_forms_diacritics_and_spaced_evasion(self):
        self.assertEqual(normalize_for_rules("كِتاب يَک‌روز"), "کتاب یکروز")
        self.assertEqual(normalize_for_rules("ت ل گرام"), "تلگرام")
        self.assertEqual(normalize_for_rules("آی دی"), "آیدی")
        self.assert_blocked("بیا تِلگِرام صحبت کنیم.", "external_contact")
        self.assert_blocked("بیا در ت ل گرام حرف بزنیم.", "external_contact")
        self.assert_blocked("آیدی واتس‌اَپت رو بده.", "external_contact")
        self.assert_blocked("آی دی واتساپت را بفرست.", "external_contact")

    def test_external_contact_requires_actionable_transfer_or_link(self):
        samples = [
            "برای ادامه گفتگو بیا تلگرام.",
            "لطفاً آیدی واتساپت رو بفرست.",
            "بیا بیرون از برنامه در اینستاگرام صحبت کنیم.",
            "شماره تلفنت رو بده تا خارج از اپ پیام بدم.",
            "لینک t.me/example را باز کن.",
            "برای ارتباط بیرون برنامه، شماره‌ات را بفرست.",
        ]
        for sample in samples:
            with self.subTest(sample=sample):
                self.assert_blocked(sample, "external_contact")

    def test_financial_solicitation_requires_payment_or_bank_action(self):
        samples = [
            "برای دریافت جایزه، مبلغ را کارت به کارت کن.",
            "شماره کارتت را برای واریز وجه بفرست.",
            "برای سود تضمینی پولت را به این حساب منتقل کن.",
            "سرمایه‌ات را به حساب من واریز کن.",
        ]
        for sample in samples:
            with self.subTest(sample=sample):
                self.assert_blocked(sample, "financial_solicitation")
        self.assert_allowed("قیمت این کالا را می‌پرسم؛ قصد خرید ندارم.")
        self.assert_allowed("به خریدوفروش آثار هنری علاقه‌ای ندارم؛ بیشتر کتاب می‌خوانم.")

    def test_direct_threats_and_coercion_are_blocked(self):
        self.assert_blocked("تهدیدت می‌کنم اگر جواب ندهی.", "direct_threat")
        self.assert_blocked("من تو را پیدا می‌کنم و به تو آسیب می‌زنم.", "direct_threat")
        self.assert_blocked("I will kill you.", "direct_threat")
        self.assert_blocked("به مرزهای تو احترام نمی‌گذارم.", "harassment")

    def test_length_limit_and_invalid_input_remain_fail_closed(self):
        self.assertFalse(rule_based_check("   ")["allowed"])
        self.assertEqual(rule_based_check("x" * 2001)["reason"], "text_too_long")


if __name__ == "__main__":
    unittest.main(verbosity=2)
