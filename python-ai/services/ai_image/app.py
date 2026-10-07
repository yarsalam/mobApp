import logging
from datetime import datetime

from fastapi import FastAPI, File, HTTPException, UploadFile, BackgroundTasks
from fastapi.responses import JSONResponse

from security.exif_cleaner import EXIFCleaner
from security.nsfw_detector import NSFWDetector
from services.face_analyzer import analyze_face
from services.image_enhancer import enhance_image
from services.quality_scorer import get_quality_score
from workers.image_analyzer import ImageAnalyzerWorker

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s"
)
logger = logging.getLogger(__name__)

app = FastAPI(title="AI Image Engine", version="3.0.0")

exif_cleaner = EXIFCleaner()
nsfw_detector = NSFWDetector()
analyzer_worker = ImageAnalyzerWorker()


@app.post("/image/upload")
async def upload_image(
    file: UploadFile = File(...), background_tasks: BackgroundTasks = None
):
    if not file.content_type.startswith("image/"):
        raise HTTPException(400, "فایل باید تصویر باشد")

    contents = await file.read()
    cleaned = exif_cleaner.clean(contents)
    if cleaned is None:
        raise HTTPException(status_code=400, detail="Image could not be processed")

    nsfw_result = nsfw_detector.predict(cleaned)
    if nsfw_result.get("is_nsfw", False):
        return JSONResponse(
            {
                "status": "rejected",
                "reason": "nsfw_detected",
                "confidence": nsfw_result.get("confidence"),
                "message": "تصویر نامناسب تشخیص داده شد",
            },
            status_code=400,
        )

    if background_tasks:
        background_tasks.add_task(_process_background, cleaned, file.filename)

    return JSONResponse(
        {
            "status": "accepted",
            "filename": file.filename,
            "size": len(cleaned),
            "message": "تصویر آپلود شد. تحلیل در حال انجام است.",
            "timestamp": datetime.now().isoformat(),
        }
    )


@app.get("/image/status/{filename}")
async def get_status(filename: str):
    # TODO: وضعیت واقعی از Redis بخوان
    return {"status": "processing", "filename": filename}


@app.post("/image/analyze")
async def analyze_image(file: UploadFile = File(...)):
    data = await file.read()
    enhanced = enhance_image(data)
    face_data = analyze_face(enhanced)
    quality = get_quality_score(enhanced)
    return {"status": "success", "quality_score": quality, "faces": face_data}


@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "service": "ai_image",
        "version": "3.0.0",
        "timestamp": datetime.now().isoformat(),
    }


def _process_background(image_data: bytes, filename: str) -> None:
    try:
        logger.info("Background analysis started: %s", filename)
        analyzer_worker.analyze(image_data)
        logger.info("Background analysis done: %s", filename)
    except Exception as exc:
        logger.error("Background processing failed [%s]: %s", filename, exc)
