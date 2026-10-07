import cv2
import numpy as np
from io import BytesIO

def enhance_image(data: bytes):
    nparr = np.frombuffer(data, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    enhanced = cv2.detailEnhance(img, sigma_s=10, sigma_r=0.15)
    _, buffer = cv2.imencode(".jpg", enhanced)
    return buffer.tobytes()
