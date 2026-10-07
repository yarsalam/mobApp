import cv2
import numpy as np

def analyze_face(data: bytes):
    nparr = np.frombuffer(data, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

    face_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
    faces = face_cascade.detectMultiScale(gray, 1.3, 5)

    result = []
    for (x, y, w, h) in faces:
        result.append({
            "x": int(x),
            "y": int(y),
            "width": int(w),
            "height": int(h),
            "area": int(w * h)
        })
    return result
