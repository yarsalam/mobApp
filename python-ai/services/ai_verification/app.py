import logging
import os
import tempfile
from datetime import datetime

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import JSONResponse

from face_verifier import FaceVerifier

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s"
)
logger = logging.getLogger(__name__)

app = FastAPI(title="AI Verification Service", version="1.0.0")
verifier = FaceVerifier()

MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB


@app.post("/verify")
async def verify_faces(
    selfie: UploadFile = File(...),
    profile_photo: UploadFile = File(...),
):
    for f in (selfie, profile_photo):
        if not f.content_type.startswith("image/"):
            raise HTTPException(400, f"فایل {f.filename} باید تصویر باشد")

    selfie_path = profile_path = None
    try:
        selfie_data = await selfie.read()
        profile_data = await profile_photo.read()

        if len(selfie_data) > MAX_FILE_SIZE or len(profile_data) > MAX_FILE_SIZE:
            raise HTTPException(400, "حجم فایل بیش از حد مجاز است (max 10MB)")

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
    except Exception as exc:
        logger.error("Verification failed: %s", exc)
        raise HTTPException(500, str(exc))
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
