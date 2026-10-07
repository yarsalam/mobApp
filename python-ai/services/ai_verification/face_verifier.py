import logging
import os

logger = logging.getLogger(__name__)

CONFIDENCE_THRESHOLD = float(os.getenv("VERIFICATION_THRESHOLD", "0.4"))


class FaceVerifier:
    def verify(self, selfie_path: str, profile_path: str) -> dict:
        try:
            from deepface import DeepFace

            result = DeepFace.verify(
                img1_path=selfie_path,
                img2_path=profile_path,
                model_name="Facenet",
                enforce_detection=True,
                detector_backend="opencv",
            )

            confidence = round(float(1 - result.get("distance", 1.0)), 3)
            verified = result.get("verified", False)

            return {
                "verified": verified,
                "confidence": confidence,
                "distance": round(float(result.get("distance", 1.0)), 4),
                "message": "✅ چهره تأیید شد" if verified else "❌ چهره مطابقت ندارد",
            }

        except ValueError as exc:
            # DeepFace raises ValueError when no face is detected
            logger.warning("No face detected: %s", exc)
            return {
                "verified": False,
                "confidence": 0.0,
                "distance": 1.0,
                "message": "چهره‌ای در تصویر شناسایی نشد",
            }
        except Exception as exc:
            logger.error("Verification error: %s", exc)
            return {
                "verified": False,
                "confidence": 0.0,
                "distance": 1.0,
                "message": "خطا در بررسی تصویر",
            }
