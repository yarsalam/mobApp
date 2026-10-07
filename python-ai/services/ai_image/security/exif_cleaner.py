import io
from PIL import Image
import logging

logger = logging.getLogger(__name__)

class EXIFCleaner:
    """حذف EXIF data برای حفظ حریم خصوصی"""
    
    @staticmethod
    def clean(image_data: bytes) -> bytes:
        """
        حذف تمام متادیتاهای EXIF از تصویر
        """
        try:
            img = Image.open(io.BytesIO(image_data))
            
            # تبدیل به RGB (برای حذف transparency)
            if img.mode in ('RGBA', 'LA', 'P'):
                rgb_img = Image.new('RGB', img.size, (255, 255, 255))
                rgb_img.paste(img, mask=img.split()[-1] if img.mode == 'RGBA' else None)
                img = rgb_img
            
            # ذخیره بدون EXIF
            output = io.BytesIO()
            img.save(output, format='JPEG', quality=85, optimize=True)
            
            logger.info(f"EXIF data removed, size: {len(output.getvalue())} bytes")
            return output.getvalue()
            
        except Exception as e:
            logger.error(f"EXIF cleaning failed: {e}")
            raise None