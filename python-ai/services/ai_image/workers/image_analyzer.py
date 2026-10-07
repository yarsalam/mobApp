import logging
import time
from typing import Dict, List

import cv2
import numpy as np

logger = logging.getLogger(__name__)


class ImageAnalyzerWorker:
    def analyze(self, image_data: bytes) -> Dict:
        start = time.time()
        try:
            nparr = np.frombuffer(image_data, np.uint8)
            img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            if img is None:
                raise ValueError("cv2 could not decode image")
            rgb_img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)

            quality = self._analyze_quality(img)
            faces = self._analyze_faces(rgb_img)
            overall_score = self._calculate_overall_score(quality, faces)
            duration = time.time() - start

            logger.info("Analysis completed in %.2fs, faces: %d", duration, len(faces))
            return {
                "quality": quality,
                "faces": faces,
                "overall_score": overall_score,
                "face_count": len(faces),
                "single_face": len(faces) == 1,
                "analysis_time": duration,
            }
        except Exception as exc:
            logger.error("Analysis failed: %s", exc)
            return {
                "error": str(exc),
                "quality": {"score": 0, "details": {}},
                "faces": [],
                "overall_score": 0,
                "face_count": 0,
                "single_face": False,
            }

    # ── helpers ────────────────────────────────────────────────────────────────

    def _analyze_quality(self, img: np.ndarray) -> Dict:
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        sharpness = min(100.0, float(cv2.Laplacian(gray, cv2.CV_64F).var()) / 10)
        brightness = float(np.mean(gray))
        brightness_score = min(100.0, brightness / 2.55)
        contrast_score = min(100.0, float(gray.std()) / 1.5)
        return {
            "score": round((sharpness + brightness_score + contrast_score) / 3, 2),
            "details": {
                "sharpness": round(sharpness, 2),
                "brightness": round(brightness, 2),
                "contrast": round(contrast_score, 2),
            },
        }

    def _analyze_faces(self, rgb_img: np.ndarray) -> List[Dict]:
        faces: List[Dict] = []
        try:
            from deepface import DeepFace

            results = DeepFace.analyze(
                rgb_img,
                actions=["age", "gender", "emotion"],
                enforce_detection=False,
                detector_backend="opencv",
                silent=True,
            )
            if isinstance(results, dict):
                results = [results]

            for res in results:
                emotion_scores: Dict = res.get("emotion", {})
                smile_score = emotion_scores.get("happy", 0) / 100
                gender_info = res.get("gender", {})
                dominant_gender = (
                    gender_info.get("dominant_gender", "unknown")
                    if isinstance(gender_info, dict)
                    else str(gender_info)
                )
                region = res.get("region", {})
                face_area = region.get("w", 0) * region.get("h", 0)
                faces.append(
                    {
                        "age": res.get("age", 30),
                        "gender": dominant_gender,
                        "dominant_emotion": res.get("dominant_emotion", "neutral"),
                        "smile_score": round(smile_score, 2),
                        "face_area": face_area,
                    }
                )
        except Exception as exc:
            logger.warning("DeepFace analysis failed: %s", exc)

        return faces

    def _calculate_overall_score(self, quality: Dict, faces: List[Dict]) -> float:
        quality_score = quality.get("score", 0)
        if not faces:
            return round(quality_score * 0.5, 2)

        face_scores = []
        for face in faces:
            fs = 70.0 + face.get("smile_score", 0) * 30
            if face.get("dominant_emotion") in ("happy", "surprise"):
                fs += 10
            face_scores.append(min(100.0, fs))

        avg_face = float(np.mean(face_scores))
        face_penalty = 1.0 if len(faces) == 1 else 0.8 ** (len(faces) - 1)
        return round(quality_score * 0.3 + avg_face * 0.7 * face_penalty, 2)
