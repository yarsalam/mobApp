import os
from nudenet import NudeDetector

class NSFWDetector:
    def __init__(self):
        self.detector = NudeDetector()   # مدل خود را دانلود می‌کند

    def predict(self, image_data: bytes) -> dict:
        # nudenet تصویر را از مسیر فایل می‌خواند، پس ابتدا ذخیره موقت کن
        import tempfile
        tmp_path = None
        try:
            with tempfile.NamedTemporaryFile(suffix='.jpg', delete=False) as tmp:
                tmp.write(image_data)
                tmp_path = tmp.name
            detections = self.detector.detect(tmp_path)
        finally:
            if tmp_path and os.path.exists(tmp_path):
                os.unlink(tmp_path)

        nsfw_classes = {'BELLY_EXPOSED', 'FEMALE_GENITALIA_EXPOSED', 'MALE_GENITALIA_EXPOSED',
                        'BUTTOCKS_EXPOSED', 'ANUS_EXPOSED', 'FEMALE_BREAST_EXPOSED'}
        is_nsfw = any(d['class'] in nsfw_classes for d in detections)
        confidence = max([d['score'] for d in detections], default=0.0)

        return {
            'is_nsfw': is_nsfw,
            'confidence': confidence,
            'details': detections
        }