import io
import logging
import os
import tempfile
from datetime import datetime

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import JSONResponse
from PIL import Image, UnidentifiedImageError

from face_verifier import FaceVerifier

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s"
)
logger = logging.getLogger(__name__)

app = FastAPI(title="AI Verification Service", version="1.1.0")
verifier = FaceVerifier()

MAX_FILE_SIZE = int(os.getenv("MAX_IMAGE_BYTES", str(10 * 1024 * 1024)))


async def _read_valid_image(file: UploadFile) -> bytes:
    if not file.content_type or not file.content_type.lower().startswith("image/"):
        raise HTTPException(415, f"فایل {file.filename} باید تصویر باشد")

    # Bound memory use before decoding; a malicious client cannot upload an
    # arbitrarily large body and only then trigger the size check.
    contents = await file.read(MAX_FILE_SIZE + 1)
    if len(contents) > MAX_FILE_SIZE:
        raise HTTPException(413, "حجم هر تصویر بیش از حد مجاز است (حداکثر 10MB)")

    try:
        with Image.open(io.BytesIO(contents)) as image:
            image.verify()
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        raise HTTPException(415, f"فایل {file.filename} تصویر معتبر نیست") from exc
    return contents


@app.post("/verify")
async def verify_faces(
    selfie: UploadFile = File(...),
    profile_photo: UploadFile = File(...),
):
    selfie_path = profile_path = None
    try:
        selfie_data = await _read_valid_image(selfie)
        profile_data = await _read_valid_image(profile_photo)

        with tempfile.NamedTemporaryFile(delete=False, suffix=".jpg") as sf:
            sf.write(selfie_data)
            selfie_path = sf.name

        with tempfile.NamedTemporaryFile(delete=False, suffix=".jpg") as pf:
            pf.write(profile_data)
            profile_path = pf.name

        result = verifier.verify(selfie_path, profile_path)

        return JSONResponse(
            {
                "status": "success",
                **result,
                "timestamp": datetime.now().isoformat(),
            }
        )

    except HTTPException:
        raise
    except Exception:
        logger.exception("Verification failed")
        raise HTTPException(500, "Face verification failed")
    finally:
        for path in (selfie_path, profile_path):
            if path and os.path.exists(path):
                os.unlink(path)


@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "service": "ai_verification",
        "timestamp": datetime.now().isoformat(),
    }
